import type { EnemyManager } from "../core/EnemyManager";
import type { EnemySpawnOptions } from "../core/EnemyTypes";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { RinaController } from "./RinaController";
import {
  RINA_MODEL_URL,
  RINA_TYPE,
  createRinaConfig,
  type RinaConfig,
} from "./RinaConfig";

export interface RinaSpawnOptions extends EnemySpawnOptions {
  type: typeof RINA_TYPE;
  configOverrides?: Partial<RinaConfig>;
}

export function registerRina(
  manager: EnemyManager,
  overrides: Partial<RinaConfig> = {},
  getPlayerPosition?: () => Vector3
) {
  manager.registerType({
    type: RINA_TYPE,
    assetUrl: RINA_MODEL_URL,
    create: (context, options) => {
      const spawnOptions = options as RinaSpawnOptions;
      const config = createRinaConfig({ ...overrides, ...spawnOptions.configOverrides });
      return new RinaController(context, options, config, getPlayerPosition);
    },
  });
}

export async function spawnRina(manager: EnemyManager, options: RinaSpawnOptions) {
  return (await manager.spawn(options)) as RinaController;
}

export { RinaController } from "./RinaController";
export {
  RINA_NLA_ACTIONS,
  RinaAnimationController,
  type RinaNlaAction,
  type RinaPlayOptions,
} from "./RinaAnimations";
export {
  RINA_FACIAL_SHAPE_KEYS,
  RinaFacialExpressions,
} from "./RinaFacialExpressions";
export {
  RINA_DEFAULT_HEIGHT,
  RINA_DEFAULT_MAX_HEALTH,
  RINA_MODEL_URL,
  RINA_SOURCE_HEIGHT,
  RINA_TYPE,
  createRinaConfig,
  type RinaConfig,
} from "./RinaConfig";
