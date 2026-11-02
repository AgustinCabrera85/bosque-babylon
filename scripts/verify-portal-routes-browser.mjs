import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run with the Vite development server on port 5173.
const candidates = [process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
let browserPath;
for (const candidate of candidates) {
  try { await access(candidate); browserPath = candidate; break; } catch { /* try next */ }
}
assert.ok(browserPath, "Chrome or Edge is required");
const profile = await mkdtemp(join(tmpdir(), "bosque-portal-routes-"));
const port = 9900 + Math.floor(Math.random() * 500);
const browser = spawn(browserPath, ["--headless=new", "--no-sandbox", "--no-first-run",
  "--enable-unsafe-swiftshader", `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(profile, "chrome")}`, "about:blank"],
{ stdio: "ignore", windowsHide: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      target = tabs.find((tab) => tab.type === "page")?.webSocketDebuggerUrl;
    } catch { /* browser starting */ }
    if (!target) await delay(100);
  }
  assert.ok(target, "Chrome DevTools unavailable");
  socket = new WebSocket(target);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(event.data);
    if (!response.id) return;
    pending.get(response.id)?.(response);
    pending.delete(response.id);
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (response.result?.exceptionDetails) throw new Error(
      response.result.exceptionDetails.exception?.description ?? "Evaluation failed");
    return response.result?.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: "http://localhost:5173/?level=sanctuary" });
  let selectionReady = false;
  for (let attempt = 0; attempt < 240 && !selectionReady; attempt++) {
    selectionReady = await evaluate("document.getElementById('characterSelection')?.classList.contains('awaiting-initial-input')");
    if (!selectionReady) await delay(250);
  }
  assert.ok(selectionReady, "Character selection did not initialize");
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',
    { key: 'a', code: 'KeyA', bubbles: true })); true`);
  await delay(200);
  await evaluate(`document.querySelector('.character-card[data-character="lautaro"]').click();
    document.getElementById('startCharacterButton').click(); true`);
  let loaded = false;
  for (let attempt = 0; attempt < 240 && !loaded; attempt++) {
    loaded = await evaluate(`globalThis.__bosqueLevelDebug?.current() === 'sanctuary' &&
      document.getElementById('loadingScreen')?.classList.contains('hidden')`);
    if (!loaded) await delay(500);
  }
  assert.ok(loaded, `Sanctuary did not load: ${JSON.stringify(await evaluate(`({
    current: globalThis.__bosqueLevelDebug?.current(),
    loading: document.getElementById('loadingText')?.textContent,
    selecting: document.body.classList.contains('character-selecting'),
    startDisabled: document.getElementById('startCharacterButton')?.disabled
  })`))}`);
  for (const [entryPoint, playerX, playerZ, boatX, boatZ] of [
    ["forest-return", -114, -90, -74, -80],
    ["rina-return", 114, 145, 74, 155],
  ]) {
    const arrival = await evaluate(`(async () => {
      await window.__bosqueLevelDebug.load('sanctuary', '${entryPoint}');
      const scene = window.__bosqueSanctuaryDebug.getScene();
      return {
        level: window.__bosqueLevelDebug.current(),
        player: scene.getTransformNodeByName('playerRoot')?.position.asArray(),
        boat: scene.getTransformNodeByName('sanctuaryBoat')?.position.asArray(),
      };
    })()`);
    assert.equal(arrival.level, "sanctuary");
    assert.ok(arrival.player && Math.abs(arrival.player[0] - playerX) < 2 &&
      Math.abs(arrival.player[2] - playerZ) < 2,
    `${entryPoint} player arrived at the wrong island: ${JSON.stringify(arrival)}`);
    assert.ok(arrival.boat && Math.abs(arrival.boat[0] - boatX) < 2 &&
      Math.abs(arrival.boat[2] - boatZ) < 2,
    `${entryPoint} raft arrived at the wrong dock: ${JSON.stringify(arrival)}`);
    console.log(`${entryPoint}: player and raft arrived at the correct island`);
  }
} finally {
  socket?.close();
  browser.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
