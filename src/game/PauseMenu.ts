type PauseMenuOptions = {
  canvas: HTMLCanvasElement;
};

export type PauseMenuHandle = {
  isPaused: () => boolean;
  setPaused: (paused: boolean) => void;
};

export function setupPauseMenu({ canvas }: PauseMenuOptions): PauseMenuHandle {
  const menu = document.getElementById("pauseMenu");
  const pauseButton = document.getElementById("pauseButton") as HTMLButtonElement | null;
  const saveButton = document.getElementById("saveButton") as HTMLButtonElement | null;
  const exitButton = document.getElementById("exitButton") as HTMLButtonElement | null;
  const pauseStatus = document.getElementById("pauseStatus");

  let paused = false;
  let wasPointerLocked = document.pointerLockElement === canvas;
  let ignoreEscapeUntil = 0;
  let statusTimer: number | null = null;

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

  const render = () => {
    menu?.classList.toggle("hidden", !paused);
    menu?.setAttribute("aria-hidden", String(!paused));
    pauseButton?.classList.toggle("paused", paused);
    pauseButton?.setAttribute("aria-pressed", String(paused));
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

  menu?.addEventListener("pointerdown", stopMenuEvent);
  menu?.addEventListener("click", stopMenuEvent);

  pauseButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPaused(!paused);
  });

  saveButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    window.localStorage.setItem("bosque:lastManualSave", new Date().toISOString());
    window.dispatchEvent(new CustomEvent("bosque:save"));
    setStatus("Guardado");
  });

  exitButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPaused(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || event.repeat) return;
    event.preventDefault();
    if (paused && performance.now() < ignoreEscapeUntil) return;
    setPaused(!paused);
  });

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    if (wasPointerLocked && !locked && !paused) {
      ignoreEscapeUntil = performance.now() + 250;
      setPaused(true);
    }
    wasPointerLocked = locked;
  });

  render();

  return {
    isPaused: () => paused,
    setPaused,
  };
}
