import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createScene, desktopQuality, mobileQuality } from "./game/createScene";

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

async function start() {
  setLoading(0.02, `Iniciando motor (${quality.name})...`);
  const scene = await createScene(engine, renderCanvas, setLoading, quality);

  scene.onAfterRenderObservable.addOnce(hideLoading);
  engine.runRenderLoop(() => {
    scene.render();
  });
}

start().catch((error) => {
  console.error("No se pudo iniciar la escena", error);
  setLoading(1, "No se pudo iniciar la escena");
});

window.addEventListener("resize", () => engine.resize());
