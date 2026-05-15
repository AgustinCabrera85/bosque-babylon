import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

export type LensFlareHandle = {
  root: TransformNode;
  observer: ReturnType<Scene["onBeforeRenderObservable"]["add"]>;
  dispose: () => void;
};

export type LensFlareOptions = {
  size?: number;
  height?: number;
  intensity?: number;
};

export function createItemLensFlare(
  scene: Scene,
  name: string,
  position: Vector3,
  options: LensFlareOptions = {}
): LensFlareHandle {
  const root = new TransformNode(`${name}Root`, scene);
  const height = options.height ?? 0.36;
  root.position.set(position.x, position.y + height, position.z);

  const texture = createLensFlareTexture(scene, `${name}Texture`);
  const material = new StandardMaterial(`${name}Material`, scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = Color3.White();
  material.diffuseColor = Color3.White();
  material.alpha = 0.82 * (options.intensity ?? 1);
  material.alphaMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  material.disableLighting = true;
  material.backFaceCulling = false;

  const size = options.size ?? 0.42;
  const glow = MeshBuilder.CreatePlane(`${name}Glow`, { size }, scene);
  glow.parent = root;
  glow.material = material;
  glow.isPickable = false;
  glow.billboardMode = Mesh.BILLBOARDMODE_ALL;

  const streakMat = material.clone(`${name}StreakMaterial`) as StandardMaterial;
  const horizontal = MeshBuilder.CreatePlane(`${name}HorizontalStreak`, { width: size * 2.1, height: size * 0.14 }, scene);
  horizontal.parent = root;
  horizontal.material = streakMat;
  horizontal.isPickable = false;
  horizontal.billboardMode = Mesh.BILLBOARDMODE_ALL;

  const vertical = MeshBuilder.CreatePlane(`${name}VerticalStreak`, { width: size * 0.12, height: size * 1.35 }, scene);
  vertical.parent = root;
  vertical.material = streakMat;
  vertical.isPickable = false;
  vertical.billboardMode = Mesh.BILLBOARDMODE_ALL;

  let t = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() * 0.001;
    const pulse = (Math.sin(t * 6.6) + 1) * 0.5;
    const alpha = (0.34 + pulse * 0.52) * (options.intensity ?? 1);
    material.alpha = alpha;
    streakMat.alpha = alpha * 0.72;
    const scale = 0.86 + pulse * 0.22;
    root.scaling.set(scale, scale, scale);
    root.position.y = position.y + height + Math.sin(t * 2.4) * 0.025;
  });

  return {
    root,
    observer,
    dispose: () => {
      scene.onBeforeRenderObservable.remove(observer);
      root.dispose(false, true);
      material.dispose();
      streakMat.dispose();
      texture.dispose();
    },
  };
}

function createLensFlareTexture(scene: Scene, name: string) {
  const texture = new DynamicTexture(name, { width: 256, height: 256 }, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 256);

  const glow = ctx.createRadialGradient(128, 128, 2, 128, 128, 88);
  glow.addColorStop(0.0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.14, "rgba(255, 255, 255, 0.82)");
  glow.addColorStop(0.42, "rgba(210, 232, 255, 0.26)");
  glow.addColorStop(1.0, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 256, 256);

  texture.update();
  texture.hasAlpha = true;
  return texture;
}
