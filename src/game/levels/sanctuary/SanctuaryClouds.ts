import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { SANCTUARY_CONFIG } from "./SanctuaryLayout";

/**
 * Independent crimson-sky module. It never changes the engine/backend, camera,
 * render pipeline or other levels. The fullscreen portion behind world geometry
 * uses a short raymarch through a bounded procedural density field.
 *
 * Inspired by the Babylon Playground #BHNVUE#2 concept, NOT copied from its
 * source (the Playground snippet wasn't available during this implementation).
 */
export type SanctuaryCloudMode = "volumetric" | "layered" | "off";
export type SanctuaryCloudQuality = "standard" | "high";

export interface SanctuaryCloudsOptions {
  mobile: boolean;
  mode?: SanctuaryCloudMode;
  quality?: SanctuaryCloudQuality;
}

export interface SanctuaryCloudsHandle {
  readonly mode: SanctuaryCloudMode;
  update(timeSeconds: number, cameraPosition: Vector3): void;
  dispose(): void;
}

const VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vSkyDirection;
void main(void) {
  // The dome follows the camera. Local positions give both sides of its mesh
  // seam exactly the same angular coordinate without a texture UV or wrap.
  vSkyDirection = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// Smooth trilinear value noise: two samples replace the former stack of
// projected 2D noises, avoiding sheet-like contours at similar shader cost.
const NOISE_3D = `
float hash31(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f*f*(3.0-2.0*f);
  float x00 = mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x);
  float x10 = mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x);
  float x01 = mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x);
  float x11 = mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}
`;

const CRIMSON_SKY = `
vec3 cloudWarp(vec3 p, float time) {
  float phase = time * 0.075;
  return 0.48 * vec3(
    sin(p.z * 0.83 + p.y * 0.31 + phase + 0.28 * sin(p.x * 0.63 - phase * 0.71)),
    cos(p.x * 0.76 - p.z * 0.42 + phase * 0.83),
    sin(p.y * 0.69 + p.x * 0.37 - phase * 0.67)
  );
}
float skyBillow(vec3 direction, float time) {
  vec3 p = direction * 3.2;
  vec3 warp = cloudWarp(p, time);
  return noise3((p + warp) * 0.92) * 0.7
    + noise3(p * 1.75 - warp.zxy * 0.8
      + time * vec3(-0.006, 0.003, 0.005)) * 0.3;
}
vec3 crimsonSky(vec3 direction, float billow) {
  float elevation = clamp(direction.y * 0.75 + 0.42, 0.0, 1.0);
  vec3 sky = mix(vec3(0.075, 0.009, 0.014), vec3(0.19, 0.027, 0.03), elevation);
  // A broad vertical fade keeps the low horizon dark without drawing a band.
  sky *= mix(0.48, 1.0, smoothstep(-0.09, 0.42, direction.y));
  return sky * mix(0.18, 1.35, smoothstep(0.34, 0.66, billow));
}
float wallMistVeil(vec3 direction, vec3 cameraPosition, float wallZ) {
  if (cameraPosition.z >= wallZ) return 0.0;
  float forward = smoothstep(0.0, 0.08, direction.z);
  if (forward <= 0.0) return 0.0;
  float distanceToWall = (wallZ - cameraPosition.z) / max(direction.z, 0.001);
  vec3 hit = cameraPosition + direction * distanceToWall;
  // The stone starts dissolving at |x| = 2900. Match the fog behind its
  // screen-door gaps before any gaps appear, hiding the finite wing edge.
  float lateral = smoothstep(1800.0, 2900.0, abs(hit.x));
  float wallHeight = smoothstep(-400.0, -80.0, hit.y)
    * (1.0 - smoothstep(9000.0, 11500.0, hit.y));
  return forward * lateral * wallHeight;
}
`;

function fragmentShader(steps: number) {
  return `
precision highp float;
varying vec3 vSkyDirection;
uniform vec3 uCameraPosition;
uniform vec3 uCloudColor;
uniform vec3 uShadowColor;
uniform vec3 uWallFogColor;
uniform float uTime;
uniform float uDensity;
uniform float uWindSpeed;
uniform float uCloudScale;
uniform float uWallZ;

${NOISE_3D}
${CRIMSON_SKY}
float densityAt(vec3 worldP) {
  vec3 base = worldP * uCloudScale;
  vec3 warp = cloudWarp(base, uTime);
  vec3 q = base + warp + uTime * uWindSpeed * vec3(1.0, 0.0, -0.37);
  float broad = noise3(q * 0.72);
  float detail = noise3((base - warp.yzx * 0.65) * 1.56
    + uTime * vec3(-0.009, 0.004, 0.006));
  float n = broad * 0.74 + detail * 0.26;
  float bottom = smoothstep(250.0, 760.0, worldP.y);
  float top = 1.0 - smoothstep(1750.0, 2950.0, worldP.y);
  float threshold = 0.22 + 0.045 * sin(uTime * 0.075 + base.x * 0.7 - base.z * 0.5);
  return smoothstep(threshold, threshold + 0.56, n) * 0.72 * bottom * top;
}
void main(void) {
  vec3 direction = normalize(vSkyDirection);
  vec3 sky = crimsonSky(direction, skyBillow(direction, uTime));
  float upward = max(direction.y, 0.0);
  if (upward > 0.01) {
    // Bounded world-space density rendered only in the sky, behind scene meshes.
    float entry = max(0.0, (240.0 - uCameraPosition.y) / upward);
    float endDist = min(8500.0, (3000.0 - uCameraPosition.y) / upward);
    float travel = max(0.0, endDist - entry);
    float stride = travel / float(${steps});
    float transmission = 1.0;
    vec3 radiance = vec3(0.0);
    for (int i = 0; i < ${steps}; i++) {
      float t = entry + (float(i) + 0.5) * stride;
      vec3 p = uCameraPosition + direction * t;
      float d = densityAt(p);
      float opticalDepth = min(d * uDensity * stride * 0.0024, 4.0);
      float stepTransmission = exp(-opticalDepth);
      vec3 smoke = mix(uCloudColor, uShadowColor, smoothstep(0.19, 0.62, d) * 0.92);
      radiance += smoke * transmission * (1.0 - stepTransmission);
      transmission *= stepTransmission;
      if (transmission < 0.035) break;
    }
    float horizonMask = smoothstep(0.01, 0.50, upward)
      * smoothstep(0.0, 1800.0, travel);
    sky = mix(sky, sky * transmission + radiance, horizonMask);
  }
  sky = mix(sky, uWallFogColor, wallMistVeil(direction, uCameraPosition, uWallZ));
  // A faint gradient prevents the horizon from reading as a featureless void.
  gl_FragColor = vec4(max(sky, vec3(0.003)), 1.0);
}
`;
}

// Low-cost angular sky on the dome: no raymarch, no rectangular smoke planes.
function layeredFragmentShader() {
  return `
precision highp float;
varying vec3 vSkyDirection;
uniform vec3 uCameraPosition;
uniform vec3 uCloudColor;
uniform vec3 uShadowColor;
uniform vec3 uWallFogColor;
uniform float uTime;
uniform float uWallZ;
${NOISE_3D}
${CRIMSON_SKY}
void main(void) {
  vec3 direction = normalize(vSkyDirection);
  float billow = skyBillow(direction, uTime);
  vec3 sky = crimsonSky(direction, billow);
  vec3 base = direction * 3.2;
  float threshold = 0.22 + 0.045 * sin(uTime * 0.075 + base.x * 0.7 - base.z * 0.5);
  float density = smoothstep(threshold, threshold + 0.56, billow);
  float upperSky = smoothstep(-0.09, 0.50, direction.y);
  vec3 smoke = mix(uCloudColor, uShadowColor, smoothstep(0.35, 0.82, density) * 0.92);
  sky = mix(sky, smoke, density * upperSky * 0.68);
  sky = mix(sky, uWallFogColor, wallMistVeil(direction, uCameraPosition, uWallZ));
  gl_FragColor = vec4(max(sky, vec3(0.003)), 1.0);
}
`;
}

/**
 * Mobile/low-end layered mode uses a cheap procedural dome. Scene EXP2 fog
 * handles distant architecture in every mode, including the static "off" sky.
 */
export function createSanctuaryClouds(scene: Scene, options: SanctuaryCloudsOptions): SanctuaryCloudsHandle {
  const mode = options.mode ?? (options.mobile ? "layered" : "volumetric");
  const dome = MeshBuilder.CreateSphere("sanctuaryCloudSkyDome", {
    diameter: 15500,
    segments: options.mobile ? 16 : 24,
  }, scene);
  dome.isPickable = false;
  dome.applyFog = false;
  dome.alwaysSelectAsActiveMesh = true;
  dome.renderingGroupId = 0;
  dome.infiniteDistance = false; // We explicitly track the active camera below.

  let shader: ShaderMaterial | null = null;
  if (mode !== "off") {
    const quality = options.quality ?? "standard";
    const key = mode === "layered" ? "sanctuarySkyLayeredV8"
      : quality === "high" ? "sanctuarySkyVolumeHighV8" : "sanctuarySkyVolumeV8";
    Effect.ShadersStore[`${key}VertexShader`] = VERTEX;
    Effect.ShadersStore[`${key}FragmentShader`] = mode === "layered"
      ? layeredFragmentShader() : fragmentShader(quality === "high" ? 20 : 12);
    shader = new ShaderMaterial(mode === "layered" ? "sanctuaryCrimsonLayeredSky" : "sanctuaryCrimsonVolumetricClouds", scene, key, {
      attributes: ["position"],
      uniforms: ["world", "worldViewProjection", "uCameraPosition", "uTime", "uDensity", "uWindSpeed", "uCloudScale", "uCloudColor", "uShadowColor", "uWallFogColor", "uWallZ"],
      needAlphaBlending: false,
    });
    shader.backFaceCulling = false; // Looking outward from inside the dome.
    shader.disableDepthWrite = true;
    shader.setVector3("uCameraPosition", Vector3.Zero());
    shader.setFloat("uTime", 0);
    shader.setFloat("uDensity", 0.92);
    shader.setFloat("uWindSpeed", 0.012);
    shader.setFloat("uCloudScale", 0.0047);
    shader.setColor3("uCloudColor", new Color3(0.64, 0.07, 0.074));
    shader.setColor3("uShadowColor", new Color3(0.012, 0.002, 0.004));
    shader.setColor3("uWallFogColor", scene.fogColor);
    shader.setFloat("uWallZ", SANCTUARY_CONFIG.gateWallZ);
    dome.material = shader;
  } else {
    const flat = new StandardMaterial("sanctuarySkyFallbackMaterial", scene);
    flat.diffuseColor = new Color3(0.27, 0.045, 0.048);
    flat.emissiveColor = new Color3(0.21, 0.034, 0.039);
    flat.disableLighting = true;
    flat.disableDepthWrite = true;
    flat.backFaceCulling = false;
    dome.material = flat;
  }

  return {
    mode,
    update(timeSeconds, cameraPosition) {
      dome.position.copyFrom(cameraPosition);
      shader?.setFloat("uTime", timeSeconds);
      shader?.setVector3("uCameraPosition", cameraPosition);
    },
    dispose() { if (!dome.isDisposed()) dome.dispose(false, true); },
  };
}
