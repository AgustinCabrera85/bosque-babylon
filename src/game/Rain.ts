import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { TerrainHandle } from "./Terrain";

/**
 * Lightweight rain: one mesh with thin instances instead of hundreds of meshes.
 */
export function createRainSystem(scene: Scene, terrain: TerrainHandle) {
  const COUNT = 500;
  const matrices = new Float32Array(COUNT * 16);
  const xs = new Float32Array(COUNT);
  const ys = new Float32Array(COUNT);
  const zs = new Float32Array(COUNT);

  const mat = new StandardMaterial("rainMat", scene);
  mat.emissiveColor.set(0.6, 0.65, 0.7);
  mat.alpha = 0.35;

  const drops = MeshBuilder.CreateCylinder(
    "rainDrops",
    { height: 0.5, diameter: 0.03 },
    scene
  );
  drops.material = mat;
  drops.isPickable = false;
  drops.alwaysSelectAsActiveMesh = true;

  function writeMatrix(i: number) {
    const o = i * 16;
    matrices[o + 0] = 1;
    matrices[o + 1] = 0;
    matrices[o + 2] = 0;
    matrices[o + 3] = 0;
    matrices[o + 4] = 0;
    matrices[o + 5] = 1;
    matrices[o + 6] = 0;
    matrices[o + 7] = 0;
    matrices[o + 8] = 0;
    matrices[o + 9] = 0;
    matrices[o + 10] = 1;
    matrices[o + 11] = 0;
    matrices[o + 12] = xs[i];
    matrices[o + 13] = ys[i];
    matrices[o + 14] = zs[i];
    matrices[o + 15] = 1;
  }

  function reset(i: number) {
    const x = (Math.random() - 0.5) * 60;
    const z = (Math.random() - 0.5) * 60;
    const y = terrain.getHeightAt(x, z) + 25 + Math.random() * 20;
    xs[i] = x;
    ys[i] = y;
    zs[i] = z;
    writeMatrix(i);
  }

  for (let i = 0; i < COUNT; i++) {
    reset(i);
  }
  drops.thinInstanceSetBuffer("matrix", matrices, 16, true);

  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    for (let i = 0; i < COUNT; i++) {
      ys[i] -= 22 * dt;
      const ground = terrain.getHeightAt(xs[i], zs[i]);
      if (ys[i] < ground + 0.2) {
        reset(i);
      } else {
        writeMatrix(i);
      }
    }
    drops.thinInstanceBufferUpdated("matrix");
  });
}
