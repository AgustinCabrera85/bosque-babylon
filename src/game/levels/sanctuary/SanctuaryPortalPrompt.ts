import type { InputManager } from "../../input/InputManager";
import { GamepadMenuNavigator } from "../../GamepadMenuNavigator";

export function createSanctuaryPortalPrompt(canvas: HTMLCanvasElement, input: InputManager) {
  const overlay = document.createElement("div");
  overlay.id = "sanctuaryPortalConfirm";
  overlay.className = "sanctuary-portal-confirm";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "sanctuaryPortalConfirmTitle");

  const panel = document.createElement("div");
  panel.className = "sanctuary-portal-confirm-panel";
  const eyebrow = document.createElement("p");
  eyebrow.className = "sanctuary-portal-confirm-eyebrow";
  eyebrow.textContent = "PORTAL DEL SANTUARIO";
  const title = document.createElement("h2");
  title.id = "sanctuaryPortalConfirmTitle";
  const buttons = document.createElement("div");
  buttons.className = "sanctuary-portal-confirm-actions";
  const noButton = document.createElement("button");
  noButton.type = "button";
  noButton.textContent = "No";
  const yesButton = document.createElement("button");
  yesButton.type = "button";
  yesButton.textContent = "Sí";
  yesButton.className = "primary";
  buttons.append(noButton, yesButton);
  panel.append(eyebrow, title, buttons);
  overlay.append(panel);
  document.body.append(overlay);

  const navigator = new GamepadMenuNavigator({
    input, root: overlay, getInitialFocus: () => noButton,
  });
  let open = false;
  let chapterId: string | null = null;
  let onYes: (() => void) | null = null;
  let onNo: (() => void) | null = null;
  let restorePointerLock = false;
  const abort = new AbortController();
  const signal = abort.signal;

  const answer = (yes: boolean) => {
    if (!open) return;
    open = false;
    overlay.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.classList.remove("sanctuary-portal-confirm-open");
    navigator.reset();
    const callback = yes ? onYes : onNo;
    onYes = null;
    onNo = null;
    chapterId = null;
    input.reset();
    callback?.();
    if (restorePointerLock &&
        !window.matchMedia("(pointer: coarse)").matches) {
      void canvas.requestPointerLock?.().catch(() => {
        // The canvas can be clicked again if a browser rejects the gesture.
      });
    }
  };

  overlay.addEventListener("pointerdown", event => event.stopPropagation(), { signal });
  overlay.addEventListener("click", event => event.stopPropagation(), { signal });
  noButton.addEventListener("click", () => answer(false), { signal });
  yesButton.addEventListener("click", () => answer(true), { signal });
  window.addEventListener("keydown", event => {
    if (!open) return;
    if (event.code === "KeyY") {
      event.preventDefault();
      answer(true);
    } else if (event.code === "KeyN") {
      event.preventDefault();
      answer(false);
    }
  }, { signal });
  window.addEventListener("bosque:sanctuary-portal-cancel", () => answer(false), { signal });

  return {
    get isOpen() { return open; },
    get chapterId() { return chapterId; },
    show(id: string, chapter: string, confirm: () => void, decline: () => void) {
      if (open) return;
      open = true;
      chapterId = id;
      onYes = confirm;
      onNo = decline;
      title.textContent = `¿Quieres ingresar al capítulo «${chapter}»?`;
      overlay.hidden = false;
      document.body.classList.add("sanctuary-portal-confirm-open");
      restorePointerLock = document.pointerLockElement === canvas;
      if (restorePointerLock) document.exitPointerLock?.();
      input.reset();
      noButton.focus({ preventScroll: true });
      navigator.focusInitial();
    },
    update() { navigator.update(open); },
    dispose() {
      abort.abort();
      navigator.reset();
      document.body.classList.remove("sanctuary-portal-confirm-open");
      overlay.remove();
    },
  };
}
