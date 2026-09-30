import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Shaders/postprocess.vertex";

const SHADER = "lryloExpressionist";
const fragmentShader = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 resolution;
uniform float time;
uniform float intensity;
uniform float grain;
uniform float vignette;
uniform float desaturate;
uniform float crush;
uniform float ascentMood;
float rand(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(void){
  vec2 uv = vUV;
  uv.x += sin(uv.y * 52.0 + time * 1.9) * 0.00065 * intensity;
  vec3 source = texture2D(textureSampler, uv).rgb;
  float y = luma(source);
  vec3 graded = mix(source, vec3(y), desaturate);
  graded = (graded - 0.5) * (1.0 + crush * 0.35) + 0.5;
  graded.r *= mix(1.02, 0.94, ascentMood);
  graded.g *= mix(1.0, 0.97, ascentMood);
  graded.b *= mix(0.95, 0.99, ascentMood);
  graded *= 1.0 - ascentMood * 0.08;
  graded += (rand(uv * resolution + vec2(time * 37.0, time * 13.0)) - 0.5) * grain;
  float v = smoothstep(0.42, 0.78, distance(vUV, vec2(0.5)));
  graded *= 1.0 - v * vignette;
  gl_FragColor = vec4(mix(source, clamp(graded, 0.0, 1.0), intensity), 1.0);
}`;

export type ExpressionistPostProcessHandle = {
  setIntensity(value: number): void;
  getIntensity(): number;
  setAscentProgress(value: number): void;
  getAscentProgress(): number;
  dispose(): void;
};

export const EXPRESSIONIST_BASE_GRADE = {
  grain: 0.065,
  vignette: 0.56,
  desaturate: 0.62,
  crush: 0.46,
} as const;

export const EXPRESSIONIST_ASCENT_GRADE_DELTA = {
  grain: 0.012,
  vignette: 0.12,
  desaturate: 0.22,
  crush: 0.17,
} as const;

export function resolveExpressionistAscentMood(progress: number) {
  const clamped = Math.max(0, Math.min(1, progress));
  const normalized = Math.max(0, Math.min(1, (clamped - 0.035) / 0.815));
  return normalized * normalized * (3 - 2 * normalized);
}

export function createExpressionistPostProcess(
  scene: Scene,
  camera: Camera
): ExpressionistPostProcessHandle {
  Effect.ShadersStore[`${SHADER}FragmentShader`] = fragmentShader;
  const post = new PostProcess(
    "expressionistPostProcess",
    SHADER,
    [
      "resolution",
      "time",
      "intensity",
      "grain",
      "vignette",
      "desaturate",
      "crush",
      "ascentMood",
    ],
    null,
    1,
    camera,
    Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    scene.getEngine(),
    false
  );
  let elapsed = 0;
  let intensity = 0.72;
  let ascentProgress = 0;
  let ascentMood = 0;
  let disposed = false;
  const observer = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime() * 0.001;
  });
  post.onApplyObservable.add((effect: Effect) => {
    effect.setFloat2("resolution", post.getEngine().getRenderWidth(), post.getEngine().getRenderHeight());
    effect.setFloat("time", elapsed);
    effect.setFloat("intensity", intensity);
    effect.setFloat(
      "grain",
      EXPRESSIONIST_BASE_GRADE.grain +
        EXPRESSIONIST_ASCENT_GRADE_DELTA.grain * ascentMood
    );
    effect.setFloat(
      "vignette",
      EXPRESSIONIST_BASE_GRADE.vignette +
        EXPRESSIONIST_ASCENT_GRADE_DELTA.vignette * ascentMood
    );
    effect.setFloat(
      "desaturate",
      EXPRESSIONIST_BASE_GRADE.desaturate +
        EXPRESSIONIST_ASCENT_GRADE_DELTA.desaturate * ascentMood
    );
    effect.setFloat(
      "crush",
      EXPRESSIONIST_BASE_GRADE.crush +
        EXPRESSIONIST_ASCENT_GRADE_DELTA.crush * ascentMood
    );
    effect.setFloat("ascentMood", ascentMood);
  });
  return {
    setIntensity(value) {
      intensity = Math.max(0, Math.min(1, value));
    },
    getIntensity: () => intensity,
    setAscentProgress(value) {
      ascentProgress = Math.max(0, Math.min(1, value));
      ascentMood = resolveExpressionistAscentMood(ascentProgress);
    },
    getAscentProgress: () => ascentProgress,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.onBeforeRenderObservable.remove(observer);
      post.dispose();
    },
  };
}
