import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

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

const WALK_BONES = new Set([
  "Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "LeftToe_End",
  "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "RightToe_End",
]);

function isWalkBone(target: { name?: string } | null) {
  return WALK_BONES.has(target?.name?.split(":").at(-1) ?? "");
}

/** Owns the imported skeletal clips. Morph targets remain independent. */
export class RinaAnimationController {
  private readonly actions = new Map<string, AnimationGroup>();
  private readonly walkLower: AnimationGroup;
  private readonly singUpper: AnimationGroup;
  private currentAction: string | null = null;

  constructor(groups: readonly AnimationGroup[]) {
    for (const group of groups) {
      group.stop();
      const sourceName = group.name.split(":").at(-1) ?? group.name;
      this.actions.set(SOURCE_TO_ACTION.get(sourceName) ?? sourceName, group);
    }
    for (const required of ["idle", "walk", "run", "sing"] as const) {
      if (!this.actions.has(required)) {
        throw new Error(`Rina GLB is missing animation ${RINA_NLA_ACTIONS[required]}`);
      }
    }
    const walk = this.actions.get("walk")!;
    const sing = this.actions.get("sing")!;
    this.walkLower = new AnimationGroup("rina_locomotion_walk_lower", walk.getScene());
    this.singUpper = new AnimationGroup("rina_emote_sing_upper", sing.getScene());
    for (const targeted of walk.targetedAnimations) {
      if (isWalkBone(targeted.target)) {
        this.walkLower.addTargetedAnimation(targeted.animation, targeted.target);
      }
    }
    for (const targeted of sing.targetedAnimations) {
      if (!isWalkBone(targeted.target)) {
        this.singUpper.addTargetedAnimation(targeted.animation, targeted.target);
      }
    }
    if (!this.walkLower.targetedAnimations.length ||
        !this.singUpper.targetedAnimations.length) {
      throw new Error("Rina walk and sing clips cannot be separated by body region");
    }
  }

  get current() { return this.currentAction; }

  getAvailableActions() { return [...this.actions.keys()]; }

  has(action: string) { return this.actions.has(action); }

  get(action: string) { return this.actions.get(action) ?? null; }

  play(action: RinaNlaAction | string, options: RinaPlayOptions = {}) {
    const group = this.actions.get(action);
    if (!group) return null;
    this.stopCurrent();
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

  /** Walk from the hips down while singing owns the torso, arms and head. */
  playWalkAndSing() {
    if (this.currentAction === "singWalk") return;
    this.stopCurrent();
    for (const group of [this.walkLower, this.singUpper]) {
      group.enableBlending = true;
      group.blendingSpeed = 0.1;
      group.start(true, group === this.walkLower ? 1 : 0.96);
    }
    this.currentAction = "singWalk";
  }

  pause() {
    if (this.currentAction === "singWalk") {
      this.walkLower.pause();
      this.singUpper.pause();
    } else this.actions.get(this.currentAction ?? "")?.pause();
  }

  resume() {
    if (this.currentAction === "singWalk") {
      this.walkLower.play();
      this.singUpper.play();
    } else this.actions.get(this.currentAction ?? "")?.play();
  }

  stop() {
    for (const group of this.actions.values()) group.stop();
    this.walkLower.stop();
    this.singUpper.stop();
    this.currentAction = null;
  }

  dispose() {
    this.stop();
    this.walkLower.dispose();
    this.singUpper.dispose();
  }

  private stopCurrent() {
    if (this.currentAction === "singWalk") {
      this.walkLower.stop();
      this.singUpper.stop();
    } else if (this.currentAction) {
      this.actions.get(this.currentAction)?.stop();
    }
  }
}
