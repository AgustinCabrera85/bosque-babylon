import { setupPauseControls } from "./PauseControls";
import type { InputManager } from "./input/InputManager";

type PauseMenuOptions = {
  canvas: HTMLCanvasElement;
  input: InputManager;
};

export type PauseMenuHandle = {
  isPaused: () => boolean;
  setPaused: (paused: boolean) => void;
  toggle: () => void;
  dispose: () => void;
};

type PauseTab = "settings" | "controls";

export function setupPauseMenu({ canvas, input }: PauseMenuOptions): PauseMenuHandle {
  const menu = document.getElementById("pauseMenu");
  const pauseButton = document.getElementById("pauseButton") as HTMLButtonElement | null;
  const saveButton = document.getElementById("saveButton") as HTMLButtonElement | null;
  const exitButton = document.getElementById("exitButton") as HTMLButtonElement | null;
  const pauseStatus = document.getElementById("pauseStatus");
  const tabButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-pause-tab]")
  );
  const tabPanels: Record<PauseTab, HTMLElement | null> = {
    settings: document.getElementById("pauseSettingsPanel"),
    controls: document.getElementById("pauseControlsPanel"),
  };

  let paused = false;
  let wasPointerLocked = document.pointerLockElement === canvas;
  let ignoreEscapeUntil = 0;
  let statusTimer: number | null = null;
  const abortController = new AbortController();
  const signal = abortController.signal;

  const setStatus = (text: string) => {
    if (!pauseStatus) return;
    pauseStatus.textContent = text;
    pauseStatus.classList.add("visible");

    if (statusTimer !== null) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      pauseStatus.textContent = "";
      pauseStatus.classList.remove("visible");
      statusTimer = null;
    }, 1800);
  };

  const controls = setupPauseControls({
    input,
    signal,
    onModeChanged: setStatus,
  });

  const setActiveTab = (tab: PauseTab, focus = false) => {
    for (const button of tabButtons) {
      const selected = button.dataset.pauseTab === tab;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    tabPanels.settings?.toggleAttribute("hidden", tab !== "settings");
    tabPanels.controls?.toggleAttribute("hidden", tab !== "controls");
    if (tab === "controls") controls.refresh();
  };

  const render = () => {
    menu?.classList.toggle("hidden", !paused);
    menu?.setAttribute("aria-hidden", String(!paused));
    pauseButton?.classList.toggle("paused", paused);
    pauseButton?.setAttribute("aria-pressed", String(paused));
    if (paused) controls.refresh();
  };

  const setPaused = (next: boolean) => {
    if (
      next &&
      (document.body.classList.contains("opening-sequence-active") ||
        document.body.classList.contains("sky-eye-cinematic-active"))
    ) return;
    if (paused === next) return;
    paused = next;

    if (paused && document.pointerLockElement === canvas) {
      document.exitPointerLock?.();
    }

    if (paused) {
      window.dispatchEvent(new CustomEvent("bosque:pause", { detail: { paused: true } }));
      window.dispatchEvent(new CustomEvent("bosque:sfx", { detail: { name: "walk", active: false } }));
      window.dispatchEvent(new CustomEvent("bosque:sfx", { detail: { name: "run", active: false } }));
    } else {
      window.dispatchEvent(new CustomEvent("bosque:pause", { detail: { paused: false } }));
    }

    render();

    if (!paused && !window.matchMedia("(pointer: coarse)").matches) {
      canvas.requestPointerLock?.();
    }
  };

  const stopMenuEvent = (event: Event) => {
    event.stopPropagation();
  };

  menu?.addEventListener("pointerdown", stopMenuEvent, { signal });
  menu?.addEventListener("click", stopMenuEvent, { signal });

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const tab = button.dataset.pauseTab;
      if (tab === "settings" || tab === "controls") setActiveTab(tab);
    }, { signal });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextTab: PauseTab = event.key === "ArrowLeft" || event.key === "Home"
        ? "settings"
        : "controls";
      setActiveTab(nextTab, true);
    }, { signal });
  }

  pauseButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPaused(!paused);
  }, { signal });

  saveButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    window.localStorage.setItem("bosque:lastManualSave", new Date().toISOString());
    window.dispatchEvent(new CustomEvent("bosque:save"));
    setStatus("Guardado");
  }, { signal });

  exitButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPaused(false);
  }, { signal });

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    const overlayOpen =
      document.body.classList.contains("inventory-open") ||
      document.body.classList.contains("inspector-open");
    if (wasPointerLocked && !locked && !paused && !overlayOpen) {
      ignoreEscapeUntil = performance.now() + 250;
      setPaused(true);
    }
    wasPointerLocked = locked;
  }, { signal });

  setActiveTab("settings");
  render();

  return {
    isPaused: () => paused,
    setPaused,
    toggle: () => {
      if (paused && performance.now() < ignoreEscapeUntil) return;
      setPaused(!paused);
    },
    dispose: () => {
      abortController.abort();
      if (statusTimer !== null) window.clearTimeout(statusTimer);
    },
  };
}
