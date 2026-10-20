import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerWorldQuery } from "../../PlayerWorldQuery";
import { RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";

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

/** First iteration: pitch + south service tunnel are walkable. */
export class RinaStadiumWorld implements PlayerWorldQuery {
  getTerrainHeight(x: number, z: number) {
    return this.getWalkableSurfaceHeight(x, z);
  }

  getWalkableSurfaceHeight(_x: number, _z: number) {
    return RINA_STADIUM.fieldY;
  }

  isColliding(x: number, z: number, additionalClearance = 0) {
    const localX = x / RINA_STADIUM_SCALE;
    const localZ = z / RINA_STADIUM_SCALE;
    const localClearance = additionalClearance / RINA_STADIUM_SCALE;
    return hitsCatwalk(localX, localZ, localClearance) || !(
      insideField(localX, localZ, localClearance) ||
      insideExitTunnel(localX, localZ, localClearance)
    );
  }

  resolveCameraPosition(_origin: Vector3, desired: Vector3) {
    return desired.clone();
  }
}
