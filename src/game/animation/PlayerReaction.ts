import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Anatomical area used to bias a reusable hit reaction. */
export type PlayerHitReactionZone =
  | "head"
  | "chest"
  | "abdomen"
  | "leftShoulder"
  | "rightShoulder";

export type PlayerImpactType = "blunt" | "heavy" | "projectile";
export type PlayerDodgeStyle = "sidestep" | "duck" | "backstep";
export type PlayerReactionSide = "auto" | "left" | "right";

type PlayerReactionBase = {
  /** Normalized intensity; callers may safely pass values outside 0..1. */
  strength?: number;
  /** Optional world-space origin used to resolve a natural reaction direction. */
  sourcePosition?: Vector3;
  /** Optional short locomotion lock. Omit or use zero for a purely visual layer. */
  movementLockSeconds?: number;
};

export type PlayerHitReactionEvent = PlayerReactionBase & {
  kind: "hit";
  /** World-space direction in which the body should recoil. */
  direction?: Vector3;
  hitZone?: PlayerHitReactionZone;
  impactType?: PlayerImpactType;
};

export type PlayerDodgeReactionEvent = PlayerReactionBase & {
  kind: "dodge";
  /** World-space direction in which the avatar should evade. */
  direction?: Vector3;
  style?: PlayerDodgeStyle;
  side?: PlayerReactionSide;
};

/** Scene-independent command accepted by the player from any combat source. */
export type PlayerReactionEvent =
  | PlayerHitReactionEvent
  | PlayerDodgeReactionEvent;

export const PLAYER_DODGE_REACTION_DURATION_SECONDS = 0.62;

export type PlayerDodgeReactionSample = {
  weight: number;
  crouch: number;
  lateral: number;
  turn: number;
  visualDisplacement: number;
};

export type PlayerHitReactionSample = {
  travel: number;
  firstStep: number;
  secondStep: number;
  thirdStep: number;
  fourthStep: number;
  settleStep: number;
  stanceOpen: number;
  supportBrace: number;
  pushFollow: number;
  imbalance: number;
  armSwing: number;
  armSpread: number;
  recoveryStrain: number;
};

export function getPlayerHitReactionDuration(
  strength: number,
  impactType: PlayerImpactType = "blunt"
) {
  const value = clamp01(strength);
  const baseDuration =
    value <= 0.45
      ? lerp(0.25, 0.32, value / 0.45)
      : value <= 0.75
        ? lerp(0.32, 0.4, (value - 0.45) / 0.3)
        : lerp(0.4, 0.6, (value - 0.75) / 0.25);
  if (impactType === "heavy") return lerp(0.78, 1.42, value);
  if (impactType === "projectile") return baseDuration * 0.82;
  return baseDuration;
}

export function getPlayerHitReactionTravelDistance(
  strength: number,
  impactType: PlayerImpactType = "blunt"
) {
  const value = clamp01(strength);
  const maximum = impactType === "heavy" ? 1.2 : impactType === "projectile" ? 0.28 : 0.45;
  return maximum * value;
}

/** Samples a multi-step loss-of-balance reaction without depending on a scene or rig. */
export function samplePlayerHitReaction(
  progress: number,
  strength: number,
  impactType: PlayerImpactType = "blunt"
): PlayerHitReactionSample {
  const value = clamp01(progress);
  const force = clamp01(strength);
  const impactScale = impactType === "heavy" ? 1 : impactType === "projectile" ? 0.48 : 0.74;
  const firstStep = asymmetricPulse(value, 0.03, 0.13, 0.29);
  const secondStep = asymmetricPulse(value, 0.19, 0.33, 0.49);
  const thirdStep = asymmetricPulse(value, 0.39, 0.53, 0.69);
  const fourthStep = asymmetricPulse(value, 0.59, 0.73, 0.91);
  const settleStep = asymmetricPulse(value, 0.78, 0.9, 1);
  const recovery = smoothStep((value - 0.78) / 0.22);
  const firstTravel = smoothStep((value - 0.015) / 0.22);
  const secondTravel = smoothStep((value - 0.17) / 0.27);
  const thirdTravel = smoothStep((value - 0.37) / 0.26);
  const fourthTravel = smoothStep((value - 0.57) / 0.28);
  const travelProgress =
    value >= 1
      ? 1
      : firstTravel * 0.31 +
        secondTravel * 0.27 +
        thirdTravel * 0.23 +
        fourthTravel * 0.19;
  const travel =
    getPlayerHitReactionTravelDistance(force, impactType) * travelProgress;
  const oscillation =
    Math.sin(value * Math.PI * 6.4) * 0.72 +
    Math.sin(value * Math.PI * 10.6 + 0.65) * 0.28;
  return {
    travel,
    firstStep,
    secondStep,
    thirdStep,
    fourthStep,
    settleStep,
    stanceOpen: Math.min(
      1,
      (firstStep * 0.85 +
        secondStep * 0.82 +
        thirdStep * 0.78 +
        fourthStep * 0.72 +
        settleStep * 0.5) *
        impactScale *
        force
    ),
    supportBrace: Math.min(
      1,
      (firstStep * 0.95 +
        secondStep * 0.92 +
        thirdStep * 0.88 +
        fourthStep * 0.82 +
        settleStep * 0.75) *
        impactScale *
        force
    ),
    pushFollow: Math.min(
      1,
      (firstStep * 0.78 +
        secondStep * 0.68 +
        thirdStep * 0.58 +
        fourthStep * 0.48 +
        settleStep * 0.3) *
        impactScale *
        force
    ),
    imbalance:
      (firstStep * 0.92 -
        secondStep * 0.78 +
        thirdStep * 0.66 -
        fourthStep * 0.54 +
        settleStep * 0.3) *
      (1 - recovery * 0.55) *
      impactScale *
      force,
    armSwing:
      oscillation *
      (1 - smoothStep((value - 0.84) / 0.16)) *
      impactScale *
      force,
    armSpread:
      Math.min(
        1,
        (firstStep * 0.94 +
          secondStep * 0.84 +
          thirdStep * 0.72 +
          fourthStep * 0.62 +
          settleStep * 0.36) *
          impactScale *
          force
      ),
    recoveryStrain:
      asymmetricPulse(value, 0.74, 0.88, 1) * impactScale * force,
  };
}

export function getPlayerDodgeReactionDuration(strength: number) {
  return lerp(
    PLAYER_DODGE_REACTION_DURATION_SECONDS * 0.84,
    PLAYER_DODGE_REACTION_DURATION_SECONDS,
    clamp01(strength)
  );
}

/** Samples normalized dodge choreography without depending on a scene or rig. */
export function samplePlayerDodgeReaction(
  progress: number,
  strength: number,
  style: PlayerDodgeStyle,
  directionRight: number
): PlayerDodgeReactionSample {
  const value = clamp01(progress);
  const enter = smoothStep(value / 0.2);
  const exit = 1 - smoothStep((value - 0.58) / 0.42);
  const weight = enter * exit * clamp01(strength);
  const side = Math.abs(directionRight) > 0.12 ? Math.sign(directionRight) : 1;
  const isDuck = style === "duck";
  const isBackstep = style === "backstep";
  return {
    weight,
    crouch: (isDuck ? 1.35 : isBackstep ? 0.72 : 0.88) * weight,
    lateral: (isDuck ? 0.34 : isBackstep ? 0.2 : 1) * side * weight,
    turn: (isDuck ? 0.3 : isBackstep ? 0.38 : 1) * side * weight,
    visualDisplacement:
      (isDuck ? 0.035 : isBackstep ? 0.17 : 0.23) * weight,
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * clamp01(amount);
}

function smoothStep(value: number) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
}

function asymmetricPulse(
  value: number,
  start: number,
  peak: number,
  end: number
) {
  if (value <= start || value >= end) return 0;
  if (value < peak) {
    return smoothStep((value - start) / Math.max(0.0001, peak - start));
  }
  return 1 - smoothStep((value - peak) / Math.max(0.0001, end - peak));
}
