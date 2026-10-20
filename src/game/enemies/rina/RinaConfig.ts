export const RINA_TYPE = "rina" as const;
export const RINA_MODEL_URL = "/assets/models/enemies/rina/Rina_NLA_ShapeKeys.glb";

// The standing source mesh spans y = 0..0.999514 in the supplied GLB.
// Game units are metres; this scale puts her feet at the spawn position.
export const RINA_SOURCE_HEIGHT = 0.999514;
export const RINA_DEFAULT_HEIGHT = 1.75;
export const RINA_DEFAULT_MAX_HEALTH = 30;

export interface RinaConfig {
  height: number;
  maxHealth: number;
}

export function createRinaConfig(overrides: Partial<RinaConfig> = {}): RinaConfig {
  const config = {
    height: overrides.height ?? RINA_DEFAULT_HEIGHT,
    maxHealth: overrides.maxHealth ?? RINA_DEFAULT_MAX_HEALTH,
  };
  if (!Number.isFinite(config.height) || config.height <= 0) {
    throw new Error("Rina height must be a positive finite number");
  }
  if (!Number.isFinite(config.maxHealth) || config.maxHealth <= 0) {
    throw new Error("Rina maxHealth must be a positive finite number");
  }
  return config;
}
