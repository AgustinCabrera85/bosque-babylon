import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { HermanoMayorHandle } from "./HermanoMayor";
import { HermanoMayorAudio } from "./HermanoMayorAudio";
import { HermanoMayorNavigation } from "./HermanoMayorNavigation";

export const HERMANO_MAYOR_VISION_SEGMENT_MULTIPLIER = 1.15;

const VISION_HALF_ANGLE = (78 * Math.PI) / 180;
const UNARMED_STOP_DISTANCE = 3.4;
const UNARMED_RESUME_DISTANCE = 4.6;
const WALK_SPEED = 1.72;
const TURN_SPEED = (125 * Math.PI) / 180;
const WALK_SPEED_RATIO = 0.88;
const ANIMATION_BLEND_SPEED = 0.09;
const NEARBY_UNSEEN_DISTANCE = 13;
const NEARBY_UNSEEN_COOLDOWN = 18;

export type HermanoMayorBehaviorState = "waiting" | "following" | "watching";

export type HermanoMayorBehaviorOptions = {
  actor: HermanoMayorHandle;
  playerPosition: () => Vector3;
  houseBounds: { min: Vector3; max: Vector3 };
  visionRange: number;
  getGroundHeight: (x: number, z: number) => number;
  isBlocked: (x: number, z: number) => boolean;
  hasLineOfSight: (origin: Vector3, target: Vector3) => boolean;
  isVisibleToPlayer: () => boolean;
  getSfxVolume?: () => number;
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
  private state: HermanoMayorBehaviorState = "waiting";
  private locomotion: "idle" | "walk" = "idle";
  private hasEnteredHouse = false;
  private waitingForVisibleExit = false;
  private engaged = false;
  private armed = false;
  private paused = false;
  private wasPlayerInside: boolean;
  private nearbyUnseenCooldown = 0;

  private readonly onPause = (event: Event) => {
    const detail = (event as CustomEvent<{ paused?: boolean }>).detail;
    this.paused = detail?.paused === true;
  };

  public constructor(private readonly options: HermanoMayorBehaviorOptions) {
    this.actor = options.actor;
    this.wasPlayerInside = this.isPlayerInside(options.playerPosition());
    this.audio = new HermanoMayorAudio({ getSfxVolume: options.getSfxVolume });
    this.navigation = new HermanoMayorNavigation({ isBlocked: options.isBlocked });
    this.audio.setBreathing("idle");
    this.actor.setLookTargetProvider(options.playerPosition);
    window.addEventListener("bosque:pause", this.onPause);
  }

  public get currentState() {
    return this.state;
  }

  /** Reserved for the later weapon/equipment system. */
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

    if (!this.engaged || distance > this.options.visionRange) {
      this.navigation.clear();
      this.enterState(this.engaged ? "watching" : "waiting");
      return;
    }

    const stopDistance = this.armed ? 1.8 : UNARMED_STOP_DISTANCE;
    const resumeDistance = this.armed ? 2.5 : UNARMED_RESUME_DISTANCE;
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
    this.audio.dispose();
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
    this.audio.setBreathing("idle");
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
