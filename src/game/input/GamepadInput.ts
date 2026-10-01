import {
  GAME_ACTIONS,
  type DeviceInputSnapshot,
  type GameAction,
  type InputDeviceAdapter,
  type InputSettings,
  type InputVector2,
} from "./InputActions";
import type {
  GamepadAxisPair,
  GamepadBinding,
  GamepadBindings,
} from "./InputBindings";

type RawGamepadState = {
  axes: number[];
  buttons: boolean[];
};

export class GamepadInput implements InputDeviceAdapter {
  public readonly type = "gamepad" as const;

  private readonly abortController = new AbortController();
  private readonly previousHeld = new Set<GameAction>();
  private readonly cancelled = new Set<GameAction>();
  private readonly rawStates = new Map<number, RawGamepadState>();
  private activeIndex: number | null = null;
  private lastActivityTimestamp = 0;

  public constructor(
    private bindings: GamepadBindings,
    private settings: InputSettings
  ) {
    const signal = this.abortController.signal;
    window.addEventListener("gamepadconnected", this.onGamepadConnected, { signal });
    window.addEventListener("gamepaddisconnected", this.onGamepadDisconnected, { signal });
  }

  public setBindings(bindings: GamepadBindings) {
    this.bindings = bindings;
    this.previousHeld.clear();
  }

  public setSettings(settings: InputSettings) {
    this.settings = settings;
  }

  public getActiveGamepad() {
    const pads = this.getConnectedGamepads();
    return pads.find((pad) => pad.index === this.activeIndex) ?? pads[0] ?? null;
  }

  public update(): DeviceInputSnapshot {
    const pads = this.getConnectedGamepads();
    const activity = pads
      .map((pad) => ({ pad, active: this.detectSignificantActivity(pad) }))
      .filter((entry) => entry.active);
    const activeCandidate = activity.at(-1)?.pad;
    const current = pads.find((pad) => pad.index === this.activeIndex);
    const selected = activeCandidate ?? current ?? pads[0] ?? null;
    const selectedChanged = selected?.index !== this.activeIndex;

    if (selectedChanged) {
      for (const action of this.previousHeld) this.cancelled.add(action);
      this.previousHeld.clear();
      this.activeIndex = selected?.index ?? null;
    }

    if (!selected) {
      const cancelled = new Set(this.cancelled);
      this.cancelled.clear();
      return {
        movement: { x: 0, y: 0, reference: "screen" },
        look: { x: 0, y: 0 },
        held: new Set(),
        pressed: new Set(),
        released: new Set(),
        cancelled,
        significantActivity: false,
        activityTimestamp: this.lastActivityTimestamp,
        available: false,
        gameplayEnabled: false,
      };
    }

    const analogMovement = this.readAxisPair(
      selected,
      this.bindings.movement,
      this.settings.movementDeadZone
    );
    const movement = this.readMovement(selected, analogMovement);
    const look = this.readAxisPair(selected, this.bindings.look, this.settings.lookDeadZone);
    const held = this.readHeldActions(selected);
    const pressed = new Set<GameAction>();
    const released = new Set<GameAction>();
    for (const action of GAME_ACTIONS) {
      const wasDown = this.previousHeld.has(action);
      const isDown = held.has(action);
      if (isDown && !wasDown) pressed.add(action);
      if (!isDown && wasDown) released.add(action);
    }
    this.previousHeld.clear();
    for (const action of held) this.previousHeld.add(action);

    const significantActivity = activity.some((entry) => entry.pad.index === selected.index);
    if (significantActivity) this.lastActivityTimestamp = performance.now();
    const cancelled = new Set(this.cancelled);
    this.cancelled.clear();

    return {
      movement: { ...movement, reference: "screen" },
      look,
      held,
      pressed,
      released,
      cancelled,
      significantActivity,
      activityTimestamp: this.lastActivityTimestamp,
      available: true,
      gameplayEnabled: true,
    };
  }

  public reset() {
    for (const action of this.previousHeld) this.cancelled.add(action);
    this.previousHeld.clear();
    this.rawStates.clear();
  }

  public dispose() {
    this.reset();
    this.abortController.abort();
  }

  private getConnectedGamepads() {
    if (typeof navigator.getGamepads !== "function") return [];
    return Array.from(navigator.getGamepads()).filter(
      (gamepad): gamepad is Gamepad => !!gamepad?.connected
    );
  }

  private readAxisPair(gamepad: Gamepad, pair: GamepadAxisPair, deadZone: number) {
    const x = (gamepad.axes[pair.x] ?? 0) * (pair.invertX ? -1 : 1);
    const y = (gamepad.axes[pair.y] ?? 0) * (pair.invertY ? -1 : 1);
    return applyRadialDeadZone(x, y, deadZone);
  }

  private readMovement(gamepad: Gamepad, analog: InputVector2) {
    if (gamepad.mapping !== "standard") return analog;
    const dpadX = Number(gamepad.buttons[15]?.pressed) - Number(gamepad.buttons[14]?.pressed);
    const dpadY = Number(gamepad.buttons[12]?.pressed) - Number(gamepad.buttons[13]?.pressed);
    if (dpadX === 0 && dpadY === 0) return analog;
    return { x: dpadX, y: dpadY };
  }

  private readHeldActions(gamepad: Gamepad) {
    const held = new Set<GameAction>();
    for (const action of GAME_ACTIONS) {
      const bindings = this.bindings.actions[action];
      if (bindings?.some((binding) => this.bindingIsDown(gamepad, binding))) held.add(action);
    }
    return held;
  }

  private bindingIsDown(gamepad: Gamepad, binding: GamepadBinding) {
    const threshold = binding.threshold ?? this.settings.triggerThreshold;
    if (binding.type === "button") {
      const button = gamepad.buttons[binding.index];
      return !!button && (button.pressed || button.value >= threshold);
    }
    const value = (gamepad.axes[binding.index] ?? 0) * (binding.direction ?? 1);
    return value >= threshold;
  }

  private detectSignificantActivity(gamepad: Gamepad) {
    const previous = this.rawStates.get(gamepad.index);
    const axes = [...gamepad.axes];
    const buttons = gamepad.buttons.map(
      (button) => button.pressed || button.value >= this.settings.triggerThreshold
    );
    this.rawStates.set(gamepad.index, { axes, buttons });

    if (!previous) {
      return (
        axes.some((value) => Math.abs(value) >= this.settings.activityThreshold) ||
        buttons.some(Boolean)
      );
    }

    const buttonPressed = buttons.some((down, index) => down && !previous.buttons[index]);
    const axisMoved = axes.some((value, index) => {
      const oldValue = previous.axes[index] ?? 0;
      return (
        Math.abs(value) >= this.settings.activityThreshold &&
        (Math.abs(oldValue) < this.settings.activityThreshold || Math.abs(value - oldValue) >= 0.08)
      );
    });
    return buttonPressed || axisMoved;
  }

  private readonly onGamepadConnected = (event: GamepadEvent) => {
    if (import.meta.env.DEV) {
      const gamepad = event.gamepad;
      console.info("[Input] Gamepad connected", {
        name: gamepad.id,
        index: gamepad.index,
        mapping: gamepad.mapping,
        buttons: gamepad.buttons.length,
        axes: gamepad.axes.length,
      });
    }
  };

  private readonly onGamepadDisconnected = (event: GamepadEvent) => {
    this.rawStates.delete(event.gamepad.index);
    if (this.activeIndex === event.gamepad.index) {
      for (const action of this.previousHeld) this.cancelled.add(action);
      this.previousHeld.clear();
      this.activeIndex = null;
    }
    if (import.meta.env.DEV) {
      console.info("[Input] Gamepad disconnected", {
        name: event.gamepad.id,
        index: event.gamepad.index,
      });
    }
  };
}

export function applyRadialDeadZone(
  x: number,
  y: number,
  deadZone: number
): InputVector2 {
  const safeDeadZone = Math.max(0, Math.min(0.95, deadZone));
  const magnitude = Math.hypot(x, y);
  if (magnitude <= safeDeadZone) return { x: 0, y: 0 };
  const normalizedMagnitude = Math.min(1, (magnitude - safeDeadZone) / (1 - safeDeadZone));
  const scale = normalizedMagnitude / magnitude;
  return { x: x * scale, y: y * scale };
}
