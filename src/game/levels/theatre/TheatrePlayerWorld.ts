import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerWorldQuery } from "../../PlayerWorldQuery";
import { STAIR_CONFIG, type StaircaseHandle } from "./Staircase";

export class TheatrePlayerWorld implements PlayerWorldQuery {
  constructor(
    private readonly staircase: StaircaseHandle,
    private readonly corridorHalfWidth = 4.6,
    private readonly minZ = -15.5,
    private readonly maxZ = staircase.endZ + 0.8
  ) {}

  getTerrainHeight(_x: number, z: number) {
    return this.staircase.getHeightAt(z);
  }

  getWalkableSurfaceHeight(x: number, z: number) {
    return this.getTerrainHeight(x, z);
  }

  getStairSurfaceInfo(_x: number, z: number) {
    if (z < STAIR_CONFIG.startZ || z > this.staircase.endZ) return null;
    const totalDepth = STAIR_CONFIG.stepCount * STAIR_CONFIG.stepDepth;
    const distance = Math.max(
      0,
      Math.min(totalDepth, z - STAIR_CONFIG.startZ)
    );
    const rawStep = distance / STAIR_CONFIG.stepDepth;
    const atTop = rawStep >= STAIR_CONFIG.stepCount;
    const stepIndex = atTop
      ? STAIR_CONFIG.stepCount - 1
      : Math.max(0, Math.floor(rawStep));
    const stepProgress = atTop ? 1 : rawStep - stepIndex;
    const easedProgress = stepProgress * stepProgress * (3 - 2 * stepProgress);

    return {
      stepIndex,
      stepProgress,
      surfaceHeight: this.staircase.getHeightAt(z),
      presentationHeight:
        (stepIndex + easedProgress) * STAIR_CONFIG.stepRise,
      ascentDirectionX: 0,
      ascentDirectionZ: 1,
    };
  }

  isColliding(x: number, z: number, additionalClearance = 0) {
    const halfWidth = Math.max(0.1, this.corridorHalfWidth - additionalClearance);
    return Math.abs(x) > halfWidth || z < this.minZ || z > this.maxZ;
  }

  resolveCameraPosition(origin: Vector3, desired: Vector3) {
    const result = desired.clone();
    result.x = Math.max(-this.corridorHalfWidth, Math.min(this.corridorHalfWidth, result.x));
    result.z = Math.max(this.minZ, Math.min(this.maxZ, result.z));
    if (Vector3.DistanceSquared(origin, result) < 0.000001) return origin.clone();
    return result;
  }
}
