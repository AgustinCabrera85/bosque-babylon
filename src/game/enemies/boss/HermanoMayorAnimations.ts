import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

/**
 * NLA actions authored in Hermano_mayor_Final_NLA.glb.
 *
 * This catalog deliberately lives outside PlayerController: the boss can share
 * authored clip names with the playable characters without extending or
 * replacing their animation registry.
 */
export const HERMANO_MAYOR_NLA_ACTIONS = {
  idle: "Idle",
  jump: "Jump_InPlace",
  strafeLeftRun: "Left_Strafe_Run_InPlace",
  strafeLeftWalk: "Left_Strafe_Walk_InPlace",
  openDoor: "OpenDoor",
  pickUpItem: "PickUpItem",
  strafeRightRun: "Right_Strafe_Run_InPlace",
  strafeRightWalk: "Right_Strafe_Walk_InPlace",
  run: "Run_InPlace",
  turnLeft: "Turn_Left",
  turnRight: "Turn_Right",
  walkBackward: "Walk_Backwards_InPlace",
  walk: "Walk_InPlace",
} as const;

export type HermanoMayorNlaAction = keyof typeof HERMANO_MAYOR_NLA_ACTIONS;

export type HermanoMayorPlayOptions = {
  loop?: boolean;
  speedRatio?: number;
  from?: number;
  to?: number;
  blendingSpeed?: number;
};

export type HermanoMayorNlaPlayback = {
  action: string;
  options: HermanoMayorPlayOptions;
};

export interface HermanoMayorProceduralAction {
  readonly enabled?: boolean;
  setEnabled(enabled: boolean): void;
  dispose?(): void;
}

const NLA_ACTION_BY_GROUP_NAME = new Map<string, HermanoMayorNlaAction>(
  Object.entries(HERMANO_MAYOR_NLA_ACTIONS).map(([action, groupName]) => [
    groupName,
    action as HermanoMayorNlaAction,
  ])
);

/** Boss-owned registry. Procedural actions remain layered over the active NLA. */
export class HermanoMayorAnimationRegistry {
  private readonly actions = new Map<string, AnimationGroup>();
  private readonly proceduralActions = new Map<string, HermanoMayorProceduralAction>();
  private currentAction: string | null = null;
  private currentOptions: HermanoMayorPlayOptions | null = null;

  public constructor(importedGroups: readonly AnimationGroup[]) {
    for (const group of importedGroups) {
      group.stop();
      // Unknown future clips are still registered under their authored name.
      this.register(NLA_ACTION_BY_GROUP_NAME.get(group.name) ?? group.name, group);
    }
  }

  public registerProcedural(action: string, procedural: HermanoMayorProceduralAction) {
    const previous = this.proceduralActions.get(action);
    if (previous && previous !== procedural) previous.dispose?.();
    this.proceduralActions.set(action, procedural);
  }

  public has(action: string) {
    return this.actions.has(action) || this.proceduralActions.has(action);
  }

  public get(action: string) {
    return this.actions.get(action) ?? null;
  }

  public getProcedural(action: string) {
    return this.proceduralActions.get(action) ?? null;
  }

  public getRegisteredActionNames() {
    return [...this.actions.keys(), ...this.proceduralActions.keys()];
  }

  public getCurrentNlaPlayback(): HermanoMayorNlaPlayback | null {
    if (!this.currentAction) return null;
    return {
      action: this.currentAction,
      options: { ...(this.currentOptions ?? {}) },
    };
  }

  public play(action: string, options: HermanoMayorPlayOptions = {}) {
    const procedural = this.proceduralActions.get(action);
    if (procedural) {
      procedural.setEnabled(true);
      return procedural;
    }

    const group = this.actions.get(action);
    if (!group) {
      console.warn(`[HermanoMayor] Accion no registrada: '${action}'.`);
      return null;
    }

    if (this.currentAction && this.currentAction !== action) {
      this.actions.get(this.currentAction)?.stop();
    }
    if (group.isPlaying) group.stop();

    group.enableBlending = true;
    group.blendingSpeed = options.blendingSpeed ?? 0.08;

    group.start(
      options.loop ?? false,
      options.speedRatio ?? 1,
      options.from,
      options.to
    );
    this.currentAction = action;
    this.currentOptions = { ...options };
    return group;
  }

  public stop(action?: string) {
    if (action) {
      const procedural = this.proceduralActions.get(action);
      if (procedural) {
        procedural.setEnabled(false);
        return;
      }
      this.actions.get(action)?.stop();
      if (this.currentAction === action) {
        this.currentAction = null;
        this.currentOptions = null;
      }
      return;
    }

    for (const group of new Set(this.actions.values())) group.stop();
    for (const procedural of this.proceduralActions.values()) {
      procedural.setEnabled(false);
    }
    this.currentAction = null;
    this.currentOptions = null;
  }

  private register(action: string, group: AnimationGroup) {
    const previous = this.actions.get(action);
    if (previous && previous !== group) previous.stop();
    this.actions.set(action, group);
  }
}
