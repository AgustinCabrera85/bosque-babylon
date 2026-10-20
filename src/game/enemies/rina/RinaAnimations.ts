import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

/** Exact NLA clip names in Rina_NLA_ShapeKeys.glb. */
export const RINA_NLA_ACTIONS = {
  angry: "rina_emote_angry",
  bellyDance: "rina_dance_belly",
  catwalkIdleTwistRight: "rina_locomotion_catwalk_idle_twist_r",
  catwalkCrossStop: "rina_locomotion_catwalk_cross_stop",
  catwalkStopTwistRight: "rina_locomotion_catwalk_stop_twist_r",
  dancePose: "rina_pose_dance",
  dynamicPose: "rina_pose_dynamic",
  layingPose: "rina_pose_laying",
  standingPoseOne: "rina_pose_standing_01",
  standingPoseTwo: "rina_pose_standing_02",
  standingPose: "rina_pose_standing_00",
  idle: "rina_locomotion_idle_01",
  jazzDance: "rina_dance_jazz",
  run: "rina_locomotion_run_medium",
  no: "rina_emote_no",
  sing: "rina_emote_sing",
  magicAoe: "rina_combat_magic_aoe_02",
  blockIdle: "rina_combat_block_idle",
  greet: "rina_emote_greet",
  talk: "rina_emote_talk",
  taunt: "rina_emote_taunt",
  thankful: "rina_emote_thankful",
  think: "rina_emote_think",
  threaten: "rina_emote_threaten",
  walk: "rina_locomotion_walk_06",
} as const;

export type RinaNlaAction = keyof typeof RINA_NLA_ACTIONS;
export type RinaPlayOptions = {
  loop?: boolean;
  speedRatio?: number;
  blendingSpeed?: number;
  from?: number;
  to?: number;
};

const SOURCE_TO_ACTION = new Map<string, RinaNlaAction>(
  Object.entries(RINA_NLA_ACTIONS).map(([action, source]) => [
    source,
    action as RinaNlaAction,
  ])
);

const LOOPING_ACTIONS = new Set<RinaNlaAction>([
  "bellyDance", "catwalkIdleTwistRight", "dancePose", "dynamicPose",
  "layingPose", "standingPoseOne", "standingPoseTwo", "standingPose",
  "idle", "jazzDance", "run", "blockIdle", "walk",
]);

/** Owns the imported skeletal clips. Morph targets remain independent. */
export class RinaAnimationController {
  private readonly actions = new Map<string, AnimationGroup>();
  private currentAction: string | null = null;

  constructor(groups: readonly AnimationGroup[]) {
    for (const group of groups) {
      group.stop();
      const sourceName = group.name.split(":").at(-1) ?? group.name;
      this.actions.set(SOURCE_TO_ACTION.get(sourceName) ?? sourceName, group);
    }
    for (const required of ["idle", "walk", "run"] as const) {
      if (!this.actions.has(required)) {
        throw new Error(`Rina GLB is missing animation ${RINA_NLA_ACTIONS[required]}`);
      }
    }
  }

  get current() { return this.currentAction; }

  getAvailableActions() { return [...this.actions.keys()]; }

  has(action: string) { return this.actions.has(action); }

  get(action: string) { return this.actions.get(action) ?? null; }

  play(action: RinaNlaAction | string, options: RinaPlayOptions = {}) {
    const group = this.actions.get(action);
    if (!group) return null;
    if (this.currentAction) this.actions.get(this.currentAction)?.stop();
    group.enableBlending = true;
    group.blendingSpeed = options.blendingSpeed ?? 0.08;
    group.start(
      options.loop ?? LOOPING_ACTIONS.has(action as RinaNlaAction),
      options.speedRatio ?? 1,
      options.from,
      options.to
    );
    this.currentAction = action;
    return group;
  }

  pause() { this.actions.get(this.currentAction ?? "")?.pause(); }

  resume() { this.actions.get(this.currentAction ?? "")?.play(); }

  stop() {
    for (const group of this.actions.values()) group.stop();
    this.currentAction = null;
  }
}
