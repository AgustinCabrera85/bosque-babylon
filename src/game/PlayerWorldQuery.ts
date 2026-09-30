import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

export type PlayerStairSurfaceInfo = {
  stepIndex: number;
  stepProgress: number;
  surfaceHeight: number;
  presentationHeight: number;
  ascentDirectionX: number;
  ascentDirectionZ: number;
};

export interface PlayerWorldQuery {
  getTerrainHeight(x: number, z: number): number;

  getWalkableSurfaceHeight(
    x: number,
    z: number,
    currentFeetY?: number,
    maximumWalkableSurfaceY?: number
  ): number;

  isColliding(
    x: number,
    z: number,
    additionalClearance?: number,
    minY?: number,
    maxY?: number
  ): boolean;

  resolveCameraPosition(origin: Vector3, desired: Vector3): Vector3;

  getStairSurfaceInfo?(x: number, z: number): PlayerStairSurfaceInfo | null;
}
