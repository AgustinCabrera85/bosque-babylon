import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Matrix, Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { Ray } from "@babylonjs/core/Culling/ray";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Light } from "@babylonjs/core/Lights/light";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

import { mulberry32 } from "../utils/seed";
import { createCandleFireMaterial, createGlowMaterial } from "./Torches";
import { createPhotoCard } from "./PhotoCard";
import { createCollectibleNote } from "./CollectibleNotes";

import type { TerrainHandle } from "./Terrain";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { TreeLibrary } from "./TreeLibrary";
import type { GrassLibrary } from "./GrassLibrary";
import type { PlantLibrary } from "./PlantLibrary";
import type { RockLibrary } from "./RockLibrary";

type Collider = {
  x: number;
  z: number;
  radius: number;
  segmentId: number;
  kind: "tree" | "rock" | "candle";
};

type BoxCollider = {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  active: boolean;
  kind: "house" | "door" | "blocker";
};

export type NoSpawnZone = {
  x: number;
  z: number;
  width: number;
  depth: number;
};

type Interactable = { mesh: any; segmentId: number };
type SegmentCfg = {
  segmentLength: number;
  behind: number;
  ahead: number;
  objectBehind?: number;
  objectAhead?: number;
  plantBehind?: number;
  plantAhead?: number;
  treeCount?: number;
  rockCount?: number;
  grassBuildCount?: number;
  grassRingCounts?: [number, number, number];
  plantBuildCount?: number;
  plantRingCounts?: [number, number, number];
  plantFarCount?: number;
  endHouseSegment?: number;
  maxGeneratedSegment?: number;
};

export type StaticWorldBlocker = {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation?: number;
};

type SegTreePack = { nodes: TransformNode[]; lod: 0 | 1 | 2 };
type SegRockPack = { nodes: TransformNode[] };
type SegCandlePack = { nodes: TransformNode[] };
type CandleTemplate = {
  meshes: Mesh[];
  baseOffsetY: number;
  topOffsetY: number;
};

type CandleFlameEntry = {
  root: TransformNode;
  baseIntensity: number;
  lightRange: number;
  phase: number;
  age: number;
  fadeInSeconds: number;
  flame: Mesh;
  glow: Mesh;
  floorGlow: Mesh;
  sparks: Mesh[];
  flameHeight: number;
};

type CandleLightPoolEntry = {
  side: -1 | 1;
  light: PointLight;
  targetPosition: Vector3;
  targetIntensity: number;
  targetRange: number;
  currentIntensity: number;
  currentRange: number;
  initialized: boolean;
};

const CANDLES_PER_SIDE = 3;
const CANDLE_PATH_X = 5.75;
const CANDLE_MODEL_SCALE = 0.12;
const HOUSE_CANDLE_HEIGHT_SCALE = 0.25;
const HOUSE_CANDLE_DIAMETER_SCALE = 0.10;
const CANDLE_GROUND_SINK = 0.015;
const CANDLE_RESERVE_RADIUS = 1.35;
const CANDLE_COLLISION_RADIUS = 0.55;
const CANDLE_FLAME_WIDTH = 0.34;
const CANDLE_FLAME_HEIGHT = 0.68;
const SEGMENT_CANDLE_FADE_SECONDS = 0.85;
const CANDLE_LIGHT_RENDER_PRIORITY = 8;
const CANDLE_LIGHT_BASE_INTENSITY = 1.35;
const CANDLE_LIGHT_RANGE = 18;
const CANDLE_LIGHT_FULL_INFLUENCE_RADIUS = 7;
const CANDLE_LIGHT_FADE_RADIUS = 28;
const CANDLE_LIGHT_INTENSITY_RESPONSE = 2.8;
const CANDLE_LIGHT_POSITION_RESPONSE = 3.6;
const STREAM_TREE_LOD: 0 | 1 | 2 = 1;
const PLAYER_WORLD_COLLISION_RADIUS = 1.0;
const PLAYER_HOUSE_COLLISION_RADIUS = 0.42;
const PLAYER_DOOR_COLLISION_RADIUS = 0.62;
const PLAYER_BLOCKER_COLLISION_RADIUS = 1.0;
const DOOR_OPEN_ACTION_DELAY_SECONDS = 1.7;
const DOOR_CLOSE_COLLIDER_GRACE_SECONDS = 1.0;
// Higher values lower the flame plane; the fire texture has transparent padding at its base.
const CANDLE_FLAME_WICK_TIP_INSET = 1.35;
const START_BLOCKER_Z = -9.5;
const START_FOREST_CLOSURE_Z = -18;
const END_HOUSE_MODEL_SCALE = 1.55;
const END_HOUSE_RESERVE_WIDTH = 122;
const END_HOUSE_RESERVE_DEPTH = 150;
const INTERACTION_RAY_LENGTH = 4.25;
const FIRST_NOTE_SEGMENT_ID = 1;
const ISOMETRIC_OCCLUDER_INNER_RADIUS = 0.35;
const ISOMETRIC_OCCLUDER_OUTER_RADIUS = 2.25;
const ISOMETRIC_OCCLUDER_MIN_VISIBILITY = 0.28;
const ISOMETRIC_OCCLUDER_HEIGHT_CLEARANCE = 0.35;
const ISOMETRIC_OCCLUDER_BLEND = 0.26;
// Asset especial: no se carga en TreeLibrary para que no aparezca en la generacion normal.
const START_BLOCKER_TREE_PATH = "/assets/models/blockers/";
const START_BLOCKER_TREE_FILE = "tree_08.glb";

function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export class Segments {
  private readonly WORLD_SEED = 1337;

  private grassInitialized = false;
  private plantsInitialized = false;
  private lastSegment: number | null = null;

  private treeSegments = new Map<number, SegTreePack>();
  private rockSegments = new Map<number, SegRockPack>();
  private candleSegments = new Map<number, SegCandlePack>();
  private grassSegments = new Map<number, Float32Array[]>();
  private plantSegments = new Map<number, Float32Array[]>();
  private combinedGrassSegments = new Map<number, Float32Array[]>();
  private combinedPlantSegments = new Map<number, Float32Array[]>();

  private colliders: Collider[] = [];
  private staticBoxColliders: BoxCollider[] = [];
  private noSpawnZones: NoSpawnZone[] = [];
  private interactables: Interactable[] = [];

  private grassBases: Mesh[] | null = null;
  private plantBases: Mesh[] | null = null;
  private candleTemplate: CandleTemplate | null = null;
  private candleFireMaterial: ReturnType<typeof createCandleFireMaterial> | null = null;
  private candleGlowMaterial: ReturnType<typeof createGlowMaterial> | null = null;
  private candleFloorGlowMaterial: StandardMaterial | null = null;
  private candleLights: CandleFlameEntry[] = [];
  private candleLightPool: CandleLightPoolEntry[] = [];
  private activeObjectSegments = new Set<number>();
  private isometricOccluderRoots = new Set<TransformNode>();
  private isometricOccluderBaseVisibility = new Map<AbstractMesh, number>();
  private candleFlickerRegistered = false;
  private startBlockerLoaded = false;
  private firstNoteCreated = false;
  private endHouseCheckpoint: Vector3 | null = null;
  private endHouseMeshes: AbstractMesh[] = [];
  private worldPrewarmed = false;

  constructor(
    private scene: Scene,
    private terrain: TerrainHandle,
    private treeLibrary: TreeLibrary,
    private grassLibrary: GrassLibrary,
    private plantLibrary: PlantLibrary,
    private rockLibrary: RockLibrary,
    private cfg: SegmentCfg
  ) {
    this.noSpawnZones.push({
      x: 0,
      z: this.cfg.segmentLength * (this.cfg.endHouseSegment ?? 8) + 18,
      width: END_HOUSE_RESERVE_WIDTH,
      depth: END_HOUSE_RESERVE_DEPTH,
    });
  }

  getEndHouseCheckpoint() {
    if (this.endHouseCheckpoint) return this.endHouseCheckpoint.clone();

    const fallbackZ = this.cfg.segmentLength * 8;
    return new Vector3(0, this.terrain.getHeightAt(0, fallbackZ) + 1.4, fallbackZ);
  }

  getEndHouseMeshes(): readonly AbstractMesh[] {
    return this.endHouseMeshes;
  }

  /**
   * Builds the finite procedural route while the loading screen is still up.
   * Runtime streaming then only toggles cached nodes and uploads preassembled
   * thin-instance buffers instead of allocating an entire segment in one frame.
   */
  async prewarmAll(
    playerPositionOrZ: Vector3 | number,
    onProgress: (completed: number, total: number) => void = () => {}
  ): Promise<void> {
    const maxSegment = this.cfg.maxGeneratedSegment;
    if (maxSegment === undefined) {
      this.update(playerPositionOrZ);
      onProgress(1, 1);
      return;
    }

    if (this.worldPrewarmed) {
      this.update(playerPositionOrZ);
      onProgress(1, 1);
      return;
    }

    if (!this.grassInitialized) {
      this.initGrass();
      this.grassInitialized = true;
    }
    if (!this.plantsInitialized) {
      this.initPlants();
      this.plantsInitialized = true;
    }

    const furthestBehind = Math.max(
      1,
      this.cfg.behind,
      this.cfg.objectBehind ?? this.cfg.behind,
      this.cfg.plantBehind ?? this.cfg.behind
    );
    const firstSegment = -furthestBehind;
    const total = maxSegment - firstSegment + 1;

    for (let segmentId = firstSegment; segmentId <= maxSegment; segmentId++) {
      this.prewarmSegment(segmentId);
      onProgress(segmentId - firstSegment + 1, total);

      // Give the browser a paint opportunity so the loading UI remains alive.
      if (segmentId < maxSegment) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    // Assemble every finite streaming window once. Crossing a boundary will no
    // longer concatenate large typed arrays on the render thread.
    for (let currentSegment = 0; currentSegment <= maxSegment; currentSegment++) {
      if (this.grassBases) {
        const needed = this.segmentRange(currentSegment, this.cfg.behind, this.cfg.ahead);
        this.combinedGrassSegments.set(
          currentSegment,
          this.combineInstanceBuffers(
            this.grassSegments,
            needed,
            this.grassBases.length,
            this.stableGrassCount()
          )
        );
      }

      if (this.plantBases) {
        const needed = this.segmentRange(
          currentSegment,
          this.cfg.plantBehind ?? this.cfg.behind,
          this.cfg.plantAhead ?? this.cfg.ahead
        );
        this.combinedPlantSegments.set(
          currentSegment,
          this.combineInstanceBuffers(
            this.plantSegments,
            needed,
            this.plantBases.length,
            this.stablePlantCount()
          )
        );
      }
    }

    this.worldPrewarmed = true;
    this.update(playerPositionOrZ);
  }

  private prewarmSegment(segmentId: number) {
    const centerZ = (segmentId + 0.5) * this.cfg.segmentLength;

    if (this.grassBases && !this.grassSegments.has(segmentId)) {
      this.buildGrassForSegment(segmentId);
    }
    if (this.plantBases && !this.plantSegments.has(segmentId)) {
      this.buildPlantsForSegment(segmentId);
    }
    if (!this.candleSegments.has(segmentId)) {
      const pack = this.createCandles(centerZ, segmentId);
      pack.nodes.forEach((node) => node.setEnabled(false));
      this.candleSegments.set(segmentId, pack);
    }
    if (!this.treeSegments.has(segmentId)) {
      const lod = this.lodFor(segmentId, segmentId);
      const nodes = this.createTrees(centerZ, segmentId, lod);
      nodes.forEach((node) => node.setEnabled(false));
      this.treeSegments.set(segmentId, { nodes, lod });
    }
    if (!this.rockSegments.has(segmentId)) {
      const nodes = this.createRocks(centerZ, segmentId);
      nodes.forEach((node) => node.setEnabled(false));
      this.rockSegments.set(segmentId, { nodes });
    }
  }

  // =========================
  // RNG por segmento (FIJO)
  // =========================
  private rngForSegment(segmentId: number) {
    return mulberry32((this.WORLD_SEED * 1000003) ^ (segmentId * 9176));
  }

  // =========================
  // LOD estable por segmento
  // =========================
  private lodFor(segmentId: number, currentSeg: number): 0 | 1 | 2 {
    void segmentId;
    void currentSeg;
    return STREAM_TREE_LOD;
  }

  private segmentRange(currentSeg: number, behind: number, ahead: number) {
    const needed = new Set<number>();
    for (let o = -behind; o <= ahead; o++) {
      const segmentId = currentSeg + o;
      if (
        this.cfg.maxGeneratedSegment === undefined ||
        segmentId <= this.cfg.maxGeneratedSegment
      ) {
        needed.add(segmentId);
      }
    }
    return needed;
  }

  // =========================
  // UPDATE
  // =========================
  update(playerPositionOrZ: Vector3 | number): void {
    const playerPosition =
      typeof playerPositionOrZ === "number"
        ? new Vector3(0, 0, playerPositionOrZ)
        : playerPositionOrZ;
    const camZ = playerPosition.z;

    if (!this.grassInitialized) {
      this.initGrass();
      this.grassInitialized = true;
    }
    if (!this.plantsInitialized) {
      this.initPlants();
      this.plantsInitialized = true;
    }

    const segLen = this.cfg.segmentLength;
    const playerSegment = Math.floor(camZ / segLen);
    // The terminal landmark extends beyond the last procedural forest segment.
    // Treat that whole authored area as the final segment so crossing the lagoon
    // boundary never empties and restores the last forest buffers.
    const currentSeg =
      this.cfg.maxGeneratedSegment === undefined
        ? playerSegment
        : Math.min(playerSegment, this.cfg.maxGeneratedSegment);
    const segmentChanged = this.lastSegment !== currentSeg;

    const grassNeeded = this.segmentRange(currentSeg, this.cfg.behind, this.cfg.ahead);
    const objectBehind = this.cfg.objectBehind ?? this.cfg.behind;
    const objectAhead = this.cfg.objectAhead ?? this.cfg.ahead;
    const objectNeeded = this.segmentRange(
      currentSeg,
      objectBehind,
      objectAhead
    );
    // Keep one completed segment of candle visuals behind the player. This is
    // enough to move the previous row outside its light influence before it is
    // pooled, without expanding the tree/rock streaming budget on mobile.
    const candleNeeded = this.segmentRange(
      currentSeg,
      Math.max(1, objectBehind),
      Math.max(1, objectAhead)
    );
    const plantNeeded = this.segmentRange(
      currentSeg,
      this.cfg.plantBehind ?? this.cfg.behind,
      this.cfg.plantAhead ?? this.cfg.ahead
    );

    // ---------- GRASS ----------
    if (this.grassBases) {
      let grassChanged = false;
      for (const id of grassNeeded) {
        if (!this.grassSegments.has(id)) {
          this.buildGrassForSegment(id);
          grassChanged = true;
        }
      }
      if (grassChanged || segmentChanged) {
        this.applyCombinedGrassBuffers(grassNeeded, currentSeg);
      }
    }

    // ---------- PLANTS ----------
    if (this.plantBases) {
      let plantsChanged = false;
      for (const id of plantNeeded) {
        if (!this.plantSegments.has(id)) {
          this.buildPlantsForSegment(id);
          plantsChanged = true;
        }
      }
      if (plantsChanged || segmentChanged) {
        this.applyCombinedPlantBuffers(plantNeeded, currentSeg);
      }
    }

    // ---------- CANDLES ----------
    for (const id of candleNeeded) {
      const centerZ = (id + 0.5) * segLen;
      if (!this.candleSegments.has(id)) {
        this.candleSegments.set(id, this.createCandles(centerZ, id));
      } else {
        this.candleSegments.get(id)?.nodes.forEach((node) => node.setEnabled(true));
      }
    }

    // ---------- TREES + ROCKS ----------
    for (const id of objectNeeded) {
      const centerZ = (id + 0.5) * segLen;

      if (id === FIRST_NOTE_SEGMENT_ID && !this.firstNoteCreated) {
        this.createFirstPathNote();
        this.firstNoteCreated = true;
      }

      const desiredLOD = this.lodFor(id, currentSeg);
      const prev = this.treeSegments.get(id);

      if (!prev) {
        const nodes = this.createTrees(centerZ, id, desiredLOD);
        this.treeSegments.set(id, { nodes, lod: desiredLOD });
      } else if (desiredLOD !== prev.lod) {
        prev.nodes.forEach((n) => {
          this.unregisterIsometricOccluder(n);
          n.dispose?.();
        });
        this.removeColliders(id, "tree");
        const nodes = this.createTrees(centerZ, id, desiredLOD);
        this.treeSegments.set(id, { nodes, lod: desiredLOD });
      } else {
        prev.nodes.forEach((node) => node.setEnabled(true));
      }

      if (!this.rockSegments.has(id)) {
        const nodes = this.createRocks(centerZ, id);
        this.rockSegments.set(id, { nodes });
      } else {
        this.rockSegments.get(id)?.nodes.forEach((node) => node.setEnabled(true));
      }
    }

    // cleanup SOLO al cambiar segmento
    if (segmentChanged) {
      this.lastSegment = currentSeg;
      this.cleanup(grassNeeded, plantNeeded, objectNeeded, candleNeeded);
    }

    this.updateCandleLightTargets(playerPosition);
  }

  updateIsometricOccluders(playerPosition: Vector3, enabled: boolean) {
    const occludingTargets = new Map<AbstractMesh, number>();

    if (enabled) {
      for (const root of this.isometricOccluderRoots) {
        if (!root.isEnabled()) continue;

        for (const mesh of root.getChildMeshes(false)) {
          const visibilityFactor = this.getIsometricOccluderVisibilityFactor(mesh, playerPosition);
          if (visibilityFactor === null) continue;
          occludingTargets.set(mesh, visibilityFactor);
        }
      }
    }

    for (const mesh of occludingTargets.keys()) {
      if (!this.isometricOccluderBaseVisibility.has(mesh)) {
        this.isometricOccluderBaseVisibility.set(mesh, mesh.visibility);
      }
    }

    for (const [mesh, baseVisibility] of [...this.isometricOccluderBaseVisibility]) {
      if (this.isDisposedMesh(mesh)) {
        this.isometricOccluderBaseVisibility.delete(mesh);
        continue;
      }

      const targetFactor = occludingTargets.get(mesh) ?? 1;
      const targetVisibility = baseVisibility * targetFactor;
      mesh.visibility += (targetVisibility - mesh.visibility) * ISOMETRIC_OCCLUDER_BLEND;

      if (targetFactor === 1 && Math.abs(mesh.visibility - baseVisibility) < 0.01) {
        mesh.visibility = baseVisibility;
        this.isometricOccluderBaseVisibility.delete(mesh);
      }
    }
  }

  private getIsometricOccluderVisibilityFactor(mesh: AbstractMesh, playerPosition: Vector3) {
    if (!mesh.isEnabled() || !mesh.isVisible) return null;

    mesh.computeWorldMatrix(false);
    const box = mesh.getBoundingInfo().boundingBox;
    if (box.maximumWorld.y < playerPosition.y + ISOMETRIC_OCCLUDER_HEIGHT_CLEARANCE) return null;

    const dx = this.axisDistance(playerPosition.x, box.minimumWorld.x, box.maximumWorld.x);
    const dz = this.axisDistance(playerPosition.z, box.minimumWorld.z, box.maximumWorld.z);
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance >= ISOMETRIC_OCCLUDER_OUTER_RADIUS) return null;

    const t = clamp(
      (distance - ISOMETRIC_OCCLUDER_INNER_RADIUS) /
        (ISOMETRIC_OCCLUDER_OUTER_RADIUS - ISOMETRIC_OCCLUDER_INNER_RADIUS),
      0,
      1
    );
    const smooth = t * t * (3 - 2 * t);
    return ISOMETRIC_OCCLUDER_MIN_VISIBILITY + (1 - ISOMETRIC_OCCLUDER_MIN_VISIBILITY) * smooth;
  }

  private axisDistance(value: number, min: number, max: number) {
    if (value < min) return min - value;
    if (value > max) return value - max;
    return 0;
  }

  private registerIsometricOccluder(root: TransformNode) {
    this.isometricOccluderRoots.add(root);
  }

  private unregisterIsometricOccluder(root: TransformNode) {
    this.isometricOccluderRoots.delete(root);
    for (const mesh of root.getChildMeshes(false)) {
      const baseVisibility = this.isometricOccluderBaseVisibility.get(mesh);
      if (baseVisibility !== undefined) mesh.visibility = baseVisibility;
      this.isometricOccluderBaseVisibility.delete(mesh);
    }
  }

  private isDisposedMesh(mesh: AbstractMesh) {
    return !!(mesh as unknown as { isDisposed?: () => boolean }).isDisposed?.();
  }

  // =========================
  // COLLISION
  // =========================
  isColliding(x: number, z: number) {
    for (const c of this.colliders) {
      if (!this.activeObjectSegments.has(c.segmentId)) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (PLAYER_WORLD_COLLISION_RADIUS + c.radius) ** 2) return true;
    }
    for (const c of this.staticBoxColliders) {
      if (!c.active) continue;
      if (this.isPointInsideBoxCollider(x, z, this.boxColliderPlayerRadius(c), c)) return true;
    }
    return false;
  }

  addStaticWorldBlocker(blocker: StaticWorldBlocker) {
    this.staticBoxColliders.push({
      ...blocker,
      rotation: blocker.rotation ?? 0,
      active: true,
      kind: "blocker",
    });
  }

  reserveNoSpawnZone(zone: NoSpawnZone) {
    this.noSpawnZones.push({ ...zone });
  }

  private boxColliderPlayerRadius(collider: BoxCollider) {
    if (collider.kind === "house") return PLAYER_HOUSE_COLLISION_RADIUS;
    if (collider.kind === "door") return PLAYER_DOOR_COLLISION_RADIUS;
    return PLAYER_BLOCKER_COLLISION_RADIUS;
  }

  resolveCameraPosition(origin: Vector3, desired: Vector3) {
    const dir = desired.subtract(origin);
    const length = dir.length();
    if (length <= 0.001) return desired.clone();

    const cameraRadius = 0.22;
    const safety = 0.12;
    let nearestT = 1;

    for (const collider of this.staticBoxColliders) {
      if (!collider.active) continue;
      const hitT = this.raySegmentBoxHitT(origin, desired, collider, cameraRadius);
      if (hitT !== null && hitT < nearestT) nearestT = hitT;
    }

    if (nearestT >= 1) return desired.clone();
    return origin.add(dir.scale(Math.max(0, nearestT - safety / length)));
  }

  private isPointInsideBoxCollider(x: number, z: number, radius: number, collider: BoxCollider) {
    const dx = x - collider.x;
    const dz = z - collider.z;
    const cos = Math.cos(-collider.rotation);
    const sin = Math.sin(-collider.rotation);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    return (
      Math.abs(localX) <= collider.width * 0.5 + radius &&
      Math.abs(localZ) <= collider.depth * 0.5 + radius
    );
  }

  private raySegmentBoxHitT(
    origin: Vector3,
    desired: Vector3,
    collider: BoxCollider,
    radius: number
  ) {
    const cos = Math.cos(-collider.rotation);
    const sin = Math.sin(-collider.rotation);
    const toLocal = (point: Vector3) => {
      const dx = point.x - collider.x;
      const dz = point.z - collider.z;
      return {
        x: dx * cos - dz * sin,
        z: dx * sin + dz * cos,
      };
    };

    const a = toLocal(origin);
    const b = toLocal(desired);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const halfW = collider.width * 0.5 + radius;
    const halfD = collider.depth * 0.5 + radius;
    let tMin = 0;
    let tMax = 1;

    const clip = (start: number, delta: number, min: number, max: number) => {
      if (Math.abs(delta) < 0.00001) return start >= min && start <= max;
      const inv = 1 / delta;
      let t1 = (min - start) * inv;
      let t2 = (max - start) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      return tMin <= tMax;
    };

    if (!clip(a.x, dx, -halfW, halfW)) return null;
    if (!clip(a.z, dz, -halfD, halfD)) return null;
    return tMax >= 0 && tMin <= 1 ? Math.max(0, tMin) : null;
  }

  private cleanup(
    grassNeeded: Set<number>,
    plantNeeded: Set<number>,
    objectNeeded: Set<number>,
    candleNeeded: Set<number>
  ) {
    this.activeObjectSegments = new Set(objectNeeded);

    for (const [id, pack] of this.treeSegments) {
      if (!objectNeeded.has(id)) {
        pack.nodes.forEach((node) => node.setEnabled(false));
      }
    }

    for (const [id, pack] of this.rockSegments) {
      if (!objectNeeded.has(id)) {
        pack.nodes.forEach((node) => node.setEnabled(false));
      }
    }

    for (const [id, pack] of this.candleSegments) {
      if (!candleNeeded.has(id)) {
        pack.nodes.forEach((node) => node.setEnabled(false));
      }
    }

    // CPU-side instance buffers and scene instances are deliberately retained.
    // Returning through an explored segment now only uploads the cached combined
    // buffers and re-enables pooled nodes instead of rebuilding every placement.
    void grassNeeded;
    void plantNeeded;
  }

  private removeColliders(segmentId: number, kind: Collider["kind"]) {
    this.colliders = this.colliders.filter(
      (c) => c.segmentId !== segmentId || c.kind !== kind
    );
  }

  // =========================
  // INTERACTION
  // =========================
  private createFirstPathNote() {
    const segLen = this.cfg.segmentLength;
    const z = FIRST_NOTE_SEGMENT_ID * segLen + segLen * 0.43;
    const x = -0.95;
    const y = this.terrain.getHeightAt(x, z) + 0.045;

    createCollectibleNote(this.scene, {
      id: "note-1",
      name: "Nota",
      description: "Una nota enrollada encontrada en el camino.",
      worldTexturePath: "assets/models/props/png/generics/ItemRolledNoteGeneric.png",
      contentImagePath: "assets/models/props/png/notes/Note_1.png",
      position: new Vector3(x, y, z),
      rotationY: Math.PI * -0.08,
    });
  }

  spawnDemoInteractables() {
    const note = MeshBuilder.CreateBox("note", { width: 0.25, height: 0.02, depth: 0.18 }, this.scene);
    note.position.set(0.8, this.terrain.getHeightAt(0.8, 8) + 1, 8);
    note.metadata = { interactable: true };

    const door = MeshBuilder.CreateBox("door", { width: 1, height: 2.2, depth: 0.1 }, this.scene);
    door.position.set(-1.5, this.terrain.getHeightAt(-1.5, 14) + 1.1, 14);
    door.metadata = { interactable: true };

    const m = new StandardMaterial("demoMat", this.scene);
    m.diffuseColor.set(0.35, 0.33, 0.30);
    note.material = m;
    door.material = m;

    this.interactables.push({ mesh: note, segmentId: 0 });
    this.interactables.push({ mesh: door, segmentId: 0 });
  }

  async loadCandles() {
    const res = await SceneLoader.ImportMeshAsync(
      null,
      "/assets/models/objects/",
      "candle.glb",
      this.scene
    );

    const meshes = res.meshes.filter(
      (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0
    );

    if (!meshes.length) {
      console.warn("[Segments] candle.glb no trajo meshes renderizables.");
      return;
    }

    const root = new TransformNode("candleTemplateRoot", this.scene);
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      mesh.bakeCurrentTransformIntoVertices();
      mesh.parent = null;
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.rotationQuaternion = null;
      mesh.scaling.set(1, 1, 1);
      mesh.setParent(root);
      mesh.setEnabled(true);
      mesh.isVisible = false;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.alwaysSelectAsActiveMesh = true;
      this.patchCandleMaterial(mesh);
      mesh.computeWorldMatrix(true);
    }
    res.transformNodes.forEach((node) => node.dispose());

    const bounds = this.getHierarchyBounds(meshes);
    root.position.set(0, -10000, 0);

    this.candleTemplate = {
      meshes,
      baseOffsetY: bounds?.min.y ?? 0,
      topOffsetY: bounds ? bounds.max.y - bounds.min.y : 1.25,
    };

    this.candleFireMaterial = createCandleFireMaterial(this.scene);
    this.candleGlowMaterial = createGlowMaterial(this.scene);
    this.candleFloorGlowMaterial = this.createCandleFloorGlowMaterial();
    this.createCandleLightPool();
    this.registerCandleFlicker();
  }

  private createCandleLightPool() {
    if (this.candleLightPool.length > 0) return;

    for (const side of [-1, 1] as const) {
      const light = new PointLight(
        `pathCandleLight_${side < 0 ? "left" : "right"}`,
        new Vector3(0, -10000, 0),
        this.scene
      );
      light.falloffType = Light.FALLOFF_STANDARD;
      light.diffuse = new Color3(1.0, 0.48, 0.19);
      light.specular = new Color3(0.28, 0.1, 0.025);
      light.intensity = 0;
      light.range = CANDLE_LIGHT_RANGE;
      light.renderPriority = CANDLE_LIGHT_RENDER_PRIORITY;

      this.candleLightPool.push({
        side,
        light,
        targetPosition: light.position.clone(),
        targetIntensity: 0,
        targetRange: CANDLE_LIGHT_RANGE,
        currentIntensity: 0,
        currentRange: CANDLE_LIGHT_RANGE,
        initialized: false,
      });
    }
  }

  private createCandleFloorGlowMaterial() {
    const texture = new DynamicTexture(
      "candleFloorGlowTexture",
      { width: 256, height: 256 },
      this.scene,
      false
    );
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 256);
    const gradient = ctx.createRadialGradient(128, 128, 4, 128, 128, 118);
    gradient.addColorStop(0.0, "rgba(255, 196, 104, 0.72)");
    gradient.addColorStop(0.18, "rgba(239, 119, 36, 0.38)");
    gradient.addColorStop(0.4, "rgba(130, 45, 14, 0.14)");
    gradient.addColorStop(0.68, "rgba(40, 8, 0, 0)");
    gradient.addColorStop(1.0, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    texture.update();
    texture.hasAlpha = true;

    const material = new StandardMaterial("candleFloorGlowMaterial", this.scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.emissiveColor = new Color3(1.0, 0.43, 0.12);
    material.diffuseColor = new Color3(0.92, 0.34, 0.1);
    material.alpha = 0.58;
    material.alphaMode = BabylonMaterial.MATERIAL_ALPHABLEND;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    return material;
  }

  async loadStartBlocker() {
    if (this.startBlockerLoaded) return;
    this.startBlockerLoaded = true;

    this.noSpawnZones.push({
      x: 0,
      z: (START_BLOCKER_Z + START_FOREST_CLOSURE_Z) * 0.5,
      width: 30,
      depth: 30,
    });

    await this.createFallenTreeBlocker();
    this.createStartForestClosure();

    this.staticBoxColliders.push(
      {
        x: 0,
        z: START_BLOCKER_Z,
        width: 12.5,
        depth: 2.2,
        rotation: 0,
        active: true,
        kind: "blocker",
      },
      {
        x: 0,
        z: START_FOREST_CLOSURE_Z,
        width: 28,
        depth: 5.5,
        rotation: 0,
        active: true,
        kind: "blocker",
      }
    );
  }

  private async createFallenTreeBlocker() {
    const res = await SceneLoader.ImportMeshAsync(
      null,
      START_BLOCKER_TREE_PATH,
      START_BLOCKER_TREE_FILE,
      this.scene
    );

    const root = new TransformNode("startFallenTreeBlockerRoot", this.scene);
    for (const mesh of res.meshes) {
      mesh.setParent(root);
      mesh.isPickable = false;
      mesh.receiveShadows = true;
    }

    root.computeWorldMatrix(true);
    for (const mesh of res.meshes) mesh.computeWorldMatrix(true);
    const initialBounds = this.getHierarchyBounds(res.meshes);
    if (!initialBounds) return;

    const initialWidth = initialBounds.max.x - initialBounds.min.x;
    const initialDepth = initialBounds.max.z - initialBounds.min.z;
    root.rotation.y = initialDepth > initialWidth ? Math.PI * 0.5 : 0;

    const longAxis = Math.max(initialWidth, initialDepth, 0.001);
    root.scaling.setAll(10.5 / longAxis);
    root.computeWorldMatrix(true);
    for (const mesh of res.meshes) mesh.computeWorldMatrix(true);

    const scaledBounds = this.getHierarchyBounds(res.meshes);
    if (!scaledBounds) return;

    const centerX = (scaledBounds.min.x + scaledBounds.max.x) * 0.5;
    const centerZ = (scaledBounds.min.z + scaledBounds.max.z) * 0.5;
    const groundY = this.terrain.getHeightAt(0, START_BLOCKER_Z);
    root.position.x -= centerX;
    root.position.z += START_BLOCKER_Z - centerZ;
    root.position.y += groundY - scaledBounds.min.y + 0.04;
  }

  private createStartForestClosure() {
    const placements = [
      { x: -10.5, z: -17.2, scale: 1.45, rot: 0.2 },
      { x: -7.2, z: -18.8, scale: 1.7, rot: 1.8 },
      { x: -3.8, z: -16.6, scale: 1.5, rot: 2.5 },
      { x: 0.0, z: -19.4, scale: 1.85, rot: 0.9 },
      { x: 3.7, z: -16.9, scale: 1.55, rot: 2.9 },
      { x: 7.4, z: -18.5, scale: 1.7, rot: 1.2 },
      { x: 10.6, z: -17.0, scale: 1.45, rot: 2.1 },
    ];

    placements.forEach((placement, index) => {
      const tree = this.treeLibrary.instantiateByIndex(
        `startClosureTree_${index}`,
        this.scene,
        index,
        0
      );
      tree.position.set(
        placement.x,
        this.terrain.getHeightAt(placement.x, placement.z),
        placement.z
      );
      tree.scaling.setAll(placement.scale);
      tree.rotation.y = placement.rot;
      tree.freezeWorldMatrix();
      this.registerIsometricOccluder(tree);
    });
  }

  private patchCandleMaterial(mesh: Mesh) {
    const material = mesh.material as BabylonMaterial | null;
    if (!material) return;

    const cloned = material.clone(`${material.name}_${mesh.name}_candle`);
    if (!cloned) return;
    mesh.material = cloned;

    const multi = cloned as any;
    if (Array.isArray(multi.subMaterials) && multi.subMaterials.length) {
      multi.subMaterials = multi.subMaterials.map((subMaterial: BabylonMaterial | null, index: number) => {
        if (!subMaterial) return subMaterial;
        const subClone = subMaterial.clone(`${subMaterial.name}_${mesh.name}_candle_${index}`);
        if (!subClone) return subMaterial;
        this.patchCandleSubMaterial(subClone, this.isCandleWickMaterial(subClone));
        return subClone;
      });
      return;
    }

    this.patchCandleSubMaterial(cloned, this.isCandleWickMaterial(cloned));
  }

  private isCandleWickMaterial(material: BabylonMaterial) {
    const name = material.name.toLowerCase();
    return name.includes("material.002") || name.includes("wick") || name.includes("mecha");
  }

  private patchCandleSubMaterial(material: BabylonMaterial, isWick: boolean) {
    material.backFaceCulling = false;

    if (material instanceof PBRMaterial) {
      material.metallic = 0;
      material.roughness = isWick ? 0.95 : 0.72;
      material.environmentIntensity = isWick ? 0.05 : 0.35;
      material.directIntensity = isWick ? 0.6 : 1.1;
      material.specularIntensity = isWick ? 0 : 0.18;

      if (isWick) {
        material.albedoTexture = null;
        material.emissiveTexture = null;
        material.albedoColor = new Color3(0.005, 0.004, 0.003);
        material.emissiveColor = Color3.Black();
      } else {
        material.albedoColor = new Color3(0.95, 0.82, 0.56);
        material.emissiveColor = new Color3(0.02, 0.012, 0.004);
      }
      return;
    }

    if (material instanceof StandardMaterial) {
      if (isWick) {
        material.diffuseTexture = null;
        material.emissiveColor = Color3.Black();
        material.diffuseColor = new Color3(0.005, 0.004, 0.003);
        material.specularColor = Color3.Black();
      } else {
        material.diffuseColor = new Color3(0.88, 0.74, 0.49);
        material.emissiveColor = new Color3(0.015, 0.009, 0.003);
        material.specularColor = new Color3(0.08, 0.06, 0.04);
      }
    }
  }

  private candlePlacementsForSegment(segmentId: number) {
    const segLen = this.cfg.segmentLength;
    const startZ = segmentId * segLen;
    const rng = this.rngForSegment(segmentId ^ 0xca7d1e);
    const placements: { x: number; z: number; rotationY: number }[] = [];

    for (let i = 0; i < CANDLES_PER_SIDE; i++) {
      const z = startZ + segLen * ((i + 0.5) / CANDLES_PER_SIDE);
      const stagger = (rng() - 0.5) * 0.22;
      placements.push(
        { x: -CANDLE_PATH_X - stagger, z, rotationY: rng() * Math.PI * 2 },
        { x: CANDLE_PATH_X + stagger, z, rotationY: rng() * Math.PI * 2 }
      );
    }

    return placements.filter((placement) => !this.isInNoSpawnZone(placement.x, placement.z, 0.6));
  }

  private isReservedForCandle(x: number, z: number, margin = 0) {
    const segmentId = Math.floor(z / this.cfg.segmentLength);
    const radius = CANDLE_RESERVE_RADIUS + margin;
    const radiusSq = radius * radius;

    for (let id = segmentId - 1; id <= segmentId + 1; id++) {
      for (const placement of this.candlePlacementsForSegment(id)) {
        const dx = x - placement.x;
        const dz = z - placement.z;
        if (dx * dx + dz * dz <= radiusSq) return true;
      }
    }

    return false;
  }

  private instantiateCandle(name: string, scale: number | Vector3) {
    const root = new TransformNode(name, this.scene);
    const template = this.candleTemplate;
    if (!template) return root;

    for (const src of template.meshes) {
      const inst = src.clone(`${name}_${src.name}`, root);
      if (!inst) continue;
      inst.setEnabled(true);
      inst.isVisible = true;
      inst.visibility = 1;
      inst.isPickable = false;
      inst.receiveShadows = true;
      inst.alwaysSelectAsActiveMesh = true;
      inst.position.copyFrom(src.position);
      inst.rotation.copyFrom(src.rotation);
      if (src.rotationQuaternion) inst.rotationQuaternion = src.rotationQuaternion.clone();
      inst.scaling.copyFrom(src.scaling);
      inst.parent = root;
    }

    root.setEnabled(true);
    if (typeof scale === "number") root.scaling.setAll(scale);
    else root.scaling.copyFrom(scale);
    return root;
  }

  instantiateCandleAsset(name: string, scale: Vector3) {
    const template = this.candleTemplate;
    if (!template) return null;

    const root = this.instantiateCandle(name, scale);
    return {
      root,
      baseOffsetY: template.baseOffsetY * scale.y,
      topOffsetY: (template.baseOffsetY + template.topOffsetY) * scale.y,
    };
  }

  private createCandles(_centerZ: number, segmentId: number): SegCandlePack {
    const nodes: TransformNode[] = [];
    if (!this.candleTemplate || !this.candleFireMaterial || !this.candleGlowMaterial || !this.candleFloorGlowMaterial) {
      return { nodes };
    }

    const placements = this.candlePlacementsForSegment(segmentId);
    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i];
      const groundY = this.terrain.getHeightAt(placement.x, placement.z);
      const root = this.instantiateCandle(`candle_${segmentId}_${i}`, CANDLE_MODEL_SCALE);
      root.position.set(
        placement.x,
        groundY - this.candleTemplate.baseOffsetY * CANDLE_MODEL_SCALE - CANDLE_GROUND_SINK,
        placement.z
      );
      root.rotation.y = placement.rotationY;

      const flameY =
        root.position.y +
        this.candleTemplate.topOffsetY * CANDLE_MODEL_SCALE -
        CANDLE_FLAME_WICK_TIP_INSET * CANDLE_MODEL_SCALE;
      const fire = this.createCandleFire(
        `candleFlame_${segmentId}_${i}`,
        new Vector3(placement.x, flameY, placement.z),
        placement.rotationY,
        CANDLE_MODEL_SCALE,
        CANDLE_LIGHT_BASE_INTENSITY,
        CANDLE_LIGHT_RANGE
      );

      nodes.push(root, fire.root, fire.floorGlow);
      this.colliders.push({
        x: placement.x,
        z: placement.z,
        radius: CANDLE_COLLISION_RADIUS,
        segmentId,
        kind: "candle",
      });
    }

    return { nodes };
  }

  private createCandleFire(
    name: string,
    position: Vector3,
    rotationY: number,
    candleScale: number,
    lightIntensity: number,
    lightRange: number,
    fadeInSeconds = SEGMENT_CANDLE_FADE_SECONDS
  ) {
    const size = candleScale / CANDLE_MODEL_SCALE;
    const flameWidth = CANDLE_FLAME_WIDTH * size;
    const flameHeight = CANDLE_FLAME_HEIGHT * size;
    const root = new TransformNode(`${name}Root`, this.scene);
    root.position.copyFrom(position);
    root.rotation.y = rotationY;

    const flame = MeshBuilder.CreatePlane(`${name}Plane`, { width: flameWidth, height: flameHeight }, this.scene);
    flame.parent = root;
    flame.position.y = flameHeight * 0.5;
    flame.material = this.candleFireMaterial;
    flame.isPickable = false;
    flame.billboardMode = Mesh.BILLBOARDMODE_ALL;
    flame.visibility = fadeInSeconds > 0 ? 0 : 1;

    const glow = MeshBuilder.CreatePlane(`${name}Glow`, { width: flameWidth * 2.4, height: flameHeight * 1.9 }, this.scene);
    glow.parent = root;
    glow.position.y = flameHeight * 0.55;
    glow.material = this.candleGlowMaterial;
    glow.isPickable = false;
    glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
    glow.visibility = fadeInSeconds > 0 ? 0 : 0.64;

    const floorGlowSize = Math.max(4.6, 5.6 * size);
    const sideSign = position.x === 0 ? 0 : Math.sign(position.x);
    const floorGlow = MeshBuilder.CreatePlane(
      `${name}FloorGlow`,
      { width: floorGlowSize, height: floorGlowSize },
      this.scene
    );
    floorGlow.position.set(
      position.x - sideSign * 1.15,
      this.terrain.getHeightAt(position.x, position.z) + 0.045,
      position.z
    );
    floorGlow.rotation.x = Math.PI / 2;
    floorGlow.material = this.candleFloorGlowMaterial;
    floorGlow.isPickable = false;
    floorGlow.visibility = fadeInSeconds > 0 ? 0 : 0.52;
    floorGlow.alwaysSelectAsActiveMesh = true;

    const sparks = Array.from({ length: 3 }, (_, sparkIndex) => {
      const spark = MeshBuilder.CreatePlane(
        `${name}Spark_${sparkIndex}`,
        { width: flameWidth * 0.16, height: flameWidth * 0.16 },
        this.scene
      );
      spark.parent = root;
      spark.position.set(0, flameHeight * 0.76, 0);
      spark.material = this.candleGlowMaterial;
      spark.isPickable = false;
      spark.billboardMode = Mesh.BILLBOARDMODE_ALL;
      spark.visibility = 0;
      return spark;
    });

    this.candleLights.push({
      root,
      baseIntensity: lightIntensity,
      lightRange,
      phase: (this.candleLights.length % 17) * 1.37,
      age: fadeInSeconds > 0 ? 0 : fadeInSeconds,
      fadeInSeconds,
      flame,
      glow,
      floorGlow,
      sparks,
      flameHeight,
    });

    return { root, floorGlow };
  }

  private registerCandleFlicker() {
    if (this.candleFlickerRegistered) return;
    this.candleFlickerRegistered = true;

    let t = 0;
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = Math.max(0, Math.min(this.scene.getEngine().getDeltaTime() * 0.001, 0.05));
      t += dt;
      for (const entry of this.candleLights) {
        entry.age += dt;
        if (!entry.root.isEnabled(true)) continue;
        const fade =
          entry.fadeInSeconds > 0
            ? Math.min(1, entry.age / entry.fadeInSeconds)
            : 1;
        const flicker =
          Math.sin(t * 16.0 + entry.phase) * 0.13 +
          Math.sin(t * 29.0 + entry.phase * 0.61) * 0.075 +
          Math.sin(t * 47.0 + entry.phase * 1.23) * 0.04;

        const bend = Math.sin(t * 8.6 + entry.phase) * 0.06 + Math.sin(t * 17.5 + entry.phase * 0.4) * 0.024;
        const stretch = 1 + Math.sin(t * 11.8 + entry.phase * 0.7) * 0.085 + Math.sin(t * 24.0 + entry.phase) * 0.045;
        const width = 1 + Math.sin(t * 15.5 + entry.phase * 1.9) * 0.055;
        entry.root.rotation.z = bend;
        entry.flame.visibility = fade;
        entry.flame.scaling.set(width, stretch, 1);
        entry.flame.position.x = 0;
        entry.flame.position.y = (entry.flameHeight * stretch) * 0.5;

        const glowPulse = 1 + flicker * 1.15;
        entry.glow.scaling.set(glowPulse, glowPulse, 1);
        entry.glow.position.x = 0;
        entry.glow.position.y = entry.flameHeight * (0.54 + (stretch - 1) * 0.25);
        entry.glow.visibility = Math.max(0.25, Math.min(0.68, 0.45 + flicker * 0.9)) * fade;
        const floorPulse = 1 + flicker * 0.14;
        entry.floorGlow.scaling.set(floorPulse, floorPulse, 1);
        entry.floorGlow.visibility = Math.max(0.12, Math.min(0.32, 0.22 + flicker * 0.18)) * fade;

        entry.sparks.forEach((spark, sparkIndex) => {
          const sparkPhase = entry.phase + sparkIndex * 2.17;
          const cycle = (Math.sin(t * (4.2 + sparkIndex * 0.7) + sparkPhase) + 1) * 0.5;
          const pulse = Math.max(0, Math.sin(cycle * Math.PI * 2 - Math.PI * 0.2));
          const drift = (cycle - 0.5) * 0.12;
          spark.visibility = (pulse > 0.6 ? (pulse - 0.6) * 0.45 : 0) * fade;
          spark.scaling.set(0.42 + pulse * 0.42, 0.42 + pulse * 0.42, 1);
          spark.position.x = Math.sin(t * 2.4 + sparkPhase) * 0.035 + drift * 0.04;
          spark.position.y = entry.flameHeight * (0.72 + cycle * 0.32);
        });
      }

      const intensityBlend = 1 - Math.exp(-CANDLE_LIGHT_INTENSITY_RESPONSE * dt);
      const positionBlend = 1 - Math.exp(-CANDLE_LIGHT_POSITION_RESPONSE * dt);
      for (const pool of this.candleLightPool) {
        if (!pool.initialized && pool.targetIntensity > 0.001) {
          pool.light.position.copyFrom(pool.targetPosition);
          pool.initialized = true;
        } else if (pool.initialized) {
          Vector3.LerpToRef(
            pool.light.position,
            pool.targetPosition,
            positionBlend,
            pool.light.position
          );
        }

        pool.currentIntensity +=
          (pool.targetIntensity - pool.currentIntensity) * intensityBlend;
        pool.currentRange += (pool.targetRange - pool.currentRange) * intensityBlend;
        const poolFlicker =
          Math.sin(t * 10.2 + pool.side * 1.73) * 0.025 +
          Math.sin(t * 18.7 + pool.side * 0.83) * 0.012;
        pool.light.intensity = Math.max(0, pool.currentIntensity * (1 + poolFlicker));
        pool.light.range = pool.currentRange;
      }
    });
  }

  private updateCandleLightTargets(playerPosition: Vector3) {
    for (const pool of this.candleLightPool) {
      let totalWeight = 0;
      let combinedInfluence = 0;
      let weightedIntensity = 0;
      let weightedRange = 0;
      let weightedX = 0;
      let weightedY = 0;
      let weightedZ = 0;

      for (const entry of this.candleLights) {
        if (!entry.root.isEnabled(true)) continue;
        const position = entry.root.getAbsolutePosition();
        const entrySide = position.x < 0 ? -1 : 1;
        if (entrySide !== pool.side) continue;

        const dx = position.x - playerPosition.x;
        const dz = position.z - playerPosition.z;
        const distance = Math.hypot(dx, dz);
        const influence =
          1 -
          smoothstep(
            CANDLE_LIGHT_FULL_INFLUENCE_RADIUS,
            CANDLE_LIGHT_FADE_RADIUS,
            distance
          );
        if (influence <= 0) continue;

        const weight = influence * influence;
        totalWeight += weight;
        combinedInfluence = 1 - (1 - combinedInfluence) * (1 - influence);
        weightedX += position.x * weight;
        weightedY += position.y * weight;
        weightedZ += position.z * weight;
        weightedIntensity += entry.baseIntensity * weight;
        weightedRange += entry.lightRange * weight;
      }

      if (totalWeight <= 0.0001) {
        pool.targetIntensity = 0;
        continue;
      }

      const inverseWeight = 1 / totalWeight;
      pool.targetPosition.set(
        weightedX * inverseWeight,
        weightedY * inverseWeight,
        weightedZ * inverseWeight
      );
      pool.targetIntensity =
        (weightedIntensity / totalWeight) * clamp(combinedInfluence, 0, 1);
      pool.targetRange = weightedRange / totalWeight;
    }
  }

  peekInteractable(cameraOrLook: Camera | { origin: Vector3; direction: Vector3 }) {
    const origin = "globalPosition" in cameraOrLook ? cameraOrLook.globalPosition : cameraOrLook.origin;
    const direction = "globalPosition" in cameraOrLook
      ? cameraOrLook.getDirection(Vector3.Forward())
      : cameraOrLook.direction;
    const ray = new Ray(origin, direction, INTERACTION_RAY_LENGTH);
    const hit = this.scene.pickWithRay(ray, (m) => !!m.metadata?.interactable);
    return hit?.hit ? hit.pickedMesh : null;
  }

  async loadEndHouse() {
    const segmentLength = this.cfg.segmentLength;
    const targetFrontZ = segmentLength * (this.cfg.endHouseSegment ?? 8);
    const scale = END_HOUSE_MODEL_SCALE;

    const res = await SceneLoader.ImportMeshAsync(
      null,
      "/assets/models/house/",
      "wooden_house.glb",
      this.scene
    );

    const root =
      res.meshes.find((mesh) => mesh.name === "__root__") ??
      res.meshes.find((mesh) => mesh.parent === null);

    if (!root) {
      console.warn("[Segments] No se pudo crear la casa: el GLB no trajo root.");
      return;
    }

    root.name = "endHouseRoot";
    root.scaling.setAll(scale);
    root.rotation.y = Math.PI;
    root.position.set(0, this.terrain.getHeightAt(0, targetFrontZ), targetFrontZ);
    root.computeWorldMatrix(true);

    for (const mesh of res.meshes) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.computeWorldMatrix(true);
    }
    this.endHouseMeshes = res.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    this.patchHouseMaterials(res.meshes);

    const firstBounds = this.getHierarchyBounds(res.meshes);
    if (!firstBounds) return;

    const centerX = (firstBounds.min.x + firstBounds.max.x) * 0.5;
    root.position.x -= centerX;
    root.position.z += targetFrontZ - firstBounds.min.z;
    root.computeWorldMatrix(true);

    for (const mesh of res.meshes) mesh.computeWorldMatrix(true);

    const bounds = this.getHierarchyBounds(res.meshes);
    if (!bounds) return;

    const groundY = this.terrain.getHeightAt(0, targetFrontZ);
    const floorBounds = this.getMeshBounds(
      res.meshes.find((mesh) => mesh.name.toLowerCase().includes("floor"))
    );
    const groundAnchorY = floorBounds?.min.y ?? bounds.min.y;
    root.position.y += groundY - groundAnchorY + 0.02;
    root.computeWorldMatrix(true);

    for (const mesh of res.meshes) mesh.computeWorldMatrix(true);

    const finalBounds = this.getHierarchyBounds(res.meshes);
    if (!finalBounds) return;

    this.noSpawnZones.push({
      x: (finalBounds.min.x + finalBounds.max.x) * 0.5,
      z: (finalBounds.min.z + finalBounds.max.z) * 0.5,
      width: finalBounds.max.x - finalBounds.min.x + 10,
      depth: finalBounds.max.z - finalBounds.min.z + 10,
    });

    this.createHouseColliders(finalBounds);
    this.createHouseMeshColliders(res.meshes);
    this.createHouseDoor(res.meshes, finalBounds);
    const candlePosition = this.createHouseCandle(finalBounds);
    await createPhotoCard(this.scene, finalBounds, { candlePosition });
  }

  private createHouseCandle(bounds: { min: Vector3; max: Vector3 }) {
    if (!this.candleTemplate || !this.candleFireMaterial || !this.candleGlowMaterial || !this.candleFloorGlowMaterial) {
      return null;
    }

    const width = bounds.max.x - bounds.min.x;
    const depth = bounds.max.z - bounds.min.z;
    const x = (bounds.min.x + bounds.max.x) * 0.5 - Math.min(1.6, width * 0.16);
    const z = bounds.min.z + depth * 0.56;
    const floorY = bounds.min.y + 0.08;
    const root = this.instantiateCandle(
      "endHouseCandle",
      new Vector3(HOUSE_CANDLE_DIAMETER_SCALE, HOUSE_CANDLE_HEIGHT_SCALE, HOUSE_CANDLE_DIAMETER_SCALE)
    );

    root.position.set(
      x,
      floorY - this.candleTemplate.baseOffsetY * HOUSE_CANDLE_HEIGHT_SCALE,
      z
    );
    root.rotation.y = Math.PI * 0.22;

    const flameY =
      root.position.y +
      this.candleTemplate.topOffsetY * HOUSE_CANDLE_HEIGHT_SCALE -
      CANDLE_FLAME_WICK_TIP_INSET * HOUSE_CANDLE_HEIGHT_SCALE;
    this.createCandleFire(
      "endHouseCandleFlame",
      new Vector3(x, flameY, z),
      root.rotation.y,
      HOUSE_CANDLE_DIAMETER_SCALE,
      1.15,
      14,
      0
    );

    return new Vector3(x, floorY, z);
  }

  private patchHouseMaterials(meshes: AbstractMesh[]) {
    const patchedSolid = new Set<BabylonMaterial>();
    const patchedAlpha = new Set<BabylonMaterial>();

    for (const mesh of meshes) {
      const material = mesh.material as BabylonMaterial | null;
      if (!material) continue;

      const meshName = mesh.name.toLowerCase();
      const materialName = material.name.toLowerCase();
      const isGlass =
        meshName.includes("window") ||
        materialName.includes("window") ||
        materialName === "material.010";
      const usesCutout =
        meshName.includes("roof") ||
        meshName.includes("curtain") ||
        materialName.includes("curtain") ||
        material.alphaMode === BabylonMaterial.MATERIAL_ALPHABLEND ||
        material.transparencyMode === BabylonMaterial.MATERIAL_ALPHABLEND;

      if (isGlass) {
        if (patchedAlpha.has(material)) continue;
        patchedAlpha.add(material);

        material.alpha = 0.28;
        material.alphaMode = BabylonMaterial.MATERIAL_ALPHABLEND;
        material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
        material.backFaceCulling = false;
        (material as any).forceDepthWrite = false;
        (material as any).needDepthPrePass = false;
        (material as any).alphaIndex = 8;

        if (material instanceof PBRMaterial) {
          material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
          material.useAlphaFromAlbedoTexture = false;
          material.metallic = 0;
          material.roughness = 0.08;
          material.specularIntensity = 0.85;
          material.environmentIntensity = 0.55;
        }

        if (material instanceof StandardMaterial) {
          material.specularColor.set(0.45, 0.55, 0.65);
        }
        continue;
      }

      if (usesCutout) {
        if (patchedAlpha.has(material)) continue;
        patchedAlpha.add(material);

        material.alpha = 1;
        material.alphaMode = BabylonMaterial.MATERIAL_ALPHATEST;
        material.transparencyMode = BabylonMaterial.MATERIAL_ALPHATEST;
        material.backFaceCulling = false;
        (material as any).forceDepthWrite = true;
        (material as any).needDepthPrePass = true;

        if (material instanceof PBRMaterial) {
          material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
          material.useAlphaFromAlbedoTexture = true;
          material.alphaCutOff = 0.12;
        } else if (material instanceof StandardMaterial) {
          material.alphaCutOff = 0.12;
        }

        const alphaTexture = (material as any).albedoTexture ?? (material as any).diffuseTexture;
        if (alphaTexture) alphaTexture.hasAlpha = true;
        continue;
      }

      if (patchedSolid.has(material)) continue;
      patchedSolid.add(material);

      material.alpha = 1;
      material.alphaMode = BabylonMaterial.MATERIAL_OPAQUE;
      material.transparencyMode = BabylonMaterial.MATERIAL_OPAQUE;
      material.backFaceCulling = false;
      (material as any).forceDepthWrite = true;
      (material as any).needDepthPrePass = false;

      if (material instanceof PBRMaterial) {
        material.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
        material.useAlphaFromAlbedoTexture = false;
      }
    }
  }

  private getHierarchyBounds(meshes: AbstractMesh[]) {
    const renderable = meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    if (!renderable.length) return null;

    const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (const mesh of renderable) {
      mesh.refreshBoundingInfo({});
      const box = mesh.getBoundingInfo().boundingBox;
      min.copyFrom(Vector3.Minimize(min, box.minimumWorld));
      max.copyFrom(Vector3.Maximize(max, box.maximumWorld));
    }

    return { min, max };
  }

  private getMeshBounds(mesh: AbstractMesh | undefined) {
    if (!mesh || mesh.getTotalVertices() <= 0) return null;
    mesh.refreshBoundingInfo({});
    const box = mesh.getBoundingInfo().boundingBox;
    return {
      min: box.minimumWorld.clone(),
      max: box.maximumWorld.clone(),
    };
  }

  private createDoorLamp(doorCenterX: number, doorCenterZ: number, doorTopY: number) {
    const lampPosition = new Vector3(doorCenterX, doorTopY + 0.34, doorCenterZ - 0.28);

    const bulbMat = new StandardMaterial("endHouseDoorLampBulbMat", this.scene);
    bulbMat.diffuseColor = new Color3(1.0, 0.72, 0.38);
    bulbMat.emissiveColor = new Color3(1.0, 0.58, 0.22);
    bulbMat.specularColor = new Color3(1.0, 0.78, 0.45);

    const capMat = new StandardMaterial("endHouseDoorLampCapMat", this.scene);
    capMat.diffuseColor = new Color3(0.12, 0.085, 0.055);
    capMat.emissiveColor = new Color3(0.01, 0.006, 0.003);
    capMat.specularColor = new Color3(0.16, 0.11, 0.07);

    const backPlate = MeshBuilder.CreateBox(
      "endHouseDoorLampBackPlate",
      { width: 0.42, height: 0.22, depth: 0.06 },
      this.scene
    );
    backPlate.position.set(lampPosition.x, lampPosition.y + 0.03, lampPosition.z + 0.04);
    backPlate.material = capMat;
    backPlate.isPickable = false;

    const cap = MeshBuilder.CreateCylinder(
      "endHouseDoorLampCap",
      { height: 0.14, diameterTop: 0.22, diameterBottom: 0.3, tessellation: 16 },
      this.scene
    );
    cap.position.copyFrom(lampPosition);
    cap.rotation.x = Math.PI * 0.5;
    cap.material = capMat;
    cap.isPickable = false;

    const bulb = MeshBuilder.CreateSphere(
      "endHouseDoorLampBulb",
      { diameter: 0.18, segments: 16 },
      this.scene
    );
    bulb.position.set(lampPosition.x, lampPosition.y - 0.08, lampPosition.z - 0.03);
    bulb.material = bulbMat;
    bulb.isPickable = false;

    const glow = new PointLight("endHouseDoorLampGlow", bulb.position.clone(), this.scene);
    glow.diffuse = new Color3(1.0, 0.62, 0.28);
    glow.specular = new Color3(1.0, 0.58, 0.25);
    glow.intensity = 0.75;
    glow.range = 5.5;

    const cone = new SpotLight(
      "endHouseDoorLampSpot",
      bulb.position.add(new Vector3(0, -0.02, -0.04)),
      new Vector3(0, -0.72, -0.45),
      Math.PI * 0.42,
      1.8,
      this.scene
    );
    cone.diffuse = new Color3(1.0, 0.58, 0.24);
    cone.specular = new Color3(1.0, 0.48, 0.18);
    cone.intensity = 3.1;
    cone.range = 8.5;
  }

  private isInNoSpawnZone(x: number, z: number, margin = 0) {
    return this.noSpawnZones.some((zone) => {
      const halfW = zone.width * 0.5 + margin;
      const halfD = zone.depth * 0.5 + margin;
      return Math.abs(x - zone.x) <= halfW && Math.abs(z - zone.z) <= halfD;
    });
  }

  private createHouseColliders(bounds: { min: Vector3; max: Vector3 }) {
    const wallThickness = 0.65;
    const minX = bounds.min.x;
    const maxX = bounds.max.x;
    const minZ = bounds.min.z;
    const maxZ = bounds.max.z;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;

    this.staticBoxColliders.push(
      {
        x: minX + wallThickness * 0.5,
        z: centerZ,
        width: wallThickness,
        depth,
        rotation: 0,
        active: true,
        kind: "house",
      },
      {
        x: maxX - wallThickness * 0.5,
        z: centerZ,
        width: wallThickness,
        depth,
        rotation: 0,
        active: true,
        kind: "house",
      },
      {
        x: centerX,
        z: maxZ - wallThickness * 0.5,
        width,
        depth: wallThickness,
        rotation: 0,
        active: true,
        kind: "house",
      }
    );
  }

  private createHouseMeshColliders(meshes: AbstractMesh[]) {
    const collisionNames = ["houseleft", "houseright", "houseback"];

    for (const mesh of meshes) {
      const name = mesh.name.toLowerCase();
      if (!collisionNames.some((part) => name.includes(part))) continue;
      if (mesh instanceof Mesh && this.addHouseTriangleColliders(mesh) > 0) continue;

      const bounds = this.getMeshBounds(mesh);
      if (!bounds) continue;

      const width = bounds.max.x - bounds.min.x;
      const depth = bounds.max.z - bounds.min.z;
      const height = bounds.max.y - bounds.min.y;
      const thinAxis = Math.min(width, depth);
      if (height < 0.35 || width < 0.08 || depth < 0.08) continue;

      if (thinAxis > 1.8) continue;

      this.staticBoxColliders.push({
        x: (bounds.min.x + bounds.max.x) * 0.5,
        z: (bounds.min.z + bounds.max.z) * 0.5,
        width: Math.max(width, 0.5),
        depth: Math.max(depth, 0.5),
        rotation: 0,
        active: true,
        kind: "house",
      });
    }
  }

  private addHouseTriangleColliders(mesh: Mesh) {
    const positions = mesh.getVerticesData("position");
    const indices = mesh.getIndices();
    if (!positions || !indices) return 0;

    mesh.computeWorldMatrix(true);
    const world = mesh.getWorldMatrix();
    const wallThickness = 0.26;
    let added = 0;

    for (let i = 0; i < indices.length; i += 3) {
      const points = [0, 1, 2].map((offset) => {
        const vertexIndex = indices[i + offset] * 3;
        return Vector3.TransformCoordinates(
          new Vector3(
            positions[vertexIndex],
            positions[vertexIndex + 1],
            positions[vertexIndex + 2]
          ),
          world
        );
      });

      const min = points.reduce((acc, point) => Vector3.Minimize(acc, point), points[0].clone());
      const max = points.reduce((acc, point) => Vector3.Maximize(acc, point), points[0].clone());
      const width = max.x - min.x;
      const height = max.y - min.y;
      const depth = max.z - min.z;
      if (height < 0.45 || (width < 0.08 && depth < 0.08)) continue;

      this.staticBoxColliders.push({
        x: (min.x + max.x) * 0.5,
        z: (min.z + max.z) * 0.5,
        width: Math.max(width, width >= depth ? 0.1 : wallThickness),
        depth: Math.max(depth, depth > width ? 0.1 : wallThickness),
        rotation: 0,
        active: true,
        kind: "house",
      });
      added++;
    }

    return added;
  }

  private createHouseDoor(meshes: AbstractMesh[], houseBounds: { min: Vector3; max: Vector3 }) {
    const doorMesh = meshes.find((mesh) => mesh.name.toLowerCase().includes("door"));
    const houseCenterX = (houseBounds.min.x + houseBounds.max.x) * 0.5;
    const doorBounds = doorMesh?.getBoundingInfo().boundingBox;
    const doorCenterX = doorBounds
      ? (doorBounds.minimumWorld.x + doorBounds.maximumWorld.x) * 0.5
      : houseCenterX;
    const doorCenterZ = doorBounds
      ? (doorBounds.minimumWorld.z + doorBounds.maximumWorld.z) * 0.5
      : houseBounds.min.z + 0.22;
    const doorCenterY = doorBounds
      ? (doorBounds.minimumWorld.y + doorBounds.maximumWorld.y) * 0.5
      : this.terrain.getHeightAt(doorCenterX, doorCenterZ) + 1.1;
    this.endHouseCheckpoint = new Vector3(doorCenterX, doorCenterY, doorCenterZ);
    const doorWidth = doorBounds
      ? Math.max(2.6, Math.min(5.6, doorBounds.maximumWorld.x - doorBounds.minimumWorld.x + 1.05))
      : 3.4;
    const doorHeight = doorBounds
      ? Math.max(2.8, doorBounds.maximumWorld.y - doorBounds.minimumWorld.y + 0.8)
      : 3.2;
    const collider: BoxCollider = {
      x: doorCenterX,
      z: doorCenterZ,
      width: doorWidth,
      depth: 0.95,
      rotation: 0,
      active: true,
      kind: "door",
    };
    this.staticBoxColliders.push(collider);

    this.addFrontWallColliders(houseBounds, doorCenterX, doorWidth, doorCenterZ);

    const picker = MeshBuilder.CreateBox(
      "endHouseDoorInteraction",
      { width: doorWidth, height: doorHeight, depth: 0.9 },
      this.scene
    );
    picker.position.set(doorCenterX, doorCenterY, doorCenterZ);
    picker.visibility = 0;
    picker.isPickable = true;

    const closedPosition = doorMesh?.position.clone();
    const closedRotation = doorMesh?.rotation.clone();
    const closedRotationQuaternion = doorMesh?.rotationQuaternion?.clone();
    let open = false;
    let amount = 0;
    let target = 0;
    let openDelayTimer: number | null = null;
    let closeColliderTimer: number | null = null;

    const clearDoorTimers = () => {
      if (openDelayTimer !== null) {
        window.clearTimeout(openDelayTimer);
        openDelayTimer = null;
      }
      if (closeColliderTimer !== null) {
        window.clearTimeout(closeColliderTimer);
        closeColliderTimer = null;
      }
    };

    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      const speed = 3.5;
      amount += (target - amount) * Math.min(1, dt * speed);
      const angle = -amount * Math.PI * 0.55;

      if (!doorMesh) return;
      if (closedPosition) doorMesh.position.copyFrom(closedPosition);
      if (closedRotationQuaternion) {
        doorMesh.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), angle).multiply(
          closedRotationQuaternion
        );
      } else if (closedRotation) {
        doorMesh.rotation.copyFrom(closedRotation);
        doorMesh.rotation.y += angle;
      }
    });

    picker.metadata = {
      interactable: true,
      type: "door",
      onInteract: () => {
        if (openDelayTimer !== null) {
          return {
            message: "La puerta se esta abriendo.",
            suppressAction: true,
          };
        }

        if (!open) {
          clearDoorTimers();
          openDelayTimer = window.setTimeout(() => {
            open = true;
            target = 1;
            collider.active = false;
            openDelayTimer = null;
          }, DOOR_OPEN_ACTION_DELAY_SECONDS * 1000);

          return {
            message: "Abris la puerta.",
            actionType: "door",
            movementLockSeconds: DOOR_OPEN_ACTION_DELAY_SECONDS,
          };
        }

        clearDoorTimers();
        open = false;
        target = 0;
        collider.active = false;
        closeColliderTimer = window.setTimeout(() => {
          collider.active = true;
          closeColliderTimer = null;
        }, DOOR_CLOSE_COLLIDER_GRACE_SECONDS * 1000);

        return {
          message: "Cerras la puerta.",
          suppressAction: true,
        };

      },
    };
    this.createDoorLamp(
      doorCenterX,
      doorCenterZ,
      doorBounds?.maximumWorld.y ?? doorCenterY + doorHeight * 0.5
    );
  }

  private addFrontWallColliders(
    bounds: { min: Vector3; max: Vector3 },
    doorCenterX: number,
    doorWidth: number,
    doorZ: number
  ) {
    const wallThickness = 0.65;
    const frontZ = doorZ;
    const gapHalf = Math.max(doorWidth * 0.5 + 0.85, 1.9);
    const leftMin = bounds.min.x;
    const leftMax = doorCenterX - gapHalf;
    const rightMin = doorCenterX + gapHalf;
    const rightMax = bounds.max.x;

    if (leftMax > leftMin) {
      this.staticBoxColliders.push({
        x: (leftMin + leftMax) * 0.5,
        z: frontZ,
        width: leftMax - leftMin,
        depth: wallThickness,
        rotation: 0,
        active: true,
        kind: "house",
      });
    }

    if (rightMax > rightMin) {
      this.staticBoxColliders.push({
        x: (rightMin + rightMax) * 0.5,
        z: frontZ,
        width: rightMax - rightMin,
        depth: wallThickness,
        rotation: 0,
        active: true,
        kind: "house",
      });
    }
  }

  // =========================
  // 🌿 GRASS
  // =========================
  private initGrass() {
    const bases = this.grassLibrary.getAll();
    if (!bases.length) return;

    this.grassBases = bases;
    for (const b of bases) {
      b.setEnabled(true);
      b.isPickable = false;
      b.alwaysSelectAsActiveMesh = true;

      // Bounding amplio (thin instances)
      b.setBoundingInfo(
        new BoundingInfo(new Vector3(-120, -20, -12000), new Vector3(120, 20, 12000))
      );
    }
  }

  private buildGrassForSegment(segmentId: number) {
    if (!this.grassBases) return;

    const rng = this.rngForSegment(segmentId);
    const segLen = this.cfg.segmentLength;
    const centerZ = (segmentId + 0.5) * segLen;

    // camino
    const pathHalf = 4;
    const minX = pathHalf + 2;

    // ✅ NO hardcodear: viene del Terrain
    const wallStart = this.terrain.mountainStart;              // donde arranca la ladera
    const playable = this.terrain.playableHalfWidth;           // límite jugable recomendado

    // ✅ el pasto llega hasta el pie de montaña, pero sin invadir la pared
    const grassMargin = 2.5;
    const grassMaxX = Math.min(playable, wallStart - grassMargin);

    // fade suave para que no haya “línea”
    const fadeWidth = 10;
    const fadeStart = Math.max(minX + 1, grassMaxX - fadeWidth);

    // densidad base del segmento (ring 0 real)
    const COUNT = this.cfg.grassBuildCount ?? 2500;
    const buffers: Float32Array[] = [];

    for (let b = 0; b < this.grassBases.length; b++) {
      const data: number[] = [];

      for (let i = 0; i < COUNT; i++) {
        const z = centerZ + (rng() - 0.5) * segLen;
        const side = rng() < 0.5 ? -1 : 1;

        // distribución lateral
        const span = Math.max(1, grassMaxX - minX);
        const xAbs = minX + rng() * span;
        const x = side * xAbs;
        if (this.isInNoSpawnZone(x, z, 1.5)) continue;
        if (this.isReservedForCandle(x, z, 0.35)) continue;

        // fade de densidad cerca del borde
        let densityMul = 1.0;
        if (xAbs > fadeStart) {
          const t = (xAbs - fadeStart) / fadeWidth; // 0..1
          densityMul = 1.0 - t;                     // 1..0
        }
        if (rng() > densityMul) continue;

        const y = this.terrain.getHeightAt(x, z) + 0.02;

        const scale = 0.22 + rng() * 0.42;
        const rotY = rng() * Math.PI * 2;

        const m = Matrix.Compose(
          new Vector3(scale, scale, scale),
          Quaternion.FromEulerAngles(0, rotY, 0),
          new Vector3(x, y, z)
        );

        const arr = new Float32Array(16);
        m.copyToArray(arr);
        data.push(...arr);
      }

      buffers.push(new Float32Array(data));
    }

    this.grassSegments.set(segmentId, buffers);
  }

  private applyCombinedGrassBuffers(needed: Set<number>, currentSeg: number) {
    if (!this.grassBases) return;
    let buffers = this.combinedGrassSegments.get(currentSeg);
    if (!buffers) {
      buffers = this.combineInstanceBuffers(
        this.grassSegments,
        needed,
        this.grassBases.length,
        this.stableGrassCount()
      );
      this.combinedGrassSegments.set(currentSeg, buffers);
    }

    for (let b = 0; b < this.grassBases.length; b++) {
      this.grassBases[b].thinInstanceSetBuffer("matrix", buffers[b], 16, true);
      this.grassBases[b].thinInstanceRefreshBoundingInfo(true);
    }
  }

  // =========================
  // PLANTS
  // =========================
  private initPlants() {
    const bases = this.plantLibrary.getAll();
    if (!bases.length) return;

    this.plantBases = bases;
    for (const b of bases) {
      b.setEnabled(true);
      b.isPickable = false;
      b.alwaysSelectAsActiveMesh = true;
    }
  }

  private buildPlantsForSegment(segmentId: number) {
    if (!this.plantBases) return;

    const rng = this.rngForSegment(segmentId ^ 0x51A7);
    const segLen = this.cfg.segmentLength;
    const centerZ = (segmentId + 0.5) * segLen;

    const pathHalf = 4;
    const minX = pathHalf + 1.2;
    const wallStart = this.terrain.mountainStart;
    const playable = this.terrain.playableHalfWidth;
    const plantMaxX = Math.min(playable, wallStart - 4, 24);

    const COUNT = this.cfg.plantBuildCount ?? 120;
    const buffers: Float32Array[] = [];

    for (let b = 0; b < this.plantBases.length; b++) {
      const data: number[] = [];

      for (let i = 0; i < COUNT; i++) {
        const z = centerZ + (rng() - 0.5) * segLen;
        const side = rng() < 0.5 ? -1 : 1;
        const xAbs = minX + rng() * Math.max(1, plantMaxX - minX);
        const x = side * xAbs;
        if (this.isInNoSpawnZone(x, z, 2.5)) continue;
        if (this.isReservedForCandle(x, z, 0.8)) continue;
        const scale = 0.85 + rng() * 0.75;
        const y = this.terrain.getHeightAt(x, z) + this.plantLibrary.getGroundOffset(b) * scale + 0.03;

        const rotY = rng() * Math.PI * 2;

        const m = Matrix.Compose(
          new Vector3(scale, scale, scale),
          Quaternion.FromEulerAngles(0, rotY, 0),
          new Vector3(x, y, z)
        );

        const arr = new Float32Array(16);
        m.copyToArray(arr);
        data.push(...arr);
      }

      buffers.push(new Float32Array(data));
    }

    this.plantSegments.set(segmentId, buffers);
  }

  private applyCombinedPlantBuffers(needed: Set<number>, currentSeg: number) {
    if (!this.plantBases) return;
    let buffers = this.combinedPlantSegments.get(currentSeg);
    if (!buffers) {
      buffers = this.combineInstanceBuffers(
        this.plantSegments,
        needed,
        this.plantBases.length,
        this.stablePlantCount()
      );
      this.combinedPlantSegments.set(currentSeg, buffers);
    }

    for (let b = 0; b < this.plantBases.length; b++) {
      this.plantBases[b].thinInstanceSetBuffer("matrix", buffers[b], 16, true);
      this.plantBases[b].thinInstanceRefreshBoundingInfo(true);
    }
  }

  private combineInstanceBuffers(
    segmentBuffers: Map<number, Float32Array[]>,
    needed: Set<number>,
    baseCount: number,
    instanceLimit: number
  ) {
    const combinedBuffers: Float32Array[] = [];

    for (let baseIndex = 0; baseIndex < baseCount; baseIndex++) {
      const parts: Float32Array[] = [];
      let totalLength = 0;

      if (instanceLimit > 0) {
        for (const segmentId of needed) {
          const buffer = segmentBuffers.get(segmentId)?.[baseIndex];
          if (!buffer) continue;

          const instanceCount = Math.min(instanceLimit, buffer.length / 16);
          const part = buffer.subarray(0, instanceCount * 16);
          parts.push(part);
          totalLength += part.length;
        }
      }

      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const part of parts) {
        combined.set(part, offset);
        offset += part.length;
      }
      combinedBuffers.push(combined);
    }

    return combinedBuffers;
  }

  // =========================
  // TREES
  // =========================
  private createTrees(centerZ: number, segmentId: number, lod: 0 | 1 | 2) {
    const rng = this.rngForSegment(segmentId);
    const instances: any[] = [];

    const TREES = this.cfg.treeCount ?? 60;
    const segLen = this.cfg.segmentLength;

    const pathHalf = 4;
    const minX = pathHalf + 2;
    const maxX = Math.min(30, this.terrain.playableHalfWidth);

    for (let i = 0; i < TREES; i++) {
      const z = centerZ + (rng() - 0.5) * segLen;
      const side = rng() < 0.5 ? -1 : 1;

      const x = side * (minX + rng() * Math.max(1, maxX - minX));
      if (this.isInNoSpawnZone(x, z, 4)) continue;
      const y = this.terrain.getHeightAt(x, z);

      const scale = 0.9 + rng() * 0.7;
      const rotY = rng() * Math.PI * 2;

      const templateIndex = Math.floor(rng() * 1_000_000);
      const radius = this.treeLibrary.getCollisionRadius(templateIndex) * scale;
      if (this.isReservedForCandle(x, z, radius)) continue;

      const tree = this.treeLibrary.instantiateByIndex(
        `tree_${segmentId}_${i}`,
        this.scene,
        templateIndex,
        lod
      );

      tree.position.set(x, y, z);
      tree.scaling.setAll(scale);
      tree.rotation.y = rotY;

      this.colliders.push({ x, z, radius, segmentId, kind: "tree" });

      tree.freezeWorldMatrix();
      this.registerIsometricOccluder(tree);
      instances.push(tree);
    }

    return instances;
  }

  // =========================
  // 🪨 ROCKS
  // =========================
  private createRocks(centerZ: number, segmentId: number) {
    const rng = this.rngForSegment(segmentId ^ 0xABCDEF);
    const instances: any[] = [];
    const ROCKS = this.cfg.rockCount ?? 14;

    for (let i = 0; i < ROCKS; i++) {
      const z = centerZ + (rng() - 0.5) * this.cfg.segmentLength * 2;
      const side = rng() < 0.5 ? -1 : 1;
      const x = side * (6 + rng() * 25);
      if (this.isInNoSpawnZone(x, z, 3)) continue;
      const y = this.terrain.getHeightAt(x, z);

      const scale = 0.6 + rng() * 1.8;
      const templateIndex = Math.floor(rng() * 1_000_000);
      const radius = this.rockLibrary.getCollisionRadius(templateIndex) * scale;
      if (this.isReservedForCandle(x, z, radius)) continue;

      this.colliders.push({ x, z, radius, segmentId, kind: "rock" });

      const r = this.rockLibrary.instantiateByIndex(
        `rock_${segmentId}_${i}`,
        this.scene,
        templateIndex
      );

      r.position.set(x, y, z);
      r.scaling.setAll(scale);
      r.rotation.y = rng() * Math.PI * 2;

      instances.push(r);
    }

    return instances;
  }

  // =========================
  // STREAMING HELPERS
  // =========================
  private stableGrassCount() {
    const counts = this.cfg.grassRingCounts ?? [2500, 800, 100];
    return counts[1] ?? counts[0] ?? 0;
  }

  private stablePlantCount() {
    const counts = this.cfg.plantRingCounts ?? [120, 40, 10];
    return counts[1] ?? counts[0] ?? this.cfg.plantFarCount ?? 0;
  }
}
