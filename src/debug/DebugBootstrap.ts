import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { DebugManager } from "./DebugManager";

type StandaloneDebugContext = {
  engine: Engine;
  canvas: HTMLCanvasElement;
};

type AnimationLabWindow = Window & {
  __bosqueAnimationLab?: import("./animation/ProceduralAnimationLab").ProceduralAnimationLab;
};

export async function tryStartStandaloneDebugMode(
  context: StandaloneDebugContext
) {
  if (!import.meta.env.DEV) return false;
  if (new URLSearchParams(window.location.search).get("debug") !== "animationLab") {
    return false;
  }

  showStandaloneCanvas(context.canvas);
  const { ProceduralAnimationLab } = await import(
    "./animation/ProceduralAnimationLab"
  );
  const lab = await ProceduralAnimationLab.create(context.engine, context.canvas);
  const debugWindow = window as AnimationLabWindow;
  debugWindow.__bosqueAnimationLab = lab;
  lab.scene.onDisposeObservable.addOnce(() => {
    if (debugWindow.__bosqueAnimationLab === lab) {
      delete debugWindow.__bosqueAnimationLab;
    }
  });
  context.engine.runRenderLoop(() => lab.render());
  window.addEventListener("pagehide", () => lab.dispose(), { once: true });
  return true;
}

export function bootstrapDebug(scene: Scene) {
  if (!import.meta.env.DEV) return null;
  return new DebugManager(scene, { openAnimationLab });
}

function openAnimationLab() {
  const url = new URL(window.location.href);
  url.searchParams.set("debug", "animationLab");
  const opened = window.open(url, "_blank", "noopener");
  if (!opened) window.location.assign(url);
}

function showStandaloneCanvas(canvas: HTMLCanvasElement) {
  document.body.classList.remove("character-selecting", "opening-sequence-active");
  for (const child of Array.from(document.body.children)) {
    if (child !== canvas && child.tagName !== "SCRIPT") {
      (child as HTMLElement).hidden = true;
    }
  }
  Object.assign(document.body.style, {
    margin: "0",
    overflow: "hidden",
    background: "#07100c",
  });
  Object.assign(canvas.style, {
    display: "block",
    width: "100vw",
    height: "100vh",
    touchAction: "none",
  });
}
