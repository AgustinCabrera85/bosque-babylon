import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { HermanoMayorHandle } from "./HermanoMayor";
import { HermanoMayorAudio } from "./HermanoMayorAudio";
import {
  HermanoMayorGrabAttack,
  type HermanoMayorGrabReleaseReason,
} from "./HermanoMayorGrabAttack";
import { HermanoMayorNavigation } from "./HermanoMayorNavigation";

export const HERMANO_MAYOR_VISION_SEGMENT_MULTIPLIER = 1.15;
export const HERMANO_MAYOR_LIGHT_STUN_SECONDS = 1.65;

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
// This is a cinematic hand-off, not a physical reach test. Once the boss is
// near the final safe staging point, framing and IK are allowed to sell the
// remaining distance instead of forcing him against the table collider.
const AXE_CINEMATIC_TRIGGER_DISTANCE = 0.9;
const AXE_APPROACH_STALL_SECONDS = 0.7;
const AXE_APPROACH_STALL_RECOVERY_DISTANCE = 1.55;

export type HermanoMayorBehaviorState =
  | "waiting"
  | "following"
  | "watching"
  | "approaching-axe"
  | "picking-up-axe"
  | "stunned"
  | "grabbing";

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
  private state: HermanoMayorBehaviorState = "waiting";
  private locomotion: "idle" | "walk" = "idle";
  private hasEnteredHouse = false;
  private waitingForVisibleExit = false;
  private engaged = false;
  private armed = false;
  private paused = false;
  private stunRemaining = 0;
  private wasPlayerInside: boolean;
  private nearbyUnseenCooldown = 0;
  private axeCinematicActive = false;
  private axeApproachStallSeconds = 0;
  private axeLastApproachDistance = Number.POSITIVE_INFINITY;
  private axeFinishingApproach = false;
  private readonly axeApproachTarget = Vector3.Zero();
  private readonly axeWalkableApproachTarget = Vector3.Zero();
  private readonly axeGripTarget = Vector3.Zero();

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
      if (!this.engaged) this.waitingForVisibleExit = false;
    } else if (this.hasEnteredHouse && this.wasPlayerInside) {
      this.waitingForVisibleExit = true;
    }
    this.wasPlayerInside = playerInside;

    if (
      !this.engaged &&
      this.waitingForVisibleExit &&
      !playerInside &&
      this.canSeePlayer(player, distance)
    ) {
      this.engaged = true;
      this.waitingForVisibleExit = false;
    }

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
      this.resetAxeApproachProgress();
      this.finishAxeCinematic(true);
    }
    if (
      this.engaged &&
      !this.armed &&
      this.actor.hasAxePickupTarget
    ) {
      if (axeState === "picking-up") {
        this.navigation.clear();
        this.enterState("picking-up-axe");
        return;
      }
      if (this.updateAxeApproach(dt)) return;
    }

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
    this.grabAttack.dispose();
    this.actor.cancelAxePickup();
    this.finishAxeCinematic(false);
    this.audio.dispose();
  }

  public forceGrab() {
    if (this.armed || this.actor.getAxePickupState() !== "unarmed") return false;
    return this.grabAttack.forceGrab();
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
    this.waitingForVisibleExit = false;
    this.navigation.clear();
    if (
      !this.navigation.resolveWalkableGoalToRef(
        this.actor.root.position,
        this.axeApproachTarget,
        this.axeWalkableApproachTarget
      )
    ) {
      return false;
    }
    this.actor.root.position.set(
      this.axeWalkableApproachTarget.x,
      this.options.getGroundHeight(
        this.axeWalkableApproachTarget.x,
        this.axeWalkableApproachTarget.z
      ),
      this.axeWalkableApproachTarget.z
    );
    this.resetAxeApproachProgress();
    // Start deliberately facing away so this helper exercises the same final
    // alignment and transition used by the real walk-to-table flow.
    this.actor.root.rotation.y += Math.PI * 0.5;
    this.enterState("approaching-axe");
    this.updateAxeApproach(1 / 60);
    return this.actor.getAxePickupState() === "picking-up";
  }

  public simulateGrabEscapePress() {
    return this.grabAttack.simulateEscapePress();
  }

  public stun(durationSeconds = HERMANO_MAYOR_LIGHT_STUN_SECONDS) {
    const duration = Math.max(0, durationSeconds);
    if (duration <= 0) return false;
    this.grabAttack.interrupt("stunned");
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
    };
  }

  private enterState(next: HermanoMayorBehaviorState) {
    if (this.state === next) return;
    this.state = next;
    if (next === "following" || next === "approaching-axe") {
      this.setLocomotion("walk");
      this.audio.setBreathing("chase");
      return;
    }
    this.setLocomotion("idle");
    this.audio.setBreathing(next === "grabbing" ? "chase" : "idle");
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

  private updateAxeApproach(dt: number) {
    if (!this.actor.getAxeApproachPositionToRef(this.axeApproachTarget)) {
      this.resetAxeApproachProgress();
      return false;
    }
    const root = this.actor.root;
    if (
      !this.navigation.resolveWalkableGoalToRef(
        root.position,
        this.axeApproachTarget,
        this.axeWalkableApproachTarget
      )
    ) {
      this.navigation.clear();
      this.enterState("watching");
      return true;
    }
    const distance = Math.hypot(
      this.axeWalkableApproachTarget.x - root.position.x,
      this.axeWalkableApproachTarget.z - root.position.z
    );
    if (distance + 0.02 < this.axeLastApproachDistance) {
      this.axeApproachStallSeconds = 0;
    } else {
      this.axeApproachStallSeconds += dt;
    }
    this.axeLastApproachDistance = distance;

    if (distance > AXE_CINEMATIC_TRIGGER_DISTANCE) {
      if (
        !this.axeFinishingApproach &&
        this.axeApproachStallSeconds >= AXE_APPROACH_STALL_SECONDS &&
        distance <= AXE_APPROACH_STALL_RECOVERY_DISTANCE &&
        !this.options.isBlocked(
          this.axeWalkableApproachTarget.x,
          this.axeWalkableApproachTarget.z
        )
      ) {
        // The A* grid and the boss clearance can disagree by a fraction of a
        // cell beside authored props. Once the final target itself is safe,
        // finish this short walk directly instead of idling forever nearby.
        this.axeFinishingApproach = true;
        this.navigation.clear();
      }
      if (this.axeFinishingApproach) {
        this.enterState("approaching-axe");
        this.moveDirectlyTowardAxe(
          this.axeWalkableApproachTarget,
          distance,
          dt
        );
        return true;
      }

      const steeringTarget = this.navigation.getSteeringTarget(
        root.position,
        this.axeWalkableApproachTarget,
        dt
      );
      if (steeringTarget) {
        this.enterState("approaching-axe");
        this.moveToward(
          steeringTarget,
          distance,
          dt,
          AXE_CINEMATIC_TRIGGER_DISTANCE
        );
      } else {
        this.navigation.clear();
        this.enterState("watching");
      }
      return true;
    }

    this.resetAxeApproachProgress();
    this.navigation.clear();
    this.enterState("picking-up-axe");
    if (!this.actor.getAxeGripPositionToRef(this.axeGripTarget)) return true;
    // Entering the nearby staging radius is enough for this cinematic. Align
    // once toward the prop and use the camera cut to place the actor on the
    // authored safe mark. This keeps navigation forgiving while giving the IK
    // enough real arm length to put the palm visibly on the handle.
    const cinematicStagingTarget = this.options.isBlocked(
      this.axeApproachTarget.x,
      this.axeApproachTarget.z
    )
      ? this.axeWalkableApproachTarget
      : this.axeApproachTarget;
    root.position.x = cinematicStagingTarget.x;
    root.position.z = cinematicStagingTarget.z;
    root.position.y = this.options.getGroundHeight(
      cinematicStagingTarget.x,
      cinematicStagingTarget.z
    );
    this.faceTargetImmediately(this.axeGripTarget);
    this.startAxePickupAtTable();
    return true;
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

  private moveDirectlyTowardAxe(
    target: Vector3,
    distance: number,
    dt: number
  ) {
    const root = this.actor.root;
    if (distance <= 0.001) return;
    const directionX = (target.x - root.position.x) / distance;
    const directionZ = (target.z - root.position.z) / distance;
    root.rotationQuaternion = null;
    root.rotation.y = Math.atan2(directionX, directionZ);
    const step = Math.min(
      Math.max(0, distance - AXE_CINEMATIC_TRIGGER_DISTANCE),
      WALK_SPEED * dt
    );
    root.position.x += directionX * step;
    root.position.z += directionZ * step;
    root.position.y = this.options.getGroundHeight(root.position.x, root.position.z);
  }

  private resetAxeApproachProgress() {
    this.axeApproachStallSeconds = 0;
    this.axeLastApproachDistance = Number.POSITIVE_INFINITY;
    this.axeFinishingApproach = false;
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

    const nextX = root.position.x + directionX * step;
    const nextZ = root.position.z + directionZ * step;
    let moved = false;
    if (!this.options.isBlocked(nextX, nextZ)) {
      root.position.x = nextX;
      root.position.z = nextZ;
      moved = true;
    } else if (!this.options.isBlocked(nextX, root.position.z)) {
      root.position.x = nextX;
      moved = true;
    } else if (!this.options.isBlocked(root.position.x, nextZ)) {
      root.position.z = nextZ;
      moved = true;
    }

    if (!moved) return;
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
