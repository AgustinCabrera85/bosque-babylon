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

function capturePointer(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Some mobile browsers can refuse capture during viewport/overlay changes.
  }
}

function releasePointer(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // The pointer may already have been released by the browser.
  }
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
  let runPointer: number | null = null;
  let lastLookX = 0;
  let lastLookY = 0;

  const stopEvent = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const resetStick = () => {
    const pointerId = movePointer;
    movePointer = null;
    if (pointerId !== null) releasePointer(stick, pointerId);
    player.setMobileMove(0, 0);
    thumb.style.transform = "translate(-50%, -50%)";
  };

  const resetStickFromEvent = (event: PointerEvent) => {
    if (movePointer !== null && event.pointerId !== movePointer) return;
    stopEvent(event);
    resetStick();
  };

  const resetStickFromWindow = (event: PointerEvent) => {
    if (movePointer === null || event.pointerId !== movePointer) return;
    resetStick();
  };

  const updateStick = (event: PointerEvent) => {
    const rect = stick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = Math.min(rect.width, rect.height) * 0.38;
    if (!Number.isFinite(radius) || radius <= 0) {
      resetStick();
      return;
    }

    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const len = Math.hypot(rawX, rawY);
    const scale = len > radius ? radius / len : 1;
    const x = rawX * scale;
    const y = rawY * scale;

    thumb.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    player.setMobileMove(clamp(x / radius, -1, 1), clamp(-y / radius, -1, 1));
  };

  const resetLook = () => {
    const pointerId = lookPointer;
    lookPointer = null;
    if (pointerId !== null) releasePointer(lookPad, pointerId);
  };

  const resetLookFromEvent = (event: PointerEvent) => {
    if (lookPointer !== null && event.pointerId !== lookPointer) return;
    stopEvent(event);
    resetLook();
  };

  const resetLookFromWindow = (event: PointerEvent) => {
    if (lookPointer === null || event.pointerId !== lookPointer) return;
    resetLook();
  };

  const stopRun = () => {
    const pointerId = runPointer;
    runPointer = null;
    if (pointerId !== null) releasePointer(runButton, pointerId);
    runButton.classList.remove("active");
    player.setMobileRun(false);
  };

  const stopRunFromEvent = (event: PointerEvent) => {
    if (runPointer !== null && event.pointerId !== runPointer) return;
    stopEvent(event);
    stopRun();
  };

  const stopRunFromWindow = (event: PointerEvent) => {
    if (runPointer === null || event.pointerId !== runPointer) return;
    stopRun();
  };

  stick.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    if (movePointer !== null) resetStick();
    movePointer = event.pointerId;
    capturePointer(stick, event.pointerId);
    updateStick(event);
  });

  stick.addEventListener("pointermove", (event) => {
    if (event.pointerId !== movePointer) return;
    stopEvent(event);
    updateStick(event);
  });

  stick.addEventListener("pointerup", resetStickFromEvent);
  stick.addEventListener("pointercancel", resetStickFromEvent);
  stick.addEventListener("lostpointercapture", resetStickFromWindow);

  lookPad.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    if (lookPointer !== null) resetLook();
    lookPointer = event.pointerId;
    lastLookX = event.clientX;
    lastLookY = event.clientY;
    capturePointer(lookPad, event.pointerId);
  });

  lookPad.addEventListener("pointermove", (event) => {
    if (event.pointerId !== lookPointer) return;
    stopEvent(event);
    player.addMobileLook(event.clientX - lastLookX, event.clientY - lastLookY);
    lastLookX = event.clientX;
    lastLookY = event.clientY;
  });

  lookPad.addEventListener("pointerup", resetLookFromEvent);
  lookPad.addEventListener("pointercancel", resetLookFromEvent);
  lookPad.addEventListener("lostpointercapture", resetLookFromWindow);

  runButton.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    if (runPointer !== null) stopRun();
    runPointer = event.pointerId;
    capturePointer(runButton, event.pointerId);
    runButton.classList.add("active");
    player.setMobileRun(true);
  });

  runButton.addEventListener("pointerup", stopRunFromEvent);
  runButton.addEventListener("pointercancel", stopRunFromEvent);
  runButton.addEventListener("lostpointercapture", stopRunFromWindow);
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
    const nextMode = getNextPrimaryViewMode(
      mode,
      player.isIsometricViewAllowed
    );
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

  const resetMobileInput = () => {
    resetStick();
    resetLook();
    stopRun();
  };

  window.addEventListener("pointerup", resetStickFromWindow, true);
  window.addEventListener("pointercancel", resetStickFromWindow, true);
  window.addEventListener("pointerup", resetLookFromWindow, true);
  window.addEventListener("pointercancel", resetLookFromWindow, true);
  window.addEventListener("pointerup", stopRunFromWindow, true);
  window.addEventListener("pointercancel", stopRunFromWindow, true);
  window.addEventListener("blur", resetMobileInput);
  window.addEventListener("resize", resetMobileInput);
  window.visualViewport?.addEventListener("resize", resetMobileInput);
  window.visualViewport?.addEventListener("scroll", resetMobileInput);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") resetMobileInput();
  });
  window.addEventListener("bosque:pause", (event) => {
    const paused = (event as CustomEvent<{ paused?: boolean }>).detail?.paused;
    if (paused) resetMobileInput();
  });
}
