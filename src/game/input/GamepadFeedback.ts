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
const INTENSE_GRAB_REFRESH_SECONDS = 0.38;
const HERMANO_MAYOR_GRAB_HAPTIC_EVENT = "bosque:hermano-mayor-grab-haptics";

export function setHermanoMayorGrabHapticsActive(active: boolean) {
  window.dispatchEvent(new CustomEvent(HERMANO_MAYOR_GRAB_HAPTIC_EVENT, {
    detail: { active },
  }));
}

export function setupGamepadFeedback({
  input,
  playerStats,
}: GamepadFeedbackOptions): GamepadFeedbackHandle {
  let previousHealth = playerStats.snapshot.health;
  let lowSanityCooldown = 0;
  let intenseGrabCooldown = 0;
  let intenseGrabActive = false;
  let gameplayActive = false;
  let disposed = false;

  const onHermanoMayorGrabHaptics = (event: Event) => {
    intenseGrabActive =
      (event as CustomEvent<{ active?: boolean }>).detail?.active === true;
    intenseGrabCooldown = 0;
    if (!intenseGrabActive) {
      input.stopGamepadRumble();
      lowSanityCooldown = Math.max(lowSanityCooldown, 0.3);
    }
  };
  window.addEventListener(
    HERMANO_MAYOR_GRAB_HAPTIC_EVENT,
    onHermanoMayorGrabHaptics
  );

  const unsubscribeStats = playerStats.onChange((event) => {
    const lostHealth = Math.max(0, previousHealth - event.snapshot.health);
    previousHealth = event.snapshot.health;
    if (!gameplayActive || lostHealth <= 0) return;

    const severity = clamp01((lostHealth / event.snapshot.maxHealth) * 5);
    if (intenseGrabActive) {
      input.rumbleGamepad({
        durationMs: 560,
        strongMagnitude: 1,
        weakMagnitude: 0.95,
      });
      intenseGrabCooldown = INTENSE_GRAB_REFRESH_SECONDS;
    } else {
      input.rumbleGamepad({
        durationMs: lerp(140, 310, severity),
        strongMagnitude: lerp(0.38, 1, severity),
        weakMagnitude: lerp(0.2, 0.68, severity),
      });
    }
    lowSanityCooldown = Math.max(lowSanityCooldown, DAMAGE_SANITY_PAUSE_SECONDS);
  });

  return {
    update(deltaSeconds, active) {
      if (disposed) return;
      if (!active) {
        if (gameplayActive) input.stopGamepadRumble();
        gameplayActive = false;
        lowSanityCooldown = 0;
        intenseGrabCooldown = 0;
        return;
      }

      gameplayActive = true;
      const safeDeltaSeconds = Math.max(0, Math.min(deltaSeconds, 0.1));
      if (intenseGrabActive) {
        intenseGrabCooldown -= safeDeltaSeconds;
        if (intenseGrabCooldown <= 0) {
          const played = input.rumbleGamepad({
            durationMs: 560,
            strongMagnitude: 1,
            weakMagnitude: 0.95,
          });
          intenseGrabCooldown = played ? INTENSE_GRAB_REFRESH_SECONDS : 0;
        }
        return;
      }

      const snapshot = playerStats.snapshot;
      const threshold = Math.min(
        playerStats.config.lowSanityThreshold,
        snapshot.maxSanity
      );
      if (snapshot.isDead || threshold <= 0 || snapshot.sanity > threshold) {
        lowSanityCooldown = 0;
        return;
      }

      lowSanityCooldown -= safeDeltaSeconds;
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
      window.removeEventListener(
        HERMANO_MAYOR_GRAB_HAPTIC_EVENT,
        onHermanoMayorGrabHaptics
      );
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
