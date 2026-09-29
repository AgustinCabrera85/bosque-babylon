import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import {
  MixamoProceduralRig,
  type MixamoJointName,
} from "../../animation/MixamoProceduralRig";
import type { HermanoMayorProceduralAction } from "./HermanoMayorAnimations";

export const HERMANO_MAYOR_NECK_GRAB_ACTION = "agarrar del cuello";

export type HermanoMayorNeckGrabPoseState = {
  reach: number;
  lift: number;
  victimStruggle: number;
  shake: number;
  targetPosition: Vector3;
};

export type HermanoMayorNeckTargetProvider = (result: Vector3) => Vector3;

const GRIP_FINGER_JOINTS = [
  "leftHandThumb1",
  "leftHandThumb2",
  "leftHandThumb3",
  "leftHandIndex1",
  "leftHandIndex2",
  "leftHandIndex3",
  "leftHandMiddle1",
  "leftHandMiddle2",
  "leftHandMiddle3",
  "leftHandRing1",
  "leftHandRing2",
  "leftHandRing3",
  "leftHandPinky1",
  "leftHandPinky2",
  "leftHandPinky3",
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
  "hips",
  "spine",
  "spine1",
  "spine2",
  "leftShoulder",
  "rightShoulder",
  "leftArm",
  "rightArm",
  "leftForeArm",
  "rightForeArm",
  "leftHand",
  "rightHand",
  ...GRIP_FINGER_JOINTS,
] as const;

type GripJointAxisProfile = {
  joint: MixamoJointName;
  axis: Vector3;
  axisName: "localX" | "localY";
  sign: -1 | 1;
};

// The GLB's forearm-to-hand and hand-to-finger translations run along local
// +Y on both sides. Local X spans the palm, so it is the wrist-flexion axis.
const GRIP_AXIS_PROFILE = {
  leftHandFlex: {
    joint: "leftHand",
    axis: Axis.X,
    axisName: "localX",
    sign: -1,
  },
  rightHandFlex: {
    joint: "rightHand",
    axis: Axis.X,
    axisName: "localX",
    sign: 1,
  },
} as const satisfies Record<string, GripJointAxisProfile>;

const HAND_FLEX_DEGREES = 5;
const MAX_FOREARM_PRONATION_DEGREES = 80;
const MAX_HAND_ROLL_DEGREES = 45;
const FOREARM_TWIST_SHARE = 0.8;
const GRIP_WRIST_BACK_METERS = 0.025;
const GRIP_HALF_WIDTH_METERS = 0.105;
const LEFT_GRIP_WRIST_VERTICAL_METERS = 0.035;
const RIGHT_GRIP_WRIST_VERTICAL_METERS = 0.055;

const GRIP_FINGER_CHAINS = [
  ["leftHandIndex1", "leftHandIndex2", "leftHandIndex3"],
  ["leftHandMiddle1", "leftHandMiddle2", "leftHandMiddle3"],
  ["leftHandRing1", "leftHandRing2", "leftHandRing3"],
  ["leftHandPinky1", "leftHandPinky2", "leftHandPinky3"],
  ["rightHandIndex1", "rightHandIndex2", "rightHandIndex3"],
  ["rightHandMiddle1", "rightHandMiddle2", "rightHandMiddle3"],
  ["rightHandRing1", "rightHandRing2", "rightHandRing3"],
  ["rightHandPinky1", "rightHandPinky2", "rightHandPinky3"],
] as const satisfies readonly (readonly [
  MixamoJointName,
  MixamoJointName,
  MixamoJointName,
])[];

const FINGER_CURL_DEGREES = [24, 38, 26] as const;
// This asset mirrors the finger placement, but both phalanx chains retain the
// same local-X flexion sign. Negating the right side hyperextends it across the
// victim's neck instead of wrapping the fingers back toward the palm.
const FINGER_CURL_SIGN = {
  left: 1,
  right: 1,
} as const;

/** Procedural Mixamo overlay for reaching, closing the grip and lifting. */
export class HermanoMayorNeckGrabAction implements HermanoMayorProceduralAction {
  private readonly rig: MixamoProceduralRig;
  private readonly rightAxis = Vector3.Right();
  private readonly forwardAxis = Vector3.Forward();
  private readonly requestedTarget = Vector3.Zero();
  private readonly target = Vector3.Zero();
  private readonly leftHandTarget = Vector3.Zero();
  private readonly rightHandTarget = Vector3.Zero();
  private readonly leftHandPosition = Vector3.Zero();
  private readonly rightHandPosition = Vector3.Zero();
  private readonly leftElbowPosition = Vector3.Zero();
  private readonly rightElbowPosition = Vector3.Zero();
  private readonly leftPalmDirection = Vector3.Zero();
  private readonly rightPalmDirection = Vector3.Zero();
  private readonly leftGripDirection = Vector3.Zero();
  private readonly rightGripDirection = Vector3.Zero();
  private readonly rightPalmLocalDirection = new Vector3(0, 0, 1);
  private readonly twistAxis = Vector3.Zero();
  private readonly projectedPalmDirection = Vector3.Zero();
  private readonly projectedGripDirection = Vector3.Zero();
  private readonly twistCross = Vector3.Zero();
  private readonly jointPosition = Vector3.Zero();
  private readonly currentDirection = Vector3.Zero();
  private readonly targetDirection = Vector3.Zero();
  private readonly rotationAxis = Vector3.Zero();
  private beforeAnimationsObserver: Observer<Scene> | null = null;
  private afterAnimationsObserver: Observer<Scene> | null = null;
  private requestedEnabled = false;
  private blend = 0;
  private requestedReach = 0;
  private requestedLift = 0;
  private requestedVictimStruggle = 0;
  private requestedShake = 0;
  private reach = 0;
  private lift = 0;
  private victimStruggle = 0;
  private shake = 0;
  private elapsed = 0;
  private poseApplied = false;
  private targetProvider: HermanoMayorNeckTargetProvider | null = null;
  private leftForeArmPronationDegrees = 0;
  private rightForeArmPronationDegrees = 0;
  private leftHandRollDegrees = 0;
  private rightHandRollDegrees = 0;
  private leftPalmProjectedFacingScore = 0;
  private rightPalmProjectedFacingScore = 0;

  public constructor(
    private readonly scene: Scene,
    private readonly root: TransformNode,
    meshes: readonly AbstractMesh[],
    animationGroups: readonly AnimationGroup[]
  ) {
    this.rig = new MixamoProceduralRig(meshes, animationGroups, REQUIRED_JOINTS);
    if (!this.rig.available) {
      console.warn(
        `[HermanoMayor] Agarre procedural deshabilitado; faltan huesos Mixamo: ${
          this.rig.getMissingRequiredBones().join(", ") || "skeleton"
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

  public setEnabled(enabled: boolean) {
    if (enabled && !this.requestedEnabled) {
      this.elapsed = 0;
      this.target.copyFrom(this.requestedTarget);
    }
    this.requestedEnabled = enabled;
    if (!enabled) {
      this.requestedReach = 0;
      this.requestedLift = 0;
      this.requestedVictimStruggle = 0;
      this.requestedShake = 0;
    }
  }

  public setPoseState(state: HermanoMayorNeckGrabPoseState) {
    this.requestedReach = clamp01(state.reach);
    this.requestedLift = clamp01(state.lift);
    this.requestedVictimStruggle = clamp01(state.victimStruggle);
    this.requestedShake = clamp01(state.shake);
    this.requestedTarget.copyFrom(state.targetPosition);
  }

  public getDebugSnapshot() {
    return {
      available: this.rig.available,
      enabled: this.requestedEnabled,
      liveTargetTracking: this.targetProvider !== null,
      blend: this.blend,
      reach: this.reach,
      lift: this.lift,
      victimStruggle: this.victimStruggle,
      shake: this.shake,
      targetPosition: vectorSnapshot(this.target),
      leftHandTarget: vectorSnapshot(this.leftHandTarget),
      rightHandTarget: vectorSnapshot(this.rightHandTarget),
      leftHandPosition: vectorSnapshot(this.leftHandPosition),
      rightHandPosition: vectorSnapshot(this.rightHandPosition),
      leftElbowPosition: vectorSnapshot(this.leftElbowPosition),
      rightElbowPosition: vectorSnapshot(this.rightElbowPosition),
      leftPalmDirection: vectorSnapshot(this.leftPalmDirection),
      rightPalmDirection: vectorSnapshot(this.rightPalmDirection),
      leftPalmFacingScore: Vector3.Dot(
        this.leftPalmDirection,
        this.leftGripDirection
      ),
      rightPalmFacingScore: Vector3.Dot(
        this.rightPalmDirection,
        this.rightGripDirection
      ),
      leftPalmProjectedFacingScore: this.leftPalmProjectedFacingScore,
      rightPalmProjectedFacingScore: this.rightPalmProjectedFacingScore,
      gripLandmarks: {
        leftThumbTip: this.getJointPositionSnapshot("leftHandThumb3"),
        leftIndexTip: this.getJointPositionSnapshot("leftHandIndex3"),
        leftMiddleKnuckle: this.getJointPositionSnapshot("leftHandMiddle1"),
        leftMiddleTip: this.getJointPositionSnapshot("leftHandMiddle3"),
        leftPinkyKnuckle: this.getJointPositionSnapshot("leftHandPinky1"),
        rightThumbTip: this.getJointPositionSnapshot("rightHandThumb3"),
        rightIndexTip: this.getJointPositionSnapshot("rightHandIndex3"),
        rightMiddleKnuckle: this.getJointPositionSnapshot("rightHandMiddle1"),
        rightMiddleTip: this.getJointPositionSnapshot("rightHandMiddle3"),
        rightPinkyKnuckle: this.getJointPositionSnapshot("rightHandPinky1"),
      },
      gripOrientation: {
        leftForeArmPronationDegrees: this.leftForeArmPronationDegrees,
        rightForeArmPronationDegrees: this.rightForeArmPronationDegrees,
        leftHandRollDegrees: this.leftHandRollDegrees,
        rightHandRollDegrees: this.rightHandRollDegrees,
        leftHandFlexDegrees:
          HAND_FLEX_DEGREES * this.reach * GRIP_AXIS_PROFILE.leftHandFlex.sign,
        rightHandFlexDegrees:
          HAND_FLEX_DEGREES * this.reach * GRIP_AXIS_PROFILE.rightHandFlex.sign,
        fingerCurlDegrees: {
          left: FINGER_CURL_DEGREES.map(
            (degrees) => degrees * this.reach * FINGER_CURL_SIGN.left
          ),
          right: FINGER_CURL_DEGREES.map(
            (degrees) => degrees * this.reach * FINGER_CURL_SIGN.right
          ),
        },
        gripHalfWidthMeters: GRIP_HALF_WIDTH_METERS,
        wristBackMeters: GRIP_WRIST_BACK_METERS,
        localAxisMapping: {
          leftForeArmPronation: { axis: "localY", dynamicPalmAlignment: true },
          rightForeArmPronation: { axis: "localY", dynamicPalmAlignment: true },
          leftHandRoll: { axis: "localY", dynamicPalmAlignment: true },
          rightHandRoll: { axis: "localY", dynamicPalmAlignment: true },
          leftHandFlex: profileSnapshot(GRIP_AXIS_PROFILE.leftHandFlex),
          rightHandFlex: profileSnapshot(GRIP_AXIS_PROFILE.rightHandFlex),
        },
      },
      resolvedBones: this.rig.getResolvedBones(),
    };
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
  }

  public setTargetProvider(provider: HermanoMayorNeckTargetProvider | null) {
    this.targetProvider = provider;
  }

  private getJointPositionSnapshot(name: MixamoJointName) {
    return this.rig.getJointWorldPositionToRef(name, this.jointPosition)
      ? vectorSnapshot(this.jointPosition)
      : null;
  }

  private update(dt: number) {
    if (!this.rig.available || dt <= 0) return;
    this.elapsed += dt;
    this.blend = damp(this.blend, this.requestedEnabled ? 1 : 0, 10, dt);
    this.reach = damp(this.reach, this.requestedReach, 12, dt);
    this.lift = damp(this.lift, this.requestedLift, 8.5, dt);
    this.victimStruggle = damp(
      this.victimStruggle,
      this.requestedVictimStruggle,
      9,
      dt
    );
    this.shake = damp(this.shake, this.requestedShake, 13, dt);
    if (this.requestedEnabled && this.targetProvider) {
      const providedTarget = this.targetProvider(this.requestedTarget);
      if (providedTarget !== this.requestedTarget) {
        this.requestedTarget.copyFrom(providedTarget);
      }
      // The player procedural pose has already run in this after-animation
      // phase. An additional damp here makes the wrists trail the neck.
      this.target.copyFrom(this.requestedTarget);
    } else {
      dampVectorToRef(this.target, this.requestedTarget, 14, dt, this.target);
    }
    if (this.blend <= 0.0001) return;

    this.rig.captureBasePose();
    this.applyPose(smoothStep(this.blend));
    this.rig.prepare();
    this.poseApplied = true;
  }

  private restoreBasePose() {
    if (!this.poseApplied) return;
    this.rig.restoreBasePose();
    this.poseApplied = false;
  }

  private applyPose(weight: number) {
    const reach = this.reach * weight;
    const lift = this.lift * weight;
    const struggle = this.victimStruggle * weight;
    const shake = this.shake * weight;
    const effortWave = Math.sin(this.elapsed * Math.PI * 2 * 1.7) * struggle;
    const counterWave =
      Math.sin(this.elapsed * Math.PI * 2 * 1.13 + 1.4) * struggle;
    const shakeWave =
      (Math.tanh(
        Math.sin(this.elapsed * Math.PI * 2 * 2.45) * 2.2
      ) * 0.78 +
        Math.sin(this.elapsed * Math.PI * 2 * 4.9 + 0.8) * 0.22) *
      shake;
    const yaw = this.root.rotation.y;
    this.rightAxis.set(Math.cos(yaw), 0, -Math.sin(yaw));

    const forwardLean = radians(9) * reach - radians(3) * lift;
    this.rig.rotateWorld("hips", this.rightAxis, forwardLean * 0.14);
    this.rig.rotateWorld("spine", this.rightAxis, forwardLean * 0.22);
    this.rig.rotateWorld("spine1", this.rightAxis, forwardLean * 0.31);
    this.rig.rotateWorld("spine2", this.rightAxis, forwardLean * 0.47);
    this.rig.rotateWorld(
      "spine1",
      Axis.Y,
      radians(2.4) * effortWave + radians(4.8) * shakeWave
    );
    this.rig.rotateWorld(
      "spine2",
      Axis.Y,
      radians(3.2) * effortWave + radians(7.5) * shakeWave
    );

    const shoulderForward = radians(4.5 + shakeWave * 2.6) * reach;
    this.rig.applyLocalOffset("leftShoulder", Axis.Z, shoulderForward);
    this.rig.applyLocalOffset("rightShoulder", Axis.Z, -shoulderForward);

    // Start from a broad, low-elbow choke silhouette. The short CCD pass below
    // then corrects the wrists against the victim's *animated* neck without the
    // coordinate-space assumptions made by Babylon's BoneIKController.
    const armLift = -radians(50 + lift * 4) * reach;
    const armSweep = radians(24 + shakeWave * 7) * reach;
    const elbowFlex = radians(43 + lift * 4 - shakeWave * 10) * reach;
    this.rig.applyLocalOffset("leftArm", Axis.X, armLift, Axis.Z, armSweep);
    this.rig.applyLocalOffset("rightArm", Axis.X, armLift, Axis.Z, -armSweep);
    this.rig.applyLocalOffset("leftForeArm", Axis.Z, elbowFlex);
    this.rig.applyLocalOffset("rightForeArm", Axis.Z, -elbowFlex);
    this.rig.prepare();
    this.applyArmIk(reach, effortWave, counterWave);
  }

  private applyArmIk(
    reach: number,
    effortWave: number,
    counterWave: number
  ) {
    if (reach <= 0.0001) return;

    const forwardX = this.target.x - this.root.position.x;
    const forwardZ = this.target.z - this.root.position.z;
    const forwardLength = Math.hypot(forwardX, forwardZ);
    if (forwardLength > 0.001) {
      this.forwardAxis.set(
        forwardX / forwardLength,
        0,
        forwardZ / forwardLength
      );
    } else {
      this.forwardAxis.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    }

    this.leftHandTarget.copyFrom(this.target);
    this.leftHandTarget.x -= this.forwardAxis.x * GRIP_WRIST_BACK_METERS;
    this.leftHandTarget.z -= this.forwardAxis.z * GRIP_WRIST_BACK_METERS;
    this.leftHandTarget.x -= this.rightAxis.x * GRIP_HALF_WIDTH_METERS;
    this.leftHandTarget.z -= this.rightAxis.z * GRIP_HALF_WIDTH_METERS;
    this.leftHandTarget.y +=
      LEFT_GRIP_WRIST_VERTICAL_METERS + effortWave * 0.008;

    this.rightHandTarget.copyFrom(this.target);
    this.rightHandTarget.x -= this.forwardAxis.x * GRIP_WRIST_BACK_METERS;
    this.rightHandTarget.z -= this.forwardAxis.z * GRIP_WRIST_BACK_METERS;
    this.rightHandTarget.x += this.rightAxis.x * GRIP_HALF_WIDTH_METERS;
    this.rightHandTarget.z += this.rightAxis.z * GRIP_HALF_WIDTH_METERS;
    this.rightHandTarget.y +=
      RIGHT_GRIP_WRIST_VERTICAL_METERS - counterWave * 0.008;

    this.rig.getJointWorldPositionToRef("leftHand", this.leftHandPosition);
    this.rig.getJointWorldPositionToRef("rightHand", this.rightHandPosition);
    const ikWeight = smoothStep(reach);
    Vector3.LerpToRef(
      this.leftHandPosition,
      this.leftHandTarget,
      ikWeight,
      this.leftHandTarget
    );
    Vector3.LerpToRef(
      this.rightHandPosition,
      this.rightHandTarget,
      ikWeight,
      this.rightHandTarget
    );

    this.solveArmToTarget(
      "leftArm",
      "leftForeArm",
      "leftHand",
      this.leftHandTarget
    );
    this.solveArmToTarget(
      "rightArm",
      "rightForeArm",
      "rightHand",
      this.rightHandTarget
    );

    this.applyGripOrientation(reach);
    this.rig.getJointWorldPositionToRef("leftHand", this.leftHandPosition);
    this.rig.getJointWorldPositionToRef("rightHand", this.rightHandPosition);
    this.rig.getJointWorldPositionToRef("leftForeArm", this.leftElbowPosition);
    this.rig.getJointWorldPositionToRef("rightForeArm", this.rightElbowPosition);
    this.updateGripOrientationDebug();
  }

  private updateGripOrientationDebug() {
    this.rig.getJointWorldDirectionToRef(
      "leftHand",
      Axis.Z,
      this.leftPalmDirection
    );
    this.rig.getJointWorldDirectionToRef(
      "rightHand",
      Axis.Z,
      this.rightPalmDirection
    );
    this.target.subtractToRef(this.leftHandPosition, this.leftGripDirection);
    this.target.subtractToRef(this.rightHandPosition, this.rightGripDirection);
    if (this.leftGripDirection.lengthSquared() > 0.000001) {
      this.leftGripDirection.normalize();
    }
    if (this.rightGripDirection.lengthSquared() > 0.000001) {
      this.rightGripDirection.normalize();
    }
    this.leftPalmProjectedFacingScore = Math.cos(
      this.measurePalmTwist("leftHand", "leftHand", Axis.Z, this.target)
    );
    this.rightPalmProjectedFacingScore = Math.cos(
      this.measurePalmTwist(
        "rightHand",
        "rightHand",
        this.rightPalmLocalDirection,
        this.target
      )
    );
  }

  private applyGripOrientation(reach: number) {
    const handFlex = radians(HAND_FLEX_DEGREES) * reach;
    this.alignPalmToGrip(
      "left",
      "leftForeArm",
      "leftHand",
      Axis.Z,
      this.target,
      reach
    );
    this.alignPalmToGrip(
      "right",
      "rightForeArm",
      "rightHand",
      this.rightPalmLocalDirection,
      this.target,
      reach
    );
    this.appendProfileOffset(GRIP_AXIS_PROFILE.leftHandFlex, handFlex);
    this.appendProfileOffset(GRIP_AXIS_PROFILE.rightHandFlex, handFlex);
    this.applyFingerCurl(reach);
    this.rig.prepare();
  }

  private alignPalmToGrip(
    side: "left" | "right",
    foreArm: MixamoJointName,
    hand: MixamoJointName,
    palmLocalDirection: Vector3,
    target: Vector3,
    reach: number
  ) {
    const blend = smoothStep(reach);
    const fullCorrection = this.measurePalmTwist(
      foreArm,
      hand,
      palmLocalDirection,
      target
    );
    const foreArmCorrection = clamp(
      -fullCorrection * FOREARM_TWIST_SHARE,
      -radians(MAX_FOREARM_PRONATION_DEGREES),
      radians(MAX_FOREARM_PRONATION_DEGREES)
    ) * blend;
    this.rig.appendLocalOffset(foreArm, Axis.Y, foreArmCorrection);
    this.rig.prepare();

    const remainingCorrection = this.measurePalmTwist(
      hand,
      hand,
      palmLocalDirection,
      target
    );
    const handCorrection = clamp(
      -remainingCorrection,
      -radians(MAX_HAND_ROLL_DEGREES),
      radians(MAX_HAND_ROLL_DEGREES)
    ) * blend;
    this.rig.appendLocalOffset(hand, Axis.Y, handCorrection);
    this.rig.prepare();

    if (side === "left") {
      this.leftForeArmPronationDegrees = degrees(foreArmCorrection);
      this.leftHandRollDegrees = degrees(handCorrection);
    } else {
      this.rightForeArmPronationDegrees = degrees(foreArmCorrection);
      this.rightHandRollDegrees = degrees(handCorrection);
    }
  }

  private measurePalmTwist(
    twistJoint: MixamoJointName,
    hand: MixamoJointName,
    palmLocalDirection: Vector3,
    target: Vector3
  ) {
    if (
      !this.rig.getJointWorldDirectionToRef(
        twistJoint,
        Axis.Y,
        this.twistAxis
      ) ||
      !this.rig.getJointWorldDirectionToRef(
        hand,
        palmLocalDirection,
        this.projectedPalmDirection
      ) ||
      !this.rig.getJointWorldPositionToRef(hand, this.jointPosition)
    ) {
      return 0;
    }

    target.subtractToRef(this.jointPosition, this.projectedGripDirection);
    const palmAlongAxis = Vector3.Dot(
      this.projectedPalmDirection,
      this.twistAxis
    );
    const gripAlongAxis = Vector3.Dot(
      this.projectedGripDirection,
      this.twistAxis
    );
    this.projectedPalmDirection.set(
      this.projectedPalmDirection.x - this.twistAxis.x * palmAlongAxis,
      this.projectedPalmDirection.y - this.twistAxis.y * palmAlongAxis,
      this.projectedPalmDirection.z - this.twistAxis.z * palmAlongAxis
    );
    this.projectedGripDirection.set(
      this.projectedGripDirection.x - this.twistAxis.x * gripAlongAxis,
      this.projectedGripDirection.y - this.twistAxis.y * gripAlongAxis,
      this.projectedGripDirection.z - this.twistAxis.z * gripAlongAxis
    );
    const palmLength = this.projectedPalmDirection.length();
    const gripLength = this.projectedGripDirection.length();
    if (palmLength <= 0.0001 || gripLength <= 0.0001) return 0;
    this.projectedPalmDirection.scaleInPlace(1 / palmLength);
    this.projectedGripDirection.scaleInPlace(1 / gripLength);
    Vector3.CrossToRef(
      this.projectedPalmDirection,
      this.projectedGripDirection,
      this.twistCross
    );
    return Math.atan2(
      Vector3.Dot(this.twistAxis, this.twistCross),
      Vector3.Dot(this.projectedPalmDirection, this.projectedGripDirection)
    );
  }

  private applyFingerCurl(reach: number) {
    for (const chain of GRIP_FINGER_CHAINS) {
      const curlSign = chain[0].startsWith("right")
        ? FINGER_CURL_SIGN.right
        : FINGER_CURL_SIGN.left;
      for (let index = 0; index < chain.length; index += 1) {
        this.rig.appendLocalOffset(
          chain[index],
          Axis.X,
          radians(FINGER_CURL_DEGREES[index]) * reach * curlSign
        );
      }
    }

    const thumbBase = radians(18) * reach;
    const thumbMiddle = radians(22) * reach;
    const thumbTip = radians(14) * reach;
    this.rig.appendLocalOffset("leftHandThumb1", Axis.Z, thumbBase);
    this.rig.appendLocalOffset("rightHandThumb1", Axis.Z, -thumbBase);
    this.rig.appendLocalOffset("leftHandThumb2", Axis.Z, -thumbMiddle);
    this.rig.appendLocalOffset("rightHandThumb2", Axis.Z, thumbMiddle);
    this.rig.appendLocalOffset("leftHandThumb3", Axis.X, thumbTip);
    this.rig.appendLocalOffset("rightHandThumb3", Axis.X, thumbTip);
  }

  private appendProfileOffset(
    profile: GripJointAxisProfile,
    amount: number
  ) {
    this.rig.appendLocalOffset(
      profile.joint,
      profile.axis,
      amount * profile.sign
    );
  }

  private solveArmToTarget(
    upperArm: MixamoJointName,
    foreArm: MixamoJointName,
    hand: MixamoJointName,
    target: Vector3
  ) {
    // Distal-to-proximal CCD is independent of Mixamo bone pre-rotations and
    // imported root scaling. Small bounded steps preserve the low-elbow seed.
    for (let iteration = 0; iteration < 14; iteration += 1) {
      this.rotateJointTowardTarget(foreArm, hand, target, radians(18));
      this.rotateJointTowardTarget(upperArm, hand, target, radians(16));
    }
  }

  private rotateJointTowardTarget(
    joint: MixamoJointName,
    hand: MixamoJointName,
    target: Vector3,
    maxAngle: number
  ) {
    if (
      !this.rig.getJointWorldPositionToRef(joint, this.jointPosition) ||
      !this.rig.getJointWorldPositionToRef(hand, this.leftHandPosition)
    ) {
      return;
    }

    this.leftHandPosition.subtractToRef(
      this.jointPosition,
      this.currentDirection
    );
    target.subtractToRef(this.jointPosition, this.targetDirection);
    const currentLength = this.currentDirection.length();
    const targetLength = this.targetDirection.length();
    if (currentLength <= 0.0001 || targetLength <= 0.0001) return;
    this.currentDirection.scaleInPlace(1 / currentLength);
    this.targetDirection.scaleInPlace(1 / targetLength);
    Vector3.CrossToRef(
      this.currentDirection,
      this.targetDirection,
      this.rotationAxis
    );
    const axisLength = this.rotationAxis.length();
    if (axisLength <= 0.00001) return;
    this.rotationAxis.scaleInPlace(1 / axisLength);
    const dot = Vector3.Dot(this.currentDirection, this.targetDirection);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    this.rig.rotateWorld(joint, this.rotationAxis, Math.min(angle, maxAngle));
    this.rig.prepare();
  }
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function degrees(radiansValue: number) {
  return (radiansValue * 180) / Math.PI;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function damp(current: number, target: number, response: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-response * dt));
}

function dampVectorToRef(
  current: Vector3,
  target: Vector3,
  response: number,
  dt: number,
  result: Vector3
) {
  const amount = 1 - Math.exp(-response * dt);
  result.set(
    current.x + (target.x - current.x) * amount,
    current.y + (target.y - current.y) * amount,
    current.z + (target.z - current.z) * amount
  );
}

function smoothStep(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function vectorSnapshot(vector: Vector3) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function profileSnapshot(profile: GripJointAxisProfile) {
  return { axis: profile.axisName, sign: profile.sign };
}
