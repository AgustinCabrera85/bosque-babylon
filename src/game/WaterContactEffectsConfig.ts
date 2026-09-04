export type WaterContactEffectsConfig = {
  detection: {
    enterHeightTolerance: number;
    exitHeightTolerance: number;
    exitHorizontalMargin: number;
  };
  speed: {
    minimum: number;
    maximum: number;
  };
  entry: {
    rippleStrength: number;
    secondaryRippleStrength: number;
    splashStrength: number;
  };
  exit: {
    rippleStrength: number;
  };
  movement: {
    minSpeedForEffects: number;
    maxDepthForStepEffects: number;
    splashStepDistance: number;
    rippleStepDistance: number;
    minimumStrength: number;
    maximumStrength: number;
    treadingStrengthScale: number;
    swimmingStrengthScale: number;
  };
  ripple: {
    poolSize: number;
    surfaceOffset: number;
    entryDuration: number;
    movementDuration: number;
    exitDuration: number;
    entryStartRadius: number;
    entryEndRadius: number;
    movementStartRadius: number;
    movementEndRadius: number;
    exitStartRadius: number;
    exitEndRadius: number;
    entryAlpha: number;
    movementAlpha: number;
    exitAlpha: number;
  };
  droplets: {
    poolSize: number;
    capacityPerSystem: number;
    minCount: number;
    maxCount: number;
    minLifetime: number;
    maxLifetime: number;
    minSize: number;
    maxSize: number;
    gravity: number;
    lateralSpread: number;
    forwardInfluence: number;
    minVerticalSpeed: number;
    maxVerticalSpeed: number;
  };
};

/** Central tuning for reusable character/object contact with water surfaces. */
export const WATER_CONTACT_EFFECTS_CONFIG: WaterContactEffectsConfig = {
  detection: {
    enterHeightTolerance: 0.06,
    exitHeightTolerance: 0.16,
    exitHorizontalMargin: 0.28,
  },
  speed: {
    minimum: 0.2,
    maximum: 6.8,
  },
  entry: {
    rippleStrength: 0.82,
    secondaryRippleStrength: 0.48,
    splashStrength: 0.78,
  },
  exit: {
    rippleStrength: 0.32,
  },
  movement: {
    minSpeedForEffects: 0.18,
    maxDepthForStepEffects: 1.35,
    splashStepDistance: 0.72,
    rippleStepDistance: 0.48,
    minimumStrength: 0.46,
    maximumStrength: 0.95,
    treadingStrengthScale: 0.68,
    swimmingStrengthScale: 0.86,
  },
  ripple: {
    poolSize: 12,
    surfaceOffset: 0.055,
    entryDuration: 1.18,
    movementDuration: 0.94,
    exitDuration: 0.72,
    entryStartRadius: 0.18,
    entryEndRadius: 2.2,
    movementStartRadius: 0.16,
    movementEndRadius: 1.5,
    exitStartRadius: 0.16,
    exitEndRadius: 1.15,
    entryAlpha: 0.72,
    movementAlpha: 0.62,
    exitAlpha: 0.4,
  },
  droplets: {
    poolSize: 5,
    capacityPerSystem: 28,
    minCount: 10,
    maxCount: 22,
    minLifetime: 0.28,
    maxLifetime: 0.72,
    minSize: 0.065,
    maxSize: 0.22,
    gravity: -8.1,
    lateralSpread: 0.95,
    forwardInfluence: 0.42,
    minVerticalSpeed: 1.1,
    maxVerticalSpeed: 3.5,
  },
};
