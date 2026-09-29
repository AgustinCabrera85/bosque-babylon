import type {
  ProceduralAnimationDefinition,
  ProceduralAnimationKey,
} from "./ProceduralAnimationDefinition";
import { PROCEDURAL_NEUTRAL_POSE_ID } from "./ProceduralAnimationDefinition";
import type { ProceduralPose } from "./ProceduralPose";
import type { ProceduralPosePlayer } from "./ProceduralPosePlayer";

export type ProceduralAnimationPlaybackState = {
  animationId: string | null;
  time: number;
  duration: number;
  playing: boolean;
  paused: boolean;
  loop: boolean;
  speedRatio: number;
  previousPoseId: string;
  nextPoseId: string;
  blend: number;
};

export class ProceduralAnimationPlayer {
  private definition: ProceduralAnimationDefinition | null = null;
  private timeline: ProceduralAnimationKey[] = [];
  private readonly state: ProceduralAnimationPlaybackState = {
    animationId: null,
    time: 0,
    duration: 0,
    playing: false,
    paused: false,
    loop: false,
    speedRatio: 1,
    previousPoseId: PROCEDURAL_NEUTRAL_POSE_ID,
    nextPoseId: PROCEDURAL_NEUTRAL_POSE_ID,
    blend: 0,
  };

  public constructor(private readonly posePlayer: ProceduralPosePlayer) {}

  public play(definition: ProceduralAnimationDefinition) {
    validateDefinition(definition);
    this.definition = definition;
    this.timeline = [...definition.timeline].sort(
      (left, right) => left.time - right.time
    );
    this.state.animationId = definition.id;
    this.state.time = 0;
    this.state.duration = this.timeline.at(-1)?.time ?? 0;
    this.state.playing = true;
    this.state.paused = false;
    this.evaluate();
  }

  public pause() {
    if (this.definition && this.state.playing) this.state.paused = true;
  }

  public resume() {
    if (!this.definition) return;
    if (!this.state.loop && this.state.time >= this.state.duration) {
      this.state.time = 0;
    }
    this.state.playing = true;
    this.state.paused = false;
    this.evaluate();
  }

  public stop() {
    this.definition = null;
    this.timeline = [];
    this.state.animationId = null;
    this.state.time = 0;
    this.state.duration = 0;
    this.state.playing = false;
    this.state.paused = false;
    this.state.previousPoseId = PROCEDURAL_NEUTRAL_POSE_ID;
    this.state.nextPoseId = PROCEDURAL_NEUTRAL_POSE_ID;
    this.state.blend = 0;
    this.posePlayer.clear();
  }

  public seek(time: number) {
    if (!this.definition) return;
    this.state.time = Math.max(0, Math.min(this.state.duration, time));
    this.evaluate();
  }

  public update(dt: number) {
    if (!this.definition || !this.state.playing || this.state.paused) return;
    const duration = this.state.duration;
    let time = this.state.time + Math.max(0, dt) * this.state.speedRatio;
    if (duration > 0 && time >= duration) {
      if (this.state.loop) time %= duration;
      else {
        time = duration;
        this.state.playing = false;
      }
    }
    this.state.time = time;
    this.evaluate();
  }

  public setLoop(loop: boolean) {
    this.state.loop = loop;
  }

  public setSpeedRatio(speedRatio: number) {
    this.state.speedRatio = Math.max(0.01, speedRatio);
  }

  public refresh() {
    if (this.definition) this.evaluate();
  }

  public getState() {
    return this.state as Readonly<ProceduralAnimationPlaybackState>;
  }

  private evaluate() {
    const definition = this.definition;
    const first = this.timeline[0];
    if (!definition || !first) {
      this.posePlayer.clear();
      return;
    }

    const time = this.state.time;
    if (time <= first.time) {
      if (first.time > 0) {
        const t = applyEasing(time / first.time, first.easing);
        this.applySegment(
          PROCEDURAL_NEUTRAL_POSE_ID,
          first.poseId,
          t
        );
      } else {
        this.applySegment(first.poseId, first.poseId, 1);
      }
      return;
    }

    const last = this.timeline[this.timeline.length - 1];
    if (time >= last.time) {
      this.applySegment(last.poseId, last.poseId, 1);
      return;
    }

    for (let index = 1; index < this.timeline.length; index += 1) {
      const next = this.timeline[index];
      if (time > next.time) continue;
      const previous = this.timeline[index - 1];
      const duration = Math.max(0.000001, next.time - previous.time);
      const t = applyEasing((time - previous.time) / duration, next.easing);
      this.applySegment(previous.poseId, next.poseId, t);
      return;
    }
  }

  private applySegment(fromId: string, toId: string, blend: number) {
    const definition = this.definition;
    if (!definition) return;
    this.posePlayer.blendPoses(
      resolvePose(definition, fromId),
      resolvePose(definition, toId),
      blend
    );
    this.state.previousPoseId = fromId;
    this.state.nextPoseId = toId;
    this.state.blend = blend;
  }
}

function resolvePose(
  definition: ProceduralAnimationDefinition,
  poseId: string
): ProceduralPose | null {
  return poseId === PROCEDURAL_NEUTRAL_POSE_ID
    ? null
    : definition.poses[poseId] ?? null;
}

function validateDefinition(definition: ProceduralAnimationDefinition) {
  if (!definition.id.trim()) {
    throw new Error("Procedural animation id is required.");
  }
  if (definition.timeline.length === 0) {
    throw new Error("Add at least one procedural key.");
  }
  for (const key of definition.timeline) {
    if (!Number.isFinite(key.time) || key.time < 0) {
      throw new Error("Procedural key times must be finite and non-negative.");
    }
    if (
      key.poseId !== PROCEDURAL_NEUTRAL_POSE_ID &&
      !definition.poses[key.poseId]
    ) {
      throw new Error(`Missing Key Pose '${key.poseId}'.`);
    }
  }
}

function applyEasing(value: number, easing: ProceduralAnimationKey["easing"]) {
  const t = Math.max(0, Math.min(1, value));
  return easing === "smooth" ? t * t * (3 - 2 * t) : t;
}
