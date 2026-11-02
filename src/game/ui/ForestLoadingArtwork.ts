import { asset } from "../../utils/asset";

const DESIGN_WIDTH = 1672;
const DESIGN_HEIGHT = 941;
const FILL_WIDTH = 540;
const ARTWORK_PATH = "assets/ui/loading/forest/";

export function setupForestLoadingArtwork(screen: HTMLElement) {
  const design = screen.querySelector<HTMLElement>(".forest-loading-design");
  const fillClip = screen.querySelector<HTMLElement>("#forestLoadingFillClip");
  const images = screen.querySelectorAll<HTMLImageElement>("[data-forest-loading-asset]");
  let assetsLoaded = false;

  const resize = () => {
    if (!design || !screen.classList.contains("forest-loading")) return;
    const scale = Math.min(
      window.innerWidth / DESIGN_WIDTH,
      window.innerHeight / DESIGN_HEIGHT
    );
    design.style.setProperty("--forest-loading-scale", String(scale));
  };
  window.addEventListener("resize", resize);

  return {
    setActive(active: boolean) {
      if (active && !assetsLoaded) {
        for (const image of images) {
          image.src = asset(`${ARTWORK_PATH}${image.dataset.forestLoadingAsset}`);
        }
        assetsLoaded = true;
      }
      screen.classList.toggle("forest-loading", active);
      if (active) resize();
    },
    setProgress(value: number) {
      if (!fillClip) return;
      const progress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      fillClip.style.width = `${FILL_WIDTH * progress}px`;
    },
    dispose() {
      window.removeEventListener("resize", resize);
    },
  };
}
