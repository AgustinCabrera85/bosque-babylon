import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerWorldQuery } from "../../PlayerWorldQuery";
import type { Segments } from "../../Segments";
import type { TerrainHandle } from "../../Terrain";

type ForestPlayerWorldOptions = {
  pathHalfWidth?: number;
  pathStartZ?: number;
  pathEndZ?: number;
  pathSurfaceOffset?: number;
};

export class ForestPlayerWorld implements PlayerWorldQuery {
  private segments: Segments | null = null;
  private readonly pathHalfWidth: number;
  private readonly pathStartZ: number;
  private readonly pathEndZ: number;
  private readonly pathSurfaceOffset: number;

  constructor(
    private readonly terrain: TerrainHandle,
    options: ForestPlayerWorldOptions = {}
  ) {
    this.pathHalfWidth = options.pathHalfWidth ?? 4.5;
    this.pathStartZ = options.pathStartZ ?? -800;
    this.pathEndZ = options.pathEndZ ?? 70 * 8 - 8;
    this.pathSurfaceOffset = options.pathSurfaceOffset ?? 0.1;
  }

  setSegments(segments: Segments) {
    this.segments = segments;
  }

  getTerrainHeight(x: number, z: number) {
    return this.terrain.getHeightAt(x, z);
  }

  getWalkableSurfaceHeight(
    x: number,
    z: number,
    _currentFeetY?: number,
    maximumWalkableSurfaceY?: number
  ) {
    const baseHeight = this.getTerrainHeight(x, z);
    const onPath =
      Math.abs(x) <= this.pathHalfWidth &&
      z >= this.pathStartZ &&
      z <= this.pathEndZ;
    const forestFloor = baseHeight + (onPath ? this.pathSurfaceOffset : 0);

    if (!this.segments || maximumWalkableSurfaceY === undefined) {
      return forestFloor;
    }
    return this.segments.getWalkableSurfaceHeight(
      x,
      z,
      forestFloor,
      maximumWalkableSurfaceY
    );
  }

  isColliding(
    x: number,
    z: number,
    additionalClearance = 0,
    minY?: number,
    maxY?: number
  ) {
    return this.segments?.isColliding(
      x,
      z,
      additionalClearance,
      minY,
      maxY
    ) ?? false;
  }

  resolveCameraPosition(origin: Vector3, desired: Vector3) {
    return this.segments?.resolveCameraPosition(origin, desired) ?? desired.clone();
  }
}
