import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

type WindMesh = {
  mesh: Mesh;
  basePositions: Float32Array;
  animatedPositions: Float32Array;
  strength: number;
  phase: number;
  minY: number;
  height: number;
};

export class GrassLibrary {
  private prototypes: Mesh[] = [];
  private windMeshes: WindMesh[] = [];
  private windTime = 0;

  async load(scene: Scene, maxTemplates = Number.POSITIVE_INFINITY) {
    const sources = [
      { root: "/assets/models/plants/", file: "plant1.glb", scale: 0.45 },
      { root: "/assets/models/plants/", file: "plant2.glb", scale: 0.22 },
    ];

    for (const source of sources.slice(0, maxTemplates)) {
      try {
        const res = await SceneLoader.ImportMeshAsync(
          null,
          source.root,
          source.file,
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

        merged.scaling.setAll(source.scale);
        merged.bakeCurrentTransformIntoVertices();
        merged.position.set(0, 0, 0);
        merged.scaling.set(1, 1, 1);
        merged.rotation.set(0, 0, 0);
        merged.rotationQuaternion = null;
        merged.setEnabled(false);
        merged.isPickable = false;
        this.patchGrassMaterial(merged.material);
        this.prepareWindMesh(merged, this.prototypes.length);

        this.prototypes.push(merged);
      } catch (error) {
        console.warn(`[GrassLibrary] Could not load ${source.file}`, error);
      }
    }

    if (!this.prototypes.length) {
      console.warn("[GrassLibrary] No grass replacement plants loaded. Check /public/assets/models/plants/");
    }
  }

  getAll(): Mesh[] {
    return this.prototypes;
  }

  updateWind(dt: number) {
    if (!this.windMeshes.length) return;

    this.windTime += dt;
    const t = this.windTime;

    for (const item of this.windMeshes) {
      const { basePositions, animatedPositions, minY, height, strength, phase } = item;

      for (let i = 0; i < basePositions.length; i += 3) {
        const x = basePositions[i];
        const y = basePositions[i + 1];
        const z = basePositions[i + 2];
        const bend = Math.pow(Math.max(0, Math.min(1, (y - minY) / height)), 1.7);
        const gust = Math.sin(t * 1.8 + x * 2.3 + z * 1.7 + phase);
        const flutter = Math.sin(t * 4.2 + x * 5.1 - z * 2.2 + phase * 0.7);
        const sway = (gust * 0.75 + flutter * 0.25) * strength * bend;

        animatedPositions[i] = x + sway;
        animatedPositions[i + 1] = y;
        animatedPositions[i + 2] = z + sway * 0.35;
      }

      item.mesh.updateVerticesData(VertexBuffer.PositionKind, animatedPositions, false, false);
    }
  }

  private prepareWindMesh(mesh: Mesh, index: number) {
    const source = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!source?.length) return;

    const basePositions = new Float32Array(source);
    const animatedPositions = new Float32Array(source);

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 1; i < basePositions.length; i += 3) {
      minY = Math.min(minY, basePositions[i]);
      maxY = Math.max(maxY, basePositions[i]);
    }

    mesh.setVerticesData(VertexBuffer.PositionKind, basePositions, true);
    this.windMeshes.push({
      mesh,
      basePositions,
      animatedPositions,
      strength: 0.055 + index * 0.008,
      phase: index * 1.37,
      minY,
      height: Math.max(0.001, maxY - minY),
    });
  }

  private patchGrassMaterial(material: Material | null) {
    if (!material) return;

    const materials = (material as any).subMaterials?.length
      ? (material as any).subMaterials
      : [material];

    for (const mat of materials) {
      if (!mat) continue;

      mat.alpha = 1;
      mat.alphaMode = Material.MATERIAL_ALPHATEST;
      mat.backFaceCulling = false;
      mat.forceDepthWrite = true;
      (mat as any).maxSimultaneousLights = 8;
      (mat as any).needDepthPrePass = true;

      const alphaTexture = mat.albedoTexture ?? mat.diffuseTexture;
      if (alphaTexture) alphaTexture.hasAlpha = true;

      if (mat instanceof PBRMaterial) {
        mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        mat.useAlphaFromAlbedoTexture = true;
        mat.twoSidedLighting = true;
        mat.forceNormalForward = true;
        mat.alphaCutOff = 0.45;
        mat.metallic = 0;
        mat.roughness = 0.7;
        mat.directIntensity = 0.94;
        mat.environmentIntensity = 0.07;
        mat.specularIntensity = 0.02;
        mat.maxSimultaneousLights = 8;
      }

      if (mat instanceof StandardMaterial) {
        mat.twoSidedLighting = true;
        mat.maxSimultaneousLights = 8;
        mat.alphaCutOff = 0.45;
        mat.specularColor.set(0.02, 0.02, 0.02);
        mat.diffuseColor.scaleInPlace(0.72);
      }
    }
  }
}
