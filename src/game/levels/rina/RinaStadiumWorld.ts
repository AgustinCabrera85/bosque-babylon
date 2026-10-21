import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerWorldQuery } from "../../PlayerWorldQuery";
import { RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";
import type { RinaStageBarrierCollisionSpan } from "./RinaStageSecurityBarriers";

const FIELD_HALF_WIDTH = RINA_STADIUM.pitchWidth / 2;
const FIELD_HALF_LENGTH = RINA_STADIUM.pitchLength / 2;
const PLAYER_CLEARANCE = 0.72 / RINA_STADIUM_SCALE;

function insideExitTunnel(x: number, z: number, clearance = 0) {
  return (
    Math.abs(x) <=
      RINA_STADIUM.exitTunnel.halfWidth -
        Math.max(clearance, PLAYER_CLEARANCE) &&
    z >= RINA_STADIUM.exitTunnel.startZ &&
    z <= RINA_STADIUM.exitTunnel.endZ
  );
}

function insideField(x: number, z: number, clearance = 0) {
  const safeClearance = Math.max(clearance, PLAYER_CLEARANCE);
  return (
    Math.abs(x) <= FIELD_HALF_WIDTH - safeClearance &&
    z >= -FIELD_HALF_LENGTH + safeClearance &&
    z <= RINA_STADIUM.stage.frontZ - safeClearance
  );
}

function hitsCatwalk(x: number, z: number, clearance = 0) {
  const radius = Math.max(clearance, PLAYER_CLEARANCE);
  const catwalk = RINA_STADIUM.stage.catwalk;
  return Math.abs(x) < catwalk.width / 2 + radius &&
    z > catwalk.centerZ - catwalk.depth / 2 - radius &&
    z < RINA_STADIUM.stage.frontZ + radius;
}

function hitsStageBarrier(
  x: number,
  z: number,
  radius: number,
  minY: number,
  maxY: number,
  spans: readonly RinaStageBarrierCollisionSpan[]
) {
  for (const span of spans) {
    if (maxY < span.bottomY || minY > span.topY) continue;
    const dx = span.endX - span.startX;
    const dz = span.endZ - span.startZ;
    const lengthSquared = dx * dx + dz * dz;
    const projection = lengthSquared > 0
      ? Math.max(0, Math.min(1,
        ((x - span.startX) * dx + (z - span.startZ) * dz) / lengthSquared))
      : 0;
    const nearestX = span.startX + projection * dx;
    const nearestZ = span.startZ + projection * dz;
    if (Math.hypot(x - nearestX, z - nearestZ) <= radius) return true;
  }
  return false;
}

/** First iteration: pitch + south service tunnel are walkable. */
export class RinaStadiumWorld implements PlayerWorldQuery {
  constructor(private readonly barrierSpans: readonly RinaStageBarrierCollisionSpan[] = []) {}

  getTerrainHeight(x: number, z: number) {
    return this.getWalkableSurfaceHeight(x, z);
  }

  getWalkableSurfaceHeight(_x: number, _z: number) {
    return RINA_STADIUM.fieldY;
  }

  isColliding(x: number, z: number, additionalClearance = 0, minY = -Infinity, maxY = Infinity) {
    const localX = x / RINA_STADIUM_SCALE;
    const localZ = z / RINA_STADIUM_SCALE;
    const localClearance = additionalClearance / RINA_STADIUM_SCALE;
    const radius = Math.max(localClearance, PLAYER_CLEARANCE);
    return hitsCatwalk(localX, localZ, localClearance) ||
      hitsStageBarrier(
        localX, localZ, radius,
        minY / RINA_STADIUM_SCALE, maxY / RINA_STADIUM_SCALE,
        this.barrierSpans
      ) || !(
      insideField(localX, localZ, localClearance) ||
      insideExitTunnel(localX, localZ, localClearance)
    );
  }

  resolveCameraPosition(_origin: Vector3, desired: Vector3) {
    return desired.clone();
  }
}
