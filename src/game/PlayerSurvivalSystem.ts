import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerController } from "./PlayerController";
import {
  getEyeGazeDrainRate,
  type PlayerStatsSystem,
  type SanityRecoveryMode,
} from "./PlayerStatsSystem";

export type PlayerSurvivalEnvironment = {
  onLitPath: boolean;
  inWeakLight: boolean;
  inSanctuary: boolean;
  inTotalDarkness: boolean;
};

export type NearbyThreatSnapshot = {
  state: string;
  playerDistance: number;
  portalPosition: Vector3;
};

type PlayerSurvivalSystemOptions = {
  player: PlayerController;
  stats: PlayerStatsSystem;
  desktopInputEnabled: boolean;
  isGameplayActive?: () => boolean;
  getEnvironment: () => PlayerSurvivalEnvironment;
  isSurrounded: () => boolean;
  getEyeGaze: () => { active: boolean; hasLineOfSight: boolean };
};

/**
 * Gameplay bridge for contextual drains/recovery and hold controls.
 * It is advanced by createScene's existing update observer.
 */
export class PlayerSurvivalSystem {
  private readonly abortController = new AbortController();
  private offLitPathElapsed = 0;
  private eyeGazeExposure = 0;
  private threatSampleElapsed = 0.1;
  private surrounded = false;
  private eyeGaze = { active: false, hasLineOfSight: false };
  private disposed = false;

  public constructor(private readonly options: PlayerSurvivalSystemOptions) {
    const signal = this.abortController.signal;
    if (options.desktopInputEnabled) {
      window.addEventListener("keydown", this.onKeyDown, { signal });
      window.addEventListener("keyup", this.onKeyUp, { signal });
    }
    window.addEventListener("blur", this.onBlur, { signal });
    document.addEventListener("visibilitychange", this.onVisibilityChange, { signal });
    window.addEventListener("bosque:pause", this.onPause, { signal });
    window.addEventListener("bosque:save", this.onSave, { signal });
    window.addEventListener("bosque:sky-eye", this.onSkyEyeEvent, { signal });
  }

  public startLightAbsorption = () => {
    if (
      this.disposed ||
      this.options.player.isGameplayControlLocked ||
      this.options.player.isRunning ||
      this.options.player.isDiving ||
      this.options.stats.hasActiveShadowGrabberCapture
    ) {
      return false;
    }
    return this.options.stats.startLightAbsorption();
  };

  public releaseLightAbsorption = () => {
    this.options.stats.releaseLightAbsorption();
  };

  public cancelLightAbsorption = () => {
    this.options.stats.cancelLightAbsorption("controls-locked");
  };

  public update(deltaTimeSeconds: number) {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(deltaTimeSeconds, 0.1));
    const { player, stats } = this.options;
    if (
      this.options.isGameplayActive?.() === false ||
      player.isGameplayControlLocked
    ) {
      stats.cancelLightAbsorption("controls-locked");
      this.offLitPathElapsed = 0;
      this.eyeGazeExposure = 0;
      this.surrounded = false;
      this.eyeGaze = { active: false, hasLineOfSight: false };
      stats.update(dt, { active: false });
      return;
    }
    if (player.isRunning) stats.cancelLightAbsorption("running");
    if (player.isDiving) stats.cancelLightAbsorption("drowning");
    if (stats.hasActiveShadowGrabberCapture || player.isUnderEnemyGrabPressure) {
      stats.cancelLightAbsorption("grab");
    }

    const environment = this.options.getEnvironment();
    const offLitPath = !environment.onLitPath && !environment.inSanctuary;
    this.offLitPathElapsed = offLitPath ? this.offLitPathElapsed + dt : 0;
    const environmentDrainPerSecond =
      this.offLitPathElapsed > stats.config.offLitPathGraceSeconds
        ? stats.config.offLitPathSanityDrainPerSecond
        : 0;
    const darknessDrainPerSecond = environment.inTotalDarkness
      ? stats.config.totalDarknessSanityDrainPerSecond *
        (player.isRunning ? stats.config.darknessRunningMultiplier : 1)
      : 0;

    this.threatSampleElapsed += dt;
    if (this.threatSampleElapsed >= 0.1) {
      this.threatSampleElapsed = 0;
      this.surrounded = this.options.isSurrounded();
      this.eyeGaze = this.options.getEyeGaze();
    }
    const eye = this.eyeGaze;
    if (eye.active && eye.hasLineOfSight) this.eyeGazeExposure += dt;
    else {
      this.eyeGazeExposure = Math.max(
        0,
        this.eyeGazeExposure - stats.config.eyeGazeExposureDecayPerSecond * dt
      );
    }
    const eyeDrainPerSecond =
      eye.active && eye.hasLineOfSight
        ? getEyeGazeDrainRate(this.eyeGazeExposure, stats.config)
        : 0;
    const surroundedDrainPerSecond = this.surrounded
      ? stats.config.surroundedSanityDrainPerSecond
      : 0;
    const recoveryMode: SanityRecoveryMode = environment.inSanctuary
      ? "sanctuary"
      : environment.onLitPath
        ? "lit-path"
        : environment.inWeakLight
          ? "weak-light"
          : "none";

    stats.update(dt, {
      darknessDrainPerSecond,
      environmentDrainPerSecond,
      threatDrainPerSecond: eyeDrainPerSecond + surroundedDrainPerSecond,
      recoveryMode,
      canRegenerateHealth:
        !player.isDiving &&
        !player.isUnderEnemyGrabPressure &&
        !stats.hasActiveShadowGrabberCapture,
      inSanctuary: environment.inSanctuary,
    });
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.options.stats.cancelLightAbsorption("disposed");
    this.abortController.abort();
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "KeyQ" || event.repeat) return;
    event.preventDefault();
    this.startLightAbsorption();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (event.code !== "KeyQ") return;
    event.preventDefault();
    this.releaseLightAbsorption();
  };

  private readonly onBlur = () => {
    this.options.stats.cancelLightAbsorption("controls-locked");
  };

  private readonly onVisibilityChange = () => {
    if (document.visibilityState !== "visible") {
      this.options.stats.cancelLightAbsorption("controls-locked");
    }
  };

  private readonly onPause = (event: Event) => {
    if ((event as CustomEvent<{ paused?: boolean }>).detail?.paused) {
      this.options.stats.cancelLightAbsorption("pause");
    }
  };

  private readonly onSave = () => {
    this.options.stats.save();
  };

  private readonly onSkyEyeEvent = (event: Event) => {
    const state = (event as CustomEvent<{ state?: string }>).detail?.state;
    if (state === "presentation-started") {
      this.options.stats.applyNarrativeSanityImpact(
        "terminal-sky-eye-reveal",
        -this.options.stats.config.skyEyeRevealSanityLoss
      );
    }
  };
}

/** Requires close, attack-committed threats with LOS from distinct angles. */
export function isPlayerPhysicallySurrounded(
  playerPosition: Vector3,
  threats: readonly NearbyThreatSnapshot[],
  hasLineOfSight: (origin: Vector3, target: Vector3) => boolean
) {
  const committedStates = new Set(["telegraphing", "attacking", "grabbing", "holding"]);
  const angles = threats
    .filter(
      (threat) =>
        committedStates.has(threat.state) &&
        threat.playerDistance <= 6.2 &&
        hasLineOfSight(threat.portalPosition, playerPosition)
    )
    .map((threat) =>
      Math.atan2(
        threat.portalPosition.z - playerPosition.z,
        threat.portalPosition.x - playerPosition.x
      )
    );
  if (angles.length < 2) return false;
  for (let first = 0; first < angles.length; first++) {
    for (let second = first + 1; second < angles.length; second++) {
      let difference = Math.abs(angles[first] - angles[second]);
      difference = Math.min(difference, Math.PI * 2 - difference);
      if (difference >= Math.PI * 0.38) return true;
    }
  }
  return false;
}
