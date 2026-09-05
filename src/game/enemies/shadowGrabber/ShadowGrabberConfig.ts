export const SHADOW_GRABBER_TYPE = "shadow-grabber" as const;
export const SHADOW_GRABBER_MODEL_URL =
  "/assets/models/enemies/shadow_grabber.glb";

export type ShadowGrabberAnimation =
  | "idle"
  | "alert"
  | "extend"
  | "grab"
  | "hold"
  | "retract"
  | "lightRecoil";

export type ShadowGrabberFxQuality = "off" | "low" | "high";

export enum ShadowGrabberState {
  Idle = "idle",
  Alert = "alert",
  Extending = "extending",
  Grabbing = "grabbing",
  Holding = "holding",
  Retracting = "retracting",
  LightRecoil = "light-recoil",
}

export interface ShadowGrabberMaterialConfig {
  albedo: readonly [number, number, number];
  metallic: number;
  roughness: number;
  environmentIntensity: number;
}

export interface ShadowGrabberConfig {
  modelUrl: string;
  baseScale: number;
  fxQuality: ShadowGrabberFxQuality;
  portalRotationSpeed: number;
  animationSpeed: Record<ShadowGrabberAnimation, number>;
  animationLoop: Record<ShadowGrabberAnimation, boolean>;
  animationGroupNames: Record<ShadowGrabberAnimation, string>;
  nodeNames: {
    armatureRoot: string;
    armMesh: string;
    portalMesh: string;
    skeleton: string;
    attackPointBone: string;
  };
  armMaterial: ShadowGrabberMaterialConfig;
  portalMaterial: ShadowGrabberMaterialConfig;
  runningDetectionBonus: number;
  activationRange: number;
  deactivationRange: number;
  attackRange: number;
  grabRange: number;
  idleSpeed: number;
  idlePatrolRadius: number;
  idlePatrolAngularSpeed: number;
  huntSpeed: number;
  encircleSpeed: number;
  lightRetreatSpeed: number;
  maxMoveSpeed: number;
  acceleration: number;
  deceleration: number;
  turnSpeed: number;
  pressureStandoffDistance: number;
  predictionTimeMin: number;
  predictionTimeMax: number;
  predictionMaxDistance: number;
  flankerLateralDistance: number;
  flankerForwardDistance: number;
  hoverHeightMin: number;
  hoverHeightMax: number;
  hoverBobAmplitude: number;
  hoverBobFrequency: number;
  tacticalUpdateHz: number;
  roleReassignmentIntervalIdle: number;
  roleReassignmentIntervalActive: number;
  roleActivityHysteresisSeconds: number;
  separationRadius: number;
  separationStrength: number;
  returnToAnchorDelay: number;
  anchorArrivalRadius: number;
  hardLightAvoidanceRadius: number;
  softLightAvoidanceRadius: number;
  flashlightRange: number;
  flashlightOuterAngle: number;
  flashlightSlowFactor: number;
  flashlightExposureThreshold: number;
  flashlightExposureDecay: number;
  lightRecoilCooldown: number;
  lightRecoilDuration: number;
  darknessPressureRampSeconds: number;
  darknessPressureDecaySeconds: number;
  legTargetHeightFactor: number;
  legTargetLeadTime: number;
  attackForwardAxis: readonly [number, number];
  telegraphDuration: number;
  aimLockLeadTime: number;
  extendDuration: number;
  grabDuration: number;
  maxHoldDuration: number;
  retractDuration: number;
  attackCooldownMin: number;
  attackCooldownMax: number;
  groupAttackCooldown: number;
  maxConcurrentAttacks: number;
  grabHitRadius: number;
  grabActiveWindowStart: number;
  grabActiveWindowEnd: number;
  grabSanityDrainPerSecond: number;
  grabBreakDistance: number;
  grabMovementMultiplier: number;
  grabPullSpeed: number;
  obstacleProbeDistance: number;
  obstacleAvoidanceAngle: number;
  maxDistanceFromAnchor: number;
}

export type ShadowGrabberConfigOverrides = Partial<
  Omit<
    ShadowGrabberConfig,
    | "animationSpeed"
    | "animationLoop"
    | "animationGroupNames"
    | "nodeNames"
    | "armMaterial"
    | "portalMaterial"
  >
> & {
  animationSpeed?: Partial<Record<ShadowGrabberAnimation, number>>;
  animationLoop?: Partial<Record<ShadowGrabberAnimation, boolean>>;
  animationGroupNames?: Partial<Record<ShadowGrabberAnimation, string>>;
  nodeNames?: Partial<ShadowGrabberConfig["nodeNames"]>;
  armMaterial?: Partial<ShadowGrabberMaterialConfig>;
  portalMaterial?: Partial<ShadowGrabberMaterialConfig>;
};

export const SHADOW_GRABBER_STATE_ANIMATION: Readonly<
  Record<ShadowGrabberState, ShadowGrabberAnimation>
> = {
  [ShadowGrabberState.Idle]: "idle",
  [ShadowGrabberState.Alert]: "alert",
  [ShadowGrabberState.Extending]: "extend",
  [ShadowGrabberState.Grabbing]: "grab",
  [ShadowGrabberState.Holding]: "hold",
  [ShadowGrabberState.Retracting]: "retract",
  [ShadowGrabberState.LightRecoil]: "lightRecoil",
};

export const DEFAULT_SHADOW_GRABBER_CONFIG: Readonly<ShadowGrabberConfig> = {
  modelUrl: SHADOW_GRABBER_MODEL_URL,
  // Calibrated in-game Shadow Grabber scale. Do not normalize the GLB again.
  baseScale: 3.9,
  fxQuality: "low",
  portalRotationSpeed: 0.18,
  animationSpeed: {
    idle: 1,
    alert: 1.15,
    // Kept from the previous in-game playtest: the authored strike felt too slow at 1x.
    extend: 1.3,
    grab: 1.12,
    hold: 1,
    retract: 1.1,
    lightRecoil: 1,
  },
  animationLoop: {
    idle: true,
    alert: false,
    extend: false,
    grab: false,
    hold: true,
    retract: false,
    lightRecoil: false,
  },
  animationGroupNames: {
    idle: "AS_Idle",
    alert: "AS_Alert",
    extend: "AS_Extend",
    grab: "AS_Grab",
    hold: "AS_Hold",
    retract: "AS_Retract",
    lightRecoil: "AS_LightRecoil",
  },
  nodeNames: {
    armatureRoot: "ShadowArm_Rig",
    armMesh: "ShadowArm_Main",
    portalMesh: "ShadowOrb_Core",
    skeleton: "ShadowArm_Rig",
    attackPointBone: "Middle_04",
  },
  armMaterial: {
    albedo: [0.006, 0.011, 0.024],
    metallic: 0,
    roughness: 0.4,
    environmentIntensity: 0.45,
  },
  portalMaterial: {
    albedo: [0.0015, 0.001, 0.004],
    metallic: 0,
    roughness: 0.72,
    environmentIntensity: 0.22,
  },
  // Running is audible from farther away; walking retains the base range.
  runningDetectionBonus: 14,
  activationRange: 40,
  deactivationRange: 96,
  attackRange: 5.6,
  grabRange: 3.5,
  // Player walk/run are 2.8/6.8. Hunters can close on a sprint in darkness,
  // while candles and the flashlight still reduce their effective speed.
  idleSpeed: 0.52,
  idlePatrolRadius: 1.15,
  idlePatrolAngularSpeed: 0.16,
  huntSpeed: 7.55,
  encircleSpeed: 6.9,
  lightRetreatSpeed: 5.2,
  maxMoveSpeed: 7.8,
  acceleration: 12.5,
  deceleration: 10,
  turnSpeed: 6.4,
  pressureStandoffDistance: 2.9,
  predictionTimeMin: 0.9,
  predictionTimeMax: 1.85,
  predictionMaxDistance: 13.5,
  flankerLateralDistance: 4.6,
  flankerForwardDistance: 2.8,
  hoverHeightMin: 0.55,
  hoverHeightMax: 0.85,
  hoverBobAmplitude: 0.055,
  hoverBobFrequency: 0.72,
  tacticalUpdateHz: 8,
  roleReassignmentIntervalIdle: 6,
  roleReassignmentIntervalActive: 2.2,
  roleActivityHysteresisSeconds: 0.8,
  separationRadius: 5.5,
  separationStrength: 1.15,
  returnToAnchorDelay: 5,
  anchorArrivalRadius: 0.45,
  hardLightAvoidanceRadius: 7,
  softLightAvoidanceRadius: 13,
  flashlightRange: 48,
  flashlightOuterAngle: Math.PI / 4.6,
  flashlightSlowFactor: 0.58,
  flashlightExposureThreshold: 1.15,
  flashlightExposureDecay: 0.8,
  lightRecoilCooldown: 3.5,
  lightRecoilDuration: 1.15,
  darknessPressureRampSeconds: 16,
  darknessPressureDecaySeconds: 5,
  legTargetHeightFactor: 0.28,
  legTargetLeadTime: 0.16,
  // In Babylon's imported pose the palm projects from the portal toward local -X.
  attackForwardAxis: [-1, 0],
  telegraphDuration: 0.48,
  aimLockLeadTime: 0.1,
  extendDuration: 0.36,
  grabDuration: 0.34,
  maxHoldDuration: 2.25,
  retractDuration: 0.7,
  attackCooldownMin: 1.2,
  attackCooldownMax: 2,
  groupAttackCooldown: 0.42,
  maxConcurrentAttacks: 1,
  grabHitRadius: 1.15,
  grabActiveWindowStart: 0.12,
  grabActiveWindowEnd: 0.96,
  grabSanityDrainPerSecond: 0.08,
  grabBreakDistance: 5.6,
  grabMovementMultiplier: 0.68,
  grabPullSpeed: 0.38,
  obstacleProbeDistance: 1.2,
  obstacleAvoidanceAngle: Math.PI / 5,
  // Roughly two and a half 70-unit segments: an alerted grabber can keep
  // pursuing well beyond its authored encounter without roaming forever.
  maxDistanceFromAnchor: 175,
};

export function createShadowGrabberConfig(
  overrides: ShadowGrabberConfigOverrides = {}
): ShadowGrabberConfig {
  return {
    ...DEFAULT_SHADOW_GRABBER_CONFIG,
    ...overrides,
    animationSpeed: {
      ...DEFAULT_SHADOW_GRABBER_CONFIG.animationSpeed,
      ...overrides.animationSpeed,
    },
    animationLoop: {
      ...DEFAULT_SHADOW_GRABBER_CONFIG.animationLoop,
      ...overrides.animationLoop,
    },
    animationGroupNames: {
      ...DEFAULT_SHADOW_GRABBER_CONFIG.animationGroupNames,
      ...overrides.animationGroupNames,
    },
    nodeNames: {
      ...DEFAULT_SHADOW_GRABBER_CONFIG.nodeNames,
      ...overrides.nodeNames,
    },
    armMaterial: {
      ...DEFAULT_SHADOW_GRABBER_CONFIG.armMaterial,
      ...overrides.armMaterial,
    },
    portalMaterial: {
      ...DEFAULT_SHADOW_GRABBER_CONFIG.portalMaterial,
      ...overrides.portalMaterial,
    },
  };
}
