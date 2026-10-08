import type { GamepadBinding, KeyboardMouseActionBinding } from "./InputBindings";

export type ControllerFamily = "xbox" | "playstation" | "nintendo" | "generic";
export type GamepadIconVariant = "color" | "mono";
export type InputBindingPresentation = {
  label: string;
  iconPath?: string;
  iconKind?: "keyboard-key" | "keyboard-combo" | "mouse";
};

const KEYBOARD_ICON_ROOT = "assets/ui/keyboard_icons_svg/accent";
const MOUSE_ICON_ROOT = "assets/ui/mouse_icons_svg/accent";
export type MouseIconName =
  | "mouse"
  | "mouse_left_click"
  | "mouse_middle_click"
  | "mouse_right_click"
  | "mouse_both_click"
  | "mouse_drag"
  | "mouse_wheel";
const KEYBOARD_KEY_ICON_NAMES: Readonly<Record<string, string>> = {
  ShiftLeft: "key_shift",
  ShiftRight: "key_shift",
  Space: "key_space",
  KeyE: "key_e",
  KeyF: "key_f",
  KeyI: "key_i",
  KeyQ: "key_q",
  KeyV: "key_v",
  Escape: "key_esc",
};

export const CONTROLLER_FAMILY_LABELS: Record<ControllerFamily, string> = {
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

const BUTTON_ICON_NAMES: Partial<Record<ControllerFamily, readonly string[]>> = {
  xbox: [
    "xbox_a", "xbox_b", "xbox_x", "xbox_y", "xbox_lb", "xbox_rb", "xbox_lt", "xbox_rt",
    "xbox_view", "xbox_menu", "xbox_ls", "xbox_rs", "xbox_dpad_up", "xbox_dpad_down",
    "xbox_dpad_left", "xbox_dpad_right", "xbox_home",
  ],
  playstation: [
    "ps_cross", "ps_circle", "ps_square", "ps_triangle", "ps_l1", "ps_r1", "ps_l2", "ps_r2",
    "ps_create", "ps_options", "ps_l3", "ps_r3", "ps_dpad_up", "ps_dpad_down",
    "ps_dpad_left", "ps_dpad_right", "ps_home",
  ],
};

export function readConnectedGamepads() {
  if (typeof navigator.getGamepads !== "function") return [];
  return Array.from(navigator.getGamepads()).filter(
    (gamepad): gamepad is Gamepad => !!gamepad?.connected
  );
}

export function detectControllerFamily(id: string): ControllerFamily {
  const normalized = id.toLowerCase();
  if (/dualsense|dualshock|playstation|wireless controller|054c/.test(normalized)) {
    return "playstation";
  }
  if (/nintendo|switch|joy-con|057e/.test(normalized)) return "nintendo";
  if (/xbox|xinput|045e/.test(normalized)) return "xbox";
  return "generic";
}

export function gamepadButtonLabel(index: number, family: ControllerFamily) {
  return BUTTON_LABELS[family][index] ?? `Botón ${index}`;
}

export function gamepadButtonIconPath(
  index: number,
  family: ControllerFamily,
  variant: GamepadIconVariant = "color"
) {
  const iconName = BUTTON_ICON_NAMES[family]?.[index];
  if (!iconName || (family !== "xbox" && family !== "playstation")) return null;
  return `assets/ui/gamepad_icons_svg/${family}/${variant}/${iconName}.svg`;
}

export function formatGamepadBindingPresentation(
  binding: GamepadBinding,
  family: ControllerFamily,
  usesStandardMapping: boolean,
  variant: GamepadIconVariant = "color"
): InputBindingPresentation {
  const label = formatGamepadBinding(binding, family, usesStandardMapping);
  if (binding.type !== "button" || !usesStandardMapping) return { label };
  return {
    label,
    iconPath: gamepadButtonIconPath(binding.index, family, variant) ?? undefined,
  };
}

export function mouseButtonLabel(button: number) {
  if (button === 0) return "Clic izq.";
  if (button === 1) return "Clic central";
  if (button === 2) return "Clic der.";
  return `Botón mouse ${button + 1}`;
}

export function keyCodeLabel(code: string) {
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

export function formatKeyboardBinding(binding: KeyboardMouseActionBinding) {
  if (binding.type === "key") return keyCodeLabel(binding.code);
  const modifier = binding.requiresButtons
    ?.map((button) => mouseButtonLabel(button))
    .join(" + ");
  return modifier
    ? `${modifier} + ${mouseButtonLabel(binding.button)}`
    : mouseButtonLabel(binding.button);
}

export function formatKeyboardBindingPresentation(
  binding: KeyboardMouseActionBinding
): InputBindingPresentation {
  const label = formatKeyboardBinding(binding);
  if (binding.type === "key") {
    const iconName = KEYBOARD_KEY_ICON_NAMES[binding.code];
    return iconName
      ? {
          label,
          iconPath: `${KEYBOARD_ICON_ROOT}/${iconName}.svg`,
          iconKind: "keyboard-key",
        }
      : { label };
  }

  const buttons = new Set([binding.button, ...(binding.requiresButtons ?? [])]);
  if (buttons.has(0) && buttons.has(2)) {
    return mouseIconPresentation("mouse_both_click", label);
  }
  const iconName = binding.button === 0
    ? "mouse_left_click"
    : binding.button === 1
      ? "mouse_middle_click"
      : binding.button === 2
        ? "mouse_right_click"
        : null;
  return iconName ? mouseIconPresentation(iconName, label) : { label };
}

export function mouseIconPresentation(
  iconName: MouseIconName,
  label: string
): InputBindingPresentation {
  return {
    label,
    iconPath: `${MOUSE_ICON_ROOT}/${iconName}.svg`,
    iconKind: "mouse",
  };
}

export function formatGamepadBinding(
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

export function compactGamepadName(id: string) {
  return id
    .replace(/\s*\(.*?STANDARD GAMEPAD.*?\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || "Gamepad sin nombre";
}

export function formatKeyboardMovement(bindings: {
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

export function formatKeyboardMovementPresentations(bindings: {
  left: readonly string[];
  right: readonly string[];
  forward: readonly string[];
  backward: readonly string[];
}): InputBindingPresentation[] {
  const presentations: InputBindingPresentation[] = [];
  if (
    bindings.forward.includes("KeyW") &&
    bindings.left.includes("KeyA") &&
    bindings.backward.includes("KeyS") &&
    bindings.right.includes("KeyD")
  ) {
    presentations.push({
      label: "WASD",
      iconPath: `${KEYBOARD_ICON_ROOT}/combo_wasd.svg`,
      iconKind: "keyboard-combo",
    });
  }
  if (
    bindings.forward.includes("ArrowUp") &&
    bindings.left.includes("ArrowLeft") &&
    bindings.backward.includes("ArrowDown") &&
    bindings.right.includes("ArrowRight")
  ) {
    presentations.push({
      label: "Flechas",
      iconPath: `${KEYBOARD_ICON_ROOT}/combo_arrows.svg`,
      iconKind: "keyboard-combo",
    });
  }
  return presentations;
}
