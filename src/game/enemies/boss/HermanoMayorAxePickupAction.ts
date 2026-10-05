import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { AxesViewer } from "@babylonjs/core/Debug/axesViewer";
import type { ProceduralAnimationDefinition } from "../../animation/ProceduralAnimationDefinition";
import { ProceduralAnimationPlayer } from "../../animation/ProceduralAnimationPlayer";
import type { ProceduralPose } from "../../animation/ProceduralPose";
import { ProceduralPosePlayer } from "../../animation/ProceduralPosePlayer";
import {
  MixamoProceduralRig,
  type MixamoJointName,
} from "../../animation/MixamoProceduralRig";
import {
  createHermanoMayorHandGripSocket,
  HERMANO_MAYOR_AXE_READY_WRIST_PITCH_DEGREES,
  HERMANO_MAYOR_AXE_READY_WRIST_ROLL_DEGREES,
  HERMANO_MAYOR_AXE_READY_WRIST_YAW_DEGREES,
  type HermanoMayorAxeHandle,
} from "./HermanoMayorAxe";
import type { HermanoMayorProceduralAction } from "./HermanoMayorAnimations";

export const HERMANO_MAYOR_AXE_PICKUP_ACTION = "recoger hacha";
export { HERMANO_MAYOR_AXE_READY_WRIST_ROLL_DEGREES };

export const HERMANO_MAYOR_AXE_PICKUP_TIMING = {
  noticeEnd: 0.55,
  reachEnd: 1.55,
  palmContactAt: 2.05,
  gripEnd: 2.9,
  attachAt: 2.92,
  liftEnd: 3.95,
  settleEnd: 4.75,
} as const;

export type HermanoMayorAxePickupState = "unarmed" | "picking-up" | "armed";
export type HermanoMayorAxePickupPhase =
  | "idle"
  | "notice"
  | "reach"
  | "pre-grip"
  | "grip"
  | "lift"
  | "settle"
  | "ready";

export type HermanoMayorAxePickupHooks = {
  onReady?(): void;
  onCancelled?(): void;
};

const RIGHT_ARM_JOINTS = [
  "spine",
  "spine1",
  "rightShoulder",
  "rightArm",
  "rightForeArm",
  "rightHand",
  "rightHandThumb1",
  "rightHandThumb2",
  "rightHandThumb3",
  "rightHandIndex1",
  "rightHandIndex2",
  "rightHandIndex3",
  "rightHandMiddle1",
  "rightHandMiddle2",
  "rightHandMiddle3",
  "rightHandRing1",
  "rightHandRing2",
  "rightHandRing3",
  "rightHandPinky1",
  "rightHandPinky2",
  "rightHandPinky3",
] as const satisfies readonly MixamoJointName[];

const RIGHT_FINGER_CHAINS = [
  ["rightHandIndex1", "rightHandIndex2", "rightHandIndex3"],
  ["rightHandMiddle1", "rightHandMiddle2", "rightHandMiddle3"],
  ["rightHandRing1", "rightHandRing2", "rightHandRing3"],
  ["rightHandPinky1", "rightHandPinky2", "rightHandPinky3"],
] as const satisfies readonly (readonly MixamoJointName[])[];

const BONE = {
  spine: "mixamorig:Spine",
  spine1: "mixamorig:Spine1",
  shoulder: "mixamorig:RightShoulder",
  arm: "mixamorig:RightArm",
  foreArm: "mixamorig:RightForeArm",
  hand: "mixamorig:RightHand",
  thumb1: "mixamorig:RightHandThumb1",
  thumb2: "mixamorig:RightHandThumb2",
  thumb3: "mixamorig:RightHandThumb3",
  index1: "mixamorig:RightHandIndex1",
  index2: "mixamorig:RightHandIndex2",
  index3: "mixamorig:RightHandIndex3",
  middle1: "mixamorig:RightHandMiddle1",
  middle2: "mixamorig:RightHandMiddle2",
  middle3: "mixamorig:RightHandMiddle3",
  ring1: "mixamorig:RightHandRing1",
  ring2: "mixamorig:RightHandRing2",
  ring3: "mixamorig:RightHandRing3",
  pinky1: "mixamorig:RightHandPinky1",
  pinky2: "mixamorig:RightHandPinky2",
  pinky3: "mixamorig:RightHandPinky3",
} as const;

const NOTICE_POSE = createPose("axe-notice", [
  [BONE.spine, -2, -3, 0],
  [BONE.spine1, -4, -5, 0],
  [BONE.shoulder, 0, 0, -5],
]);

const REACH_POSE = createPose("axe-reach", [
  [BONE.spine, -7, -5, 0],
  [BONE.spine1, -11, -7, 0],
  [BONE.shoulder, 0, 0, -9],
  [BONE.arm, -48, -8, -24],
  [BONE.foreArm, 0, 0, -34],
  [BONE.hand, 5, -10, 0],
]);

const PRE_GRIP_POSE = createPose("axe-pre-grip", [
  [BONE.spine, -8, -5, 0],
  [BONE.spine1, -13, -8, 0],
  [BONE.shoulder, 0, 0, -10],
  [BONE.arm, -54, -10, -27],
  [BONE.foreArm, 0, 0, -42],
  [BONE.hand, 7, -15, 0],
  ...fingerCurlEntries(0.04),
]);

// The palm is already resting on the handle here. Keeping the fingers nearly
// open for a beat makes the following curl legible in the close camera.
const PALM_CONTACT_POSE = createPose("axe-palm-contact", [
  [BONE.spine, -8, -5, 0],
  [BONE.spine1, -13, -8, 0],
  [BONE.shoulder, 0, 0, -10],
  [BONE.arm, -54, -10, -27],
  [BONE.foreArm, 0, 0, -42],
  [BONE.hand, 8, -15, 30],
  ...fingerCurlEntries(0.1),
]);

const GRIP_POSE = createPose("axe-grip", [
  [BONE.spine, -8, -5, 0],
  [BONE.spine1, -13, -8, 0],
  [BONE.shoulder, 0, 0, -10],
  [BONE.arm, -54, -10, -27],
  [BONE.foreArm, 0, 0, -42],
  [BONE.hand, 8, -15, 30],
  ...fingerCurlEntries(1),
]);

const LIFT_POSE = createPose("axe-lift", [
  [BONE.spine, -3, -2, 0],
  [BONE.spine1, -5, -3, 0],
  [BONE.shoulder, 0, 0, -6],
  [BONE.arm, -25, -5, -13],
  [BONE.foreArm, 0, 0, -38],
  [BONE.hand, 10, -14, 38],
  ...fingerCurlEntries(1),
]);

const READY_POSE = createPose("axe-ready", [
  [BONE.spine, 0, -1.5, 0],
  [BONE.spine1, -1.5, -2, 0],
  [BONE.shoulder, 0, 0, -4],
  [BONE.arm, -4, -3, -7],
  [BONE.foreArm, 0, 0, -8],
  [
    BONE.hand,
    HERMANO_MAYOR_AXE_READY_WRIST_PITCH_DEGREES,
    HERMANO_MAYOR_AXE_READY_WRIST_YAW_DEGREES,
    HERMANO_MAYOR_AXE_READY_WRIST_ROLL_DEGREES,
  ],
  ...fingerCurlEntries(1),
]);

export const HERMANO_MAYOR_AXE_PICKUP_ANIMATION: ProceduralAnimationDefinition = {
  id: "hermano-mayor-axe-pickup",
  poses: {
    [NOTICE_POSE.id]: NOTICE_POSE,
    [REACH_POSE.id]: REACH_POSE,
    [PRE_GRIP_POSE.id]: PRE_GRIP_POSE,
    [PALM_CONTACT_POSE.id]: PALM_CONTACT_POSE,
    [GRIP_POSE.id]: GRIP_POSE,
    [LIFT_POSE.id]: LIFT_POSE,
    [READY_POSE.id]: READY_POSE,
  },
  timeline: [
    { time: 0, poseId: NOTICE_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_PICKUP_TIMING.noticeEnd, poseId: REACH_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_PICKUP_TIMING.reachEnd, poseId: PRE_GRIP_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_PICKUP_TIMING.palmContactAt, poseId: PALM_CONTACT_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_PICKUP_TIMING.gripEnd, poseId: GRIP_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_PICKUP_TIMING.liftEnd, poseId: LIFT_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd, poseId: READY_POSE.id, easing: "smooth" },
  ],
};

export class HermanoMayorAxePickupAction
  implements HermanoMayorProceduralAction
{
  private readonly rig: MixamoProceduralRig;
  private readonly posePlayer = new ProceduralPosePlayer();
  private readonly animationPlayer = new ProceduralAnimationPlayer(this.posePlayer);
  private readonly handGripSocket: TransformNode | null;
  private readonly axeTarget = Vector3.Zero();
  private readonly handPosition = Vector3.Zero();
  private readonly ikTarget = Vector3.Zero();
  private readonly stagingRootPosition = Vector3.Zero();
  private readonly gripRootPosition = Vector3.Zero();
  private readonly rootCorrection = Vector3.Zero();
  private readonly approachPosition = Vector3.Zero();
  private readonly debugPosition = Vector3.Zero();
  private readonly debugAxisX = Vector3.Right();
  private readonly debugAxisY = Vector3.Up();
  private readonly debugAxisZ = Vector3.Forward();
  private readonly debugMarkers = new Map<string, Mesh>();
  private debugHandAxes: AxesViewer | null = null;
  private debugAxeAxes: AxesViewer | null = null;
  private beforeAnimationsObserver: Observer<Scene> | null = null;
  private afterAnimationsObserver: Observer<Scene> | null = null;
  private axe: HermanoMayorAxeHandle | null = null;
  private requestedEnabled = false;
  private poseApplied = false;
  private currentState: HermanoMayorAxePickupState = "unarmed";
  private attached = false;
  private hasGripRootPosition = false;

  public constructor(
    private readonly scene: Scene,
    private readonly root: TransformNode,
    meshes: readonly AbstractMesh[],
    animationGroups: readonly AnimationGroup[],
    private readonly hooks: HermanoMayorAxePickupHooks = {}
  ) {
    this.rig = new MixamoProceduralRig(meshes, animationGroups, RIGHT_ARM_JOINTS);
    const rightHand = this.rig.getJointNode("rightHand");
    const fingerBases = [
      this.rig.getJointNode("rightHandIndex1"),
      this.rig.getJointNode("rightHandMiddle1"),
      this.rig.getJointNode("rightHandRing1"),
      this.rig.getJointNode("rightHandPinky1"),
    ].filter((joint): joint is TransformNode => joint !== null);
    this.handGripSocket = rightHand
      ? createHermanoMayorHandGripSocket(scene, rightHand, fingerBases)
      : null;
    if (!this.rig.available || !this.handGripSocket) {
      console.warn(
        `[HermanoMayor] Pickup de hacha deshabilitado; faltan huesos: ${
          this.rig.getMissingRequiredBones().join(", ") || "RightHand"
        }.`
      );
      return;
    }

    this.beforeAnimationsObserver = scene.onBeforeAnimationsObservable.add(() => {
      this.restoreBasePose();
    });
    this.afterAnimationsObserver = scene.onAfterAnimationsObservable.add(() => {
      this.update(Math.max(0, Math.min(scene.getEngine().getDeltaTime() * 0.001, 0.05)));
    });
  }

  public get enabled() {
    return this.requestedEnabled;
  }

  public get state() {
    return this.currentState;
  }

  public get hasAxe() {
    return this.attached;
  }

  public setEnabled(enabled: boolean) {
    if (enabled) this.start();
    else this.cancel();
  }

  public setAxe(axe: HermanoMayorAxeHandle | null) {
    if (this.attached) return;
    this.axe = axe;
    if (!axe || !axe.getGripWorldPositionToRef(this.axeTarget)) return;
    this.updateApproachPosition();
  }

  public canStart() {
    return (
      this.rig.available &&
      this.handGripSocket !== null &&
      this.axe !== null &&
      !this.axe.attached &&
      this.currentState === "unarmed"
    );
  }

  public start() {
    if (!this.canStart()) return false;
    this.requestedEnabled = true;
    this.currentState = "picking-up";
    this.attached = false;
    this.hasGripRootPosition = false;
    this.stagingRootPosition.copyFrom(this.root.position);
    this.animationPlayer.setLoop(false);
    this.animationPlayer.play(HERMANO_MAYOR_AXE_PICKUP_ANIMATION);
    return true;
  }

  public cancel() {
    if (this.currentState === "unarmed") return true;
    if (this.currentState === "armed") return false;
    this.requestedEnabled = false;
    if (this.attached) {
      this.restoreStagingRootPosition();
      this.currentState = "armed";
      this.animationPlayer.seek(HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd);
      this.hooks.onReady?.();
      return false;
    }
    this.restoreStagingRootPosition();
    this.currentState = "unarmed";
    this.animationPlayer.stop();
    this.restoreBasePose();
    this.hooks.onCancelled?.();
    return true;
  }

  public getApproachPositionToRef(result: Vector3) {
    if (!this.axe || this.attached) return false;
    if (!this.updateApproachPosition()) return false;
    result.copyFrom(this.approachPosition);
    return true;
  }

  public getAxeGripPositionToRef(result: Vector3) {
    return this.axe?.getGripWorldPositionToRef(result) ?? false;
  }

  public getHandGripPositionToRef(result: Vector3) {
    if (!this.handGripSocket) return false;
    this.handGripSocket.computeWorldMatrix(true);
    result.copyFrom(this.handGripSocket.getAbsolutePosition());
    return true;
  }

  public getDebugSnapshot() {
    this.getAxeGripPositionToRef(this.axeTarget);
    this.getHandGripPositionToRef(this.handPosition);
    this.updateApproachPosition();
    const playback = this.animationPlayer.getState();
    return {
      available: this.rig.available && this.handGripSocket !== null,
      state: this.currentState,
      phase: phaseFor(playback.time, this.currentState),
      time: playback.time,
      duration: playback.duration,
      progress: playback.duration > 0 ? playback.time / playback.duration : 0,
      attached: this.attached,
      axeGripTarget: vectorSnapshot(this.axeTarget),
      handGripPosition: vectorSnapshot(this.handPosition),
      approachPosition: vectorSnapshot(this.approachPosition),
      attachment:
        this.axe && this.handGripSocket
          ? this.axe.getAttachmentDebugSnapshot(this.handGripSocket)
          : null,
      fingerGrip: this.getFingerGripDebugSnapshot(),
      resolvedBones: this.rig.getResolvedBones(),
    };
  }

  public setDebugVisible(visible: boolean) {
    if (!import.meta.env.DEV) return;
    if (visible && this.debugMarkers.size === 0) {
      this.createDebugMarkers();
      this.createDebugAxes();
    }
    for (const marker of this.debugMarkers.values()) marker.setEnabled(visible);
    this.debugHandAxes?.xAxis.setEnabled(visible);
    this.debugHandAxes?.yAxis.setEnabled(visible);
    this.debugHandAxes?.zAxis.setEnabled(visible);
    this.debugAxeAxes?.xAxis.setEnabled(visible);
    this.debugAxeAxes?.yAxis.setEnabled(visible);
    this.debugAxeAxes?.zAxis.setEnabled(visible);
    this.axe?.setDebugBoundsVisible(visible);
    if (visible) this.updateDebugMarkers();
  }

  public seekForDebug(time: number) {
    if (!import.meta.env.DEV || this.currentState !== "picking-up") return false;
    this.restoreBasePose();
    this.animationPlayer.seek(time);
    this.update(Number.EPSILON);
    return true;
  }

  public dispose() {
    this.restoreBasePose();
    if (this.beforeAnimationsObserver) {
      this.scene.onBeforeAnimationsObservable.remove(this.beforeAnimationsObserver);
      this.beforeAnimationsObserver = null;
    }
    if (this.afterAnimationsObserver) {
      this.scene.onAfterAnimationsObservable.remove(this.afterAnimationsObserver);
      this.afterAnimationsObserver = null;
    }
    this.handGripSocket?.dispose();
    this.debugHandAxes?.dispose();
    this.debugAxeAxes?.dispose();
    this.debugHandAxes = null;
    this.debugAxeAxes = null;
    for (const marker of this.debugMarkers.values()) {
      marker.material?.dispose();
      marker.dispose();
    }
    this.debugMarkers.clear();
  }

  private update(dt: number) {
    if (!this.rig.available || !this.handGripSocket || dt <= 0) return;
    if (this.currentState === "unarmed") {
      this.updateDebugMarkers();
      return;
    }
    if (this.currentState === "picking-up") this.animationPlayer.update(dt);
    const playback = this.animationPlayer.getState();
    if (this.currentState === "picking-up" && !this.attached) {
      this.root.position.copyFrom(this.stagingRootPosition);
      this.root.computeWorldMatrix(true);
    }

    this.rig.captureBasePose();
    for (const [name, offset] of this.posePlayer.getOffsets()) {
      this.rig.applyLocalQuaternionOffset(name, offset);
    }
    this.rig.prepare();

    if (this.currentState === "picking-up" && !this.attached && this.axe) {
      this.axe.getGripWorldPositionToRef(this.axeTarget);
      this.applyReachIk(playback.time);
      if (playback.time >= HERMANO_MAYOR_AXE_PICKUP_TIMING.attachAt) {
        this.attached = this.axe.attachToHandSocket(this.handGripSocket);
        if (this.attached) {
          this.gripRootPosition.copyFrom(this.root.position);
          this.hasGripRootPosition = true;
        }
      }
    }
    if (
      this.currentState === "picking-up" &&
      this.attached &&
      this.hasGripRootPosition
    ) {
      this.applyRootRecovery(playback.time);
    }

    this.getHandGripPositionToRef(this.handPosition);
    this.updateDebugMarkers();
    this.poseApplied = true;
    if (
      this.currentState === "picking-up" &&
      playback.time >= HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd
    ) {
      this.currentState = "armed";
      this.requestedEnabled = true;
      this.hooks.onReady?.();
    }
  }

  private applyReachIk(time: number) {
    if (!this.handGripSocket) return;
    const reachIn = smoothstep(
      HERMANO_MAYOR_AXE_PICKUP_TIMING.noticeEnd * 0.65,
      HERMANO_MAYOR_AXE_PICKUP_TIMING.palmContactAt,
      time
    );
    const weight = reachIn;
    if (weight <= 0.0001) return;
    this.getHandGripPositionToRef(this.handPosition);
    Vector3.LerpToRef(this.handPosition, this.axeTarget, weight, this.ikTarget);
    this.rig.solveCcdToTarget(
      [
        { joint: "rightForeArm", maxAngle: radians(18) },
        { joint: "rightArm", maxAngle: radians(16) },
      ],
      this.handGripSocket,
      this.ikTarget,
      14
    );
    // The nearby trigger intentionally does not require physical arm reach.
    // During the insert, translate the actor by the solver's remaining error
    // so the palm truly lands on the handle. The close framing hides the feet;
    // after attachment the lift restores the navigation position smoothly.
    const correctionWeight = smoothstep(
      HERMANO_MAYOR_AXE_PICKUP_TIMING.reachEnd,
      HERMANO_MAYOR_AXE_PICKUP_TIMING.palmContactAt,
      time
    );
    if (correctionWeight <= 0.0001) return;
    this.getHandGripPositionToRef(this.handPosition);
    this.axeTarget
      .subtractToRef(this.handPosition, this.rootCorrection);
    this.root.position.addInPlace(
      this.rootCorrection.scaleInPlace(correctionWeight)
    );
    this.root.computeWorldMatrix(true);
    this.rig.prepare();
  }

  private applyRootRecovery(time: number) {
    const amount = smoothstep(
      HERMANO_MAYOR_AXE_PICKUP_TIMING.attachAt + 0.08,
      HERMANO_MAYOR_AXE_PICKUP_TIMING.liftEnd,
      time
    );
    Vector3.LerpToRef(
      this.gripRootPosition,
      this.stagingRootPosition,
      amount,
      this.root.position
    );
    this.root.computeWorldMatrix(true);
    this.rig.prepare();
  }

  private restoreStagingRootPosition() {
    this.root.position.copyFrom(this.stagingRootPosition);
    this.root.computeWorldMatrix(true);
    this.hasGripRootPosition = false;
  }

  private updateApproachPosition() {
    if (!this.axe) return false;
    if (this.axe.getPickupApproachWorldPositionToRef(this.approachPosition)) {
      this.approachPosition.y = this.root.position.y;
      return true;
    }
    if (!this.axe.getGripWorldPositionToRef(this.axeTarget)) return false;
    const dx = this.root.position.x - this.axeTarget.x;
    const dz = this.root.position.z - this.axeTarget.z;
    const length = Math.hypot(dx, dz);
    const directionX = length > 0.001 ? dx / length : -Math.sin(this.root.rotation.y);
    const directionZ = length > 0.001 ? dz / length : -Math.cos(this.root.rotation.y);
    this.approachPosition.set(
      this.axeTarget.x + directionX * 1.12,
      this.root.position.y,
      this.axeTarget.z + directionZ * 1.12
    );
    return true;
  }

  private restoreBasePose() {
    if (!this.poseApplied) return;
    this.rig.restoreBasePose();
    this.poseApplied = false;
  }

  private createDebugMarkers() {
    const definitions: Array<[string, Color3]> = [
      ["axeGripTarget", new Color3(1, 0.48, 0.08)],
      ["axeRootOrigin", new Color3(0.85, 0.15, 1)],
      ["handGripSocket", new Color3(0.1, 0.9, 1)],
      ["rightElbow", new Color3(1, 0.15, 0.72)],
      ["rightShoulder", new Color3(0.25, 1, 0.35)],
    ];
    for (const [name, color] of definitions) {
      const marker = MeshBuilder.CreateSphere(
        `hermanoMayorAxeDebug_${name}`,
        { diameter: 0.075, segments: 8 },
        this.scene
      );
      const material = new StandardMaterial(
        `hermanoMayorAxeDebug_${name}_material`,
        this.scene
      );
      material.disableLighting = true;
      material.emissiveColor.copyFrom(color);
      marker.material = material;
      marker.isPickable = false;
      marker.renderingGroupId = 3;
      this.debugMarkers.set(name, marker);
    }
  }

  private createDebugAxes() {
    this.debugHandAxes = new AxesViewer(this.scene, 0.18, 3);
    this.debugAxeAxes = new AxesViewer(this.scene, 0.18, 3);
  }

  private updateDebugMarkers() {
    const axe = this.debugMarkers.get("axeGripTarget");
    if (axe && this.getAxeGripPositionToRef(this.debugPosition)) {
      axe.position.copyFrom(this.debugPosition);
    }
    const axeRoot = this.debugMarkers.get("axeRootOrigin");
    if (axeRoot && this.axe?.getRootWorldPositionToRef(this.debugPosition)) {
      axeRoot.position.copyFrom(this.debugPosition);
    }
    const hand = this.debugMarkers.get("handGripSocket");
    if (hand && this.getHandGripPositionToRef(this.debugPosition)) {
      hand.position.copyFrom(this.debugPosition);
    }
    const elbow = this.debugMarkers.get("rightElbow");
    if (elbow && this.rig.getJointWorldPositionToRef("rightForeArm", this.debugPosition)) {
      elbow.position.copyFrom(this.debugPosition);
    }
    const shoulder = this.debugMarkers.get("rightShoulder");
    if (shoulder && this.rig.getJointWorldPositionToRef("rightArm", this.debugPosition)) {
      shoulder.position.copyFrom(this.debugPosition);
    }
    if (
      this.debugHandAxes &&
      this.handGripSocket &&
      !this.handGripSocket.isDisposed()
    ) {
      this.handGripSocket.computeWorldMatrix(true);
      this.updateAxesViewer(this.debugHandAxes, this.handGripSocket);
    }
    if (
      this.debugAxeAxes &&
      this.axe?.getGripWorldPositionToRef(this.debugPosition) &&
      this.axe.getGripWorldAxesToRef(
        this.debugAxisX,
        this.debugAxisY,
        this.debugAxisZ
      )
    ) {
      this.debugAxeAxes.update(
        this.debugPosition,
        this.debugAxisX,
        this.debugAxisY,
        this.debugAxisZ
      );
    }
  }

  private updateAxesViewer(viewer: AxesViewer, node: TransformNode) {
    node.computeWorldMatrix(true);
    Vector3.TransformNormalToRef(
      Vector3.Right(),
      node.getWorldMatrix(),
      this.debugAxisX
    );
    Vector3.TransformNormalToRef(
      Vector3.Up(),
      node.getWorldMatrix(),
      this.debugAxisY
    );
    Vector3.TransformNormalToRef(
      Vector3.Forward(),
      node.getWorldMatrix(),
      this.debugAxisZ
    );
    this.debugAxisX.normalize();
    this.debugAxisY.normalize();
    this.debugAxisZ.normalize();
    viewer.update(
      node.getAbsolutePosition(),
      this.debugAxisX,
      this.debugAxisY,
      this.debugAxisZ
    );
  }

  private getFingerGripDebugSnapshot() {
    if (!this.handGripSocket) return [];
    this.handGripSocket.computeWorldMatrix(true);
    const inverseGripWorld = Matrix.Invert(
      this.handGripSocket.getWorldMatrix()
    );
    return RIGHT_FINGER_CHAINS.flatMap((chain) =>
      chain.map((joint) => {
        const node = this.rig.getJointNode(joint);
        if (!node) return { joint, available: false as const };
        node.computeWorldMatrix(true);
        const local = Vector3.TransformCoordinates(
          node.getAbsolutePosition(),
          inverseGripWorld
        );
        return {
          joint,
          available: true as const,
          handleLocalPosition: vectorSnapshot(local),
          radialDistanceFromHandleAxis: Math.hypot(local.x, local.z),
        };
      })
    );
  }
}

type PoseEntry = readonly [string, number, number, number];

function createPose(id: string, entries: readonly PoseEntry[]): ProceduralPose {
  const bones: ProceduralPose["bones"] = {};
  for (const [name, pitch, yaw, roll] of entries) {
    const value = Quaternion.RotationYawPitchRoll(
      radians(yaw),
      radians(pitch),
      radians(roll)
    ).normalize();
    bones[name] = {
      rotationOffset: [value.x, value.y, value.z, value.w],
    };
  }
  return { id, source: { model: "hermanoMayor", animation: "Idle" }, bones };
}

function fingerCurlEntries(weight: number): PoseEntry[] {
  const result: PoseEntry[] = [];
  const chains = [
    [BONE.index1, BONE.index2, BONE.index3],
    [BONE.middle1, BONE.middle2, BONE.middle3],
    [BONE.ring1, BONE.ring2, BONE.ring3],
    [BONE.pinky1, BONE.pinky2, BONE.pinky3],
  ];
  const curls = [52, 72, 58];
  for (const chain of chains) {
    for (let index = 0; index < chain.length; index += 1) {
      // This asset's right-hand phalanxes flex toward the palm on positive
      // local X. Negative X hyperextends the fingertips behind the hand.
      result.push([chain[index], curls[index] * weight, 0, 0]);
    }
  }
  result.push(
    [BONE.thumb1, 0, 0, -32 * weight],
    [BONE.thumb2, 0, 0, 40 * weight],
    [BONE.thumb3, 34 * weight, 0, 0]
  );
  return result;
}

function phaseFor(
  time: number,
  state: HermanoMayorAxePickupState
): HermanoMayorAxePickupPhase {
  if (state === "unarmed") return "idle";
  if (state === "armed") return "ready";
  if (time < HERMANO_MAYOR_AXE_PICKUP_TIMING.noticeEnd) return "notice";
  if (time < HERMANO_MAYOR_AXE_PICKUP_TIMING.reachEnd) return "reach";
  if (time < HERMANO_MAYOR_AXE_PICKUP_TIMING.palmContactAt) return "pre-grip";
  if (time < HERMANO_MAYOR_AXE_PICKUP_TIMING.attachAt + 0.08) return "grip";
  if (time < HERMANO_MAYOR_AXE_PICKUP_TIMING.liftEnd) return "lift";
  if (time < HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd) return "settle";
  return "ready";
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = Math.max(
    0,
    Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0))
  );
  return amount * amount * (3 - 2 * amount);
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function vectorSnapshot(value: Vector3) {
  return { x: value.x, y: value.y, z: value.z };
}
