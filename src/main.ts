import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createScene } from "./game/createScene";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
if (!canvas) throw new Error("No se encontró #renderCanvas");
const renderCanvas = canvas;

const engine = new Engine(renderCanvas, true, {
  preserveDrawingBuffer: false,
  stencil: false,
  antialias: true,
});

async function start() {
  const scene = await createScene(engine, renderCanvas);

  engine.runRenderLoop(() => {
    scene.render();
  });
}

start().catch((error) => {
  console.error("No se pudo iniciar la escena", error);
});

window.addEventListener("resize", () => engine.resize());
