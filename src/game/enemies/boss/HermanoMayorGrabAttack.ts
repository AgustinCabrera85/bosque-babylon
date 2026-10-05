import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { HermanoMayorHandle } from "./HermanoMayor";
import type { HermanoMayorNeckGrabPoseState } from "./HermanoMayorNeckGrabAction";

export type HermanoMayorGrabState =
  | "idle"
  | "windup"
  | "lifting"
  | "holding"
  | "releasing"
  | "cooldown";

export type HermanoMayorGrabReleaseReason =
  | "escaped"
  | "missed"
  | "player-unavailable"
  | "stunned"
  | "disposed";

export type HermanoMayorGrabAttackOptions = {
  actor: HermanoMayorHandle;
  playerPosition: () => Vector3;
  playerNeckPosition: () => Vector3;
  canCapturePlayer: () => boolean;
  wasEscapePressed: () => boolean;
  setVictimPose: (
    active: boolean,
    attackerPosition: Vector3,
    lift: number,
    escapeProgress: number
  ) => void;
  setEscapeHud: (active: boolean, progress: number) => void;
  onGrabStarted: () => void;
  onGrabDamage: (
    fractionOfMaxHealth: number,
    kind: "initial" | "squeeze"
  ) => void;
  onGrabEnded?: (reason: HermanoMayorGrabReleaseReason) => void;
};

const GRAB_START_DISTANCE = 1.55;
const GRAB_BREAK_DISTANCE = 2.15;
const GRAB_HOLD_DISTANCE = 0.92;
const GRAB_CAPTURE_DISTANCE = 1.02;
const GRAB_LUNGE_SPEED = 3.1;
const WINDUP_SECONDS = 0.48;
const LIFT_SECONDS = 0.58;
const RELEASE_SECONDS = 0.44;
const COOLDOWN_SECONDS = 4.8;
const SQUEEZE_INTERVAL_SECONDS = 1;
const ESCAPE_PROGRESS_PER_PRESS = 0.16;
const ESCAPE_PROGRESS_DECAY_PER_SECOND = 0.22;
const INITIAL_GRAB_DAMAGE_FRACTION = 0.05;
const SQUEEZE_DAMAGE_FRACTION = 0.07;
const MAX_GRAB_DAMAGE_FRACTION = 0.4;
const FACE_TURN_SPEED = (320 * Math.PI) / 180;

/** Combat lifecycle for the Hermano Mayor's neck-grab attack. */
export class HermanoMayorGrabAttack {
  private state: HermanoMayorGrabState = "idle";
  private stateElapsed = 0;
  private cooldownRemaining = 1.2;
  private squeezeTimer = 0;
  private escapePresses = 0;
  private escapeProgress = 0;
  private grabDamageFraction = 0;
  private captured = false;
  private disposed = false;
  private forceRequested = false;
  private simulatedEscapePresses = 0;
  private readonly actorPose: HermanoMayorNeckGrabPoseState = {
    reach: 0,
    lift: 0,
    victimStruggle: 0,
    shake: 0,
    targetPosition: Vector3.Zero(),
  };

  public constructor(private readonly options: HermanoMayorGrabAttackOptions) {}

  public get currentState() {
    return this.state;
  }

  public get isRestrainingPlayer() {
    return this.captured && (this.state === "lifting" || this.state === "holding");
  }

  public update(deltaSeconds: number, eligible: boolean, playerDistance: number) {
    if (this.disposed) return false;
    const dt = Math.max(0, Math.min(deltaSeconds, 0.05));
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    this.stateElapsed += dt;

    if (this.state === "idle") {
      if (
        (this.forceRequested || eligible) &&
        this.cooldownRemaining <= 0 &&
        (this.forceRequested || playerDistance <= GRAB_START_DISTANCE)
      ) {
        this.forceRequested = false;
        this.beginWindup();
        return true;
      }
      return false;
    }

    if (this.state === "cooldown") {
      if (this.cooldownRemaining <= 0) this.enterState("idle");
      return false;
    }

    this.facePlayer(dt);
    if (!this.options.canCapturePlayer() && this.state !== "releasing") {
      this.beginRelease("player-unavailable");
    }

    if (this.state === "windup") {
      if (playerDistance > GRAB_BREAK_DISTANCE) {
        this.beginRelease("missed");
      } else {
        const reachedGrabRange = this.moveIntoGrabRange(dt);
        const progress = smoothStep(this.stateElapsed / WINDUP_SECONDS);
        this.setActorPose(progress, 0, 0, 0);
        if (this.stateElapsed >= WINDUP_SECONDS && reachedGrabRange) {
          this.capturePlayer();
        }
      }
      return true;
    }

    if (this.state === "lifting") {
      this.updateEscape(dt);
      if (this.escapeProgress >= 1) {
        this.beginRelease("escaped");
        return true;
      }
      const lift = smoothStep(this.stateElapsed / LIFT_SECONDS);
      this.setActorPose(1, lift, this.escapeProgress, lift);
      this.updateVictim(lift);
      if (this.stateElapsed >= LIFT_SECONDS) {
        this.squeezeTimer = 0;
        this.enterState("holding");
      }
      return true;
    }

    if (this.state === "holding") {
      this.updateEscape(dt);
      if (this.escapeProgress >= 1) {
        this.beginRelease("escaped");
        return true;
      }
      this.squeezeTimer += dt;
      while (this.squeezeTimer >= SQUEEZE_INTERVAL_SECONDS) {
        this.squeezeTimer -= SQUEEZE_INTERVAL_SECONDS;
        this.applyGrabDamage("squeeze");
        // Lethal damage may synchronously interrupt this attack through the
        // player-death callback. Do not reapply the choke pose afterward.
        if (this.state !== "holding" || !this.captured) return true;
      }
      this.setActorPose(1, 1, this.escapeProgress, 1);
      this.updateVictim(1);
      return true;
    }

    const releaseProgress = smoothStep(this.stateElapsed / RELEASE_SECONDS);
    this.setActorPose(
      1 - releaseProgress,
      1 - releaseProgress,
      0,
      1 - releaseProgress
    );
    if (this.stateElapsed >= RELEASE_SECONDS) this.finishRelease();
    return true;
  }

  public forceGrab() {
    if (this.disposed) return false;
    this.forceRequested = true;
    this.cooldownRemaining = 0;
    return true;
  }

  public interrupt(reason: HermanoMayorGrabReleaseReason = "stunned") {
    if (this.disposed) return false;
    const wasActive = this.state !== "idle" && this.state !== "cooldown";
    this.forceRequested = false;
    if (this.captured) this.releaseVictim(reason);
    this.options.actor.setNeckGrabPose(null);
    this.cooldownRemaining = COOLDOWN_SECONDS;
    this.enterState("cooldown");
    return wasActive;
  }

  public simulateEscapePress() {
    if (!this.isRestrainingPlayer) return false;
    this.simulatedEscapePresses++;
    return true;
  }

  public getDebugSnapshot() {
    return {
      state: this.state,
      stateElapsed: this.stateElapsed,
      cooldownRemaining: this.cooldownRemaining,
      captured: this.captured,
      escapePresses: this.escapePresses,
      escapeProgress: this.escapeProgress,
      escapeProgressPerPress: ESCAPE_PROGRESS_PER_PRESS,
      escapeDecayPerSecond: ESCAPE_PROGRESS_DECAY_PER_SECOND,
      grabDamageFraction: this.grabDamageFraction,
      maxGrabDamageFraction: MAX_GRAB_DAMAGE_FRACTION,
      attackerPose: {
        reach: this.actorPose.reach,
        lift: this.actorPose.lift,
        victimStruggle: this.actorPose.victimStruggle,
        shake: this.actorPose.shake,
        targetPosition: {
          x: this.actorPose.targetPosition.x,
          y: this.actorPose.targetPosition.y,
          z: this.actorPose.targetPosition.z,
        },
      },
      rig: this.options.actor.getNeckGrabDebugSnapshot(),
    };
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.captured) this.releaseVictim("disposed");
    this.options.actor.setNeckGrabPose(null);
  }

  private beginWindup() {
    this.captured = false;
    this.escapePresses = 0;
    this.escapeProgress = 0;
    this.grabDamageFraction = 0;
    this.simulatedEscapePresses = 0;
    this.squeezeTimer = 0;
    this.options.setEscapeHud(false, 0);
    this.enterState("windup");
    this.setActorPose(0, 0, 0, 0);
  }

  private capturePlayer() {
    if (!this.options.canCapturePlayer()) {
      this.beginRelease("player-unavailable");
      return;
    }
    this.captured = true;
    this.escapePresses = 0;
    this.escapeProgress = 0;
    this.grabDamageFraction = 0;
    this.options.onGrabStarted();
    this.applyGrabDamage("initial");
    // onGrabDamage may synchronously begin the death sequence and interrupt
    // the grab. Respect that new state instead of resurrecting the hold.
    if (!this.captured || this.state !== "windup") return;
    this.options.setEscapeHud(true, 0);
    this.enterState("lifting");
    this.updateVictim(0);
  }

  private updateEscape(dt: number) {
    if (!this.captured) return;
    this.escapeProgress = Math.max(
      0,
      this.escapeProgress - ESCAPE_PROGRESS_DECAY_PER_SECOND * dt
    );
    const simulated = this.simulatedEscapePresses > 0;
    if (simulated || this.options.wasEscapePressed()) {
      if (simulated) this.simulatedEscapePresses--;
      this.escapePresses++;
      this.escapeProgress = Math.min(
        1,
        this.escapeProgress + ESCAPE_PROGRESS_PER_PRESS
      );
    }
    this.options.setEscapeHud(true, this.escapeProgress);
  }

  private applyGrabDamage(kind: "initial" | "squeeze") {
    const requested =
      kind === "initial"
        ? INITIAL_GRAB_DAMAGE_FRACTION
        : SQUEEZE_DAMAGE_FRACTION;
    const applied = Math.min(
      requested,
      MAX_GRAB_DAMAGE_FRACTION - this.grabDamageFraction
    );
    if (applied <= 0) return;
    this.grabDamageFraction += applied;
    this.options.onGrabDamage(applied, kind);
  }

  private updateVictim(lift: number) {
    this.options.setVictimPose(
      true,
      this.options.actor.root.position,
      lift,
      this.escapeProgress
    );
  }

  private beginRelease(reason: HermanoMayorGrabReleaseReason) {
    if (this.state === "releasing" || this.state === "cooldown") return;
    if (this.captured) this.releaseVictim(reason);
    this.enterState("releasing");
  }

  private releaseVictim(reason: HermanoMayorGrabReleaseReason) {
    this.captured = false;
    this.options.setVictimPose(
      false,
      this.options.actor.root.position,
      0,
      this.escapeProgress
    );
    this.options.setEscapeHud(false, this.escapeProgress);
    this.options.onGrabEnded?.(reason);
  }

  private finishRelease() {
    this.options.actor.setNeckGrabPose(null);
    this.cooldownRemaining = COOLDOWN_SECONDS;
    this.enterState("cooldown");
  }

  private setActorPose(
    reach: number,
    lift: number,
    victimStruggle: number,
    shake: number
  ) {
    this.actorPose.reach = clamp01(reach);
    this.actorPose.lift = clamp01(lift);
    this.actorPose.victimStruggle = clamp01(victimStruggle);
    this.actorPose.shake = clamp01(shake);
    this.actorPose.targetPosition.copyFrom(this.options.playerNeckPosition());
    this.options.actor.setNeckGrabPose(this.actorPose);
  }

  private facePlayer(dt: number) {
    const player = this.options.playerPosition();
    const root = this.options.actor.root;
    const dx = player.x - root.position.x;
    const dz = player.z - root.position.z;
    if (Math.hypot(dx, dz) <= 0.001) return;
    const desiredYaw = Math.atan2(dx, dz);
    const delta = shortestAngle(root.rotation.y, desiredYaw);
    const maxTurn = FACE_TURN_SPEED * dt;
    root.rotation.y += Math.max(-maxTurn, Math.min(maxTurn, delta));
  }

  private moveIntoGrabRange(dt: number) {
    const player = this.options.playerPosition();
    const root = this.options.actor.root;
    const dx = player.x - root.position.x;
    const dz = player.z - root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= GRAB_HOLD_DISTANCE || distance <= 0.001) {
      return distance <= GRAB_CAPTURE_DISTANCE;
    }
    const step = Math.min(
      distance - GRAB_HOLD_DISTANCE,
      GRAB_LUNGE_SPEED * dt
    );
    root.position.x += (dx / distance) * step;
    root.position.z += (dz / distance) * step;
    return distance - step <= GRAB_CAPTURE_DISTANCE;
  }

  private enterState(next: HermanoMayorGrabState) {
    this.state = next;
    this.stateElapsed = 0;
  }
}

function shortestAngle(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothStep(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}
