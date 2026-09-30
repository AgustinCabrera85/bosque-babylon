import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

export function createTheatreShell(scene: Scene) {
  const root = new TransformNode("theatreShell", scene);
  const blackWood = new StandardMaterial("blackWood", scene);
  blackWood.diffuseColor = new Color3(0.025, 0.018, 0.018);
  blackWood.specularColor = Color3.Black();
  const curtain = new StandardMaterial("curtain", scene);
  curtain.diffuseColor = new Color3(0.12, 0.018, 0.022);
  curtain.specularColor = new Color3(0.025, 0.012, 0.012);
  const velvet = new StandardMaterial("seatVelvet", scene);
  velvet.diffuseColor = new Color3(0.055, 0.012, 0.016);
  velvet.specularColor = Color3.Black();

  const stage = MeshBuilder.CreateBox("stage", { width: 15, height: 0.3, depth: 17 }, scene);
  stage.position.set(0, -0.15, -8.4);
  stage.parent = root;
  stage.material = blackWood;
  stage.receiveShadows = true;

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

  for (const side of [-1, 1]) {
    const flat = MeshBuilder.CreatePlane(`curtain_${side}`, { width: 4.2, height: 10 }, scene);
    flat.parent = root;
    flat.position.set(side * 5.3, 5, -0.8);
    flat.rotation.y = side > 0 ? Math.PI : 0;
    flat.rotation.z = side * 0.08;
    flat.material = curtain;
    flat.isPickable = false;
  }

  for (let row = 0; row < 4; row += 1) {
    const z = -14 - row * 1.35;
    for (let col = -5; col <= 5; col += 1) {
      if ((row + col) % 5 === 0) continue;
      const seat = MeshBuilder.CreateBox(`seat_${row}_${col}`, { width: 0.78, height: 0.9, depth: 0.62 }, scene);
      seat.parent = root;
      seat.position.set(col * 1.05 + row * 0.18, 0.45 + row * 0.05, z);
      seat.rotation.y = col * 0.008;
      seat.material = velvet;
      seat.isPickable = false;
    }
  }

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
