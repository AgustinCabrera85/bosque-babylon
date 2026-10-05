import "@babylonjs/loaders/glTF";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { LAUTARO_VISUAL_SCALE } from "../../CharacterPresentation";
import {
  HermanoMayorAnimationRegistry,
  type HermanoMayorPlayOptions,
} from "./HermanoMayorAnimations";
import {
  HERMANO_MAYOR_ORIENT_LOOK_ACTION,
  HermanoMayorLookAction,
  type HermanoMayorLookTargetProvider,
} from "./HermanoMayorLookAction";
import {
  HERMANO_MAYOR_NECK_GRAB_ACTION,
  HermanoMayorNeckGrabAction,
  type HermanoMayorNeckGrabPoseState,
  type HermanoMayorNeckTargetProvider,
} from "./HermanoMayorNeckGrabAction";
import type { HermanoMayorAxeHandle } from "./HermanoMayorAxe";
import {
  HERMANO_MAYOR_AXE_PICKUP_ACTION,
  HermanoMayorAxePickupAction,
  type HermanoMayorAxePickupState,
} from "./HermanoMayorAxePickupAction";
import {
  HERMANO_MAYOR_AXE_ATTACK_ACTION,
  HermanoMayorAxeAttackAction,
  type HermanoMayorAxeAttackActionState,
} from "./HermanoMayorAxeAttackAction";
import { patchHermanoMayorMaterial } from "./HermanoMayorMaterials";

export const HERMANO_MAYOR_MODEL_ROOT_URL = "/assets/models/enemies/boss/";
export const HERMANO_MAYOR_MODEL_FILE = "Hermano_mayor_Final_NLA.glb";
const BODY_TURN_WALK_SPEED_RATIO = 0.72;
const BODY_TURN_BLEND_SPEED = 0.08;
// The authored Hermano Mayor rig is ~1.87x taller than Lautaro's at scale 1.
// Compensate that source difference while preserving the configured 1.5x height.
const HERMANO_MAYOR_SOURCE_HEIGHT_RATIO_TO_LAUTARO = 1.87;
export const HERMANO_MAYOR_VISUAL_SCALE =
  (LAUTARO_VISUAL_SCALE * 1.5) / HERMANO_MAYOR_SOURCE_HEIGHT_RATIO_TO_LAUTARO;

export type HermanoMayorPlacement = {
  position: Vector3;
  facingTarget: Vector3;
};

export type HermanoMayorHandle = {
  root: TransformNode;
  meshes: readonly AbstractMesh[];
  hasAxe: boolean;
  hasAxePickupTarget: boolean;
  animations: HermanoMayorAnimationRegistry;
  playLocomotion(
    action: "idle" | "walk" | "run",
    options?: HermanoMayorPlayOptions
  ): void;
  setAxePickupTarget(axe: HermanoMayorAxeHandle | null): void;
  startAxePickup(): boolean;
  cancelAxePickup(): boolean;
  getAxePickupState(): HermanoMayorAxePickupState;
  startAxeAttack(): boolean;
  cancelAxeAttack(): boolean;
  getAxeAttackState(): HermanoMayorAxeAttackActionState;
  getAxeBladeEdgeWorldSegmentToRef(lower: Vector3, upper: Vector3): boolean;
  getAxeAttackDebugSnapshot(): ReturnType<
    HermanoMayorAxeAttackAction["getDebugSnapshot"]
  >;
  getAxeApproachPositionToRef(result: Vector3): boolean;
  getAxeGripPositionToRef(result: Vector3): boolean;
  getAxePickupTableCenterPositionToRef(result: Vector3): boolean;
  getAxeHandPositionToRef(result: Vector3): boolean;
  getAxePickupDebugSnapshot(): ReturnType<
    HermanoMayorAxePickupAction["getDebugSnapshot"]
  >;
  setAxePickupDebugVisible(visible: boolean): void;
  seekAxePickupForDebug(time: number): boolean;
  setLookTargetProvider(provider: HermanoMayorLookTargetProvider | null): void;
  setNeckGrabTargetProvider(provider: HermanoMayorNeckTargetProvider | null): void;
  setNeckGrabPose(state: HermanoMayorNeckGrabPoseState | null): void;
  getNeckGrabDebugSnapshot(): ReturnType<
    HermanoMayorNeckGrabAction["getDebugSnapshot"]
  >;
};

export async function loadHermanoMayor(
  scene: Scene,
  placement: HermanoMayorPlacement
): Promise<HermanoMayorHandle> {
  const result = await SceneLoader.ImportMeshAsync(
    null,
    HERMANO_MAYOR_MODEL_ROOT_URL,
    HERMANO_MAYOR_MODEL_FILE,
    scene
  );
  const root = new TransformNode("hermanoMayorRoot", scene);

  for (const node of [...result.meshes, ...result.transformNodes]) {
    if (!node.parent) node.parent = root;
  }

  const meshes = result.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
  for (const mesh of meshes) {
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.alwaysSelectAsActiveMesh = true;
    patchHermanoMayorMaterial(mesh.material);
  }

  const facing = placement.facingTarget.subtract(placement.position);
  root.position.copyFrom(placement.position);
  root.rotation.y = Math.atan2(facing.x, facing.z);
  root.scaling.setAll(HERMANO_MAYOR_VISUAL_SCALE);
  centerAndGround(root, meshes, placement.position);

  const animations = new HermanoMayorAnimationRegistry(result.animationGroups);
  animations.play("idle", { loop: true });
  const actorMeshes: AbstractMesh[] = [...meshes];

  let bodyTurnWalkOwned = false;
  let playbackBeforeBodyTurn = animations.getCurrentNlaPlayback();
  const playLocomotion = (
    action: "idle" | "walk" | "run",
    options: HermanoMayorPlayOptions = {}
  ) => {
    if (
      axePickupAction?.state === "picking-up" ||
      axeAttackAction?.state === "attacking"
    ) {
      return;
    }
    // A real locomotion request takes ownership away from the temporary
    // walk-in-place used by the procedural look/body turn action.
    bodyTurnWalkOwned = false;
    animations.play(action, { ...options, loop: options.loop ?? true });
  };
  const lookAction = new HermanoMayorLookAction(scene, root, meshes, {
    onStart: () => {
      const current = animations.getCurrentNlaPlayback();
      if (current?.action === "walk") return;
      playbackBeforeBodyTurn = current;
      bodyTurnWalkOwned = true;
      animations.play("walk", {
        loop: true,
        speedRatio: BODY_TURN_WALK_SPEED_RATIO,
        blendingSpeed: BODY_TURN_BLEND_SPEED,
      });
    },
    onEnd: () => {
      if (!bodyTurnWalkOwned) return;
      bodyTurnWalkOwned = false;
      if (animations.getCurrentNlaPlayback()?.action !== "walk") return;

      const previous = playbackBeforeBodyTurn;
      animations.play(previous?.action ?? "idle", {
        ...(previous?.options ?? {}),
        loop: previous?.options.loop ?? true,
        blendingSpeed: BODY_TURN_BLEND_SPEED,
      });
    },
  });
  animations.registerProcedural(HERMANO_MAYOR_ORIENT_LOOK_ACTION, lookAction);
  animations.play(HERMANO_MAYOR_ORIENT_LOOK_ACTION);
  const neckGrabAction = new HermanoMayorNeckGrabAction(
    scene,
    root,
    meshes,
    result.animationGroups
  );
  animations.registerProcedural(HERMANO_MAYOR_NECK_GRAB_ACTION, neckGrabAction);
  const restorePostPickupPresentation = () => {
    bodyTurnWalkOwned = false;
    animations.play("idle", { loop: true, blendingSpeed: BODY_TURN_BLEND_SPEED });
    lookAction.setEnabled(true);
  };
  const axePickupAction = new HermanoMayorAxePickupAction(
    scene,
    root,
    meshes,
    result.animationGroups,
    {
      onReady: restorePostPickupPresentation,
      onCancelled: restorePostPickupPresentation,
    }
  );
  animations.registerProcedural(HERMANO_MAYOR_AXE_PICKUP_ACTION, axePickupAction);
  const restorePostAxeAttackPresentation = () => {
    axePickupAction.setArmedPoseEnabled(true);
    bodyTurnWalkOwned = false;
    animations.play("idle", { loop: true, blendingSpeed: BODY_TURN_BLEND_SPEED });
    lookAction.setEnabled(true);
  };
  const axeAttackAction = new HermanoMayorAxeAttackAction(
    scene,
    meshes,
    result.animationGroups,
    {
      onStarted: () => axePickupAction.setArmedPoseEnabled(false),
      onFinished: restorePostAxeAttackPresentation,
      onCancelled: restorePostAxeAttackPresentation,
    }
  );
  animations.registerProcedural(HERMANO_MAYOR_AXE_ATTACK_ACTION, axeAttackAction);
  let axeTarget: HermanoMayorAxeHandle | null = null;

  const handle: HermanoMayorHandle = {
    root,
    meshes: actorMeshes,
    get hasAxe() {
      return axePickupAction.hasAxe;
    },
    get hasAxePickupTarget() {
      return axeTarget !== null;
    },
    animations,
    playLocomotion,
    setAxePickupTarget: (axe) => {
      axeTarget = axe;
      axePickupAction.setAxe(axe);
      axeAttackAction.setAxe(axe);
    },
    startAxePickup: () => {
      if (!axePickupAction.canStart()) return false;
      lookAction.setEnabled(false);
      neckGrabAction.setEnabled(false);
      bodyTurnWalkOwned = false;
      animations.play("idle", { loop: true, blendingSpeed: BODY_TURN_BLEND_SPEED });
      if (axePickupAction.start()) return true;
      lookAction.setEnabled(true);
      return false;
    },
    cancelAxePickup: () => axePickupAction.cancel(),
    getAxePickupState: () => axePickupAction.state,
    startAxeAttack: () => {
      if (!axeAttackAction.canStart()) return false;
      lookAction.setEnabled(false);
      neckGrabAction.setEnabled(false);
      bodyTurnWalkOwned = false;
      animations.play("idle", { loop: true, blendingSpeed: BODY_TURN_BLEND_SPEED });
      if (axeAttackAction.start()) return true;
      restorePostAxeAttackPresentation();
      return false;
    },
    cancelAxeAttack: () => axeAttackAction.cancel(),
    getAxeAttackState: () => axeAttackAction.state,
    getAxeBladeEdgeWorldSegmentToRef: (lower, upper) =>
      axeAttackAction.getBladeEdgeWorldSegmentToRef(lower, upper),
    getAxeAttackDebugSnapshot: () => axeAttackAction.getDebugSnapshot(),
    getAxeApproachPositionToRef: (result) =>
      axePickupAction.getApproachPositionToRef(result),
    getAxeGripPositionToRef: (result) =>
      axePickupAction.getAxeGripPositionToRef(result),
    getAxePickupTableCenterPositionToRef: (result) =>
      axePickupAction.getPickupTableCenterPositionToRef(result),
    getAxeHandPositionToRef: (result) =>
      axePickupAction.getHandGripPositionToRef(result),
    getAxePickupDebugSnapshot: () => axePickupAction.getDebugSnapshot(),
    setAxePickupDebugVisible: (visible) =>
      axePickupAction.setDebugVisible(visible),
    seekAxePickupForDebug: (time) => axePickupAction.seekForDebug(time),
    setLookTargetProvider: (provider) => lookAction.setTargetProvider(provider),
    setNeckGrabTargetProvider: (provider) =>
      neckGrabAction.setTargetProvider(provider),
    setNeckGrabPose: (state) => {
      if (state) {
        if (axePickupAction.state !== "unarmed") return;
        lookAction.setEnabled(false);
        neckGrabAction.setPoseState(state);
        neckGrabAction.setEnabled(true);
        return;
      }
      neckGrabAction.setEnabled(false);
      lookAction.setEnabled(true);
    },
    getNeckGrabDebugSnapshot: () => neckGrabAction.getDebugSnapshot(),
  };
  scene.onDisposeObservable.addOnce(() => {
    axeAttackAction.dispose();
    axePickupAction.dispose();
    neckGrabAction.dispose();
    lookAction.dispose();
  });
  return handle;
}

function centerAndGround(
  root: TransformNode,
  meshes: readonly AbstractMesh[],
  targetPosition: Vector3
) {
  root.computeWorldMatrix(true);
  for (const mesh of meshes) mesh.computeWorldMatrix(true);
  if (!meshes.length) return;

  const firstBox = meshes[0].getBoundingInfo().boundingBox;
  const min = firstBox.minimumWorld.clone();
  const max = firstBox.maximumWorld.clone();
  for (let i = 1; i < meshes.length; i++) {
    const box = meshes[i].getBoundingInfo().boundingBox;
    min.minimizeInPlace(box.minimumWorld);
    max.maximizeInPlace(box.maximumWorld);
  }

  root.position.x += targetPosition.x - (min.x + max.x) * 0.5;
  root.position.y += targetPosition.y - min.y;
  root.position.z += targetPosition.z - (min.z + max.z) * 0.5;
  root.computeWorldMatrix(true);
  for (const mesh of meshes) mesh.computeWorldMatrix(true);
}
