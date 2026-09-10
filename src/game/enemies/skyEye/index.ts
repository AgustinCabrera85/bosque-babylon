import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EnemyManager } from "../core/EnemyManager";
import type { EnemySpawnOptions } from "../core/EnemyTypes";
import { SkyEyeController } from "./SkyEyeController";
import {
  SKY_EYE_TYPE,
  createSkyEyeConfig,
  type SkyEyeConfigOverrides,
} from "./SkyEyeConfig";

export interface SkyEyeSpawnOptions extends EnemySpawnOptions {
  type: typeof SKY_EYE_TYPE;
  getTargetPosition: () => Vector3;
  configOverrides?: SkyEyeConfigOverrides;
}

export function registerSkyEye(
  manager: EnemyManager,
  overrides: SkyEyeConfigOverrides = {}
) {
  const baseConfig = createSkyEyeConfig(overrides);
  manager.registerType({
    type: SKY_EYE_TYPE,
    assetUrl: baseConfig.modelUrl,
    create: (context, options) => {
      const spawnOptions = options as SkyEyeSpawnOptions;
      const config = createSkyEyeConfig({
        ...overrides,
        ...spawnOptions.configOverrides,
        animationGroupNames: {
          ...overrides.animationGroupNames,
          ...spawnOptions.configOverrides?.animationGroupNames,
        },
        nodeNames: {
          ...overrides.nodeNames,
          ...spawnOptions.configOverrides?.nodeNames,
        },
      });
      return new SkyEyeController(
        context,
        options,
        config,
        spawnOptions.getTargetPosition
      );
    },
  });
}

export async function spawnSkyEye(
  manager: EnemyManager,
  options: SkyEyeSpawnOptions
) {
  return (await manager.spawn(options)) as SkyEyeController;
}

export { SkyEyeController } from "./SkyEyeController";
export {
  DEFAULT_SKY_EYE_CONFIG,
  SKY_EYE_MODEL_URL,
  SKY_EYE_TYPE,
  createSkyEyeConfig,
  type SkyEyeConfig,
  type SkyEyeConfigOverrides,
} from "./SkyEyeConfig";
