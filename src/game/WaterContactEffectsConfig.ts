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
    splashStepDistance: 1.15,
    rippleStepDistance: 0.88,
    minimumStrength: 0.3,
    maximumStrength: 0.72,
  },
  ripple: {
    poolSize: 8,
    surfaceOffset: 0.018,
    entryDuration: 1.05,
    movementDuration: 0.78,
    exitDuration: 0.72,
    entryStartRadius: 0.18,
    entryEndRadius: 1.75,
    movementStartRadius: 0.12,
    movementEndRadius: 1.05,
    exitStartRadius: 0.16,
    exitEndRadius: 0.92,
    entryAlpha: 0.34,
    movementAlpha: 0.22,
    exitAlpha: 0.18,
  },
  droplets: {
    poolSize: 3,
    capacityPerSystem: 18,
    minCount: 5,
    maxCount: 14,
    minLifetime: 0.25,
    maxLifetime: 0.58,
    minSize: 0.035,
    maxSize: 0.11,
    gravity: -7.2,
    lateralSpread: 0.7,
    forwardInfluence: 0.28,
    minVerticalSpeed: 0.85,
    maxVerticalSpeed: 2.2,
  },
};
