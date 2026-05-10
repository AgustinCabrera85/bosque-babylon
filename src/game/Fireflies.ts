import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";

import type { TerrainHandle } from "./Terrain";

type Firefly = {
  core: Mesh;
  glow: Mesh;
  coreMat: StandardMaterial;
  glowMat: StandardMaterial;
  active: boolean;
  age: number;
  lifetime: number;
  wait: number;
  base: Vector3;
  drift: Vector3;
  phase: number;
};

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function makeGlowMaterial(scene: Scene, name: string, color: Color3, alpha: number) {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.emissiveColor = color;
  mat.diffuseColor = color;
  mat.specularColor.set(0, 0, 0);
  mat.alpha = alpha;
  mat.alphaMode = Material.MATERIAL_ALPHABLEND;
  mat.backFaceCulling = false;
  mat.fogEnabled = false;
  return mat;
}

export function createFireflies(
  scene: Scene,
  terrain: TerrainHandle,
  getPlayerPosition: () => Vector3,
  count: number
) {
  const fireflies: Firefly[] = [];
  const coreColor = new Color3(1.0, 0.86, 0.35);
  const glowColor = new Color3(0.65, 1.0, 0.45);

  for (let i = 0; i < count; i++) {
    const coreMat = makeGlowMaterial(scene, `fireflyCoreMat_${i}`, coreColor, 0);
    const glowMat = makeGlowMaterial(scene, `fireflyGlowMat_${i}`, glowColor, 0);

    const core = MeshBuilder.CreateSphere(
      `fireflyCore_${i}`,
      { diameter: 0.08, segments: 6 },
      scene
    );
    const glow = MeshBuilder.CreateSphere(
      `fireflyGlow_${i}`,
      { diameter: 0.36, segments: 8 },
      scene
    );

    core.material = coreMat;
    glow.material = glowMat;
    core.isPickable = false;
    glow.isPickable = false;
    core.alwaysSelectAsActiveMesh = true;
    glow.alwaysSelectAsActiveMesh = true;
    core.setEnabled(false);
    glow.setEnabled(false);

    fireflies.push({
      core,
      glow,
      coreMat,
      glowMat,
      active: false,
      age: 0,
      lifetime: 0,
      wait: rand(0.4, 6.5),
      base: new Vector3(),
      drift: new Vector3(),
      phase: rand(0, Math.PI * 2),
    });
  }

  function respawn(firefly: Firefly) {
    const player = getPlayerPosition();
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * rand(5.2, 22);
    const z = player.z + rand(-28, 42);
    const y = terrain.getHeightAt(x, z) + rand(0.75, 2.7);

    firefly.active = true;
    firefly.age = 0;
    firefly.lifetime = rand(2.4, 5.2);
    firefly.base.set(x, y, z);
    firefly.drift.set(rand(-0.35, 0.35), rand(-0.08, 0.18), rand(-0.45, 0.45));
    firefly.phase = rand(0, Math.PI * 2);
    firefly.core.setEnabled(true);
    firefly.glow.setEnabled(true);
  }

  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;

    for (const firefly of fireflies) {
      if (!firefly.active) {
        firefly.wait -= dt;
        if (firefly.wait <= 0) respawn(firefly);
        continue;
      }

      firefly.age += dt;
      const t = firefly.age / firefly.lifetime;

      if (t >= 1) {
        firefly.active = false;
        firefly.wait = rand(1.5, 7.5);
        firefly.core.setEnabled(false);
        firefly.glow.setEnabled(false);
        continue;
      }

      const pulse = 0.72 + Math.sin((firefly.age * 8.0) + firefly.phase) * 0.28;
      const fade = Math.sin(t * Math.PI);
      const intensity = Math.max(0, fade * pulse);
      const hoverX = Math.sin(firefly.age * 1.7 + firefly.phase) * 0.22;
      const hoverY = Math.sin(firefly.age * 2.3 + firefly.phase * 0.7) * 0.16;
      const hoverZ = Math.cos(firefly.age * 1.4 + firefly.phase) * 0.22;
      const position = firefly.base.add(firefly.drift.scale(firefly.age));

      position.x += hoverX;
      position.y += hoverY;
      position.z += hoverZ;

      firefly.core.position.copyFrom(position);
      firefly.glow.position.copyFrom(position);
      firefly.coreMat.alpha = 0.9 * intensity;
      firefly.glowMat.alpha = 0.22 * intensity;
    }
  });
}
