import { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import "@babylonjs/core/Shaders/postprocess.vertex";

export type VintageFilmSettings = {
  grainIntensity: number;
  chromaticAberration: number;
  vignetteIntensity: number;
  vignetteSoftness: number;
  edgeBlur: number;
  lineDistortion: number;
  glitchIntensity: number;
  scanlineIntensity: number;
  lutStrength: number;
  contrast: number;
  saturation: number;
  exposure: number;
};

export type VintageFilmOptions = Partial<VintageFilmSettings> & {
  enabled?: boolean;
};

export type VintageFilmHandle = {
  postProcess: PostProcess;
  isEnabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => boolean;
  update: (settings: Partial<VintageFilmSettings>) => void;
  dispose: () => void;
};

const SHADER_NAME = "bosqueVintageFilm";
const STORAGE_KEY = "bosque:vintageFilmEnabled";

export const fridayThe13thVintagePreset: VintageFilmSettings = {
  grainIntensity: 0.13,
  chromaticAberration: 1.75,
  vignetteIntensity: 0.58,
  vignetteSoftness: 0.42,
  edgeBlur: 1.15,
  lineDistortion: 0.42,
  glitchIntensity: 0.11,
  scanlineIntensity: 0.18,
  lutStrength: 0.86,
  contrast: 1.18,
  saturation: 0.72,
  exposure: 0.93,
};

const fragmentShader = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 resolution;
uniform float time;
uniform float grainIntensity;
uniform float chromaticAberration;
uniform float vignetteIntensity;
uniform float vignetteSoftness;
uniform float edgeBlur;
uniform float lineDistortion;
uniform float glitchIntensity;
uniform float scanlineIntensity;
uniform float lutStrength;
uniform float contrast;
uniform float saturation;
uniform float exposure;

float random(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

vec2 barrel(vec2 uv, float amount) {
  vec2 center = uv - 0.5;
  float radius2 = dot(center, center);
  return uv + center * radius2 * amount;
}

vec3 sampleWithEdgeBlur(vec2 uv, float blurAmount) {
  vec2 texel = 1.0 / max(resolution, vec2(1.0));
  float edgeMask = smoothstep(0.16, 0.72, distance(uv, vec2(0.5)) * 1.42);
  vec2 dir = normalize(uv - vec2(0.5) + vec2(0.0001));
  vec2 blur = dir * texel * blurAmount * edgeMask * 6.0;

  vec3 color = texture2D(textureSampler, uv).rgb * 0.42;
  color += texture2D(textureSampler, uv + blur).rgb * 0.18;
  color += texture2D(textureSampler, uv - blur).rgb * 0.18;
  color += texture2D(textureSampler, uv + blur * 2.0).rgb * 0.11;
  color += texture2D(textureSampler, uv - blur * 2.0).rgb * 0.11;
  return color;
}

vec3 applySlasherLut(vec3 color) {
  vec3 shadows = vec3(0.02, 0.055, 0.05);
  vec3 mids = vec3(0.96, 0.84, 0.60);
  vec3 highs = vec3(1.12, 0.88, 0.70);

  float y = luma(color);
  vec3 shadowGrade = mix(color * shadows * 3.2, color, smoothstep(0.02, 0.34, y));
  vec3 warmGrade = color * mix(mids, highs, smoothstep(0.35, 0.92, y));
  vec3 redBias = vec3(color.r * 1.06, color.g * 0.97, color.b * 0.88);

  return mix(mix(shadowGrade, warmGrade, 0.72), redBias, 0.22);
}

void main(void) {
  vec2 uv = vUV;

  float tapeNoise = random(vec2(floor(uv.y * 88.0), floor(time * 9.0)));
  float glitchBand = step(0.972, tapeNoise) * glitchIntensity;
  float slowWave = sin(uv.y * 38.0 + time * 2.4) * 0.0012;
  float fastWave = sin(uv.y * 420.0 + time * 18.0) * 0.00038;
  uv.x += (slowWave + fastWave) * lineDistortion;
  uv.x += (random(vec2(floor(time * 16.0), floor(uv.y * 45.0))) - 0.5) * glitchBand * 0.04;
  uv = barrel(uv, 0.026 * lineDistortion);

  vec2 chromaDir = uv - vec2(0.5);
  float chromaFalloff = smoothstep(0.12, 0.82, length(chromaDir) * 1.38);
  vec2 chromaOffset = normalize(chromaDir + vec2(0.0001)) * chromaticAberration * chromaFalloff / max(resolution.x, 1.0);

  vec3 base = sampleWithEdgeBlur(uv, edgeBlur);
  float red = texture2D(textureSampler, uv + chromaOffset).r;
  float blue = texture2D(textureSampler, uv - chromaOffset).b;
  vec3 color = vec3(red, base.g, blue);
  color = mix(base, color, 0.86);

  color *= exposure;
  color = (color - 0.5) * contrast + 0.5;
  float gray = luma(color);
  color = mix(vec3(gray), color, saturation);
  color = mix(color, applySlasherLut(color), lutStrength);

  float scanline = sin((uv.y * resolution.y) * 3.14159265);
  color *= 1.0 - scanlineIntensity * (0.5 + 0.5 * scanline) * 0.22;

  float grain = random(uv * resolution + vec2(time * 63.7, time * 21.9)) - 0.5;
  color += grain * grainIntensity;

  float dist = distance(vUV, vec2(0.5));
  float vignette = smoothstep(0.92 - vignetteSoftness, 0.92, dist * 1.5);
  color *= 1.0 - vignette * vignetteIntensity;

  color += glitchBand * vec3(0.035, -0.012, 0.02);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function registerShader() {
  Effect.ShadersStore[`${SHADER_NAME}FragmentShader`] = fragmentShader;
}

function readStoredEnabled(defaultEnabled: boolean) {
  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get("vintage");
  if (queryValue) {
    return ["1", "true", "on", "si", "yes"].includes(queryValue.toLowerCase());
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return defaultEnabled;
}

function bindMenuToggle(handle: VintageFilmHandle) {
  const toggle = document.getElementById("postProcessingToggle") as HTMLInputElement | null;
  const render = () => {
    const enabled = handle.isEnabled();
    if (toggle) toggle.checked = enabled;
  };

  toggle?.addEventListener("change", (event) => {
    event.stopPropagation();
    handle.setEnabled(toggle.checked);
    render();
  });
  render();
}

export function createVintageFilmPostProcess(
  scene: Scene,
  camera: Camera,
  options: VintageFilmOptions = {}
): VintageFilmHandle {
  registerShader();

  const settings: VintageFilmSettings = {
    ...fridayThe13thVintagePreset,
    ...options,
  };

  const postProcess = new PostProcess(
    "vintageFilmPostProcess",
    SHADER_NAME,
    [
      "resolution",
      "time",
      "grainIntensity",
      "chromaticAberration",
      "vignetteIntensity",
      "vignetteSoftness",
      "edgeBlur",
      "lineDistortion",
      "glitchIntensity",
      "scanlineIntensity",
      "lutStrength",
      "contrast",
      "saturation",
      "exposure",
    ],
    null,
    1,
    null,
    Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    scene.getEngine(),
    false
  );

  let enabled = false;
  let elapsed = 0;
  let buttonRender: (() => void) | null = null;

  const beforeRenderObserver: Observer<Scene> | null = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime() * 0.001;
  });

  postProcess.onApplyObservable.add((effect) => {
    const size = postProcess.getEngine().getRenderWidth
      ? { width: postProcess.getEngine().getRenderWidth(), height: postProcess.getEngine().getRenderHeight() }
      : { width: 1, height: 1 };
    effect.setFloat2("resolution", size.width, size.height);
    effect.setFloat("time", elapsed);
    effect.setFloat("grainIntensity", settings.grainIntensity);
    effect.setFloat("chromaticAberration", settings.chromaticAberration);
    effect.setFloat("vignetteIntensity", settings.vignetteIntensity);
    effect.setFloat("vignetteSoftness", settings.vignetteSoftness);
    effect.setFloat("edgeBlur", settings.edgeBlur);
    effect.setFloat("lineDistortion", settings.lineDistortion);
    effect.setFloat("glitchIntensity", settings.glitchIntensity);
    effect.setFloat("scanlineIntensity", settings.scanlineIntensity);
    effect.setFloat("lutStrength", settings.lutStrength);
    effect.setFloat("contrast", settings.contrast);
    effect.setFloat("saturation", settings.saturation);
    effect.setFloat("exposure", settings.exposure);
  });

  const handle: VintageFilmHandle = {
    postProcess,
    isEnabled: () => enabled,
    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      if (enabled) {
        camera.attachPostProcess(postProcess);
      } else {
        camera.detachPostProcess(postProcess);
      }
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
      buttonRender?.();
    },
    toggle() {
      handle.setEnabled(!enabled);
      return enabled;
    },
    update(nextSettings) {
      Object.assign(settings, nextSettings);
    },
    dispose() {
      if (enabled) camera.detachPostProcess(postProcess);
      if (beforeRenderObserver) scene.onBeforeRenderObservable.remove(beforeRenderObserver);
      postProcess.dispose();
    },
  };

  buttonRender = () => {
    const toggle = document.getElementById("postProcessingToggle") as HTMLInputElement | null;
    if (toggle) toggle.checked = enabled;
  };

  const initialEnabled = readStoredEnabled(options.enabled ?? false);
  if (initialEnabled) handle.setEnabled(true);

  bindMenuToggle(handle);

  scene.onDisposeObservable.addOnce(() => handle.dispose());

  return handle;
}
