import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../utils/asset";

/**
 * Rina's storm sky uses the same architectural pattern as SanctuaryClouds:
 * an independent camera-following dome, a fog-free shader, and a disposable
 * update handle. It does NOT import the Sanctuary shader or its wall geometry.
 *
 * The panorama is an LDR color sky, not an HDR environment/reflection probe.
 */
const SHADER_KEY = "rinaStormPanoramaSkyV1";
const SKY_DIAMETER = 1000;
const SKY_TEXTURES = {
  desktop: "assets/textures/rina/sky/rina_storm_sky_2048.webp",
  mobile: "assets/textures/rina/sky/rina_storm_sky_1024.webp",
} as const;

const VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vLocalDirection;
void main(void) {
  // Local unit direction: avoids camera translation, and the UV is computed
  // from a continuous 3D vector rather than from the sphere's seam UVs.
  vLocalDirection = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
varying vec3 vLocalDirection;
uniform sampler2D uPanorama;
uniform float uYawRadians;
uniform float uExposure;
uniform float uLightningFlash;
uniform vec3 uFlashDirection;
uniform float uTime;
uniform float uDesktopMotion;
uniform float uHorizonBlend;
uniform vec3 uHorizonColor;
const float PI = 3.141592653589793;
void main(void) {
  vec3 direction = normalize(vLocalDirection);
  // Equirectangular panorama: longitude wraps; zenith maps to top (v=0).
  float longitude = atan(direction.z, direction.x);
  float u = fract(0.5 + (longitude + uYawRadians) / (2.0 * PI));
  float v = acos(clamp(direction.y, -1.0, 1.0)) / PI;
  vec2 panoramaUv = vec2(u, v);
  if (uDesktopMotion > 0.5) {
    // Move only the cloud belt. The zenith and the horizon stay anchored,
    // while two slow waves make the panorama feel like rolling storm clouds.
    float cloudBelt = smoothstep(-0.12, 0.13, direction.y)
                    * (1.0 - smoothstep(0.77, 0.91, direction.y));
    panoramaUv += cloudBelt * vec2(
      uTime * 0.00023 + 0.0030 * sin(v * 25.0 - uTime * 0.060),
      0.0024 * sin(u * 21.0 + uTime * 0.044)
    );
  }
  vec3 panorama = texture2D(uPanorama,
    vec2(fract(panoramaUv.x), clamp(panoramaUv.y, 0.001, 0.999))).rgb;

  vec3 sky = panorama * uExposure;
  // The flash blooms inside the cloud that emits the bolt. It never changes
  // the concert lights or the color of the audience.
  float cloudValue = dot(panorama, vec3(0.2126, 0.7152, 0.0722));
  float brightCloud = smoothstep(0.07, 0.42, cloudValue);
  float flash = clamp(uLightningFlash, 0.0, 1.0);
  float aroundCloud = pow(max(dot(direction, normalize(uFlashDirection)), 0.0), 17.0);
  sky += flash * (0.008 + aroundCloud * (0.14 + 0.45 * brightCloud))
       * vec3(0.82, 0.63, 1.0);

  // Below the visible horizon, fade to Rina's scene fog. The grandstands
  // still hide most of this region, but it avoids a harsh lower hemisphere.
  float belowHorizon = 1.0 - smoothstep(-0.40, 0.14, direction.y);
  sky = mix(sky, uHorizonColor, belowHorizon * uHorizonBlend);
  gl_FragColor = vec4(max(sky, vec3(0.0)), 1.0);
}
`;

export type RinaStormSkyboxOptions = {
  performanceTier: "desktop" | "mobile";
  /** Initial color brightness. Does not change world/character illumination. */
  exposure?: number;
  /** Rotates the panorama around the Y axis, in degrees. */
  yawDegrees?: number;
  /** How much the bottom edge blends with scene fog, 0..1. */
  horizonBlend?: number;
};

export type RinaStormSkyboxHandle = {
  readonly mesh: Mesh;
  /** Call once each level update AFTER the player camera is positioned. */
  update(cameraPosition: Vector3, deltaSeconds: number): void;
  /** Continuous lightning input, or a one-shot that fades away automatically. */
  setLightningFlash(strength: number, cloudDirection?: Vector3): void;
  /** Runtime debug controls and later StormFX integration. */
  setExposure(value: number): void;
  setYawDegrees(degrees: number): void;
  dispose(): void;
};

const clamp = (v: number, low: number, high: number) =>
  Number.isFinite(v) ? Math.max(low, Math.min(high, v)) : low;

/**
 * Sky-only visual element: no Light, no shadow caster, no camera/pipeline change.
 * Create AFTER `rinaStadiumRoot` has been assembled/scaled, so this dome is
 * never accidentally parented to the scaled stadium geometry.
 */
export function createRinaStormSkybox(
  scene: Scene,
  options: RinaStormSkyboxOptions
): RinaStormSkyboxHandle {
  Effect.ShadersStore[`${SHADER_KEY}VertexShader`] = VERTEX;
  Effect.ShadersStore[`${SHADER_KEY}FragmentShader`] = FRAGMENT;

  const dome = MeshBuilder.CreateSphere(
    "rinaStormSkyboxDome",
    {
      diameter: SKY_DIAMETER,
      segments: options.performanceTier === "mobile" ? 16 : 24,
    },
    scene
  );
  dome.isPickable = false;
  dome.checkCollisions = false;
  dome.receiveShadows = false;
  dome.applyFog = false;
  dome.alwaysSelectAsActiveMesh = true;
  dome.renderingGroupId = 0;
  dome.infiniteDistance = false; // We follow the active player camera explicitly.
  dome.position.copyFrom(scene.activeCamera?.globalPosition ?? Vector3.Zero());

  // invertY=false: in the fragment shader, v=0 samples the source panorama's
  // top (zenith); u wraps horizontally and v clamps at both poles.
  const panorama = new Texture(
    asset(SKY_TEXTURES[options.performanceTier]),
    scene,
    false,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
    undefined,
    (message) => console.warn("Rina skybox texture could not load:", message)
  );
  panorama.wrapU = Texture.WRAP_ADDRESSMODE;
  panorama.wrapV = Texture.CLAMP_ADDRESSMODE;
  panorama.hasAlpha = false;

  const material = new ShaderMaterial(
    "rinaStormSkyboxMaterial",
    scene,
    SHADER_KEY,
    {
      attributes: ["position"],
      uniforms: [
        "worldViewProjection",
        "uYawRadians",
        "uExposure",
        "uLightningFlash",
        "uFlashDirection",
        "uTime",
        "uDesktopMotion",
        "uHorizonBlend",
        "uHorizonColor",
      ],
      samplers: ["uPanorama"],
      needAlphaBlending: false,
    }
  );
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.fogEnabled = false;
  material.setTexture("uPanorama", panorama);
  material.setFloat("uYawRadians", (options.yawDegrees ?? 0) * Math.PI / 180);
  material.setFloat("uExposure", clamp(options.exposure ?? 0.62, 0.0, 2.0));
  material.setFloat("uLightningFlash", 0);
  material.setVector3("uFlashDirection", new Vector3(0, 0.4, 1));
  material.setFloat("uTime", 0);
  material.setFloat("uDesktopMotion", options.performanceTier === "desktop" ? 1 : 0);
  material.setFloat("uHorizonBlend", clamp(options.horizonBlend ?? 0.48, 0, 1));
  material.setColor3("uHorizonColor", scene.fogColor.clone());
  dome.material = material;

  let disposed = false;
  let flash = 0;
  let requestedFlash = 0;
  let time = 0;

  return {
    mesh: dome,
    update(cameraPosition, deltaSeconds) {
      if (disposed) return;
      dome.position.copyFrom(cameraPosition);
      const dt = clamp(deltaSeconds, 0, 0.1);
      if (options.performanceTier === "desktop") {
        time += dt;
        material.setFloat("uTime", time);
      }
      // A 160-ms-ish exponential afterglow. If StormFX supplies a continuous
      // pulse every frame, the sky follows it; if it supplies a single spike,
      // the sky falls back to darkness automatically.
      flash = Math.max(requestedFlash, flash * Math.exp(-8.5 * dt));
      requestedFlash = 0;
      material.setFloat("uLightningFlash", flash);
    },
    setLightningFlash(strength, cloudDirection) {
      if (disposed) return;
      if (cloudDirection) material.setVector3("uFlashDirection", cloudDirection);
      requestedFlash = Math.max(requestedFlash, clamp(strength, 0, 1));
      // Also update immediately for flashes triggered just before render.
      flash = Math.max(flash, requestedFlash);
      material.setFloat("uLightningFlash", flash);
    },
    setExposure(value) {
      if (disposed) return;
      material.setFloat("uExposure", clamp(value, 0, 2));
    },
    setYawDegrees(degrees) {
      if (disposed) return;
      const yaw = Number.isFinite(degrees) ? degrees : 0;
      material.setFloat("uYawRadians", yaw * Math.PI / 180);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Mesh owns its material; Babylon releases the material and panorama.
      if (!dome.isDisposed()) dome.dispose(false, true);
    },
  };
}
