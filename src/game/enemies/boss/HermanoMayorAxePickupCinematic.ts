import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerController } from "../../PlayerController";
import type { HermanoMayorHandle } from "./HermanoMayor";
import { HERMANO_MAYOR_AXE_PICKUP_TIMING } from "./HermanoMayorAxePickupAction";

const DETAIL_FOV = 0.52;
const WIDE_FOV = 0.8;
const DETAIL_LIGHT_INTENSITY = 8.2;

/** Close hand insert followed by a full-body reveal of the armed boss. */
export class HermanoMayorAxePickupCinematic {
  private readonly entryPosition = Vector3.Zero();
  private readonly entryTarget = Vector3.Zero();
  private readonly cameraSide = Vector3.Zero();
  private readonly axePosition = Vector3.Zero();
  private readonly handPosition = Vector3.Zero();
  private readonly detailTarget = Vector3.Zero();
  private readonly detailPosition = Vector3.Zero();
  private readonly wideTarget = Vector3.Zero();
  private readonly widePosition = Vector3.Zero();
  private readonly blendedPosition = Vector3.Zero();
  private readonly blendedTarget = Vector3.Zero();
  private readonly fillLight: PointLight;
  private active = false;
  private elapsed = 0;

  public constructor(
    private readonly player: PlayerController,
    private readonly actor: HermanoMayorHandle
  ) {
    this.fillLight = new PointLight(
      "hermanoMayorAxeCinematicFill",
      Vector3.Zero(),
      this.player.camera.getScene()
    );
    this.fillLight.diffuse = new Color3(1, 0.72, 0.48);
    this.fillLight.specular = new Color3(1, 0.82, 0.66);
    this.fillLight.range = 7.2;
    this.fillLight.intensity = 0;
  }

  public get isActive() {
    return this.active;
  }

  public start() {
    if (this.active || !this.actor.hasAxePickupTarget) return false;
    this.player.camera.computeWorldMatrix();
    this.entryPosition.copyFrom(this.player.camera.globalPosition);
    const lookRay = this.player.getLookRay();
    this.entryTarget.copyFrom(
      this.entryPosition.add(lookRay.direction.scale(10))
    );
    if (!this.player.beginCinematicSequence()) return false;

    this.resolveTargets();
    const yaw = this.actor.root.rotation.y;
    this.cameraSide.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const entrySideX = this.entryPosition.x - this.detailTarget.x;
    const entrySideZ = this.entryPosition.z - this.detailTarget.z;
    if (this.cameraSide.x * entrySideX + this.cameraSide.z * entrySideZ < 0) {
      this.cameraSide.scaleInPlace(-1);
    }
    this.active = true;
    this.elapsed = 0;
    this.fillLight.intensity = DETAIL_LIGHT_INTENSITY;
    document.body.classList.add("hermano-mayor-axe-cinematic-active");
    this.applyFrame(0);
    return true;
  }

  public update(deltaSeconds: number) {
    if (!this.active) return;
    this.elapsed = Math.min(
      HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd,
      this.elapsed + Math.max(0, deltaSeconds)
    );
    this.applyFrame(
      this.elapsed / HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd
    );
  }

  public finish(completed: boolean) {
    if (!this.active) return;
    if (completed) this.applyFrame(1);
    this.active = false;
    this.fillLight.intensity = 0;
    document.body.classList.remove("hermano-mayor-axe-cinematic-active");
    this.player.endCinematicSequence(completed ? 0.72 : 0.28);
  }

  public dispose() {
    this.finish(false);
    this.fillLight.dispose();
  }

  public getDebugSnapshot() {
    return {
      active: this.active,
      elapsed: this.elapsed,
      duration: HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd,
      detailTarget: vectorSnapshot(this.detailTarget),
      wideTarget: vectorSnapshot(this.wideTarget),
    };
  }

  public seekForDebug(time: number) {
    if (!import.meta.env.DEV || !this.active) return false;
    this.elapsed = Math.max(
      0,
      Math.min(HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd, time)
    );
    this.applyFrame(
      this.elapsed / HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd
    );
    return true;
  }

  private applyFrame(progress: number) {
    this.resolveTargets();
    const amount = clamp01(progress);
    const enter = smoothstep(0, 0.12, amount);
    // Hold the insert through palm contact and the complete finger curl. Only
    // pull back once the closed hand actually owns the attached axe.
    const pullBack = smoothstep(
      (HERMANO_MAYOR_AXE_PICKUP_TIMING.attachAt + 0.22) /
        HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd,
      HERMANO_MAYOR_AXE_PICKUP_TIMING.liftEnd /
        HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd,
      amount
    );

    this.detailPosition
      .copyFrom(this.detailTarget)
      .addInPlace(this.cameraSide.scale(0.62))
      .addInPlaceFromFloats(0, 0.16, 0);
    this.wideTarget.copyFrom(this.actor.root.position).addInPlaceFromFloats(0, 1.28, 0);
    this.widePosition
      .copyFrom(this.actor.root.position)
      .addInPlace(this.cameraSide.scale(4.65))
      .addInPlaceFromFloats(0, 2.12, 0);
    this.fillLight.position
      .copyFrom(this.detailTarget)
      .addInPlace(this.cameraSide.scale(0.42))
      .addInPlaceFromFloats(0, 0.48, 0);
    this.fillLight.intensity = DETAIL_LIGHT_INTENSITY - pullBack * 3.7;

    Vector3.LerpToRef(
      this.entryPosition,
      this.detailPosition,
      enter,
      this.blendedPosition
    );
    Vector3.LerpToRef(
      this.entryTarget,
      this.detailTarget,
      enter,
      this.blendedTarget
    );
    Vector3.LerpToRef(
      this.blendedPosition,
      this.widePosition,
      pullBack,
      this.blendedPosition
    );
    Vector3.LerpToRef(
      this.blendedTarget,
      this.wideTarget,
      pullBack,
      this.blendedTarget
    );
    this.player.setCinematicCamera(
      this.blendedPosition,
      this.blendedTarget,
      0,
      DETAIL_FOV + (WIDE_FOV - DETAIL_FOV) * pullBack
    );
  }

  private resolveTargets() {
    const hasAxe = this.actor.getAxeGripPositionToRef(this.axePosition);
    const hasHand = this.actor.getAxeHandPositionToRef(this.handPosition);
    if (hasAxe && hasHand) {
      Vector3.LerpToRef(
        this.axePosition,
        this.handPosition,
        0.5,
        this.detailTarget
      );
      return;
    }
    if (hasAxe) {
      this.detailTarget.copyFrom(this.axePosition);
      return;
    }
    this.detailTarget.copyFrom(this.actor.root.position).addInPlaceFromFloats(0, 1, 0);
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function vectorSnapshot(value: Vector3) {
  return { x: value.x, y: value.y, z: value.z };
}
