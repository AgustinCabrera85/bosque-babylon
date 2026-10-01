import type { PlayerStatsSystem } from "../PlayerStatsSystem";
import type { InputManager } from "./InputManager";

type GamepadFeedbackOptions = {
  input: InputManager;
  playerStats: PlayerStatsSystem;
};

export type GamepadFeedbackHandle = {
  update: (deltaSeconds: number, gameplayActive: boolean) => void;
  dispose: () => void;
};

const DAMAGE_SANITY_PAUSE_SECONDS = 0.45;
const LOW_SANITY_LONG_INTERVAL_SECONDS = 1.65;
const LOW_SANITY_SHORT_INTERVAL_SECONDS = 0.65;

export function setupGamepadFeedback({
  input,
  playerStats,
}: GamepadFeedbackOptions): GamepadFeedbackHandle {
  let previousHealth = playerStats.snapshot.health;
  let lowSanityCooldown = 0;
  let gameplayActive = false;
  let disposed = false;

  const unsubscribeStats = playerStats.onChange((event) => {
    const lostHealth = Math.max(0, previousHealth - event.snapshot.health);
    previousHealth = event.snapshot.health;
    if (!gameplayActive || lostHealth <= 0) return;

    const severity = clamp01((lostHealth / event.snapshot.maxHealth) * 5);
    input.rumbleGamepad({
      durationMs: lerp(140, 310, severity),
      strongMagnitude: lerp(0.38, 1, severity),
      weakMagnitude: lerp(0.2, 0.68, severity),
    });
    lowSanityCooldown = Math.max(lowSanityCooldown, DAMAGE_SANITY_PAUSE_SECONDS);
  });

  return {
    update(deltaSeconds, active) {
      if (disposed) return;
      if (!active) {
        if (gameplayActive) input.stopGamepadRumble();
        gameplayActive = false;
        lowSanityCooldown = 0;
        return;
      }

      gameplayActive = true;
      const snapshot = playerStats.snapshot;
      const threshold = Math.min(
        playerStats.config.lowSanityThreshold,
        snapshot.maxSanity
      );
      if (snapshot.isDead || threshold <= 0 || snapshot.sanity > threshold) {
        lowSanityCooldown = 0;
        return;
      }

      lowSanityCooldown -= Math.max(0, Math.min(deltaSeconds, 0.1));
      if (lowSanityCooldown > 0) return;

      const severity = clamp01(1 - snapshot.sanity / threshold);
      const played = input.rumbleGamepad({
        durationMs: lerp(95, 155, severity),
        strongMagnitude: lerp(0.07, 0.22, severity),
        weakMagnitude: lerp(0.14, 0.38, severity),
      });
      lowSanityCooldown = played
        ? lerp(
            LOW_SANITY_LONG_INTERVAL_SECONDS,
            LOW_SANITY_SHORT_INTERVAL_SECONDS,
            severity
          )
        : 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeStats();
      input.stopGamepadRumble();
    },
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * clamp01(amount);
}
