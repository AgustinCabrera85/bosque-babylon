import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { HermanoMayorHandle } from "./HermanoMayor";
import { HERMANO_MAYOR_AXE_ATTACK_TIMING } from "./HermanoMayorAxeAttackAction";

export const HERMANO_MAYOR_AXE_ATTACK_START_DISTANCE = 2.3;
export const HERMANO_MAYOR_AXE_ATTACK_HIT_DISTANCE = 2.55;
export const HERMANO_MAYOR_AXE_ATTACK_DAMAGE_FRACTION = 0.22;
export const HERMANO_MAYOR_AXE_BLADE_HIT_RADIUS = 0.4;
export const HERMANO_MAYOR_AXE_ATTACK_COOLDOWN_SECONDS = 2.5;
export const HERMANO_MAYOR_AXE_DODGE_WINDOW_MIN_SECONDS = 0.18;
export const HERMANO_MAYOR_AXE_DODGE_WINDOW_MAX_SECONDS = 0.52;

const FACE_TURN_SPEED = (300 * Math.PI) / 180;
export type HermanoMayorAxeAttackState =
  | "idle"
  | "attacking"
  | "cooldown";

export type HermanoMayorAxeDodgePromptState =
  | "hidden"
  | "window"
  | "success";

export type HermanoMayorAxeAttackOptions = {
  actor: HermanoMayorHandle;
  playerPosition: () => Vector3;
  playerNeckPosition: () => Vector3;
  canHitPlayer: () => boolean;
  onAxeDamage: (fractionOfMaxHealth: number) => void;
  onAxeDodged?: () => void;
  getPlayerSanity?: () => number;
  wasDodgePressed?: () => boolean;
  setDodgePrompt?: (
    state: HermanoMayorAxeDodgePromptState,
    remaining: number,
    sanity: number
  ) => void;
};

/** Gameplay timing, range resolution and dodge handling for the procedural swing. */
export class HermanoMayorAxeAttack {
  private state: HermanoMayorAxeAttackState = "idle";
  private cooldownRemaining = 0;
  private hitThisSwing = false;
  private resolvedThisSwing = false;
  private dodgedThisSwing = false;
  private forceRequested = false;
  private hasPreviousBlade = false;
  private disposed = false;
  private dodgeWindowStart = 0;
  private dodgeWindowDuration = HERMANO_MAYOR_AXE_DODGE_WINDOW_MAX_SECONDS;
  private attackSanity = 1;
  private readonly previousBladeLower = Vector3.Zero();
  private readonly previousBladeUpper = Vector3.Zero();
  private readonly currentBladeLower = Vector3.Zero();
  private readonly currentBladeUpper = Vector3.Zero();

  public constructor(private readonly options: HermanoMayorAxeAttackOptions) {}

  public get currentState() {
    return this.state;
  }

  public update(deltaSeconds: number, eligible: boolean, playerDistance: number) {
    if (this.disposed) return false;
    const dt = Math.max(0, Math.min(deltaSeconds, 0.05));
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);

    if (this.state === "idle") {
      if (
        (this.forceRequested || eligible) &&
        this.cooldownRemaining <= 0 &&
        (this.forceRequested || playerDistance <= HERMANO_MAYOR_AXE_ATTACK_START_DISTANCE)
      ) {
        this.forceRequested = false;
        if (this.options.actor.startAxeAttack()) {
          this.state = "attacking";
          this.hitThisSwing = false;
          this.resolvedThisSwing = false;
          this.dodgedThisSwing = false;
          this.configureDodgeWindow();
          this.captureInitialBlade();
          return true;
        }
      }
      return false;
    }

    if (this.state === "cooldown") {
      if (this.cooldownRemaining <= 0) this.state = "idle";
      return false;
    }

    const animation = this.options.actor.getAxeAttackDebugSnapshot();
    if (animation.state !== "attacking") {
      this.beginCooldown();
      return true;
    }

    if (animation.time < HERMANO_MAYOR_AXE_ATTACK_TIMING.commitAt) {
      this.facePlayer(dt);
    }
    this.updateDodgeWindow(animation.time);

    const hasCurrentBlade = this.options.actor.getAxeBladeEdgeWorldSegmentToRef(
      this.currentBladeLower,
      this.currentBladeUpper
    );
    // Gameplay resolves once at the authored impact. The blade sweep remains
    // useful for diagnostics and presentation, but minor rig/animation drift
    // must not let a stationary in-range player escape without pressing dodge.
    if (
      !this.resolvedThisSwing &&
      !this.dodgedThisSwing &&
      animation.time >= HERMANO_MAYOR_AXE_ATTACK_TIMING.impactAt
    ) {
      this.resolvedThisSwing = true;
      if (
        this.options.canHitPlayer() &&
        isAxeTargetInRange(playerDistance)
      ) {
        this.hitThisSwing = true;
        this.options.onAxeDamage(HERMANO_MAYOR_AXE_ATTACK_DAMAGE_FRACTION);
      }
    }

    if (hasCurrentBlade) {
      this.previousBladeLower.copyFrom(this.currentBladeLower);
      this.previousBladeUpper.copyFrom(this.currentBladeUpper);
      this.hasPreviousBlade = true;
    } else {
      this.hasPreviousBlade = false;
    }
    return true;
  }

  public forceAttack() {
    if (this.disposed || this.state === "attacking") return false;
    this.forceRequested = true;
    this.cooldownRemaining = 0;
    if (this.state === "cooldown") this.state = "idle";
    return true;
  }

  public interrupt() {
    if (this.disposed) return false;
    const wasActive = this.state === "attacking";
    this.forceRequested = false;
    if (wasActive) this.options.actor.cancelAxeAttack();
    this.beginCooldown();
    return wasActive;
  }

  public getDebugSnapshot() {
    return {
      state: this.state,
      cooldownRemaining: this.cooldownRemaining,
      hitThisSwing: this.hitThisSwing,
      resolvedThisSwing: this.resolvedThisSwing,
      dodgedThisSwing: this.dodgedThisSwing,
      attackSanity: this.attackSanity,
      dodgeWindowStart: this.dodgeWindowStart,
      dodgeWindowDuration: this.dodgeWindowDuration,
      hasPreviousBlade: this.hasPreviousBlade,
      previousBlade: this.hasPreviousBlade
        ? {
            lower: vectorSnapshot(this.previousBladeLower),
            upper: vectorSnapshot(this.previousBladeUpper),
          }
        : null,
    };
  }

  public dispose() {
    if (this.disposed) return;
    if (this.state === "attacking") this.options.actor.cancelAxeAttack();
    this.disposed = true;
    this.state = "idle";
    this.forceRequested = false;
    this.hasPreviousBlade = false;
    this.hideDodgePrompt();
  }

  private captureInitialBlade() {
    this.hasPreviousBlade = this.options.actor.getAxeBladeEdgeWorldSegmentToRef(
      this.previousBladeLower,
      this.previousBladeUpper
    );
  }

  private configureDodgeWindow() {
    this.attackSanity = clamp01(this.options.getPlayerSanity?.() ?? 1);
    this.dodgeWindowDuration = getAxeDodgeWindowSeconds(this.attackSanity);
    this.dodgeWindowStart =
      HERMANO_MAYOR_AXE_ATTACK_TIMING.impactAt - this.dodgeWindowDuration;
    this.hideDodgePrompt();
  }

  private updateDodgeWindow(animationTime: number) {
    if (this.dodgedThisSwing) {
      const showSuccess =
        animationTime <= HERMANO_MAYOR_AXE_ATTACK_TIMING.damageEnd;
      this.options.setDodgePrompt?.(
        showSuccess ? "success" : "hidden",
        showSuccess ? 1 : 0,
        this.attackSanity
      );
      return;
    }

    const windowEnd = HERMANO_MAYOR_AXE_ATTACK_TIMING.impactAt;
    const active =
      animationTime >= this.dodgeWindowStart && animationTime <= windowEnd;
    if (!active) {
      this.hideDodgePrompt();
      return;
    }

    const elapsed = animationTime - this.dodgeWindowStart;
    const remaining = clamp01(1 - elapsed / this.dodgeWindowDuration);
    this.options.setDodgePrompt?.(
      "window",
      remaining,
      this.attackSanity
    );
    if (!this.options.wasDodgePressed?.()) return;

    this.dodgedThisSwing = true;
    this.resolvedThisSwing = true;
    this.options.setDodgePrompt?.("success", 1, this.attackSanity);
    this.options.onAxeDodged?.();
  }

  private hideDodgePrompt() {
    this.options.setDodgePrompt?.("hidden", 0, this.attackSanity);
  }

  private facePlayer(dt: number) {
    const player = this.options.playerPosition();
    const root = this.options.actor.root;
    const dx = player.x - root.position.x;
    const dz = player.z - root.position.z;
    if (Math.hypot(dx, dz) <= 0.001) return;
    const desiredYaw = Math.atan2(dx, dz);
    const delta = Math.atan2(
      Math.sin(desiredYaw - root.rotation.y),
      Math.cos(desiredYaw - root.rotation.y)
    );
    const maxTurn = FACE_TURN_SPEED * dt;
    root.rotation.y += Math.max(-maxTurn, Math.min(maxTurn, delta));
  }

  private beginCooldown() {
    this.state = "cooldown";
    this.cooldownRemaining = HERMANO_MAYOR_AXE_ATTACK_COOLDOWN_SECONDS;
    this.hitThisSwing = false;
    this.resolvedThisSwing = false;
    this.hasPreviousBlade = false;
    this.hideDodgePrompt();
  }
}

export function isAxeTargetInRange(distance: number) {
  return (
    Number.isFinite(distance) &&
    distance >= 0 &&
    distance <= HERMANO_MAYOR_AXE_ATTACK_HIT_DISTANCE
  );
}

export function getAxeDodgeWindowSeconds(normalizedSanity: number) {
  const sanity = clamp01(normalizedSanity);
  return (
    HERMANO_MAYOR_AXE_DODGE_WINDOW_MIN_SECONDS +
    (HERMANO_MAYOR_AXE_DODGE_WINDOW_MAX_SECONDS -
      HERMANO_MAYOR_AXE_DODGE_WINDOW_MIN_SECONDS) *
      sanity
  );
}

/**
 * Tests the moving cutting edge against the player's body capsule. The handle
 * and blunt poll are intentionally absent from this calculation.
 */
export function bladeSweepIntersectsCapsule(
  previousLower: Vector3,
  previousUpper: Vector3,
  currentLower: Vector3,
  currentUpper: Vector3,
  capsuleLower: Vector3,
  capsuleUpper: Vector3,
  radius: number
) {
  const radiusSquared = Math.max(0, radius) ** 2;
  if (
    segmentDistanceSquared(
      previousLower,
      previousUpper,
      capsuleLower,
      capsuleUpper
    ) <= radiusSquared ||
    segmentDistanceSquared(
      currentLower,
      currentUpper,
      capsuleLower,
      capsuleUpper
    ) <= radiusSquared ||
    segmentDistanceSquared(
      previousLower,
      currentLower,
      capsuleLower,
      capsuleUpper
    ) <= radiusSquared ||
    segmentDistanceSquared(
      previousUpper,
      currentUpper,
      capsuleLower,
      capsuleUpper
    ) <= radiusSquared
  ) {
    return true;
  }

  const previousMiddle = previousLower.add(previousUpper).scaleInPlace(0.5);
  const currentMiddle = currentLower.add(currentUpper).scaleInPlace(0.5);
  return (
    segmentDistanceSquared(
      previousMiddle,
      currentMiddle,
      capsuleLower,
      capsuleUpper
    ) <= radiusSquared
  );
}

function segmentDistanceSquared(
  firstStart: Vector3,
  firstEnd: Vector3,
  secondStart: Vector3,
  secondEnd: Vector3
) {
  const ux = firstEnd.x - firstStart.x;
  const uy = firstEnd.y - firstStart.y;
  const uz = firstEnd.z - firstStart.z;
  const vx = secondEnd.x - secondStart.x;
  const vy = secondEnd.y - secondStart.y;
  const vz = secondEnd.z - secondStart.z;
  const wx = firstStart.x - secondStart.x;
  const wy = firstStart.y - secondStart.y;
  const wz = firstStart.z - secondStart.z;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const denominator = a * c - b * b;
  let firstNumerator = 0;
  let firstDenominator = denominator;
  let secondNumerator = 0;
  let secondDenominator = denominator;

  if (denominator < 0.000001) {
    firstNumerator = 0;
    firstDenominator = 1;
    secondNumerator = e;
    secondDenominator = c;
  } else {
    firstNumerator = b * e - c * d;
    secondNumerator = a * e - b * d;
    if (firstNumerator < 0) {
      firstNumerator = 0;
      secondNumerator = e;
      secondDenominator = c;
    } else if (firstNumerator > firstDenominator) {
      firstNumerator = firstDenominator;
      secondNumerator = e + b;
      secondDenominator = c;
    }
  }

  if (secondNumerator < 0) {
    secondNumerator = 0;
    if (-d < 0) firstNumerator = 0;
    else if (-d > a) firstNumerator = firstDenominator;
    else {
      firstNumerator = -d;
      firstDenominator = a;
    }
  } else if (secondNumerator > secondDenominator) {
    secondNumerator = secondDenominator;
    if (-d + b < 0) firstNumerator = 0;
    else if (-d + b > a) firstNumerator = firstDenominator;
    else {
      firstNumerator = -d + b;
      firstDenominator = a;
    }
  }

  const firstParameter =
    Math.abs(firstNumerator) < 0.000001
      ? 0
      : firstNumerator / Math.max(0.000001, firstDenominator);
  const secondParameter =
    Math.abs(secondNumerator) < 0.000001
      ? 0
      : secondNumerator / Math.max(0.000001, secondDenominator);
  const dx = wx + firstParameter * ux - secondParameter * vx;
  const dy = wy + firstParameter * uy - secondParameter * vy;
  const dz = wz + firstParameter * uz - secondParameter * vz;
  return dx * dx + dy * dy + dz * dz;
}

function vectorSnapshot(value: Vector3) {
  return { x: value.x, y: value.y, z: value.z };
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
