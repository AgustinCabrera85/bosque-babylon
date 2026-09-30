import {
  getNextPrimaryViewMode,
  type PlayerController,
  type ViewMode,
} from "./PlayerController";

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

export function setupPlayerViewControls(player: PlayerController) {
  const cameraButton = document.getElementById("cameraModeButton") as HTMLButtonElement | null;
  const frontButton = document.getElementById("frontCameraButton") as HTMLButtonElement | null;
  const isometricButton = document.getElementById("isometricCameraButton") as HTMLButtonElement | null;
  const reticle = document.getElementById("reticle");
  if (!cameraButton) return () => {};

  const abortController = new AbortController();
  const signal = abortController.signal;
  const setMode = (mode: ViewMode) => {
    const isFirstPerson = mode === "first";
    const isFrontView = mode === "front";
    const isIsometricView = mode === "iso";
    const aimViewport = player.getAttackAimViewportPosition();
    reticle?.style.setProperty("--reticle-x", `${aimViewport.x * 100}%`);
    reticle?.style.setProperty("--reticle-y", `${aimViewport.y * 100}%`);
    const nextMode = getNextPrimaryViewMode(mode, player.isIsometricViewAllowed);
    cameraButton.classList.toggle("active", isFirstPerson);
    cameraButton.textContent = getViewModeShortLabel(nextMode);
    cameraButton.setAttribute("aria-pressed", String(isFirstPerson));
    cameraButton.setAttribute("aria-label", `Cambiar a vista ${getViewModeName(nextMode)}`);
    frontButton?.classList.toggle("active", isFrontView);
    frontButton?.setAttribute("aria-pressed", String(isFrontView));
    frontButton?.setAttribute(
      "aria-label",
      isFrontView ? "Volver a tercera persona" : "Activar camara frontal"
    );
    isometricButton?.classList.toggle("active", isIsometricView);
    if (isometricButton) isometricButton.disabled = !player.isIsometricViewAllowed;
    isometricButton?.setAttribute("aria-pressed", String(isIsometricView));
    isometricButton?.setAttribute(
      "aria-label",
      !player.isIsometricViewAllowed
        ? "Vista isometrica no disponible"
        : isIsometricView
          ? "Volver a tercera persona"
          : "Activar vista isometrica"
    );
    reticle?.classList.toggle("hidden", isFrontView || isIsometricView);
  };

  cameraButton.addEventListener("click", (event) => {
    event.stopPropagation();
    player.toggleViewMode();
  }, { signal });
  frontButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    player.setViewMode(player.currentViewMode === "front" ? "third" : "front");
  }, { signal });
  isometricButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    player.setViewMode(player.currentViewMode === "iso" ? "third" : "iso");
  }, { signal });

  const unsubscribe = player.onViewModeChange(setMode);
  return () => {
    unsubscribe();
    abortController.abort();
  };
}
