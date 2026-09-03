import { spawn } from "node:child_process";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5173/";
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

async function firstAvailable(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next platform-specific location.
    }
  }
  throw new Error("Chrome/Edge not found. Set CHROME_PATH before running this profiler.");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForTarget(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error("Timed out while waiting for Chrome DevTools.");
}

class DevToolsClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.errors = [];
  }

  async connect() {
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails.text);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.errors.push(message.params.args.map((argument) => argument.value ?? argument.description).join(" "));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolveCommand, reject) => {
      this.pending.set(id, { resolve: resolveCommand, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitForExpression(client, expression, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function sampleFrames(client, durationMs = 4000) {
  return client.evaluate(`new Promise((resolve) => {
    const samples = [];
    const started = performance.now();
    let previous = started;
    function frame(now) {
      samples.push(now - previous);
      previous = now;
      if (now - started >= ${durationMs}) {
        const sorted = samples.slice(1).sort((a, b) => a - b);
        const elapsed = now - started;
        const frameTimeMs = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
        const p95FrameTimeMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
        resolve({ fps: sorted.length * 1000 / elapsed, frameTimeMs, p95FrameTimeMs, frames: sorted.length });
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })`, true);
}

async function readMetrics(client) {
  return client.evaluate(`Object.fromEntries(
    Array.from(document.querySelectorAll('[data-shadow-metric]')).map((node) => [
      node.getAttribute('data-shadow-metric'),
      node.textContent.trim()
    ])
  )`);
}

async function setStats(client, health, sanity) {
  await client.evaluate(`(() => {
    for (const [name, value] of [['health', '${health}'], ['sanity', '${sanity}']]) {
      const input = document.querySelector('[data-shadow-aura=' + name + ']');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  })()`);
}

async function setSurfaceOnly(client, enabled) {
  await client.evaluate(`(() => {
    const input = document.querySelector('[data-shadow-aura=surfaceOnly]');
    input.checked = ${enabled};
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function capture(client, outputDirectory, name) {
  const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const path = join(outputDirectory, `${name}.png`);
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}

const chromePath = await firstAvailable(chromeCandidates);
const profileRoot = await mkdtemp(join(tmpdir(), "bosque-shadow-profile-"));
const browserProfile = join(profileRoot, "chrome-data");
const screenshots = join(profileRoot, "screenshots");
await import("node:fs/promises").then(({ mkdir }) => mkdir(screenshots, { recursive: true }));
const port = 9337;
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${browserProfile}`,
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true }
);

let client;
try {
  client = new DevToolsClient(await waitForTarget(port));
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const url = new URL(baseUrl);
  url.searchParams.set("shadowAuraDebug", "1");
  url.searchParams.set("shadowHealth", "100");
  url.searchParams.set("shadowSanity", "100");
  url.searchParams.set("shadowView", "iso");
  await client.send("Page.navigate", { url: url.toString() });
  await waitForExpression(client, "document.readyState === 'complete'", 20_000, "the document");
  await waitForExpression(client, "!!document.getElementById('startCharacterButton')", 20_000, "character selection");
  await client.evaluate("document.getElementById('startCharacterButton').click(); true");
  await waitForExpression(
    client,
    "document.getElementById('loadingScreen')?.classList.contains('hidden') === true",
    120_000,
    "the game scene"
  );
  await waitForExpression(
    client,
    "document.querySelector('[data-shadow-metric=ready]')?.textContent.includes('sistemas') === true",
    20_000,
    "the NPE systems"
  );
  await delay(2500);

  const idle = { frames: await sampleFrames(client), metrics: await readMetrics(client) };
  const idleScreenshot = await capture(client, screenshots, "idle-iso-100-100");

  const progression = {};
  for (const [health, sanity] of [[100, 100], [50, 100], [100, 20], [25, 25], [0, 0]]) {
    await setStats(client, health, sanity);
    await delay(2400);
    progression[`${health}/${sanity}`] = await readMetrics(client);
    if (health === 100 && sanity === 20) {
      await capture(client, screenshots, "sanity-chaos-iso-100-20");
    }
  }
  await delay(2200);
  const maximum = { frames: await sampleFrames(client), metrics: await readMetrics(client) };
  const maximumIsoScreenshot = await capture(client, screenshots, "maximum-iso-0-0");

  await setSurfaceOnly(client, true);
  await delay(1200);
  const surfaceOnlyIsoScreenshot = await capture(client, screenshots, "surface-only-iso-0-0");

  await client.evaluate("document.getElementById('isometricCameraButton').click(); true");
  await delay(1200);
  const maximumThirdScreenshot = await capture(client, screenshots, "surface-only-third-0-0");
  await client.evaluate("document.getElementById('frontCameraButton').click(); true");
  await delay(1200);
  const maximumFrontScreenshot = await capture(client, screenshots, "surface-only-front-0-0");
  await client.evaluate("document.getElementById('frontCameraButton').click(); document.getElementById('cameraModeButton').click(); true");
  await delay(1200);
  const maximumFirstScreenshot = await capture(client, screenshots, "surface-only-first-0-0");

  console.log(JSON.stringify({
    idle,
    progression,
    maximum,
    screenshots: [idleScreenshot, maximumIsoScreenshot, surfaceOnlyIsoScreenshot, maximumThirdScreenshot, maximumFrontScreenshot, maximumFirstScreenshot],
    browserErrors: client.errors,
  }, null, 2));
} finally {
  client?.close();
  chrome.kill();
}
