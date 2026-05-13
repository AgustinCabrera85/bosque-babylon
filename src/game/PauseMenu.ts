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
  const resumeButton = document.getElementById("resumeButton") as HTMLButtonElement | null;
  const backButton = document.getElementById("backButton") as HTMLButtonElement | null;

  let paused = false;

  const render = () => {
    menu?.classList.toggle("hidden", !paused);
    menu?.setAttribute("aria-hidden", String(!paused));
    pauseButton?.classList.toggle("paused", paused);
    pauseButton?.setAttribute("aria-pressed", String(paused));
  };

  const setPaused = (next: boolean) => {
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

  resumeButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPaused(false);
  });

  backButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPaused(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || event.repeat) return;
    event.preventDefault();
    setPaused(!paused);
  });

  render();

  return {
    isPaused: () => paused,
    setPaused,
  };
}
