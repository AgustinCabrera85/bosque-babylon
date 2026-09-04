import { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { Scene } from "@babylonjs/core/scene";
import type { TerminalLagoonVisualConfig } from "./TerminalLagoonVisualConfig";
import {
  getWaterLevelAt,
  isPointInsideWaterSurface,
  type WaterSurfaceInfo,
} from "./WaterSurface";

export type LagoonImmersionState = "above" | "crossing" | "underwater";

export type LagoonUnderwaterEffectOptions = {
  surface: WaterSurfaceInfo;
  tuning: TerminalLagoonVisualConfig["underwater"];
  getBaseFogDensity: () => number;
};

export type LagoonUnderwaterEffectHandle = {
  postProcess: PostProcess;
  getState: () => LagoonImmersionState;
  update: (deltaTime: number) => void;
  dispose: () => void;
};

const SHADER_NAME = "bosqueLagoonUnderwater";

const fragmentShader = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 resolution;
uniform float time;
uniform float submersion;
uniform float crossing;
uniform float waterlineY;
uniform vec3 underwaterTint;
uniform float blurAmount;
uniform float distortionAmount;
uniform float underwaterContrast;

void main(void) {
  float lineWave = sin(vUV.x * 20.0 + time * 1.7) * 0.007;
  lineWave += sin(vUV.x * 43.0 - time * 1.1) * 0.0025;
  float lineY = waterlineY + lineWave * crossing;
  float lineThickness = 0.008 + distortionAmount * 2.0;
  float belowLine = 1.0 - smoothstep(lineY - lineThickness, lineY + lineThickness, vUV.y);
  float mediumMask = clamp(max(submersion, crossing * belowLine), 0.0, 1.0);

  vec2 refraction = vec2(
    sin(vUV.y * 31.0 + time * 1.35) + sin(vUV.y * 67.0 - time * 0.72) * 0.35,
    cos(vUV.x * 27.0 - time * 1.08) * 0.45
  );
  vec2 sampleUV = clamp(vUV + refraction * distortionAmount * mediumMask, 0.002, 0.998);
  vec2 texel = 1.0 / max(resolution, vec2(1.0));
  vec2 blurStep = texel * blurAmount * (0.65 + mediumMask);

  vec3 sharp = texture2D(textureSampler, sampleUV).rgb;
  vec3 soft = sharp * 0.44;
  soft += texture2D(textureSampler, sampleUV + vec2(blurStep.x, 0.0)).rgb * 0.14;
  soft += texture2D(textureSampler, sampleUV - vec2(blurStep.x, 0.0)).rgb * 0.14;
  soft += texture2D(textureSampler, sampleUV + vec2(0.0, blurStep.y)).rgb * 0.14;
  soft += texture2D(textureSampler, sampleUV - vec2(0.0, blurStep.y)).rgb * 0.14;
  vec3 color = mix(sharp, soft, clamp(blurAmount * mediumMask * 0.34, 0.0, 0.42));

  vec3 reducedContrast = (color - 0.5) * underwaterContrast + 0.5;
  vec3 tealGrade = reducedContrast * vec3(0.78, 0.96, 1.02) + underwaterTint * 0.10;
  color = mix(color, tealGrade, mediumMask * 0.76);

  float depthHaze = (0.055 + smoothstep(0.45, 1.0, vUV.y) * 0.035) * mediumMask;
  color = mix(color, underwaterTint, depthHaze);

  float surfaceBand = 1.0 - smoothstep(lineThickness, lineThickness * 4.0, abs(vUV.y - lineY));
  color += underwaterTint * surfaceBand * crossing * 0.13;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function registerShader() {
  Effect.ShadersStore[`${SHADER_NAME}FragmentShader`] = fragmentShader;
}

export function createLagoonUnderwaterEffect(
  scene: Scene,
  camera: Camera,
  options: LagoonUnderwaterEffectOptions
): LagoonUnderwaterEffectHandle {
  registerShader();

  const { tuning } = options;
  const postProcess = new PostProcess(
    "lagoonUnderwaterPostProcess",
    SHADER_NAME,
    [
      "resolution",
      "time",
      "submersion",
      "crossing",
      "waterlineY",
      "underwaterTint",
      "blurAmount",
      "distortionAmount",
      "underwaterContrast",
    ],
    null,
    0.75,
    null,
    Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    scene.getEngine(),
    false
  );

  let disposed = false;
  let elapsed = 0;
  let state: LagoonImmersionState = "above";
  let submersion = 0;
  let crossing = 0;
  let waterlineY = 0.5;

  const setAttached = (next: boolean) => {
    if (disposed) return;
    const actuallyAttached = camera._postProcesses.includes(postProcess);
    if (next && !actuallyAttached) camera.attachPostProcess(postProcess);
    if (!next && actuallyAttached) camera.detachPostProcess(postProcess);
  };

  postProcess.onApplyObservable.add((effect) => {
    const width = Math.max(1, postProcess.width || scene.getEngine().getRenderWidth());
    const height = Math.max(1, postProcess.height || scene.getEngine().getRenderHeight());
    effect.setFloat2("resolution", width, height);
    effect.setFloat("time", elapsed);
    effect.setFloat("submersion", submersion);
    effect.setFloat("crossing", crossing);
    effect.setFloat("waterlineY", waterlineY);
    effect.setFloat3("underwaterTint", ...tuning.tintColor);
    effect.setFloat("blurAmount", tuning.blurAmount);
    effect.setFloat("distortionAmount", tuning.distortionAmount);
    effect.setFloat("underwaterContrast", tuning.contrast);
  });

  const handle: LagoonUnderwaterEffectHandle = {
    postProcess,
    getState: () => state,
    update(deltaTime) {
      if (disposed) return;
      elapsed += Math.max(0, deltaTime);

      // Player cameras are parented to the controller root. Force the view
      // matrix once so globalPosition reflects that parent in this same frame.
      camera.getViewMatrix(true);
      const cameraPosition = camera.globalPosition;
      const insideLagoon = isPointInsideWaterSurface(options.surface, cameraPosition, 0.08);
      const band = Math.max(0.05, tuning.transitionBandThickness);
      const depth = getWaterLevelAt(options.surface, cameraPosition) - cameraPosition.y;

      if (!insideLagoon || depth < -band) {
        state = "above";
        submersion = 0;
        crossing = 0;
        setAttached(false);
        scene.fogDensity = options.getBaseFogDensity();
        return;
      }

      submersion = smoothstep(-band * 0.1, band * 0.85, depth);
      crossing = 1 - smoothstep(0, band, Math.abs(depth));
      waterlineY = 0.5 + clamp(depth / band, -1, 1) * 0.48;
      state = depth > band * 0.72 ? "underwater" : "crossing";
      setAttached(true);
      scene.fogDensity = options.getBaseFogDensity() * (1 + tuning.fogStrength * submersion);
    },
    dispose() {
      if (disposed) return;
      if (camera._postProcesses.includes(postProcess)) {
        camera.detachPostProcess(postProcess);
      }
      disposed = true;
      scene.fogDensity = options.getBaseFogDensity();
      postProcess.dispose();
    },
  };

  scene.onDisposeObservable.addOnce(() => handle.dispose());
  return handle;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}
