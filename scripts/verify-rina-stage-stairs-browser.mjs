import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let executable;
for (const candidate of [process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)) {
  try { await access(candidate); executable = candidate; break; } catch { /* next */ }
}
assert.ok(executable, "Chrome or Edge is required");
const profile = await mkdtemp(join(tmpdir(), "bosque-rina-stairs-"));
const port = 9900 + Math.floor(Math.random() * 500);
const browser = spawn(executable, ["--headless=new", "--no-first-run", "--no-sandbox",
  "--enable-unsafe-swiftshader", `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(profile, "chrome")}`, "about:blank"],
{ stdio: "ignore", windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      target = tabs.find(tab => tab.type === "page")?.webSocketDebuggerUrl;
    } catch { /* browser launching */ }
    if (!target) await delay(100);
  }
  assert.ok(target, "Chrome DevTools did not start");
  socket = new WebSocket(target);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (!message.id) return;
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const reply = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (reply.result?.exceptionDetails) throw new Error(
      reply.result.exceptionDetails.exception?.description ?? "Browser evaluation failed");
    return reply.result?.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await send("Page.navigate", { url: "http://localhost:5173/?level=rina" });
  let menuReady = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    menuReady = await evaluate("document.documentElement.dataset.bosqueCursorType === 'menu' && document.documentElement.style.getPropertyValue('--bosque-cursor').includes('blob:')");
    if (menuReady) break;
    await delay(250);
  }
  assert.ok(menuReady, "Character menu did not load");
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    document.querySelector('.character-card[data-character="lautaro"]')?.click();
    document.getElementById('startCharacterButton')?.click(); true`);
  let state;
  for (let attempt = 0; attempt < 240; attempt++) {
    state = await evaluate(`({ current: globalThis.__bosqueLevelDebug?.current(),
      hidden: document.getElementById('loadingScreen')?.classList.contains('hidden'),
      loading: document.getElementById('loadingText')?.textContent })`);
    if (state?.current === "rina" && state.hidden) break;
    if (state?.loading?.startsWith("No se pudo iniciar")) break;
    await delay(500);
  }
  assert.ok(state?.current === "rina" && state.hidden,
    `Rina did not load: ${JSON.stringify(state)} ${errors.join(" | ")}`);
  const result = await evaluate(`(async () => {
    const storeUrl = performance.getEntriesByType('resource')
      .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scene = EngineStore.LastCreatedScene;
    const world = scene.metadata.playerWorld;
    const glow = scene.effectLayers.find(layer => layer.name === 'rinaConcertGlow');
    const rinaRoot = scene.getTransformNodeByName('enemy:rina-stage:root');
    const rinaBody = rinaRoot?.getChildMeshes(false)
      .find(mesh => mesh.material?.name?.includes('RINA_Ropa'));
    const performers = [scene.getMeshByName('rinaGuitaristBody'),
      scene.getMeshByName('rinaDrummerBody'),
      rinaBody]
      .map(mesh => ({ name: mesh?.name,
        opaque: mesh?.material?.transparencyMode === 0 ||
          mesh?.material?.subMaterials?.some(material => material?.transparencyMode === 0),
        glowOccluder: mesh ? glow?.hasMesh(mesh) : false,
        emissiveStrength: mesh?.material?.emissiveColor?.asArray()
          .reduce((sum, channel) => sum + channel, 0) ?? 0 }));
    const scale = 1.5;
    const front = 32.5;
    const first = front - 8 * 0.8;
    const stairs = [];
    for (const side of [-1, 1]) {
      let feet = 0;
      const blocked = [];
      for (let z = first - 0.6; z <= front + 0.6; z += 0.08) {
        const x = side * 9 * scale;
        if (world.isColliding(x, z * scale, 0, feet, feet + 2)) blocked.push(z);
        feet = world.getWalkableSurfaceHeight(x, z * scale);
      }
      stairs.push({ side, blocked, finalFeet: feet });
    }
    return { stairs, performers,
      barrierCount: world.barrierSpans.length,
      mergedStageMeshes: scene.meshes.filter(mesh => mesh.name.startsWith('rinaV2Merged_')).length,
      crowdPresent: Boolean(world.fieldCrowdMaze) };
  })()`);
  assert.ok(result.barrierCount > 0 && result.crowdPresent);
  assert.ok(result.mergedStageMeshes > 0);
  for (const stair of result.stairs) {
    assert.deepEqual(stair.blocked, [], `Stage stair ${stair.side} blocked by real scenery`);
    assert.ok(Math.abs(stair.finalFeet - 3.75) < 0.001);
  }
  for (const performer of result.performers) {
    assert.ok(performer.name && performer.opaque && performer.glowOccluder &&
      performer.emissiveStrength < 0.01,
      `Performer must occlude neon: ${JSON.stringify(performer)}`);
  }
  assert.deepEqual(errors.filter(error => !error.includes('rgbdTextureTools.js')), []);
  await evaluate(`(async () => {
    const storeUrl = performance.getEntriesByType('resource')
      .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scene = EngineStore.LastCreatedScene;
    const playerRoot = scene.getTransformNodeByName('playerRoot');
    playerRoot.position.set(-2.5, 5.45, 33);
    playerRoot.rotation.y = Math.PI;
    const singerRoot = scene.getTransformNodeByName('enemy:rina-stage:root');
    scene.onBeforeRenderObservable.add(() => {
      singerRoot.position.set(0, 3.75, 28.5);
      singerRoot.rotation.y = Math.PI;
    });
    return true;
  })()`);
  await delay(600);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (screenshot.result?.data)
    await writeFile('dist/rina-stage-neon-occlusion.png', Buffer.from(screenshot.result.data, 'base64'));
  console.log("Rina stage stairs pass through the real fence and crowd on both sides:", result);
} finally {
  socket?.close();
  browser.kill();
  assert.ok(profile.startsWith(join(tmpdir(), "bosque-rina-stairs-")));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
