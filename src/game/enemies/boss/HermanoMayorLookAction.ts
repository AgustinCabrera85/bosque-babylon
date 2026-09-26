import type { Bone } from "@babylonjs/core/Bones/bone";
import { Axis, Space } from "@babylonjs/core/Maths/math.axis";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { HermanoMayorProceduralAction } from "./HermanoMayorAnimations";

export const HERMANO_MAYOR_ORIENT_LOOK_ACTION = "orientar la mirada";

const MAX_TRACKING_DISTANCE = 28;
const MIN_TRACKING_DISTANCE = 0.7;
const LOOK_DEAD_ZONE = radians(2);
const LOOK_YAW_LIMIT = radians(62);
const LOOK_UP_LIMIT = radians(24);
const LOOK_DOWN_LIMIT = radians(20);
const LOOK_YAW_RESPONSE = 5.2;
const LOOK_PITCH_RESPONSE = 4.4;
const LOOK_YAW_SPEED = radians(105);
const LOOK_PITCH_SPEED = radians(70);
const BODY_TURN_START = radians(72);
const BODY_TURN_STOP = radians(6);
const BODY_TURN_DELAY_SECONDS = 0.3;
const BODY_TURN_SPEED = radians(58);
const YAW_EFFORT = 0.9;
const PITCH_EFFORT = 0.82;

type WeightedJoint = {
  bone: Bone;
  transformNode: TransformNode | null;
  yawWeight: number;
  pitchWeight: number;
  appliedYaw: number;
  appliedPitch: number;
};

export type HermanoMayorLookTargetProvider = () => Vector3 | null;

export type HermanoMayorBodyTurnHooks = {
  onStart?(): void;
  onEnd?(): void;
};

/** Natural, bounded gaze overlay that can run over any base NLA action. */
export class HermanoMayorLookAction implements HermanoMayorProceduralAction {
  private readonly mesh: Mesh | null;
  private readonly head: Bone | null;
  private readonly joints: WeightedJoint[];
  private readonly headPosition = Vector3.Zero();
  private readonly targetPosition = Vector3.Zero();
  private readonly lastBodyRight = Vector3.Right();
  private readonly currentBodyRight = Vector3.Right();
  private targetProvider: HermanoMayorLookTargetProvider | null = null;
  private beforeAnimationsObserver: Observer<Scene> | null = null;
  private afterAnimationsObserver: Observer<Scene> | null = null;
  private requestedEnabled = false;
  private bodyTurning = false;
  private bodyTurnIntentSeconds = 0;
  private lookYaw = 0;
  private lookPitch = 0;

  public constructor(
    private readonly scene: Scene,
    private readonly root: TransformNode,
    meshes: readonly AbstractMesh[],
    private readonly bodyTurnHooks: HermanoMayorBodyTurnHooks = {}
  ) {
    this.mesh =
      meshes.find(
        (candidate): candidate is Mesh => candidate instanceof Mesh && !!candidate.skeleton
      ) ?? null;
    const skeleton = this.mesh?.skeleton ?? null;
    const findBone = (suffix: string) =>
      skeleton?.bones.find((bone) => normalizeBoneName(bone.name).endsWith(suffix)) ?? null;

    this.head = findBone("head");
    this.joints = [
      createWeightedJoint(findBone("spine2"), 0.18, 0.12),
      createWeightedJoint(findBone("neck"), 0.34, 0.34),
      createWeightedJoint(this.head, 0.48, 0.54),
    ].filter((entry): entry is WeightedJoint => entry !== null);

    if (!this.mesh || !this.head || !this.joints.length) {
      console.warn(
        "[HermanoMayor] No se encontraron los huesos necesarios para orientar la mirada."
      );
      return;
    }

    this.beforeAnimationsObserver = this.scene.onBeforeAnimationsObservable.add(() => {
      this.removePreviousPose();
    });
    this.afterAnimationsObserver = this.scene.onAfterAnimationsObservable.add(() => {
      this.update(Math.min(this.scene.getEngine().getDeltaTime() * 0.001, 0.05));
    });
  }

  public get enabled() {
    return this.requestedEnabled;
  }

  public setEnabled(enabled: boolean) {
    this.requestedEnabled = enabled;
    if (!enabled) this.cancelBodyTurn();
  }

  public setTargetProvider(provider: HermanoMayorLookTargetProvider | null) {
    this.targetProvider = provider;
  }

  public dispose() {
    this.cancelBodyTurn();
    this.removePreviousPose();
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
    if (!this.mesh || !this.head || dt <= 0) return;

    let desiredYaw = 0;
    let desiredPitch = 0;
    const suppliedTarget = this.requestedEnabled ? this.targetProvider?.() : null;

    if (suppliedTarget) {
      this.targetPosition.copyFrom(suppliedTarget);
      this.root.computeWorldMatrix(true);
      this.mesh.computeWorldMatrix(true);
      this.mesh.skeleton?.prepare(true);
      this.head.getAbsolutePositionToRef(this.mesh, this.headPosition);

      const dx = this.targetPosition.x - this.headPosition.x;
      const dy = this.targetPosition.y - this.headPosition.y;
      const dz = this.targetPosition.z - this.headPosition.z;
      const planarDistance = Math.hypot(dx, dz);
      const distance = Math.hypot(planarDistance, dy);

      if (distance >= MIN_TRACKING_DISTANCE && distance <= MAX_TRACKING_DISTANCE) {
        const targetWorldYaw = Math.atan2(dx, dz);
        let localYaw = normalizeAngle(targetWorldYaw - this.root.rotation.y);
        this.updateBodyTurn(targetWorldYaw, localYaw, dt);
        localYaw = normalizeAngle(targetWorldYaw - this.root.rotation.y);

        desiredYaw = clampWithDeadZone(
          localYaw * YAW_EFFORT,
          LOOK_DEAD_ZONE,
          -LOOK_YAW_LIMIT,
          LOOK_YAW_LIMIT
        );
        desiredPitch = clampWithDeadZone(
          -Math.atan2(dy, Math.max(0.001, planarDistance)) * PITCH_EFFORT,
          LOOK_DEAD_ZONE,
          -LOOK_UP_LIMIT,
          LOOK_DOWN_LIMIT
        );
      } else {
        this.cancelBodyTurn();
      }
    } else {
      this.cancelBodyTurn();
    }

    this.lookYaw = dampAngle(
      this.lookYaw,
      desiredYaw,
      LOOK_YAW_RESPONSE,
      LOOK_YAW_SPEED,
      dt
    );
    this.lookPitch = dampAngle(
      this.lookPitch,
      desiredPitch,
      LOOK_PITCH_RESPONSE,
      LOOK_PITCH_SPEED,
      dt
    );
    this.applyPose();
  }

  private updateBodyTurn(targetWorldYaw: number, localYaw: number, dt: number) {
    const absoluteYaw = Math.abs(localYaw);
    if (!this.bodyTurning) {
      if (absoluteYaw <= BODY_TURN_START) {
        this.bodyTurnIntentSeconds = 0;
        return;
      }
      this.bodyTurnIntentSeconds += dt;
      if (this.bodyTurnIntentSeconds < BODY_TURN_DELAY_SECONDS) return;
      this.startBodyTurn();
    }

    if (absoluteYaw <= BODY_TURN_STOP) {
      this.cancelBodyTurn();
      return;
    }

    this.root.rotationQuaternion = null;
    this.root.rotation.y = moveAngleTowards(
      this.root.rotation.y,
      targetWorldYaw,
      BODY_TURN_SPEED * dt
    );
  }

  private cancelBodyTurn() {
    this.bodyTurnIntentSeconds = 0;
    if (!this.bodyTurning) return;
    this.bodyTurning = false;
    this.bodyTurnHooks.onEnd?.();
  }

  private startBodyTurn() {
    if (this.bodyTurning) return;
    this.bodyTurning = true;
    this.bodyTurnHooks.onStart?.();
  }

  private applyPose() {
    if (!this.mesh) return;
    this.currentBodyRight.set(
      Math.cos(this.root.rotation.y),
      0,
      -Math.sin(this.root.rotation.y)
    );
    this.lastBodyRight.copyFrom(this.currentBodyRight);

    for (const entry of this.joints) {
      entry.appliedYaw = this.lookYaw * entry.yawWeight;
      entry.appliedPitch = this.lookPitch * entry.pitchWeight;
      this.rotateJoint(entry, Axis.Y, entry.appliedYaw);
      this.rotateJoint(entry, this.currentBodyRight, entry.appliedPitch);
    }
    this.mesh.skeleton?.prepare(true);
  }

  private removePreviousPose() {
    if (!this.mesh) return;
    for (let index = this.joints.length - 1; index >= 0; index--) {
      const entry = this.joints[index];
      if (entry.appliedPitch !== 0) {
        this.rotateJoint(entry, this.lastBodyRight, -entry.appliedPitch);
      }
      if (entry.appliedYaw !== 0) {
        this.rotateJoint(entry, Axis.Y, -entry.appliedYaw);
      }
      entry.appliedYaw = 0;
      entry.appliedPitch = 0;
    }
  }

  private rotateJoint(entry: WeightedJoint, axis: Vector3, amount: number) {
    if (amount === 0 || !this.mesh) return;
    if (entry.transformNode) {
      entry.transformNode.computeWorldMatrix(true);
      entry.transformNode.rotate(axis, amount, Space.WORLD);
      return;
    }
    entry.bone.rotate(axis, amount, Space.WORLD, this.mesh);
  }
}

function createWeightedJoint(
  bone: Bone | null,
  yawWeight: number,
  pitchWeight: number
): WeightedJoint | null {
  return bone
    ? {
        bone,
        transformNode: bone.getTransformNode(),
        yawWeight,
        pitchWeight,
        appliedYaw: 0,
        appliedPitch: 0,
      }
    : null;
}

function normalizeBoneName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function normalizeAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function moveAngleTowards(current: number, target: number, maxStep: number) {
  const delta = normalizeAngle(target - current);
  return current + Math.max(-maxStep, Math.min(maxStep, delta));
}

function dampAngle(
  current: number,
  target: number,
  response: number,
  maxSpeed: number,
  dt: number
) {
  const delta = normalizeAngle(target - current);
  const requestedStep = delta * (1 - Math.exp(-response * dt));
  const maxStep = maxSpeed * dt;
  return current + Math.max(-maxStep, Math.min(maxStep, requestedStep));
}

function clampWithDeadZone(
  value: number,
  deadZone: number,
  minimum: number,
  maximum: number
) {
  if (Math.abs(value) <= deadZone) return 0;
  return Math.max(minimum, Math.min(maximum, value));
}
