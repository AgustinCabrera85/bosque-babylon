import type { GameAction, InputDeviceType } from "./input/InputActions";
import type { InputManager } from "./input/InputManager";
import {
  compactGamepadName,
  CONTROLLER_FAMILY_LABELS,
  detectControllerFamily,
  formatGamepadBindingPresentation,
  formatKeyboardBindingPresentation,
  formatKeyboardMovement,
  formatKeyboardMovementPresentations,
  mouseIconPresentation,
  readConnectedGamepads,
  type InputBindingPresentation,
} from "./input/InputBindingLabels";
import { asset } from "../utils/asset";

type SelectableControlMode = Extract<InputDeviceType, "keyboardMouse" | "gamepad">;

type PauseControlsOptions = {
  input: InputManager;
  signal: AbortSignal;
  onModeChanged?: (message: string) => void;
};

export type PauseControlsHandle = {
  refresh: () => void;
};

const ACTION_ORDER: readonly GameAction[] = [
  "run",
  "jump",
  "interact",
  "attack",
  "aim",
  "absorbLight",
  "changeCamera",
  "toggleFlashlight",
  "inventory",
  "pause",
  "cancel",
];

const ACTION_LABELS: Partial<Record<GameAction, string>> = {
  run: "Correr",
  jump: "Saltar",
  interact: "Interactuar",
  attack: "Lanzar esfera",
  aim: "Apuntar",
  absorbLight: "Absorber luz",
  changeCamera: "Cambiar cámara",
  toggleFlashlight: "Linterna",
  inventory: "Inventario",
  pause: "Pausa",
  cancel: "Cancelar / volver",
};

export function setupPauseControls({
  input,
  signal,
  onModeChanged,
}: PauseControlsOptions): PauseControlsHandle {
  const modeButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-control-mode]")
  );
  const modeState = document.getElementById("controlModeState");
  const gamepadConnection = document.getElementById("gamepadConnection");
  const gamepadConnectionDot = document.getElementById("gamepadConnectionDot");
  const gamepadName = document.getElementById("gamepadName");
  const gamepadDetails = document.getElementById("gamepadDetails");
  const mappingTitle = document.getElementById("controlMappingTitle");
  const mappingDevice = document.getElementById("controlMappingDevice");
  const mappingList = document.getElementById("controlMappingList");

  const initialDevice = input.getActiveDevice();
  let shownMode: SelectableControlMode = initialDevice === "gamepad"
    ? "gamepad"
    : "keyboardMouse";

  const addMapping = (
    label: string,
    binding: string | readonly InputBindingPresentation[]
  ) => {
    if (!mappingList) return;
    const row = document.createElement("div");
    row.className = "control-mapping-item";
    const action = document.createElement("span");
    action.textContent = label;
    const value = document.createElement("strong");
    if (typeof binding === "string") {
      value.textContent = binding;
    } else {
      value.className = "control-mapping-bindings";
      const uniqueBindings = binding.filter((presentation, index) =>
        binding.findIndex((candidate) =>
          candidate.label === presentation.label &&
          candidate.iconPath === presentation.iconPath
        ) === index
      );
      for (const [index, presentation] of uniqueBindings.entries()) {
        if (index > 0) {
          const separator = document.createElement("span");
          separator.textContent = "/";
          value.appendChild(separator);
        }
        if (presentation.iconPath) {
          const icon = document.createElement("img");
          icon.className = "input-button-icon control-mapping-icon";
          if (presentation.iconKind) {
            icon.classList.add(`${presentation.iconKind}-icon`);
          }
          icon.src = asset(presentation.iconPath);
          icon.alt = presentation.label;
          icon.title = presentation.label;
          value.appendChild(icon);
        } else {
          const text = document.createElement("span");
          text.textContent = presentation.label;
          value.appendChild(text);
        }
      }
    }
    row.append(action, value);
    mappingList.appendChild(row);
  };

  const render = () => {
    const gamepads = readConnectedGamepads();
    const gamepad = input.getActiveGamepad() ?? gamepads[0] ?? null;
    const family = gamepad ? detectControllerFamily(gamepad.id) : "generic";
    const selectionMode = input.getSelectionMode();
    const activeDevice = input.getActiveDevice();

    if (selectionMode === "auto") {
      if (activeDevice === "gamepad") shownMode = "gamepad";
      if (activeDevice === "keyboardMouse") shownMode = "keyboardMouse";
    } else if (selectionMode === "keyboardMouse" || selectionMode === "gamepad") {
      shownMode = selectionMode;
    }

    for (const button of modeButtons) {
      const mode = button.dataset.controlMode as SelectableControlMode;
      const selected = selectionMode === mode;
      const activeAutomatically = selectionMode === "auto" && activeDevice === mode;
      button.classList.toggle("selected", selected);
      button.classList.toggle("active", activeAutomatically);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = mode === "gamepad" && !gamepad && !selected;
      const marker = button.querySelector<HTMLElement>(".control-device-marker");
      if (marker) {
        marker.textContent = selected ? "Elegido" : activeAutomatically ? "Activo ahora" : "";
      }
    }

    if (modeState) {
      modeState.textContent = selectionMode === "auto"
        ? "Selección automática"
        : selectionMode === "gamepad"
          ? "Modo fijo · Gamepad"
          : "Modo fijo · Teclado y ratón";
    }

    gamepadConnection?.classList.toggle("connected", !!gamepad);
    gamepadConnectionDot?.classList.toggle("connected", !!gamepad);
    if (gamepadName) {
      gamepadName.textContent = gamepad
        ? compactGamepadName(gamepad.id)
        : "No hay ningún gamepad conectado";
    }
    if (gamepadDetails) {
      if (gamepad) {
        const extraPads = gamepads.length > 1 ? ` · ${gamepads.length} mandos detectados` : "";
        const mapping = gamepad.mapping === "standard" ? "Mapping estándar" : "Mapping del dispositivo";
        gamepadDetails.textContent = `${CONTROLLER_FAMILY_LABELS[family]} · ${mapping} · ${gamepad.buttons.length} botones · ${gamepad.axes.length} ejes${extraPads}`;
      } else {
        gamepadDetails.textContent = "Conecta un mando y pulsa cualquier botón para detectarlo.";
      }
    }

    mappingList?.replaceChildren();
    if (shownMode === "gamepad") {
      if (mappingTitle) mappingTitle.textContent = "Distribución de botones";
      if (mappingDevice) {
        mappingDevice.textContent = gamepad
          ? `${CONTROLLER_FAMILY_LABELS[family]} · ${gamepad.mapping === "standard" ? "Estándar" : "Directo"}`
          : "Gamepad estándar";
      }
      const bindings = input.exportBindings().gamepad;
      const usesStandardMapping = gamepad?.mapping === "standard" || !gamepad;
      const standardAxes = bindings.movement.x === 0 && bindings.movement.y === 1;
      const standardLook = bindings.look.x === 2 && bindings.look.y === 3;
      addMapping("Moverse", standardAxes ? "Stick izquierdo" : `Ejes ${bindings.movement.x} / ${bindings.movement.y}`);
      addMapping("Cámara", standardLook ? "Stick derecho" : `Ejes ${bindings.look.x} / ${bindings.look.y}`);
      for (const action of ACTION_ORDER) {
        const actionBindings = bindings.actions[action];
        if (!actionBindings?.length) continue;
        addMapping(
          ACTION_LABELS[action] ?? action,
          actionBindings
            .map((binding) =>
              formatGamepadBindingPresentation(binding, family, usesStandardMapping)
            )
        );
      }
      return;
    }

    if (mappingTitle) mappingTitle.textContent = "Distribución de teclado";
    if (mappingDevice) mappingDevice.textContent = "Teclado y ratón";
    const bindings = input.exportBindings().keyboardMouse;
    const movementPresentations = formatKeyboardMovementPresentations(bindings.movement);
    addMapping(
      "Moverse",
      movementPresentations.length
        ? movementPresentations
        : formatKeyboardMovement(bindings.movement)
    );
    addMapping("Cámara", [mouseIconPresentation("mouse", "Movimiento del ratón")]);
    for (const action of ACTION_ORDER) {
      const actionBindings = bindings.actions[action];
      if (!actionBindings?.length) continue;
      addMapping(
        ACTION_LABELS[action] ?? action,
        actionBindings.map(formatKeyboardBindingPresentation)
      );
    }
  };

  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.controlMode;
      if (mode !== "keyboardMouse" && mode !== "gamepad") return;
      shownMode = mode;
      input.setSelectionMode(mode);
      onModeChanged?.(
        mode === "gamepad" ? "Control cambiado a gamepad" : "Control cambiado a teclado y ratón"
      );
      render();
    }, { signal });
  }

  window.addEventListener("gamepadconnected", render, { signal });
  window.addEventListener("gamepaddisconnected", render, { signal });
  const unsubscribe = input.onActiveDeviceChanged(render);
  signal.addEventListener("abort", unsubscribe, { once: true });

  render();
  return { refresh: render };
}
