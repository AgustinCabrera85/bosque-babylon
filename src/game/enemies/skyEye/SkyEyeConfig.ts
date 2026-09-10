export const SKY_EYE_TYPE = "sky-eye" as const;
export const SKY_EYE_MODEL_URL =
  "/assets/models/enemies/Ojo_del_cielo_Animated.glb";

export type SkyEyeConfig = {
  modelUrl: string;
  baseScale: number;
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
  Omit<SkyEyeConfig, "animationGroupNames" | "nodeNames">
> & {
  animationGroupNames?: Partial<SkyEyeConfig["animationGroupNames"]>;
  nodeNames?: Partial<SkyEyeConfig["nodeNames"]>;
};

export const DEFAULT_SKY_EYE_CONFIG: Readonly<SkyEyeConfig> = {
  modelUrl: SKY_EYE_MODEL_URL,
  baseScale: 4.25,
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
