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
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";

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

type BoxCollider = {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  active: boolean;
  kind: "house" | "door";
};

type NoSpawnZone = {
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
  private staticBoxColliders: BoxCollider[] = [];
  private noSpawnZones: NoSpawnZone[] = [
    { x: 0, z: 70 * 8 + 18, width: 76, depth: 100 },
  ];
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
    for (const c of this.staticBoxColliders) {
      if (!c.active) continue;
      if (this.isPointInsideBoxCollider(x, z, R, c)) return true;
    }
    return false;
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

  async loadEndHouse() {
    const segmentLength = this.cfg.segmentLength;
    const targetFrontZ = segmentLength * 8;
    const scale = 0.99;

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
    this.createHouseDoor(res.meshes, finalBounds);
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
    const doorWidth = doorBounds
      ? Math.max(1.8, Math.min(3.6, doorBounds.maximumWorld.x - doorBounds.minimumWorld.x + 0.85))
      : 2.4;
    const doorHeight = doorBounds
      ? Math.max(2.8, doorBounds.maximumWorld.y - doorBounds.minimumWorld.y + 0.8)
      : 3.2;
    const collider: BoxCollider = {
      x: doorCenterX,
      z: doorCenterZ,
      width: doorWidth,
      depth: 0.7,
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
        open = !open;
        target = open ? 1 : 0;
        collider.active = !open;
        return open ? "Abrís la puerta." : "Cerrás la puerta.";
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
    const gapHalf = Math.max(doorWidth + 1.15, 2.7);
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
        if (this.isInNoSpawnZone(x, z, 2.5)) continue;
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
      if (this.isInNoSpawnZone(x, z, 4)) continue;
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
      if (this.isInNoSpawnZone(x, z, 3)) continue;
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
