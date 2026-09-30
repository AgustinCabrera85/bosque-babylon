import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ThoughtMessagesHandle } from "../../ThoughtMessages";
import type { MaskFieldHandle } from "./MaskField";

const PHASE_MESSAGES = [
  "Subí. No mires demasiado tiempo a los rostros.",
  "Los rostros ya saben que estás acá.",
  "Algunas máscaras ríen. Otras parecen pedirte que vuelvas.",
  "La escalera no conduce afuera. Conduce a escena.",
  "No confundas la luz con una salida.",
] as const;

export class TheatreDirector {
  private lastPhase = -1;

  constructor(
    private readonly masks: MaskFieldHandle,
    private readonly messages: ThoughtMessagesHandle,
    private readonly stairStartZ: number,
    private readonly stairEndZ: number
  ) {}

  update(playerPosition: Vector3) {
    const progress = Math.max(
      0,
      Math.min(
        1,
        (playerPosition.z - this.stairStartZ) /
          Math.max(0.001, this.stairEndZ - this.stairStartZ)
      )
    );
    const phase = progress < 0.2 ? 0 : progress < 0.45 ? 1 : progress < 0.72 ? 2 : progress < 0.9 ? 3 : 4;
    if (phase === this.lastPhase) return;
    this.lastPhase = phase;
    this.masks.setFollowPlayer(phase >= 1);
    void this.messages.showSequence([PHASE_MESSAGES[phase]]);
  }
}
