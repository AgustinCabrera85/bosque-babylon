import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { createTheatreCurtains } from "./TheatreCurtains";
import { createTheatreStageFloor } from "./TheatreStageFloor";

const STAGE_DIMENSIONS = {
  width: 15,
  depth: 17,
  centerZ: -8.4,
} as const;

export function createTheatreShell(scene: Scene) {
  const root = new TransformNode("theatreShell", scene);
  const blackWood = new StandardMaterial("blackWood", scene);
  blackWood.diffuseColor = new Color3(0.025, 0.018, 0.018);
  blackWood.specularColor = Color3.Black();
  const stage = MeshBuilder.CreateBox(
    "stage",
    {
      width: STAGE_DIMENSIONS.width,
      height: 0.3,
      depth: STAGE_DIMENSIONS.depth,
    },
    scene
  );
  stage.position.set(0, -0.15, STAGE_DIMENSIONS.centerZ);
  stage.parent = root;
  stage.material = blackWood;
  stage.receiveShadows = true;
  createTheatreStageFloor(scene, root, STAGE_DIMENSIONS);

  const left = MeshBuilder.CreateBox("prosceniumLeft", { width: 0.7, height: 11, depth: 1.4 }, scene);
  const right = left.clone("prosceniumRight")!;
  const top = MeshBuilder.CreateBox("prosceniumTop", { width: 14.5, height: 0.7, depth: 1.4 }, scene);
  left.parent = right.parent = top.parent = root;
  left.position.set(-7, 5.1, -0.5);
  right.position.set(7, 5.1, -0.5);
  top.position.set(0.3, 10.15, -0.5);
  left.rotation.z = -0.035;
  right.rotation.z = 0.055;
  top.rotation.z = -0.018;
  left.material = right.material = top.material = blackWood;

  createTheatreCurtains(scene, root);

  const ropeMaterial = new StandardMaterial("ropeMat", scene);
  ropeMaterial.diffuseColor = new Color3(0.055, 0.045, 0.035);
  for (const x of [-6.2, -4.9, 4.7, 6.1]) {
    const rope = MeshBuilder.CreateCylinder(`rope_${x}`, { height: 15, diameter: 0.035, tessellation: 8 }, scene);
    rope.parent = root;
    rope.position.set(x, 7.6, -1.4);
    rope.material = ropeMaterial;
    rope.isPickable = false;
  }
  return root;
}
