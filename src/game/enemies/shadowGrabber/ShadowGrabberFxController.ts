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
import type { BlackSmokeWrapSystem } from "../../BlackSmokeWrapSystem";
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

const SMOKE_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

uniform mat4 worldViewProjection;
uniform float time;
uniform float spawnProgress;
uniform float smokeDisplacement;
uniform float smokeTurbulence;
uniform float stateChaos;
uniform float statePull;

varying vec3 vLocalPosition;
varying vec3 vLocalNormal;
varying vec2 vUV;

void main(void) {
  float ringAngle = atan(position.z, position.x);
  float tubeAngle = uv.y * 6.28318530718;
  float formation = smoothstep(0.02, 0.36, spawnProgress);
  float churn =
    sin(ringAngle * 5.0 - time * (0.54 + statePull * 0.24)) * 0.52 +
    sin(ringAngle * 9.0 + tubeAngle * 2.0 + time * 0.37) * 0.29 +
    sin(tubeAngle * 3.0 - time * (0.63 + stateChaos * 0.32)) * 0.19;
  float breathing = 0.74 + 0.26 * sin(time * 0.46 + ringAngle * 2.0);
  float localRadius = max(length(position), 0.2);
  float displacement =
    churn *
    smokeDisplacement *
    smokeTurbulence *
    localRadius *
    breathing *
    formation *
    (0.86 + stateChaos * 0.34);
  vec3 displacedPosition = position + normal * displacement;

  vLocalPosition = displacedPosition;
  vLocalNormal = normal;
  vUV = uv;
  gl_Position = worldViewProjection * vec4(displacedPosition, 1.0);
}
`;

const SMOKE_FRAGMENT_SHADER = `
precision highp float;

uniform float time;
uniform float spawnProgress;
uniform float smokeTurbulence;
uniform float smokeOrbitSpeed;
uniform float smokeAlphaThreshold;
uniform float smokeDensity;
uniform float smokeOpacity;
uniform float smokeIntensity;
uniform float portalIntensity;
uniform float stateChaos;
uniform float statePull;

varying vec3 vLocalPosition;
varying vec3 vLocalNormal;
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

float smokeFbm(vec2 p) {
  float total = valueNoise(p) * 0.62;
  p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + vec2(7.1, 11.7);
  total += valueNoise(p) * 0.28;
#ifdef HIGH_QUALITY
  p = mat2(0.6, -0.8, 0.8, 0.6) * p * 2.01 + vec2(3.9, 17.3);
  total += valueNoise(p) * 0.13;
#endif
  return total;
}

void main(void) {
  const float TAU = 6.28318530718;
  float ringAngle = atan(vLocalPosition.z, vLocalPosition.x);
  float tubeAngle = vUV.y * TAU;
  float orbitTime = time * smokeOrbitSpeed;
  float pull = statePull * (0.18 + 0.12 * sin(tubeAngle - orbitTime));

  vec2 orbitalCoordinate = vec2(
    cos(ringAngle - orbitTime - pull),
    sin(ringAngle - orbitTime - pull)
  );
  vec2 tubeCoordinate = vec2(
    cos(tubeAngle + orbitTime * 0.47),
    sin(tubeAngle + orbitTime * 0.47)
  );
  vec2 baseCoordinate =
    orbitalCoordinate * (2.7 + smokeTurbulence * 0.8) +
    tubeCoordinate * (1.15 + smokeTurbulence * 0.62);

  float broad = smokeFbm(
    baseCoordinate + vec2(orbitTime * 0.13, -orbitTime * 0.09)
  );
  vec2 warp = vec2(
    smokeFbm(baseCoordinate * 0.83 + vec2(-orbitTime * 0.16, 5.7)),
    smokeFbm(baseCoordinate.yx * 0.91 + vec2(9.2, orbitTime * 0.12))
  ) - 0.5;
  float folded = smokeFbm(
    baseCoordinate * 1.34 +
    warp * (1.25 + smokeTurbulence * 1.15) +
    vec2(orbitTime * 0.21, -orbitTime * 0.15)
  );
  float radialFold = 0.5 + 0.5 * sin(
    tubeAngle * 2.0 - ringAngle * 3.0 + orbitTime * 0.72 + broad * 4.2
  );
  float densityField =
    broad * 0.5 +
    folded * 0.39 +
    radialFold * (0.08 + stateChaos * 0.04) +
    smokeDensity * 0.055;

  float threshold =
    smokeAlphaThreshold +
    (1.0 - smoothstep(0.0, 0.42, spawnProgress)) * 0.18 -
    stateChaos * 0.025;
  float erosion = smoothstep(threshold, threshold + 0.2, densityField);
  float denseBody = smoothstep(threshold - 0.13, threshold + 0.22, densityField);
  float formation = smoothstep(0.02, 0.38, spawnProgress);
  float surfaceFold = clamp(
    abs(dot(normalize(vLocalNormal), normalize(vLocalPosition))) * 0.25 + 0.75,
    0.0,
    1.0
  );
  float alpha =
    mix(denseBody * 0.48, erosion, 0.58) *
    surfaceFold *
    smokeOpacity *
    smokeIntensity *
    portalIntensity *
    formation;

  float foldHighlight = smoothstep(0.48, 0.86, folded);
  vec3 color = vec3(0.0025, 0.003, 0.0045);
  color += vec3(0.014, 0.016, 0.026) *
    (broad * 0.12 + foldHighlight * 0.16);

  if (alpha < 0.018) discard;
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.92));
}
`;

const CORE_VERTEX_SHADER = `
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

const CORE_FRAGMENT_SHADER = `
precision highp float;

uniform float time;
uniform float spawnProgress;
uniform float noiseScale;
uniform float noiseSpeed;
uniform float dissolveSoftness;
uniform float distortion;
uniform float flowSpeed;
uniform float innerFlareIntensity;
uniform float originIntensity;
uniform float originRadius;
uniform float originPulseSpeed;
uniform float filamentIntensity;
uniform float filamentThickness;
uniform float filamentPulseSpeed;
uniform float filamentPulseStrength;
uniform float filamentBandInner;
uniform float filamentBandOuter;
uniform float filamentActivity;
uniform float coreDarkness;
uniform float portalIntensity;
uniform float stateChaos;
uniform float statePull;
uniform float lightPulse;
uniform float flarePulse;

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

float coreFbm(vec2 p) {
  float total = valueNoise(p) * 0.62;
  p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + vec2(11.1, 4.7);
  total += valueNoise(p) * 0.28;
#ifdef HIGH_QUALITY
  p = mat2(0.6, -0.8, 0.8, 0.6) * p * 2.01 + vec2(5.4, 13.2);
  total += valueNoise(p) * 0.13;
#endif
  return total;
}

float angularDistance(float a, float b) {
  return abs(atan(sin(a - b), cos(a - b)));
}

float arcRidge(float angle, float pathAngle, float thickness) {
  return 1.0 - smoothstep(thickness * 0.22, thickness, angularDistance(angle, pathAngle));
}

void main(void) {
  vec2 p = vUV * 2.0 - 1.0;
  float motionTime = time * noiseSpeed;
  float coarse = coreFbm(
    p * noiseScale + vec2(motionTime * 0.17, -motionTime * 0.12)
  );
  float crossing = coreFbm(
    p.yx * (noiseScale * 1.36) +
    vec2(-motionTime * 0.13, motionTime * 0.19) +
    coarse * 0.72
  );
  vec2 warp = vec2(coarse - 0.5, crossing - 0.5) * distortion;
  vec2 warped = p + warp;
  float radius = length(warped);
  float angle = atan(warped.y, warped.x);

  float edgeNoise = coreFbm(
    vec2(cos(angle), sin(angle)) * 2.1 +
    vec2(motionTime * 0.08, -motionTime * 0.055)
  );
  float edgeRadius = 0.9 + (edgeNoise - 0.5) * 0.13 - statePull * 0.025;
  float softness = max(0.025, dissolveSoftness * 0.78);
  float coreMask = 1.0 - smoothstep(edgeRadius - softness, edgeRadius + softness, radius);
  float coreFormation = smoothstep(0.16, 0.5, spawnProgress);

  float vortexTime = time * flowSpeed * (0.22 + statePull * 0.18);
  float vortexNoise = coreFbm(
    warped * (noiseScale * 1.22) +
    vec2(cos(angle + vortexTime), sin(angle + vortexTime)) * 0.34
  );
  float pressure = abs(vortexNoise - crossing);

  float originRhythm = 0.5 + 0.5 * sin(
    time * originPulseSpeed + coarse * 1.7 - crossing * 0.9
  );
  float originSpike = pow(
    max(0.0, 0.5 + 0.5 * sin(
      time * originPulseSpeed * 2.37 + vortexNoise * 3.2 + stateChaos
    )),
    6.0
  );
  float originPulse = clamp(
    0.16 + originRhythm * 0.48 + originSpike * 0.58 + flarePulse * 0.2,
    0.0,
    1.0
  );
  float safeOriginRadius = clamp(originRadius, 0.06, 0.42);
  float breathingRadius = safeOriginRadius * (0.8 + originPulse * 0.3);
  float originDistance = max(0.0, radius + (vortexNoise - 0.5) * 0.07);
  float originCore = 1.0 - smoothstep(
    breathingRadius * 0.18,
    breathingRadius,
    originDistance
  );
  float originHalo =
    (1.0 - smoothstep(
      breathingRadius * 0.68,
      breathingRadius * 2.3,
      originDistance
    )) *
    (1.0 - originCore * 0.34);
  float originFormation = smoothstep(0.32, 0.66, spawnProgress);
  float originVisibility = clamp(
    (originCore * (0.44 + originPulse * 0.82) +
      originHalo * (0.1 + originPulse * 0.31)) *
    originIntensity *
    originFormation,
    0.0,
    1.0
  );

  // Three candidates are the hard upper bound. Their paths evolve before
  // thresholding, so each discharge reforms instead of blinking in place.
  float topologyTime = time * (0.31 + stateChaos * 0.09);
  vec2 topologyDrift = vec2(
    sin(topologyTime * 0.83),
    cos(topologyTime * 0.67)
  ) * 0.38;
  float topologyA = coreFbm(
    warped * 2.8 + topologyDrift + vec2(radius * 0.7, -radius * 0.4)
  );
  float topologyB = coreFbm(
    warped.yx * 3.35 - topologyDrift.yx + vec2(-radius * 0.3, radius * 0.8)
  );
  float safeThickness = clamp(filamentThickness * 0.66, 0.009, 0.12);
  float centerA = -2.12 + sin(topologyTime * 0.73) * 0.46;
  float centerB = 0.08 + sin(topologyTime * 0.91 + 2.1) * 0.58;
  float centerC = 2.18 + cos(topologyTime * 0.61 + 0.7) * 0.51;
  float pathA = centerA + (topologyA - 0.5) * 1.28 + sin(radius * 8.0 - topologyTime) * 0.09;
  float pathB = centerB + (topologyB - 0.5) * 1.34 + sin(radius * 6.4 + topologyTime * 1.2) * 0.11;
  float pathC = centerC + (topologyA - topologyB) * 1.05 + cos(radius * 7.3 - topologyTime * 0.8) * 0.1;

  float activityBias =
    stateChaos * 0.16 + max(0.0, filamentActivity - 0.72) * 0.16;
  float dischargeTime = time * filamentPulseSpeed;
  float lifeA = smoothstep(
    0.78 - activityBias,
    0.94 - activityBias * 0.25,
    0.5 + 0.5 * sin(dischargeTime * 0.43 + 0.4)
  );
  float lifeB = smoothstep(
    0.81 - activityBias,
    0.95 - activityBias * 0.24,
    0.5 + 0.5 * sin(dischargeTime * 0.37 + 2.72)
  );
  float lifeC = smoothstep(
    0.84 - activityBias,
    0.97 - activityBias * 0.22,
    0.5 + 0.5 * sin(dischargeTime * 0.31 + 4.86)
  );
  float safeBandInner = clamp(filamentBandInner, 0.04, 0.72);
  float safeBandOuter = max(safeBandInner + 0.18, filamentBandOuter);
  float electricBand =
    smoothstep(safeBandInner, safeBandInner + 0.13, radius) *
    (1.0 - smoothstep(safeBandOuter - 0.12, safeBandOuter, radius));
  float travelingPulse = mix(
    1.0,
    0.2 + 0.8 * smoothstep(
      0.35,
      0.8,
      0.5 + 0.5 * sin(dischargeTime * 1.83 - radius * 15.0 + topologyA * 5.0)
    ),
    clamp(filamentPulseStrength, 0.0, 1.0)
  );
  float arcA = arcRidge(angle, pathA, safeThickness) * lifeA;
  float arcB = arcRidge(angle, pathB, safeThickness) * lifeB;
  float arcC = arcRidge(angle, pathC, safeThickness) * lifeC;
  float branchGate = smoothstep(
    0.9,
    0.99,
    0.5 + 0.5 * sin(dischargeTime * 0.29 + 1.7)
  );
  float branch =
    arcRidge(angle, pathB + (radius - 0.32) * 0.52, safeThickness * 0.72) *
    branchGate *
    smoothstep(0.34, 0.48, radius);
  float electricity = clamp(
    max(max(arcA, arcB), max(arcC, branch * 0.64)) *
    electricBand *
    travelingPulse *
    filamentActivity *
    filamentIntensity *
    smoothstep(0.5, 0.82, spawnProgress) *
    coreMask,
    0.0,
    1.0
  );
  float electricCore = electricity * smoothstep(0.52, 0.9, electricity);

  float innerVortex =
    smoothstep(0.13, 0.48, pressure + vortexNoise * 0.18) *
    (1.0 - smoothstep(0.52, 0.92, radius)) *
    innerFlareIntensity *
    coreFormation;
  float alpha = coreMask * coreFormation * (0.83 + vortexNoise * 0.09);
  alpha += originVisibility * 0.12 + electricity * 0.18;
  alpha *= portalIntensity;

  vec3 voidBlack = vec3(0.0003, 0.00045, 0.001);
  vec3 charcoal = vec3(0.005, 0.006, 0.011);
  vec3 pressureViolet = vec3(0.021, 0.024, 0.047);
  vec3 originBlue = vec3(0.035, 0.105, 0.32);
  vec3 originPeak = vec3(0.15, 0.34, 0.82);
  vec3 arcBlue = vec3(0.07, 0.12, 0.34);
  vec3 arcPeak = vec3(0.27, 0.39, 0.92);
  vec3 color = mix(voidBlack, charcoal, vortexNoise * 0.28);
  color += pressureViolet * innerVortex * (0.18 + flarePulse * 0.17);
  color = mix(color, voidBlack, coreDarkness * (1.0 - originVisibility * 0.48));
  color += originBlue * originHalo * (0.27 + originPulse * 0.48) * originIntensity;
  color += originPeak * originCore * (0.29 + originPulse * 0.67) * originIntensity;
  color += arcBlue * electricity * 0.48;
  color += arcPeak * electricCore * (0.24 + lightPulse * 0.14);

  if (alpha < 0.008) discard;
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

/** Two-mesh procedural portal advanced by EnemyManager, never by an observer. */
export class ShadowGrabberFxController {
  private readonly smokeTorus: Mesh;
  private readonly smokeShader: ShaderMaterial;
  private readonly coreDisc: Mesh;
  private readonly coreShader: ShaderMaterial;
  private readonly portalLight: PointLight;
  private requestedEnabled = true;
  private ownerEnabled = true;
  private active = false;
  private state: ShadowGrabberFxState = "idle";
  private elapsed = 0;
  private stateElapsed = 0;
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

    this.smokeShader = this.createSmokeMaterial(scene);
    this.coreShader = this.createCoreMaterial(scene);
    this.smokeTorus = this.createSmokeTorus(
      scene,
      portalMesh,
      portalDiameter,
      portalSize.x,
      portalCenter
    );
    this.coreDisc = this.createCoreDisc(
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

    // BlackSmokeWrapSystem remains shared by other VFX, but is intentionally
    // disabled here: the torus is the primary smoke and avoids particle overdraw.
    void smokeSystem;
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
    this.portalLight.intensity = 0;
    this.applyShaderUniforms();
  }

  public setState(state: ShadowGrabberFxState) {
    if (this.state === state) return;
    this.state = state;
    this.stateElapsed = 0;
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
    this.elapsed += safeDt * speed;
    this.stateElapsed += safeDt;

    if (this.spawning) {
      const duration = Math.max(0.05, this.config.spawnDuration);
      this.spawnElapsed = Math.min(duration, this.spawnElapsed + safeDt);
      this.spawnProgressValue = this.spawnElapsed / duration;
      this.spawning = this.spawnElapsed < duration;
    }

    const chaos = this.getStateChaos();
    const statePull = this.getStatePull();
    const lightPulse = this.getLightPulse(chaos);
    const flarePulse = this.getFlarePulse(lightPulse);
    const filamentActivity = this.getFilamentActivity();
    this.smokeShader.setFloat("time", this.elapsed);
    this.smokeShader.setFloat("spawnProgress", this.spawnProgressValue);
    this.smokeShader.setFloat("stateChaos", chaos);
    this.smokeShader.setFloat("statePull", statePull);
    this.coreShader.setFloat("time", this.elapsed);
    this.coreShader.setFloat("spawnProgress", this.spawnProgressValue);
    this.coreShader.setFloat("stateChaos", chaos);
    this.coreShader.setFloat("statePull", statePull);
    this.coreShader.setFloat("lightPulse", lightPulse);
    this.coreShader.setFloat("flarePulse", flarePulse);
    this.coreShader.setFloat("filamentActivity", filamentActivity);

    const smokeFormation = smoothstep01((this.spawnProgressValue - 0.02) / 0.34);
    const coreFormation = smoothstep01((this.spawnProgressValue - 0.16) / 0.34);
    // State changes may alter churn, pull and electrical activity, but the
    // fully formed portal keeps a stable diameter while the arm animates.
    this.smokeTorus.scaling.setAll(0.58 + smokeFormation * 0.42);
    this.coreDisc.scaling.setAll(0.48 + coreFormation * 0.52);

    const lightFormation = smoothstep01((this.spawnProgressValue - 0.1) / 0.5);
    this.portalLight.intensity =
      Math.max(0, this.config.lightIntensity) *
      clamp01(this.config.portalIntensity) *
      lightFormation *
      (0.08 + lightPulse * 0.92) *
      this.getStateLightMultiplier();
  }

  public dispose() {
    this.portalLight.dispose();
    this.smokeTorus.dispose(false, false);
    this.coreDisc.dispose(false, false);
    this.smokeShader.dispose(false, false);
    this.coreShader.dispose(false, false);
  }

  private syncEnabled() {
    const active = this.requestedEnabled && this.ownerEnabled;
    if (this.active === active) return;
    this.active = active;
    this.smokeTorus.setEnabled(active);
    this.coreDisc.setEnabled(active);
    this.portalLight.setEnabled(active);
    if (!active) this.portalLight.intensity = 0;
  }

  private applyShaderUniforms() {
    this.smokeShader.setFloat("time", this.elapsed);
    this.smokeShader.setFloat("spawnProgress", this.spawnProgressValue);
    this.smokeShader.setFloat(
      "smokeTurbulence",
      Math.max(
        0,
        Math.min(
          2,
          this.config.smokeTurbulence *
            Math.max(0.1, this.config.shadowMotionStrength)
        )
      )
    );
    this.smokeShader.setFloat(
      "smokeOrbitSpeed",
      Math.max(0, this.config.smokeOrbitSpeed + this.config.vortexSpeed * 0.15)
    );
    this.smokeShader.setFloat(
      "smokeDisplacement",
      Math.max(0, Math.min(0.5, this.config.smokeDisplacement))
    );
    this.smokeShader.setFloat(
      "smokeAlphaThreshold",
      Math.max(0.1, Math.min(0.9, this.config.smokeAlphaThreshold))
    );
    this.smokeShader.setFloat("smokeDensity", Math.max(0, this.config.smokeDensity));
    this.smokeShader.setFloat("smokeOpacity", clamp01(this.config.smokeOpacity));
    this.smokeShader.setFloat("smokeIntensity", Math.max(0, this.config.smokeIntensity));
    this.smokeShader.setFloat("portalIntensity", clamp01(this.config.portalIntensity));
    this.smokeShader.setFloat("stateChaos", this.getStateChaos());
    this.smokeShader.setFloat("statePull", this.getStatePull());

    this.coreShader.setFloat("time", this.elapsed);
    this.coreShader.setFloat("spawnProgress", this.spawnProgressValue);
    this.coreShader.setFloat("noiseScale", Math.max(0.1, this.config.noiseScale));
    this.coreShader.setFloat("noiseSpeed", Math.max(0, this.config.noiseSpeed));
    this.coreShader.setFloat(
      "dissolveSoftness",
      Math.max(0.025, this.config.dissolveSoftness)
    );
    this.coreShader.setFloat("distortion", Math.max(0, this.config.distortion));
    this.coreShader.setFloat("flowSpeed", Math.max(0, this.config.flowSpeed));
    this.coreShader.setFloat(
      "innerFlareIntensity",
      clamp01(this.config.innerFlareIntensity)
    );
    this.coreShader.setFloat(
      "originIntensity",
      Math.max(0, Math.min(2, this.config.originIntensity))
    );
    this.coreShader.setFloat(
      "originRadius",
      Math.max(0.06, Math.min(0.42, this.config.originRadius))
    );
    this.coreShader.setFloat(
      "originPulseSpeed",
      Math.max(0.05, this.config.originPulseSpeed)
    );
    this.coreShader.setFloat(
      "filamentIntensity",
      Math.max(0, Math.min(2.5, this.config.filamentIntensity))
    );
    this.coreShader.setFloat(
      "filamentThickness",
      Math.max(0.008, Math.min(0.28, this.config.filamentThickness))
    );
    this.coreShader.setFloat(
      "filamentPulseSpeed",
      Math.max(0.05, this.config.filamentPulseSpeed)
    );
    this.coreShader.setFloat(
      "filamentPulseStrength",
      clamp01(this.config.filamentPulseStrength)
    );
    this.coreShader.setFloat(
      "filamentBandInner",
      Math.max(0.04, Math.min(0.72, this.config.filamentBandInner))
    );
    this.coreShader.setFloat(
      "filamentBandOuter",
      Math.max(0.3, Math.min(1.3, this.config.filamentBandOuter))
    );
    this.coreShader.setFloat("filamentActivity", this.getFilamentActivity());
    this.coreShader.setFloat("coreDarkness", clamp01(this.config.coreDarkness));
    this.coreShader.setFloat("portalIntensity", clamp01(this.config.portalIntensity));
    this.coreShader.setFloat("stateChaos", this.getStateChaos());
    this.coreShader.setFloat("statePull", this.getStatePull());
    this.coreShader.setFloat("lightPulse", 0);
    this.coreShader.setFloat("flarePulse", 0);
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
        return 1.28;
      case "lightRecoil":
        return 1.34;
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
        return 0.48;
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

  private getFlarePulse(lightPulse: number) {
    const actionPulse = 1 - smoothstep01(this.stateElapsed / 0.38);
    switch (this.state) {
      case "extend":
        return clamp01(0.18 + lightPulse * 0.34 + actionPulse * 0.46);
      case "grab":
        return clamp01(0.2 + lightPulse * 0.32 + actionPulse * 0.42);
      case "retract":
        return clamp01(0.12 + lightPulse * 0.22 + actionPulse * 0.2);
      case "lightRecoil": {
        const flicker = 0.5 + Math.sin(this.elapsed * 19.0) * 0.5;
        return clamp01(0.1 + lightPulse * 0.2 + flicker * 0.44);
      }
      case "alert":
        return clamp01(0.18 + lightPulse * 0.42);
      case "hunt":
        return clamp01(0.14 + lightPulse * 0.34);
      default:
        return clamp01(0.1 + lightPulse * 0.26);
    }
  }

  private getFilamentActivity() {
    switch (this.state) {
      case "extend":
        return 1.15;
      case "grab":
        return 1.1;
      case "lightRecoil":
        return 1.06;
      case "alert":
        return 1;
      case "hunt":
        return 0.9;
      case "retract":
        return 0.84;
      case "hold":
        return 0.8;
      default:
        return 0.76;
    }
  }

  private getStatePull() {
    switch (this.state) {
      case "extend":
        return 0.76;
      case "grab":
        return 0.84;
      case "retract":
        return 0.94;
      case "lightRecoil":
        return 0.5;
      case "alert":
        return 0.42;
      case "hunt":
        return 0.32;
      case "hold":
        return 0.32;
      default:
        return 0.22;
    }
  }

  private getStateLightMultiplier() {
    switch (this.state) {
      case "alert":
        return 1.08;
      case "extend":
        return 1.16;
      case "grab":
        return 1.08;
      case "hunt":
        return 1.04;
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

  private createSmokeMaterial(scene: Scene) {
    const material = new ShaderMaterial(
      `${this.root.name}:smokeTorusMaterial`,
      scene,
      {
        vertexSource: SMOKE_VERTEX_SHADER,
        fragmentSource: SMOKE_FRAGMENT_SHADER,
      },
      {
        attributes: ["position", "normal", "uv"],
        uniforms: [
          "worldViewProjection",
          "time",
          "spawnProgress",
          "smokeTurbulence",
          "smokeOrbitSpeed",
          "smokeDisplacement",
          "smokeAlphaThreshold",
          "smokeDensity",
          "smokeOpacity",
          "smokeIntensity",
          "portalIntensity",
          "stateChaos",
          "statePull",
        ],
        defines: this.quality === "high" ? ["#define HIGH_QUALITY"] : [],
        needAlphaBlending: true,
      }
    );
    this.configureTransparentMaterial(material);
    return material;
  }

  private createCoreMaterial(scene: Scene) {
    const material = new ShaderMaterial(
      `${this.root.name}:electricCoreMaterial`,
      scene,
      {
        vertexSource: CORE_VERTEX_SHADER,
        fragmentSource: CORE_FRAGMENT_SHADER,
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
          "innerFlareIntensity",
          "originIntensity",
          "originRadius",
          "originPulseSpeed",
          "filamentIntensity",
          "filamentThickness",
          "filamentPulseSpeed",
          "filamentPulseStrength",
          "filamentBandInner",
          "filamentBandOuter",
          "filamentActivity",
          "coreDarkness",
          "portalIntensity",
          "stateChaos",
          "statePull",
          "lightPulse",
          "flarePulse",
        ],
        defines: this.quality === "high" ? ["#define HIGH_QUALITY"] : [],
        needAlphaBlending: true,
      }
    );
    this.configureTransparentMaterial(material);
    return material;
  }

  private configureTransparentMaterial(material: ShaderMaterial) {
    material.alphaMode = Engine.ALPHA_COMBINE;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.needDepthPrePass = false;
  }

  private createSmokeTorus(
    scene: Scene,
    source: AbstractMesh,
    diameter: number,
    depth: number,
    center: Vector3
  ) {
    const geometryScale = Math.max(0.1, this.config.smokeTorusScale);
    const torus = MeshBuilder.CreateTorus(
      `${this.root.name}:smokeTorus`,
      {
        diameter:
          diameter *
          0.78 *
          Math.max(0.8, this.config.smokeRadiusScale) *
          geometryScale,
        thickness:
          diameter *
          Math.max(0.28, Math.min(0.82, this.config.smokeTubeThickness)) *
          geometryScale,
        tessellation: this.quality === "high" ? 28 : 20,
        sideOrientation: Mesh.FRONTSIDE,
      },
      scene
    );
    torus.parent = this.root;
    torus.position.copyFrom(center);
    torus.position.x += Math.max(depth * 0.72, diameter * 0.072);
    torus.rotation.z = Math.PI * 0.5;
    torus.material = this.smokeShader;
    torus.layerMask = source.layerMask;
    torus.renderingGroupId = source.renderingGroupId;
    torus.alphaIndex = 0;
    torus.isPickable = false;
    torus.scaling.setAll(0.58);
    return torus;
  }

  private createCoreDisc(
    scene: Scene,
    source: AbstractMesh,
    diameter: number,
    depth: number,
    center: Vector3
  ) {
    const geometryScale = Math.max(0.1, this.config.coreDiscScale);
    const disc = MeshBuilder.CreateDisc(
      `${this.root.name}:electricCore`,
      {
        radius: diameter * 0.46 * geometryScale,
        tessellation: this.quality === "high" ? 40 : 28,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene
    );
    disc.parent = this.root;
    disc.position.copyFrom(center);
    disc.position.x += Math.max(depth * 0.72, diameter * 0.072);
    disc.rotation.y = Math.PI * 0.5;
    disc.material = this.coreShader;
    disc.layerMask = source.layerMask;
    disc.renderingGroupId = source.renderingGroupId;
    disc.alphaIndex = 1;
    disc.isPickable = false;
    disc.scaling.setAll(0.48);
    return disc;
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
    light.diffuse = new Color3(0.075, 0.085, 0.135);
    light.specular = new Color3(0.012, 0.016, 0.028);
    light.intensity = 0;
    light.range = Math.max(0.5, this.config.lightRange);
    light.radius = Math.max(0.02, diameter * 0.045);
    light.falloffType = Light.FALLOFF_STANDARD;
    light.renderPriority = 1;
    return light;
  }
}
