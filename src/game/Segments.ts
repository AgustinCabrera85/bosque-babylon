import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Matrix, Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { Ray } from "@babylonjs/core/Culling/ray";

import { mulberry32 } from "../utils/seed";

import type { TerrainHandle } from "./Terrain";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { TreeLibrary } from "./TreeLibrary";
import type { GrassLibrary } from "./GrassLibrary";
import type { PlantLibrary } from "./PlantLibrary";
import type { RockLibrary } from "./RockLibrary";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

type Collider = {
  x: number;
  z: number;
  radius: number;
  segmentId: number;
  kind: "tree" | "rock";
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
};

type SegTreePack = { nodes: TransformNode[]; lod: 0 | 1 | 2 };
type SegRockPack = { nodes: TransformNode[] };

export class Segments {
  private readonly WORLD_SEED = 1337;

  private grassInitialized = false;
  private plantsInitialized = false;
  private lastSegment: number | null = null;

  private treeSegments = new Map<number, SegTreePack>();
  private rockSegments = new Map<number, SegRockPack>();
  private grassSegments = new Map<number, Float32Array[]>();
  private plantSegments = new Map<number, Float32Array[]>();

  private colliders: Collider[] = [];
  private interactables: Interactable[] = [];

  private grassBases: Mesh[] | null = null;
  private plantBases: Mesh[] | null = null;

  constructor(
    private scene: Scene,
    private terrain: TerrainHandle,
    private treeLibrary: TreeLibrary,
    private grassLibrary: GrassLibrary,
    private plantLibrary: PlantLibrary,
    private rockLibrary: RockLibrary,
    private cfg: SegmentCfg
  ) {}

  // =========================
  // RNG por segmento (FIJO)
  // =========================
  private rngForSegment(segmentId: number) {
    return mulberry32((this.WORLD_SEED * 1000003) ^ (segmentId * 9176));
  }

  // =========================
  // LOD por distancia (segmento)
  // =========================
  private lodFor(segmentId: number, currentSeg: number): 0 | 1 | 2 {
    const d = Math.abs(segmentId - currentSeg);
    if (d === 0) return 0;
    if (d <= 2) return 1;
    return 2;
  }

  private segmentRange(currentSeg: number, behind: number, ahead: number) {
    const needed = new Set<number>();
    for (let o = -behind; o <= ahead; o++) {
      needed.add(currentSeg + o);
    }
    return needed;
  }

  // =========================
  // UPDATE
  // =========================
  update(camZ: number): void {
    if (!this.grassInitialized) {
      this.initGrass();
      this.grassInitialized = true;
    }
    if (!this.plantsInitialized) {
      this.initPlants();
      this.plantsInitialized = true;
    }

    const segLen = this.cfg.segmentLength;
    const currentSeg = Math.floor(camZ / segLen);
    const segmentChanged = this.lastSegment !== currentSeg;

    const grassNeeded = this.segmentRange(currentSeg, this.cfg.behind, this.cfg.ahead);
    const objectNeeded = this.segmentRange(
      currentSeg,
      this.cfg.objectBehind ?? this.cfg.behind,
      this.cfg.objectAhead ?? this.cfg.ahead
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

    // ---------- TREES + ROCKS ----------
    for (const id of objectNeeded) {
      const centerZ = (id + 0.5) * segLen;

      const desiredLOD = this.lodFor(id, currentSeg);
      const prev = this.treeSegments.get(id);

      if (!prev) {
        const nodes = this.createTrees(centerZ, id, desiredLOD);
        this.treeSegments.set(id, { nodes, lod: desiredLOD });
      } else if (desiredLOD !== prev.lod) {
        prev.nodes.forEach((n) => n.dispose?.());
        this.removeColliders(id, "tree");
        const nodes = this.createTrees(centerZ, id, desiredLOD);
        this.treeSegments.set(id, { nodes, lod: desiredLOD });
      }

      if (!this.rockSegments.has(id)) {
        const nodes = this.createRocks(centerZ, id);
        this.rockSegments.set(id, { nodes });
      }
    }

    // cleanup SOLO al cambiar segmento
    if (!segmentChanged) return;
    this.lastSegment = currentSeg;

    this.cleanup(grassNeeded, plantNeeded, objectNeeded);
  }

  // =========================
  // COLLISION
  // =========================
  isColliding(x: number, z: number) {
    const R = 1.0;
    for (const c of this.colliders) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (R + c.radius) ** 2) return true;
    }
    return false;
  }

  private cleanup(
    grassNeeded: Set<number>,
    plantNeeded: Set<number>,
    objectNeeded: Set<number>
  ) {
    for (const [id, pack] of this.treeSegments) {
      if (!objectNeeded.has(id)) {
        pack.nodes.forEach((n) => n.dispose?.());
        this.treeSegments.delete(id);
      }
    }

    for (const [id, pack] of this.rockSegments) {
      if (!objectNeeded.has(id)) {
        pack.nodes.forEach((n) => n.dispose?.());
        this.rockSegments.delete(id);
      }
    }

    this.colliders = this.colliders.filter((c) => objectNeeded.has(c.segmentId));
    this.interactables = this.interactables.filter((i) => objectNeeded.has(i.segmentId));

    for (const id of this.grassSegments.keys()) {
      if (!grassNeeded.has(id)) this.grassSegments.delete(id);
    }

    for (const id of this.plantSegments.keys()) {
      if (!plantNeeded.has(id)) this.plantSegments.delete(id);
    }
  }

  private removeColliders(segmentId: number, kind: Collider["kind"]) {
    this.colliders = this.colliders.filter(
      (c) => c.segmentId !== segmentId || c.kind !== kind
    );
  }

  // =========================
  // INTERACTION
  // =========================
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

  peekInteractable(camera: Camera) {
    const ray = new Ray(camera.globalPosition, camera.getDirection(Vector3.Forward()), 3);
    const hit = this.scene.pickWithRay(ray, (m) => !!m.metadata?.interactable);
    return hit?.hit ? hit.pickedMesh : null;
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

    for (let b = 0; b < this.grassBases.length; b++) {
      const parts: Float32Array[] = [];

      for (const segId of needed) {
        const ring = this.getRing(segId, currentSeg);
        const want = this.grassCountForRing(ring);
        if (want <= 0) continue;

        const segBuffers = this.grassSegments.get(segId);
        if (!segBuffers) continue;

        const buf = segBuffers[b];
        const max = buf.length / 16;
        const use = Math.min(want, max);

        parts.push(buf.subarray(0, use * 16));
      }

      let total = 0;
      parts.forEach((p) => (total += p.length));

      const combined = new Float32Array(total);
      let off = 0;
      for (const p of parts) {
        combined.set(p, off);
        off += p.length;
      }

      this.grassBases[b].thinInstanceSetBuffer("matrix", combined, 16, true);
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

    for (let b = 0; b < this.plantBases.length; b++) {
      const parts: Float32Array[] = [];

      for (const segId of needed) {
        const ring = this.getRing(segId, currentSeg);
        const want = this.plantCountForRing(ring);
        if (want <= 0) continue;

        const segBuffers = this.plantSegments.get(segId);
        if (!segBuffers) continue;

        const buf = segBuffers[b];
        const max = buf.length / 16;
        const use = Math.min(want, max);

        parts.push(buf.subarray(0, use * 16));
      }

      let total = 0;
      parts.forEach((p) => (total += p.length));

      const combined = new Float32Array(total);
      let off = 0;
      for (const p of parts) {
        combined.set(p, off);
        off += p.length;
      }

      this.plantBases[b].thinInstanceSetBuffer("matrix", combined, 16, true);
      this.plantBases[b].thinInstanceRefreshBoundingInfo(true);
    }
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
      const y = this.terrain.getHeightAt(x, z);

      const scale = 0.9 + rng() * 0.7;
      const rotY = rng() * Math.PI * 2;

      const templateIndex = Math.floor(rng() * 1_000_000);

      const tree = this.treeLibrary.instantiateByIndex(
        `tree_${segmentId}_${i}`,
        this.scene,
        templateIndex,
        lod
      );

      tree.position.set(x, y, z);
      tree.scaling.setAll(scale);
      tree.rotation.y = rotY;

      const radius = this.treeLibrary.getCollisionRadius(templateIndex) * scale;
      this.colliders.push({ x, z, radius, segmentId, kind: "tree" });

      tree.freezeWorldMatrix();
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
      const y = this.terrain.getHeightAt(x, z);

      const scale = 0.6 + rng() * 1.8;
      const templateIndex = Math.floor(rng() * 1_000_000);
      const radius = this.rockLibrary.getCollisionRadius(templateIndex) * scale;

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
  // LOD HELPERS
  // =========================
  private getRing(segId: number, currentSeg: number) {
    const d = Math.abs(segId - currentSeg);
    if (d === 0) return 0;
    if (d === 1) return 1;
    if (d === 2) return 2;
    return 999;
  }

  private grassCountForRing(ring: number) {
    const counts = this.cfg.grassRingCounts ?? [2500, 800, 100];
    if (ring === 0) return counts[0];
    if (ring === 1) return counts[1];
    if (ring === 2) return counts[2];
    return 0;
  }

  private plantCountForRing(ring: number) {
    const counts = this.cfg.plantRingCounts ?? [120, 40, 10];
    if (ring === 0) return counts[0];
    if (ring === 1) return counts[1];
    if (ring === 2) return counts[2];
    return this.cfg.plantFarCount ?? 0;
  }
}
