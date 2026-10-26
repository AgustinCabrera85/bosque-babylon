export type RinaCrowdQuality = "near" | "middle";

/** Stadium-local radius reserved around a fan with animated arms. */
export const RINA_ANIMATED_FAN_CLEARANCE = 1.8;

export interface RinaCrowdFanAsset {
  readonly id: string;
  readonly type: "spectator";
  readonly gender: "male" | "female";
  readonly targetWorldHeight: number;
  /** Present on fans whose original rig should animate in the stands. */
  readonly animationNames?: readonly string[];
  readonly variants: Readonly<Record<RinaCrowdQuality, Readonly<{
    /** Original skinned asset. Animated fans play clips from this file. */
    riggedPath: string;
    /** Static pose used by fans without animation clips. */
    posedPath?: string;
    sourceHasRig: boolean;
    sourceHasAnimations: boolean;
    bytes: number;
    posedHeight?: number;
  }>>>;
}

/** Add future spectators here. The stadium distribution does not depend on asset IDs. */
export const RINA_CROWD_FANS: readonly RinaCrowdFanAsset[] = [
  {
    id: "fan_01",
    type: "spectator",
    gender: "male",
    // Lautaro is about 2.68 m tall in this level.
    targetWorldHeight: 2.65,
    animationNames: [
      "fan_01_happy_idle_inplace",
      "fan_01_cheering_inplace",
      "fan_01_cheering_alt_inplace",
      "fan_01_clapping_inplace",
      "fan_01_silly_dancing_inplace",
    ],
    variants: {
      near: {
        riggedPath: "assets/models/rina/crowd/fan_01_nla_1k.glb",
        sourceHasRig: true,
        sourceHasAnimations: true,
        bytes: 1002736,
      },
      middle: {
        riggedPath: "assets/models/rina/crowd/fan_01_nla_1k.glb",
        sourceHasRig: true,
        sourceHasAnimations: true,
        bytes: 1002736,
      },
    },
  },
  {
    id: "fan_02",
    type: "spectator",
    gender: "male",
    targetWorldHeight: 2.55,
    animationNames: [
      "fan_02_happy_idle_inplace",
      "fan_02_cheering_inplace",
      "fan_02_cheering_alt_inplace",
      "fan_02_standing_clap_inplace",
    ],
    variants: {
      near: {
        riggedPath: "assets/models/rina/crowd/fan_02_nla_1k.glb",
        sourceHasRig: true,
        sourceHasAnimations: true,
        bytes: 1022628,
      },
      middle: {
        riggedPath: "assets/models/rina/crowd/fan_02_nla_1k.glb",
        sourceHasRig: true,
        sourceHasAnimations: true,
        bytes: 1022628,
      },
    },
  },
  {
    id: "fan_03",
    type: "spectator",
    gender: "male",
    targetWorldHeight: 2.80,
    animationNames: [
      "fan_03_happy_idle_inplace",
      "fan_03_cheering_inplace",
      "fan_03_cheering_alt_inplace",
      "fan_03_rallying_inplace",
    ],
    variants: {
      near: {
        riggedPath: "assets/models/rina/crowd/fan_03_nla_1k.glb",
        sourceHasRig: true,
        sourceHasAnimations: true,
        bytes: 959344,
      },
      middle: {
        riggedPath: "assets/models/rina/crowd/fan_03_nla_1k.glb",
        sourceHasRig: true,
        sourceHasAnimations: true,
        bytes: 959344,
      },
    },
  },
  {
    id: "fan_04",
    type: "spectator",
    gender: "female",
    targetWorldHeight: 2.50,
    animationNames: [
      "fan_04_cheering_inplace",
      "fan_04_excited_inplace",
      "fan_04_standing_clap_inplace",
    ],
    variants: {
      near: {
        riggedPath: "assets/models/rina/crowd/fan_04_near_2k.glb",
        sourceHasRig: true,
        sourceHasAnimations: true,
        bytes: 1501612,
      },
      middle: {
        riggedPath: "assets/models/rina/crowd/fan_04_crowd_1k.glb",
        sourceHasRig: true,
        sourceHasAnimations: true,
        bytes: 999420,
      },
    },
  },
  {
    id: "fan_05",
    type: "spectator",
    gender: "female",
    targetWorldHeight: 2.50,
    animationNames: [
      "fan_05_cheering_inplace",
      "fan_05_cheering_alt_inplace",
      "fan_05_excited_inplace",
      "fan_05_standing_clap_inplace",
      "fan_05_standing_idle_inplace",
    ],
    variants: {
      near: {
        riggedPath: "assets/models/rina/crowd/fan_05_near_2k.glb",
        sourceHasRig: true,
        sourceHasAnimations: true,
        bytes: 1597288,
      },
      middle: {
        riggedPath: "assets/models/rina/crowd/fan_05_crowd_1k.glb",
        sourceHasRig: true,
        sourceHasAnimations: true,
        bytes: 1172360,
      },
    },
  },
];
