import type { GameAction } from "./InputActions";
import type { InputManager } from "./InputManager";
import { CONTROLLER_FAMILY_LABELS, detectControllerFamily } from "./InputBindingLabels";
import type { InputBindingPresentation } from "./InputBindingLabels";
import { asset } from "../../utils/asset";

export type InputPromptsHandle = {
  dispose: () => void;
};

type HelpEntry =
  | { text: string }
  | { action: GameAction; copy: string };

function uniquePresentations(presentations: readonly InputBindingPresentation[]) {
  return presentations.filter((presentation, index) =>
    presentations.findIndex((candidate) =>
      candidate.label === presentation.label && candidate.iconPath === presentation.iconPath
    ) === index
  );
}

function appendBindingPresentations(
  target: HTMLElement,
  presentations: readonly InputBindingPresentation[]
) {
  const unique = uniquePresentations(presentations);
  for (const [index, presentation] of unique.entries()) {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "input-binding-separator";
      separator.textContent = "/";
      target.appendChild(separator);
    }
    if (presentation.iconPath) {
      const icon = document.createElement("img");
      icon.className = "input-button-icon";
      icon.src = asset(presentation.iconPath);
      icon.alt = presentation.label;
      icon.title = presentation.label;
      target.appendChild(icon);
    } else {
      const label = document.createElement("span");
      label.className = "input-binding-label";
      label.textContent = presentation.label;
      target.appendChild(label);
    }
  }
}

export function renderActionBinding(
  target: HTMLElement,
  input: InputManager,
  action: GameAction,
  fallback: string
) {
  target.replaceChildren();
  const presentations = input.getActionBindingPresentations(action);
  if (presentations.length) appendBindingPresentations(target, presentations);
  else target.textContent = fallback;
}

export function renderActionPrompt(
  target: HTMLElement,
  input: InputManager,
  action: GameAction,
  copy: string
) {
  target.replaceChildren();
  if (input.getActiveDevice() === "touch") {
    target.textContent = `Toca ${copy}`;
    return;
  }

  const binding = document.createElement("span");
  binding.className = "input-binding-token";
  const presentations = input.getActionBindingPresentations(action);
  if (presentations.length) appendBindingPresentations(binding, presentations);
  else binding.textContent = copy;

  const label = document.createElement("span");
  label.textContent = `: ${copy}`;
  target.append(binding, label);
}

function appendHelpLine(
  root: HTMLElement,
  input: InputManager,
  entries: readonly HelpEntry[],
  small = false
) {
  const line = document.createElement("div");
  line.className = small ? "input-prompt-line small" : "input-prompt-line";
  for (const [index, entry] of entries.entries()) {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "input-prompt-separator";
      separator.textContent = "·";
      line.appendChild(separator);
    }

    if ("text" in entry) {
      const text = document.createElement("span");
      text.textContent = entry.text;
      line.appendChild(text);
      continue;
    }

    const prompt = document.createElement("span");
    prompt.className = "input-prompt-entry";
    appendBindingPresentations(prompt, input.getActionBindingPresentations(entry.action));
    const copy = document.createElement("span");
    copy.textContent = entry.copy;
    prompt.appendChild(copy);
    line.appendChild(prompt);
  }
  root.appendChild(line);
}

export function setupInputPrompts(input: InputManager): InputPromptsHandle {
  const help = document.getElementById("help");
  const grabAction = document.getElementById("hermanoMayorGrabAction");
  const mobileInteractButton = document.getElementById("interactButton");
  const abortController = new AbortController();
  const signal = abortController.signal;

  const render = () => {
    const device = input.getActiveDevice();
    if (mobileInteractButton) mobileInteractButton.textContent = "Usar";
    if (grabAction) renderActionBinding(grabAction, input, "interact", "INTERACTUAR");
    if (!help) return;

    help.replaceChildren();
    if (device === "touch") {
      help.style.display = "none";
      return;
    }

    if (device === "keyboardMouse") {
      help.style.display = document.pointerLockElement ? "none" : "block";
      appendHelpLine(help, input, [{ text: "Click para entrar" }]);
    } else {
      help.style.display = "block";
      const gamepad = input.getActiveGamepad();
      const family = gamepad ? detectControllerFamily(gamepad.id) : "generic";
      appendHelpLine(help, input, [{ text: `${CONTROLLER_FAMILY_LABELS[family]} activo` }]);
    }

    const actionEntry = (action: GameAction, copy: string): HelpEntry | null =>
      input.getActionBindingPresentations(action).length ? { action, copy } : null;
    const utility = [
      actionEntry("changeCamera", "cámara"),
      actionEntry("toggleFlashlight", "linterna"),
      actionEntry("inventory", "inventario"),
      actionEntry("pause", "pausa"),
    ].filter((entry): entry is HelpEntry => !!entry);
    const gameplay = [
      { text: `${input.getMovementBindingLabel()} mover` },
      actionEntry("run", "correr"),
      actionEntry("jump", "saltar/bucear"),
      actionEntry("interact", "interactuar"),
      actionEntry("attack", "lanzar esfera"),
      actionEntry("absorbLight", "aferrarse a la luz"),
    ].filter((entry): entry is HelpEntry => !!entry);

    if (utility.length) appendHelpLine(help, input, utility, true);
    if (gameplay.length) appendHelpLine(help, input, gameplay, true);
  };

  const unsubscribe = input.onActiveDeviceChanged(render);
  document.addEventListener("pointerlockchange", render, { signal });
  window.addEventListener("gamepadconnected", render, { signal });
  window.addEventListener("gamepaddisconnected", render, { signal });

  return {
    dispose() {
      unsubscribe();
      abortController.abort();
    },
  };
}
