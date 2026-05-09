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
      try {
        const res = await SceneLoader.ImportMeshAsync(
          null,
          "/assets/models/vegetation/",
          file,
          scene
        );

        const root = new TransformNode(`rockRoot_${file}`, scene);
        const meshes = res.meshes.filter(
          (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0
        );

        if (!meshes.length) {
          console.warn(`[RockLibrary] ${file}: no renderable meshes found`);
          root.dispose();
          continue;
        }

        for (const m of meshes) {
          m.setParent(root);
          m.setEnabled(false);
          m.isPickable = false;
          this.ensureUniqueMaterial(m);
        }

        root.setEnabled(false);
        this.templates.push({ name: file, root, meshes });
      } catch (error) {
        console.warn(`[RockLibrary] Could not load ${file}`, error);
      }
    }

    if (!this.templates.length) {
      console.warn("[RockLibrary] No rocks loaded. Check /public/assets/models/vegetation/");
    }
  }

  instantiateByIndex(instanceName: string, scene: Scene, templateIndex: number): TransformNode {
    if (!this.templates.length) {
      console.warn("[RockLibrary] No rock templates available.");
      return new TransformNode(instanceName, scene);
    }

    const idx = ((templateIndex % this.templates.length) + this.templates.length) % this.templates.length;
    const tpl = this.templates[idx];
    return this.instantiateFromTemplate(instanceName, scene, tpl);
  }

  instantiateRandom(instanceName: string, scene: Scene): TransformNode {
    if (!this.templates.length) {
      console.warn("[RockLibrary] No rock templates available.");
      return new TransformNode(instanceName, scene);
    }

    const tpl = this.templates[Math.floor(Math.random() * this.templates.length)];
    return this.instantiateFromTemplate(instanceName, scene, tpl);
  }

  private instantiateFromTemplate(instanceName: string, scene: Scene, tpl: RockTemplate): TransformNode {
    const instRoot = new TransformNode(instanceName, scene);

    for (const src of tpl.meshes) {
      const inst = src.createInstance(`${instanceName}_${src.name}`);
      inst.setEnabled(true);
      inst.isPickable = false;
      inst.position.copyFrom(src.position);

      if (src.rotationQuaternion) {
        inst.rotationQuaternion = src.rotationQuaternion.clone();
      } else {
        inst.rotation.copyFrom(src.rotation);
      }

      inst.scaling.copyFrom(src.scaling);
      inst.setParent(instRoot);
    }

    return instRoot;
  }

  private ensureUniqueMaterial(mesh: AbstractMesh) {
    const mat = mesh.material as Material | null;
    if (!mat) return;
    if (mat.name.endsWith("_rockUnique")) return;

    const cloned = mat.clone(`${mat.name}_rockUnique`) as Material;
    mesh.material = cloned;
  }
}
