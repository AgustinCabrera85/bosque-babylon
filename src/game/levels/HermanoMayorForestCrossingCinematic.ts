import { Vector3, type Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { PlayerController } from "../PlayerController";
import type { HermanoMayorHandle } from "../enemies/boss/HermanoMayor";
import type { HermanoMayorNlaPlayback } from "../enemies/boss/HermanoMayorAnimations";

export const HERMANO_MAYOR_FOREST_CROSSING_TUNING = {
  triggerForwardDistance: 4.5,
  crossingForwardOffset: 22,
  crossingStartX: 10,
  crossingEndX: -10,
  crossingDurationSeconds: 5.4,
  cameraEntrySeconds: 0.65,
  cameraRecoverySeconds: 0.65,
  actorFocusHeight: 1.65,
  walkSpeedRatio: 0.73,
  walkBlendingSpeed: 0.08,
  glitchPulseWidth: 0.045,
  glitchPositionJitter: 0.22,
  glitchScaleJitter: 0.055,
  glitchFlickerDepth: 0.58,
} as const;

export type HermanoMayorForestCrossingState =
  | "waiting-note"
  | "waiting-progress"
  | "presenting"
  | "complete";

export type HermanoMayorForestCrossingCinematicOptions = {
  player: PlayerController;
  actor: HermanoMayorHandle;
  firstNotePosition: Vector3;
  getGroundHeight: (x: number, z: number) => number;
  onStart?: () => void;
};

type ProceduralPlaybackSnapshot = {
  action: string;
  enabled: boolean;
};

type ActorHomeState = {
  position: Vector3;
  rotation: Vector3;
  rotationQuaternion: Quaternion | null;
  scaling: Vector3;
  nlaPlayback: HermanoMayorNlaPlayback | null;
  proceduralActions: ProceduralPlaybackSnapshot[];
  meshVisibilities: number[];
};

export function hasReachedForestCrossingTrigger(
  pickupZ: number,
  currentZ: number,
  triggerDistance = HERMANO_MAYOR_FOREST_CROSSING_TUNING.triggerForwardDistance
) {
  return currentZ - pickupZ >= triggerDistance;
}

/** One-shot forest sighting that temporarily borrows the house boss instance. */
export class HermanoMayorForestCrossingCinematic {
  private readonly player: PlayerController;
  private readonly actor: HermanoMayorHandle;
  private readonly firstNotePosition: Vector3;
  private readonly getGroundHeight: (x: number, z: number) => number;
  private readonly onStart?: () => void;
  private readonly crossingZ: number;
  private readonly crossingStart = Vector3.Zero();
  private readonly crossingEnd = Vector3.Zero();
  private readonly entryCameraPosition = Vector3.Zero();
  private readonly entryCameraTarget = Vector3.Zero();
  private readonly focusTarget = Vector3.Zero();
  private readonly blendedCameraTarget = Vector3.Zero();
  private currentState: HermanoMayorForestCrossingState = "waiting-note";
  private pickupPosition: Vector3 | null = null;
  private homeState: ActorHomeState | null = null;
  private homePositionForDebug: Vector3 | null = null;
  private noteCollected = false;
  private completed = false;
  private disposed = false;
  private listeningForNote = false;
  private elapsed = 0;
  private actorRootGroundOffset = 0;
  private entryCameraFov = 0.9;
  private cameraDistance = 0;
  private cameraFov = 0.9;
  private glitchStrength = 0;

  private readonly onInventoryItemAdded = (event: Event) => {
    if (this.disposed || this.currentState !== "waiting-note") return;
    const detail = (event as CustomEvent<{ id?: string }>).detail;
    if (detail?.id !== "note-1") return;

    this.noteCollected = true;
    this.pickupPosition = this.player.position.clone();
    this.currentState = "waiting-progress";
    this.detachInventoryListener();
  };

  public constructor(options: HermanoMayorForestCrossingCinematicOptions) {
    this.player = options.player;
    this.actor = options.actor;
    this.firstNotePosition = options.firstNotePosition.clone();
    this.getGroundHeight = options.getGroundHeight;
    this.onStart = options.onStart;
    this.crossingZ =
      this.firstNotePosition.z +
      HERMANO_MAYOR_FOREST_CROSSING_TUNING.crossingForwardOffset;
    this.resolveCrossingEndpoints();
    window.addEventListener("bosque:inventory:add-item", this.onInventoryItemAdded);
    this.listeningForNote = true;
  }

  public get state() {
    return this.currentState;
  }

  public get isActive() {
    return this.currentState === "presenting";
  }

  public update(deltaSeconds: number) {
    if (this.disposed) return;
    if (this.currentState === "waiting-progress") {
      if (
        !this.pickupPosition ||
        !hasReachedForestCrossingTrigger(
          this.pickupPosition.z,
          this.player.position.z
        )
      ) {
        return;
      }
      if (
        this.player.isOpeningSequenceActive ||
        this.player.isCinematicSequenceActive ||
        this.player.isGameplayControlLocked
      ) {
        return;
      }
      this.startPresentation();
      return;
    }

    if (this.currentState !== "presenting") return;
    this.elapsed = Math.min(
      HERMANO_MAYOR_FOREST_CROSSING_TUNING.crossingDurationSeconds,
      this.elapsed + Math.max(0, deltaSeconds)
    );
    this.applyPresentationFrame(
      this.elapsed /
        HERMANO_MAYOR_FOREST_CROSSING_TUNING.crossingDurationSeconds
    );
    if (
      this.elapsed >=
      HERMANO_MAYOR_FOREST_CROSSING_TUNING.crossingDurationSeconds
    ) {
      this.finishPresentation(true);
    }
  }

  public forceForestCrossing() {
    if (
      !import.meta.env.DEV ||
      this.disposed ||
      this.currentState === "presenting" ||
      this.currentState === "complete"
    ) {
      return false;
    }

    this.noteCollected = true;
    this.pickupPosition = this.player.position.clone();
    this.pickupPosition.z -=
      HERMANO_MAYOR_FOREST_CROSSING_TUNING.triggerForwardDistance;
    this.currentState = "waiting-progress";
    this.detachInventoryListener();
    if (
      this.player.isOpeningSequenceActive ||
      this.player.isCinematicSequenceActive ||
      this.player.isGameplayControlLocked
    ) {
      return true;
    }
    return this.startPresentation();
  }

  public cancel() {
    if (this.disposed || this.currentState === "complete") return;
    this.detachInventoryListener();
    if (this.currentState === "presenting") {
      this.finishPresentation(false);
      return;
    }
    this.currentState = "complete";
  }

  public getDebugSnapshot() {
    const progress =
      this.currentState === "presenting"
        ? clamp01(
            this.elapsed /
              HERMANO_MAYOR_FOREST_CROSSING_TUNING.crossingDurationSeconds
          )
        : this.currentState === "complete"
          ? 1
          : 0;
    return {
      state: this.currentState,
      elapsed: this.elapsed,
      progress,
      noteCollected: this.noteCollected,
      pickupPosition: vectorSnapshot(this.pickupPosition),
      triggerDistance:
        HERMANO_MAYOR_FOREST_CROSSING_TUNING.triggerForwardDistance,
      crossingZ: this.crossingZ,
      crossingStart: vectorSnapshot(this.crossingStart),
      crossingEnd: vectorSnapshot(this.crossingEnd),
      actorPosition: vectorSnapshot(this.actor.root.position),
      homePosition: vectorSnapshot(this.homePositionForDebug),
      cameraPosition: vectorSnapshot(this.entryCameraPosition),
      cameraDistance: this.cameraDistance,
      cameraFov: this.cameraFov,
      glitchStrength: this.glitchStrength,
      isActive: this.isActive,
      completed: this.completed,
    };
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detachInventoryListener();
    if (this.currentState === "presenting") this.finishPresentation(false);
    document.body.classList.remove(
      "hermano-mayor-crossing-cinematic-active"
    );
  }

  private startPresentation() {
    if (
      this.disposed ||
      this.currentState !== "waiting-progress" ||
      this.player.isOpeningSequenceActive ||
      this.player.isCinematicSequenceActive ||
      this.player.isGameplayControlLocked
    ) {
      return false;
    }

    if (!this.player.beginCinematicSequence()) return false;

    try {
      // beginCinematicSequence normalizes the view to third person first. Keep
      // that exact viewpoint fixed and only pan its target toward the actor.
      this.player.camera.computeWorldMatrix();
      this.entryCameraPosition.copyFrom(this.player.camera.globalPosition);
      this.entryCameraTarget.copyFrom(
        this.entryCameraPosition.add(this.player.getLookRay().direction.scale(12))
      );
      this.entryCameraFov = this.player.camera.fov;
      this.homeState = this.captureActorHomeState();
      this.homePositionForDebug = this.homeState.position.clone();
      this.actorRootGroundOffset = this.resolveActorRootGroundOffset();
      this.resolveCrossingEndpoints();
      this.suspendProceduralActions(this.homeState.proceduralActions);

      const movementX = this.crossingEnd.x - this.crossingStart.x;
      const movementZ = this.crossingEnd.z - this.crossingStart.z;
      this.actor.root.rotationQuaternion = null;
      this.actor.root.rotation.set(
        0,
        Math.atan2(movementX, movementZ),
        0
      );
      this.actor.root.position.copyFrom(this.crossingStart);
      this.actor.root.computeWorldMatrix(true);
      this.actor.playLocomotion("walk", {
        loop: true,
        speedRatio:
          HERMANO_MAYOR_FOREST_CROSSING_TUNING.walkSpeedRatio,
        blendingSpeed:
          HERMANO_MAYOR_FOREST_CROSSING_TUNING.walkBlendingSpeed,
      });

      this.resolveFocusTarget();

      this.currentState = "presenting";
      this.elapsed = 0;
      this.completed = false;
      this.onStart?.();
      document.body.classList.add(
        "hermano-mayor-crossing-cinematic-active"
      );
      this.applyPresentationFrame(0);
      return true;
    } catch (error) {
      console.error(
        "[HermanoMayorForestCrossingCinematic] No se pudo iniciar la presentacion.",
        error
      );
      this.restoreActorHomeState();
      document.body.classList.remove(
        "hermano-mayor-crossing-cinematic-active"
      );
      this.currentState = "complete";
      this.player.endCinematicSequence(0.08);
      return false;
    }
  }

  private finishPresentation(completed: boolean) {
    if (this.currentState !== "presenting") return;
    try {
      if (completed) this.applyPresentationFrame(1);
    } finally {
      this.restoreActorHomeState();
      this.currentState = "complete";
      this.completed = completed;
      document.body.classList.remove(
        "hermano-mayor-crossing-cinematic-active"
      );
      this.player.endCinematicSequence(
        completed
          ? HERMANO_MAYOR_FOREST_CROSSING_TUNING.cameraRecoverySeconds
          : 0.08
      );
    }
  }

  private applyPresentationFrame(progress: number) {
    const amount = clamp01(progress);
    const easedTravel = lerp(amount, smoothstep(0, 1, amount), 0.22);
    const actorX = lerp(
      this.crossingStart.x,
      this.crossingEnd.x,
      easedTravel
    );
    const actorZ = this.crossingZ;
    const actorY =
      this.getGroundHeight(actorX, actorZ) +
      this.actorRootGroundOffset;
    this.applyModelGlitch(amount, actorX, actorY, actorZ);

    // The camera remains at the player's captured third-person viewpoint.
    // Only its look target pans across the forest as the distant figure walks.
    this.resolveFocusTarget(actorX, actorY, actorZ);
    const entryProgress = smoothstep(
      0,
      HERMANO_MAYOR_FOREST_CROSSING_TUNING.cameraEntrySeconds /
        HERMANO_MAYOR_FOREST_CROSSING_TUNING.crossingDurationSeconds,
      amount
    );
    Vector3.LerpToRef(
      this.entryCameraTarget,
      this.focusTarget,
      entryProgress,
      this.blendedCameraTarget
    );
    this.cameraFov = this.entryCameraFov;
    this.cameraDistance = Vector3.Distance(
      this.entryCameraPosition,
      this.focusTarget
    );
    this.player.setCinematicCamera(
      this.entryCameraPosition,
      this.blendedCameraTarget,
      0,
      this.cameraFov
    );
  }

  private applyModelGlitch(
    progress: number,
    actorX: number,
    actorY: number,
    actorZ: number
  ) {
    const root = this.actor.root;
    const home = this.homeState;
    this.glitchStrength = resolveGlitchStrength(progress);
    if (!home) {
      root.position.set(actorX, actorY, actorZ);
      root.computeWorldMatrix(true);
      return;
    }

    const tuning = HERMANO_MAYOR_FOREST_CROSSING_TUNING;
    const sample = Math.floor(
      progress * tuning.crossingDurationSeconds * 30
    );
    const noiseX = signedNoise(sample + 3);
    const noiseY = signedNoise(sample + 17);
    const noiseZ = signedNoise(sample + 31);
    root.position.set(
      actorX + noiseX * tuning.glitchPositionJitter * this.glitchStrength,
      actorY + noiseY * tuning.glitchPositionJitter * 0.28 * this.glitchStrength,
      actorZ + noiseZ * tuning.glitchPositionJitter * 0.45 * this.glitchStrength
    );
    root.scaling.copyFrom(home.scaling);
    root.scaling.x *=
      1 + noiseZ * tuning.glitchScaleJitter * this.glitchStrength;
    root.scaling.y *=
      1 - noiseX * tuning.glitchScaleJitter * 0.45 * this.glitchStrength;
    root.scaling.z *=
      1 + noiseY * tuning.glitchScaleJitter * 0.6 * this.glitchStrength;

    const hardFlicker = signedNoise(sample + 47) > 0.34 ? 1 : 0.18;
    const visibilityMultiplier =
      1 -
      tuning.glitchFlickerDepth *
        hardFlicker *
        this.glitchStrength;
    for (let index = 0; index < this.actor.meshes.length; index++) {
      this.actor.meshes[index].visibility =
        (home.meshVisibilities[index] ?? 1) * visibilityMultiplier;
    }
    root.computeWorldMatrix(true);
  }

  private captureActorHomeState(): ActorHomeState {
    const proceduralActions: ProceduralPlaybackSnapshot[] = [];
    for (const action of this.actor.animations.getRegisteredActionNames()) {
      const procedural = this.actor.animations.getProcedural(action);
      if (!procedural) continue;
      proceduralActions.push({ action, enabled: procedural.enabled === true });
    }
    return {
      position: this.actor.root.position.clone(),
      rotation: this.actor.root.rotation.clone(),
      rotationQuaternion: this.actor.root.rotationQuaternion?.clone() ?? null,
      scaling: this.actor.root.scaling.clone(),
      nlaPlayback: this.actor.animations.getCurrentNlaPlayback(),
      proceduralActions,
      meshVisibilities: this.actor.meshes.map((mesh) => mesh.visibility),
    };
  }

  private suspendProceduralActions(
    proceduralActions: readonly ProceduralPlaybackSnapshot[]
  ) {
    // Some cancellation hooks can re-enable another layer, so settle ownership
    // with a second pass before the crossing locomotion takes over.
    for (let pass = 0; pass < 2; pass++) {
      for (const snapshot of proceduralActions) {
        this.actor.animations.getProcedural(snapshot.action)?.setEnabled(false);
      }
    }
  }

  private restoreActorHomeState() {
    const home = this.homeState;
    if (!home) return;
    this.homeState = null;

    this.actor.animations.stop();
    this.actor.root.position.copyFrom(home.position);
    this.actor.root.rotation.copyFrom(home.rotation);
    this.actor.root.rotationQuaternion =
      home.rotationQuaternion?.clone() ?? null;
    this.actor.root.scaling.copyFrom(home.scaling);
    for (let index = 0; index < this.actor.meshes.length; index++) {
      this.actor.meshes[index].visibility =
        home.meshVisibilities[index] ?? this.actor.meshes[index].visibility;
    }
    this.glitchStrength = 0;
    this.actor.root.computeWorldMatrix(true);
    for (const mesh of this.actor.meshes) mesh.computeWorldMatrix(true);

    if (home.nlaPlayback) {
      this.actor.animations.play(home.nlaPlayback.action, {
        ...home.nlaPlayback.options,
      });
    }
    for (const snapshot of home.proceduralActions) {
      this.actor.animations
        .getProcedural(snapshot.action)
        ?.setEnabled(snapshot.enabled);
    }
  }

  private resolveActorRootGroundOffset() {
    this.actor.root.computeWorldMatrix(true);
    let minimumY = Number.POSITIVE_INFINITY;
    for (const mesh of this.actor.meshes) {
      mesh.computeWorldMatrix(true);
      minimumY = Math.min(
        minimumY,
        mesh.getBoundingInfo().boundingBox.minimumWorld.y
      );
    }
    return Number.isFinite(minimumY)
      ? this.actor.root.position.y - minimumY
      : 0;
  }

  private resolveCrossingEndpoints() {
    const tuning = HERMANO_MAYOR_FOREST_CROSSING_TUNING;
    this.crossingStart.set(
      tuning.crossingStartX,
      this.getGroundHeight(tuning.crossingStartX, this.crossingZ) +
        this.actorRootGroundOffset,
      this.crossingZ
    );
    this.crossingEnd.set(
      tuning.crossingEndX,
      this.getGroundHeight(tuning.crossingEndX, this.crossingZ) +
        this.actorRootGroundOffset,
      this.crossingZ
    );
  }

  private resolveFocusTarget(
    x = this.actor.root.position.x,
    y = this.actor.root.position.y,
    z = this.actor.root.position.z
  ) {
    this.focusTarget.set(
      x,
      y + HERMANO_MAYOR_FOREST_CROSSING_TUNING.actorFocusHeight,
      z
    );
  }

  private detachInventoryListener() {
    if (!this.listeningForNote) return;
    window.removeEventListener(
      "bosque:inventory:add-item",
      this.onInventoryItemAdded
    );
    this.listeningForNote = false;
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function resolveGlitchStrength(progress: number) {
  const width = HERMANO_MAYOR_FOREST_CROSSING_TUNING.glitchPulseWidth;
  return Math.max(
    glitchPulse(progress, 0.18, width),
    glitchPulse(progress, 0.48, width),
    glitchPulse(progress, 0.72, width),
    glitchPulse(progress, 0.9, width)
  );
}

function glitchPulse(progress: number, center: number, width: number) {
  return smoothstep(
    0,
    1,
    1 - Math.abs(progress - center) / Math.max(0.0001, width)
  );
}

function signedNoise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function vectorSnapshot(value: Vector3 | null) {
  return value ? { x: value.x, y: value.y, z: value.z } : null;
}
