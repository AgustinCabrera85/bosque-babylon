import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { NoSpawnZone } from "../Segments";
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
  isBlocked?: (x: number, z: number, additionalClearance?: number) => boolean;
};

const INITIAL_FOREST_ENEMY_ANCHORS = [
  { id: "forest-grabber-01", x: -15.5, z: 301.5, yaw: 0.18 },
  { id: "forest-grabber-02", x: 15.2, z: 309.5, yaw: -0.2 },
  { id: "forest-grabber-03", x: -15.8, z: 327.5, yaw: 0.12 },
  { id: "forest-grabber-04", x: 15.7, z: 335.5, yaw: -0.16 },
] as const;

const FOREST_ENEMY_SPAWN_ZONE_WIDTH = 8;
const FOREST_ENEMY_SPAWN_ZONE_DEPTH = 10;
const FOREST_ENEMY_SPAWN_CLEARANCE = 1.5;
const FOREST_PATH_SAFE_HALF_WIDTH = 8;
const SPAWN_SEARCH_RADII = [2.5, 5, 7.5, 10] as const;
const SPAWN_SEARCH_ANGLE_OFFSETS = [
  0,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
  (Math.PI * 3) / 4,
  (-Math.PI * 3) / 4,
  Math.PI,
] as const;

/**
 * Keeps procedural trees and rocks away from both the portal and the first
 * movement steps. Segments adds its asset-specific margin on top of this box.
 */
export function getInitialForestEnemyNoSpawnZones(): NoSpawnZone[] {
  return INITIAL_FOREST_ENEMY_ANCHORS.map(({ x, z }) => ({
    x,
    z,
    width: FOREST_ENEMY_SPAWN_ZONE_WIDTH,
    depth: FOREST_ENEMY_SPAWN_ZONE_DEPTH,
  }));
}

export function resolveForestEnemySpawnPosition(
  anchor: Readonly<{ x: number; z: number }>,
  isBlocked?: ForestEnemySpawnContext["isBlocked"]
) {
  if (!isBlocked || !isBlocked(anchor.x, anchor.z, FOREST_ENEMY_SPAWN_CLEARANCE)) {
    return { x: anchor.x, z: anchor.z };
  }

  const side = anchor.x < 0 ? -1 : 1;
  const outwardAngle = side < 0 ? Math.PI : 0;
  for (const radius of SPAWN_SEARCH_RADII) {
    for (const angleOffset of SPAWN_SEARCH_ANGLE_OFFSETS) {
      const angle = outwardAngle + angleOffset;
      const x = anchor.x + Math.cos(angle) * radius;
      const z = anchor.z + Math.sin(angle) * radius;
      if (Math.abs(x) < FOREST_PATH_SAFE_HALF_WIDTH) continue;
      if (!isBlocked(x, z, FOREST_ENEMY_SPAWN_CLEARANCE)) return { x, z };
    }
  }

  // This should only be reachable if an authored blocker covers the complete
  // search area. Keeping the authored anchor is safer than moving onto the path.
  return { x: anchor.x, z: anchor.z };
}

/**
 * First authored encounter: segment 4 (z 280..350), beside the path's candle
 * rows at x ~= +/-5.75. Anchors at x +/-15 remain semi-dark, leave the path
 * clear, and are far from the spawn, house (z ~= 560) and lagoon (z ~= 658).
 */
export function createInitialForestEnemySpawns(
  context: ForestEnemySpawnContext
): ForestEnemySpawnDefinition[] {
  const groupId = "forest-grabbers-01";

  return INITIAL_FOREST_ENEMY_ANCHORS.map(({ id, x, z, yaw }) => {
    const resolved = resolveForestEnemySpawnPosition({ x, z }, context.isBlocked);
    const position = new Vector3(
      resolved.x,
      context.getGroundHeight(resolved.x, resolved.z),
      resolved.z
    );
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
