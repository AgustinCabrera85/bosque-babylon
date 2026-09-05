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
  moveSpeed: number;
  stalkSpeed: number;
  encircleSpeed: number;
  retreatSpeed: number;
  maxMoveSpeed: number;
  acceleration: number;
  deceleration: number;
  turnSpeed: number;
  hoverHeightMin: number;
  hoverHeightMax: number;
  hoverBobAmplitude: number;
  hoverBobFrequency: number;
  tacticalUpdateHz: number;
  roleReassignmentSeconds: number;
  separationRadius: number;
  separationStrength: number;
  returnToAnchorDelay: number;
  anchorArrivalRadius: number;
  safeLightHardRadius: number;
  safeLightSoftRadius: number;
  flashlightRange: number;
  flashlightOuterAngle: number;
  flashlightSlowFactor: number;
  flashlightExposureThreshold: number;
  flashlightExposureDecay: number;
  lightRecoilCooldown: number;
  lightRecoilDuration: number;
  legTargetHeightFactor: number;
  legTargetLeadTime: number;
  attackForwardAxis: readonly [number, number];
  telegraphDuration: number;
  aimLockLeadTime: number;
  extendDuration: number;
  grabDuration: number;
  holdDuration: number;
  retractDuration: number;
  attackCooldown: number;
  grabHitRadius: number;
  grabActiveWindowStart: number;
  grabActiveWindowEnd: number;
  sanityDrainPerSecond: number;
  grabSanityDrainPerSecond: number;
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
  baseScale: 3.5,
  portalRotationSpeed: 0.18,
  animationSpeed: {
    idle: 1,
    alert: 1.15,
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
  moveSpeed: 0.45,
  stalkSpeed: 0.62,
  encircleSpeed: 0.68,
  retreatSpeed: 0.8,
  maxMoveSpeed: 0.85,
  acceleration: 0.9,
  deceleration: 1.05,
  turnSpeed: 5.2,
  hoverHeightMin: 0.55,
  hoverHeightMax: 0.85,
  hoverBobAmplitude: 0.055,
  hoverBobFrequency: 0.72,
  tacticalUpdateHz: 6,
  roleReassignmentSeconds: 3.2,
  separationRadius: 5.5,
  separationStrength: 1.15,
  returnToAnchorDelay: 2.5,
  anchorArrivalRadius: 0.45,
  safeLightHardRadius: 7,
  safeLightSoftRadius: 13,
  flashlightRange: 48,
  flashlightOuterAngle: Math.PI / 4.6,
  flashlightSlowFactor: 0.58,
  flashlightExposureThreshold: 1.15,
  flashlightExposureDecay: 0.8,
  lightRecoilCooldown: 3.5,
  lightRecoilDuration: 1.15,
  legTargetHeightFactor: 0.28,
  legTargetLeadTime: 0.16,
  // In Babylon's imported pose the palm projects from the portal toward local -X.
  attackForwardAxis: [-1, 0],
  telegraphDuration: 0.56,
  aimLockLeadTime: 0.13,
  extendDuration: 0.39,
  grabDuration: 0.34,
  holdDuration: 2.25,
  retractDuration: 0.7,
  attackCooldown: 2.4,
  grabHitRadius: 1,
  grabActiveWindowStart: 0.12,
  grabActiveWindowEnd: 0.96,
  sanityDrainPerSecond: 2,
  grabSanityDrainPerSecond: 0.08,
  maxDistanceFromAnchor: 16,
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
