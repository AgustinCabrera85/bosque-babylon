import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";

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
      const res = await SceneLoader.ImportMeshAsync(
        null,
        "/assets/models/vegetation/",
        file,
        scene
      );

      // Tomamos TODOS los meshes con vértices (muchos GLB vienen con root + hijos)
      const renderables = res.meshes.filter(
        (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0
      );

      if (!renderables.length) continue;

      // Merge a un solo mesh: thinInstances funciona mejor si el prototipo es 1 mesh “limpio”
      const merged = Mesh.MergeMeshes(
        renderables,
        true,  // dispose source
        true,  // allow 32 bits indices
        undefined,
        false, // no subdivide
        true   // multiMaterial (por si trae varios)
      );

      if (!merged) continue;

      // 🔥 Normalizar: bakear el transform actual a los vértices
      merged.bakeCurrentTransformIntoVertices();

      // Reset total: el prototipo queda identity
      merged.position.set(0, 0, 0);
      merged.scaling.set(1, 1, 1);
      merged.rotation.set(0, 0, 0);
      merged.rotationQuaternion = null;

      merged.setEnabled(false);
      merged.isPickable = false;

      // Opcional: si tu pasto sale “al revés” SIEMPRE, descomentá esto:
      // merged.rotationQuaternion = Quaternion.FromEulerAngles(Math.PI, 0, 0);
      // merged.bakeCurrentTransformIntoVertices();
      // merged.rotationQuaternion = null;
      // merged.rotation.set(0,0,0);

      this.prototypes.push(merged);
    }

    if (!this.prototypes.length) {
      console.warn("[GrassLibrary] No se cargó pasto. Verificá la ruta /public/assets/models/vegetation/");
    }
  }

  getAll(): Mesh[] {
    return this.prototypes;
  }
}
