import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Babylon's WebGL shaders may allocate one vertex uniform block per light.
 * Reserving four blocks for scene/material/mesh data keeps the project below
 * the 12-block limit exposed by lower-budget WebGL2 implementations.
 */
export const SAFE_MAX_SIMULTANEOUS_LIGHTS = 8;

type LightAwareMaterial = Material & {
  maxSimultaneousLights: number;
};

function isLightAwareMaterial(material: Material): material is LightAwareMaterial {
  return typeof (material as unknown as { maxSimultaneousLights?: unknown })
    .maxSimultaneousLights === "number";
}

export function enforceSceneMaterialLightBudget(
  scene: Scene,
  maximum = SAFE_MAX_SIMULTANEOUS_LIGHTS
) {
  for (const material of scene.materials) {
    if (isLightAwareMaterial(material) && material.maxSimultaneousLights > maximum) {
      material.maxSimultaneousLights = maximum;
    }
  }
}

/**
 * glTF imports can raise maxSimultaneousLights on every material in the scene
 * after loading. Enforcing immediately before each frame catches initial and
 * later runtime imports before Babylon compiles their shader variants.
 */
export function installSceneMaterialLightBudgetGuard(
  scene: Scene,
  maximum = SAFE_MAX_SIMULTANEOUS_LIGHTS
) {
  enforceSceneMaterialLightBudget(scene, maximum);
  scene.onBeforeRenderObservable.add(() => {
    enforceSceneMaterialLightBudget(scene, maximum);
  });
}
