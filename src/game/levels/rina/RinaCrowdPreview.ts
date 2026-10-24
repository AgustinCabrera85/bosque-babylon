import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Scene } from "@babylonjs/core/scene";
import type { Light } from "@babylonjs/core/Lights/light";
import { RINA_ANIMATED_FAN_CLEARANCE, RINA_CROWD_FANS } from "./crowd/RinaCrowdAssetManifest";
import { RinaCrowdAssetRegistry } from "./crowd/RinaCrowdAssetRegistry";
import {
  RINA_LEVEL_QUALITY, RINA_STAGE_SECURITY, RINA_STADIUM, RINA_STADIUM_SCALE,
} from "./RinaLevelConfig";

function isLane(x: number, z: number) {
  const verticalLane = Math.abs(x) < 2.6 || Math.abs(x - 17) < 2.2 || Math.abs(x + 17) < 2.2;
  const crossLane = Math.abs(z + 12) < 2.2 || Math.abs(z - 9) < 2.2;
  const stageClearance = z >
    RINA_STAGE_SECURITY.frontZ - RINA_STAGE_SECURITY.spectatorClearance;
  const catwalkFenceClearance =
    z > RINA_STAGE_SECURITY.catwalkFenceTipZ - RINA_STAGE_SECURITY.spectatorClearance &&
    Math.abs(x) < RINA_STAGE_SECURITY.catwalkFenceHalfWidth +
      RINA_STAGE_SECURITY.spectatorClearance;
  const spawnClearance = Math.abs(x) < 7 && z < -27;
  return verticalLane || crossLane || stageClearance ||
    catwalkFenceClearance || spawnClearance;
}

/**
 * Visual-only crowd used to validate stadium scale.
 * It intentionally has no collision/AI; iteration 2 replaces the near subset
 * with the real crowd navigation + shove/rescue systems.
 */
export function createRinaCrowdPreview(
  scene: Scene,
  performanceTier: "desktop" | "mobile",
  actorLights: readonly Light[]
) {
  const material = new StandardMaterial("rinaCrowdPreviewMaterial", scene);
  const animatedRoot = new TransformNode("rinaFieldAnimatedCrowdRoot", scene);
  const registry = new RinaCrowdAssetRegistry(scene, actorLights, true);
  const animatedGroups: { clips: readonly AnimationGroup[]; playingIndex: number }[] = [];
  let disposed = false;
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
    replaced: boolean;
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
      replaced: false,
    });
  }

  // Keep the existing 2K Fan04 test and show the new Fan05 in 1K beside her.
  if (performanceTier === "desktop") {
    const showcases = [
      { fan: RINA_CROWD_FANS.find(entry => entry.id === "fan_04")!,
        quality: "near" as const, target: spectators[0], x: 0, z: -26 },
      { fan: RINA_CROWD_FANS.find(entry => entry.id === "fan_05")!,
        quality: "middle" as const, target: spectators[1], x: 3.6, z: -26 },
    ];
    for (const showcase of showcases) {
      const { fan, quality, target, x, z } = showcase;
      target.mesh.position.set(x, 0.84, z);
      target.mesh.rotation.y = Math.PI;
      void registry.loadAnimated(fan, quality, 1).then(groups => {
        if (!groups || disposed) return;
        for (const group of groups) {
          const mesh = group.mesh;
          mesh.computeWorldMatrix(true);
          const inverseMeshWorld = mesh.getWorldMatrix().clone().invert();
          const localHeight = mesh.getBoundingInfo().boundingBox.extendSize.y * 2;
          const baseScale = fan.targetWorldHeight / (localHeight * RINA_STADIUM_SCALE);
          const matrices = new Float32Array(16);
          const desired = Matrix.Compose(new Vector3(baseScale, baseScale, baseScale),
            Quaternion.RotationAxis(Vector3.Up(), Math.PI), new Vector3(x, 0, z));
          const instance = desired.multiply(inverseMeshWorld);
          instance.copyToArray(matrices, 0);
          for (const node of group.roots) node.parent = animatedRoot;
          mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
          mesh.thinInstanceRefreshBoundingInfo(true, true);
          target.replaced = true;
          target.mesh.dispose();
          const playingIndex = Math.floor(Math.random() * group.clips.length);
          group.clips[playingIndex].start(false);
          animatedGroups.push({ clips: group.clips, playingIndex });
        }
        for (const spectator of spectators) {
          if (spectator.replaced || showcases.some(entry => entry.target === spectator)) continue;
          if (Math.hypot(spectator.mesh.position.x - x,
            spectator.mesh.position.z - z) < RINA_ANIMATED_FAN_CLEARANCE) {
            spectator.replaced = true;
            spectator.mesh.dispose();
          }
        }
      });
    }
  }

  const jumpDuration = 0.38;
  let previousBeatPulse = 0;
  let lastBeatAt = -Infinity;
  let activeUntil = -Infinity;
  let nextCohort = 0;
  let animating = false;

  return {
    root: animatedRoot,
    update(elapsed: number, beatPulse: number) {
      if (disposed) return;
      for (const group of animatedGroups) {
        if (group.clips[group.playingIndex].isPlaying) continue;
        const next = Math.floor(Math.random() * (group.clips.length - 1));
        group.playingIndex = next >= group.playingIndex ? next + 1 : next;
        group.clips[group.playingIndex].start(false);
      }
      if (beatPulse >= 0.9 && previousBeatPulse < 0.9 &&
          elapsed - lastBeatAt > 0.18) {
        lastBeatAt = elapsed;
        for (const spectator of spectators) {
          if (!spectator.replaced && spectator.cohort === nextCohort) {
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
            if (spectator.replaced) continue;
            spectator.mesh.position.y = 0.84;
            spectator.mesh.rotation.z = 0;
          }
          animating = false;
        }
        return;
      }

      animating = true;
      for (const spectator of spectators) {
        if (spectator.replaced) continue;
        const progress = (elapsed - spectator.jumpStart) / jumpDuration;
        const jump = progress > 0 && progress < 1
          ? Math.sin(Math.PI * progress)
          : 0;
        spectator.mesh.position.y = 0.84 + jump * spectator.height;
        spectator.mesh.rotation.z = jump * spectator.lean;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      registry.dispose();
      animatedRoot.dispose();
      for (const spectator of spectators) if (!spectator.mesh.isDisposed()) spectator.mesh.dispose();
      source.dispose();
      material.dispose();
    },
  };
}
