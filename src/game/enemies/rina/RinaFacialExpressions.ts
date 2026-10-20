import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { MorphTarget } from "@babylonjs/core/Morph/morphTarget";

/** Facial shape keys supplied by the GLB; the collar correction is excluded. */
export const RINA_FACIAL_SHAPE_KEYS = [
  "Blink_L", "Blink_R", "Mouth_Open", "Mouth_O", "Mouth_Wide",
  "Smile_L", "Smile_R", "Mouth_Press", "Brow_Raise_L", "Brow_Raise_R",
  "Brow_Lower_L", "Brow_Lower_R", "Brow_InnerUp_L", "Brow_InnerUp_R",
  "Brow_OuterUp_L", "Brow_OuterUp_R", "Brow_Frown",
] as const;

/** Writes the same shape key on every glTF primitive that contains it. */
export class RinaFacialExpressions {
  private readonly targets = new Map<string, MorphTarget[]>();

  constructor(meshes: readonly AbstractMesh[]) {
    for (const mesh of meshes) {
      if (!(mesh instanceof Mesh) || !mesh.morphTargetManager) continue;
      const manager = mesh.morphTargetManager;
      for (let index = 0; index < manager.numTargets; index++) {
        const target = manager.getTarget(index);
        const targets = this.targets.get(target.name) ?? [];
        if (!targets.includes(target)) targets.push(target);
        this.targets.set(target.name, targets);
      }
    }
  }

  getAvailableShapeKeys() { return [...this.targets.keys()]; }

  getWeight(name: string) { return this.targets.get(name)?.[0]?.influence ?? null; }

  setWeight(name: string, weight: number) {
    const targets = this.targets.get(name);
    if (!targets || !Number.isFinite(weight)) return false;
    const influence = Math.max(0, Math.min(1, weight));
    for (const target of targets) target.influence = influence;
    return true;
  }

  setWeights(weights: Readonly<Record<string, number>>) {
    for (const [name, weight] of Object.entries(weights)) this.setWeight(name, weight);
  }

  resetFace() {
    for (const name of RINA_FACIAL_SHAPE_KEYS) this.setWeight(name, 0);
  }
}
