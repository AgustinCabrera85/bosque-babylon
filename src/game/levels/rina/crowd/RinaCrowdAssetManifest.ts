export type RinaCrowdQuality = "near" | "middle";

/** Stadium-local radius reserved around a fan with animated arms. */
export const RINA_ANIMATED_FAN_CLEARANCE = 1.8;

export interface RinaCrowdFanAsset {
  readonly id: string;
  readonly type: "spectator";
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
    // Rina is 2.58 m in this level. Fan 01 should stand just above her.
    targetWorldHeight: 2.70,
    variants: {
      near: {
        riggedPath: "assets/models/rina/crowd/fan_01_near_rigged.glb",
        posedPath: "assets/models/rina/crowd/fan_01_near_posed.glb",
        sourceHasRig: true,
        sourceHasAnimations: false,
        bytes: 764824,
        posedHeight: 1.091883,
      },
      middle: {
        riggedPath: "assets/models/rina/crowd/fan_01_middle_rigged.glb",
        posedPath: "assets/models/rina/crowd/fan_01_middle_posed.glb",
        sourceHasRig: true,
        sourceHasAnimations: false,
        bytes: 269204,
        posedHeight: 1.091883,
      },
    },
  },
  {
    id: "fan_04",
    type: "spectator",
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
];
