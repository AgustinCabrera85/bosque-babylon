import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { asset } from "../utils/asset";

export type PhotoCardBounds = {
  min: Vector3;
  max: Vector3;
};

export type PhotoCardConfig = {
  modelRootPath: string;
  modelFileName: string;
  photoTexturePath: string;
  name: string;
  scale: number;
  floorOffsetY: number;
  candleOffset: Vector3;
  fallbackHouseFraction: { x: number; z: number };
  rotationY: number;
  interactionSize: { width: number; height: number; depth: number };
  pickupMessage: string;
  movementLockSeconds: number;
  inspectionDelaySeconds: number;
  pulseSize: number;
};

type CreatePhotoCardOptions = Partial<PhotoCardConfig> & {
  candlePosition?: Vector3 | null;
};

type MaterialWithSubMaterials = BabylonMaterial & {
  subMaterials?: (BabylonMaterial | null)[];
};

const DEFAULT_PHOTO_CARD_CONFIG: PhotoCardConfig = {
  modelRootPath: "assets/models/props/",
  modelFileName: "photo-card.glb",
  photoTexturePath: "assets/models/textures/props/photos/Mis padrinos.jpeg",
  name: "endHousePhotoCard",
  scale: 0.08,
  floorOffsetY: 0.105,
  candleOffset: new Vector3(3.15, 0, -2.35),
  fallbackHouseFraction: { x: 0.43, z: 0.5 },
  rotationY: Math.PI * -0.14,
  interactionSize: { width: 1.85, height: 0.85, depth: 1.85 },
  pickupMessage: "Recogiste la foto.",
  movementLockSeconds: 1.05,
  inspectionDelaySeconds: 0.85,
  pulseSize: 1.28,
};

export const PHOTO_CARD_INSPECTABLE_ITEM = {
  id: "photo-card",
  name: "Foto",
  typeLabel: "Recuerdo",
  description: "Una foto encontrada en el suelo de la casa, cerca de la vela.",
  modelRootPath: DEFAULT_PHOTO_CARD_CONFIG.modelRootPath,
  modelFileName: DEFAULT_PHOTO_CARD_CONFIG.modelFileName,
  texturePath: DEFAULT_PHOTO_CARD_CONFIG.photoTexturePath,
  cameraRadius: 2.2,
};

export async function createPhotoCard(
  scene: Scene,
  houseBounds: PhotoCardBounds,
  options: CreatePhotoCardOptions = {}
) {
  const config = { ...DEFAULT_PHOTO_CARD_CONFIG, ...options };
  const res = await SceneLoader.ImportMeshAsync(
    null,
    asset(config.modelRootPath),
    config.modelFileName,
    scene
  );

  const root = new TransformNode(`${config.name}Root`, scene);
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

  applyPhotoCardMaterials(scene, res.meshes, asset(config.photoTexturePath));
  preparePhotoCardMeshes(res.meshes);

  const position = resolvePhotoCardPosition(houseBounds, config, options.candlePosition);
  root.position.copyFrom(position);
  root.rotation.y = config.rotationY;
  root.scaling.setAll(config.scale);
  root.computeWorldMatrix(true);
  const pulse = createPhotoCardPulse(scene, `${config.name}Pulse`, position, config.pulseSize);
  const glint = createPhotoCardGlint(scene, `${config.name}Glint`, position);

  const interaction = MeshBuilder.CreateBox(
    `${config.name}Interaction`,
    config.interactionSize,
    scene
  );
  interaction.position.set(position.x, houseBounds.min.y + config.interactionSize.height * 0.5, position.z);
  interaction.rotation.y = config.rotationY;
  interaction.visibility = 0;
  interaction.isPickable = true;

  let pickedUp = false;
  interaction.metadata = {
    interactable: true,
    type: "photo",
    id: config.name,
    title: "Foto",
    onInteract: () => {
      if (pickedUp) {
        return {
          suppressAction: true,
        };
      }

      pickedUp = true;
      scene.onBeforeRenderObservable.remove(pulse.observer);
      scene.onBeforeRenderObservable.remove(glint.observer);
      root.dispose(false, true);
      interaction.dispose();
      pulse.mesh.dispose();
      glint.root.dispose(false, true);
      const inventoryItem = {
        ...PHOTO_CARD_INSPECTABLE_ITEM,
        modelRootPath: config.modelRootPath,
        modelFileName: config.modelFileName,
        texturePath: config.photoTexturePath,
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
      }, config.inspectionDelaySeconds * 1000);

      return {
        message: config.pickupMessage,
        actionType: "photo",
        movementLockSeconds: config.movementLockSeconds,
      };
    },
  };

  return {
    root,
    interaction,
  };
}

function resolvePhotoCardPosition(
  houseBounds: PhotoCardBounds,
  config: PhotoCardConfig,
  candlePosition?: Vector3 | null
) {
  const width = houseBounds.max.x - houseBounds.min.x;
  const depth = houseBounds.max.z - houseBounds.min.z;
  const centerX = (houseBounds.min.x + houseBounds.max.x) * 0.5;
  const fallback = new Vector3(
    houseBounds.min.x + width * config.fallbackHouseFraction.x,
    houseBounds.min.y,
    houseBounds.min.z + depth * config.fallbackHouseFraction.z
  );
  const anchor = candlePosition ?? fallback;
  const xMargin = Math.min(2.2, Math.max(1.0, width * 0.1));
  const zMargin = Math.min(2.4, Math.max(1.2, depth * 0.1));
  const preferredX = candlePosition
    ? centerX + Math.min(2.35, width * 0.2)
    : anchor.x + config.candleOffset.x;
  const preferredZ = anchor.z + config.candleOffset.z;

  return new Vector3(
    clamp(preferredX, houseBounds.min.x + xMargin, houseBounds.max.x - xMargin),
    houseBounds.min.y + config.floorOffsetY,
    clamp(preferredZ, houseBounds.min.z + zMargin, houseBounds.max.z - zMargin)
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createPhotoCardPulse(scene: Scene, name: string, position: Vector3, size: number) {
  const texture = new DynamicTexture(
    `${name}Texture`,
    { width: 256, height: 256 },
    scene,
    false
  );
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 256);
  const gradient = ctx.createRadialGradient(128, 128, 12, 128, 128, 118);
  gradient.addColorStop(0.0, "rgba(255, 234, 166, 0.32)");
  gradient.addColorStop(0.28, "rgba(225, 167, 78, 0.22)");
  gradient.addColorStop(0.58, "rgba(225, 125, 45, 0.10)");
  gradient.addColorStop(1.0, "rgba(225, 125, 45, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  texture.update();
  texture.hasAlpha = true;

  const material = new StandardMaterial(`${name}Material`, scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = new Color3(1.0, 0.62, 0.25);
  material.diffuseColor = new Color3(1.0, 0.68, 0.32);
  material.alpha = 0.34;
  material.alphaMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.needDepthPrePass = false;

  const mesh = MeshBuilder.CreatePlane(name, { size }, scene);
  mesh.position.set(position.x, position.y + 0.014, position.z);
  mesh.rotation.x = Math.PI * 0.5;
  mesh.material = material;
  mesh.isPickable = false;

  let t = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() * 0.001;
    const pulse = (Math.sin(t * 4.8) + 1) * 0.5;
    material.alpha = 0.18 + pulse * 0.28;
    const scale = 0.92 + pulse * 0.12;
    mesh.scaling.set(scale, scale, scale);
  });

  return { mesh, observer };
}

function createPhotoCardGlint(scene: Scene, name: string, position: Vector3) {
  const root = new TransformNode(`${name}Root`, scene);
  root.position.set(position.x, position.y + 0.34, position.z);

  const texture = new DynamicTexture(
    `${name}Texture`,
    { width: 128, height: 128 },
    scene,
    false
  );
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 128);
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 48);
  gradient.addColorStop(0.0, "rgba(255, 244, 190, 0.95)");
  gradient.addColorStop(0.26, "rgba(255, 188, 83, 0.55)");
  gradient.addColorStop(1.0, "rgba(255, 120, 32, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  texture.update();
  texture.hasAlpha = true;

  const material = new StandardMaterial(`${name}Material`, scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = new Color3(1.0, 0.74, 0.32);
  material.diffuseColor = new Color3(1.0, 0.76, 0.38);
  material.alpha = 0.7;
  material.alphaMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  material.disableLighting = true;
  material.backFaceCulling = false;

  const front = MeshBuilder.CreatePlane(`${name}Front`, { size: 0.26 }, scene);
  front.parent = root;
  front.material = material;
  front.isPickable = false;
  front.billboardMode = Mesh.BILLBOARDMODE_ALL;

  let t = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() * 0.001;
    const pulse = (Math.sin(t * 6.2) + 1) * 0.5;
    material.alpha = 0.36 + pulse * 0.48;
    const scale = 0.85 + pulse * 0.3;
    root.scaling.set(scale, scale, scale);
    root.position.y = position.y + 0.32 + Math.sin(t * 2.6) * 0.035;
  });

  return { root, observer };
}

function preparePhotoCardMeshes(meshes: AbstractMesh[]) {
  for (const mesh of meshes) {
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.computeWorldMatrix(true);
  }
}

export function applyPhotoCardMaterials(scene: Scene, meshes: AbstractMesh[], photoTextureUrl: string) {
  const texture = new Texture(photoTextureUrl, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;

  const patched = new Set<BabylonMaterial>();
  for (const mesh of meshes) {
    forEachMaterial(mesh.material as BabylonMaterial | null, (material) => {
      if (patched.has(material)) return;
      patched.add(material);

      const name = material.name.toLowerCase();
      material.backFaceCulling = false;

      if (name.includes("dynamic-photo")) {
        applyPhotoMaterial(material, texture);
        return;
      }

      if (name.includes("white-border")) {
        applyWhiteBorderMaterial(material);
      }
    });
  }
}

function forEachMaterial(
  material: BabylonMaterial | null,
  callback: (material: BabylonMaterial) => void
) {
  if (!material) return;

  const multi = material as MaterialWithSubMaterials;
  if (Array.isArray(multi.subMaterials) && multi.subMaterials.length) {
    for (const subMaterial of multi.subMaterials) {
      if (subMaterial) callback(subMaterial);
    }
    return;
  }

  callback(material);
}

function applyPhotoMaterial(material: BabylonMaterial, texture: Texture) {
  if (material instanceof PBRMaterial) {
    material.albedoTexture = texture;
    material.albedoColor = Color3.White();
    material.metallic = 0;
    material.roughness = 0.55;
    material.environmentIntensity = 0.45;
    return;
  }

  if (material instanceof StandardMaterial) {
    material.diffuseTexture = texture;
    material.diffuseColor = Color3.White();
    material.specularColor = Color3.Black();
  }
}

function applyWhiteBorderMaterial(material: BabylonMaterial) {
  if (material instanceof PBRMaterial) {
    material.albedoTexture = null;
    material.albedoColor = Color3.White();
    material.metallic = 0;
    material.roughness = 0.72;
    material.environmentIntensity = 0.35;
    return;
  }

  if (material instanceof StandardMaterial) {
    material.diffuseTexture = null;
    material.diffuseColor = Color3.White();
    material.emissiveColor = Color3.Black();
    material.specularColor = Color3.Black();
  }
}
