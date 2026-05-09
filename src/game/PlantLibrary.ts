import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { asset } from "../utils/asset";

export class PlantLibrary {
  private prototypes: Mesh[] = [];
  private groundOffsets: number[] = [];

  async load(scene: Scene, maxTemplates = Number.POSITIVE_INFINITY) {
    const files = [
      "plant1.glb",
      "plant2.glb",
      "plant3.glb",
    ];

    for (const file of files.slice(0, maxTemplates)) {
      try {
        const res = await SceneLoader.ImportMeshAsync(
          null,
          asset("assets/models/plants/"),
          file,
          scene
        );

        const renderables = res.meshes.filter(
          (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0
        );

        if (!renderables.length) continue;

        const merged = Mesh.MergeMeshes(
          renderables,
          true,
          true,
          undefined,
          false,
          true
        );

        if (!merged) continue;

        merged.bakeCurrentTransformIntoVertices();
        merged.refreshBoundingInfo(true);
        const minY = merged.getBoundingInfo().boundingBox.minimum.y;

        merged.position.set(0, 0, 0);
        merged.scaling.set(1, 1, 1);
        merged.rotation.set(0, 0, 0);
        merged.rotationQuaternion = null;
        merged.setEnabled(false);
        merged.isPickable = false;
        merged.alwaysSelectAsActiveMesh = true;
        this.patchPlantMaterial(merged.material);
        merged.setBoundingInfo(
          new BoundingInfo(new Vector3(-120, -20, -12000), new Vector3(120, 20, 12000))
        );

        this.prototypes.push(merged);
        this.groundOffsets.push(Math.max(0, -minY));
      } catch (error) {
        console.warn(`[PlantLibrary] Could not load ${file}`, error);
      }
    }

    if (!this.prototypes.length) {
      console.warn("[PlantLibrary] No plants loaded. Check /public/assets/models/plants/");
    }
  }

  getAll(): Mesh[] {
    return this.prototypes;
  }

  getGroundOffset(index: number): number {
    if (!this.groundOffsets.length) return 0;
    const idx = ((index % this.groundOffsets.length) + this.groundOffsets.length) % this.groundOffsets.length;
    return this.groundOffsets[idx];
  }

  private patchPlantMaterial(material: Material | null) {
    if (!material) return;

    const materials = (material as any).subMaterials?.length
      ? (material as any).subMaterials
      : [material];

    for (const mat of materials) {
      if (!mat) continue;

      mat.backFaceCulling = false;

      if (mat instanceof PBRMaterial) {
        mat.useAlphaFromAlbedoTexture = true;
        mat.alphaCutOff = 0.45;
        mat.specularIntensity = 0;
      }

      if (mat instanceof StandardMaterial) {
        mat.alphaCutOff = 0.45;
        mat.specularColor.set(0, 0, 0);
      }
    }
  }
}
