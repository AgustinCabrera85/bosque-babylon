import type { Bone } from "@babylonjs/core/Bones/bone";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type {
  ProceduralPose,
  SerializedQuaternion,
} from "../../game/animation/ProceduralPose";
import type { ProceduralPoseOffsetTarget } from "../../game/animation/ProceduralPosePlayer";
import { normalizeMixamoBoneName } from "../../game/animation/MixamoProceduralRig";

export type AuthoringSource = {
  model?: string;
  animation?: string;
  time?: number;
};

export type AuthoringBone = {
  name: string;
  parentName: string | null;
  alias: string | null;
};

export type ReferencePose = {
  source: AuthoringSource;
  root: {
    position: [number, number, number];
    rotation: SerializedQuaternion;
    scaling: [number, number, number];
  };
  bones: Record<string, SerializedQuaternion>;
};

type BoneBinding = {
  bone: Bone;
  node: TransformNode;
  baseRotation: Quaternion;
};

const IDENTITY_EPSILON = 0.00001;

export class BonePoseController implements ProceduralPoseOffsetTarget {
  public onPoseApplied: (() => void) | null = null;
  public onOffsetsChanged: (() => void) | null = null;

  private readonly bindings = new Map<string, BoneBinding>();
  private readonly offsets = new Map<string, Quaternion>();
  private readonly appliedBones = new Set<string>();
  private beforeAnimationsObserver: Observer<Scene> | null;
  private afterAnimationsObserver: Observer<Scene> | null;
  private poseApplied = false;
  private disposed = false;
  private reference: ReferencePose | null = null;

  public constructor(
    private readonly scene: Scene,
    public readonly skeleton: Skeleton,
    public readonly mesh: AbstractMesh,
    private readonly modelRoot: TransformNode
  ) {
    for (const bone of skeleton.bones) {
      const node = bone.getTransformNode();
      if (!node) continue;
      ensureQuaternion(node);
      this.bindings.set(bone.name, {
        bone,
        node,
        baseRotation: node.rotationQuaternion!.clone(),
      });
    }

    this.beforeAnimationsObserver = scene.onBeforeAnimationsObservable.add(() => {
      this.restoreAnimationPose();
    });
    this.afterAnimationsObserver = scene.onAfterAnimationsObservable.add(() => {
      this.captureAndApplyOffsets();
    });
  }

  public getBones(): AuthoringBone[] {
    return [...this.bindings.entries()].map(([name, binding]) => ({
      name,
      parentName: binding.bone.getParent()?.name ?? null,
      alias: getMixamoAlias(name),
    }));
  }

  public getBoneTransformNode(name: string) {
    return this.bindings.get(name)?.node ?? null;
  }

  public getRotationOffset(name: string) {
    return this.offsets.get(name)?.clone() ?? Quaternion.Identity();
  }

  public setRotationOffset(name: string, rotationOffset: Quaternion) {
    if (!this.bindings.has(name)) return;
    const normalized = rotationOffset.clone().normalize();
    canonicalizeQuaternionInPlace(normalized);
    if (isIdentityQuaternion(normalized)) this.offsets.delete(name);
    else this.offsets.set(name, normalized);
    this.forceApply();
    this.onOffsetsChanged?.();
  }

  public setProceduralOffsets(offsets: ReadonlyMap<string, Quaternion>) {
    for (const name of this.offsets.keys()) {
      if (!offsets.has(name)) this.offsets.delete(name);
    }
    for (const [name, offset] of offsets) {
      if (!this.bindings.has(name)) continue;
      const target = this.offsets.get(name);
      if (target) target.copyFrom(offset);
      else this.offsets.set(name, offset.clone());
    }
  }

  public loadPose(pose: ProceduralPose | null) {
    const poseBones = pose?.bones ?? {};
    for (const name of this.offsets.keys()) {
      if (!poseBones[name]) this.offsets.delete(name);
    }
    for (const [name, bone] of Object.entries(poseBones)) {
      if (!this.bindings.has(name)) continue;
      const [x, y, z, w] = bone.rotationOffset;
      const target = this.offsets.get(name);
      if (target) target.set(x, y, z, w).normalize();
      else this.offsets.set(name, new Quaternion(x, y, z, w).normalize());
    }
    this.forceApply();
    this.onOffsetsChanged?.();
  }

  public resetBone(name: string) {
    if (!this.offsets.delete(name)) return;
    this.forceApply();
    this.onOffsetsChanged?.();
  }

  public resetAll() {
    if (this.offsets.size === 0) return;
    this.offsets.clear();
    this.forceApply();
    this.onOffsetsChanged?.();
  }

  public getEditedBoneNames() {
    return [...this.offsets.keys()];
  }

  public createPose(id: string, source: AuthoringSource): ProceduralPose {
    const bones: ProceduralPose["bones"] = {};
    for (const [name, offset] of this.offsets) {
      bones[name] = { rotationOffset: serializeQuaternion(offset) };
    }
    return {
      id,
      source: { ...source },
      bones,
    };
  }

  public captureReference(source: AuthoringSource) {
    const bones: Record<string, SerializedQuaternion> = {};
    for (const [name, binding] of this.bindings) {
      const rotation = binding.node.rotationQuaternion;
      if (rotation) bones[name] = serializeQuaternion(rotation);
    }
    const rootRotation = this.modelRoot.rotationQuaternion?.clone() ??
      Quaternion.RotationYawPitchRoll(
        this.modelRoot.rotation.y,
        this.modelRoot.rotation.x,
        this.modelRoot.rotation.z
      );
    this.reference = {
      source: { ...source },
      root: {
        position: serializeVector(this.modelRoot.position),
        rotation: serializeQuaternion(rootRotation),
        scaling: serializeVector(this.modelRoot.scaling),
      },
      bones,
    };
    return this.reference;
  }

  public clearReference() {
    this.reference = null;
  }

  public hasReference() {
    return this.reference !== null;
  }

  public getReferenceDifference(name: string) {
    const referenceRotation = this.reference?.bones[name];
    const currentRotation = this.bindings.get(name)?.node.rotationQuaternion;
    if (!referenceRotation || !currentRotation) return null;
    const reference = Quaternion.FromArray(referenceRotation);
    const difference = reference.conjugate().multiply(currentRotation).normalize();
    canonicalizeQuaternionInPlace(difference);
    return difference;
  }

  public getCurrentRotation(name: string) {
    return this.bindings.get(name)?.node.rotationQuaternion?.clone() ?? null;
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.restoreAnimationPose();
    if (this.beforeAnimationsObserver) {
      this.scene.onBeforeAnimationsObservable.remove(this.beforeAnimationsObserver);
      this.beforeAnimationsObserver = null;
    }
    if (this.afterAnimationsObserver) {
      this.scene.onAfterAnimationsObservable.remove(this.afterAnimationsObserver);
      this.afterAnimationsObserver = null;
    }
    this.onPoseApplied = null;
    this.onOffsetsChanged = null;
  }

  private restoreAnimationPose() {
    if (!this.poseApplied) return;
    for (const name of this.appliedBones) {
      const binding = this.bindings.get(name);
      binding?.node.rotationQuaternion?.copyFrom(binding.baseRotation);
    }
    this.appliedBones.clear();
    this.poseApplied = false;
    this.skeleton.prepare(true);
  }

  private captureAndApplyOffsets() {
    if (this.disposed) return;
    for (const binding of this.bindings.values()) {
      const rotation = binding.node.rotationQuaternion;
      if (rotation) binding.baseRotation.copyFrom(rotation);
    }

    for (const [name, offset] of this.offsets) {
      const binding = this.bindings.get(name);
      const target = binding?.node.rotationQuaternion;
      if (!binding || !target) continue;
      binding.baseRotation.multiplyToRef(offset, target);
      target.normalize();
      this.appliedBones.add(name);
    }

    this.poseApplied = this.appliedBones.size > 0;
    if (this.poseApplied) this.skeleton.prepare(true);
    this.onPoseApplied?.();
  }

  private forceApply() {
    this.restoreAnimationPose();
    this.captureAndApplyOffsets();
  }
}

export function serializeQuaternion(value: Quaternion): SerializedQuaternion {
  const normalized = value.clone().normalize();
  canonicalizeQuaternionInPlace(normalized);
  return [
    cleanNumber(normalized.x),
    cleanNumber(normalized.y),
    cleanNumber(normalized.z),
    cleanNumber(normalized.w),
  ];
}

function ensureQuaternion(node: TransformNode) {
  if (node.rotationQuaternion) return;
  node.rotationQuaternion = Quaternion.RotationYawPitchRoll(
    node.rotation.y,
    node.rotation.x,
    node.rotation.z
  );
  node.rotation.setAll(0);
}

function isIdentityQuaternion(value: Quaternion) {
  return (
    Math.abs(value.x) <= IDENTITY_EPSILON &&
    Math.abs(value.y) <= IDENTITY_EPSILON &&
    Math.abs(value.z) <= IDENTITY_EPSILON &&
    Math.abs(1 - Math.abs(value.w)) <= IDENTITY_EPSILON
  );
}

function canonicalizeQuaternionInPlace(value: Quaternion) {
  if (value.w >= 0) return value;
  value.scaleInPlace(-1);
  return value;
}

function serializeVector(value: Vector3): [number, number, number] {
  return [cleanNumber(value.x), cleanNumber(value.y), cleanNumber(value.z)];
}

function cleanNumber(value: number) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Math.abs(rounded) < 0.0000005 ? 0 : rounded;
}

function getMixamoAlias(name: string) {
  const normalized = normalizeMixamoBoneName(name);
  const aliases: Array<[string, string]> = [
    ["leftforearm", "Left Forearm"],
    ["rightforearm", "Right Forearm"],
    ["leftshoulder", "Left Shoulder"],
    ["rightshoulder", "Right Shoulder"],
    ["leftupleg", "Left Upper Leg"],
    ["rightupleg", "Right Upper Leg"],
    ["leftarm", "Left Arm"],
    ["rightarm", "Right Arm"],
    ["lefthand", "Left Hand"],
    ["righthand", "Right Hand"],
    ["leftleg", "Left Leg"],
    ["rightleg", "Right Leg"],
    ["leftfoot", "Left Foot"],
    ["rightfoot", "Right Foot"],
    ["spine2", "Upper Chest"],
    ["spine1", "Chest"],
    ["spine", "Spine"],
    ["neck", "Neck"],
    ["head", "Head"],
    ["hips", "Hips"],
  ];
  return aliases.find(([suffix]) => normalized.endsWith(suffix))?.[1] ?? null;
}
