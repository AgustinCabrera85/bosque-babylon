import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createScene } from "./game/createScene";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
if (!canvas) throw new Error("No se encontró #renderCanvas");

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: false,
  stencil: false,
  antialias: true,
});

const scene = await createScene(engine, canvas);

engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
