import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { ProceduralAnimationDefinition } from "../../animation/ProceduralAnimationDefinition";
import { ProceduralAnimationPlayer } from "../../animation/ProceduralAnimationPlayer";
import type { ProceduralPose } from "../../animation/ProceduralPose";
import { ProceduralPosePlayer } from "../../animation/ProceduralPosePlayer";
import {
  MixamoProceduralRig,
  type MixamoJointName,
} from "../../animation/MixamoProceduralRig";
import type { HermanoMayorAxeHandle } from "./HermanoMayorAxe";
import {
  HERMANO_MAYOR_AXE_READY_WRIST_PITCH_DEGREES,
  HERMANO_MAYOR_AXE_READY_WRIST_ROLL_DEGREES,
  HERMANO_MAYOR_AXE_READY_WRIST_YAW_DEGREES,
} from "./HermanoMayorAxe";
import type { HermanoMayorProceduralAction } from "./HermanoMayorAnimations";
import { HermanoMayorAxeTrail } from "./HermanoMayorAxeTrail";

export const HERMANO_MAYOR_AXE_ATTACK_ACTION = "atacar con hacha";

export const HERMANO_MAYOR_AXE_ATTACK_TIMING = {
  windupEnd: 0.44,
  commitAt: 0.6,
  damageStart: 0.68,
  impactAt: 0.84,
  damageEnd: 1.02,
  followThroughEnd: 1.12,
  recoveryEnd: 1.62,
} as const;

export type HermanoMayorAxeAttackActionState = "ready" | "attacking";

export type HermanoMayorAxeAttackActionHooks = {
  onStarted?(): void;
  onFinished?(): void;
  onCancelled?(): void;
};

const RIGHT_FINGER_JOINTS = [
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

const REQUIRED_JOINTS = [
  "spine",
  "spine1",
  "spine2",
  "leftShoulder",
  "leftArm",
  "leftForeArm",
  "leftHand",
  "rightShoulder",
  "rightArm",
  "rightForeArm",
  "rightHand",
  ...RIGHT_FINGER_JOINTS,
] as const satisfies readonly MixamoJointName[];

const BONE = {
  spine: "mixamorig:Spine",
  spine1: "mixamorig:Spine1",
  spine2: "mixamorig:Spine2",
  leftShoulder: "mixamorig:LeftShoulder",
  leftArm: "mixamorig:LeftArm",
  leftForeArm: "mixamorig:LeftForeArm",
  leftHand: "mixamorig:LeftHand",
  rightShoulder: "mixamorig:RightShoulder",
  rightArm: "mixamorig:RightArm",
  rightForeArm: "mixamorig:RightForeArm",
  rightHand: "mixamorig:RightHand",
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

const READY_POSE = createPose("axe-attack-ready", [
  [BONE.spine, 0, -1.5, 0],
  [BONE.spine1, -1.5, -2, 0],
  [BONE.rightShoulder, 0, 0, -4],
  [BONE.rightArm, -4, -3, -7],
  [BONE.rightForeArm, 0, 0, -8],
  [
    BONE.rightHand,
    HERMANO_MAYOR_AXE_READY_WRIST_PITCH_DEGREES,
    HERMANO_MAYOR_AXE_READY_WRIST_YAW_DEGREES,
    HERMANO_MAYOR_AXE_READY_WRIST_ROLL_DEGREES,
  ],
  ...fingerCurlEntries(1),
]);

// The shoulder and torso load the axe above the right side while the free arm
// opens for balance. A short hold before commit makes the attack readable.
const WINDUP_POSE = createPose("axe-attack-windup", [
  [BONE.spine, -7, 18, -5],
  [BONE.spine1, -10, 24, -8],
  [BONE.spine2, -7, 16, -7],
  [BONE.leftShoulder, 0, 0, 7],
  [BONE.leftArm, -12, 18, 20],
  [BONE.leftForeArm, 0, 0, 24],
  [BONE.leftHand, -4, 0, -8],
  [BONE.rightShoulder, 0, 0, -15],
  [BONE.rightArm, -82, -14, -58],
  [BONE.rightForeArm, 0, 0, -68],
  [BONE.rightHand, 18, -8, 55],
  ...fingerCurlEntries(1),
]);

const COMMIT_POSE = createPose("axe-attack-commit", [
  [BONE.spine, -4, 11, -3],
  [BONE.spine1, -6, 15, -5],
  [BONE.spine2, -4, 10, -4],
  [BONE.leftShoulder, 0, 0, 5],
  [BONE.leftArm, -10, 12, 17],
  [BONE.leftForeArm, 0, 0, 20],
  [BONE.rightShoulder, 0, 0, -13],
  [BONE.rightArm, -76, -8, -51],
  [BONE.rightForeArm, 0, 0, -60],
  [BONE.rightHand, 15, -10, 52],
  ...fingerCurlEntries(1),
]);

// This diagonal snap drives the negative-X cutting edge through the space in
// front of the character. The hand remains closed around the wooden handle.
const IMPACT_POSE = createPose("axe-attack-impact", [
  [BONE.spine, 10, -22, 9],
  [BONE.spine1, 14, -30, 14],
  [BONE.spine2, 9, -20, 10],
  [BONE.leftShoulder, 0, 0, -5],
  [BONE.leftArm, -4, -18, -13],
  [BONE.leftForeArm, 0, 0, 10],
  [BONE.leftHand, 3, 0, 8],
  [BONE.rightShoulder, 0, 0, 8],
  [BONE.rightArm, -34, 28, 30],
  [BONE.rightForeArm, 0, 0, -17],
  [BONE.rightHand, 7, -20, 24],
  ...fingerCurlEntries(1),
]);

const FOLLOW_THROUGH_POSE = createPose("axe-attack-follow-through", [
  [BONE.spine, 13, -28, 11],
  [BONE.spine1, 17, -36, 17],
  [BONE.spine2, 11, -24, 12],
  [BONE.leftShoulder, 0, 0, -7],
  [BONE.leftArm, -2, -22, -16],
  [BONE.leftForeArm, 0, 0, 8],
  [BONE.rightShoulder, 0, 0, 11],
  [BONE.rightArm, -24, 35, 38],
  [BONE.rightForeArm, 0, 0, -10],
  [BONE.rightHand, 4, -24, 18],
  ...fingerCurlEntries(1),
]);

export const HERMANO_MAYOR_AXE_ATTACK_ANIMATION: ProceduralAnimationDefinition = {
  id: "hermano-mayor-axe-attack",
  poses: {
    [READY_POSE.id]: READY_POSE,
    [WINDUP_POSE.id]: WINDUP_POSE,
    [COMMIT_POSE.id]: COMMIT_POSE,
    [IMPACT_POSE.id]: IMPACT_POSE,
    [FOLLOW_THROUGH_POSE.id]: FOLLOW_THROUGH_POSE,
  },
  timeline: [
    { time: 0, poseId: READY_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_ATTACK_TIMING.windupEnd, poseId: WINDUP_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_ATTACK_TIMING.commitAt, poseId: COMMIT_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_ATTACK_TIMING.impactAt, poseId: IMPACT_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_ATTACK_TIMING.followThroughEnd, poseId: FOLLOW_THROUGH_POSE.id, easing: "smooth" },
    { time: HERMANO_MAYOR_AXE_ATTACK_TIMING.recoveryEnd, poseId: READY_POSE.id, easing: "smooth" },
  ],
};

export class HermanoMayorAxeAttackAction
  implements HermanoMayorProceduralAction
{
  private readonly rig: MixamoProceduralRig;
  private readonly axeTrail: HermanoMayorAxeTrail;
  private readonly posePlayer = new ProceduralPosePlayer();
  private readonly animationPlayer = new ProceduralAnimationPlayer(this.posePlayer);
  private readonly bladeLower = Vector3.Zero();
  private readonly bladeUpper = Vector3.Zero();
  private beforeAnimationsObserver: Observer<Scene> | null = null;
  private afterAnimationsObserver: Observer<Scene> | null = null;
  private axe: HermanoMayorAxeHandle | null = null;
  private currentState: HermanoMayorAxeAttackActionState = "ready";
  private requestedEnabled = false;
  private poseApplied = false;

  public constructor(
    private readonly scene: Scene,
    meshes: readonly AbstractMesh[],
    animationGroups: readonly AnimationGroup[],
    private readonly hooks: HermanoMayorAxeAttackActionHooks = {}
  ) {
    this.rig = new MixamoProceduralRig(meshes, animationGroups, REQUIRED_JOINTS);
    this.axeTrail = new HermanoMayorAxeTrail(scene);
    if (!this.rig.available) {
      console.warn(
        `[HermanoMayor] Ataque procedural de hacha deshabilitado; faltan huesos: ${
          this.rig.getMissingRequiredBones().join(", ") || "skeleton"
        }.`
      );
      return;
    }

    this.beforeAnimationsObserver = scene.onBeforeAnimationsObservable.add(() => {
      this.restoreBasePose();
    });
    this.afterAnimationsObserver = scene.onAfterAnimationsObservable.add(() => {
      this.update(
        Math.max(0, Math.min(scene.getEngine().getDeltaTime() * 0.001, 0.05))
      );
    });
  }

  public get enabled() {
    return this.requestedEnabled;
  }

  public get state() {
    return this.currentState;
  }

  public setAxe(axe: HermanoMayorAxeHandle | null) {
    this.axe = axe;
    if (!axe) this.axeTrail.end();
  }

  public setEnabled(enabled: boolean) {
    if (enabled) this.start();
    else this.cancel();
  }

  public canStart() {
    return (
      this.rig.available &&
      this.currentState === "ready" &&
      this.axe?.attached === true
    );
  }

  public start() {
    if (!this.canStart()) return false;
    this.currentState = "attacking";
    this.requestedEnabled = true;
    this.animationPlayer.setLoop(false);
    this.animationPlayer.play(HERMANO_MAYOR_AXE_ATTACK_ANIMATION);
    if (this.getBladeEdgeWorldSegmentToRef(this.bladeLower, this.bladeUpper)) {
      this.axeTrail.begin(this.bladeLower, this.bladeUpper);
    }
    this.hooks.onStarted?.();
    return true;
  }

  public cancel() {
    if (this.currentState !== "attacking") return false;
    this.currentState = "ready";
    this.requestedEnabled = false;
    this.animationPlayer.stop();
    this.axeTrail.end();
    this.restoreBasePose();
    this.hooks.onCancelled?.();
    return true;
  }

  public getBladeEdgeWorldSegmentToRef(lower: Vector3, upper: Vector3) {
    return this.axe?.getBladeEdgeWorldSegmentToRef(lower, upper) ?? false;
  }

  public getDebugSnapshot() {
    const playback = this.animationPlayer.getState();
    const hasBlade = this.getBladeEdgeWorldSegmentToRef(
      this.bladeLower,
      this.bladeUpper
    );
    return {
      available: this.rig.available && this.axe?.attached === true,
      state: this.currentState,
      phase: phaseFor(playback.time, this.currentState),
      time: playback.time,
      duration: playback.duration,
      progress: playback.duration > 0 ? playback.time / playback.duration : 0,
      damageWindowActive:
        this.currentState === "attacking" &&
        playback.time >= HERMANO_MAYOR_AXE_ATTACK_TIMING.damageStart &&
        playback.time <= HERMANO_MAYOR_AXE_ATTACK_TIMING.damageEnd,
      bladeEdge: hasBlade
        ? {
            lower: vectorSnapshot(this.bladeLower),
            upper: vectorSnapshot(this.bladeUpper),
          }
        : null,
      trail: this.axeTrail.getDebugSnapshot(),
      resolvedBones: this.rig.getResolvedBones(),
    };
  }

  public dispose() {
    if (this.currentState === "attacking") this.cancel();
    this.axeTrail.dispose();
    this.restoreBasePose();
    if (this.beforeAnimationsObserver) {
      this.scene.onBeforeAnimationsObservable.remove(this.beforeAnimationsObserver);
      this.beforeAnimationsObserver = null;
    }
    if (this.afterAnimationsObserver) {
      this.scene.onAfterAnimationsObservable.remove(this.afterAnimationsObserver);
      this.afterAnimationsObserver = null;
    }
  }

  private update(dt: number) {
    if (!this.rig.available || this.currentState !== "attacking" || dt <= 0) {
      return;
    }

    this.animationPlayer.update(dt);
    this.rig.captureBasePose();
    for (const [name, offset] of this.posePlayer.getOffsets()) {
      this.rig.applyLocalQuaternionOffset(name, offset);
    }
    this.rig.prepare();
    this.poseApplied = true;

    const playback = this.animationPlayer.getState();
    if (this.getBladeEdgeWorldSegmentToRef(this.bladeLower, this.bladeUpper)) {
      this.axeTrail.sample(
        this.bladeLower,
        this.bladeUpper,
        getHermanoMayorAxeTrailIntensity(playback.time)
      );
    }

    if (
      playback.time >= HERMANO_MAYOR_AXE_ATTACK_TIMING.recoveryEnd
    ) {
      this.currentState = "ready";
      this.requestedEnabled = false;
      this.animationPlayer.stop();
      this.axeTrail.end();
      this.hooks.onFinished?.();
    }
  }

  private restoreBasePose() {
    if (!this.poseApplied) return;
    this.rig.restoreBasePose();
    this.poseApplied = false;
  }
}

export function getHermanoMayorAxeTrailIntensity(time: number) {
  if (!Number.isFinite(time)) return 0;
  const start = HERMANO_MAYOR_AXE_ATTACK_TIMING.commitAt - 0.08;
  const peak = HERMANO_MAYOR_AXE_ATTACK_TIMING.impactAt;
  const end = HERMANO_MAYOR_AXE_ATTACK_TIMING.followThroughEnd;
  if (time <= start || time >= end) return 0;
  if (time < peak) return smoothStep((time - start) / (peak - start));
  return 1 - smoothStep((time - peak) / (end - peak));
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

function phaseFor(time: number, state: HermanoMayorAxeAttackActionState) {
  if (state === "ready") return "ready" as const;
  if (time < HERMANO_MAYOR_AXE_ATTACK_TIMING.windupEnd) return "windup" as const;
  if (time < HERMANO_MAYOR_AXE_ATTACK_TIMING.damageStart) return "commit" as const;
  if (time <= HERMANO_MAYOR_AXE_ATTACK_TIMING.damageEnd) return "strike" as const;
  if (time < HERMANO_MAYOR_AXE_ATTACK_TIMING.followThroughEnd) {
    return "follow-through" as const;
  }
  return "recovery" as const;
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function smoothStep(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function vectorSnapshot(value: Vector3) {
  return { x: value.x, y: value.y, z: value.z };
}
