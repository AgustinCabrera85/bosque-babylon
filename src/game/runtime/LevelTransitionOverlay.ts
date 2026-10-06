export type LevelTransitionOverlayHandle = {
  readonly isActive: boolean;
  cover(): Promise<void>;
  reveal(): Promise<void>;
  dispose(): void;
};

const COVER_DURATION_MS = 90;
const REVEAL_DURATION_MS = 2200;

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function waitForOpacityTransition(element: HTMLElement, fallbackMs: number) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      element.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(timeout);
      resolve();
    };
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === "opacity") finish();
    };
    const timeout = window.setTimeout(finish, fallbackMs + 180);
    element.addEventListener("transitionend", onTransitionEnd);
  });
}

/** Full-screen white bridge that can safely cover asynchronous level loading. */
export function setupLevelTransitionOverlay(): LevelTransitionOverlayHandle {
  const overlay = document.createElement("div");
  overlay.id = "levelTransitionOverlay";
  overlay.className = "level-transition-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <!-- Future narrative beat: level-transition text and audio belong here. -->
    <div class="level-transition-content" aria-hidden="true"></div>
  `;
  document.body.appendChild(overlay);

  let active = false;
  let disposed = false;

  const setDocumentBusy = (busy: boolean) => {
    document.body.classList.toggle("level-transition-active", busy);
    if (busy) document.body.setAttribute("aria-busy", "true");
    else document.body.removeAttribute("aria-busy");
  };

  return {
    get isActive() {
      return active && !disposed;
    },

    async cover() {
      if (disposed || active) return;
      active = true;
      setDocumentBusy(true);
      overlay.setAttribute("aria-hidden", "false");
      overlay.classList.remove("covered", "revealing");
      overlay.classList.add("active");
      await nextFrame();
      if (disposed) return;
      overlay.classList.add("covered");
      await waitForOpacityTransition(overlay, COVER_DURATION_MS);
    },

    async reveal() {
      if (disposed || !active) return;
      overlay.classList.add("revealing");
      overlay.classList.remove("covered");
      await waitForOpacityTransition(overlay, REVEAL_DURATION_MS);
      if (disposed) return;
      overlay.classList.remove("active", "revealing");
      overlay.setAttribute("aria-hidden", "true");
      active = false;
      setDocumentBusy(false);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      setDocumentBusy(false);
      overlay.remove();
    },
  };
}
