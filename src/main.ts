import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createScene } from "./game/createScene";

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
  loadingScreen?.classList.add("hidden");
}

const engine = new Engine(renderCanvas, true, {
  preserveDrawingBuffer: false,
  stencil: false,
  antialias: true,
});

async function start() {
  setLoading(0.02, "Iniciando motor...");
  const scene = await createScene(engine, renderCanvas, setLoading);

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
