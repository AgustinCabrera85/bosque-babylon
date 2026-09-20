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
uniform float shadowMotionStrength;
uniform float vortexSpeed;
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
  float broad = fbm(
    p * noiseScale +
    vec2(motionTime * (0.21 + shadowMotionStrength * 0.08), -motionTime * 0.15)
  );
  float crossing = fbm(
    p.yx * (noiseScale * 1.51) +
    vec2(-motionTime * 0.17, motionTime * (0.23 + shadowMotionStrength * 0.07)) +
    broad * 1.45
  );
  float livingPulse = 0.5 + 0.5 * sin(
    time * (0.34 + noiseSpeed * 0.22) + (broad - crossing) * 1.6
  );
  float motionAmount = shadowMotionStrength * (0.82 + livingPulse * 0.18);
  vec2 warp =
    vec2(broad - 0.5, crossing - 0.5) *
    distortion *
    (0.78 + motionAmount * 0.68);
  warp += vec2(
    crossing - fbm(p * 0.93 - motionTime * 0.12),
    broad - fbm(p.yx * 1.07 + motionTime * 0.095)
  ) * distortion * (0.25 + motionAmount * 0.15);
  vec2 warped = p + warp;
  float radialDistance = length(vec2(warped.x * 0.96, warped.y * 1.035));
  vec2 radialDirection = warped / max(radialDistance, 0.001);

  // Radius-dependent twist keeps the field storm-like instead of spinning as a disc.
  float vortexEnvelope =
    smoothstep(0.10, 0.54, radialDistance) *
    (1.0 - smoothstep(0.96, 1.34, radialDistance));
  float vortexAngle =
    time * vortexSpeed * (0.055 + statePull * 0.095) * vortexEnvelope +
    (broad - crossing) * motionAmount * 0.24;
  float vortexCos = cos(vortexAngle);
  float vortexSin = sin(vortexAngle);
  mat2 vortexRotation = mat2(vortexCos, -vortexSin, vortexSin, vortexCos);
  vec2 vortexCoordinates = vortexRotation * warped;
  vec2 vortexDirection = vortexRotation * radialDirection;
  vec2 vortexTangent = vec2(-vortexDirection.y, vortexDirection.x);

  float largeBoundaryNoise = fbm(
    vortexDirection * 1.72 +
    vec2(
      motionTime * (0.09 + motionAmount * 0.07),
      -motionTime * (0.065 + motionAmount * 0.045)
    ) +
    crossing * 0.58
  );
  float smallBoundaryNoise = fbm(
    vortexDirection * 5.4 +
    vortexCoordinates * 0.72 +
    vec2(-motionTime * 0.19, motionTime * 0.145)
  );
  float irregularRadius =
    0.84 +
    (largeBoundaryNoise - 0.5) * 0.24 +
    (smallBoundaryNoise - 0.5) * 0.08 -
    statePull * 0.035;

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

  float formedRadius = mix(0.14, irregularRadius, boundaryProgress);
  float signedBoundary = formedRadius - radialDistance;
  float boundaryWidth =
    0.19 +
    (smallBoundaryNoise - 0.5) * 0.085 +
    (livingPulse - 0.5) * motionAmount * 0.018;
  float softInterior = smoothstep(-0.07, boundaryWidth, signedBoundary);
  float boundaryZone =
    1.0 - smoothstep(0.012, boundaryWidth + stateChaos * 0.025, abs(signedBoundary));
  float breakupNoise = fbm(
    vortexDirection * 7.1 +
    vortexTangent * (largeBoundaryNoise - 0.5) * 2.6 +
    vortexCoordinates * 1.3 +
    vec2(motionTime * 0.16, -motionTime * 0.12)
  );
  float edgePresence = smoothstep(
    0.33 - stateChaos * 0.055,
    0.73,
    breakupNoise + largeBoundaryNoise * 0.14
  );
  float disruptionNoise = fbm(
    vortexDirection * 10.3 +
    vortexCoordinates * 1.8 +
    vec2(-motionTime * 0.27, motionTime * 0.19)
  );
  float disruption = mix(
    1.0,
    smoothstep(0.37, 0.70, disruptionNoise),
    stateChaos * 0.68
  );
  edgePresence *= disruption;
  float boundaryActivity =
    boundaryZone *
    edgePresence *
    boundaryProgress *
    (0.88 + livingPulse * motionAmount * 0.12);
  float deepInterior = smoothstep(0.035, 0.24, signedBoundary);
  float silhouetteBreakup = mix(edgePresence, 1.0, deepInterior);
  // Preserve a coherent disc while the outer boundary remains organically broken.
  float portalMask = softInterior * mix(0.46, 1.0, silhouetteBreakup);

  float verticalGradient = smoothstep(-1.04, 0.78, warped.y);
  float spatialGradient =
    (1.0 - radialDistance) * 0.22 + verticalGradient * 0.16 + broad * 0.16;
  float dissolveField = mix(broad, smallBoundaryNoise, 0.42) + spatialGradient;
  float dissolveThreshold = mix(1.12, 0.19, volumeProgress);
  float softness = max(0.025, dissolveSoftness);
  float dissolve = smoothstep(
    dissolveThreshold - softness,
    dissolveThreshold + softness,
    dissolveField
  );
  float dissolveEdge =
    1.0 - smoothstep(softness * 0.35, softness * 2.1, abs(dissolveField - dissolveThreshold));

  float normalizedRadius = radialDistance / max(formedRadius, 0.08);
  float centerQuiet = 1.0 - smoothstep(0.10, 0.36, normalizedRadius);
  float innerVortexZone =
    smoothstep(0.15, 0.34, normalizedRadius) *
    (1.0 - smoothstep(0.78, 0.99, normalizedRadius));
  float transitionZone =
    smoothstep(0.34, 0.70, normalizedRadius) *
    (1.0 - smoothstep(0.94, 1.18, normalizedRadius));

  float inwardOffset =
    time * flowSpeed * (0.20 + statePull * 0.32) * (0.82 + motionAmount * 0.28);
  vec2 inwardCoordinates =
    vortexCoordinates * (noiseScale * 1.48) +
    vortexDirection * inwardOffset +
    vortexTangent * (largeBoundaryNoise - 0.5) * 1.15;
  float inwardCoarse = fbm(
    inwardCoordinates + vec2(crossing - 0.5, broad - 0.5) * 1.3
  );
  float inwardDetail = fbm(
    inwardCoordinates * 1.83 -
    vortexDirection * inwardOffset * 0.46 +
    warp * 2.4
  );

  // Evolve the branch-generating coordinates themselves at two independent
  // rates. This changes topology before thresholding instead of merely pulsing
  // the brightness of a frozen branch map.
  float topologySlowTime = time * (0.16 + stateChaos * 0.04);
  float topologySplitTime = time * (0.38 + statePull * 0.08);
  float dischargeTime = time * (0.9 + stateChaos * 0.3);
  vec2 topologyDriftA = vec2(
    sin(topologySlowTime * 0.83),
    cos(topologySlowTime * 0.61)
  ) * 0.42;
  vec2 topologyDriftB = vec2(
    cos(topologySplitTime * 0.57 + 1.7),
    sin(topologySplitTime * 0.79 + 0.4)
  ) * 0.34;
  float topologyBendA = sin(
    topologySplitTime + normalizedRadius * 4.2 + largeBoundaryNoise * 3.1
  );
  float topologyBendB = cos(
    topologySlowTime * 1.37 - normalizedRadius * 5.1 + crossing * 3.6
  );
  float polarAngle = atan(vortexDirection.y, vortexDirection.x);

  float foldA = fbm(
    inwardCoordinates * 2.18 +
    vec2(crossing - 0.5, 0.5 - broad) * 1.65 +
    topologyDriftA +
    vortexTangent * topologyBendA * 0.22
  );
  float foldB = fbm(
    (inwardCoordinates + warp * 2.9) * 3.42 -
    vortexDirection * motionTime * 0.12 +
    topologyDriftB +
    vortexDirection * topologyBendB * 0.2
  );
  float safeFilamentThickness = max(0.008, filamentThickness);
  float primaryBranchDistance = abs(foldA - foldB);
  float evolvingThreshold = safeFilamentThickness * (
    0.82 + 0.18 * sin(
      topologySlowTime * 0.73 + polarAngle * 2.0 + smallBoundaryNoise * 2.4
    )
  );
  float primaryBranches = 1.0 - smoothstep(
    evolvingThreshold * 0.24,
    evolvingThreshold,
    primaryBranchDistance
  );
  float secondaryBranchTarget =
    0.5 +
    (inwardCoarse - 0.5) * 0.28 +
    (smallBoundaryNoise - 0.5) * 0.08 +
    sin(topologySplitTime * 0.72 + polarAngle * 4.0) * 0.045;
  float secondaryBranches = 1.0 - smoothstep(
    safeFilamentThickness * 0.16,
    safeFilamentThickness * 0.62,
    abs(foldA - secondaryBranchTarget)
  );
  float branchNetwork = max(primaryBranches, secondaryBranches * 0.5);
  float safeBandInner = clamp(filamentBandInner, 0.04, 0.72);
  float safeBandOuter = max(safeBandInner + 0.18, filamentBandOuter);
  float filamentZone =
    smoothstep(safeBandInner, safeBandInner + 0.14, normalizedRadius) *
    (1.0 - smoothstep(safeBandOuter - 0.16, safeBandOuter, normalizedRadius));
  float innerFilamentBias = 1.0 - smoothstep(0.42, 0.78, normalizedRadius);
  float partialArcMask = smoothstep(
    0.31,
    0.69,
    crossing * 0.44 + largeBoundaryNoise * 0.34 + breakupNoise * 0.22
  );
  // Independent regional phases give dominant groups different lifetimes.
  // Smooth thresholds create local fade-in/out instead of synchronized blinking.
  float regionalPhaseA = 0.5 + 0.5 * sin(
    polarAngle * 3.0 + largeBoundaryNoise * 2.8 + dischargeTime
  );
  float regionalPhaseB = 0.5 + 0.5 * sin(
    polarAngle * 5.0 - breakupNoise * 3.2 - dischargeTime * 1.47 +
    normalizedRadius * 1.7
  );
  float dominantGroupGate = smoothstep(
    0.62,
    0.82,
    regionalPhaseA * 0.68 + regionalPhaseB * 0.32
  );
  float fragmentGate = smoothstep(0.92, 0.99, regionalPhaseB) * 0.5;
  float temporalBranchGate = mix(
    0.012,
    1.0,
    max(dominantGroupGate, fragmentGate)
  );
  float segmentPhase = 0.5 + 0.5 * sin(
    dischargeTime * 2.4 - normalizedRadius * 12.0 + foldA * 17.0 + foldB * 9.0
  );
  float segmentGate = mix(0.12, 1.0, smoothstep(0.38, 0.7, segmentPhase));
  float travelingFilamentPulse = 0.5 + 0.5 * sin(
    time * filamentPulseSpeed * (1.55 + stateChaos * 0.9) -
    normalizedRadius * 11.0 +
    foldB * 16.0 +
    polarAngle * 1.5
  );
  float jumpingFilamentPulse = 0.5 + 0.5 * sin(
    time * filamentPulseSpeed * 2.35 + foldA * 18.0 - polarAngle * 4.0
  );
  float filamentPulseGate = max(
    smoothstep(0.38 - stateChaos * 0.06, 0.72, travelingFilamentPulse),
    smoothstep(0.82, 0.98, jumpingFilamentPulse) * 0.72
  );
  float filamentPulse = mix(
    1.0,
    0.12 + filamentPulseGate * 1.38,
    clamp(filamentPulseStrength, 0.0, 1.0)
  );
  float filaments =
    branchNetwork *
    filamentZone *
    mix(0.38, 1.0, innerFilamentBias) *
    mix(0.05, 1.0, partialArcMask) *
    temporalBranchGate *
    segmentGate *
    filamentPulse *
    (0.84 + boundaryActivity * 0.16) *
    patternProgress *
    filamentActivity *
    filamentIntensity;
  float visibleFilaments = clamp(filaments, 0.0, 1.0);
  float filamentCore =
    visibleFilaments *
    smoothstep(0.38, 0.8, branchNetwork) *
    (0.58 + filamentPulseGate * 0.42);

  float coreDensity = portalMask * dissolve;
  float spawnTurbulence = (1.0 - settleProgress) * patternProgress;
  float inwardShadow = mix(inwardCoarse, inwardDetail, 0.36);
  float innerPressure =
    abs(inwardCoarse - inwardDetail) * 1.4 +
    max(0.0, inwardDetail - 0.46) * 0.72;
  float vortexRidge =
    1.0 - smoothstep(0.055, 0.24, abs(inwardCoarse - inwardDetail));
  float innerEnergy =
    innerVortexZone *
    smoothstep(0.13, 0.61, innerPressure) *
    (0.38 + vortexRidge * 0.62) *
    patternProgress;
  float innerFlare =
    innerEnergy *
    innerFlareIntensity;
  float flareVisibility = clamp(
    innerFlare *
    (0.48 + flarePulse * 0.82) *
    (1.0 + stateChaos * 0.22),
    0.0,
    1.0
  );
  // A localized, irregularly breathing origin replaces the old perimeter-wide
  // electrical emphasis. Noise perturbs its edge without turning it into a ball.
  float originRhythm = 0.5 + 0.5 * sin(
    time * originPulseSpeed * 1.07 + broad * 1.7 - crossing * 0.8
  );
  float originSpike = pow(
    max(0.0, 0.5 + 0.5 * sin(
      time * originPulseSpeed * 2.41 + inwardDetail * 3.1 + stateChaos
    )),
    5.0
  );
  float originPulse = clamp(
    0.18 + originRhythm * 0.48 + originSpike * 0.52 + flarePulse * 0.16,
    0.0,
    1.0
  );
  float safeOriginRadius = clamp(originRadius, 0.06, 0.42);
  float breathingOriginRadius = safeOriginRadius * (0.82 + originPulse * 0.28);
  float originDistance = max(
    0.0,
    normalizedRadius + (inwardDetail - 0.5) * 0.09 + (inwardCoarse - 0.5) * 0.05
  );
  float originCore = 1.0 - smoothstep(
    breathingOriginRadius * 0.24,
    breathingOriginRadius,
    originDistance
  );
  float originHalo =
    (1.0 - smoothstep(
      breathingOriginRadius * 0.7,
      breathingOriginRadius * 2.35,
      originDistance
    )) *
    (1.0 - originCore * 0.34);
  float originVisibility = clamp(
    (originCore * (0.48 + originPulse * 0.82) +
      originHalo * (0.12 + originPulse * 0.34)) *
    originIntensity *
    patternProgress,
    0.0,
    1.0
  );
  float alpha = max(
    stain * 0.46,
    coreDensity * (0.88 + centerQuiet * 0.07 + inwardShadow * transitionZone * 0.045)
  );
  alpha += boundaryActivity * (0.035 + spawnTurbulence * 0.035);
  // Alpha-combine used to bury the already-dark branch color. Give the branch
  // network its own readable opacity while preserving transparent gaps.
  alpha += visibleFilaments * 0.18 + filamentCore * 0.08;
  alpha += flareVisibility * 0.045;
  alpha += originVisibility * 0.13;
  alpha *= portalIntensity;

  vec3 voidBlack = vec3(0.00035, 0.0005, 0.0011);
  vec3 charcoal = vec3(0.0065, 0.0075, 0.0125);
  vec3 coldViolet = vec3(0.020, 0.023, 0.037);
  vec3 twilight = vec3(0.044, 0.050, 0.078);
  vec3 originBlue = vec3(0.045, 0.15, 0.42);
  vec3 originPeak = vec3(0.19, 0.46, 0.94);
  vec3 spectralFilament = vec3(0.12, 0.17, 0.4);
  vec3 filamentPeak = vec3(0.42, 0.58, 1.1);
  float smokeChurn = smoothstep(
    0.22,
    0.78,
    inwardShadow + abs(inwardCoarse - inwardDetail) * 0.62
  );
  float midShadowDetail =
    (transitionZone + innerVortexZone * 0.52) *
    (0.14 + inwardShadow * 0.16 + abs(inwardCoarse - inwardDetail) * 0.12) +
    smokeChurn * transitionZone * 0.12;
  vec3 color = mix(voidBlack, charcoal, midShadowDetail);
  color = mix(color, coldViolet, flareVisibility * 0.58);
  color += twilight * flareVisibility * 0.22;
  color = mix(color, coldViolet, boundaryActivity * (0.16 + stateChaos * 0.035));
  float restrainedLight =
    (boundaryActivity * 0.24 + filaments * 0.12 + dissolveEdge * boundaryZone * 0.025) *
    lightPulse;
  color += twilight * restrainedLight * 0.14;
  float localCoreDarkness = coreDarkness * (1.0 - visibleFilaments * 0.68);
  color = mix(color, voidBlack, centerQuiet * localCoreDarkness);
  // The pressurized origin is composed after core darkening so it remains
  // localized and readable behind the emerging hand.
  color += originBlue * originHalo * (0.32 + originPulse * 0.5) * originIntensity;
  color += originPeak * originCore * (0.38 + originPulse * 0.72) * originIntensity;
  // Filaments remain as intermittent inner accents instead of the main read.
  color += spectralFilament * visibleFilaments * 0.55;
  color += filamentPeak * filamentCore * 0.35;
  alpha *= 0.94 + lightPulse * boundaryZone * 0.035;

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
    const portalRadius = portalDiameter * 0.5;
    const smokeRadius =
      portalRadius * Math.max(0.8, this.config.smokeRadiusScale);
    // The imported mesh origin is not its geometric center. Keep the annulus
    // registered to the procedural disc instead of wrapping the hand below it.
    const smokeOffset = portalCenter.clone();
    smokeOffset.x += Math.max(portalSize.x * 0.72, portalDiameter * 0.072);

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

    // A broad annular envelope overlaps the disc and reads as one contained
    // smoke body. The procedural center remains open enough for the hand/core.
    this.smoke = smokeSystem.attach(root, {
      name: `${root.name}:portalSmoke`,
      quality: quality === "high" ? "high" : "medium",
      offset: smokeOffset,
      axis: Vector3.Right(),
      radiusX: smokeRadius,
      radiusZ: smokeRadius,
      innerRadiusRatio: 0.4,
      height: smokeRadius * 0.18,
      particleSize: quality === "high" ? 0.5 : 0.56,
      elongation: 1,
      uniformParticleScale: true,
      orbitSpeed: 1.18,
      radialTurbulence: 0.22,
      orbitTurbulence: 0.42,
      churnSpeed: 1.85,
      upwardDrift: 0,
      density:
        (quality === "high" ? 1 : 0.92) *
        Math.max(0, config.smokeDensity),
      opacity: clamp01(config.smokeOpacity),
      color: new Color3(0.028, 0.03, 0.037),
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
    this.stateElapsed = 0;
    if (state === "extend" && this.active) this.smoke.emitBurst(2);
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
    this.portalShader.setFloat("time", this.elapsed);
    this.portalShader.setFloat("spawnProgress", this.spawnProgressValue);
    this.portalShader.setFloat("stateChaos", chaos);
    this.portalShader.setFloat("statePull", statePull);
    this.portalShader.setFloat("lightPulse", lightPulse);
    this.portalShader.setFloat("flarePulse", flarePulse);
    this.portalShader.setFloat("filamentActivity", filamentActivity);

    const boundaryProgress = smoothstep01((this.spawnProgressValue - 0.1) / 0.25);
    const scale = (0.34 + boundaryProgress * 0.66) * this.getStatePortalScale();
    this.portalSurface.scaling.setAll(scale);

    const smokeFormation = smoothstep01((this.spawnProgressValue - 0.25) / 0.35);
    const stateEmission =
      this.state === "lightRecoil"
        ? 1.04
        : this.state === "hunt"
          ? 0.98
          : this.state === "alert"
            ? 1.06
            : this.state === "extend"
              ? 1.12
              : this.state === "retract"
                ? 0.56
                : 0.82;
    this.smoke.setEmissionMultiplier(
      smokeFormation * stateEmission * Math.max(0, this.config.smokeIntensity)
    );

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
      "shadowMotionStrength",
      Math.max(0, this.config.shadowMotionStrength)
    );
    this.portalShader.setFloat("vortexSpeed", Math.max(0, this.config.vortexSpeed));
    this.portalShader.setFloat(
      "innerFlareIntensity",
      clamp01(this.config.innerFlareIntensity)
    );
    this.portalShader.setFloat(
      "originIntensity",
      Math.max(0, Math.min(2, this.config.originIntensity))
    );
    this.portalShader.setFloat(
      "originRadius",
      Math.max(0.06, Math.min(0.42, this.config.originRadius))
    );
    this.portalShader.setFloat(
      "originPulseSpeed",
      Math.max(0.05, this.config.originPulseSpeed)
    );
    this.portalShader.setFloat(
      "filamentIntensity",
      Math.max(0, Math.min(2.5, this.config.filamentIntensity))
    );
    this.portalShader.setFloat(
      "filamentThickness",
      Math.max(0.008, Math.min(0.28, this.config.filamentThickness))
    );
    this.portalShader.setFloat(
      "filamentPulseSpeed",
      Math.max(0.05, this.config.filamentPulseSpeed)
    );
    this.portalShader.setFloat(
      "filamentPulseStrength",
      clamp01(this.config.filamentPulseStrength)
    );
    this.portalShader.setFloat(
      "filamentBandInner",
      Math.max(0.04, Math.min(0.72, this.config.filamentBandInner))
    );
    this.portalShader.setFloat(
      "filamentBandOuter",
      Math.max(0.3, Math.min(1.3, this.config.filamentBandOuter))
    );
    this.portalShader.setFloat("filamentActivity", this.getFilamentActivity());
    this.portalShader.setFloat("coreDarkness", clamp01(this.config.coreDarkness));
    this.portalShader.setFloat(
      "portalIntensity",
      clamp01(this.config.portalIntensity)
    );
    this.portalShader.setFloat("stateChaos", this.getStateChaos());
    this.portalShader.setFloat("statePull", this.getStatePull());
    this.portalShader.setFloat("lightPulse", 0);
    this.portalShader.setFloat("flarePulse", 0);
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

  private getStatePortalScale() {
    const actionPulse = 1 - smoothstep01(this.stateElapsed / 0.34);
    switch (this.state) {
      case "extend":
        return 0.97 - actionPulse * 0.045;
      case "grab":
        return 0.955 - actionPulse * 0.055;
      case "retract":
        return 0.92 - smoothstep01(this.stateElapsed / 0.55) * 0.1;
      case "lightRecoil":
        return 0.955 + Math.sin(this.elapsed * 13.0) * 0.016;
      case "alert":
        return 0.985 + Math.sin(this.elapsed * 2.4) * 0.012;
      case "hunt":
        return 0.992 + Math.sin(this.elapsed * 1.35) * 0.008;
      default:
        return 1 + Math.sin(this.elapsed * 0.62) * 0.01;
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
          "shadowMotionStrength",
          "vortexSpeed",
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
