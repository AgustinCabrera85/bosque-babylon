import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

export function createSky(scene: Scene) {
  const sky = MeshBuilder.CreateSphere("sky", { diameter: 2000, segments: 16 }, scene);
  sky.isPickable = false;

  const mat = new StandardMaterial("skyMat", scene);
  mat.backFaceCulling = false;
  mat.disableLighting = true;
  mat.emissiveColor.set(0.03, 0.04, 0.05);
  sky.material = mat;

  return sky;
}
