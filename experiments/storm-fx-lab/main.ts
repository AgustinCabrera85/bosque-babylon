import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createSkyStormScene } from "../../src/vfx/storm/SkyStormScene";
import { approvedV1Demo } from "../../src/vfx/storm/LightningManager";
import type { LightningEventKind } from "../../src/vfx/storm/LightningVariantLibrary";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const button = (id: string) => element<HTMLButtonElement>(id);
const choice = (id: string) => element<HTMLSelectElement>(id);
const status = element<HTMLDivElement>("status");

async function main(): Promise<void> {
try {
  const lab = await createSkyStormScene(element<HTMLCanvasElement>("renderCanvas"));
  (window as unknown as { __stormLabDebug?: typeof lab }).__stormLabDebug = lab;
  const { manager } = lab;
  status.textContent = "Listo · LGT_01 cargado";
  const updateSources = () => {
    const selected = choice("source").value;
    choice("source").replaceChildren(...manager.clouds.activeEmitters().map(emitter => {
      const option = document.createElement("option");
      option.value = emitter.id;
      option.textContent = `${emitter.id} · ${emitter.type}`;
      return option;
    }));
    if (manager.clouds.emitter(selected)) choice("source").value = selected;
  };
  updateSources();
  const bindRange = (id: string, render: (value: number) => string, onValue: (value: number) => void) => {
    const control = input(id);
    const changed = () => {
      const value = Number(control.value);
      element<HTMLOutputElement>(`${id}Value`).value = render(value);
      onValue(value);
    };
    control.addEventListener("input", changed);
    changed();
  };
  bindRange("growth", value => `${value.toFixed(2)} s`, value => { manager.effect.timing.growDuration = value; });
  bindRange("emission", value => value.toFixed(1), value => { manager.emission = value; });
  bindRange("lightStrength", value => value.toFixed(1), value => { manager.lightStrength = value; });
  bindRange("interval", value => `${value.toFixed(1)} s`, value => { manager.interval = value; });
  bindRange("cloudCount", value => `${value}`, value => { manager.clouds.setCount(value); updateSources(); });
  bindRange("scrub", value => `${Math.round(value * 100)}%`, value => {
    manager.auto = false;
    button("auto").textContent = "Auto: no";
    manager.scrub(value);
  });
  input("seed").addEventListener("change", () => manager.reseed(Number(input("seed").value)));
  manager.reseed(Number(input("seed").value));
  input("halo").addEventListener("change", () => lab.setHalo(input("halo").checked));
  input("bloom").addEventListener("change", () => lab.setBloom(input("bloom").checked));
  input("sky").addEventListener("change", () => manager.sky.setEnabled(input("sky").checked));
  input("skyFlash").addEventListener("change", () => { manager.skyFlashEnabled = input("skyFlash").checked; });
  input("cloudFlash").addEventListener("change", () => { manager.cloudFlashEnabled = input("cloudFlash").checked; });
  input("lights").addEventListener("change", () => { manager.dynamicLightsEnabled = input("lights").checked; });
  input("reduced").addEventListener("change", () => { manager.reducedFlashes = input("reduced").checked; });
  input("movingSphere").addEventListener("change", () => lab.setMovingSphere(input("movingSphere").checked));
  button("moveAnchor").addEventListener("click", () => {
    manager.clouds.moveEmitter(choice("source").value,
      new Vector3(Number(input("anchorX").value), Number(input("anchorY").value), Number(input("anchorZ").value)));
    status.textContent = `${choice("source").value}: ancla movida`;
  });
  button("trigger").addEventListener("click", () => {
    const kind = choice("event").value as LightningEventKind;
    const target = kind === "cloud_to_structure" ? new Vector3(5.7, 5.6, 1.2) : undefined;
    manager.trigger({ kind, sourceId: choice("source").value, target });
    status.textContent = `Evento: ${choice("event").selectedOptions[0].textContent}`;
    status.classList.remove("error");
  });
  button("auto").addEventListener("click", () => {
    manager.auto = !manager.auto;
    button("auto").textContent = `Auto: ${manager.auto ? "sí" : "no"}`;
  });
  button("pause").addEventListener("click", () => {
    manager.paused = !manager.paused;
    button("pause").textContent = manager.paused ? "Reanudar" : "Pausar";
  });
  button("preset").addEventListener("click", () => {
    const values: Record<string, string> = {
      growth: String(approvedV1Demo.growthDuration), emission: String(approvedV1Demo.emission),
      lightStrength: String(approvedV1Demo.lightStrength), interval: "2.8",
      cloudCount: "3", scrub: "0", seed: "17",
    };
    for (const [id, value] of Object.entries(values)) {
      input(id).value = value;
      input(id).dispatchEvent(new Event("input"));
    }
    manager.reseed(17);
    for (const [id, checked] of Object.entries({ halo: approvedV1Demo.halo,
      bloom: approvedV1Demo.bloom, sky: true, skyFlash: true, cloudFlash: true,
      lights: approvedV1Demo.dynamicLights, reduced: false, movingSphere: false })) {
      input(id).checked = checked;
      input(id).dispatchEvent(new Event("change"));
    }
    manager.auto = approvedV1Demo.auto;
    button("auto").textContent = "Auto: sí";
    manager.paused = false;
    button("pause").textContent = "Pausar";
    choice("event").value = "cloud_to_ground";
    status.textContent = "Preset v1 aprobado restaurado";
  });
  const metricsTimer = window.setInterval(() => {
    const metrics = lab.metrics();
    element<HTMLDivElement>("metrics").textContent =
      `FPS ${metrics.fps} · draw calls ${metrics.drawCalls} · luces ${metrics.lights} · mallas ${metrics.meshes}`;
  }, 450);
  window.addEventListener("pagehide", () => {
    window.clearInterval(metricsTimer);
    lab.dispose();
    (window as unknown as { __stormLabDebug?: typeof lab }).__stormLabDebug = undefined;
  }, { once: true });
} catch (error) {
  status.textContent = `Error al iniciar: ${error instanceof Error ? error.message : String(error)}`;
  status.classList.add("error");
}
}

void main();
