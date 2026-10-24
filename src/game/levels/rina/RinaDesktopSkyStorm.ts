import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { LightningSpriteEffectV2 } from "../../../vfx/storm/LightningSpriteEffectV2";
import { LightningVariantLibrary } from "../../../vfx/storm/LightningVariantLibrary";
import type { RinaStormSkyboxHandle } from "./RinaStormSkybox";

type CloudAnchor = Readonly<{ u: number; v: number; fall: number }>;
// These points sit inside the storm fronts of Rina's equirectangular sky.
// The main trunk starts in a cloud and ends above the stadium skyline.
const CLOUDS: readonly CloudAnchor[] = [
  { u: 0.575, v: 0.37, fall: 0.13 },
  { u: 0.56, v: 0.39, fall: 0.11 },
  { u: 0.94, v: 0.38, fall: 0.12 },
  { u: 0.965, v: 0.36, fall: 0.14 },
  { u: 0.035, v: 0.38, fall: 0.12 },
  { u: 0.465, v: 0.36, fall: 0.14 },
];
const SKY_RADIUS = 460;
// World-space clearance beyond either exterior side wall, including branches.
const EXTERIOR_CLEARANCE_X = 280;

function directionAt(u: number, v: number): Vector3 {
  const longitude = (u - 0.5) * Math.PI * 2;
  const latitude = v * Math.PI;
  return new Vector3(
    Math.cos(longitude) * Math.sin(latitude),
    Math.cos(latitude),
    Math.sin(longitude) * Math.sin(latitude)
  );
}

export interface RinaDesktopSkyStormHandle {
  readonly meshes: readonly Mesh[];
  update(cameraPosition: Vector3, deltaSeconds: number): void;
  dispose(): void;
}

/** Reuses StormFX's approved growing bolt shader, entirely in the distant sky. */
export async function createRinaDesktopSkyStorm(
  scene: Scene,
  sky: RinaStormSkyboxHandle
): Promise<RinaDesktopSkyStormHandle | null> {
  const library = new LightningVariantLibrary(scene);
  let effect: LightningSpriteEffectV2;
  try {
    effect = new LightningSpriteEffectV2(scene, await library.load("LGT_01"));
  } catch (error) {
    library.dispose();
    console.warn("Rina sky lightning could not load:", error);
    return null;
  }

  effect.mesh.name = "rinaSkyLightningCore";
  effect.haloMesh.name = "rinaSkyLightningHalo";
  // Render with stadium opaque geometry so roof and stands can occlude a bolt.
  effect.mesh.renderingGroupId = 0;
  effect.haloMesh.renderingGroupId = 0;
  effect.mesh.applyFog = false;
  effect.haloMesh.applyFog = false;
  effect.timing = {
    growDuration: 0.19,
    holdDuration: 0.11,
    fadeDuration: 0.48,
    intensity: 1.35,
  };
  effect.setCloudRootSoftness(0.09);

  let randomState = 97;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  let countdown = 6.5;
  let anchor: CloudAnchor | null = null;
  let sourceDirection = directionAt(CLOUDS[0].u, CLOUDS[0].v);
  let targetDirection = directionAt(CLOUDS[0].u, CLOUDS[0].v + CLOUDS[0].fall);
  let disposed = false;

  return {
    meshes: [effect.mesh, effect.haloMesh],
    update(cameraPosition, deltaSeconds) {
      if (disposed) return;
      const dt = Math.max(0, Math.min(deltaSeconds, 0.1));
      if (!effect.isPlaying) {
        countdown -= dt;
        if (countdown > 0) return;
        const exteriorClouds = CLOUDS.filter(candidate => {
          const source = directionAt(candidate.u, candidate.v);
          const target = directionAt(candidate.u, candidate.v + candidate.fall);
          const sourceX = cameraPosition.x + source.x * SKY_RADIUS;
          const targetX = cameraPosition.x + target.x * SKY_RADIUS;
          return Math.sign(sourceX) === Math.sign(targetX) &&
            Math.min(Math.abs(sourceX), Math.abs(targetX)) > EXTERIOR_CLEARANCE_X;
        });
        if (!exteriorClouds.length) {
          countdown = 1;
          return;
        }
        anchor = exteriorClouds[Math.floor(random() * exteriorClouds.length)];
        const drift = (random() - 0.5) * 0.018;
        sourceDirection = directionAt(anchor.u + drift, anchor.v);
        targetDirection = directionAt(anchor.u + drift + (random() - 0.5) * 0.024,
          anchor.v + anchor.fall);
        effect.start();
        countdown = 13 + random() * 11;
      }

      // Translation follows the camera, so the ray stays attached to the
      // panorama while the player walks or switches between camera views.
      effect.setEndpoints(
        cameraPosition.add(sourceDirection.scale(SKY_RADIUS)),
        cameraPosition.add(targetDirection.scale(SKY_RADIUS)),
        cameraPosition
      );
      effect.update(dt);
      sky.setLightningFlash(
        effect.fade * (0.16 + effect.flash * 0.70), sourceDirection
      );
      if (!effect.isPlaying) anchor = null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      effect.dispose();
      library.dispose();
    },
  };
}
