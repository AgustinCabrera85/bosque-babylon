import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { ProceduralPose } from "./ProceduralPose";

export interface ProceduralPoseOffsetTarget {
  setProceduralOffsets(offsets: ReadonlyMap<string, Quaternion>): void;
}

const IDENTITY = Quaternion.Identity();
const IDENTITY_EPSILON = 0.00001;

export class ProceduralPosePlayer {
  private readonly offsets = new Map<string, Quaternion>();
  private readonly participatingBones = new Set<string>();
  private readonly from = Quaternion.Identity();
  private readonly to = Quaternion.Identity();
  private readonly blended = Quaternion.Identity();

  public constructor(private readonly target?: ProceduralPoseOffsetTarget) {}

  public setPose(pose: ProceduralPose | null, weight = 1) {
    this.blendPoses(null, pose, weight);
  }

  public blendPoses(
    poseA: ProceduralPose | null,
    poseB: ProceduralPose | null,
    t: number,
    weight = 1
  ) {
    const blend = clamp01(t);
    const layerWeight = clamp01(weight);
    this.participatingBones.clear();
    if (poseA) {
      for (const name in poseA.bones) {
        this.participatingBones.add(name);
      }
    }
    if (poseB) {
      for (const name in poseB.bones) {
        this.participatingBones.add(name);
      }
    }

    for (const name of this.participatingBones) {
      readOffset(poseA, name, this.from);
      readOffset(poseB, name, this.to);
      Quaternion.SlerpToRef(this.from, this.to, blend, this.blended);
      if (layerWeight < 1) {
        Quaternion.SlerpToRef(
          IDENTITY,
          this.blended,
          layerWeight,
          this.blended
        );
      }
      this.blended.normalize();

      if (isIdentity(this.blended)) {
        this.offsets.delete(name);
        continue;
      }
      const output = this.offsets.get(name);
      if (output) output.copyFrom(this.blended);
      else this.offsets.set(name, this.blended.clone());
    }

    for (const name of this.offsets.keys()) {
      if (!this.participatingBones.has(name)) this.offsets.delete(name);
    }
    this.target?.setProceduralOffsets(this.offsets);
  }

  public clear(amount = 1) {
    const clearAmount = clamp01(amount);
    if (clearAmount >= 1) {
      this.offsets.clear();
    } else if (clearAmount > 0) {
      for (const [name, offset] of this.offsets) {
        Quaternion.SlerpToRef(offset, IDENTITY, clearAmount, offset);
        offset.normalize();
        if (isIdentity(offset)) this.offsets.delete(name);
      }
    }
    this.target?.setProceduralOffsets(this.offsets);
  }

  public getOffsets() {
    return this.offsets as ReadonlyMap<string, Quaternion>;
  }
}

function readOffset(
  pose: ProceduralPose | null,
  boneName: string,
  result: Quaternion
) {
  const serialized = pose?.bones[boneName]?.rotationOffset;
  if (!serialized) {
    result.copyFrom(IDENTITY);
    return;
  }
  result.set(serialized[0], serialized[1], serialized[2], serialized[3]);
  result.normalize();
}

function isIdentity(value: Quaternion) {
  return (
    Math.abs(value.x) <= IDENTITY_EPSILON &&
    Math.abs(value.y) <= IDENTITY_EPSILON &&
    Math.abs(value.z) <= IDENTITY_EPSILON &&
    Math.abs(1 - Math.abs(value.w)) <= IDENTITY_EPSILON
  );
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
