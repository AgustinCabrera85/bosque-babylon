import "@babylonjs/loaders/glTF";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Light } from "@babylonjs/core/Lights/light";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../utils/asset";
import { RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";

const GUITARIST_ROOT = "assets/models/rina/band/";
const GUITARIST_FILE = "guitarrista_tocando_nla.glb";
// The animated body is about 0.92 m tall at source scale. Bind-pose bounds
// are much smaller in this GLB, so use the measured animated scale instead.
const GUITARIST_VISUAL_SCALE = 3;

/** Keep the authored body, guitar and animation under one placement transform. */
export async function createRinaGuitarist(scene: Scene, actorLights: readonly Light[]) {
  const container = await SceneLoader.LoadAssetContainerAsync(
    asset(GUITARIST_ROOT), GUITARIST_FILE, scene
  );
  if (scene.isDisposed) {
    container.dispose();
    return null;
  }

  const meshes = container.meshes.filter(
    (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0
  );
  const body = meshes.find(mesh => mesh.name.includes("tripo_node_"));
  const guitar = meshes.find(mesh => mesh.name.includes("JacksonV"));
  const playing = container.animationGroups.find(group => group.name === "Tocando");
  if (!body?.skeleton || !guitar || !playing) {
    container.dispose();
    throw new Error("Rina guitarist: expected the skinned musician, guitar and Tocando clip");
  }

  container.addAllToScene();
  const root = new TransformNode("rinaGuitaristRoot", scene);
  for (const node of container.rootNodes) node.parent = root;
  body.name = "rinaGuitaristBody";
  guitar.name = "rinaGuitaristGuitar";
  if (body.material) {
    // The GLB marks the body BLEND although its color texture has no alpha.
    body.material.transparencyMode = Material.MATERIAL_OPAQUE;
    body.material.alpha = 1;
    body.material.forceDepthWrite = true;
  }
  for (const mesh of meshes) {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
    for (const light of actorLights) light.includedOnlyMeshes.push(mesh);
  }

  const stage = RINA_STADIUM.stage;
  // The right band riser occupies the middle of the main stage. Its top is
  // 1.36 local units above the deck; keep the guitarist's feet on that top.
  const stageRightX = 13.4;
  const riserTopY = stage.height + 1.36;
  root.scaling.setAll(GUITARIST_VISUAL_SCALE);
  root.rotation.y = stage.rinaYaw;
  root.position.set(
    stageRightX * RINA_STADIUM_SCALE,
    riserTopY * RINA_STADIUM_SCALE,
    (stage.centerZ + 0.2) * RINA_STADIUM_SCALE
  );
  const key = new PointLight(
    "rinaGuitaristKey",
    root.position.add(new Vector3(-2, 3, -3)),
    scene
  );
  key.diffuse = new Color3(0.55, 0.72, 1);
  key.specular = new Color3(0.08, 0.09, 0.12);
  key.intensity = 8;
  key.range = 13;
  key.renderPriority = 4;
  key.includedOnlyMeshes.push(...meshes);
  playing.start(true);

  return {
    root,
    meshes,
    dispose() {
      playing.stop();
      key.dispose();
      root.dispose();
      container.dispose();
    },
  };
}
