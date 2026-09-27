export const GAME_ACTIONS = [
  "move",
  "look",
  "run",
  "jump",
  "interact",
  "attack",
  "aim",
  "absorbLight",
  "changeCamera",
  "pause",
  "inventory",
  "cancel",
  "toggleFlashlight",
  "waterAction",
] as const;

export type GameAction = (typeof GAME_ACTIONS)[number];

export type InputDeviceType = "keyboardMouse" | "gamepad" | "touch";

export type InputSelectionMode = "auto" | InputDeviceType;

export type InputVector2 = {
  x: number;
  y: number;
};

export type MovementReference = "local" | "screen";

export type MovementInput = InputVector2 & {
  reference: MovementReference;
};

export type DeviceInputSnapshot = {
  movement: MovementInput;
  look: InputVector2;
  held: ReadonlySet<GameAction>;
  pressed: ReadonlySet<GameAction>;
  released: ReadonlySet<GameAction>;
  cancelled: ReadonlySet<GameAction>;
  significantActivity: boolean;
  activityTimestamp: number;
  available: boolean;
  gameplayEnabled: boolean;
};

export type InputSettings = {
  movementDeadZone: number;
  lookDeadZone: number;
  triggerThreshold: number;
  activityThreshold: number;
  mouseLookSensitivityX: number;
  mouseLookSensitivityY: number;
  touchLookSensitivityX: number;
  touchLookSensitivityY: number;
  gamepadLookSensitivity: number;
  invertGamepadY: boolean;
};

export interface InputDeviceAdapter {
  readonly type: InputDeviceType;
  update(): DeviceInputSnapshot;
  reset(): void;
  dispose(): void;
}
