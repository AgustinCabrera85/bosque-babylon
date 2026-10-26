import type { Animation } from "@babylonjs/core/Animations/animation";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { RinaController } from "../../enemies/rina";

type ArmTrack = { node: TransformNode; animation: Animation };

// Keep the arm extended through the four-second electric link and the burst.
const DURATION = 5.5;
const TURN_SPEED = Math.PI * 0.82;
const AIM_YAW_TOLERANCE = Math.PI / 18;
const HAND_HEIGHT_ABOVE_TARGET_FEET = 1.45;
const REACTION_COOLDOWN = 8;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function angleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function turnTowards(from: number, to: number, maxStep: number) {
  const delta = angleDelta(from, to);
  return from + Math.max(-maxStep, Math.min(maxStep, delta));
}

/** Left-arm layer from the authored block idle, laid over the ongoing sing clip. */
export class RinaSingingPointAction {
  private readonly tracks: ArmTrack[];
  private readonly upperArm: TransformNode;
  private readonly forearm: TransformNode;
  private readonly hand: TransformNode;
  private readonly leftShoulder: TransformNode;
  private readonly rightShoulder: TransformNode;
  private readonly sideSign: number;
  private readonly scene: Scene;
  private readonly observer: Observer<Scene>;
  private readonly clipFrom: number;
  private readonly clipLength: number;
  private target: Vector3 | null = null;
  private yaw: number | null = null;
  private elapsed = 0;
  private elapsedSincePointing = 0;
  private weight = 0;
  private cooldown = 0;

  constructor(scene: Scene, private readonly rina: RinaController) {
    this.scene = scene;
    const clip = rina.animations.get("blockIdle");
    if (!clip) throw new Error("Rina's block idle animation is required for the pointing action");
    this.clipFrom = clip.from;
    this.clipLength = clip.to - clip.from;
    this.tracks = clip.targetedAnimations.flatMap(({ target, animation }) => {
      if (!(target instanceof TransformNode) ||
          animation.targetProperty !== "rotationQuaternion") return [];
      const bone = target.name.split(":").at(-1) ?? "";
      if (!/^Left(?:Shoulder|Arm|ForeArm|Hand(?:Thumb|Index|Middle|Ring|Pinky)?\d*)$/.test(bone)) {
        return [];
      }
      return [{ node: target, animation }];
    });
    const required = ["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"];
    for (const bone of required) {
      if (!this.tracks.some(track => track.node.name.endsWith(`:${bone}`))) {
        throw new Error(`Rina's block idle is missing ${bone}`);
      }
    }
    this.upperArm = this.tracks.find(track =>
      track.node.name.endsWith(":LeftArm"))!.node;
    this.forearm = this.tracks.find(track =>
      track.node.name.endsWith(":LeftForeArm"))!.node;
    this.hand = this.tracks.find(track =>
      track.node.name.endsWith(":LeftHand"))!.node;
    this.leftShoulder = this.tracks.find(track =>
      track.node.name.endsWith(":LeftShoulder"))!.node;
    const rightShoulder = rina.rig.getJointNode("rightShoulder");
    if (!rightShoulder) throw new Error("Rina's pointing pose needs both shoulders");
    this.rightShoulder = rightShoulder;
    this.leftShoulder.computeWorldMatrix(true);
    this.rightShoulder.computeWorldMatrix(true);
    const initialSide = this.leftShoulder.getAbsolutePosition()
      .subtract(this.rightShoulder.getAbsolutePosition());
    const initialYaw = rina.root.rotation.y;
    this.sideSign = initialSide.x * Math.cos(initialYaw) -
      initialSide.z * Math.sin(initialYaw) < 0 ? -1 : 1;
    if (this.upperArm !== rina.rig.getJointNode("leftArm") ||
        this.forearm !== rina.rig.getJointNode("leftForeArm")) {
      throw new Error("Rina's singing and block clips must target the same arm rig");
    }
    this.observer = scene.onAfterAnimationsObservable.add(() => this.applyArmPose());
  }

  /** Target is the photographer's world position at foot level. */
  pointAtPhotographer(target: Vector3, force = false) {
    if (!force && (this.target || this.cooldown > 0)) return false;
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) ||
        !Number.isFinite(target.z)) return false;
    const distance = Math.hypot(target.x - this.rina.root.position.x,
      target.z - this.rina.root.position.z);
    if (distance < 0.8) return false;
    this.target = target.clone();
    this.yaw ??= this.rina.root.rotation.y;
    this.elapsed = 0;
    this.elapsedSincePointing = 0;
    this.weight = 0;
    this.rina.setFocusTarget(new Vector3(target.x,
      target.y + HAND_HEIGHT_ABOVE_TARGET_FEET, target.z));
    return true;
  }

  get active() { return this.target !== null; }
  get pointing() { return this.weight > 0.85; }
  get blendWeight() { return this.weight; }
  get attackElapsed() { return this.target ? this.elapsed : 0; }
  get pointingElapsed() { return this.target ? this.elapsedSincePointing : 0; }

  /** Called after the song-position and base facing have been evaluated. */
  update(dt: number, baseYaw: number) {
    const step = Math.max(0, Math.min(dt, 0.05));
    this.cooldown = Math.max(0, this.cooldown - step);
    if (this.target) {
      const desiredYaw = Math.atan2(
        this.target.x - this.rina.root.position.x,
        this.target.z - this.rina.root.position.z
      );
      this.yaw = turnTowards(this.yaw ?? baseYaw, desiredYaw, TURN_SPEED * step);
      this.rina.root.rotation.y = this.yaw;
      const error = Math.abs(angleDelta(this.yaw, desiredYaw));
      // Turn the whole body first. The arm must never swing across the chest
      // or point behind Rina to compensate for a target at her side or back.
      if (error <= AIM_YAW_TOLERANCE) this.elapsed += step;
      const aligned = smoothstep((AIM_YAW_TOLERANCE - error) / AIM_YAW_TOLERANCE);
      this.weight = aligned * smoothstep(this.elapsed / 0.55) *
        smoothstep((DURATION - this.elapsed) / 0.7);
      if (this.weight > 0.85) this.elapsedSincePointing += step;
      if (this.elapsed >= DURATION) {
        this.target = null;
        this.weight = 0;
        this.cooldown = REACTION_COOLDOWN;
        this.rina.setFocusTarget(null);
      }
    } else if (this.yaw !== null) {
      this.yaw = turnTowards(this.yaw, baseYaw, TURN_SPEED * step);
      this.rina.root.rotation.y = this.yaw;
      if (Math.abs(angleDelta(this.yaw, baseYaw)) < 0.005) this.yaw = null;
    }
  }

  dispose() {
    this.scene.onAfterAnimationsObservable.remove(this.observer);
    this.rina.setFocusTarget(null);
  }

  private applyArmPose() {
    if (this.weight <= 0.001 || !this.rina.enabled) return;
    // Hold the authored extended-arm pose. Sampling the whole block-idle loop
    // made the hand drift across her chest at some song phases.
    const frame = this.clipFrom + Math.min(this.clipLength, 35);
    for (const { node, animation } of this.tracks) {
      const current = node.rotationQuaternion;
      const block = animation.evaluate(frame);
      if (!current || !(block instanceof Quaternion)) continue;
      Quaternion.SlerpToRef(current, block, this.weight, current);
      current.normalize();
    }

    this.rina.rig.prepare();
    // The block clip was authored with a different torso pose than singing.
    // Correct both upper arm and forearm, with the elbow kept on Rina's left.
    // This prevents the arm crossing her torso or the microphone arm.
    if (this.target) {
      // The singing clip can twist her upper torso by almost 90 degrees.
      // Untwist it before solving the free arm, while keeping the head,
      // microphone and right arm together on that same torso.
      this.leftShoulder.computeWorldMatrix(true);
      this.rightShoulder.computeWorldMatrix(true);
      const yaw = this.rina.root.rotation.y;
      const side = this.leftShoulder.getAbsolutePosition()
        .subtract(this.rightShoulder.getAbsolutePosition());
      side.y = 0;
      side.normalize();
      const desiredSide = new Vector3(Math.cos(yaw) * this.sideSign,
        0, -Math.sin(yaw) * this.sideSign);
      const sideCross = Vector3.Cross(side, desiredSide);
      const torsoTurn = Math.atan2(sideCross.y, Vector3.Dot(side, desiredSide));
      this.rina.rig.rotateWorld("spine", Vector3.Up(), torsoTurn * this.weight);
      this.rina.rig.prepare();
      this.upperArm.computeWorldMatrix(true);
      this.forearm.computeWorldMatrix(true);
      this.hand.computeWorldMatrix(true);
      const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const outward = desiredSide;
      const shoulderPosition = this.upperArm.getAbsolutePosition();
      const down = Math.max(-0.16, Math.min(0.10,
        (this.target.y + HAND_HEIGHT_ABOVE_TARGET_FEET - shoulderPosition.y) /
          Math.max(1, Vector3.Distance(this.target, shoulderPosition))));
      const upperDirection = forward.scale(0.68).addInPlace(outward.scale(0.68));
      upperDirection.y = down * 0.3 - 0.08;
      upperDirection.normalize();
      this.alignJoint("leftArm", this.upperArm, this.forearm, upperDirection);
      this.rina.rig.prepare();
      this.forearm.computeWorldMatrix(true);
      this.hand.computeWorldMatrix(true);
      const lowerDirection = forward.scale(0.97).addInPlace(outward.scale(0.12));
      lowerDirection.y = down;
      lowerDirection.normalize();
      this.alignJoint("leftForeArm", this.forearm, this.hand, lowerDirection);
    }
    this.rina.rig.prepare();
  }

  private alignJoint(name: "leftArm" | "leftForeArm", pivot: TransformNode,
    effector: TransformNode, desired: Vector3) {
    const original = pivot.rotationQuaternion?.clone();
    if (!original) return;
    for (let iteration = 0; iteration < 5; iteration++) {
      pivot.computeWorldMatrix(true);
      effector.computeWorldMatrix(true);
      const reach = effector.getAbsolutePosition()
        .subtract(pivot.getAbsolutePosition());
      if (reach.lengthSquared() < 0.001) break;
      reach.normalize();
      const dot = Math.max(-1, Math.min(1, Vector3.Dot(reach, desired)));
      const angle = Math.acos(dot);
      if (angle < 0.012) break;
      const axis = Vector3.Cross(reach, desired);
      if (axis.lengthSquared() <= 0.000001) {
        Vector3.CrossToRef(reach, Vector3.Up(), axis);
        if (axis.lengthSquared() <= 0.000001) {
          Vector3.CrossToRef(reach, Vector3.Right(), axis);
        }
      }
      axis.normalize();
      this.rina.rig.rotateWorld(name, axis, angle);
      this.rina.rig.prepare();
    }
    const solved = pivot.rotationQuaternion;
    if (solved) Quaternion.SlerpToRef(original, solved, this.weight, solved);
  }
}
