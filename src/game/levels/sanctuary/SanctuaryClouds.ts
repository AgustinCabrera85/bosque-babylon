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

// Interpolated value noise; no 3D texture asset or compute shader required.
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash21(i);
  float b = hash21(i+vec2(1.0,0.0));
  float c = hash21(i+vec2(0.0,1.0));
  float d = hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float noise3Approx(vec3 p) {
  // Broad current and finer counter-currents evolve at different rates.
  return 0.54 * noise2(p.xz * 0.70 + p.y * 0.13)
       + 0.30 * noise2(p.zy * 1.34 + p.x * 0.09 + uTime * vec2(-0.019, 0.011))
       + 0.16 * noise2(p.xy * 2.17 + p.z * 0.06 + uTime * vec2(0.014, -0.016));
}
float densityAt(vec3 worldP) {
  vec3 q = worldP * uCloudScale;
  q.x += uTime * uWindSpeed;
  q.z -= uTime * uWindSpeed * 0.57;
  q.y += sin(q.x * 0.53 + uTime * 0.021) * 0.18;
  float warp = noise2(q.xz * 0.47 + uTime * vec2(-0.007, 0.004) + vec2(3.1, -1.7)) - 0.5;
  q += vec3(warp * 0.80, warp * 0.17, warp * 0.55);
  float n = noise3Approx(q);
  // Above the monolith bases, below the unseen top of the mural.
  float bottom = smoothstep(250.0, 640.0, worldP.y);
  float top = 1.0 - smoothstep(1820.0, 2900.0, worldP.y);
  float threshold = 0.49 + warp * 0.09;
  return smoothstep(threshold - 0.14, threshold + 0.14, n) * bottom * top;
}
void main(void) {
  vec3 direction = normalize(vWorldPos - uCameraPosition);
  float elevation = clamp(direction.y * 0.75 + 0.42, 0.0, 1.0);
  vec3 sky = mix(vec3(0.16, 0.026, 0.034), vec3(0.30, 0.052, 0.055), elevation);
  float upward = max(direction.y, 0.0);
  if (upward > 0.025) {
    // The cloud sheet is a world-height bounded density volume, not a 2D sprite.
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
      float extinction = clamp(d * uDensity * stride * 0.0068, 0.0, 0.75);
      // Brighter red where the cloud layer is more tenuous; black in dense folds.
      vec3 smoke = mix(uCloudColor, uShadowColor, smoothstep(0.22, 0.82, d));
      float scatter = extinction * transmission;
      radiance += smoke * scatter;
      transmission *= (1.0 - extinction);
      if (transmission < 0.035) break;
    }
    float horizonMask = smoothstep(0.025, 0.125, upward);
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
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash21(i);
  float b = hash21(i+vec2(1.0,0.0));
  float c = hash21(i+vec2(0.0,1.0));
  float d = hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
void main(void) {
  vec3 direction = normalize(vWorldPos - uCameraPosition);
  float elevation = clamp(direction.y * 0.75 + 0.42, 0.0, 1.0);
  vec3 sky = mix(vec3(0.16, 0.026, 0.034), vec3(0.30, 0.052, 0.055), elevation);
  vec3 q = direction * 3.8;
  q.x += uTime * 0.014;
  q.z -= uTime * 0.011;
  float warp = noise2(q.xz * 0.55 + q.y * 0.13) - 0.5;
  float broad = noise2(q.xz + q.y * 0.26 + vec2(warp * 0.32, -warp * 0.23));
  float fine = noise2(q.zy * 1.85 + q.x * 0.11 + uTime * vec2(-0.013, 0.009));
  float density = smoothstep(0.40, 0.68, broad * 0.65 + fine * 0.35 + warp * 0.08);
  float upperSky = smoothstep(-0.08, 0.34, direction.y);
  vec3 smoke = mix(uCloudColor, uShadowColor, smoothstep(0.25, 0.90, density));
  sky = mix(sky, smoke, density * upperSky * 0.72);
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
    const key = mode === "layered" ? "sanctuarySkyLayeredV3"
      : quality === "high" ? "sanctuarySkyVolumeHighV3" : "sanctuarySkyVolumeV3";
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
    shader.setFloat("uDensity", quality === "high" ? 1.07 : 0.91);
    shader.setFloat("uWindSpeed", 0.028);
    shader.setFloat("uCloudScale", 0.0053);
    shader.setColor3("uCloudColor", new Color3(0.68, 0.078, 0.086));
    shader.setColor3("uShadowColor", new Color3(0.035, 0.004, 0.010));
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
