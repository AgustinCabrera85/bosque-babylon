import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerController } from "../PlayerController";
import { isPointInsideWaterSurface, type WaterSurfaceInfo } from "../WaterSurface";
import type { SkyEyeController } from "../enemies";

export const SKY_EYE_PRESENTATION_SECONDS = 8;

export type TerminalSkyEyeEncounterState =
  | "dormant"
  | "presenting"
  | "watching";

export type TerminalSkyEyeEncounterOptions = {
  player: PlayerController;
  eye: SkyEyeController;
  waterSurface: WaterSurfaceInfo;
  emergencePosition: Vector3;
  hoverPosition: Vector3;
  triggerMargin?: number;
  presentationSeconds?: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

/** One-shot terminal encounter: lake trigger, eight-second reveal, then watch state. */
export class TerminalSkyEyeEncounter {
  private readonly player: PlayerController;
  private readonly eye: SkyEyeController;
  private readonly waterSurface: WaterSurfaceInfo;
  private readonly emergencePosition: Vector3;
  private readonly hoverPosition: Vector3;
  private readonly triggerMargin: number;
  private readonly presentationSeconds: number;
  private currentState: TerminalSkyEyeEncounterState = "dormant";
  private elapsed = 0;
  private presentationStartedAt = 0;

  public constructor(options: TerminalSkyEyeEncounterOptions) {
    this.player = options.player;
    this.eye = options.eye;
    this.waterSurface = options.waterSurface;
    this.emergencePosition = options.emergencePosition.clone();
    this.hoverPosition = options.hoverPosition.clone();
    this.triggerMargin = options.triggerMargin ?? 1.25;
    this.presentationSeconds = Math.max(
      0.1,
      options.presentationSeconds ?? SKY_EYE_PRESENTATION_SECONDS
    );

    this.eye.setPosition(this.emergencePosition);
    this.eye.setEnabled(false);
  }

  public get state() {
    return this.currentState;
  }

  public update(deltaTimeSeconds: number) {
    if (this.currentState === "dormant") {
      if (
        !this.player.isOpeningSequenceActive &&
        !this.player.isCinematicSequenceActive &&
        isPointInsideWaterSurface(
          this.waterSurface,
          this.player.position,
          this.triggerMargin
        )
      ) {
        this.startPresentation();
      }
      return;
    }

    if (this.currentState !== "presenting") return;
    const wallElapsed = (performance.now() - this.presentationStartedAt) / 1000;
    this.elapsed = Math.min(this.presentationSeconds, Math.max(0, wallElapsed));
    this.applyPresentationFrame(this.elapsed / this.presentationSeconds);
    if (this.elapsed >= this.presentationSeconds) this.finishPresentation();
  }

  public startPresentation() {
    if (this.currentState !== "dormant") return false;
    if (!this.player.beginCinematicSequence()) return false;

    this.currentState = "presenting";
    this.elapsed = 0;
    this.presentationStartedAt = performance.now();
    this.eye.setPosition(this.emergencePosition);
    this.eye.setEnabled(true);
    this.eye.snapLookAt(this.player.position);
    document.body.classList.add("sky-eye-cinematic-active");
    this.applyPresentationFrame(0);
    window.dispatchEvent(
      new CustomEvent("bosque:sky-eye", {
        detail: { state: "presentation-started" },
      })
    );
    return true;
  }

  public finishPresentation() {
    if (this.currentState !== "presenting") return;
    this.applyPresentationFrame(1);
    this.eye.setPosition(this.hoverPosition);
    this.currentState = "watching";
    this.player.endCinematicSequence();
    document.body.classList.remove("sky-eye-cinematic-active");
    window.dispatchEvent(
      new CustomEvent("bosque:sky-eye", {
        detail: { state: "watching" },
      })
    );
  }

  public getDebugSnapshot() {
    return {
      state: this.currentState,
      elapsed: this.elapsed,
      duration: this.presentationSeconds,
      emergencePosition: this.emergencePosition.clone(),
      hoverPosition: this.hoverPosition.clone(),
      eyePosition: this.eye.root.position.clone(),
    };
  }

  public dispose() {
    document.body.classList.remove("sky-eye-cinematic-active");
    if (this.currentState === "presenting") {
      this.player.endCinematicSequence(0.08);
    }
  }

  private applyPresentationFrame(progress: number) {
    const amount = clamp01(progress);
    const emergence = smoothstep(0.06, 0.78, amount);
    const eyePosition = Vector3.Lerp(
      this.emergencePosition,
      this.hoverPosition,
      emergence
    );
    this.eye.setPosition(eyePosition);

    // A single lateral take reveals the scale of the eye while its vertical
    // motion remains readable against the waterfall and both candle flames.
    const pan = smoothstep(0, 0.94, amount);
    const cameraPosition = new Vector3(
      this.hoverPosition.x + (-19 + pan * 38),
      this.waterSurface.waterLevel + 7.5 + pan * 7.5,
      this.hoverPosition.z - 27 + Math.sin(pan * Math.PI) * 2.5
    );
    const target = Vector3.Lerp(
      eyePosition,
      this.hoverPosition,
      smoothstep(0.58, 1, amount) * 0.35
    );
    this.player.setCinematicCamera(cameraPosition, target);
  }
}
