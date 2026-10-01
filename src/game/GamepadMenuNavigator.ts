import type { InputManager } from "./input/InputManager";

type Direction = "left" | "right" | "up" | "down";

type GamepadMenuNavigatorOptions = {
  input: InputManager;
  root: HTMLElement;
  getInitialFocus: () => HTMLElement | null;
};

const NAVIGATION_SELECTOR = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]",
].join(",");
const AXIS_THRESHOLD = 0.55;
const INITIAL_REPEAT_DELAY_MS = 320;
const REPEAT_INTERVAL_MS = 115;
const EDGE_SCROLL_STEP_PX = 72;
const RIGHT_STICK_SCROLL_SCALE = 320;

export class GamepadMenuNavigator {
  private direction: Direction | null = null;
  private nextRepeatAt = 0;

  public constructor(private readonly options: GamepadMenuNavigatorOptions) {}

  public focusInitial() {
    if (this.options.input.getActiveDevice() !== "gamepad") return;
    this.options.root.classList.add("gamepad-navigation-active");
    this.focus(this.options.getInitialFocus());
  }

  public update(active: boolean) {
    const { input, root } = this.options;
    if (!active || input.getActiveDevice() !== "gamepad") {
      this.reset();
      return;
    }

    root.classList.add("gamepad-navigation-active");
    if (!this.getFocusedElement()) this.focus(this.options.getInitialFocus());

    this.scrollWithRightStick();

    if (input.wasPressed("jump")) {
      const focused = this.getFocusedElement();
      if (focused instanceof HTMLButtonElement || focused instanceof HTMLInputElement) {
        focused.click();
      }
    }

    const nextDirection = this.readDirection();
    if (!nextDirection) {
      this.direction = null;
      this.nextRepeatAt = 0;
      return;
    }

    const now = performance.now();
    if (nextDirection !== this.direction) {
      this.direction = nextDirection;
      this.nextRepeatAt = now + INITIAL_REPEAT_DELAY_MS;
      this.navigate(nextDirection);
      return;
    }
    if (now < this.nextRepeatAt) return;
    this.nextRepeatAt = now + REPEAT_INTERVAL_MS;
    this.navigate(nextDirection);
  }

  public reset() {
    this.direction = null;
    this.nextRepeatAt = 0;
    const focused = this.getFocusedElement();
    focused?.blur();
    this.options.root.classList.remove("gamepad-navigation-active");
  }

  private readDirection(): Direction | null {
    const movement = this.options.input.getMovement();
    if (Math.abs(movement.x) < AXIS_THRESHOLD && Math.abs(movement.y) < AXIS_THRESHOLD) {
      return null;
    }
    if (Math.abs(movement.x) > Math.abs(movement.y)) {
      return movement.x < 0 ? "left" : "right";
    }
    return movement.y > 0 ? "up" : "down";
  }

  private navigate(direction: Direction) {
    const current = this.getFocusedElement() ?? this.options.getInitialFocus();
    if (!current) return;
    if ((direction === "left" || direction === "right") && current instanceof HTMLInputElement) {
      if (current.type === "range") {
        this.adjustRange(current, direction === "left" ? -1 : 1);
        return;
      }
    }

    const currentRect = navigationRect(current);
    const currentCenter = rectCenter(currentRect);
    const candidates = this.getFocusableElements().filter((candidate) => candidate !== current);
    let best: { element: HTMLElement; score: number } | null = null;

    for (const candidate of candidates) {
      const center = rectCenter(navigationRect(candidate));
      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;
      const primary = direction === "left" ? -dx
        : direction === "right" ? dx
          : direction === "up" ? -dy
            : dy;
      if (primary <= 2) continue;
      const perpendicular = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      const score = primary + perpendicular * 2.4;
      if (!best || score < best.score) best = { element: candidate, score };
    }

    if (best) {
      this.focus(best.element);
      return;
    }

    if (direction === "up" || direction === "down") {
      this.scrollVertically(direction === "up" ? -EDGE_SCROLL_STEP_PX : EDGE_SCROLL_STEP_PX);
    }
  }

  private adjustRange(input: HTMLInputElement, direction: -1 | 1) {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const step = Number(input.step || 1);
    const increment = Math.max(step, (max - min) / 20);
    input.value = String(Math.max(min, Math.min(max, Number(input.value) + increment * direction)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private getFocusedElement() {
    const active = document.activeElement;
    return active instanceof HTMLElement && this.options.root.contains(active) ? active : null;
  }

  private getFocusableElements() {
    return Array.from(this.options.root.querySelectorAll<HTMLElement>(NAVIGATION_SELECTOR))
      .filter((element) => {
        if (element.matches("[disabled], [aria-disabled='true']")) return false;
        if (element.closest("[hidden], [aria-hidden='true']")) return false;
        return element.getClientRects().length > 0;
      });
  }

  private focus(element: HTMLElement | null) {
    if (!element || !this.options.root.contains(element)) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private scrollWithRightStick() {
    const verticalLook = this.options.input.getLook().y;
    if (Math.abs(verticalLook) < 0.001) return;
    this.scrollVertically(verticalLook * RIGHT_STICK_SCROLL_SCALE);
  }

  private scrollVertically(delta: number) {
    const container = this.findScrollContainer();
    if (!container) return;
    container.scrollTop += delta;
  }

  private findScrollContainer() {
    const focused = this.getFocusedElement();
    let current: HTMLElement | null = focused;
    while (current && this.options.root.contains(current)) {
      if (isVerticallyScrollable(current)) return current;
      current = current.parentElement;
    }

    if (isVerticallyScrollable(this.options.root)) return this.options.root;
    return Array.from(this.options.root.querySelectorAll<HTMLElement>("*"))
      .find((element) =>
        element.getClientRects().length > 0 &&
        !element.closest("[hidden], [aria-hidden='true']") &&
        isVerticallyScrollable(element)
      ) ?? null;
  }
}

function isVerticallyScrollable(element: HTMLElement) {
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === "auto" || overflowY === "scroll";
}

function navigationRect(element: HTMLElement) {
  if (element instanceof HTMLInputElement && element.type === "checkbox") {
    return element.closest("label")?.getBoundingClientRect() ?? element.getBoundingClientRect();
  }
  return element.getBoundingClientRect();
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
