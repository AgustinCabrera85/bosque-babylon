import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_LEVEL_QUALITY, RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";

function isLane(x: number, z: number) {
  const verticalLane = Math.abs(x) < 2.6 || Math.abs(x - 17) < 2.2 || Math.abs(x + 17) < 2.2;
  const crossLane = Math.abs(z + 12) < 2.2 || Math.abs(z - 9) < 2.2;
  const stageClearance = z > RINA_STADIUM.stage.frontZ - 6;
  const spawnClearance = Math.abs(x) < 7 && z < -27;
  return verticalLane || crossLane || stageClearance || spawnClearance;
}

/**
 * Visual-only crowd used to validate stadium scale.
 * It intentionally has no collision/AI; iteration 2 replaces the near subset
 * with the real crowd navigation + shove/rescue systems.
 */
export function createRinaCrowdPreview(
  scene: Scene,
  performanceTier: "desktop" | "mobile"
) {
  const material = new StandardMaterial("rinaCrowdPreviewMaterial", scene);
  material.diffuseColor = new Color3(0.075, 0.07, 0.09);
  material.emissiveColor = new Color3(0.015, 0.008, 0.022);
  material.specularColor = Color3.Black();

  const source = MeshBuilder.CreateCylinder(
    "rinaCrowdPreviewSource",
    { height: 1.68, diameter: 0.62, tessellation: 6 },
    scene
  );
  source.material = material;
  source.isVisible = false;
  source.isPickable = false;

  const count = Math.round(
    RINA_LEVEL_QUALITY[performanceTier].crowdPreviewCount *
    RINA_STADIUM_SCALE ** 2
  );
  const spectators: {
    mesh: InstancedMesh;
    cohort: number;
    delay: number;
    height: number;
    lean: number;
    jumpStart: number;
  }[] = [];
  let attempts = 0;

  while (spectators.length < count && attempts < count * 12) {
    attempts += 1;
    const x = (Math.random() - 0.5) * (RINA_STADIUM.pitchWidth - 5);
    const z = -25 + Math.random() * 52;
    if (isLane(x, z)) continue;

    const instance = source.createInstance(
      `rinaCrowdPreview_${spectators.length}`
    );
    instance.position.set(x, 0.84, z);
    instance.rotation.y = (Math.random() - 0.5) * 0.55;
    const scale = 0.91 + Math.random() * 0.18;
    instance.scaling.set(scale, scale, scale);
    instance.isPickable = false;
    spectators.push({
      mesh: instance,
      cohort: spectators.length % 2,
      delay: Math.random() * 0.08,
      height: 0.12 + Math.random() * 0.11,
      lean: (Math.random() - 0.5) * 0.11,
      jumpStart: -Infinity,
    });
  }

  const jumpDuration = 0.38;
  let previousBeatPulse = 0;
  let lastBeatAt = -Infinity;
  let activeUntil = -Infinity;
  let nextCohort = 0;
  let animating = false;

  return {
    update(elapsed: number, beatPulse: number) {
      if (beatPulse >= 0.9 && previousBeatPulse < 0.9 &&
          elapsed - lastBeatAt > 0.18) {
        lastBeatAt = elapsed;
        for (const spectator of spectators) {
          if (spectator.cohort === nextCohort) {
            spectator.jumpStart = elapsed + spectator.delay;
          }
        }
        nextCohort = 1 - nextCohort;
        activeUntil = elapsed + jumpDuration + 0.08;
      }
      previousBeatPulse = beatPulse;

      if (elapsed > activeUntil) {
        if (animating) {
          for (const spectator of spectators) {
            spectator.mesh.position.y = 0.84;
            spectator.mesh.rotation.z = 0;
          }
          animating = false;
        }
        return;
      }

      animating = true;
      for (const spectator of spectators) {
        const progress = (elapsed - spectator.jumpStart) / jumpDuration;
        const jump = progress > 0 && progress < 1
          ? Math.sin(Math.PI * progress)
          : 0;
        spectator.mesh.position.y = 0.84 + jump * spectator.height;
        spectator.mesh.rotation.z = jump * spectator.lean;
      }
    },
  };
}
