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
  return 0.55 * noise2(p.xz + p.y * 0.13)
       + 0.29 * noise2(p.zy * 1.21 + p.x * 0.09)
       + 0.16 * noise2(p.xy * 1.61 + p.z * 0.06);
}
float densityAt(vec3 worldP) {
  vec3 q = worldP * uCloudScale;
  q.x += uTime * uWindSpeed;
  q.z -= uTime * uWindSpeed * 0.51;
  q.y += sin(q.x * 0.62 + uTime * 0.018) * 0.23;
  float warp = noise2(q.xz * 0.47 + 3.1);
  float n = noise3Approx(q + vec3(warp * 0.35, 0.0, warp * 0.21));
  // Above the monolith bases, below the unseen top of the mural.
  float bottom = smoothstep(250.0, 640.0, worldP.y);
  float top = 1.0 - smoothstep(1820.0, 2900.0, worldP.y);
  return smoothstep(0.35, 0.63, n) * bottom * top;
}
void main(void) {
  vec3 direction = normalize(vWorldPos - uCameraPosition);
  float elevation = clamp(direction.y * 0.75 + 0.42, 0.0, 1.0);
  vec3 sky = mix(vec3(0.16, 0.026, 0.034), vec3(0.40, 0.064, 0.060), elevation);
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
      vec3 smoke = mix(uCloudColor, uShadowColor, smoothstep(0.20, 0.94, d));
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

/**
 * Mobile/low-end: neutral deep-red dome with no raymarch. The independently
 * owned SanctuaryAtmosphere sheets remain responsible for visible low-cost fog.
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
  if (mode === "volumetric") {
    const quality = options.quality ?? "standard";
    const key = quality === "high" ? "sanctuarySkyVolumeHighV2" : "sanctuarySkyVolumeV2";
    Effect.ShadersStore[`${key}VertexShader`] = VERTEX;
    Effect.ShadersStore[`${key}FragmentShader`] = fragmentShader(quality === "high" ? 20 : 12);
    shader = new ShaderMaterial("sanctuaryCrimsonVolumetricClouds", scene, key, {
      attributes: ["position"],
      uniforms: ["world", "worldViewProjection", "uCameraPosition", "uTime", "uDensity", "uWindSpeed", "uCloudScale", "uCloudColor", "uShadowColor"],
      needAlphaBlending: false,
    });
    shader.backFaceCulling = false; // Looking outward from inside the dome.
    shader.disableDepthWrite = true;
    shader.setVector3("uCameraPosition", Vector3.Zero());
    shader.setFloat("uTime", 0);
    shader.setFloat("uDensity", quality === "high" ? 1.07 : 0.91);
    shader.setFloat("uWindSpeed", 0.018);
    shader.setFloat("uCloudScale", 0.0053);
    shader.setColor3("uCloudColor", new Color3(0.75, 0.105, 0.092));
    shader.setColor3("uShadowColor", new Color3(0.065, 0.008, 0.014));
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
