import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createScene, desktopQuality, mobileQuality } from "./game/createScene";
import { setupMusicPlayer } from "./game/MusicPlayer";
import { setupPauseMenu } from "./game/PauseMenu";
import { setupItemInspector } from "./game/ItemInspector";
import { setupInventory } from "./game/Inventory";
import { setupCharacterSelection } from "./game/CharacterSelection";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
if (!canvas) throw new Error("No se encontro #renderCanvas");
const renderCanvas = canvas;

const loadingScreen = document.getElementById("loadingScreen");
const loadingText = document.getElementById("loadingText");
const loadingBar = document.getElementById("loadingBar");

function setLoading(value: number, text: string) {
  if (loadingText) loadingText.textContent = text;
  if (loadingBar) loadingBar.style.width = `${Math.round(value * 100)}%`;
}

function hideLoading() {
  if (!loadingScreen) return;
  loadingScreen.classList.add("hidden");
  loadingScreen.setAttribute("aria-hidden", "true");
}

function showLoading() {
  if (!loadingScreen) return;
  loadingScreen.classList.remove("hidden");
  loadingScreen.setAttribute("aria-hidden", "false");
}

function shouldUseMobileQuality() {
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 760;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return coarsePointer || navigator.maxTouchPoints > 0 || smallScreen || memory <= 4;
}

const quality = shouldUseMobileQuality() ? mobileQuality : desktopQuality;
const hardwareScaling = quality.name === "mobile"
  ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4 ? 2.25 : 1.8
  : 1;

const engine = new Engine(renderCanvas, quality.name === "desktop", {
  preserveDrawingBuffer: false,
  stencil: false,
  antialias: quality.name === "desktop",
});
engine.setHardwareScalingLevel(hardwareScaling);
const musicPlayer = setupMusicPlayer();

async function start() {
  const selectedCharacter = await setupCharacterSelection();
  document.body.classList.remove("character-selecting");
  showLoading();
  const pauseMenu = setupPauseMenu({ canvas: renderCanvas });
  const itemInspector = setupItemInspector();
  const inventory = setupInventory({ inspectItem: itemInspector.inspect });

  setLoading(0.02, `Iniciando motor (${quality.name})...`);
  const scene = await createScene(
    engine,
    renderCanvas,
    setLoading,
    quality,
    selectedCharacter,
    musicPlayer
  );

  scene.onAfterRenderObservable.addOnce(hideLoading);
  engine.runRenderLoop(() => {
    if (pauseMenu.isPaused() || itemInspector.isOpen() || inventory.isOpen()) return;
    scene.render();
  });
}

start().catch((error) => {
  console.error("No se pudo iniciar la escena", error);
  setLoading(1, "No se pudo iniciar la escena");
});

window.addEventListener("resize", () => engine.resize());
