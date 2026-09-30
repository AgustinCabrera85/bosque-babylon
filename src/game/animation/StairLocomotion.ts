import type { PlayerStairSurfaceInfo } from "../PlayerWorldQuery";

export type StairLeg = "left" | "right";
export type StairDirection = "up" | "down";

export type StairLocomotionState = {
  active: boolean;
  direction: StairDirection;
  leadLeg: StairLeg;
  phase: number;
  intensity: number;
  visualOffsetY: number;
};

export type StairLegPose = {
  torsoForwardLean: number;
  leftThighPitch: number;
  rightThighPitch: number;
  leftKneeFlex: number;
  rightKneeFlex: number;
  leftFootPitch: number;
  rightFootPitch: number;
};

export const INACTIVE_STAIR_LOCOMOTION: StairLocomotionState = {
  active: false,
  direction: "up",
  leadLeg: "left",
  phase: 0,
  intensity: 0,
  visualOffsetY: 0,
};

export function resolveStairLocomotion(
  surface: PlayerStairSurfaceInfo | null,
  ascentTravel: number,
  deltaTime: number,
  visualOffsetY: number
): StairLocomotionState {
  if (!surface || Math.abs(ascentTravel) <= 0.00001 || deltaTime <= 0) {
    return { ...INACTIVE_STAIR_LOCOMOTION, visualOffsetY };
  }

  const direction: StairDirection = ascentTravel > 0 ? "up" : "down";
  const phase = clamp01(
    direction === "up" ? surface.stepProgress : 1 - surface.stepProgress
  );
  const landingStep =
    direction === "up" ? surface.stepIndex + 1 : surface.stepIndex;
  const leadLeg: StairLeg = landingStep % 2 === 0 ? "left" : "right";
  const travelSpeed = Math.abs(ascentTravel) / Math.max(0.0001, deltaTime);

  return {
    active: true,
    direction,
    leadLeg,
    phase,
    intensity: smoothStep(clamp01(travelSpeed / 1.6)),
    visualOffsetY,
  };
}

export function computeStairLegPose(
  state: StairLocomotionState,
  blend: number
): StairLegPose {
  const weight = smoothStep(clamp01(blend)) * clamp01(state.intensity);
  const pose: StairLegPose = {
    torsoForwardLean: 0,
    leftThighPitch: 0,
    rightThighPitch: 0,
    leftKneeFlex: 0,
    rightKneeFlex: 0,
    leftFootPitch: 0,
    rightFootPitch: 0,
  };
  if (weight <= 0.0001 || !shouldUseProceduralStairPose(state)) return pose;

  const phase = clamp01(state.phase);
  const lead = state.leadLeg;
  const support: StairLeg = lead === "left" ? "right" : "left";
  pose.torsoForwardLean = radians(7) * weight;
  const lift = Math.sin(Math.PI * smoothStep(clamp01((phase - 0.06) / 0.9)));
  const supportCompression = Math.sin(Math.PI * phase);
  setLegPose(pose, lead, radians(90) * lift, radians(82) * lift, radians(18) * lift);
  setLegPose(
    pose,
    support,
    radians(-4) * supportCompression,
    radians(11) * supportCompression,
    radians(-5) * supportCompression
  );

  scaleLegPose(pose, weight);
  return pose;
}

export function shouldUseProceduralStairPose(state: StairLocomotionState) {
  return state.active && state.direction === "up";
}

export function shouldKeepStairGrounded(
  wasGrounded: boolean,
  verticalVelocity: number,
  stepDownDistance: number,
  horizontalTravel: number,
  hasStairSurface: boolean
) {
  return (
    hasStairSurface &&
    wasGrounded &&
    verticalVelocity <= 0.01 &&
    stepDownDistance > 0.02 &&
    stepDownDistance <= 0.65 &&
    horizontalTravel > 0.00001
  );
}

export function dampStairPresentation(
  current: number,
  target: number,
  response: number,
  deltaTime: number
) {
  if (deltaTime <= 0) return current;
  const amount = 1 - Math.exp(-Math.max(0, response) * deltaTime);
  return current + (target - current) * amount;
}

function setLegPose(
  pose: StairLegPose,
  leg: StairLeg,
  thighPitch: number,
  kneeFlex: number,
  footPitch: number
) {
  if (leg === "left") {
    pose.leftThighPitch = thighPitch;
    pose.leftKneeFlex = kneeFlex;
    pose.leftFootPitch = footPitch;
  } else {
    pose.rightThighPitch = thighPitch;
    pose.rightKneeFlex = kneeFlex;
    pose.rightFootPitch = footPitch;
  }
}

function scaleLegPose(pose: StairLegPose, weight: number) {
  pose.leftThighPitch *= weight;
  pose.rightThighPitch *= weight;
  pose.leftKneeFlex *= weight;
  pose.rightKneeFlex *= weight;
  pose.leftFootPitch *= weight;
  pose.rightFootPitch *= weight;
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothStep(value: number) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
}
