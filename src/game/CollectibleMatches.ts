import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { asset } from "../utils/asset";
import type { InspectableItem } from "./ItemInspector";
import { createItemLensFlare } from "./CollectibleEffects";
import { getInventoryPickupMessage } from "./InventoryMessages";

export const MATCHES_ITEM_ID = "matches";
export const MATCHBOX_MATCH_COUNT = 25;
export const MATCHBOX_IMAGE_PATH =
  "assets/models/props/png/generics/caja_de_fosforos.png";

export const MATCHES_INVENTORY_ITEM: InspectableItem = {
  id: MATCHES_ITEM_ID,
  name: "Fósforos",
  typeLabel: "Consumible",
  description:
    "Una caja con 25 fósforos secos. Podrán usarse para encender velas y otras fuentes de luz cuando no queden esferas de luz.",
  inspectMode: "image",
  contentImagePath: MATCHBOX_IMAGE_PATH,
  inventoryIconPath: MATCHBOX_IMAGE_PATH,
};

export type CollectibleMatchboxConfig = {
  position: Vector3;
  rotationY?: number;
};

const MATCHBOX_WORLD_SIZE = 0.28;
const MATCHBOX_FLOAT_HEIGHT = 0.24;
const MATCHBOX_PICKER_SIZE = { width: 1.55, height: 1.1, depth: 1.55 };

export function createCollectibleMatchbox(
  scene: Scene,
  config: CollectibleMatchboxConfig
) {
  const root = new TransformNode("matchboxCollectibleRoot", scene);
  root.position.copyFrom(config.position);
  root.rotation.y = config.rotationY ?? 0;

  const texture = new Texture(
    asset(MATCHBOX_IMAGE_PATH),
    scene,
    false,
    true,
    Texture.TRILINEAR_SAMPLINGMODE
  );
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;

  const material = new StandardMaterial("matchboxCollectibleMaterial", scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.diffuseColor = Color3.White();
  material.emissiveColor = new Color3(0.08, 0.055, 0.035);
  material.specularColor = Color3.Black();
  material.alphaMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;

  const card = MeshBuilder.CreatePlane(
    "matchboxCollectibleCard",
    { size: MATCHBOX_WORLD_SIZE },
    scene
  );
  card.parent = root;
  card.position.y = MATCHBOX_FLOAT_HEIGHT;
  card.billboardMode = Mesh.BILLBOARDMODE_Y;
  card.material = material;
  card.isPickable = false;
  card.receiveShadows = true;

  const flare = createItemLensFlare(
    scene,
    "matchboxCollectibleFlare",
    config.position,
    {
      size: 0.27,
      height: 0.28,
      intensity: 0.82,
    }
  );

  const interaction = MeshBuilder.CreateBox(
    "matchboxCollectibleInteraction",
    MATCHBOX_PICKER_SIZE,
    scene
  );
  interaction.position.set(
    config.position.x,
    config.position.y + MATCHBOX_FLOAT_HEIGHT,
    config.position.z
  );
  interaction.visibility = 0;
  interaction.isPickable = true;

  let pickedUp = false;
  interaction.metadata = {
    interactable: true,
    type: "matches",
    id: MATCHES_ITEM_ID,
    title: "Caja de fósforos",
    onInteract: () => {
      if (pickedUp) return { suppressAction: true };

      pickedUp = true;
      root.dispose(false, true);
      interaction.dispose();
      flare.dispose();

      window.dispatchEvent(
        new CustomEvent("bosque:inventory:set-item-count", {
          detail: {
            item: MATCHES_INVENTORY_ITEM,
            count: MATCHBOX_MATCH_COUNT,
          },
        })
      );

      return {
        message: getInventoryPickupMessage(MATCHES_INVENTORY_ITEM),
        actionType: "matches",
        movementLockSeconds: 0.65,
      };
    },
  };

  return {
    root,
    interaction,
  };
}
