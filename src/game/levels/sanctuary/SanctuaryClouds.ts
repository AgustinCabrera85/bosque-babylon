import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";

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
varying vec3 vWorldPos;
void main(void) {
  vWorldPos = (world * vec4(position, 1.0)).xyz;
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

function fragmentShader(steps: number) {
  return `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uCameraPosition;
uniform vec3 uCloudColor;
uniform vec3 uShadowColor;
uniform float uTime;
uniform float uDensity;
uniform float uWindSpeed;
uniform float uCloudScale;

${NOISE_3D}
float densityAt(vec3 worldP) {
  vec3 q = worldP * uCloudScale;
  q.x += uTime * uWindSpeed;
  q.z -= uTime * uWindSpeed * 0.37;
  q += 0.16 * vec3(
    sin(q.z * 0.52 + uTime * 0.012),
    sin(q.x * 0.43 - uTime * 0.010),
    cos(q.y * 0.41 + uTime * 0.008)
  );
  float broad = noise3(q * 0.72);
  float detail = noise3(q * 1.56 + uTime * vec3(-0.007, 0.004, 0.009));
  float n = broad * 0.74 + detail * 0.26;
  float bottom = smoothstep(250.0, 760.0, worldP.y);
  float top = 1.0 - smoothstep(1750.0, 2950.0, worldP.y);
  return smoothstep(0.22, 0.78, n) * 0.72 * bottom * top;
}
void main(void) {
  vec3 direction = normalize(vWorldPos - uCameraPosition);
  float elevation = clamp(direction.y * 0.75 + 0.42, 0.0, 1.0);
  vec3 sky = mix(vec3(0.16, 0.026, 0.034), vec3(0.30, 0.052, 0.055), elevation);
  float horizon = 1.0 - smoothstep(0.0, 0.24, abs(direction.y));
  sky = mix(sky, vec3(0.26, 0.05, 0.055), horizon * 0.8);
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
      vec3 smoke = mix(uCloudColor, uShadowColor, clamp(d * 1.15, 0.0, 0.88));
      radiance += smoke * transmission * (1.0 - stepTransmission);
      transmission *= stepTransmission;
      if (transmission < 0.035) break;
    }
    float horizonMask = smoothstep(0.01, 0.24, upward);
    sky = mix(sky, sky * transmission + radiance, horizonMask);
  }
  // A faint gradient prevents the horizon from reading as a featureless void.
  gl_FragColor = vec4(max(sky, vec3(0.003)), 1.0);
}
`;
}

// Low-cost angular sky on the dome: no raymarch, no rectangular smoke planes.
function layeredFragmentShader() {
  return `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uCameraPosition;
uniform vec3 uCloudColor;
uniform vec3 uShadowColor;
uniform float uTime;
${NOISE_3D}
void main(void) {
  vec3 direction = normalize(vWorldPos - uCameraPosition);
  float elevation = clamp(direction.y * 0.75 + 0.42, 0.0, 1.0);
  vec3 sky = mix(vec3(0.16, 0.026, 0.034), vec3(0.30, 0.052, 0.055), elevation);
  float horizon = 1.0 - smoothstep(0.0, 0.24, abs(direction.y));
  sky = mix(sky, vec3(0.26, 0.05, 0.055), horizon * 0.8);
  vec3 q = direction * 3.4 + uTime * vec3(0.008, 0.002, -0.006);
  q += 0.10 * sin(q.zxy * 0.7 + uTime * vec3(0.007, -0.006, 0.009));
  float broad = noise3(q * 0.92);
  float detail = noise3(q * 1.75 + uTime * vec3(-0.005, 0.004, 0.006));
  float density = smoothstep(0.22, 0.78, broad * 0.72 + detail * 0.28);
  float upperSky = smoothstep(-0.12, 0.42, direction.y);
  vec3 smoke = mix(uCloudColor, uShadowColor, density * 0.55);
  sky = mix(sky, smoke, density * upperSky * 0.55);
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
    const key = mode === "layered" ? "sanctuarySkyLayeredV4"
      : quality === "high" ? "sanctuarySkyVolumeHighV4" : "sanctuarySkyVolumeV4";
    Effect.ShadersStore[`${key}VertexShader`] = VERTEX;
    Effect.ShadersStore[`${key}FragmentShader`] = mode === "layered"
      ? layeredFragmentShader() : fragmentShader(quality === "high" ? 20 : 12);
    shader = new ShaderMaterial(mode === "layered" ? "sanctuaryCrimsonLayeredSky" : "sanctuaryCrimsonVolumetricClouds", scene, key, {
      attributes: ["position"],
      uniforms: ["world", "worldViewProjection", "uCameraPosition", "uTime", "uDensity", "uWindSpeed", "uCloudScale", "uCloudColor", "uShadowColor"],
      needAlphaBlending: false,
    });
    shader.backFaceCulling = false; // Looking outward from inside the dome.
    shader.disableDepthWrite = true;
    shader.setVector3("uCameraPosition", Vector3.Zero());
    shader.setFloat("uTime", 0);
    shader.setFloat("uDensity", 0.92);
    shader.setFloat("uWindSpeed", 0.014);
    shader.setFloat("uCloudScale", 0.0047);
    shader.setColor3("uCloudColor", new Color3(0.58, 0.074, 0.078));
    shader.setColor3("uShadowColor", new Color3(0.042, 0.008, 0.014));
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
