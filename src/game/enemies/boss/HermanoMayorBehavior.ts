import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { HermanoMayorHandle } from "./HermanoMayor";
import { HermanoMayorAudio } from "./HermanoMayorAudio";
import {
  HermanoMayorGrabAttack,
  type HermanoMayorGrabReleaseReason,
} from "./HermanoMayorGrabAttack";
import { HermanoMayorAxeAttack } from "./HermanoMayorAxeAttack";
import type { HermanoMayorAxeDodgePromptState } from "./HermanoMayorAxeAttack";
import { HermanoMayorNavigation } from "./HermanoMayorNavigation";

export const HERMANO_MAYOR_VISION_SEGMENT_MULTIPLIER = 1.15;
export const HERMANO_MAYOR_LIGHT_STUN_SECONDS = 1.65;
export const HERMANO_MAYOR_AXE_PICKUP_TRIGGER_RADIUS = 2.5;

const VISION_HALF_ANGLE = (78 * Math.PI) / 180;
const UNARMED_STOP_DISTANCE = 1.35;
const UNARMED_RESUME_DISTANCE = 1.85;
const ARMED_STOP_DISTANCE = 1.28;
const ARMED_RESUME_DISTANCE = 1.78;
const WALK_SPEED = 1.72;
const TURN_SPEED = (125 * Math.PI) / 180;
const WALK_SPEED_RATIO = 0.88;
const ANIMATION_BLEND_SPEED = 0.09;
const NEARBY_UNSEEN_DISTANCE = 13;
const NEARBY_UNSEEN_COOLDOWN = 18;

export type HermanoMayorBehaviorState =
  | "waiting"
  | "following"
  | "watching"
  | "picking-up-axe"
  | "stunned"
  | "grabbing"
  | "attacking";

export type HermanoMayorBehaviorOptions = {
  actor: HermanoMayorHandle;
  playerPosition: () => Vector3;
  playerNeckPosition: () => Vector3;
  houseBounds: { min: Vector3; max: Vector3 };
  visionRange: number;
  getGroundHeight: (x: number, z: number) => number;
  isBlocked: (x: number, z: number) => boolean;
  hasLineOfSight: (origin: Vector3, target: Vector3) => boolean;
  isVisibleToPlayer: () => boolean;
  getSfxVolume?: () => number;
  canGrabPlayer: () => boolean;
  wasGrabEscapePressed: () => boolean;
  setGrabVictimPose: (
    active: boolean,
    attackerPosition: Vector3,
    lift: number,
    escapeProgress: number
  ) => void;
  setGrabEscapeHud: (active: boolean, progress: number) => void;
  onGrabStarted: () => void;
  onGrabDamage: (
    fractionOfMaxHealth: number,
    kind: "initial" | "squeeze"
  ) => void;
  onAxeDamage?: (fractionOfMaxHealth: number) => void;
  onAxeDodged?: () => void;
  getPlayerSanity?: () => number;
  wasAxeDodgePressed?: () => boolean;
  setAxeDodgePrompt?: (
    state: HermanoMayorAxeDodgePromptState,
    remaining: number,
    sanity: number
  ) => void;
  onGrabEnded?: (reason: HermanoMayorGrabReleaseReason) => void;
  beginAxePickupCinematic?: () => boolean;
  endAxePickupCinematic?: (completed: boolean) => void;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function shortestAngle(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** Boss-owned perception and locomotion state machine. */
export class HermanoMayorBehavior {
  private readonly actor: HermanoMayorHandle;
  private readonly audio: HermanoMayorAudio;
  private readonly navigation: HermanoMayorNavigation;
  private readonly grabAttack: HermanoMayorGrabAttack;
  private readonly axeAttack: HermanoMayorAxeAttack;
  private state: HermanoMayorBehaviorState = "waiting";
  private locomotion: "idle" | "walk" = "idle";
  private hasEnteredHouse = false;
  private engaged = false;
  private armed = false;
  private paused = false;
  private stunRemaining = 0;
  private wasPlayerInside: boolean;
  private nearbyUnseenCooldown = 0;
  private axeCinematicActive = false;
  private readonly axeApproachTarget = Vector3.Zero();
  private readonly axeWalkableApproachTarget = Vector3.Zero();
  private readonly axeGripTarget = Vector3.Zero();
  private readonly axeTableCenter = Vector3.Zero();

  private readonly onPause = (event: Event) => {
    const detail = (event as CustomEvent<{ paused?: boolean }>).detail;
    this.paused = detail?.paused === true;
  };

  public constructor(private readonly options: HermanoMayorBehaviorOptions) {
    this.actor = options.actor;
    this.wasPlayerInside = this.isPlayerInside(options.playerPosition());
    this.audio = new HermanoMayorAudio({ getSfxVolume: options.getSfxVolume });
    this.navigation = new HermanoMayorNavigation({ isBlocked: options.isBlocked });
    this.grabAttack = new HermanoMayorGrabAttack({
      actor: options.actor,
      playerPosition: options.playerPosition,
      playerNeckPosition: options.playerNeckPosition,
      canCapturePlayer: options.canGrabPlayer,
      wasEscapePressed: options.wasGrabEscapePressed,
      setVictimPose: options.setGrabVictimPose,
      setEscapeHud: options.setGrabEscapeHud,
      onGrabStarted: options.onGrabStarted,
      onGrabDamage: options.onGrabDamage,
      onGrabEnded: options.onGrabEnded,
    });
    this.axeAttack = new HermanoMayorAxeAttack({
      actor: options.actor,
      playerPosition: options.playerPosition,
      playerNeckPosition: options.playerNeckPosition,
      canHitPlayer: options.canGrabPlayer,
      onAxeDamage: options.onAxeDamage ?? (() => {}),
      onAxeDodged: options.onAxeDodged,
      getPlayerSanity: options.getPlayerSanity,
      wasDodgePressed: options.wasAxeDodgePressed,
      setDodgePrompt: options.setAxeDodgePrompt,
    });
    this.audio.setBreathing("idle");
    this.actor.setLookTargetProvider(options.playerPosition);
    window.addEventListener("bosque:pause", this.onPause);
  }

  public get currentState() {
    return this.state;
  }

  /** Switches the pursuit spacing used while the axe is equipped. */
  public setArmed(armed: boolean) {
    this.armed = armed;
    if (!armed) this.axeAttack.interrupt();
  }

  /** Plays the nearby/off-camera cue immediately for authored sightings. */
  public playNearbyUnseenCue() {
    this.audio.setAudibility(1);
    this.audio.requestNearbyUnseen();
    this.audio.update(0);
  }

  public update(deltaSeconds: number) {
    const dt = Math.max(0, Math.min(deltaSeconds, 0.05));
    const player = this.options.playerPosition();
    const dx = player.x - this.actor.root.position.x;
    const dz = player.z - this.actor.root.position.z;
    const distance = Math.hypot(dx, dz);

    const audioRadius = this.state === "following" ? 36 : 24;
    this.audio.setAudibility(1 - smoothstep(5, audioRadius, distance));
    this.audio.update(dt);
    if (this.paused) return;

    this.stunRemaining = Math.max(0, this.stunRemaining - dt);
    if (this.stunRemaining > 0) {
      if (this.actor.getAxePickupState() === "picking-up") {
        this.actor.cancelAxePickup();
        this.finishAxeCinematic(false);
        this.armed = this.actor.hasAxe;
      }
      this.navigation.clear();
      this.enterState("stunned");
      return;
    }

    const playerInside = this.isPlayerInside(player);
    if (playerInside) {
      this.hasEnteredHouse = true;
    } else if (this.hasEnteredHouse && this.wasPlayerInside) {
      // Leaving the house starts the hunt immediately. From this point the
      // boss follows the player even if the doorway briefly occludes them.
      this.engaged = true;
    }
    this.wasPlayerInside = playerInside;

    this.nearbyUnseenCooldown = Math.max(0, this.nearbyUnseenCooldown - dt);
    if (
      this.engaged &&
      distance <= NEARBY_UNSEEN_DISTANCE &&
      this.nearbyUnseenCooldown <= 0 &&
      !this.options.isVisibleToPlayer()
    ) {
      this.audio.requestNearbyUnseen();
      this.nearbyUnseenCooldown = NEARBY_UNSEEN_COOLDOWN;
    }

    const axeState = this.actor.getAxePickupState();
    if (axeState === "armed") {
      this.armed = true;
      this.finishAxeCinematic(true);
    }
    if (axeState === "picking-up") {
      this.navigation.clear();
      this.enterState("picking-up-axe");
      return;
    }

    const axeAttackOwnsMovement = this.axeAttack.update(
      dt,
      this.engaged && this.armed && this.canSeePlayer(player, distance),
      distance
    );
    if (axeAttackOwnsMovement) {
      this.navigation.clear();
      this.enterState("attacking");
      return;
    }

    // Grabbing the player remains the unarmed boss's first priority. The axe
    // is only noticed after no grab action owns this frame.
    const grabOwnsMovement = this.grabAttack.update(
      dt,
      this.engaged && !this.armed && this.canSeePlayer(player, distance),
      distance
    );
    if (grabOwnsMovement) {
      this.navigation.clear();
      this.enterState("grabbing");
      return;
    }

    if (
      this.engaged &&
      !this.armed &&
      this.actor.hasAxePickupTarget &&
      this.tryStartVisibleAxePickup()
    ) {
      return;
    }

    if (!this.engaged || distance > this.options.visionRange) {
      this.navigation.clear();
      this.enterState(this.engaged ? "watching" : "waiting");
      return;
    }

    const stopDistance = this.armed
      ? ARMED_STOP_DISTANCE
      : UNARMED_STOP_DISTANCE;
    const resumeDistance = this.armed
      ? ARMED_RESUME_DISTANCE
      : UNARMED_RESUME_DISTANCE;
    const shouldRemainWatching =
      distance <= stopDistance ||
      (this.state === "watching" && distance < resumeDistance);

    if (shouldRemainWatching) {
      this.navigation.clear();
      this.enterState("watching");
      return;
    }

    const steeringTarget = this.navigation.getSteeringTarget(
      this.actor.root.position,
      player,
      dt
    );
    if (!steeringTarget) {
      this.enterState("watching");
      return;
    }
    this.enterState("following");
    this.moveToward(steeringTarget, distance, dt, stopDistance);
  }

  public dispose() {
    window.removeEventListener("bosque:pause", this.onPause);
    this.axeAttack.dispose();
    this.grabAttack.dispose();
    this.actor.cancelAxePickup();
    this.finishAxeCinematic(false);
    this.audio.dispose();
  }

  public forceGrab() {
    if (this.armed || this.actor.getAxePickupState() !== "unarmed") return false;
    return this.grabAttack.forceGrab();
  }

  public forceAxeAttack() {
    if (!this.armed || !this.actor.hasAxe) return false;
    return this.axeAttack.forceAttack();
  }

  /** Development helper: places the boss at the table and lets the real state machine start the pickup. */
  public forceAxePickup() {
    if (
      this.armed ||
      this.actor.getAxePickupState() !== "unarmed" ||
      !this.actor.getAxeApproachPositionToRef(this.axeApproachTarget)
    ) {
      return false;
    }
    this.grabAttack.interrupt("stunned");
    this.stunRemaining = 0;
    this.engaged = true;
    this.navigation.clear();
    if (!this.actor.getAxeGripPositionToRef(this.axeGripTarget)) return false;
    if (!this.stageActorForAxePickup()) return false;
    this.faceTargetImmediately(this.axeGripTarget);
    this.enterState("picking-up-axe");
    return this.startAxePickupAtTable();
  }

  public simulateGrabEscapePress() {
    return this.grabAttack.simulateEscapePress();
  }

  public stun(durationSeconds = HERMANO_MAYOR_LIGHT_STUN_SECONDS) {
    const duration = Math.max(0, durationSeconds);
    if (duration <= 0) return false;
    this.grabAttack.interrupt("stunned");
    this.axeAttack.interrupt();
    if (this.actor.getAxePickupState() === "picking-up") {
      this.actor.cancelAxePickup();
      this.finishAxeCinematic(false);
      this.armed = this.actor.hasAxe;
    }
    this.stunRemaining = Math.max(this.stunRemaining, duration);
    this.navigation.clear();
    this.enterState("stunned");
    return true;
  }

  public getGrabDebugSnapshot() {
    const grab = this.grabAttack.getDebugSnapshot();
    return {
      ...grab,
      axe: this.actor.getAxePickupDebugSnapshot(),
      axeAttack: this.axeAttack.getDebugSnapshot(),
      navigation: this.navigation.getDebugSnapshot(),
    };
  }

  private enterState(next: HermanoMayorBehaviorState) {
    if (this.state === next) return;
    this.state = next;
    if (next === "following") {
      this.setLocomotion("walk");
      this.audio.setBreathing("chase");
      return;
    }
    this.setLocomotion("idle");
    this.audio.setBreathing(
      next === "grabbing" || next === "attacking" ? "chase" : "idle"
    );
  }

  private setLocomotion(next: "idle" | "walk") {
    if (this.locomotion === next) return;
    this.locomotion = next;
    this.actor.playLocomotion(next, {
      loop: true,
      speedRatio: next === "walk" ? WALK_SPEED_RATIO : 1,
      blendingSpeed: ANIMATION_BLEND_SPEED,
    });
  }

  private tryStartVisibleAxePickup() {
    if (
      !this.actor.getAxePickupTableCenterPositionToRef(this.axeTableCenter) ||
      !this.actor.getAxeGripPositionToRef(this.axeGripTarget)
    ) {
      return false;
    }

    const root = this.actor.root;
    const tableDistance = Math.hypot(
      this.axeTableCenter.x - root.position.x,
      this.axeTableCenter.z - root.position.z
    );
    if (tableDistance > HERMANO_MAYOR_AXE_PICKUP_TRIGGER_RADIUS) return false;
    if (!this.canSeeAxe(this.axeGripTarget)) return false;
    if (!this.stageActorForAxePickup()) return false;

    this.navigation.clear();
    this.faceTargetImmediately(this.axeGripTarget);
    this.enterState("picking-up-axe");
    return this.startAxePickupAtTable();
  }

  private stageActorForAxePickup() {
    if (!this.actor.getAxeApproachPositionToRef(this.axeApproachTarget)) {
      return false;
    }

    let stagingTarget = this.axeApproachTarget;
    if (
      this.options.isBlocked(
        this.axeApproachTarget.x,
        this.axeApproachTarget.z
      )
    ) {
      if (
        !this.navigation.resolveWalkableGoalToRef(
          this.actor.root.position,
          this.axeApproachTarget,
          this.axeWalkableApproachTarget
        )
      ) {
        return false;
      }
      stagingTarget = this.axeWalkableApproachTarget;
    }

    this.actor.root.position.set(
      stagingTarget.x,
      this.options.getGroundHeight(stagingTarget.x, stagingTarget.z),
      stagingTarget.z
    );
    return true;
  }

  private canSeeAxe(target: Vector3) {
    const root = this.actor.root;
    const dx = target.x - root.position.x;
    const dz = target.z - root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.001) return true;

    const yaw = root.rotation.y;
    const facingDot =
      Math.sin(yaw) * (dx / distance) +
      Math.cos(yaw) * (dz / distance);
    if (facingDot < Math.cos(VISION_HALF_ANGLE)) return false;

    const origin = new Vector3(
      root.position.x,
      root.position.y + 2.15,
      root.position.z
    );
    return this.options.hasLineOfSight(origin, target);
  }

  private startAxePickupAtTable() {
    if (this.axeCinematicActive) return true;
    if (this.options.beginAxePickupCinematic?.() === false) return false;
    this.axeCinematicActive = true;
    if (this.actor.startAxePickup()) return true;
    this.finishAxeCinematic(false);
    return false;
  }

  private faceTargetImmediately(target: Vector3) {
    const root = this.actor.root;
    const dx = target.x - root.position.x;
    const dz = target.z - root.position.z;
    if (Math.hypot(dx, dz) <= 0.001) return;
    root.rotationQuaternion = null;
    root.rotation.y = Math.atan2(dx, dz);
  }

  private finishAxeCinematic(completed: boolean) {
    if (!this.axeCinematicActive) return;
    this.axeCinematicActive = false;
    this.options.endAxePickupCinematic?.(completed);
  }

  private canSeePlayer(player: Vector3, distance: number) {
    if (distance > this.options.visionRange || distance <= 0.001) return false;

    const dx = (player.x - this.actor.root.position.x) / distance;
    const dz = (player.z - this.actor.root.position.z) / distance;
    const yaw = this.actor.root.rotation.y;
    const facingDot = Math.sin(yaw) * dx + Math.cos(yaw) * dz;
    if (facingDot < Math.cos(VISION_HALF_ANGLE)) return false;

    const origin = new Vector3(
      this.actor.root.position.x,
      this.actor.root.position.y + 2.15,
      this.actor.root.position.z
    );
    const target = new Vector3(player.x, player.y + 1.25, player.z);
    return this.options.hasLineOfSight(origin, target);
  }

  private moveToward(
    steeringTarget: Vector3,
    playerDistance: number,
    deltaSeconds: number,
    stopDistance: number
  ) {
    const root = this.actor.root;
    const steeringDistance = Math.hypot(
      steeringTarget.x - root.position.x,
      steeringTarget.z - root.position.z
    );
    if (steeringDistance <= 0.001) return;
    const directionX = (steeringTarget.x - root.position.x) / steeringDistance;
    const directionZ = (steeringTarget.z - root.position.z) / steeringDistance;
    const desiredYaw = Math.atan2(directionX, directionZ);
    const yawDelta = shortestAngle(root.rotation.y, desiredYaw);
    const maxTurn = TURN_SPEED * deltaSeconds;
    root.rotation.y += Math.max(-maxTurn, Math.min(maxTurn, yawDelta));

    const remainingYaw = Math.abs(shortestAngle(root.rotation.y, desiredYaw));
    const alignment = Math.max(0.28, Math.cos(remainingYaw));
    const step = Math.min(
      Math.max(0, playerDistance - stopDistance),
      steeringDistance,
      WALK_SPEED * alignment * deltaSeconds
    );
    if (step <= 0) return;

    const startX = root.position.x;
    const startZ = root.position.z;
    const nextX = root.position.x + directionX * step;
    const nextZ = root.position.z + directionZ * step;
    if (!this.options.isBlocked(nextX, nextZ)) {
      root.position.x = nextX;
      root.position.z = nextZ;
    } else if (
      Math.abs(nextX - root.position.x) > 0.0001 &&
      !this.options.isBlocked(nextX, root.position.z)
    ) {
      root.position.x = nextX;
    } else if (
      Math.abs(nextZ - root.position.z) > 0.0001 &&
      !this.options.isBlocked(root.position.x, nextZ)
    ) {
      root.position.z = nextZ;
    }

    const movedDistance = Math.hypot(
      root.position.x - startX,
      root.position.z - startZ
    );
    this.navigation.reportMovementResult(
      root.position,
      steeringTarget,
      movedDistance,
      deltaSeconds
    );
    if (movedDistance <= 0.002) return;
    const groundY = this.options.getGroundHeight(root.position.x, root.position.z);
    const groundBlend = Math.min(1, deltaSeconds * 8);
    root.position.y += (groundY - root.position.y) * groundBlend;
  }

  private isPlayerInside(player: Vector3) {
    const { min, max } = this.options.houseBounds;
    const inset = 0.3;
    return (
      player.x >= min.x + inset &&
      player.x <= max.x - inset &&
      player.z >= min.z + inset &&
      player.z <= max.z - inset
    );
  }
}
