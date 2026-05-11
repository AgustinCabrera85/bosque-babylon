import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { FireMaterial } from "@babylonjs/materials/fire/fireMaterial";
import { Engine } from "@babylonjs/core/Engines/engine";

import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TerrainHandle } from "./Terrain";

type TorchPlacement = {
  x: number;
  z: number;
  rotationY: number;
};

const TORCH_MODEL_SCALE = 7.15;
const TORCH_GROUND_SINK = 0.1;
const FLAME_HEIGHT = 2.55;
const FLAME_WIDTH = 0.82;
const FLAME_BASE_OVERLAP = 0.32;

function createFireTextureSet(scene: Scene) {
  const diffuse = new DynamicTexture(
    "torchFireDiffuseTexture",
    { width: 128, height: 256 },
    scene,
    false
  );
  const diffuseCtx = diffuse.getContext() as CanvasRenderingContext2D;
  const diffuseGradient = diffuseCtx.createLinearGradient(0, 256, 0, 0);
  diffuseGradient.addColorStop(0.0, "rgb(255, 66, 0)");
  diffuseGradient.addColorStop(0.24, "rgb(255, 94, 6)");
  diffuseGradient.addColorStop(0.56, "rgb(255, 187, 35)");
  diffuseGradient.addColorStop(0.82, "rgb(255, 246, 126)");
  diffuseGradient.addColorStop(1.0, "rgb(255, 128, 7)");
  diffuseCtx.fillStyle = diffuseGradient;
  diffuseCtx.fillRect(0, 0, 128, 256);
  diffuse.update();

  const opacity = new DynamicTexture(
    "torchFireOpacityTexture",
    { width: 128, height: 256 },
    scene,
    false
  );
  const opacityCtx = opacity.getContext() as CanvasRenderingContext2D;
  opacityCtx.clearRect(0, 0, 128, 256);
  const opacityGradient = opacityCtx.createRadialGradient(64, 190, 8, 64, 165, 82);
  opacityGradient.addColorStop(0.0, "rgba(255, 255, 255, 1)");
  opacityGradient.addColorStop(0.38, "rgba(255, 255, 255, 0.95)");
  opacityGradient.addColorStop(0.72, "rgba(255, 255, 255, 0.38)");
  opacityGradient.addColorStop(1.0, "rgba(255, 255, 255, 0)");
  opacityCtx.fillStyle = opacityGradient;
  opacityCtx.beginPath();
  opacityCtx.moveTo(64, 6);
  opacityCtx.bezierCurveTo(31, 72, 16, 146, 28, 255);
  opacityCtx.bezierCurveTo(48, 255, 84, 255, 102, 255);
  opacityCtx.bezierCurveTo(112, 151, 96, 77, 64, 6);
  opacityCtx.closePath();
  opacityCtx.fill();
  opacity.update();

  const distortion = new DynamicTexture(
    "torchFireDistortionTexture",
    { width: 128, height: 128 },
    scene,
    false
  );
  const distortionCtx = distortion.getContext() as CanvasRenderingContext2D;
  const distortionData = distortionCtx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const wave = Math.sin(x * 0.28) * 32 + Math.cos(y * 0.22) * 28;
      const noise = ((x * 37 + y * 71 + ((x * y) % 53)) % 255) * 0.5;
      const value = Math.max(0, Math.min(255, 110 + wave + noise));
      const idx = (y * 128 + x) * 4;
      distortionData.data[idx] = value;
      distortionData.data[idx + 1] = value;
      distortionData.data[idx + 2] = value;
      distortionData.data[idx + 3] = 255;
    }
  }
  distortionCtx.putImageData(distortionData, 0, 0);
  distortion.update();

  for (const texture of [diffuse, opacity, distortion]) {
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
  }

  return { diffuse, opacity, distortion };
}

function createFireMaterial(scene: Scene) {
  const textures = createFireTextureSet(scene);
  const material = new FireMaterial("torchFireMaterial", scene);
  material.diffuseTexture = textures.diffuse;
  material.distortionTexture = textures.distortion;
  material.opacityTexture = textures.opacity;
  material.diffuseColor = new Color3(1.0, 0.58, 0.2);
  material.speed = 0.95;
  material.backFaceCulling = false;
  material.needDepthPrePass = false;
  (material as any).disableDepthWrite = false;
  return material;
}

function createGlowMaterial(scene: Scene) {
  const texture = new DynamicTexture(
    "torchGlowTexture",
    { width: 128, height: 256 },
    scene,
    false
  );
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 256);
  const gradient = ctx.createRadialGradient(64, 139, 6, 64, 139, 73);
  gradient.addColorStop(0.0, "rgba(255, 245, 130, 0.55)");
  gradient.addColorStop(0.28, "rgba(255, 164, 32, 0.32)");
  gradient.addColorStop(0.68, "rgba(255, 82, 6, 0.11)");
  gradient.addColorStop(1.0, "rgba(255, 82, 6, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 256);
  texture.update();
  texture.hasAlpha = true;

  const material = new StandardMaterial("torchGlowMaterial", scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = new Color3(1.0, 0.5, 0.12);
  material.diffuseColor = new Color3(1.0, 0.42, 0.08);
  material.alpha = 0.72;
  material.alphaMode = Engine.ALPHA_ADD;
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.needDepthPrePass = false;
  material.disableDepthWrite = false;
  return material;
}

function collectBounds(meshes: Mesh[]) {
  let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const info = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, info.minimumWorld);
    max = Vector3.Maximize(max, info.maximumWorld);
  }

  return { min, max };
}

function patchTorchMaterial(mesh: Mesh) {
  const source = mesh.material;
  if (!source) return;

  const material = source.clone(`${source.name}_${mesh.name}_torchContrast`);
  if (!material) return;

  mesh.material = material;

  if (material instanceof PBRMaterial) {
    const bakedTexture = material.albedoTexture ?? material.emissiveTexture;
    if (bakedTexture) {
      material.albedoTexture = bakedTexture;
      material.emissiveTexture = null;
    }

    material.emissiveColor = Color3.Black();
    material.albedoColor = new Color3(0.95, 0.72, 0.52);
    material.metallic = 0.04;
    material.roughness = 0.82;
    material.environmentIntensity = 0.28;
    material.directIntensity = 0.95;
    material.cameraExposure = 0.82;
    material.cameraContrast = 1.28;
    return;
  }

  if (material instanceof StandardMaterial) {
    material.emissiveColor = Color3.Black();
    material.diffuseColor = new Color3(0.72, 0.45, 0.26);
    material.specularColor = new Color3(0.08, 0.065, 0.05);
  }
}

async function importTorchModel(scene: Scene, root: TransformNode) {
  const result = await SceneLoader.ImportMeshAsync(
    null,
    "/assets/models/objects/",
    "torch.glb",
    scene
  );

  const meshes = result.meshes.filter((mesh): mesh is Mesh => {
    return "getBoundingInfo" in mesh && mesh.getTotalVertices() > 0;
  });
  const bounds = collectBounds(meshes);

  for (const node of [...result.transformNodes, ...result.meshes]) {
    if (node !== root && node.parent === null) {
      node.parent = root;
    }
  }

  for (const mesh of meshes) {
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.alwaysSelectAsActiveMesh = true;
    patchTorchMaterial(mesh);
  }

  root.scaling.setAll(TORCH_MODEL_SCALE);

  return {
    baseOffsetY: Number.isFinite(bounds.min.y) ? bounds.min.y * TORCH_MODEL_SCALE : 0,
    topOffsetY:
      Number.isFinite(bounds.max.y) && Number.isFinite(bounds.min.y)
        ? (bounds.max.y - bounds.min.y) * TORCH_MODEL_SCALE
        : 2.2,
  };
}

function addStaticFlame(
  scene: Scene,
  fireMaterial: FireMaterial,
  glowMaterial: StandardMaterial,
  name: string,
  position: Vector3,
  rotationY: number
) {
  const root = new TransformNode(`${name}Root`, scene);
  root.position.copyFrom(position);
  root.rotation.y = rotationY;

  const frontPlane = MeshBuilder.CreatePlane(
    `${name}Front`,
    { width: FLAME_WIDTH, height: FLAME_HEIGHT },
    scene
  );
  frontPlane.parent = root;
  frontPlane.position.y = FLAME_HEIGHT * 0.5;
  frontPlane.material = fireMaterial;
  frontPlane.isPickable = false;

  const sidePlane = MeshBuilder.CreatePlane(
    `${name}Side`,
    { width: FLAME_WIDTH * 0.82, height: FLAME_HEIGHT * 0.92 },
    scene
  );
  sidePlane.parent = root;
  sidePlane.position.y = FLAME_HEIGHT * 0.48;
  sidePlane.rotation.y = Math.PI * 0.5;
  sidePlane.material = fireMaterial;
  sidePlane.isPickable = false;

  const glowPlane = MeshBuilder.CreatePlane(
    `${name}Glow`,
    { width: FLAME_WIDTH * 1.35, height: FLAME_HEIGHT * 1.18 },
    scene
  );
  glowPlane.parent = root;
  glowPlane.position.y = FLAME_HEIGHT * 0.52;
  glowPlane.material = glowMaterial;
  glowPlane.isPickable = false;

  return root;
}

export async function createEndTorches(scene: Scene, terrain: TerrainHandle) {
  const pathEndZ = 70 * 8 - 8;
  const placements: TorchPlacement[] = [
    { x: -6.4, z: pathEndZ + 0.4, rotationY: Math.PI * 0.5 },
    { x: 6.4, z: pathEndZ + 0.4, rotationY: -Math.PI * 0.5 },
  ];
  const fireMaterial = createFireMaterial(scene);
  const glowMaterial = createGlowMaterial(scene);
  const lights: { light: PointLight; baseIntensity: number; phase: number }[] = [];

  for (let i = 0; i < placements.length; i++) {
    const placement = placements[i];
    const groundY = terrain.getHeightAt(placement.x, placement.z);
    const root = new TransformNode(`endTorch_${i}`, scene);

    const offsets = await importTorchModel(scene, root);
    root.position.set(placement.x, groundY - offsets.baseOffsetY - TORCH_GROUND_SINK, placement.z);
    root.rotation.y = placement.rotationY;

    const flameBase = new Vector3(
      placement.x,
      groundY + offsets.topOffsetY - TORCH_GROUND_SINK - FLAME_BASE_OVERLAP,
      placement.z
    );
    addStaticFlame(
      scene,
      fireMaterial,
      glowMaterial,
      `endTorchFlame_${i}`,
      flameBase,
      placement.rotationY
    );

    const light = new PointLight(
      `endTorchLight_${i}`,
      new Vector3(placement.x, flameBase.y + FLAME_HEIGHT * 0.45, placement.z - 0.9),
      scene
    );
    light.diffuse = new Color3(1.0, 0.5, 0.18);
    light.specular = new Color3(1.0, 0.54, 0.22);
    light.intensity = 3.75;
    light.range = 45;

    lights.push({ light, baseIntensity: light.intensity, phase: i * 2.19 });
  }

  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() * 0.001;

    for (const { light, baseIntensity, phase } of lights) {
      const flicker =
        Math.sin(t * 11.0 + phase) * 0.12 +
        Math.sin(t * 21.0 + phase * 0.7) * 0.07;
      light.intensity = baseIntensity + flicker;
    }
  });
}
