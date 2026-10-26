import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerStairSurfaceInfo, PlayerWorldQuery } from "../../PlayerWorldQuery";
import { RINA_STAGE_STAIRS, RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";
import type { RinaFieldCrowdMazeLayout } from "./RinaFieldCrowdMazeLayout";
import type { RinaStageBarrierCollisionSpan } from "./RinaStageSecurityBarriers";

const FIELD_HALF_WIDTH = RINA_STADIUM.pitchWidth / 2;
const FIELD_HALF_LENGTH = RINA_STADIUM.pitchLength / 2;
export const RINA_PLAYER_COLLISION_CLEARANCE_LOCAL = 0.72 / RINA_STADIUM_SCALE;
const PLAYER_CLEARANCE = RINA_PLAYER_COLLISION_CLEARANCE_LOCAL;

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

function insideStageStairs(x: number, z: number, stepCount: number, clearance = 0) {
  const radius = Math.max(clearance, PLAYER_CLEARANCE);
  const firstZ = RINA_STADIUM.stage.frontZ - stepCount * RINA_STAGE_STAIRS.stepDepth;
  return Math.abs(Math.abs(x) - RINA_STAGE_STAIRS.centerX) <=
      RINA_STAGE_STAIRS.width / 2 - radius &&
    z >= firstZ && z < RINA_STADIUM.stage.frontZ;
}

function insideStageDeck(x: number, z: number, clearance = 0) {
  const radius = Math.max(clearance, PLAYER_CLEARANCE);
  return Math.abs(x) <= RINA_STADIUM.stage.width / 2 - radius &&
    z >= RINA_STADIUM.stage.frontZ &&
    z <= RINA_STADIUM.stage.frontZ + RINA_STADIUM.stage.depth - radius;
}

function insideCatwalkDeck(x: number, z: number, clearance = 0) {
  const radius = Math.max(clearance, PLAYER_CLEARANCE);
  const catwalk = RINA_STADIUM.stage.catwalk;
  return Math.abs(x) <= catwalk.width / 2 - radius &&
    z >= catwalk.centerZ - catwalk.depth / 2 + radius &&
    z < RINA_STADIUM.stage.frontZ;
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

/** Field, tunnel, stage barriers, and optional crowd islands share one collision query. */
export class RinaStadiumWorld implements PlayerWorldQuery {
  constructor(
    private readonly barrierSpans: readonly RinaStageBarrierCollisionSpan[] = [],
    private readonly fieldCrowdMaze: RinaFieldCrowdMazeLayout | null = null,
    private readonly performanceTier: "desktop" | "mobile" = "desktop",
  ) {}

  private get stairCount() {
    return RINA_STAGE_STAIRS.steps[this.performanceTier];
  }

  private getStairStepIndex(z: number) {
    const firstZ = RINA_STADIUM.stage.frontZ -
      this.stairCount * RINA_STAGE_STAIRS.stepDepth;
    return Math.max(0, Math.min(this.stairCount - 1,
      Math.floor((z - firstZ) / RINA_STAGE_STAIRS.stepDepth)));
  }

  /** The same solid-crowd boundary used by the player's collision query. */
  crowdBlocksPlayerLocal(x: number, z: number, clearance = PLAYER_CLEARANCE): boolean {
    return this.fieldCrowdMaze?.blocksPlayerLocal(x, z, clearance) === true;
  }

  getTerrainHeight(x: number, z: number) {
    return this.getWalkableSurfaceHeight(x, z);
  }

  getWalkableSurfaceHeight(x: number, z: number) {
    const localX = x / RINA_STADIUM_SCALE;
    const localZ = z / RINA_STADIUM_SCALE;
    if (insideStageDeck(localX, localZ) || insideCatwalkDeck(localX, localZ)) {
      return RINA_STADIUM.stage.height * RINA_STADIUM_SCALE;
    }
    if (insideStageStairs(localX, localZ, this.stairCount)) {
      return RINA_STADIUM.stage.height *
        (this.getStairStepIndex(localZ) + 1) / this.stairCount *
        RINA_STADIUM_SCALE;
    }
    return RINA_STADIUM.fieldY;
  }

  getStairSurfaceInfo(x: number, z: number): PlayerStairSurfaceInfo | null {
    const localX = x / RINA_STADIUM_SCALE;
    const localZ = z / RINA_STADIUM_SCALE;
    if (!insideStageStairs(localX, localZ, this.stairCount)) return null;
    const firstZ = RINA_STADIUM.stage.frontZ -
      this.stairCount * RINA_STAGE_STAIRS.stepDepth;
    const progress = (localZ - firstZ) / RINA_STAGE_STAIRS.stepDepth;
    const stepIndex = this.getStairStepIndex(localZ);
    const stepProgress = Math.max(0, Math.min(1, progress - stepIndex));
    const rise = RINA_STADIUM.stage.height * RINA_STADIUM_SCALE / this.stairCount;
    const eased = stepProgress * stepProgress * (3 - 2 * stepProgress);
    return {
      stepIndex,
      stepProgress,
      surfaceHeight: (stepIndex + 1) * rise,
      presentationHeight: (stepIndex + eased) * rise,
      ascentDirectionX: 0,
      ascentDirectionZ: 1,
    };
  }

  isColliding(x: number, z: number, additionalClearance = 0, minY = -Infinity, maxY = Infinity) {
    const localX = x / RINA_STADIUM_SCALE;
    const localZ = z / RINA_STADIUM_SCALE;
    const localClearance = additionalClearance / RINA_STADIUM_SCALE;
    const radius = Math.max(localClearance, PLAYER_CLEARANCE);
    const localFeetY = minY / RINA_STADIUM_SCALE;
    const firstRise = RINA_STADIUM.stage.height / this.stairCount;
    const onRaisedDeck = localFeetY >= RINA_STADIUM.stage.height - firstRise - 0.1;
    const supported = insideStageStairs(localX, localZ, this.stairCount, localClearance) ||
      (onRaisedDeck && (
        insideStageDeck(localX, localZ, localClearance) ||
        insideCatwalkDeck(localX, localZ, localClearance)
      )) ||
      (localFeetY <= firstRise + 0.15 && (
        insideField(localX, localZ, localClearance) ||
        insideExitTunnel(localX, localZ, localClearance)
      ));
    return (hitsCatwalk(localX, localZ, localClearance) && !onRaisedDeck) ||
      hitsStageBarrier(
        localX, localZ, radius,
        minY / RINA_STADIUM_SCALE, maxY / RINA_STADIUM_SCALE,
        this.barrierSpans
      ) || this.crowdBlocksPlayerLocal(localX, localZ, radius) || !supported;
  }

  resolveCameraPosition(_origin: Vector3, desired: Vector3) {
    return desired.clone();
  }
}
