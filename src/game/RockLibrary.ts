import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";

type RockTemplate = {
  name: string;
  root: TransformNode;
  meshes: Mesh[];
};

export class RockLibrary {
  private templates: RockTemplate[] = [];

  async load(scene: Scene) {
    const files = [
      "rock_01.glb",
      "rock_02.glb",
      "rock_03.glb",
      "rock_04.glb",
      "rock_05.glb",
      "rock_06.glb",
    ];

    for (const file of files) {
      const res = await SceneLoader.ImportMeshAsync(
        null,
        "/assets/models/vegetation/",
        file,
        scene
      );

      const root = new TransformNode(`rockRoot_${file}`, scene);

      // Solo meshes renderizables (con vértices)
      const meshes = res.meshes.filter(
        (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0
      );

      if (!meshes.length) {
        console.warn(`[RockLibrary] ${file}: no encontré meshes renderizables`);
        root.dispose();
        continue;
      }

      // Parentear al root + ocultar prototipos
      for (const m of meshes) {
        m.setParent(root);
        m.setEnabled(false);
        m.isPickable = false;

        // Importante: evitar problemas si el GLB comparte materiales entre modelos
        // (en rocas suele ser ok, pero esto te protege de “side effects”)
        this.ensureUniqueMaterial(m);
      }

      root.setEnabled(false);
      this.templates.push({ name: file, root, meshes });
    }

    if (!this.templates.length) {
      console.warn(
        "[RockLibrary] No se cargaron rocas. Revisá /public/assets/models/vegetation/"
      );
    }
  }

  // ======================================================
  // ✅ Recomendado: instanciar por índice (mundo determinista)
  // ======================================================
  instantiateByIndex(instanceName: string, scene: Scene, templateIndex: number): TransformNode {
    if (!this.templates.length) {
      throw new Error("[RockLibrary] No hay templates cargados. Llamá await rockLibrary.load(scene) antes.");
    }

    const idx = ((templateIndex % this.templates.length) + this.templates.length) % this.templates.length;
    const tpl = this.templates[idx];

    return this.instantiateFromTemplate(instanceName, scene, tpl);
  }

  // ======================================================
  // Legacy: random (si lo seguís usando)
  // ======================================================
  instantiateRandom(instanceName: string, scene: Scene): TransformNode {
    if (!this.templates.length) {
      throw new Error("[RockLibrary] No hay templates cargados. Llamá await rockLibrary.load(scene) antes.");
    }

    const tpl = this.templates[Math.floor(Math.random() * this.templates.length)];
    return this.instantiateFromTemplate(instanceName, scene, tpl);
  }

  // ======================================================
  // Internals
  // ======================================================
  private instantiateFromTemplate(instanceName: string, scene: Scene, tpl: RockTemplate): TransformNode {
    const instRoot = new TransformNode(instanceName, scene);

    for (const src of tpl.meshes) {
      const inst = src.createInstance(`${instanceName}_${src.name}`);
      inst.setEnabled(true);
      inst.isPickable = false;

      // Mantener offsets locales del modelo
      inst.position.copyFrom(src.position);

      // Rotación correcta
      if (src.rotationQuaternion) {
        inst.rotationQuaternion = src.rotationQuaternion.clone();
      } else {
        inst.rotation.copyFrom(src.rotation);
      }

      inst.scaling.copyFrom(src.scaling);

      // Parent al root de la instancia
      inst.setParent(instRoot);
    }

    return instRoot;
  }

  /**
   * Muchos GLB reutilizan el mismo material entre meshes.
   * Si después cambiás props en runtime, podés afectar a todos.
   * Esto clona el material una vez por mesh prototipo (barato y seguro).
   */
  private ensureUniqueMaterial(mesh: AbstractMesh) {
    const mat = mesh.material as Material | null;
    if (!mat) return;

    // Si el material ya fue clonado para este mesh, no hagas nada
    // (Babylon pone `uniqueId`, pero lo más simple: si el nombre ya tiene sufijo)
    if (mat.name.endsWith("_rockUnique")) return;

    const cloned = mat.clone(`${mat.name}_rockUnique`) as Material;
    mesh.material = cloned;
  }
}
