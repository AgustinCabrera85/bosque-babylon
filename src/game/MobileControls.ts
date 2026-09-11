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

export type MobileAttackActions = {
  start: () => boolean;
  release: () => void;
  cancel: () => void;
};

export type MobileAbsorptionActions = {
  start: () => boolean;
  release: () => void;
  cancel: () => void;
};

export function setupMobileControls(
  player: PlayerController,
  onInteract: () => void,
  attack?: MobileAttackActions,
  absorption?: MobileAbsorptionActions
) {
  if (!isMobileBrowser()) return () => {};

  const abortController = new AbortController();
  const signal = abortController.signal;

  const root = document.getElementById("mobileControls");
  const stick = document.getElementById("moveStick");
  const thumb = stick?.querySelector<HTMLElement>(".stick-thumb");
  const lookPad = document.getElementById("lookPad");
  const runButton = document.getElementById("runButton");
  const jumpButton = document.getElementById("jumpButton");
  const interactButton = document.getElementById("interactButton");
  const attackButton = document.getElementById("attackButton");
  const absorbLightButton = document.getElementById("absorbLightButton");
  const cameraButton = document.getElementById("mobileCameraButton") as HTMLButtonElement | null;

  if (!root || !stick || !thumb || !lookPad || !runButton || !jumpButton || !interactButton || !attackButton || !absorbLightButton || !cameraButton) {
    return () => abortController.abort();
  }

  player.setMobileEnabled(true);
  root.classList.add("enabled");
  root.setAttribute("aria-hidden", "false");

  let movePointer: number | null = null;
  let lookPointer: number | null = null;
  let runPointer: number | null = null;
  let attackPointer: number | null = null;
  let absorptionPointer: number | null = null;
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

  const stopAttack = (release: boolean) => {
    const pointerId = attackPointer;
    attackPointer = null;
    if (pointerId !== null) releasePointer(attackButton, pointerId);
    attackButton.classList.remove("active");
    if (release) attack?.release();
    else attack?.cancel();
  };

  const releaseAttackFromEvent = (event: PointerEvent) => {
    if (attackPointer === null || event.pointerId !== attackPointer) return;
    stopEvent(event);
    stopAttack(true);
  };

  const cancelAttackFromEvent = (event: PointerEvent) => {
    if (attackPointer === null || event.pointerId !== attackPointer) return;
    stopEvent(event);
    stopAttack(false);
  };

  const cancelAttackFromWindow = (event: PointerEvent) => {
    if (attackPointer === null || event.pointerId !== attackPointer) return;
    stopAttack(false);
  };

  const releaseAttackFromWindow = (event: PointerEvent) => {
    if (attackPointer === null || event.pointerId !== attackPointer) return;
    stopAttack(true);
  };

  const stopAbsorption = (release: boolean) => {
    const pointerId = absorptionPointer;
    absorptionPointer = null;
    if (pointerId !== null) releasePointer(absorbLightButton, pointerId);
    absorbLightButton.classList.remove("active");
    if (release) absorption?.release();
    else absorption?.cancel();
  };

  const releaseAbsorptionFromEvent = (event: PointerEvent) => {
    if (absorptionPointer === null || event.pointerId !== absorptionPointer) return;
    stopEvent(event);
    stopAbsorption(true);
  };

  const cancelAbsorptionFromEvent = (event: PointerEvent) => {
    if (absorptionPointer === null || event.pointerId !== absorptionPointer) return;
    stopEvent(event);
    stopAbsorption(false);
  };

  const releaseAbsorptionFromWindow = (event: PointerEvent) => {
    if (absorptionPointer === null || event.pointerId !== absorptionPointer) return;
    stopAbsorption(true);
  };

  const cancelAbsorptionFromWindow = (event: PointerEvent) => {
    if (absorptionPointer === null || event.pointerId !== absorptionPointer) return;
    stopAbsorption(false);
  };

  stick.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    if (movePointer !== null) resetStick();
    movePointer = event.pointerId;
    capturePointer(stick, event.pointerId);
    updateStick(event);
  }, { signal });

  stick.addEventListener("pointermove", (event) => {
    if (event.pointerId !== movePointer) return;
    stopEvent(event);
    updateStick(event);
  }, { signal });

  stick.addEventListener("pointerup", resetStickFromEvent, { signal });
  stick.addEventListener("pointercancel", resetStickFromEvent, { signal });
  stick.addEventListener("lostpointercapture", resetStickFromWindow, { signal });

  lookPad.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    if (lookPointer !== null) resetLook();
    lookPointer = event.pointerId;
    lastLookX = event.clientX;
    lastLookY = event.clientY;
    capturePointer(lookPad, event.pointerId);
  }, { signal });

  lookPad.addEventListener("pointermove", (event) => {
    if (event.pointerId !== lookPointer) return;
    stopEvent(event);
    player.addMobileLook(event.clientX - lastLookX, event.clientY - lastLookY);
    lastLookX = event.clientX;
    lastLookY = event.clientY;
  }, { signal });

  lookPad.addEventListener("pointerup", resetLookFromEvent, { signal });
  lookPad.addEventListener("pointercancel", resetLookFromEvent, { signal });
  lookPad.addEventListener("lostpointercapture", resetLookFromWindow, { signal });

  runButton.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    if (runPointer !== null) stopRun();
    runPointer = event.pointerId;
    capturePointer(runButton, event.pointerId);
    runButton.classList.add("active");
    player.setMobileRun(true);
  }, { signal });

  runButton.addEventListener("pointerup", stopRunFromEvent, { signal });
  runButton.addEventListener("pointercancel", stopRunFromEvent, { signal });
  runButton.addEventListener("lostpointercapture", stopRunFromWindow, { signal });
  runButton.addEventListener("pointerleave", stopRun, { signal });

  jumpButton.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    player.queueJump();
  }, { signal });

  interactButton.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    onInteract();
  }, { signal });

  attackButton.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    if (attackPointer !== null) stopAttack(false);
    if (!attack?.start()) return;
    attackPointer = event.pointerId;
    capturePointer(attackButton, event.pointerId);
    attackButton.classList.add("active");
  }, { signal });
  attackButton.addEventListener("pointerup", releaseAttackFromEvent, { signal });
  attackButton.addEventListener("pointercancel", cancelAttackFromEvent, { signal });
  attackButton.addEventListener("lostpointercapture", cancelAttackFromWindow, { signal });

  absorbLightButton.addEventListener("pointerdown", (event) => {
    stopEvent(event);
    if (absorptionPointer !== null) stopAbsorption(false);
    if (!absorption?.start()) return;
    absorptionPointer = event.pointerId;
    capturePointer(absorbLightButton, event.pointerId);
    absorbLightButton.classList.add("active");
  }, { signal });
  absorbLightButton.addEventListener("pointerup", releaseAbsorptionFromEvent, { signal });
  absorbLightButton.addEventListener("pointercancel", cancelAbsorptionFromEvent, { signal });
  absorbLightButton.addEventListener("lostpointercapture", cancelAbsorptionFromWindow, { signal });

  const unsubscribeViewMode = player.onViewModeChange((mode) => {
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
  }, { signal });

  const resetMobileInput = () => {
    resetStick();
    resetLook();
    stopRun();
    stopAttack(false);
    stopAbsorption(false);
  };

  window.addEventListener("pointerup", resetStickFromWindow, { capture: true, signal });
  window.addEventListener("pointercancel", resetStickFromWindow, { capture: true, signal });
  window.addEventListener("pointerup", resetLookFromWindow, { capture: true, signal });
  window.addEventListener("pointercancel", resetLookFromWindow, { capture: true, signal });
  window.addEventListener("pointerup", stopRunFromWindow, { capture: true, signal });
  window.addEventListener("pointercancel", stopRunFromWindow, { capture: true, signal });
  window.addEventListener("pointerup", releaseAttackFromWindow, { capture: true, signal });
  window.addEventListener("pointercancel", cancelAttackFromWindow, { capture: true, signal });
  window.addEventListener("pointerup", releaseAbsorptionFromWindow, { capture: true, signal });
  window.addEventListener("pointercancel", cancelAbsorptionFromWindow, { capture: true, signal });
  window.addEventListener("blur", resetMobileInput, { signal });
  window.addEventListener("resize", resetMobileInput, { signal });
  window.visualViewport?.addEventListener("resize", resetMobileInput, { signal });
  window.visualViewport?.addEventListener("scroll", resetMobileInput, { signal });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") resetMobileInput();
  }, { signal });
  window.addEventListener("bosque:pause", (event) => {
    const paused = (event as CustomEvent<{ paused?: boolean }>).detail?.paused;
    if (paused) resetMobileInput();
  }, { signal });

  return () => {
    resetMobileInput();
    unsubscribeViewMode();
    abortController.abort();
    root.classList.remove("enabled");
    root.setAttribute("aria-hidden", "true");
    player.setMobileEnabled(false);
  };
}
