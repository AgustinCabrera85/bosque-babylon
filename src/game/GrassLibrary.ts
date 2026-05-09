import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";

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
        this.prepareWindMesh(merged, this.prototypes.length);

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
}
