import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { asset } from "../utils/asset";
import type { InspectableItem } from "./ItemInspector";
import { createItemLensFlare } from "./CollectibleEffects";
import { getInventoryPickupMessage } from "./InventoryMessages";

export const FOREST_KEY_ITEM_ID = "forest-key";
export const FOREST_KEY_MODEL_ROOT = "assets/models/props/";
export const FOREST_KEY_MODEL_FILE = "llave_del_bosque.glb";

export const FOREST_KEY_INVENTORY_ITEM: InspectableItem = {
  id: FOREST_KEY_ITEM_ID,
  name: "Llave del bosque",
  typeLabel: "Llave",
  description:
    "Una llave antigua marcada por el bosque. Parece corresponder a la puerta de la casa.",
  inspectMode: "model",
  modelRootPath: FOREST_KEY_MODEL_ROOT,
  modelFileName: FOREST_KEY_MODEL_FILE,
  modelScale: 1,
  cameraRadius: 2.2,
};

export type CollectibleForestKeyConfig = {
  position: Vector3;
  rotationY?: number;
};

const WORLD_SCALE = 0.46;
const FLOAT_HEIGHT = 0.34;
const PICKER_SIZE = { width: 1.55, height: 1.5, depth: 1.55 };

export async function createCollectibleForestKey(
  scene: Scene,
  config: CollectibleForestKeyConfig
) {
  const res = await SceneLoader.ImportMeshAsync(
    null,
    asset(FOREST_KEY_MODEL_ROOT),
    FOREST_KEY_MODEL_FILE,
    scene
  );

  const root = new TransformNode("forestKeyCollectibleRoot", scene);
  const importedRoot =
    res.meshes.find((mesh) => mesh.name === "__root__") ??
    res.meshes.find((mesh) => mesh.parent === null);

  if (importedRoot) {
    importedRoot.setParent(root);
  } else {
    for (const mesh of res.meshes) {
      if (!mesh.parent) mesh.setParent(root);
    }
  }

  for (const mesh of res.meshes) {
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.alwaysSelectAsActiveMesh = true;
  }

  const baseY = config.position.y + FLOAT_HEIGHT;
  root.position.set(config.position.x, baseY, config.position.z);
  root.rotation.y = config.rotationY ?? 0;
  root.scaling.setAll(WORLD_SCALE);
  root.computeWorldMatrix(true);

  const flare = createItemLensFlare(scene, "forestKeyCollectibleFlare", config.position, {
    size: 0.38,
    height: FLOAT_HEIGHT + 0.16,
    intensity: 1.05,
  });

  const interaction = MeshBuilder.CreateBox(
    "forestKeyCollectibleInteraction",
    PICKER_SIZE,
    scene
  );
  interaction.position.set(
    config.position.x,
    config.position.y + PICKER_SIZE.height * 0.5,
    config.position.z
  );
  interaction.visibility = 0;
  interaction.isPickable = true;

  let elapsed = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const delta = Math.min(scene.getEngine().getDeltaTime() * 0.001, 0.05);
    elapsed += delta;
    root.rotation.y += delta * 0.72;
    root.position.y = baseY + Math.sin(elapsed * 2.2) * 0.045;
  });

  let pickedUp = false;
  interaction.metadata = {
    interactable: true,
    type: "key",
    id: FOREST_KEY_ITEM_ID,
    title: "Llave del bosque",
    onInteract: () => {
      if (pickedUp) return { suppressAction: true };

      pickedUp = true;
      scene.onBeforeRenderObservable.remove(observer);
      root.dispose(false, true);
      interaction.dispose();
      flare.dispose();

      window.dispatchEvent(
        new CustomEvent("bosque:inventory:add-item", {
          detail: FOREST_KEY_INVENTORY_ITEM,
        })
      );

      return {
        message: getInventoryPickupMessage(FOREST_KEY_INVENTORY_ITEM),
        actionType: "key",
        movementLockSeconds: 0.65,
      };
    },
  };

  return {
    root,
    interaction,
  };
}
