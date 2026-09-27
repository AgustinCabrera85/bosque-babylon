import {
  GAME_ACTIONS,
  type DeviceInputSnapshot,
  type GameAction,
  type InputDeviceAdapter,
} from "./InputActions";
import type {
  KeyboardMouseActionBinding,
  KeyboardMouseBindings,
} from "./InputBindings";

const POINTER_LOCK_EXCLUSIONS = [
  "#mobileControls",
  "#musicControls",
  "#viewControls",
  "#pauseMenu",
  "#itemInspector",
  "#inventoryOverlay",
  "#inventoryButton",
  "#shadowAuraDebug",
  "#openingSequence",
];

function emptySnapshot(): DeviceInputSnapshot {
  return {
    movement: { x: 0, y: 0, reference: "local" },
    look: { x: 0, y: 0 },
    held: new Set(),
    pressed: new Set(),
    released: new Set(),
    cancelled: new Set(),
    significantActivity: false,
    activityTimestamp: 0,
    available: true,
    gameplayEnabled: false,
  };
}

export class KeyboardMouseInput implements InputDeviceAdapter {
  public readonly type = "keyboardMouse" as const;

  private readonly abortController = new AbortController();
  private readonly keys = new Set<string>();
  private readonly mouseButtons = new Set<number>();
  private readonly pressed = new Set<GameAction>();
  private readonly released = new Set<GameAction>();
  private readonly cancelled = new Set<GameAction>();
  private readonly eventActionState = new Map<GameAction, boolean>();
  private lookX = 0;
  private lookY = 0;
  private significantActivity = false;
  private activityTimestamp = 0;
  private otherGameplayInputEnabled = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private bindings: KeyboardMouseBindings
  ) {
    for (const action of GAME_ACTIONS) this.eventActionState.set(action, false);

    const signal = this.abortController.signal;
    window.addEventListener("keydown", this.onKeyDown, { signal });
    window.addEventListener("keyup", this.onKeyUp, { signal });
    canvas.addEventListener("mousedown", this.onMouseDown, { capture: true, signal });
    window.addEventListener("mouseup", this.onMouseUp, { signal });
    window.addEventListener("mousemove", this.onMouseMove, { signal });
    canvas.addEventListener("contextmenu", this.onContextMenu, { signal });
    document.addEventListener("click", this.onDocumentClick, { signal });
    document.addEventListener("pointerlockchange", this.updatePointerLockHelp, { signal });
    document.addEventListener("visibilitychange", this.onVisibilityChange, { signal });
    window.addEventListener("blur", this.onBlur, { signal });
    this.updatePointerLockHelp();
  }

  public setBindings(bindings: KeyboardMouseBindings) {
    this.bindings = bindings;
    this.recordActionTransitions();
  }

  public setOtherGameplayInputEnabled(enabled: boolean) {
    this.otherGameplayInputEnabled = enabled;
    this.updatePointerLockHelp();
  }

  public update(): DeviceInputSnapshot {
    const snapshot = emptySnapshot();
    const held = this.readHeldActions();
    let x = 0;
    let y = 0;
    if (this.anyKey(this.bindings.movement.left)) x -= 1;
    if (this.anyKey(this.bindings.movement.right)) x += 1;
    if (this.anyKey(this.bindings.movement.forward)) y += 1;
    if (this.anyKey(this.bindings.movement.backward)) y -= 1;

    snapshot.movement = { x, y, reference: "local" };
    snapshot.look = { x: this.lookX, y: this.lookY };
    snapshot.held = held;
    snapshot.pressed = new Set(this.pressed);
    snapshot.released = new Set(this.released);
    snapshot.cancelled = new Set(this.cancelled);
    snapshot.significantActivity = this.significantActivity;
    snapshot.activityTimestamp = this.activityTimestamp;
    snapshot.gameplayEnabled = document.pointerLockElement === this.canvas;

    this.lookX = 0;
    this.lookY = 0;
    this.pressed.clear();
    this.released.clear();
    this.cancelled.clear();
    this.significantActivity = false;
    return snapshot;
  }

  public reset() {
    for (const action of GAME_ACTIONS) {
      if (this.eventActionState.get(action)) this.cancelled.add(action);
      this.eventActionState.set(action, false);
    }
    this.keys.clear();
    this.mouseButtons.clear();
    this.pressed.clear();
    this.released.clear();
    this.lookX = 0;
    this.lookY = 0;
  }

  public dispose() {
    this.reset();
    this.abortController.abort();
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (this.shouldIgnoreKeyEvent(event)) return;
    const relevant = this.isRelevantKey(event.code);
    if (relevant) event.preventDefault();
    if (event.repeat || this.keys.has(event.code)) return;
    this.keys.add(event.code);
    if (relevant) this.markActivity();
    this.recordActionTransitions();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (this.shouldIgnoreKeyEvent(event)) return;
    const relevant = this.isRelevantKey(event.code);
    if (relevant) event.preventDefault();
    if (!this.keys.delete(event.code)) return;
    if (relevant) this.markActivity();
    this.recordActionTransitions();
  };

  private readonly onMouseDown = (event: MouseEvent) => {
    if (event.button === 2) {
      event.preventDefault();
      if (document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock?.().catch(() => {
          // The semantic aim action still works if pointer lock is rejected.
        });
      }
    }
    this.mouseButtons.add(event.button);
    this.markActivity();
    this.recordActionTransitions();
  };

  private readonly onMouseUp = (event: MouseEvent) => {
    if (!this.mouseButtons.delete(event.button)) return;
    this.markActivity();
    this.recordActionTransitions();
  };

  private readonly onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    this.lookX += event.movementX;
    this.lookY += event.movementY;
    if (Math.abs(event.movementX) + Math.abs(event.movementY) >= 0.5) this.markActivity();
  };

  private readonly onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private readonly onDocumentClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (POINTER_LOCK_EXCLUSIONS.some((selector) => target?.closest(selector))) return;
    if (document.body.classList.contains("opening-sequence-active")) return;
    if (document.body.classList.contains("sky-eye-cinematic-active")) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    this.canvas.requestPointerLock?.().catch(() => {
      // A later canvas click can retry if the browser rejects this gesture.
    });
  };

  private readonly onVisibilityChange = () => {
    if (document.visibilityState !== "visible") this.reset();
  };

  private readonly onBlur = () => this.reset();

  private readonly updatePointerLockHelp = () => {
    const help = document.getElementById("help");
    if (!help) return;
    const hidden =
      document.pointerLockElement === this.canvas || this.otherGameplayInputEnabled;
    help.style.display = hidden ? "none" : "block";
  };

  private readHeldActions() {
    const held = new Set<GameAction>();
    for (const action of GAME_ACTIONS) {
      const bindings = this.bindings.actions[action];
      if (bindings?.some((binding) => this.bindingIsDown(binding))) held.add(action);
    }
    return held;
  }

  private recordActionTransitions() {
    const held = this.readHeldActions();
    for (const action of GAME_ACTIONS) {
      const wasDown = this.eventActionState.get(action) ?? false;
      const isDown = held.has(action);
      if (isDown && !wasDown) this.pressed.add(action);
      if (!isDown && wasDown) this.released.add(action);
      this.eventActionState.set(action, isDown);
    }
  }

  private bindingIsDown(binding: KeyboardMouseActionBinding) {
    if (binding.type === "key") return this.keys.has(binding.code);
    return (
      this.mouseButtons.has(binding.button) &&
      (binding.requiresButtons?.every((button) => this.mouseButtons.has(button)) ?? true)
    );
  }

  private anyKey(codes: readonly string[]) {
    return codes.some((code) => this.keys.has(code));
  }

  private isRelevantKey(code: string) {
    const movement = this.bindings.movement;
    if ([...movement.left, ...movement.right, ...movement.forward, ...movement.backward].includes(code)) {
      return true;
    }
    return Object.values(this.bindings.actions).some((bindings) =>
      bindings?.some((binding) => binding.type === "key" && binding.code === code)
    );
  }

  private shouldIgnoreKeyEvent(event: KeyboardEvent) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.matches("input, textarea, select")) return true;
    if (!target.closest("button, [role='button']")) return false;
    return !("cancel pause inventory".split(" ") as GameAction[]).some((action) =>
      this.bindings.actions[action]?.some(
        (binding) => binding.type === "key" && binding.code === event.code
      )
    );
  }

  private markActivity() {
    this.significantActivity = true;
    this.activityTimestamp = performance.now();
  }
}
