import { asset } from "../../utils/asset";

const DESIGN_WIDTH = 1672;
const DESIGN_HEIGHT = 941;
const FILL_WIDTH = 546;
const ARTWORK_PATH = "assets/ui/loading/rina/";

export function setupRinaLoadingArtwork(screen: HTMLElement) {
  const design = screen.querySelector<HTMLElement>(".rina-loading-design");
  const fillClip = screen.querySelector<HTMLElement>("#rinaLoadingFillClip");
  const images = screen.querySelectorAll<HTMLImageElement>("[data-rina-loading-asset]");
  let assetsLoaded = false;

  const resize = () => {
    if (!design || !screen.classList.contains("rina-loading")) return;
    const widthScale = window.innerWidth / DESIGN_WIDTH;
    const heightScale = window.innerHeight / DESIGN_HEIGHT;
    const scale = window.innerWidth / window.innerHeight < 4 / 3
      ? Math.min(widthScale, heightScale)
      : Math.max(widthScale, heightScale);
    design.style.setProperty("--rina-loading-scale", String(scale));
  };
  window.addEventListener("resize", resize);

  return {
    setActive(active: boolean) {
      if (active && !assetsLoaded) {
        for (const image of images) {
          image.src = asset(`${ARTWORK_PATH}${image.dataset.rinaLoadingAsset}`);
        }
        assetsLoaded = true;
      }
      screen.classList.toggle("rina-loading", active);
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
