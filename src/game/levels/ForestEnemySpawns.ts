import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EnemyManager } from "../enemies";
import {
  SHADOW_GRABBER_TYPE,
  ShadowGrabberBehaviorSystem,
  spawnShadowGrabber,
  type ShadowGrabberConfigOverrides,
} from "../enemies";

export interface ForestEnemySpawnDefinition {
  id: string;
  type: typeof SHADOW_GRABBER_TYPE;
  position: Vector3;
  rotation?: Vector3;
  anchorPosition?: Vector3;
  configOverrides?: ShadowGrabberConfigOverrides;
  groupId: string;
}

export type ForestEnemySpawnContext = {
  getGroundHeight: (x: number, z: number) => number;
};

/**
 * First authored encounter: segment 4 (z 280..350), beside the path's candle
 * rows at x ~= +/-5.75. Anchors at x +/-15 remain semi-dark, leave the path
 * clear, and are far from the spawn, house (z ~= 560) and lagoon (z ~= 658).
 */
export function createInitialForestEnemySpawns(
  context: ForestEnemySpawnContext
): ForestEnemySpawnDefinition[] {
  const groupId = "forest-grabbers-01";
  const anchors = [
    { id: "forest-grabber-01", x: -15.5, z: 301.5, yaw: 0.18 },
    { id: "forest-grabber-02", x: 15.2, z: 309.5, yaw: -0.2 },
    { id: "forest-grabber-03", x: -15.8, z: 327.5, yaw: 0.12 },
    { id: "forest-grabber-04", x: 15.7, z: 335.5, yaw: -0.16 },
  ] as const;

  return anchors.map(({ id, x, z, yaw }) => {
    const position = new Vector3(x, context.getGroundHeight(x, z), z);
    return {
      id,
      type: SHADOW_GRABBER_TYPE,
      position,
      rotation: new Vector3(0, yaw, 0),
      anchorPosition: position.clone(),
      groupId,
    };
  });
}

export async function loadInitialForestEnemies(
  manager: EnemyManager,
  behaviorSystem: ShadowGrabberBehaviorSystem,
  context: ForestEnemySpawnContext
) {
  const definitions = createInitialForestEnemySpawns(context);
  const controllers = [];
  for (const definition of definitions) {
    const controller = await spawnShadowGrabber(manager, definition);
    behaviorSystem.add(controller, definition.groupId, definition.anchorPosition);
    controllers.push(controller);
  }
  return controllers;
}
