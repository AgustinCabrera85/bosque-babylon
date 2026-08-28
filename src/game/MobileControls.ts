import { getNextPrimaryViewMode, type PlayerController, type ViewMode } from "./PlayerController";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isMobileBrowser() {
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

function getViewModeShortLabel(mode: ViewMode) {
  if (mode === "first") return "1P";
  if (mode === "iso") return "ISO";
  if (mode === "front") return "FR";
  return "3P";
}

function getViewModeName(mode: ViewMode) {
  if (mode === "first") return "primera persona";
  if (mode === "iso") return "isometrica";
  if (mode === "front") return "frontal";
  return "tercera persona";
}

export function setupMobileControls(player: PlayerController, onInteract: () => void) {
  if (!isMobileBrowser()) return;

  const root = document.getElementById("mobileControls");
  const stick = document.getElementById("moveStick");
  const thumb = stick?.querySelector<HTMLElement>(".stick-thumb");
  const lookPad = document.getElementById("lookPad");
  const runButton = document.getElementById("runButton");
  const jumpButton = document.getElementById("jumpButton");
  const interactButton = document.getElementById("interactButton");
  const cameraButton = document.getElementById("mobileCameraButton") as HTMLButtonElement | null;

  if (!root || !stick || !thumb || !lookPad || !runButton || !jumpButton || !interactButton || !cameraButton) return;

  player.setMobileEnabled(true);
  root.classList.add("enabled");
  root.setAttribute("aria-hidden", "false");

  let movePointer: number | null = null;
  let lookPointer: number | null = null;
  let lastLookX = 0;
  let lastLookY = 0;

  const stopEvent = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const resetStick = () => {
    movePointer = null;
    player.setMobileMove(0, 0);
    thumb.style.transform = "translate(-50%, -50%)";
  };

  const updateStick = (event: PointerEvent) => {
    const rect = stick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width * 0.38;
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const len = Math.hypot(rawX, rawY);
    const scale = len > radius ? radius / len : 1;
    const x = rawX * scale;
    const y = rawY * scale;

    thumb.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    player.setMobileMove(clamp(x / radius, -1, 1), clamp(-y / radius, -1, 1));
  };

  stick.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    movePointer = event.pointerId;
    stick.setPointerCapture(event.pointerId);
    updateStick(event);
  });

  stick.addEventListener("pointermove", (event) => {
    if (event.pointerId !== movePointer) return;
    stopEvent(event);
    updateStick(event);
  });

  stick.addEventListener("pointerup", resetStick);
  stick.addEventListener("pointercancel", resetStick);

  lookPad.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    lookPointer = event.pointerId;
    lastLookX = event.clientX;
    lastLookY = event.clientY;
    lookPad.setPointerCapture(event.pointerId);
  });

  lookPad.addEventListener("pointermove", (event) => {
    if (event.pointerId !== lookPointer) return;
    stopEvent(event);
    player.addMobileLook(event.clientX - lastLookX, event.clientY - lastLookY);
    lastLookX = event.clientX;
    lastLookY = event.clientY;
  });

  const resetLook = () => {
    lookPointer = null;
  };

  lookPad.addEventListener("pointerup", resetLook);
  lookPad.addEventListener("pointercancel", resetLook);

  runButton.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    runButton.classList.add("active");
    player.setMobileRun(true);
  });

  const stopRun = () => {
    runButton.classList.remove("active");
    player.setMobileRun(false);
  };
  runButton.addEventListener("pointerup", stopRun);
  runButton.addEventListener("pointercancel", stopRun);
  runButton.addEventListener("pointerleave", stopRun);

  jumpButton.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    player.queueJump();
  });

  interactButton.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    onInteract();
  });

  player.onViewModeChange((mode) => {
    const nextMode = getNextPrimaryViewMode(mode);
    const isDefaultView = mode === "third";
    cameraButton.classList.toggle("active", !isDefaultView);
    cameraButton.textContent = getViewModeShortLabel(nextMode);
    cameraButton.setAttribute("aria-pressed", String(!isDefaultView));
    cameraButton.setAttribute(
      "aria-label",
      `Cambiar a vista ${getViewModeName(nextMode)}`
    );
  });

  cameraButton.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    player.toggleViewMode();
  });
}
