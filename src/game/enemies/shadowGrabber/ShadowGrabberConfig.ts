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
  detectionRange: number;
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
  baseScale: 3.5,
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
  detectionRange: 18,
  activationRange: 34,
  deactivationRange: 42,
  attackRange: 5,
  grabRange: 3.5,
  // Player walk/run are 2.8/6.8: idle deceives, hunt catches walking but not running.
  idleSpeed: 0.52,
  idlePatrolRadius: 1.15,
  idlePatrolAngularSpeed: 0.16,
  huntSpeed: 3.05,
  encircleSpeed: 2.85,
  lightRetreatSpeed: 3.2,
  maxMoveSpeed: 3.2,
  acceleration: 8.2,
  deceleration: 7.2,
  turnSpeed: 5.2,
  pressureStandoffDistance: 2.9,
  predictionTimeMin: 1.2,
  predictionTimeMax: 2.8,
  predictionMaxDistance: 9.5,
  flankerLateralDistance: 4.6,
  flankerForwardDistance: 2.8,
  hoverHeightMin: 0.55,
  hoverHeightMax: 0.85,
  hoverBobAmplitude: 0.055,
  hoverBobFrequency: 0.72,
  tacticalUpdateHz: 6,
  roleReassignmentIntervalIdle: 6,
  roleReassignmentIntervalActive: 2.2,
  roleActivityHysteresisSeconds: 0.8,
  separationRadius: 5.5,
  separationStrength: 1.15,
  returnToAnchorDelay: 2.5,
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
  telegraphDuration: 0.56,
  aimLockLeadTime: 0.13,
  extendDuration: 0.39,
  grabDuration: 0.34,
  maxHoldDuration: 2.25,
  retractDuration: 0.7,
  attackCooldownMin: 1.2,
  attackCooldownMax: 2,
  groupAttackCooldown: 0.42,
  maxConcurrentAttacks: 1,
  grabHitRadius: 1,
  grabActiveWindowStart: 0.12,
  grabActiveWindowEnd: 0.96,
  grabSanityDrainPerSecond: 0.08,
  grabBreakDistance: 5.6,
  grabMovementMultiplier: 0.68,
  grabPullSpeed: 0.38,
  obstacleProbeDistance: 0.8,
  obstacleAvoidanceAngle: Math.PI / 5,
  maxDistanceFromAnchor: 56,
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
