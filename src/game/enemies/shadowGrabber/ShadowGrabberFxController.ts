import { Engine } from "@babylonjs/core/Engines/engine";
import { Light } from "@babylonjs/core/Lights/light";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type {
  BlackSmokeWrapEffect,
  BlackSmokeWrapSystem,
} from "../../BlackSmokeWrapSystem";
import type {
  ShadowGrabberFxQuality,
  ShadowGrabberPortalFxConfig,
} from "./ShadowGrabberConfig";

export type ShadowGrabberFxState =
  | "idle"
  | "hunt"
  | "alert"
  | "extend"
  | "grab"
  | "hold"
  | "retract"
  | "lightRecoil";

const PORTAL_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 worldViewProjection;

varying vec2 vUV;

void main(void) {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const PORTAL_FRAGMENT_SHADER = `
precision highp float;

uniform float time;
uniform float spawnProgress;
uniform float noiseScale;
uniform float noiseSpeed;
uniform float dissolveSoftness;
uniform float distortion;
uniform float flowSpeed;
uniform float portalIntensity;
uniform float stateChaos;
uniform float lightPulse;

varying vec2 vUV;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.55;
  mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
  for (int octave = 0; octave < 3; octave++) {
    total += valueNoise(p) * amplitude;
    p = rotation * p * 2.03 + vec2(13.1, 7.7);
    amplitude *= 0.5;
  }
#ifdef HIGH_QUALITY
  total += valueNoise(p) * amplitude;
#endif
  return total;
}

void main(void) {
  vec2 p = vUV * 2.0 - 1.0;
  float motionTime = time * noiseSpeed;
  float broad = fbm(p * noiseScale + vec2(motionTime * 0.31, -motionTime * 0.19));
  float crossing = fbm(
    p.yx * (noiseScale * 1.63) +
    vec2(-motionTime * 0.23, motionTime * 0.37) +
    broad * 1.7
  );
  vec2 warp = vec2(broad - 0.5, crossing - 0.5) * distortion;
  warp += vec2(
    sin((p.y + crossing) * 4.1 + motionTime),
    cos((p.x - broad) * 3.7 - motionTime * 0.82)
  ) * distortion * 0.14;
  vec2 warped = p + warp;

  float detail = fbm(
    warped * (noiseScale * 2.45) +
    vec2(-motionTime * 0.54, motionTime * 0.41)
  );
  float edgeNoise = (broad - 0.5) * 0.20 + (detail - 0.5) * 0.105;
  float radialDistance = length(vec2(warped.x * 0.97, warped.y * 1.035));
  float irregularRadius = 0.86 + edgeNoise;

  float stainProgress = smoothstep(0.0, 0.15, spawnProgress);
  float boundaryProgress = smoothstep(0.10, 0.35, spawnProgress);
  float volumeProgress = smoothstep(0.25, 0.60, spawnProgress);
  float patternProgress = smoothstep(0.40, 0.80, spawnProgress);
  float settleProgress = smoothstep(0.85, 1.0, spawnProgress);

  float stainRadius = mix(0.08, 0.73, stainProgress);
  float stainBoundary = stainRadius + (broad - 0.5) * 0.25;
  float stain =
    (1.0 - smoothstep(stainBoundary - 0.19, stainBoundary + 0.16, radialDistance)) *
    stainProgress;

  float formedRadius = mix(0.18, irregularRadius, boundaryProgress);
  float portalMask =
    1.0 - smoothstep(formedRadius - 0.12, formedRadius + 0.06, radialDistance);
  float rimDistance = abs(radialDistance - formedRadius);
  float rim =
    (1.0 - smoothstep(0.018, 0.115 + stateChaos * 0.025, rimDistance)) *
    boundaryProgress;

  float verticalGradient = smoothstep(-1.04, 0.78, warped.y);
  float spatialGradient =
    (1.0 - radialDistance) * 0.22 + verticalGradient * 0.16 + broad * 0.16;
  float dissolveField = mix(broad, detail, 0.48) + spatialGradient;
  float dissolveThreshold = mix(1.12, 0.19, volumeProgress);
  float softness = max(0.025, dissolveSoftness);
  float dissolve = smoothstep(
    dissolveThreshold - softness,
    dissolveThreshold + softness,
    dissolveField
  );
  float dissolveEdge =
    1.0 - smoothstep(softness * 0.35, softness * 2.1, abs(dissolveField - dissolveThreshold));

  float bandCoordinate =
    warped.y * (4.2 + stateChaos * 1.4) +
    sin(warped.x * 3.4 + broad * 4.8) * 1.35 +
    (broad - crossing) * 5.2 -
    time * flowSpeed;
  float brokenBands = 1.0 - smoothstep(
    0.10,
    0.36,
    abs(sin(bandCoordinate) + (detail - 0.5) * 0.92)
  );
  brokenBands *= smoothstep(0.24, 0.68, crossing + broad * 0.22);
  float veins = brokenBands * patternProgress * portalMask;

  float coreDensity = portalMask * dissolve;
  float spawnTurbulence = (1.0 - settleProgress) * patternProgress;
  float alpha = max(stain * 0.50, coreDensity * (0.79 + detail * 0.16));
  alpha = max(alpha, rim * (0.58 + spawnTurbulence * 0.16));
  alpha += veins * (0.10 + stateChaos * 0.055);
  alpha *= portalIntensity;

  vec3 voidBlack = vec3(0.0015, 0.0022, 0.0048);
  vec3 charcoal = vec3(0.010, 0.0125, 0.020);
  vec3 coldViolet = vec3(0.030, 0.034, 0.052);
  vec3 twilight = vec3(0.090, 0.105, 0.165);
  float innerLight =
    pow(clamp(1.0 - radialDistance / max(formedRadius, 0.08), 0.0, 1.0), 2.1) *
    coreDensity;
  float livingLight =
    (innerLight * 0.56 + rim * 0.25 + veins * 0.17 + dissolveEdge * 0.08) *
    lightPulse;
  vec3 color = mix(voidBlack, charcoal, detail * 0.64 + veins * 0.18);
  color = mix(color, coldViolet, rim * 0.17 + dissolveEdge * 0.075);
  color += coldViolet * veins * (0.055 + stateChaos * 0.025);
  color += twilight * livingLight * (0.30 + stateChaos * 0.07);
  alpha *= 0.88 + lightPulse * 0.12;

  if (alpha < 0.003) discard;
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.96));
}
`;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number) {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

/** Shader-driven portal advanced by EnemyManager, never by its own observer. */
export class ShadowGrabberFxController {
  private readonly portalSurface: Mesh;
  private readonly portalShader: ShaderMaterial;
  private readonly portalLight: PointLight;
  private readonly smoke: BlackSmokeWrapEffect;
  private requestedEnabled = true;
  private ownerEnabled = true;
  private active = false;
  private state: ShadowGrabberFxState = "idle";
  private elapsed = 0;
  private spawnElapsed = 0;
  private spawnProgressValue = 0;
  private spawning = true;

  public constructor(
    scene: Scene,
    private readonly root: TransformNode,
    portalMesh: AbstractMesh,
    private readonly quality: Exclude<ShadowGrabberFxQuality, "off">,
    smokeSystem: BlackSmokeWrapSystem,
    private readonly config: ShadowGrabberPortalFxConfig
  ) {
    const bounds = portalMesh.getBoundingInfo().boundingBox;
    const rawSize = bounds.maximum.subtract(bounds.minimum);
    const rawCenter = bounds.maximum.add(bounds.minimum).scale(0.5);
    const portalSize = new Vector3(
      rawSize.x * Math.abs(portalMesh.scaling.x),
      rawSize.y * Math.abs(portalMesh.scaling.y),
      rawSize.z * Math.abs(portalMesh.scaling.z)
    );
    const portalCenter = new Vector3(
      rawCenter.x * portalMesh.scaling.x,
      rawCenter.y * portalMesh.scaling.y,
      rawCenter.z * portalMesh.scaling.z
    );
    const portalDiameter = Math.max(portalSize.y, portalSize.z);
    const portalRadius = portalDiameter * 0.5;

    this.portalShader = this.createPortalMaterial(scene);
    this.portalSurface = this.createPortalSurface(
      scene,
      portalMesh,
      portalDiameter,
      portalSize.x,
      portalCenter
    );
    this.portalLight = this.createPortalLight(
      scene,
      portalDiameter,
      portalSize.x,
      portalCenter
    );

    // BlackSmokeWrap remains a sparse volumetric silhouette around the shader,
    // not the primary portal. Its emission is ramped by the same spawn progress.
    this.smoke = smokeSystem.attach(root, {
      name: `${root.name}:portalSmoke`,
      quality: quality === "high" ? "high" : "low",
      axis: Vector3.Right(),
      radiusX: portalRadius * 1.06,
      radiusZ: portalRadius,
      innerRadiusRatio: 0.82,
      height: portalRadius * 0.34,
      particleSize: quality === "high" ? 0.25 : 0.29,
      elongation: 1.34,
      orbitSpeed: 0.86,
      upwardDrift: -0.015,
      density: quality === "high" ? 0.82 : 0.64,
      opacity: 0.62,
      color: new Color3(0.012, 0.014, 0.022),
      applyFog: false,
      enabled: false,
    });
    this.smoke.setEmissionMultiplier(0);
    this.syncEnabled();
    this.applyShaderUniforms();
  }

  public get spawnProgress() {
    return this.spawnProgressValue;
  }

  public playSpawn() {
    this.spawnElapsed = 0;
    this.spawnProgressValue = 0;
    this.spawning = true;
    this.smoke.setEmissionMultiplier(0);
    this.portalLight.intensity = 0;
    this.applyShaderUniforms();
  }

  public setState(state: ShadowGrabberFxState) {
    if (this.state === state) return;
    this.state = state;
    if (state === "extend" && this.active) this.smoke.emitBurst(3);
  }

  public setEnabled(enabled: boolean) {
    if (this.requestedEnabled === enabled) return;
    this.requestedEnabled = enabled;
    this.syncEnabled();
  }

  public setOwnerEnabled(enabled: boolean) {
    if (this.ownerEnabled === enabled) return;
    this.ownerEnabled = enabled;
    this.syncEnabled();
  }

  public update(dt: number) {
    if (!this.active) return;
    const safeDt = Math.max(0, Math.min(0.1, dt));
    const speed = this.getStateSpeed();
    const flowDirection = this.state === "retract" || this.state === "lightRecoil" ? -1 : 1;
    this.elapsed += safeDt * speed * flowDirection;

    if (this.spawning) {
      const duration = Math.max(0.05, this.config.spawnDuration);
      this.spawnElapsed = Math.min(duration, this.spawnElapsed + safeDt);
      this.spawnProgressValue = this.spawnElapsed / duration;
      this.spawning = this.spawnElapsed < duration;
    }

    const chaos = this.getStateChaos();
    const lightPulse = this.getLightPulse(chaos);
    this.portalShader.setFloat("time", this.elapsed);
    this.portalShader.setFloat("spawnProgress", this.spawnProgressValue);
    this.portalShader.setFloat("stateChaos", chaos);
    this.portalShader.setFloat("lightPulse", lightPulse);

    const boundaryProgress = smoothstep01((this.spawnProgressValue - 0.1) / 0.25);
    const scale = 0.34 + boundaryProgress * 0.66;
    this.portalSurface.scaling.setAll(scale);

    const smokeFormation = smoothstep01((this.spawnProgressValue - 0.25) / 0.35);
    const stateEmission =
      this.state === "lightRecoil"
        ? 1.2
        : this.state === "hunt"
          ? 1.08
          : this.state === "alert"
            ? 1.16
            : this.state === "extend"
              ? 1.25
              : this.state === "retract"
                ? 0.6
                : 0.86;
    this.smoke.setEmissionMultiplier(smokeFormation * stateEmission);

    const lightFormation = smoothstep01((this.spawnProgressValue - 0.1) / 0.5);
    this.portalLight.intensity =
      Math.max(0, this.config.lightIntensity) *
      clamp01(this.config.portalIntensity) *
      lightFormation *
      (0.08 + lightPulse * 0.92) *
      this.getStateLightMultiplier();
  }

  public dispose() {
    this.smoke.dispose();
    this.portalLight.dispose();
    this.portalSurface.dispose(false, false);
    this.portalShader.dispose(false, false);
  }

  private syncEnabled() {
    const active = this.requestedEnabled && this.ownerEnabled;
    if (this.active === active) return;
    this.active = active;
    this.portalSurface.setEnabled(active);
    this.portalLight.setEnabled(active);
    this.smoke.setEnabled(active);
    if (!active) {
      this.portalLight.intensity = 0;
      this.smoke.setEmissionMultiplier(0);
    }
  }

  private applyShaderUniforms() {
    this.portalShader.setFloat("time", this.elapsed);
    this.portalShader.setFloat("spawnProgress", this.spawnProgressValue);
    this.portalShader.setFloat("noiseScale", Math.max(0.1, this.config.noiseScale));
    this.portalShader.setFloat("noiseSpeed", Math.max(0, this.config.noiseSpeed));
    this.portalShader.setFloat(
      "dissolveSoftness",
      Math.max(0.025, this.config.dissolveSoftness)
    );
    this.portalShader.setFloat("distortion", Math.max(0, this.config.distortion));
    this.portalShader.setFloat("flowSpeed", Math.max(0, this.config.flowSpeed));
    this.portalShader.setFloat(
      "portalIntensity",
      clamp01(this.config.portalIntensity)
    );
    this.portalShader.setFloat("stateChaos", this.getStateChaos());
    this.portalShader.setFloat("lightPulse", 0);
  }

  private getStateSpeed() {
    switch (this.state) {
      case "hunt":
        return 1.28;
      case "alert":
        return 1.42;
      case "extend":
        return 1.62;
      case "grab":
        return 1.32;
      case "hold":
        return 0.76;
      case "retract":
        return 0.82;
      case "lightRecoil":
        return 1.18;
      default:
        return 0.86;
    }
  }

  private getStateChaos() {
    switch (this.state) {
      case "alert":
        return 0.46;
      case "extend":
        return 0.62;
      case "grab":
        return 0.38;
      case "retract":
        return 0.32;
      case "lightRecoil":
        return 0.72;
      case "hunt":
        return 0.24;
      default:
        return 0.08;
    }
  }

  private getLightPulse(chaos: number) {
    const pulseSpeed = Math.max(0.05, this.config.lightPulseSpeed);
    const primary = Math.sin(this.elapsed * pulseSpeed * 1.7);
    const secondary = Math.sin(this.elapsed * pulseSpeed * 0.63 + 1.83);
    let pulse = clamp01(0.48 + primary * 0.31 + secondary * 0.14);
    if (this.state === "lightRecoil") {
      const disrupted = 0.5 + Math.sin(this.elapsed * 19.0) * 0.5;
      pulse *= 0.28 + disrupted * 0.62;
    }
    return clamp01(pulse + chaos * 0.045);
  }

  private getStateLightMultiplier() {
    switch (this.state) {
      case "alert":
        return 1.28;
      case "extend":
        return 1.42;
      case "grab":
        return 1.16;
      case "hunt":
        return 1.1;
      case "hold":
        return 0.88;
      case "retract":
        return 0.58;
      case "lightRecoil":
        return 0.72;
      default:
        return 0.92;
    }
  }

  private createPortalMaterial(scene: Scene) {
    const material = new ShaderMaterial(
      `${this.root.name}:proceduralPortalMaterial`,
      scene,
      {
        vertexSource: PORTAL_VERTEX_SHADER,
        fragmentSource: PORTAL_FRAGMENT_SHADER,
      },
      {
        attributes: ["position", "uv"],
        uniforms: [
          "worldViewProjection",
          "time",
          "spawnProgress",
          "noiseScale",
          "noiseSpeed",
          "dissolveSoftness",
          "distortion",
          "flowSpeed",
          "portalIntensity",
          "stateChaos",
          "lightPulse",
        ],
        defines: this.quality === "high" ? ["#define HIGH_QUALITY"] : [],
        needAlphaBlending: true,
      }
    );
    material.alphaMode = Engine.ALPHA_COMBINE;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.needDepthPrePass = false;
    return material;
  }

  private createPortalSurface(
    scene: Scene,
    source: AbstractMesh,
    diameter: number,
    depth: number,
    center: Vector3
  ) {
    const surface = MeshBuilder.CreateDisc(
      `${this.root.name}:proceduralPortal`,
      {
        radius: diameter * 0.62,
        tessellation: this.quality === "high" ? 56 : 36,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene
    );
    surface.parent = this.root;
    surface.position.copyFrom(center);
    surface.position.x += Math.max(depth * 0.72, diameter * 0.072);
    surface.rotation.y = Math.PI * 0.5;
    surface.material = this.portalShader;
    surface.layerMask = source.layerMask;
    surface.renderingGroupId = source.renderingGroupId;
    surface.isPickable = false;
    surface.scaling.setAll(0.34);
    return surface;
  }

  private createPortalLight(
    scene: Scene,
    diameter: number,
    depth: number,
    center: Vector3
  ) {
    const light = new PointLight(
      `${this.root.name}:twilightLight`,
      center.clone(),
      scene
    );
    light.parent = this.root;
    light.position.x += Math.max(depth * 0.9, diameter * 0.1);
    light.diffuse = new Color3(0.16, 0.19, 0.3);
    light.specular = new Color3(0.035, 0.045, 0.08);
    light.intensity = 0;
    light.range = Math.max(0.5, this.config.lightRange);
    light.radius = Math.max(0.02, diameter * 0.045);
    light.falloffType = Light.FALLOFF_STANDARD;
    light.renderPriority = 1;
    return light;
  }
}
