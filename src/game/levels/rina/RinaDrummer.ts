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

const DRUMMER_ROOT = "assets/models/rina/band/";
const DRUMMER_FILE = "baterista_tocando_nla_1k.glb";
// Match the guitarist's source-to-world scale. The drummer's seated pose is
// naturally shorter than a standing performer at the same character scale.
const DRUMMER_VISUAL_SCALE = 3;

/** The skinned musician and all drum-kit meshes share the authored alignment. */
export async function createRinaDrummer(scene: Scene, actorLights: readonly Light[]) {
  const container = await SceneLoader.LoadAssetContainerAsync(
    asset(DRUMMER_ROOT), DRUMMER_FILE, scene
  );
  if (scene.isDisposed) {
    container.dispose();
    return null;
  }

  const meshes = container.meshes.filter(
    (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0
  );
  const body = meshes.find(mesh => mesh.name.includes("tripo_node_"));
  const kit = meshes.filter(mesh => mesh !== body);
  const playing = container.animationGroups.find(group => group.name === "Tocando");
  if (!body?.skeleton || kit.length === 0 || !playing) {
    container.dispose();
    throw new Error("Rina drummer: expected a skinned musician, drum kit and Tocando clip");
  }

  container.addAllToScene();
  const root = new TransformNode("rinaDrummerRoot", scene);
  for (const node of container.rootNodes) node.parent = root;
  // Rotate the performer and drum kit together below. An extra armature turn
  // would cancel that audience-facing yaw for the performer alone.
  body.name = "rinaDrummerBody";
  if (body.material) {
    // The source body is incorrectly tagged BLEND despite an RGB color map.
    body.material.transparencyMode = Material.MATERIAL_OPAQUE;
    body.material.alpha = 1;
    body.material.forceDepthWrite = true;
  }
  kit.forEach((mesh, index) => { mesh.name = `rinaDrumKit_${index}`; });
  playing.name = "rinaDrummerTocando";
  for (const mesh of meshes) {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
    for (const light of actorLights) light.includedOnlyMeshes.push(mesh);
  }

  const stage = RINA_STADIUM.stage;
  // This position leaves the center-right deck free for the planned DJ.
  // The left band's riser top is 1.36 local units above the main deck.
  root.scaling.setAll(DRUMMER_VISUAL_SCALE);
  root.rotation.y = stage.rinaYaw;
  root.position.set(
    -10 * RINA_STADIUM_SCALE,
    (stage.height + 1.36) * RINA_STADIUM_SCALE,
    (stage.centerZ + 0.2) * RINA_STADIUM_SCALE
  );
  const key = new PointLight(
    "rinaDrummerKey",
    root.position.add(new Vector3(-2, 3, -3)),
    scene
  );
  key.diffuse = new Color3(0.78, 0.58, 1);
  key.specular = new Color3(0.1, 0.08, 0.12);
  key.intensity = 8;
  key.range = 14;
  key.renderPriority = 4;
  key.includedOnlyMeshes.push(...meshes);
  playing.start(true);

  return {
    root,
    body,
    kit,
    meshes,
    dispose() {
      playing.stop();
      key.dispose();
      root.dispose();
      container.dispose();
    },
  };
}
