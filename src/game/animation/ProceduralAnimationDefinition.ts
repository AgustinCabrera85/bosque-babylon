import type { ProceduralPose } from "./ProceduralPose";

export type ProceduralAnimationEasing = "linear" | "smooth";

export type ProceduralAnimationKey = {
  time: number;
  poseId: string;
  easing?: ProceduralAnimationEasing;
};

export type ProceduralAnimationDefinition = {
  id: string;
  poses: Record<string, ProceduralPose>;
  timeline: ProceduralAnimationKey[];
};

export const PROCEDURAL_NEUTRAL_POSE_ID = "neutral";
