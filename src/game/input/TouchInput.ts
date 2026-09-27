import type {
  DeviceInputSnapshot,
  GameAction,
  InputDeviceAdapter,
  MovementReference,
} from "./InputActions";

export class TouchInput implements InputDeviceAdapter {
  public readonly type = "touch" as const;

  private enabled = false;
  private movementX = 0;
  private movementY = 0;
  private movementReference: MovementReference = "screen";
  private lookX = 0;
  private lookY = 0;
  private readonly held = new Set<GameAction>();
  private readonly pressed = new Set<GameAction>();
  private readonly released = new Set<GameAction>();
  private readonly cancelled = new Set<GameAction>();
  private significantActivity = false;
  private activityTimestamp = 0;

  public setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.reset();
    else this.markActivity();
  }

  public setMovement(x: number, y: number, reference: MovementReference = "screen") {
    this.movementX = Math.max(-1, Math.min(1, x));
    this.movementY = Math.max(-1, Math.min(1, y));
    this.movementReference = reference;
    if (Math.hypot(this.movementX, this.movementY) > 0.04) this.markActivity();
  }

  public addLook(x: number, y: number) {
    this.lookX += x;
    this.lookY += y;
    if (Math.abs(x) + Math.abs(y) > 0.5) this.markActivity();
  }

  public setActionDown(action: GameAction, down: boolean) {
    const wasDown = this.held.has(action);
    if (down === wasDown) return;
    if (down) {
      this.held.add(action);
      this.pressed.add(action);
    } else {
      this.held.delete(action);
      this.released.add(action);
    }
    this.markActivity();
  }

  public pulseAction(action: GameAction) {
    this.pressed.add(action);
    this.markActivity();
  }

  public cancelAction(action: GameAction) {
    if (!this.held.delete(action)) return;
    this.released.delete(action);
    this.cancelled.add(action);
  }

  public update(): DeviceInputSnapshot {
    const snapshot: DeviceInputSnapshot = {
      movement: {
        x: this.movementX,
        y: this.movementY,
        reference: this.movementReference,
      },
      look: { x: this.lookX, y: this.lookY },
      held: new Set(this.held),
      pressed: new Set(this.pressed),
      released: new Set(this.released),
      cancelled: new Set(this.cancelled),
      significantActivity: this.significantActivity,
      activityTimestamp: this.activityTimestamp,
      available: this.enabled,
      gameplayEnabled: this.enabled,
    };
    this.lookX = 0;
    this.lookY = 0;
    this.pressed.clear();
    this.released.clear();
    this.cancelled.clear();
    this.significantActivity = false;
    return snapshot;
  }

  public reset() {
    for (const action of this.held) this.cancelled.add(action);
    this.held.clear();
    this.pressed.clear();
    this.released.clear();
    this.movementX = 0;
    this.movementY = 0;
    this.lookX = 0;
    this.lookY = 0;
  }

  public dispose() {
    this.reset();
    this.enabled = false;
  }

  private markActivity() {
    if (!this.enabled) return;
    this.significantActivity = true;
    this.activityTimestamp = performance.now();
  }
}
