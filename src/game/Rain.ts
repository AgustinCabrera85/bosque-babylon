import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { TerrainHandle } from "./Terrain";

/**
 * Lluvia placeholder: pequeñas líneas descendiendo. Liviano y sin texturas.
 * Si querés, después lo migramos a GPUParticleSystem.
 */
export function createRainSystem(scene: Scene, terrain: TerrainHandle) {
  const drops: any[] = [];
  const COUNT = 500;

  const mat = new StandardMaterial("rainMat", scene);
  mat.emissiveColor.set(0.6, 0.65, 0.7);
  mat.alpha = 0.35;

  for (let i = 0; i < COUNT; i++) {
    const d = MeshBuilder.CreateCylinder(`drop_${i}`, { height: 0.5, diameter: 0.03 }, scene);
    d.material = mat;
    d.isPickable = false;

    reset(d);
    drops.push(d);
  }

  function reset(d: any) {
    const x = (Math.random() - 0.5) * 60;
    const z = (Math.random() - 0.5) * 60;
    const y = terrain.getHeightAt(x, z) + 25 + Math.random() * 20;
    d.position.set(x, y, z);
  }

  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    for (const d of drops) {
      d.position.y -= 22 * dt;
      const ground = terrain.getHeightAt(d.position.x, d.position.z);
      if (d.position.y < ground + 0.2) reset(d);
    }
  });
}
