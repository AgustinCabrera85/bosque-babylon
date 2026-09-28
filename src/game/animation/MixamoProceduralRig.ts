import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Space } from "@babylonjs/core/Maths/math.axis";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

export type MixamoJointName =
  | "hips"
  | "spine"
  | "spine1"
  | "spine2"
  | "neck"
  | "head"
  | "leftShoulder"
  | "leftArm"
  | "leftForeArm"
  | "leftHand"
  | "rightShoulder"
  | "rightArm"
  | "rightForeArm"
  | "rightHand"
  | "leftUpLeg"
  | "leftLeg"
  | "leftFoot"
  | "rightUpLeg"
  | "rightLeg"
  | "rightFoot"
  | "leftHandThumb1"
  | "leftHandThumb2"
  | "leftHandThumb3"
  | "leftHandIndex1"
  | "leftHandIndex2"
  | "leftHandIndex3"
  | "leftHandMiddle1"
  | "leftHandMiddle2"
  | "leftHandMiddle3"
  | "leftHandRing1"
  | "leftHandRing2"
  | "leftHandRing3"
  | "leftHandPinky1"
  | "leftHandPinky2"
  | "leftHandPinky3"
  | "rightHandThumb1"
  | "rightHandThumb2"
  | "rightHandThumb3"
  | "rightHandIndex1"
  | "rightHandIndex2"
  | "rightHandIndex3"
  | "rightHandMiddle1"
  | "rightHandMiddle2"
  | "rightHandMiddle3"
  | "rightHandRing1"
  | "rightHandRing2"
  | "rightHandRing3"
  | "rightHandPinky1"
  | "rightHandPinky2"
  | "rightHandPinky3";

type ResolvedMixamoJoint = {
  node: TransformNode;
  baseRotation: Quaternion;
};

const JOINT_SUFFIXES: Record<MixamoJointName, string> = {
  hips: "hips",
  spine: "spine",
  spine1: "spine1",
  spine2: "spine2",
  neck: "neck",
  head: "head",
  leftShoulder: "leftshoulder",
  leftArm: "leftarm",
  leftForeArm: "leftforearm",
  leftHand: "lefthand",
  rightShoulder: "rightshoulder",
  rightArm: "rightarm",
  rightForeArm: "rightforearm",
  rightHand: "righthand",
  leftUpLeg: "leftupleg",
  leftLeg: "leftleg",
  leftFoot: "leftfoot",
  rightUpLeg: "rightupleg",
  rightLeg: "rightleg",
  rightFoot: "rightfoot",
  leftHandThumb1: "lefthandthumb1",
  leftHandThumb2: "lefthandthumb2",
  leftHandThumb3: "lefthandthumb3",
  leftHandIndex1: "lefthandindex1",
  leftHandIndex2: "lefthandindex2",
  leftHandIndex3: "lefthandindex3",
  leftHandMiddle1: "lefthandmiddle1",
  leftHandMiddle2: "lefthandmiddle2",
  leftHandMiddle3: "lefthandmiddle3",
  leftHandRing1: "lefthandring1",
  leftHandRing2: "lefthandring2",
  leftHandRing3: "lefthandring3",
  leftHandPinky1: "lefthandpinky1",
  leftHandPinky2: "lefthandpinky2",
  leftHandPinky3: "lefthandpinky3",
  rightHandThumb1: "righthandthumb1",
  rightHandThumb2: "righthandthumb2",
  rightHandThumb3: "righthandthumb3",
  rightHandIndex1: "righthandindex1",
  rightHandIndex2: "righthandindex2",
  rightHandIndex3: "righthandindex3",
  rightHandMiddle1: "righthandmiddle1",
  rightHandMiddle2: "righthandmiddle2",
  rightHandMiddle3: "righthandmiddle3",
  rightHandRing1: "righthandring1",
  rightHandRing2: "righthandring2",
  rightHandRing3: "righthandring3",
  rightHandPinky1: "righthandpinky1",
  rightHandPinky2: "righthandpinky2",
  rightHandPinky3: "righthandpinky3",
};

const JOINT_NAMES = Object.keys(JOINT_SUFFIXES) as MixamoJointName[];

/**
 * Cached adapter for post-animation procedural layers on Mixamo-compatible rigs.
 *
 * It resolves the skeleton once, preserves the animation-generated local pose,
 * and exposes bounded building blocks for world-space torso motion and
 * anatomical joint-local limb offsets. It intentionally owns no gameplay state.
 */
export class MixamoProceduralRig {
  public readonly mesh: Mesh | null;
  private readonly joints = new Map<MixamoJointName, ResolvedMixamoJoint>();
  private readonly orderedJoints: ResolvedMixamoJoint[] = [];
  private readonly resolvedBones = createEmptyResolvedBoneMap();
  private readonly animatedBones: MixamoJointName[] = [];
  private readonly missingRequiredBones: MixamoJointName[] = [];
  private readonly localOffset = Quaternion.Identity();
  private readonly localRotationScratch = Quaternion.Identity();

  public constructor(
    meshes: readonly AbstractMesh[],
    animationGroups: readonly AnimationGroup[],
    requiredJoints: readonly MixamoJointName[]
  ) {
    this.mesh =
      meshes
        .filter(
          (candidate): candidate is Mesh =>
            candidate instanceof Mesh && candidate.skeleton !== null
        )
        .sort(
          (left, right) =>
            (right.skeleton?.bones.length ?? 0) -
            (left.skeleton?.bones.length ?? 0)
        )[0] ?? null;

    const animatedTargets = new Set<string>();
    for (const group of animationGroups) {
      for (const targeted of group.targetedAnimations) {
        const targetName = (targeted.target as { name?: unknown } | null)?.name;
        if (
          typeof targetName === "string" &&
          targeted.animation.targetProperty === "rotationQuaternion"
        ) {
          animatedTargets.add(normalizeMixamoBoneName(targetName));
        }
      }
    }

    const skeleton = this.mesh?.skeleton ?? null;
    if (skeleton) {
      for (const name of JOINT_NAMES) {
        const suffix = JOINT_SUFFIXES[name];
        const bone =
          skeleton.bones.find((candidate) =>
            normalizeMixamoBoneName(candidate.name).endsWith(suffix)
          ) ?? null;
        const node = bone?.getTransformNode() ?? null;
        this.resolvedBones[name] = bone?.name ?? null;
        if (!bone || !node) continue;
        if (!node.rotationQuaternion) {
          node.rotationQuaternion = Quaternion.RotationYawPitchRoll(
            node.rotation.y,
            node.rotation.x,
            node.rotation.z
          );
          node.rotation.setAll(0);
        }
        const joint: ResolvedMixamoJoint = {
          node,
          baseRotation: node.rotationQuaternion.clone(),
        };
        this.joints.set(name, joint);
        this.orderedJoints.push(joint);
        if (animatedTargets.has(normalizeMixamoBoneName(node.name))) {
          this.animatedBones.push(name);
        }
      }
    }

    for (const required of requiredJoints) {
      if (!this.joints.has(required)) this.missingRequiredBones.push(required);
    }
  }

  public get available() {
    return this.mesh !== null && this.missingRequiredBones.length === 0;
  }

  public captureBasePose() {
    for (const joint of this.orderedJoints) {
      if (joint.node.rotationQuaternion) {
        joint.baseRotation.copyFrom(joint.node.rotationQuaternion);
      }
    }
  }

  public restoreBasePose() {
    for (const joint of this.orderedJoints) {
      joint.node.rotationQuaternion?.copyFrom(joint.baseRotation);
    }
    this.prepare();
  }

  public prepare() {
    this.mesh?.skeleton?.prepare(true);
  }

  public rotateWorld(name: MixamoJointName, axis: Vector3, amount: number) {
    if (Math.abs(amount) <= 0.000001) return;
    const joint = this.joints.get(name);
    if (!joint) return;
    joint.node.computeWorldMatrix(true);
    joint.node.rotate(axis, amount, Space.WORLD);
  }

  public applyLocalOffset(
    name: MixamoJointName,
    firstAxis: Vector3,
    firstAmount: number,
    secondAxis?: Vector3,
    secondAmount = 0
  ) {
    const joint = this.joints.get(name);
    const target = joint?.node.rotationQuaternion;
    if (!joint || !target) return;

    this.composeLocalOffset(
      firstAxis,
      firstAmount,
      secondAxis,
      secondAmount
    );
    joint.baseRotation.multiplyToRef(this.localOffset, target);
    target.normalize();
  }

  /**
   * Appends a joint-local rotation to the pose currently on the node.
   *
   * Unlike applyLocalOffset(), this preserves world-space corrections already
   * applied by a positional solver during the same procedural pass.
   */
  public appendLocalOffset(
    name: MixamoJointName,
    firstAxis: Vector3,
    firstAmount: number,
    secondAxis?: Vector3,
    secondAmount = 0
  ) {
    const target = this.joints.get(name)?.node.rotationQuaternion;
    if (!target) return;

    this.composeLocalOffset(
      firstAxis,
      firstAmount,
      secondAxis,
      secondAmount
    );
    target.multiplyInPlace(this.localOffset);
    target.normalize();
  }

  private composeLocalOffset(
    firstAxis: Vector3,
    firstAmount: number,
    secondAxis?: Vector3,
    secondAmount = 0
  ) {
    this.localOffset.set(0, 0, 0, 1);
    if (Math.abs(firstAmount) > 0.000001) {
      Quaternion.RotationAxisToRef(
        firstAxis,
        firstAmount,
        this.localRotationScratch
      );
      this.localOffset.multiplyInPlace(this.localRotationScratch);
    }
    if (secondAxis && Math.abs(secondAmount) > 0.000001) {
      Quaternion.RotationAxisToRef(
        secondAxis,
        secondAmount,
        this.localRotationScratch
      );
      this.localOffset.multiplyInPlace(this.localRotationScratch);
    }
  }

  public getResolvedBones() {
    return { ...this.resolvedBones };
  }

  public getAnimatedBones() {
    return [...this.animatedBones];
  }

  public getMissingRequiredBones() {
    return [...this.missingRequiredBones];
  }

  public getJointWorldPositionToRef(
    name: MixamoJointName,
    result: Vector3
  ) {
    const joint = this.joints.get(name);
    if (!joint) return false;
    joint.node.computeWorldMatrix(true);
    result.copyFrom(joint.node.getAbsolutePosition());
    return true;
  }

  public getJointWorldDirectionToRef(
    name: MixamoJointName,
    localDirection: Vector3,
    result: Vector3
  ) {
    const joint = this.joints.get(name);
    if (!joint) return false;
    joint.node.computeWorldMatrix(true);
    Vector3.TransformNormalToRef(
      localDirection,
      joint.node.getWorldMatrix(),
      result
    );
    const lengthSquared = result.lengthSquared();
    if (lengthSquared <= 0.000001) return false;
    result.scaleInPlace(1 / Math.sqrt(lengthSquared));
    return true;
  }
}

export function normalizeMixamoBoneName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function createEmptyResolvedBoneMap(): Record<MixamoJointName, string | null> {
  return Object.fromEntries(
    JOINT_NAMES.map((name) => [name, null])
  ) as Record<MixamoJointName, string | null>;
}
