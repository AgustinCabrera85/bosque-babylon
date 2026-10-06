import type { Engine } from "@babylonjs/core/Engines/engine";
import type { InputManager } from "./input/InputManager";

export type ResolutionMode = "auto" | "100" | "80" | "67" | "50";

type StoredVideoSettings = {
  resolutionMode: ResolutionMode;
};

type PauseVideoOptions = {
  engine: Engine;
  getAutomaticHardwareScaling: () => number;
  input: InputManager;
  signal: AbortSignal;
  onChanged?: (message: string) => void;
};

export type PauseVideoHandle = {
  refresh: () => void;
};

const STORAGE_KEY = "bosque:videoSettings:v1";
const DEFAULT_RESOLUTION_MODE: ResolutionMode = "auto";
const RESOLUTION_SCALES: Record<Exclude<ResolutionMode, "auto">, number> = {
  "100": 1,
  "80": 0.8,
  "67": 0.67,
  "50": 0.5,
};

function isResolutionMode(value: unknown): value is ResolutionMode {
  return value === "auto" || value === "100" || value === "80" || value === "67" || value === "50";
}

export function readStoredResolutionMode(): ResolutionMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RESOLUTION_MODE;
    const parsed = JSON.parse(raw) as Partial<StoredVideoSettings>;
    return isResolutionMode(parsed.resolutionMode)
      ? parsed.resolutionMode
      : DEFAULT_RESOLUTION_MODE;
  } catch {
    return DEFAULT_RESOLUTION_MODE;
  }
}

function storeResolutionMode(resolutionMode: ResolutionMode) {
  try {
    const settings: StoredVideoSettings = { resolutionMode };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private browsing. The live setting still works.
  }
}

export function resolveHardwareScalingLevel(
  resolutionMode: ResolutionMode,
  automaticHardwareScaling: number
) {
  if (resolutionMode === "auto") return automaticHardwareScaling;
  return 1 / RESOLUTION_SCALES[resolutionMode];
}

function getEffectiveScalePercent(engine: Engine) {
  return Math.round(100 / engine.getHardwareScalingLevel());
}

export function setupPauseVideo({
  engine,
  getAutomaticHardwareScaling,
  input,
  signal,
  onChanged,
}: PauseVideoOptions): PauseVideoHandle {
  const resolutionButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-resolution-mode]")
  );
  const resolutionValue = document.getElementById("resolutionValue");
  const fullscreenToggle = document.getElementById("fullscreenToggle") as HTMLInputElement | null;
  const fullscreenHint = document.getElementById("fullscreenHint");
  let resolutionMode = readStoredResolutionMode();

  const renderResolution = () => {
    const effectivePercent = getEffectiveScalePercent(engine);
    const renderWidth = engine.getRenderWidth();
    const renderHeight = engine.getRenderHeight();

    for (const button of resolutionButtons) {
      const selected = button.dataset.resolutionMode === resolutionMode;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }

    if (resolutionValue) {
      const prefix = resolutionMode === "auto" ? `Automática (${effectivePercent}%)` : `${effectivePercent}%`;
      resolutionValue.textContent = `${prefix} · ${renderWidth} × ${renderHeight}`;
    }
  };

  const renderFullscreen = () => {
    if (!fullscreenToggle) return;
    const supported = Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
    fullscreenToggle.disabled = !supported;
    fullscreenToggle.checked = document.fullscreenElement !== null;
    if (fullscreenHint) {
      fullscreenHint.textContent = !supported
        ? "Pantalla completa no está disponible en este navegador."
        : input.getActiveDevice() === "keyboardMouse"
          ? "El HUD y el menú permanecen visibles. Pulsa Esc para salir."
          : "El HUD y el menú permanecen visibles. La salida depende del navegador.";
    }
  };

  const applyResolutionMode = (nextMode: ResolutionMode, announce = true) => {
    resolutionMode = nextMode;
    const hardwareScaling = resolveHardwareScalingLevel(
      nextMode,
      getAutomaticHardwareScaling()
    );
    engine.setHardwareScalingLevel(hardwareScaling);
    storeResolutionMode(nextMode);
    renderResolution();
    if (announce) onChanged?.(`Resolución interna: ${getEffectiveScalePercent(engine)}%`);
  };

  for (const button of resolutionButtons) {
    button.addEventListener("click", () => {
      const nextMode = button.dataset.resolutionMode;
      if (isResolutionMode(nextMode)) applyResolutionMode(nextMode);
    }, { signal });

    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = resolutionButtons.indexOf(button);
      const lastIndex = resolutionButtons.length - 1;
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? lastIndex
          : event.key === "ArrowLeft"
            ? (currentIndex - 1 + resolutionButtons.length) % resolutionButtons.length
            : (currentIndex + 1) % resolutionButtons.length;
      const nextButton = resolutionButtons[nextIndex];
      const nextMode = nextButton?.dataset.resolutionMode;
      if (!nextButton || !isResolutionMode(nextMode)) return;
      applyResolutionMode(nextMode);
      nextButton.focus();
    }, { signal });
  }

  fullscreenToggle?.addEventListener("change", () => {
    const shouldEnter = fullscreenToggle.checked;
    void (async () => {
      try {
        if (shouldEnter && document.fullscreenElement === null) {
          await document.documentElement.requestFullscreen({ navigationUI: "hide" });
        } else if (!shouldEnter && document.fullscreenElement !== null) {
          await document.exitFullscreen();
        }
        onChanged?.(shouldEnter ? "Pantalla completa activada" : "Pantalla completa desactivada");
      } catch {
        onChanged?.("No se pudo cambiar el modo de pantalla");
      } finally {
        renderFullscreen();
      }
    })();
  }, { signal });

  document.addEventListener("fullscreenchange", () => {
    engine.resize();
    renderFullscreen();
    renderResolution();
  }, { signal });

  window.addEventListener("resize", renderResolution, { signal });
  const unsubscribe = input.onActiveDeviceChanged(renderFullscreen);
  signal.addEventListener("abort", unsubscribe, { once: true });

  renderResolution();
  renderFullscreen();

  return {
    refresh() {
      renderResolution();
      renderFullscreen();
    },
  };
}
