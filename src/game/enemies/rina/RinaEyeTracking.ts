import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Node } from "@babylonjs/core/node";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

const EYE_FORWARD = new Vector3(0, -1, 0);
const MAX_YAW = 0.32;
const MAX_PITCH = 0.24;
const LOOK_SPEED = 9;

type TrackedEye = {
  pivot: TransformNode;
  restRotation: Quaternion;
  targetRotation: Quaternion;
  restLocalMatrix: Matrix;
  restWorldMatrix: Matrix;
  inverseRestWorldMatrix: Matrix;
  localTarget: Vector3;
  direction: Vector3;
  deltaRotation: Quaternion;
};

/** Rotates the two authored eye pivots inside the animated head. */
export class RinaEyeTracking {
  private readonly eyes: TrackedEye[];

  constructor(nodes: readonly Node[]) {
    this.eyes = ["L", "R"].map((side) => {
      const sourceName = `Rina_Eye_${side}_Pivot_EXPORT`;
      const pivot = nodes.find((node) =>
        node instanceof TransformNode &&
        (node.name === sourceName || node.name.endsWith(`:${sourceName}`))
      );
      if (!(pivot instanceof TransformNode)) {
        throw new Error(`Rina GLB is missing ${sourceName}`);
      }
      const restRotation = pivot.rotationQuaternion?.clone() ??
        Quaternion.FromEulerVector(pivot.rotation);
      pivot.rotationQuaternion = restRotation.clone();
      return {
        pivot,
        restRotation,
        targetRotation: restRotation.clone(),
        restLocalMatrix: Matrix.Identity(),
        restWorldMatrix: Matrix.Identity(),
        inverseRestWorldMatrix: Matrix.Identity(),
        localTarget: Vector3.Zero(),
        direction: Vector3.Zero(),
        deltaRotation: Quaternion.Identity(),
      };
    });
  }

  update(targetWorld: Vector3 | null, deltaTimeSeconds: number) {
    const amount = 1 - Math.exp(-LOOK_SPEED * Math.max(0, deltaTimeSeconds));
    for (const eye of this.eyes) {
      eye.targetRotation.copyFrom(eye.restRotation);
      if (targetWorld) {
        const { pivot } = eye;
        Matrix.ComposeToRef(
          pivot.scaling, eye.restRotation, pivot.position, eye.restLocalMatrix
        );
        if (pivot.parent) {
          pivot.parent.computeWorldMatrix(true);
          eye.restLocalMatrix.multiplyToRef(
            pivot.parent.getWorldMatrix(), eye.restWorldMatrix
          );
        } else {
          eye.restWorldMatrix.copyFrom(eye.restLocalMatrix);
        }
        eye.restWorldMatrix.invertToRef(eye.inverseRestWorldMatrix);
        Vector3.TransformCoordinatesToRef(
          targetWorld, eye.inverseRestWorldMatrix, eye.localTarget
        );

        // The iris points along local -Y; local Z is the eye's up axis.
        const forwardDistance = -eye.localTarget.y;
        if (forwardDistance > 0.01) {
          const yaw = Math.max(-MAX_YAW, Math.min(
            MAX_YAW, Math.atan2(eye.localTarget.x, forwardDistance)
          ));
          const pitch = Math.max(-MAX_PITCH, Math.min(
            MAX_PITCH,
            Math.atan2(eye.localTarget.z,
              Math.hypot(eye.localTarget.x, forwardDistance))
          ));
          eye.direction.set(
            Math.sin(yaw) * Math.cos(pitch),
            -Math.cos(yaw) * Math.cos(pitch),
            Math.sin(pitch)
          );
          Quaternion.FromUnitVectorsToRef(
            EYE_FORWARD, eye.direction, eye.deltaRotation
          );
          eye.restRotation.multiplyToRef(
            eye.deltaRotation, eye.targetRotation
          );
        }
      }
      Quaternion.SlerpToRef(
        eye.pivot.rotationQuaternion!, eye.targetRotation,
        amount, eye.pivot.rotationQuaternion!
      );
    }
  }
}
