import type { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

export interface WaterSurfaceInfo {
  id: string;
  mesh?: AbstractMesh;
  waterLevel: number;
  bounds?: BoundingInfo | null;
  containsPoint?: (position: Vector3, horizontalMargin: number) => boolean;
  getWaterLevelAt?: (position: Vector3) => number;
}

export function getWaterLevelAt(surface: WaterSurfaceInfo, position: Vector3) {
  return surface.getWaterLevelAt?.(position) ?? surface.waterLevel;
}

export function isPointInsideWaterSurface(
  surface: WaterSurfaceInfo,
  position: Vector3,
  horizontalMargin = 0
) {
  if (surface.containsPoint) {
    return surface.containsPoint(position, horizontalMargin);
  }

  surface.mesh?.computeWorldMatrix(false);
  const meshBounds = surface.mesh?.getBoundingInfo();
  const box = (surface.bounds ?? meshBounds)?.boundingBox;
  if (!box) return false;

  return (
    position.x >= box.minimumWorld.x - horizontalMargin &&
    position.x <= box.maximumWorld.x + horizontalMargin &&
    position.z >= box.minimumWorld.z - horizontalMargin &&
    position.z <= box.maximumWorld.z + horizontalMargin
  );
}

export class WaterSurfaceRegistry {
  private readonly surfaces = new Map<string, WaterSurfaceInfo>();

  register(surface: WaterSurfaceInfo) {
    if (this.surfaces.has(surface.id)) {
      throw new Error(`Water surface '${surface.id}' is already registered.`);
    }
    this.surfaces.set(surface.id, surface);
    return () => this.unregister(surface.id);
  }

  unregister(id: string) {
    this.surfaces.delete(id);
  }

  clear() {
    this.surfaces.clear();
  }

  getById(id: string) {
    return this.surfaces.get(id) ?? null;
  }

  getWaterSurfaceAt(position: Vector3, horizontalMargin = 0) {
    let selected: WaterSurfaceInfo | null = null;
    let selectedLevel = Number.NEGATIVE_INFINITY;

    for (const surface of this.surfaces.values()) {
      if (!isPointInsideWaterSurface(surface, position, horizontalMargin)) continue;
      const level = getWaterLevelAt(surface, position);
      if (level > selectedLevel) {
        selected = surface;
        selectedLevel = level;
      }
    }

    return selected;
  }

  isPointInsideWaterSurface(position: Vector3, horizontalMargin = 0) {
    return this.getWaterSurfaceAt(position, horizontalMargin) !== null;
  }

  getWaterDepthForCharacter(position: Vector3) {
    const surface = this.getWaterSurfaceAt(position);
    if (!surface) return 0;
    return Math.max(0, getWaterLevelAt(surface, position) - position.y);
  }

  get size() {
    return this.surfaces.size;
  }
}
