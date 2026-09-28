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
  targetPosition: Vector3;
};

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
] as const;

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
  private reach = 0;
  private lift = 0;
  private victimStruggle = 0;
  private elapsed = 0;
  private poseApplied = false;

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
    }
  }

  public setPoseState(state: HermanoMayorNeckGrabPoseState) {
    this.requestedReach = clamp01(state.reach);
    this.requestedLift = clamp01(state.lift);
    this.requestedVictimStruggle = clamp01(state.victimStruggle);
    this.requestedTarget.copyFrom(state.targetPosition);
  }

  public getDebugSnapshot() {
    return {
      available: this.rig.available,
      enabled: this.requestedEnabled,
      blend: this.blend,
      reach: this.reach,
      lift: this.lift,
      victimStruggle: this.victimStruggle,
      targetPosition: vectorSnapshot(this.target),
      leftHandPosition: vectorSnapshot(this.leftHandPosition),
      rightHandPosition: vectorSnapshot(this.rightHandPosition),
      leftElbowPosition: vectorSnapshot(this.leftElbowPosition),
      rightElbowPosition: vectorSnapshot(this.rightElbowPosition),
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
    dampVectorToRef(this.target, this.requestedTarget, 14, dt, this.target);
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
    const effortWave = Math.sin(this.elapsed * Math.PI * 2 * 1.7) * struggle;
    const counterWave =
      Math.sin(this.elapsed * Math.PI * 2 * 1.13 + 1.4) * struggle;
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
      radians(2.4) * effortWave
    );
    this.rig.rotateWorld(
      "spine2",
      Axis.Y,
      radians(3.2) * effortWave
    );

    const shoulderForward = radians(2.5) * reach;
    this.rig.applyLocalOffset("leftShoulder", Axis.Z, shoulderForward);
    this.rig.applyLocalOffset("rightShoulder", Axis.Z, -shoulderForward);

    // Start from a broad, low-elbow choke silhouette. The short CCD pass below
    // then corrects the wrists against the victim's *animated* neck without the
    // coordinate-space assumptions made by Babylon's BoneIKController.
    const armLift = -radians(48 + lift * 5) * reach;
    const armSweep = radians(18) * reach;
    const elbowFlex = radians(48 + lift * 5) * reach;
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

    const wristBack = 0.1;
    const sideSpacing = 0.105;
    this.leftHandTarget.copyFrom(this.target);
    this.leftHandTarget.x -= this.forwardAxis.x * wristBack;
    this.leftHandTarget.z -= this.forwardAxis.z * wristBack;
    this.leftHandTarget.x -= this.rightAxis.x * sideSpacing;
    this.leftHandTarget.z -= this.rightAxis.z * sideSpacing;
    this.leftHandTarget.y += 0.055 + effortWave * 0.012;

    this.rightHandTarget.copyFrom(this.target);
    this.rightHandTarget.x -= this.forwardAxis.x * wristBack;
    this.rightHandTarget.z -= this.forwardAxis.z * wristBack;
    this.rightHandTarget.x += this.rightAxis.x * sideSpacing;
    this.rightHandTarget.z += this.rightAxis.z * sideSpacing;
    this.rightHandTarget.y -= 0.055 + counterWave * 0.01;

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

    // Roll the wrists in opposite directions so both palms oppose one another
    // around the victim's vertical neck instead of hanging flat and horizontal.
    const gripRoll = radians(68) * reach;
    const gripFlex = radians(8) * reach;
    this.rig.applyLocalOffset(
      "leftHand",
      Axis.Y,
      gripRoll,
      Axis.Z,
      -gripFlex
    );
    this.rig.applyLocalOffset(
      "rightHand",
      Axis.Y,
      -gripRoll,
      Axis.Z,
      gripFlex
    );
    this.rig.prepare();
    this.rig.getJointWorldPositionToRef("leftHand", this.leftHandPosition);
    this.rig.getJointWorldPositionToRef("rightHand", this.rightHandPosition);
    this.rig.getJointWorldPositionToRef("leftForeArm", this.leftElbowPosition);
    this.rig.getJointWorldPositionToRef("rightForeArm", this.rightElbowPosition);
  }

  private solveArmToTarget(
    upperArm: MixamoJointName,
    foreArm: MixamoJointName,
    hand: MixamoJointName,
    target: Vector3
  ) {
    // Distal-to-proximal CCD is independent of Mixamo bone pre-rotations and
    // imported root scaling. Small bounded steps preserve the low-elbow seed.
    for (let iteration = 0; iteration < 7; iteration += 1) {
      this.rotateJointTowardTarget(foreArm, hand, target, radians(14));
      this.rotateJointTowardTarget(upperArm, hand, target, radians(12));
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
