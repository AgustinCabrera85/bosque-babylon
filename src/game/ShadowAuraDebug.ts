import type { ShadowAuraController } from "./ShadowAura";

export type ShadowAuraDebugHandle = {
  dispose: () => void;
};

/** A small removable debug panel: F8 toggles it, or use ?shadowAuraDebug=1. */
export function createShadowAuraDebugControls(aura: ShadowAuraController): ShadowAuraDebugHandle {
  const panel = document.createElement("aside");
  panel.id = "shadowAuraDebug";
  panel.className = "hidden";
  panel.setAttribute("aria-label", "Depuracion de sombras del personaje");
  panel.innerHTML = `
    <div class="shadow-aura-debug-title">Sombras <kbd>F8</kbd></div>
    <label>
      <span>Vida <output>100%</output></span>
      <input data-shadow-aura="health" type="range" min="0" max="100" value="100" />
    </label>
    <label>
      <span>Cordura <output>100%</output></span>
      <input data-shadow-aura="sanity" type="range" min="0" max="100" value="100" />
    </label>
    <label class="shadow-aura-debug-toggle">
      <input data-shadow-aura="enabled" type="checkbox" checked />
      <span>Activar efecto</span>
    </label>
    <label class="shadow-aura-debug-toggle">
      <input data-shadow-aura="surfaceOnly" type="checkbox" />
      <span>Solo corrupcion superficial</span>
    </label>
    <dl class="shadow-aura-debug-metrics" aria-label="Metricas NPE">
      <div><dt>NPE</dt><dd data-shadow-metric="ready">cargando</dd></div>
      <div><dt>Superficie</dt><dd data-shadow-metric="surface">0 materiales</dd></div>
      <div><dt>Cobertura / caos</dt><dd data-shadow-metric="state">0.00 / 0.00</dd></div>
      <div><dt>Emision</dt><dd data-shadow-metric="emit">0.0/s</dd></div>
      <div><dt>Vivas</dt><dd data-shadow-metric="alive">0 + 0</dd></div>
      <div><dt>LOD</dt><dd data-shadow-metric="lod">near</dd></div>
      <div><dt>Rendimiento</dt><dd data-shadow-metric="performance">0 FPS / 0.0 ms</dd></div>
    </dl>
  `;
  document.getElementById("hud")?.append(panel);

  const healthInput = panel.querySelector<HTMLInputElement>('[data-shadow-aura="health"]');
  const sanityInput = panel.querySelector<HTMLInputElement>('[data-shadow-aura="sanity"]');
  const enabledInput = panel.querySelector<HTMLInputElement>('[data-shadow-aura="enabled"]');
  const surfaceOnlyInput = panel.querySelector<HTMLInputElement>('[data-shadow-aura="surfaceOnly"]');
  const healthOutput = healthInput?.previousElementSibling?.querySelector("output") ?? null;
  const sanityOutput = sanityInput?.previousElementSibling?.querySelector("output") ?? null;
  const readyOutput = panel.querySelector<HTMLElement>('[data-shadow-metric="ready"]');
  const surfaceOutput = panel.querySelector<HTMLElement>('[data-shadow-metric="surface"]');
  const stateOutput = panel.querySelector<HTMLElement>('[data-shadow-metric="state"]');
  const emitOutput = panel.querySelector<HTMLElement>('[data-shadow-metric="emit"]');
  const aliveOutput = panel.querySelector<HTMLElement>('[data-shadow-metric="alive"]');
  const lodOutput = panel.querySelector<HTMLElement>('[data-shadow-metric="lod"]');
  const performanceOutput = panel.querySelector<HTMLElement>('[data-shadow-metric="performance"]');

  const updateHealth = () => {
    if (!healthInput) return;
    aura.setHealth(Number(healthInput.value) / 100);
    if (healthOutput) healthOutput.textContent = `${healthInput.value}%`;
  };
  const updateSanity = () => {
    if (!sanityInput) return;
    aura.setSanity(Number(sanityInput.value) / 100);
    if (sanityOutput) sanityOutput.textContent = `${sanityInput.value}%`;
  };
  const updateEnabled = () => aura.setEnabled(enabledInput?.checked ?? true);
  const updateSurfaceOnly = () => aura.setSurfaceOnly(surfaceOnlyInput?.checked ?? false);
  const togglePanel = (event: KeyboardEvent) => {
    if (event.code !== "F8" || event.repeat) return;
    event.preventDefault();
    panel.classList.toggle("hidden");
  };

  const query = new URLSearchParams(window.location.search);
  const applyPercentParameter = (name: string, input: HTMLInputElement | null) => {
    const rawValue = query.get(name);
    if (rawValue === null) return;
    const value = Number(rawValue);
    if (!input || !Number.isFinite(value)) return;
    input.value = String(Math.round(Math.min(100, Math.max(0, value))));
  };
  applyPercentParameter("shadowHealth", healthInput);
  applyPercentParameter("shadowSanity", sanityInput);
  updateHealth();
  updateSanity();
  updateEnabled();
  updateSurfaceOnly();

  healthInput?.addEventListener("input", updateHealth);
  sanityInput?.addEventListener("input", updateSanity);
  enabledInput?.addEventListener("change", updateEnabled);
  surfaceOnlyInput?.addEventListener("change", updateSurfaceOnly);
  window.addEventListener("keydown", togglePanel);
  if (query.has("shadowAuraDebug")) {
    panel.classList.remove("hidden");
  }
  const metricsTimer = window.setInterval(() => {
    if (panel.classList.contains("hidden")) return;
    const metrics = aura.getDebugMetrics();
    if (!metrics) return;
    if (readyOutput) {
      readyOutput.textContent = metrics.ready
        ? `${metrics.systemCount} sistemas / ${metrics.activeSystems} activos`
        : "cargando";
    }
    if (stateOutput) stateOutput.textContent = `${metrics.coverage.toFixed(2)} / ${metrics.chaos.toFixed(2)}`;
    if (surfaceOutput) {
      surfaceOutput.textContent = `${metrics.surfaceMaterialCount} materiales${metrics.surfaceOnly ? " / aislada" : ""}`;
    }
    if (emitOutput) emitOutput.textContent = `${metrics.emitRate.toFixed(1)}/s`;
    if (aliveOutput) aliveOutput.textContent = `${metrics.aliveFlames} + ${metrics.aliveFragments}`;
    if (lodOutput) lodOutput.textContent = metrics.lod;
    if (performanceOutput) {
      performanceOutput.textContent = `${metrics.fps.toFixed(0)} FPS / ${metrics.frameTimeMs.toFixed(1)} ms`;
    }
  }, 250);

  return {
    dispose: () => {
      healthInput?.removeEventListener("input", updateHealth);
      sanityInput?.removeEventListener("input", updateSanity);
      enabledInput?.removeEventListener("change", updateEnabled);
      surfaceOnlyInput?.removeEventListener("change", updateSurfaceOnly);
      window.removeEventListener("keydown", togglePanel);
      window.clearInterval(metricsTimer);
      panel.remove();
    },
  };
}
