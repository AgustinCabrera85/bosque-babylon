import "@babylonjs/loaders/glTF";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { RinaController } from "../../enemies/rina";
import { asset } from "../../../utils/asset";

const MICROPHONE_ROOT = "assets/models/enemies/rina/";
const MICROPHONE_FILE = "Microfono_de_Rina.glb";

/** The source microphone is roughly one unit long; Rina's source height is one unit. */
const MICROPHONE_SCALE = 0.1;

export async function attachRinaMicrophone(scene: Scene, rina: RinaController) {
  const hand = rina.rig.getJointNode("rightHand");
  if (!hand) throw new Error("Rina microphone: right hand joint is unavailable");

  const imported = await SceneLoader.ImportMeshAsync(
    null,
    asset(MICROPHONE_ROOT),
    MICROPHONE_FILE,
    scene
  );
  if (scene.isDisposed) return;

  const modelRoot = imported.meshes.find((mesh) => !mesh.parent);
  if (!modelRoot) {
    throw new Error("Rina microphone: model root is unavailable");
  }

  const grip = new TransformNode("rinaMicrophoneGrip", scene);
  grip.parent = hand;
  // The hand joint is at the wrist; the model origin belongs on the inner palm.
  grip.position.set(0, 0.037, 0.012);
  grip.rotation.z = -Math.PI / 3;
  grip.scaling.setAll(MICROPHONE_SCALE);
  modelRoot.parent = grip;

  for (const mesh of imported.meshes) {
    if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) continue;
    mesh.name = "rinaMicrophone";
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
  }
}
