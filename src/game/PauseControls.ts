import type { GameAction, InputDeviceType } from "./input/InputActions";
import type {
  GamepadBinding,
  KeyboardMouseActionBinding,
} from "./input/InputBindings";
import type { InputManager } from "./input/InputManager";

type SelectableControlMode = Extract<InputDeviceType, "keyboardMouse" | "gamepad">;
type ControllerFamily = "xbox" | "playstation" | "nintendo" | "generic";

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

const FAMILY_LABELS: Record<ControllerFamily, string> = {
  xbox: "Xbox",
  playstation: "PlayStation",
  nintendo: "Nintendo",
  generic: "Gamepad",
};

const BUTTON_LABELS: Record<ControllerFamily, readonly string[]> = {
  xbox: [
    "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "L3", "R3",
    "Cruceta ↑", "Cruceta ↓", "Cruceta ←", "Cruceta →", "Xbox",
  ],
  playstation: [
    "✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Crear / Share", "Options", "L3", "R3",
    "Cruceta ↑", "Cruceta ↓", "Cruceta ←", "Cruceta →", "PS",
  ],
  nintendo: [
    "B", "A", "Y", "X", "L", "R", "ZL", "ZR", "−", "+", "Stick L", "Stick R",
    "Cruceta ↑", "Cruceta ↓", "Cruceta ←", "Cruceta →", "Home",
  ],
  generic: [
    "Botón sur", "Botón este", "Botón oeste", "Botón norte", "Bumper izq.", "Bumper der.",
    "Gatillo izq.", "Gatillo der.", "Select", "Start", "Stick izq.", "Stick der.",
    "Cruceta ↑", "Cruceta ↓", "Cruceta ←", "Cruceta →", "Botón central",
  ],
};

function readConnectedGamepads() {
  if (typeof navigator.getGamepads !== "function") return [];
  return Array.from(navigator.getGamepads()).filter(
    (gamepad): gamepad is Gamepad => !!gamepad?.connected
  );
}

function detectControllerFamily(id: string): ControllerFamily {
  const normalized = id.toLowerCase();
  if (/dualsense|dualshock|playstation|wireless controller|054c/.test(normalized)) {
    return "playstation";
  }
  if (/nintendo|switch|joy-con|057e/.test(normalized)) return "nintendo";
  if (/xbox|xinput|045e/.test(normalized)) return "xbox";
  return "generic";
}

function gamepadButtonLabel(index: number, family: ControllerFamily) {
  return BUTTON_LABELS[family][index] ?? `Botón ${index}`;
}

function mouseButtonLabel(button: number) {
  if (button === 0) return "Clic izq.";
  if (button === 1) return "Clic central";
  if (button === 2) return "Clic der.";
  return `Botón mouse ${button + 1}`;
}

function keyCodeLabel(code: string) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const labels: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    ShiftLeft: "Shift",
    ShiftRight: "Shift",
    ControlLeft: "Ctrl",
    ControlRight: "Ctrl",
    AltLeft: "Alt",
    AltRight: "Alt",
    Space: "Espacio",
    Escape: "Esc",
    Enter: "Enter",
    Tab: "Tab",
  };
  return labels[code] ?? code;
}

function formatKeyboardBinding(binding: KeyboardMouseActionBinding) {
  if (binding.type === "key") return keyCodeLabel(binding.code);
  const modifier = binding.requiresButtons
    ?.map((button) => mouseButtonLabel(button))
    .join(" + ");
  return modifier
    ? `${modifier} + ${mouseButtonLabel(binding.button)}`
    : mouseButtonLabel(binding.button);
}

function formatGamepadBinding(
  binding: GamepadBinding,
  family: ControllerFamily,
  usesStandardMapping: boolean
) {
  if (binding.type === "button") {
    return usesStandardMapping
      ? gamepadButtonLabel(binding.index, family)
      : `Botón ${binding.index}`;
  }
  const direction = binding.direction === -1 ? "−" : binding.direction === 1 ? "+" : "";
  return `Eje ${binding.index}${direction}`;
}

function compactGamepadName(id: string) {
  return id
    .replace(/\s*\(.*?STANDARD GAMEPAD.*?\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || "Gamepad sin nombre";
}

function formatKeyboardMovement(bindings: {
  left: readonly string[];
  right: readonly string[];
  forward: readonly string[];
  backward: readonly string[];
}) {
  const directions = [
    bindings.forward,
    bindings.left,
    bindings.backward,
    bindings.right,
  ];
  const columns = Math.max(...directions.map((codes) => codes.length));
  return Array.from({ length: columns }, (_, column) =>
    directions
      .map((codes) => codes[column])
      .filter((code): code is string => !!code)
      .map(keyCodeLabel)
      .join(" / ")
  ).filter(Boolean).join(" · ");
}

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

  const addMapping = (label: string, binding: string) => {
    if (!mappingList) return;
    const row = document.createElement("div");
    row.className = "control-mapping-item";
    const action = document.createElement("span");
    action.textContent = label;
    const value = document.createElement("strong");
    value.textContent = binding;
    row.append(action, value);
    mappingList.appendChild(row);
  };

  const render = () => {
    const gamepads = readConnectedGamepads();
    const gamepad = gamepads[0] ?? null;
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
        gamepadDetails.textContent = `${FAMILY_LABELS[family]} · ${mapping} · ${gamepad.buttons.length} botones · ${gamepad.axes.length} ejes${extraPads}`;
      } else {
        gamepadDetails.textContent = "Conecta un mando y pulsa cualquier botón para detectarlo.";
      }
    }

    mappingList?.replaceChildren();
    if (shownMode === "gamepad") {
      if (mappingTitle) mappingTitle.textContent = "Distribución de botones";
      if (mappingDevice) {
        mappingDevice.textContent = gamepad
          ? `${FAMILY_LABELS[family]} · ${gamepad.mapping === "standard" ? "Estándar" : "Directo"}`
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
            .map((binding) => formatGamepadBinding(binding, family, usesStandardMapping))
            .join(" / ")
        );
      }
      return;
    }

    if (mappingTitle) mappingTitle.textContent = "Distribución de teclado";
    if (mappingDevice) mappingDevice.textContent = "Teclado y ratón";
    const bindings = input.exportBindings().keyboardMouse;
    addMapping("Moverse", formatKeyboardMovement(bindings.movement));
    addMapping("Cámara", "Movimiento del ratón");
    for (const action of ACTION_ORDER) {
      const actionBindings = bindings.actions[action];
      if (!actionBindings?.length) continue;
      addMapping(
        ACTION_LABELS[action] ?? action,
        [...new Set(actionBindings.map(formatKeyboardBinding))].join(" / ")
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
