import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Space } from "@babylonjs/core/Maths/math.axis";
import { Quaternion, type Vector3 } from "@babylonjs/core/Maths/math.vector";
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
  | "rightFoot";

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

    joint.baseRotation.multiplyToRef(this.localOffset, target);
    target.normalize();
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
}

export function normalizeMixamoBoneName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function createEmptyResolvedBoneMap(): Record<MixamoJointName, string | null> {
  return Object.fromEntries(
    JOINT_NAMES.map((name) => [name, null])
  ) as Record<MixamoJointName, string | null>;
}
