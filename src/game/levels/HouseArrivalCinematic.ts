import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerController } from "../PlayerController";

export const HOUSE_ARRIVAL_PRESENTATION_SECONDS = 7.5;
const HOUSE_STREAMING_PREPARE_DELAY_SECONDS = 0.45;
const PLAYER_CAMERA_FOV = 0.9;

export type HouseArrivalCinematicState = "waiting" | "presenting" | "complete";

export type HouseArrivalCinematicOptions = {
  player: PlayerController;
  housePosition: Vector3;
  triggerZ: number;
  segmentBoundaryZ: number;
  getGroundHeight: (x: number, z: number) => number;
  presentationSeconds?: number;
  compactFraming?: boolean;
  onStart?: () => void;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

/** One-shot camera reveal that presents the path and house facade on arrival. */
export class HouseArrivalCinematic {
  private readonly player: PlayerController;
  private readonly housePosition: Vector3;
  private readonly triggerZ: number;
  private readonly segmentBoundaryZ: number;
  private readonly getGroundHeight: (x: number, z: number) => number;
  private readonly presentationSeconds: number;
  private readonly compactFraming: boolean;
  private readonly onStart?: () => void;
  private currentState: HouseArrivalCinematicState = "waiting";
  private presentationStartedAt = 0;
  private elapsed = 0;
  private houseSegmentReached = false;
  private entryCameraPosition = Vector3.Zero();
  private entryCameraTarget = Vector3.Zero();
  private approachStartZ = 0;

  public constructor(options: HouseArrivalCinematicOptions) {
    this.player = options.player;
    this.housePosition = options.housePosition.clone();
    this.triggerZ = options.triggerZ;
    this.segmentBoundaryZ = options.segmentBoundaryZ;
    this.getGroundHeight = options.getGroundHeight;
    this.presentationSeconds = Math.max(
      0.1,
      options.presentationSeconds ?? HOUSE_ARRIVAL_PRESENTATION_SECONDS
    );
    this.compactFraming = options.compactFraming ?? false;
    this.onStart = options.onStart;
  }

  public get state() {
    return this.currentState;
  }

  /** Pins the final streaming window only until the player crosses it naturally. */
  public get shouldPrepareHouseSegment() {
    if (this.houseSegmentReached) return false;
    if (this.player.position.z < this.triggerZ - 1) return false;
    if (this.currentState === "complete") return true;
    return (
      this.currentState === "presenting" &&
      this.elapsed >= HOUSE_STREAMING_PREPARE_DELAY_SECONDS
    );
  }

  public update(_deltaTimeSeconds: number) {
    if (this.player.position.z >= this.segmentBoundaryZ) {
      this.houseSegmentReached = true;
    }
    if (this.currentState === "waiting") {
      if (
        this.player.position.z >= this.triggerZ &&
        !this.player.isOpeningSequenceActive &&
        !this.player.isCinematicSequenceActive
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
    if (this.currentState !== "waiting") return false;

    this.player.camera.computeWorldMatrix();
    const entryPosition = this.player.camera.globalPosition.clone();
    const entryTarget = entryPosition.add(this.player.getLookRay().direction.scale(12));
    if (!this.player.beginCinematicSequence()) return false;

    this.entryCameraPosition.copyFrom(entryPosition);
    this.entryCameraTarget.copyFrom(entryTarget);
    this.approachStartZ = Math.min(
      this.player.position.z + 2,
      this.housePosition.z - 36
    );
    this.currentState = "presenting";
    this.presentationStartedAt = performance.now();
    this.elapsed = 0;
    this.onStart?.();
    document.body.classList.add("house-arrival-cinematic-active");
    this.applyPresentationFrame(0);
    window.dispatchEvent(
      new CustomEvent("bosque:house-arrival", {
        detail: { state: "presentation-started" },
      })
    );
    return true;
  }

  public finishPresentation() {
    if (this.currentState !== "presenting") return;
    this.applyPresentationFrame(1);
    this.currentState = "complete";
    this.player.endCinematicSequence(0.08);
    document.body.classList.remove("house-arrival-cinematic-active");
    window.dispatchEvent(
      new CustomEvent("bosque:house-arrival", {
        detail: { state: "complete" },
      })
    );
  }

  public getDebugSnapshot() {
    return {
      state: this.currentState,
      elapsed: this.elapsed,
      duration: this.presentationSeconds,
      triggerZ: this.triggerZ,
      segmentBoundaryZ: this.segmentBoundaryZ,
      preparingHouseSegment: this.shouldPrepareHouseSegment,
      housePosition: this.housePosition.clone(),
    };
  }

  public dispose() {
    document.body.classList.remove("house-arrival-cinematic-active");
    if (this.currentState === "presenting") {
      this.player.endCinematicSequence(0.08);
    }
  }

  private applyPresentationFrame(progress: number) {
    const amount = clamp01(progress);
    const enter = smoothstep(0, 0.1, amount);
    const drive = clamp01((amount - 0.045) / (0.875 - 0.045));
    const brake = smoothstep(0.875, 0.955, amount);
    const chaos = smoothstep(0.04, 0.12, amount) * (1 - brake);
    const compactScale = this.compactFraming ? 0.58 : 1;
    // Cover almost the whole route at speed, then spend the last few metres in
    // a short hard brake instead of orbiting or panning around the facade.
    const approach = drive * 0.965 + brake * 0.035;
    const phase = approach * Math.PI;
    const irregularRush = clamp01(
      approach + Math.sin(phase * 4.5) * 0.018 * chaos * (1 - approach)
    );
    const pathEndDistance = this.compactFraming ? 5.2 : 3.8;
    const pathZ =
      this.approachStartZ +
      (this.housePosition.z - pathEndDistance - this.approachStartZ) * irregularRush;
    const lateralSway =
      (Math.sin(phase * 6.2) * 1.05 + Math.sin(phase * 15.7 + 0.8) * 0.38) *
      chaos *
      compactScale;
    const verticalJolt =
      (Math.sin(phase * 17.3) * 0.1 + Math.abs(Math.sin(phase * 9.1)) * 0.16) *
      chaos;
    const brakeKick = Math.sin(brake * Math.PI);
    const cameraX = this.housePosition.x + lateralSway;
    const cameraZ = pathZ - brakeKick * 0.34;
    const groundPosition = new Vector3(
      cameraX,
      this.getGroundHeight(cameraX, cameraZ) +
        0.54 +
        verticalJolt +
        brake * 0.66 +
        brakeKick * 0.08,
      cameraZ
    );

    const lookAheadZ = Math.min(
      pathZ + 10 + irregularRush * 5,
      this.housePosition.z - 0.6
    );
    const targetSway =
      Math.sin(phase * 11.6 + 1.1) * 0.42 * chaos * compactScale;
    const groundTarget = new Vector3(
      this.housePosition.x + targetSway,
      this.getGroundHeight(this.housePosition.x + targetSway, lookAheadZ) +
        1.05 +
        Math.sin(phase * 13.4) * 0.08 * chaos,
      lookAheadZ
    );

    const doorTarget = this.housePosition.add(new Vector3(0, 0.15, 0));
    const movingTarget = Vector3.Lerp(groundTarget, doorTarget, brake);
    const roll =
      (Math.sin(phase * 7.1) * 0.038 + Math.sin(phase * 18.7 + 0.4) * 0.016) *
      chaos *
      compactScale;
    const fieldOfView =
      PLAYER_CAMERA_FOV +
      (this.compactFraming ? 0.08 : 0.14) * chaos -
      brakeKick * 0.045;

    this.player.setCinematicCamera(
      Vector3.Lerp(this.entryCameraPosition, groundPosition, enter),
      Vector3.Lerp(this.entryCameraTarget, movingTarget, enter),
      roll,
      fieldOfView
    );
  }
}
