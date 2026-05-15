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
import { createItemLensFlare } from "./CollectibleEffects";

export type CollectibleNoteConfig = {
  id: string;
  name: string;
  description: string;
  worldTexturePath: string;
  contentImagePath: string;
  position: Vector3;
  rotationY?: number;
  width?: number;
  height?: number;
  floatHeight?: number;
  faceCamera?: boolean;
  pickupMessage?: string;
  inspectionDelaySeconds?: number;
};

const DEFAULT_NOTE_WIDTH = 1.08;
const DEFAULT_NOTE_HEIGHT = 0.7;
const DEFAULT_NOTE_FLOAT_HEIGHT = 0.42;
const DEFAULT_NOTE_PICKER_SIZE = { width: 1.8, height: 1.15, depth: 1.8 };

export function createCollectibleNote(scene: Scene, config: CollectibleNoteConfig) {
  const root = new TransformNode(`${config.id}Root`, scene);
  root.position.copyFrom(config.position);
  root.rotation.y = config.faceCamera === false ? config.rotationY ?? Math.PI * 0.08 : 0;

  const material = createNoteWorldMaterial(scene, config.id, config.worldTexturePath);
  const note = MeshBuilder.CreatePlane(
    `${config.id}RolledNote`,
    {
      width: config.width ?? DEFAULT_NOTE_WIDTH,
      height: config.height ?? DEFAULT_NOTE_HEIGHT,
    },
    scene
  );
  note.parent = root;
  note.position.y = config.floatHeight ?? DEFAULT_NOTE_FLOAT_HEIGHT;
  note.billboardMode = config.faceCamera === false ? Mesh.BILLBOARDMODE_NONE : Mesh.BILLBOARDMODE_Y;
  note.material = material;
  note.isPickable = false;
  note.receiveShadows = true;

  const flare = createItemLensFlare(scene, `${config.id}Flare`, config.position, {
    size: 0.38,
    height: 0.46,
    intensity: 1.05,
  });

  const interaction = MeshBuilder.CreateBox(
    `${config.id}Interaction`,
    DEFAULT_NOTE_PICKER_SIZE,
    scene
  );
  interaction.position.set(
    config.position.x,
    config.position.y + (config.floatHeight ?? DEFAULT_NOTE_FLOAT_HEIGHT),
    config.position.z
  );
  interaction.visibility = 0;
  interaction.isPickable = true;

  let pickedUp = false;
  interaction.metadata = {
    interactable: true,
    type: "note",
    id: config.id,
    title: config.name,
    onInteract: () => {
      if (pickedUp) return { suppressAction: true };

      pickedUp = true;
      root.dispose(false, true);
      interaction.dispose();
      flare.dispose();

      const inventoryItem = {
        id: config.id,
        name: config.name,
        typeLabel: "Nota",
        description: config.description,
        inspectMode: "image",
        contentImagePath: config.contentImagePath,
        inventoryIconPath: config.worldTexturePath,
      };

      window.dispatchEvent(
        new CustomEvent("bosque:inventory:add-item", {
          detail: inventoryItem,
        })
      );
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("bosque:inspect-item", {
            detail: inventoryItem,
          })
        );
      }, (config.inspectionDelaySeconds ?? 0.75) * 1000);

      return {
        message: config.pickupMessage ?? "Recogiste una nota.",
        actionType: "note",
        movementLockSeconds: 1.05,
      };
    },
  };

  return {
    root,
    interaction,
  };
}

function createNoteWorldMaterial(scene: Scene, id: string, texturePath: string) {
  const texture = new Texture(asset(texturePath), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;

  const material = new StandardMaterial(`${id}WorldMaterial`, scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.diffuseColor = Color3.White();
  material.emissiveColor = new Color3(0.08, 0.075, 0.065);
  material.specularColor = Color3.Black();
  material.alpha = 1;
  material.alphaMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;
  return material;
}
