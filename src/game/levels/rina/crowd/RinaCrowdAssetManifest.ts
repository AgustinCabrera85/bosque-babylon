export type RinaCrowdQuality = "near" | "middle";

export interface RinaCrowdFanAsset {
  readonly id: string;
  readonly type: "spectator";
  readonly targetWorldHeight: number;
  readonly variants: Readonly<Record<RinaCrowdQuality, Readonly<{
    /** Original skinned asset, retained for future Mixamo clips. */
    riggedPath: string;
    /** Arm pose baked once so a single mesh can use thin instances. */
    posedPath: string;
    sourceHasRig: boolean;
    sourceHasAnimations: boolean;
    bytes: number;
    posedHeight: number;
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
];
