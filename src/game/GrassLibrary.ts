import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

export class GrassLibrary {
  private prototypes: Mesh[] = [];

  async load(scene: Scene) {
    const files = [
      "grass_00.glb",
      "grass_01.glb",
      "grass_02.glb",
      "grass_03.glb",
      "grass_04.glb",
    ];

    for (const file of files) {
      try {
        const res = await SceneLoader.ImportMeshAsync(
          null,
          "/assets/models/vegetation/",
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
        merged.position.set(0, 0, 0);
        merged.scaling.set(1, 1, 1);
        merged.rotation.set(0, 0, 0);
        merged.rotationQuaternion = null;
        merged.setEnabled(false);
        merged.isPickable = false;

        this.prototypes.push(merged);
      } catch (error) {
        console.warn(`[GrassLibrary] Could not load ${file}`, error);
      }
    }

    if (!this.prototypes.length) {
      console.warn("[GrassLibrary] No grass loaded. Check /public/assets/models/vegetation/");
    }
  }

  getAll(): Mesh[] {
    return this.prototypes;
  }
}
