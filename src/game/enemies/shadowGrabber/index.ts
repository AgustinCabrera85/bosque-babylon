import type { EnemyManager } from "../core/EnemyManager";
import type { EnemySpawnOptions } from "../core/EnemyTypes";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGrabberController } from "./ShadowGrabberController";
import {
  SHADOW_GRABBER_TYPE,
  createShadowGrabberConfig,
  type ShadowGrabberConfigOverrides,
} from "./ShadowGrabberConfig";

export function registerShadowGrabber(
  manager: EnemyManager,
  overrides: ShadowGrabberConfigOverrides = {}
) {
  const baseConfig = createShadowGrabberConfig(overrides);
  manager.registerType({
    type: SHADOW_GRABBER_TYPE,
    assetUrl: baseConfig.modelUrl,
    create: (context, options) => {
      const spawnOptions = options as ShadowGrabberSpawnOptions;
      const config = createShadowGrabberConfig({
        ...overrides,
        ...spawnOptions.configOverrides,
        animationSpeed: {
          ...overrides.animationSpeed,
          ...spawnOptions.configOverrides?.animationSpeed,
        },
        animationLoop: {
          ...overrides.animationLoop,
          ...spawnOptions.configOverrides?.animationLoop,
        },
        animationGroupNames: {
          ...overrides.animationGroupNames,
          ...spawnOptions.configOverrides?.animationGroupNames,
        },
        nodeNames: {
          ...overrides.nodeNames,
          ...spawnOptions.configOverrides?.nodeNames,
        },
        armMaterial: {
          ...overrides.armMaterial,
          ...spawnOptions.configOverrides?.armMaterial,
        },
        portalMaterial: {
          ...overrides.portalMaterial,
          ...spawnOptions.configOverrides?.portalMaterial,
        },
      });
      const controller = new ShadowGrabberController(context, options, config);
      if (spawnOptions.anchorPosition) controller.setAnchorPosition(spawnOptions.anchorPosition);
      return controller;
    },
  });
}

export interface ShadowGrabberSpawnOptions extends EnemySpawnOptions {
  type: typeof SHADOW_GRABBER_TYPE;
  anchorPosition?: Vector3;
  configOverrides?: ShadowGrabberConfigOverrides;
  groupId: string;
}

export async function spawnShadowGrabber(
  manager: EnemyManager,
  options: ShadowGrabberSpawnOptions
) {
  return (await manager.spawn(options)) as ShadowGrabberController;
}

export { ShadowGrabberController } from "./ShadowGrabberController";
export {
  ShadowGrabberBehavior,
  ShadowGrabberBehaviorState,
  type ShadowGrabberBehaviorDebug,
  type ShadowGrabberNavigation,
  type ShadowGrabberTargetSnapshot,
} from "./ShadowGrabberBehavior";
export {
  ShadowGrabberCoordinator,
  ShadowGrabberRole,
} from "./ShadowGrabberCoordinator";
export {
  ShadowGrabberBehaviorSystem,
  type ShadowGrabberBehaviorSystemOptions,
  type ShadowGrabberPlayerSource,
} from "./ShadowGrabberBehaviorSystem";
export {
  ShadowGrabberLightQuery,
  type FixedLightSample,
  type FlashlightGameplayState,
} from "./ShadowGrabberLightQuery";
export type { ShadowGrabberAnimationOptions } from "./ShadowGrabberController";
export {
  DEFAULT_SHADOW_GRABBER_CONFIG,
  SHADOW_GRABBER_MODEL_URL,
  SHADOW_GRABBER_STATE_ANIMATION,
  SHADOW_GRABBER_TYPE,
  ShadowGrabberState,
  createShadowGrabberConfig,
  type ShadowGrabberAnimation,
  type ShadowGrabberConfig,
  type ShadowGrabberConfigOverrides,
  type ShadowGrabberMaterialConfig,
} from "./ShadowGrabberConfig";
