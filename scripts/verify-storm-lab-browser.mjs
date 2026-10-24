import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browserCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
let browser;
for (const path of browserCandidates) {
  try { await access(path); browser = path; break; } catch { /* Try the next browser. */ }
}
assert.ok(browser, "Chrome or Edge is required for the Storm FX smoke test");
const profile = await mkdtemp(join(tmpdir(), "storm-fx-browser-"));
const port = 9500 + Math.floor(Math.random() * 400);
const child = spawn(browser, [
  "--headless=new", "--no-first-run", "--no-sandbox", "--enable-unsafe-swiftshader",
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(profile, "chrome")}`, "about:blank",
], { stdio: "ignore", windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let endpoint;
  for (let i = 0; i < 100 && !endpoint; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      endpoint = tabs.find(tab => tab.type === "page")?.webSocketDebuggerUrl;
    } catch { /* Browser has not started. */ }
    if (!endpoint) await delay(100);
  }
  assert.ok(endpoint, "Chrome DevTools did not start");
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(" "));
    }
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
    const response = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description ?? "Browser evaluation failed");
    }
    return response.result?.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
  });
  await send("Page.navigate", { url: "http://localhost:5173/experiments/storm-fx-lab/" });
  let ready;
  for (let i = 0; i < 120; i++) {
    ready = await evaluate("({status: document.getElementById('status')?.textContent, lab: !!window.__stormLabDebug})");
    if (ready?.lab || ready?.status?.startsWith("Error")) break;
    await delay(250);
  }
  assert.ok(ready?.lab, `Storm lab failed to initialize: ${ready?.status}; ${errors.join(" | ")}`);
  const baseline = await evaluate("({meshes: window.__stormLabDebug.scene.meshes.length, lights: window.__stormLabDebug.scene.lights.length})");
  assert.equal(baseline.lights, 3, "Expected one dim ambient and exactly two pooled PointLights");
  const alignment = await evaluate(`(() => {
    const lab = window.__stormLabDebug;
    document.getElementById('event').value = 'cloud_to_structure';
    document.getElementById('trigger').click();
    const root = lab.manager.effect.headWorld(0);
    const tip = lab.manager.effect.headWorld(1);
    const anchor = lab.manager.clouds.activeEmitters()[0].anchorWorld();
    return { rootError: root.subtract(anchor).length(),
      tipError: Math.hypot(tip.x - 5.7, tip.y - 5.6, tip.z - 1.2),
      tip: tip.asArray() };
  })()`);
  assert.ok(Number.isFinite(alignment.rootError) && Number.isFinite(alignment.tipError) &&
    alignment.rootError < 0.02 && alignment.tipError < 0.02,
    `Lightning UV path does not meet its world anchors: ${JSON.stringify(alignment)}`);
  await evaluate("document.getElementById('event').value = 'cloud_to_ground'; true");
  for (let strike = 0; strike < 20; strike++) {
    await evaluate("document.getElementById('trigger').click(); true");
    if (strike === 0 && process.env.STORM_SCREENSHOT) {
      await delay(180);
      const capture = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(process.env.STORM_SCREENSHOT, Buffer.from(capture.result.data, "base64"));
    }
    await delay(75);
  }
  await delay(900);
  const after = await evaluate("({meshes: window.__stormLabDebug.scene.meshes.length, lights: window.__stormLabDebug.scene.lights.length, fps: window.__stormLabDebug.metrics().fps, drawCalls: window.__stormLabDebug.metrics().drawCalls, status: document.getElementById('status').textContent})");
  assert.equal(after.meshes, baseline.meshes, "Strike sequence leaked meshes");
  assert.equal(after.lights, baseline.lights, "Strike sequence leaked lights");
  assert.ok(after.fps > 0, "The scene did not render");
  assert.ok(after.drawCalls > 0, "The scene did not issue draw calls");
  assert.deepEqual(errors, [], `Browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ baseline, alignment, after, strikes: 20, errors }, null, 2));
} finally {
  socket?.close();
  child.kill();
  await delay(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
}
