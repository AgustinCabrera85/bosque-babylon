import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const level = process.argv[2];
assert.ok(["forest", "theatre", "sanctuary"].includes(level),
  "Usage: node scripts/verify-level-load-browser.mjs <forest|theatre|sanctuary>");
const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
let chromePath;
for (const candidate of candidates) {
  try { await access(candidate); chromePath = candidate; break; } catch { /* Try next. */ }
}
assert.ok(chromePath, "Chrome or Edge was not found. Set CHROME_PATH.");
const profile = await mkdtemp(join(tmpdir(), "bosque-level-smoke-"));
const port = 9347 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  "--headless=new", "--no-first-run", "--no-sandbox", "--enable-unsafe-swiftshader",
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(profile, "chrome")}`,
  "about:blank",
], { stdio: "ignore", windowsHide: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      target = tabs.find((tab) => tab.type === "page")?.webSocketDebuggerUrl;
    } catch { /* Browser starting. */ }
    if (!target) await delay(100);
  }
  if (!target) throw new Error("Chrome DevTools unavailable");
  socket = new WebSocket(target);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
    }
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter(message);
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  if (process.env.PORTAL_CAPTURE && level === "sanctuary") {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
    });
  }
  await send("Page.navigate", { url: `http://localhost:5173/?level=${level}` });
  const evaluate = async (expression, awaitPromise = false) => {
    const reply = await send("Runtime.evaluate", {
      expression, awaitPromise, returnByValue: true,
    });
    if (reply.result?.exceptionDetails) {
      throw new Error(reply.result.exceptionDetails.exception?.description
        ?? reply.result.exceptionDetails.text);
    }
    return reply.result?.result?.value;
  };
  let menuReady = false;
  for (let i = 0; i < 240; i++) {
    menuReady = await evaluate(
      "document.documentElement.dataset.bosqueCursorType === 'menu' && document.documentElement.style.getPropertyValue('--bosque-cursor').includes('blob:')"
    );
    if (menuReady) break;
    await delay(250);
  }
  assert.ok(menuReady, `Character selection did not initialize: ${errors.join(" | ")}`);
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true })); document.getElementById('startCharacterButton')?.click(); true");
  let state;
  for (let i = 0; i < 240; i++) {
    state = await evaluate(`({
      loading: document.getElementById('loadingText')?.textContent,
      hidden: document.getElementById('loadingScreen')?.classList.contains('hidden'),
      current: globalThis.__bosqueLevelDebug?.current(),
    })`);
    if (state?.loading?.startsWith("No se pudo iniciar")) break;
    if (state?.current === level && state.hidden) break;
    await delay(500);
  }
  assert.equal(state?.current, level,
    `${level} did not load: ${state?.loading}; ${errors.join(" | ")}`);
  assert.equal(state.hidden, true,
    `${level} remained on the loading screen: ${state.loading}`);
  if (level === "sanctuary") {
    let portal;
    for (let i = 0; i < 120; i++) {
      portal = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.LastCreatedScene;
        const vortex = scene?.getMeshByName('libre-de-culpas_crimsonVortex');
        const backdrop = scene?.getMeshByName('libre-de-culpas_forestVistaV4');
        return {
          engines: EngineStore.Instances.length,
          storeUrl,
          sceneName: scene?.name,
          meshCount: scene?.meshes.length,
          portalMeshes: scene?.meshes.filter((mesh) => mesh.name.includes('culpas')).map((mesh) => mesh.name),
          redVisible: vortex?.isVisible,
          material: backdrop?.material?.name,
          ready: backdrop?.material?.isReady(backdrop),
          bounds: backdrop?.getBoundingInfo().boundingBox.extendSize.asArray(),
          position: backdrop?.position.asArray(),
          layers: scene?.meshes.filter((mesh) => mesh.name.startsWith('libre-de-culpas_forestAsset_'))
            .map((mesh) => ({ name: mesh.name, material: mesh.material?.name,
              ready: mesh.material?.isReady(mesh), z: mesh.position.z })),
        };
      })()`, true);
      if (portal?.material === "lrloForestVistaV4" && portal.ready &&
          portal.layers?.length === 8 && portal.layers.every((layer) => layer.ready)) break;
      await delay(250);
    }
    assert.equal(portal?.material, "lrloForestVistaV4",
      `Forest portal fell back to its original shader: ${JSON.stringify(portal)}`);
    assert.ok(portal.layers.every(({ material }) => material === "lrloForestAtlasV4_forest_atlas_00.webp"));
    assert.ok(portal.ready && portal.layers.every((layer) => layer.ready),
      `Forest portal v4 shaders were not ready: ${JSON.stringify(portal)}`);
    assert.equal(portal.redVisible, false);
    assert.ok(Math.abs(portal.bounds?.[0] - .245) < .0001 &&
      Math.abs(portal.bounds?.[1] - .42) < .0001 &&
      Math.abs(portal.position?.[0] - .025) < .0001 &&
      Math.abs(portal.position?.[1] - .4) < .0001 &&
      Math.abs(portal.position?.[2] + .01) < .0001,
      `Forest v4 changed the fitted panel dimensions: ${JSON.stringify(portal)}`);
    const treeAngle = () => evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      return EngineStore.LastCreatedScene
        .getMeshByName('libre-de-culpas_forestAsset_old_tree_left')?.rotation.z;
    })()`, true);
    const swaySamples = [await treeAngle()];
    await delay(650);
    swaySamples.push(await treeAngle());
    await delay(650);
    swaySamples.push(await treeAngle());
    assert.ok(swaySamples.every(Number.isFinite) &&
      Math.max(...swaySamples) - Math.min(...swaySamples) > .0003,
      `Forest trees did not sway: ${JSON.stringify(swaySamples)}`);
    if (process.env.PORTAL_CAPTURE) {
      const distance = Number(process.env.PORTAL_CAPTURE_DISTANCE ?? 19);
      const lateral = Number(process.env.PORTAL_CAPTURE_LATERAL ?? 0);
      const capturePose = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.LastCreatedScene;
        const hiddenLayer = ${JSON.stringify(process.env.PORTAL_CAPTURE_LAYER_OFF ?? "")};
        if (hiddenLayer === 'overlays') {
          for (const mesh of scene.meshes.filter((mesh) => mesh.name.startsWith('libre-de-culpas_forestAsset_'))) mesh.setEnabled(false);
        } else if (hiddenLayer === 'backdrop') scene.getMeshByName('libre-de-culpas_forestVistaV4')?.setEnabled(false);
        const camera = scene.activeCamera.clone('forestPortalCaptureCamera');
        camera.parent = null;
        camera.position.set(${-139 + distance}, 8, ${-72 + lateral});
        const target = camera.position.clone();
        target.set(-139, 9, -72);
        camera.setTarget(target);
        scene.activeCamera = camera;
        const m = scene.getTransformNodeByName('libre-de-culpas_levelPortal')
          .getWorldMatrix().clone().invert().m;
        const p = camera.position;
        return [p.x*m[0]+p.y*m[4]+p.z*m[8]+m[12],
          p.x*m[1]+p.y*m[5]+p.z*m[9]+m[13],
          p.x*m[2]+p.y*m[6]+p.z*m[10]+m[14]];
      })()`, true);
      console.log(`capture camera local: ${JSON.stringify(capturePose)}`);
      await delay(1500);
      const screenshot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(process.env.PORTAL_CAPTURE,
        Buffer.from(screenshot.result.data, "base64"));
    }
  }
  const constructors = await evaluate(`(async () => ({
    spot: typeof (await import('/node_modules/@babylonjs/core/Lights/spotLight.js')).SpotLight,
    particles: typeof (await import('/node_modules/@babylonjs/core/Particles/particleSystem.js')).ParticleSystem,
  }))()`, true);
  assert.equal(constructors.spot, "function");
  assert.equal(constructors.particles, "function");
  assert.ok(!errors.some((error) => /(?:SpotLight|ParticleSystem) is not a constructor/.test(error)),
    `Babylon constructor error in ${level}: ${errors.join(" | ")}`);
  console.log(`${level}: loaded; SpotLight and ParticleSystem are constructors`);
  if (errors.length) console.warn(`${level}: ${errors.length} browser error(s):\n${errors.slice(-3).join("\n")}`);
} finally {
  socket?.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
