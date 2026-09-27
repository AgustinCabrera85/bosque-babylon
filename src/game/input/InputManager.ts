import {
  GAME_ACTIONS,
  type DeviceInputSnapshot,
  type GameAction,
  type InputDeviceType,
  type InputSelectionMode,
  type InputSettings,
  type InputVector2,
  type MovementInput,
  type MovementReference,
} from "./InputActions";
import {
  cloneGamepadBindings,
  cloneKeyboardMouseBindings,
  DEFAULT_INPUT_SETTINGS,
  DEFAULT_KEYBOARD_MOUSE_BINDINGS,
  DEFAULT_STANDARD_GAMEPAD_BINDINGS,
  type ControllerPreset,
  type GamepadBinding,
  type GamepadBindings,
  type InputBindingAssignment,
  type KeyboardMouseActionBinding,
  type KeyboardMouseBindings,
} from "./InputBindings";
import { GamepadInput } from "./GamepadInput";
import { KeyboardMouseInput } from "./KeyboardMouseInput";
import { TouchInput } from "./TouchInput";

export type ExportedInputBindings = {
  version: 1;
  selectionMode: InputSelectionMode;
  controllerPreset: ControllerPreset;
  settings: InputSettings;
  keyboardMouse: KeyboardMouseBindings;
  gamepad: GamepadBindings;
};

type ActiveDeviceListener = (device: InputDeviceType) => void;

const ZERO_MOVEMENT: MovementInput = { x: 0, y: 0, reference: "local" };

export class InputManager {
  private readonly keyboardMouse: KeyboardMouseInput;
  private readonly gamepad: GamepadInput;
  private readonly touch = new TouchInput();
  private readonly activeDeviceListeners = new Set<ActiveDeviceListener>();
  private settings: InputSettings;
  private keyboardMouseBindings: KeyboardMouseBindings;
  private gamepadBindings: GamepadBindings;
  private selectionMode: InputSelectionMode = "auto";
  private activeDevice: InputDeviceType = "keyboardMouse";
  private controllerPreset: ControllerPreset = "standard";
  private movement: MovementInput = { ...ZERO_MOVEMENT };
  private look: InputVector2 = { x: 0, y: 0 };
  private readonly held = new Set<GameAction>();
  private readonly pressed = new Set<GameAction>();
  private readonly released = new Set<GameAction>();
  private readonly cancelled = new Set<GameAction>();
  private gameplayEnabled = false;
  private disposed = false;

  public constructor(canvas: HTMLCanvasElement, settings: Partial<InputSettings> = {}) {
    this.settings = { ...DEFAULT_INPUT_SETTINGS, ...settings };
    this.keyboardMouseBindings = cloneKeyboardMouseBindings(DEFAULT_KEYBOARD_MOUSE_BINDINGS);
    this.gamepadBindings = cloneGamepadBindings(DEFAULT_STANDARD_GAMEPAD_BINDINGS);
    this.keyboardMouse = new KeyboardMouseInput(canvas, this.keyboardMouseBindings);
    this.gamepad = new GamepadInput(this.gamepadBindings, this.settings);
  }

  public update(deltaTimeSeconds: number) {
    if (this.disposed) return;
    const snapshots = new Map<InputDeviceType, DeviceInputSnapshot>([
      ["keyboardMouse", this.keyboardMouse.update()],
      ["gamepad", this.gamepad.update()],
      ["touch", this.touch.update()],
    ]);

    const previousDevice = this.activeDevice;
    if (this.selectionMode === "auto") {
      const latest = [...snapshots.entries()]
        .filter(([, snapshot]) => snapshot.available && snapshot.significantActivity)
        .sort((a, b) => b[1].activityTimestamp - a[1].activityTimestamp)[0];
      if (latest) this.setActiveDevice(latest[0]);
    } else {
      this.setActiveDevice(this.selectionMode);
    }

    const snapshot = snapshots.get(this.activeDevice);
    const usable = snapshot?.available === true;
    this.pressed.clear();
    this.released.clear();
    this.cancelled.clear();

    if (previousDevice !== this.activeDevice) {
      for (const action of this.held) this.cancelled.add(action);
      this.held.clear();
    }

    if (!snapshot || !usable) {
      for (const action of this.held) this.cancelled.add(action);
      this.held.clear();
      this.movement = { ...ZERO_MOVEMENT };
      this.look = { x: 0, y: 0 };
      this.gameplayEnabled = false;
      this.refreshHelpVisibility();
      return;
    }

    const previousHeld = new Set(this.held);
    this.held.clear();
    for (const action of snapshot.held) this.held.add(action);
    for (const action of GAME_ACTIONS) {
      if (snapshot.pressed.has(action) || (this.held.has(action) && !previousHeld.has(action))) {
        this.pressed.add(action);
      }
      if (snapshot.released.has(action) || (!this.held.has(action) && previousHeld.has(action))) {
        this.released.add(action);
      }
      if (snapshot.cancelled.has(action)) {
        this.cancelled.add(action);
        this.released.delete(action);
      }
    }

    this.movement = { ...snapshot.movement };
    const dt = Math.max(0, Math.min(deltaTimeSeconds, 0.1));
    if (this.activeDevice === "keyboardMouse") {
      this.look = {
        x: snapshot.look.x * this.settings.mouseLookSensitivityX,
        y: snapshot.look.y * this.settings.mouseLookSensitivityY,
      };
    } else if (this.activeDevice === "touch") {
      this.look = {
        x: snapshot.look.x * this.settings.touchLookSensitivityX,
        y: snapshot.look.y * this.settings.touchLookSensitivityY,
      };
    } else {
      this.look = {
        x: snapshot.look.x * this.settings.gamepadLookSensitivity * dt,
        y:
          snapshot.look.y *
          this.settings.gamepadLookSensitivity *
          dt *
          (this.settings.invertGamepadY ? -1 : 1),
      };
    }
    this.gameplayEnabled = snapshot.gameplayEnabled;
    this.refreshHelpVisibility();
  }

  public getMovement(): MovementInput {
    return { ...this.movement };
  }

  public getLook(): InputVector2 {
    return { ...this.look };
  }

  public isDown(action: GameAction) {
    return this.held.has(action);
  }

  public wasPressed(action: GameAction) {
    return this.pressed.has(action);
  }

  public wasReleased(action: GameAction) {
    return this.released.has(action);
  }

  public wasCancelled(action: GameAction) {
    return this.cancelled.has(action);
  }

  public isGameplayInputEnabled() {
    return this.gameplayEnabled;
  }

  public getActiveDevice() {
    return this.activeDevice;
  }

  public onActiveDeviceChanged(listener: ActiveDeviceListener) {
    this.activeDeviceListeners.add(listener);
    listener(this.activeDevice);
    return () => this.activeDeviceListeners.delete(listener);
  }

  public getSelectionMode() {
    return this.selectionMode;
  }

  public setSelectionMode(mode: InputSelectionMode) {
    if (this.selectionMode === mode) return;
    this.selectionMode = mode;
    if (mode !== "auto") this.setActiveDevice(mode);
    this.clearFrameState();
  }

  public getSettings(): InputSettings {
    return { ...this.settings };
  }

  public getControllerPreset() {
    return this.controllerPreset;
  }

  public setControllerPreset(preset: ControllerPreset) {
    this.controllerPreset = preset;
    if (preset === "custom") return;
    // Xbox and PlayStation browser mappings both use the W3C standard indices.
    this.gamepadBindings = cloneGamepadBindings(DEFAULT_STANDARD_GAMEPAD_BINDINGS);
    this.gamepad.setBindings(this.gamepadBindings);
  }

  public updateSettings(settings: Partial<InputSettings>) {
    this.settings = { ...this.settings, ...settings };
    this.gamepad.setSettings(this.settings);
  }

  public setBinding(action: GameAction, binding: InputBindingAssignment) {
    if (binding.device === "gamepad") {
      const entry: GamepadBinding = "button" in binding
        ? { type: "button", index: binding.button, threshold: binding.threshold }
        : {
            type: "axis",
            index: binding.axis,
            direction: binding.direction,
            threshold: binding.threshold,
          };
      this.gamepadBindings.actions[action] = [entry];
      this.controllerPreset = "custom";
      this.gamepad.setBindings(this.gamepadBindings);
      return;
    }

    const entry: KeyboardMouseActionBinding = "code" in binding
      ? { type: "key", code: binding.code }
      : {
          type: "mouseButton",
          button: binding.mouseButton,
          requiresButtons: binding.requiresButtons,
        };
    this.keyboardMouseBindings.actions[action] = [entry];
    this.keyboardMouse.setBindings(this.keyboardMouseBindings);
  }

  public exportBindings(): ExportedInputBindings {
    return {
      version: 1,
      selectionMode: this.selectionMode,
      controllerPreset: this.controllerPreset,
      settings: { ...this.settings },
      keyboardMouse: cloneKeyboardMouseBindings(this.keyboardMouseBindings),
      gamepad: cloneGamepadBindings(this.gamepadBindings),
    };
  }

  public importBindings(config: ExportedInputBindings) {
    if (config.version !== 1) throw new Error("Unsupported input bindings version");
    this.selectionMode = config.selectionMode;
    this.controllerPreset = config.controllerPreset;
    this.settings = { ...DEFAULT_INPUT_SETTINGS, ...config.settings };
    this.keyboardMouseBindings = cloneKeyboardMouseBindings(config.keyboardMouse);
    this.gamepadBindings = cloneGamepadBindings(config.gamepad);
    this.keyboardMouse.setBindings(this.keyboardMouseBindings);
    this.gamepad.setBindings(this.gamepadBindings);
    this.gamepad.setSettings(this.settings);
    if (this.selectionMode !== "auto") this.setActiveDevice(this.selectionMode);
    this.clearFrameState();
  }

  public setTouchEnabled(enabled: boolean) {
    this.touch.setEnabled(enabled);
    if (enabled && this.selectionMode === "auto") this.setActiveDevice("touch");
    this.refreshHelpVisibility();
  }

  public setTouchMovement(
    x: number,
    y: number,
    reference: MovementReference = "screen"
  ) {
    this.touch.setMovement(x, y, reference);
  }

  public addTouchLook(x: number, y: number) {
    this.touch.addLook(x, y);
  }

  public setTouchAction(action: GameAction, down: boolean) {
    this.touch.setActionDown(action, down);
  }

  public pulseTouchAction(action: GameAction) {
    this.touch.pulseAction(action);
  }

  public cancelTouchAction(action: GameAction) {
    this.touch.cancelAction(action);
  }

  public reset() {
    this.keyboardMouse.reset();
    this.gamepad.reset();
    this.touch.reset();
    this.clearFrameState();
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.keyboardMouse.dispose();
    this.gamepad.dispose();
    this.touch.dispose();
    this.activeDeviceListeners.clear();
    this.clearFrameState();
  }

  private setActiveDevice(device: InputDeviceType) {
    if (this.activeDevice === device) return;
    this.activeDevice = device;
    for (const listener of this.activeDeviceListeners) listener(device);
  }

  private clearFrameState() {
    this.movement = { ...ZERO_MOVEMENT };
    this.look = { x: 0, y: 0 };
    this.held.clear();
    this.pressed.clear();
    this.released.clear();
    this.cancelled.clear();
    this.gameplayEnabled = false;
  }

  private refreshHelpVisibility() {
    this.keyboardMouse.setOtherGameplayInputEnabled(
      this.activeDevice !== "keyboardMouse" && this.gameplayEnabled
    );
  }
}
