import {
  DEFAULT_SHADOW_GRABBER_CONFIG,
  type ShadowGrabberPortalFxConfig,
} from "../shadowGrabber/ShadowGrabberConfig";

export const SKY_EYE_TYPE = "sky-eye" as const;
export const SKY_EYE_MODEL_URL =
  "/assets/models/enemies/Ojo_del_cielo_Animated.glb";

export type SkyEyeFxQuality = "off" | "low" | "high";

export type SkyEyeConfig = {
  modelUrl: string;
  baseScale: number;
  fxQuality: SkyEyeFxQuality;
  /** Diameter of the procedural portal relative to the unchanged eye. */
  portalVisualScale: number;
  /** Portal bounds depth relative to its diameter. */
  portalDepthScale: number;
  portalFx: ShadowGrabberPortalFxConfig;
  tendrilRingScale: number;
  tendrilOrbitSpeed: number;
  tendrilMotionSpeed: number;
  lookSpeed: number;
  lookYawOffset: number;
  lookPitchOffset: number;
  maxLookPitch: number;
  blinkMinInterval: number;
  blinkMaxInterval: number;
  blinkSpeedMin: number;
  blinkSpeedMax: number;
  doubleBlinkChance: number;
  doubleBlinkMinDelay: number;
  doubleBlinkMaxDelay: number;
  animationGroupNames: {
    idle: string;
    upperBlink: string;
    lowerBlink: string;
  };
  nodeNames: {
    eyeball: string;
    upperEyelid: string;
    lowerEyelid: string;
  };
};

export type SkyEyeConfigOverrides = Partial<
  Omit<SkyEyeConfig, "animationGroupNames" | "nodeNames" | "portalFx">
> & {
  animationGroupNames?: Partial<SkyEyeConfig["animationGroupNames"]>;
  nodeNames?: Partial<SkyEyeConfig["nodeNames"]>;
  portalFx?: Partial<ShadowGrabberPortalFxConfig>;
};

export const DEFAULT_SKY_EYE_CONFIG: Readonly<SkyEyeConfig> = {
  modelUrl: SKY_EYE_MODEL_URL,
  baseScale: 4.25,
  fxQuality: "high",
  // The electric disc renders at 92% of this proxy diameter, leaving a portal
  // background a little over twice as wide as the authored eyeball.
  portalVisualScale: 2.2,
  portalDepthScale: 0.12,
  portalFx: {
    ...DEFAULT_SHADOW_GRABBER_CONFIG.portalFx,
    // Grow the electric disc first: its physical edge reaches ~3.04 eye
    // diameters, exposing the blue origin halo clearly around the eye.
    coreDiscScale: 1.5,
    // Then reduce the smoke geometry so its ~3.04-diameter outer edge lands
    // on the same dark disc border instead of forming an oversized halo.
    smokeTorusScale: 0.85,
    smokeRadiusScale: 1.65,
    smokeTubeThickness: 0.34,
  },
  tendrilRingScale: 1.72,
  tendrilOrbitSpeed: 0.82,
  tendrilMotionSpeed: 1.15,
  lookSpeed: 2.8,
  // The authored pupil is centered on the model's local +X face.
  lookYawOffset: Math.PI * 0.5,
  // Five extra degrees make the hovering eye visibly look down from above.
  lookPitchOffset: Math.PI / 36,
  maxLookPitch: Math.PI * 0.24,
  blinkMinInterval: 2.25,
  blinkMaxInterval: 6.25,
  blinkSpeedMin: 0.9,
  blinkSpeedMax: 1.12,
  doubleBlinkChance: 0.18,
  doubleBlinkMinDelay: 0.42,
  doubleBlinkMaxDelay: 0.56,
  animationGroupNames: {
    idle: "eye_tremble_idle",
    upperBlink: "Blink_normal",
    lowerBlink: "LowerEyeLid",
  },
  nodeNames: {
    eyeball: "Eyeball",
    upperEyelid: "UpperEyelid",
    lowerEyelid: "LowerEyeLid",
  },
};

export function createSkyEyeConfig(
  overrides: SkyEyeConfigOverrides = {}
): SkyEyeConfig {
  return {
    ...DEFAULT_SKY_EYE_CONFIG,
    ...overrides,
    portalFx: {
      ...DEFAULT_SKY_EYE_CONFIG.portalFx,
      ...overrides.portalFx,
    },
    animationGroupNames: {
      ...DEFAULT_SKY_EYE_CONFIG.animationGroupNames,
      ...overrides.animationGroupNames,
    },
    nodeNames: {
      ...DEFAULT_SKY_EYE_CONFIG.nodeNames,
      ...overrides.nodeNames,
    },
  };
}
