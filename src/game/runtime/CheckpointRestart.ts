import type { LevelId } from "./LevelTypes";

export const CHECKPOINT_RESTART_EVENT =
  "bosque:checkpoint-restart-requested" as const;
export const CHARACTER_SELECTION_RETURN_EVENT =
  "bosque:character-selection-return-requested" as const;

export type CheckpointRestartRequest = {
  level: LevelId;
  entryPoint: string;
};

export function requestCheckpointRestart(request: CheckpointRestartRequest) {
  window.dispatchEvent(
    new CustomEvent<CheckpointRestartRequest>(CHECKPOINT_RESTART_EVENT, {
      detail: request,
    })
  );
}

export function requestCharacterSelectionReturn() {
  window.dispatchEvent(new Event(CHARACTER_SELECTION_RETURN_EVENT));
}
