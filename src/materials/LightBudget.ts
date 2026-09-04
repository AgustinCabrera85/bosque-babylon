import type { Material } from "@babylonjs/core/Materials/material";
import type { Light } from "@babylonjs/core/Lights/light";
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

const synchronizedLightState = new WeakMap<Scene, string>();

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

/**
 * Babylon appends a light to every affected mesh when it is enabled at runtime.
 * That append does not respect scene renderPriority, so a late local light can
 * sit beyond a material's maxSimultaneousLights even though it has high priority.
 * Reordering the existing arrays is cheap and keeps shader membership stable.
 */
export function synchronizeSceneLightPriorities(scene: Scene) {
  const state = scene.lights
    .map(
      (light) =>
        `${light.uniqueId}:${light.isEnabled() ? 1 : 0}:${light.renderPriority}:${
          light.shadowEnabled ? 1 : 0
        }`
    )
    .sort()
    .join("|");
  if (synchronizedLightState.get(scene) === state) return;

  synchronizedLightState.set(scene, state);
  scene.sortLightsByPriority();
  const sceneOrder = new Map<Light, number>();
  scene.lights.forEach((light, index) => sceneOrder.set(light, index));

  for (const mesh of scene.meshes) {
    const lightSources = mesh.lightSources as Light[];
    if (lightSources.length < 2) continue;
    lightSources.sort(
      (a, b) =>
        (sceneOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (sceneOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
    );
  }
}
