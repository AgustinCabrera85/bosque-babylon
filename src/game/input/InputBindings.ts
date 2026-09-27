import type { GameAction, InputSettings } from "./InputActions";

export type KeyboardMouseActionBinding =
  | { type: "key"; code: string }
  | { type: "mouseButton"; button: number; requiresButtons?: readonly number[] };

export type KeyboardMouseBindings = {
  movement: {
    left: readonly string[];
    right: readonly string[];
    forward: readonly string[];
    backward: readonly string[];
  };
  actions: Partial<Record<GameAction, readonly KeyboardMouseActionBinding[]>>;
};

export type GamepadButtonBinding = {
  type: "button";
  index: number;
  threshold?: number;
};

export type GamepadAxisBinding = {
  type: "axis";
  index: number;
  direction?: 1 | -1;
  threshold?: number;
};

export type GamepadBinding = GamepadButtonBinding | GamepadAxisBinding;

export type GamepadAxisPair = {
  x: number;
  y: number;
  invertX?: boolean;
  invertY?: boolean;
};

export type GamepadBindings = {
  movement: GamepadAxisPair;
  look: GamepadAxisPair;
  actions: Partial<Record<GameAction, readonly GamepadBinding[]>>;
};

export type ControllerPreset = "standard" | "xbox" | "playstation" | "custom";

export type InputBindingAssignment =
  | {
      device: "gamepad";
      button: number;
      threshold?: number;
    }
  | {
      device: "gamepad";
      axis: number;
      direction?: 1 | -1;
      threshold?: number;
    }
  | {
      device: "keyboardMouse";
      code: string;
    }
  | {
      device: "keyboardMouse";
      mouseButton: number;
      requiresButtons?: readonly number[];
    };

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  movementDeadZone: 0.15,
  lookDeadZone: 0.12,
  triggerThreshold: 0.15,
  activityThreshold: 0.22,
  mouseLookSensitivityX: 0.0012,
  mouseLookSensitivityY: 0.001,
  touchLookSensitivityX: 0.0032,
  touchLookSensitivityY: 0.0027,
  gamepadLookSensitivity: 2.35,
  invertGamepadY: false,
};

export const DEFAULT_KEYBOARD_MOUSE_BINDINGS: KeyboardMouseBindings = {
  movement: {
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    forward: ["KeyW", "ArrowUp"],
    backward: ["KeyS", "ArrowDown"],
  },
  actions: {
    run: [
      { type: "key", code: "ShiftLeft" },
      { type: "key", code: "ShiftRight" },
    ],
    jump: [{ type: "key", code: "Space" }],
    interact: [{ type: "key", code: "KeyE" }],
    attack: [{ type: "mouseButton", button: 0, requiresButtons: [2] }],
    aim: [{ type: "mouseButton", button: 2 }],
    absorbLight: [{ type: "key", code: "KeyQ" }],
    changeCamera: [{ type: "key", code: "KeyV" }],
    pause: [{ type: "key", code: "Escape" }],
    inventory: [{ type: "key", code: "KeyI" }],
    cancel: [{ type: "key", code: "Escape" }],
    toggleFlashlight: [{ type: "key", code: "KeyF" }],
  },
};

// Indices follow the W3C Standard Gamepad mapping. Device-specific labels can
// be layered over this preset later without leaking physical indices to gameplay.
export const DEFAULT_STANDARD_GAMEPAD_BINDINGS: GamepadBindings = {
  movement: { x: 0, y: 1, invertY: true },
  look: { x: 2, y: 3 },
  actions: {
    jump: [{ type: "button", index: 0 }],
    cancel: [{ type: "button", index: 1 }],
    interact: [{ type: "button", index: 2 }],
    changeCamera: [{ type: "button", index: 3 }],
    absorbLight: [{ type: "button", index: 6 }],
    attack: [{ type: "button", index: 7 }],
    inventory: [{ type: "button", index: 8 }],
    pause: [{ type: "button", index: 9 }],
    run: [{ type: "button", index: 10 }],
  },
};

export function cloneKeyboardMouseBindings(
  bindings: KeyboardMouseBindings
): KeyboardMouseBindings {
  return {
    movement: {
      left: [...bindings.movement.left],
      right: [...bindings.movement.right],
      forward: [...bindings.movement.forward],
      backward: [...bindings.movement.backward],
    },
    actions: Object.fromEntries(
      Object.entries(bindings.actions).map(([action, entries]) => [
        action,
        entries?.map((entry) =>
          entry.type === "mouseButton"
            ? { ...entry, requiresButtons: entry.requiresButtons ? [...entry.requiresButtons] : undefined }
            : { ...entry }
        ),
      ])
    ) as KeyboardMouseBindings["actions"],
  };
}

export function cloneGamepadBindings(bindings: GamepadBindings): GamepadBindings {
  return {
    movement: { ...bindings.movement },
    look: { ...bindings.look },
    actions: Object.fromEntries(
      Object.entries(bindings.actions).map(([action, entries]) => [
        action,
        entries?.map((entry) => ({ ...entry })),
      ])
    ) as GamepadBindings["actions"],
  };
}
