import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5173/";
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

async function firstAvailable(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next browser location.
    }
  }
  throw new Error("Chrome/Edge not found. Set CHROME_PATH to run this check.");
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForTarget(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
        (response) => response.json()
      );
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Browser is still starting.
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
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
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
        this.errors.push(
          message.params.args
            .map((argument) => argument.value ?? argument.description)
            .join(" ")
        );
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

const readCursorState = (client) =>
  client.evaluate(`(() => {
    const root = document.documentElement;
    return {
      type: root.dataset.bosqueCursorType ?? null,
      hidden: root.hasAttribute('data-bosque-cursor-hidden'),
      managed: root.dataset.bosqueCursorManaged === 'true',
      css: root.style.getPropertyValue('--bosque-cursor'),
      pointerLock: document.pointerLockElement?.id ?? null,
      pauseVisible: !document.getElementById('pauseMenu')?.classList.contains('hidden'),
    };
  })()`);

const chromePath = await firstAvailable(chromeCandidates);
const profileRoot = await mkdtemp(join(tmpdir(), "bosque-cursor-check-"));
const port = 9341;
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(profileRoot, "chrome-data")}`,
    "--window-size=1280,800",
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
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const buttons = Array.from({ length: 18 }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      }));
      const gamepad = {
        id: 'Cursor verification gamepad',
        index: 0,
        connected: true,
        mapping: 'standard',
        timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons,
        vibrationActuator: null,
      };
      globalThis.__cursorVerificationGamepad = gamepad;
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => [gamepad],
      });
    })();`,
  });
  await client.send("Page.navigate", { url: baseUrl });
  await waitForExpression(
    client,
    "document.documentElement.dataset.bosqueCursorType === 'menu' && document.documentElement.style.getPropertyValue('--bosque-cursor').includes('blob:')",
    30_000,
    "the preloaded menu cursor"
  );

  const menu = await readCursorState(client);
  assert.equal(menu.managed, true);
  assert.equal(menu.type, "menu");
  assert.equal(menu.hidden, false);
  assert.match(menu.css, /blob:/);
  assert.match(menu.css, /20 10, pointer$/);

  await client.evaluate(`(() => {
    const button = globalThis.__cursorVerificationGamepad.buttons[0];
    button.pressed = true;
    button.value = 1;
    globalThis.__cursorVerificationGamepad.timestamp += 1;
    return true;
  })()`);
  await waitForExpression(
    client,
    "document.documentElement.hasAttribute('data-bosque-cursor-hidden')",
    5_000,
    "the gamepad cursor suppression"
  );
  const gamepad = await readCursorState(client);
  assert.equal(gamepad.type, "menu");
  assert.equal(gamepad.hidden, true);

  await client.evaluate(`(() => {
    const button = globalThis.__cursorVerificationGamepad.buttons[0];
    button.pressed = false;
    button.value = 0;
    globalThis.__cursorVerificationGamepad.timestamp += 1;
    const event = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperties(event, {
      movementX: { value: 12 },
      movementY: { value: 4 },
    });
    window.dispatchEvent(event);
    return true;
  })()`);
  await waitForExpression(
    client,
    "!document.documentElement.hasAttribute('data-bosque-cursor-hidden')",
    5_000,
    "the mouse cursor restoration"
  );
  const mouse = await readCursorState(client);
  assert.equal(mouse.type, "menu");
  assert.equal(mouse.hidden, false);

  await client.evaluate(`(() => {
    const canvas = document.getElementById('renderCanvas');
    const requestPointerLock = canvas.requestPointerLock;
    canvas.requestPointerLock = () => Promise.resolve();
    document.getElementById('startCharacterButton').click();
    canvas.requestPointerLock = requestPointerLock;
    return true;
  })()`);
  await waitForExpression(
    client,
    "document.getElementById('characterSelection')?.classList.contains('hidden') === true",
    10_000,
    "the character selection to close"
  );
  await waitForExpression(
    client,
    "document.getElementById('loadingScreen')?.classList.contains('hidden') === true && !document.body.classList.contains('opening-sequence-active')",
    120_000,
    "gameplay to become active"
  );
  await waitForExpression(
    client,
    "document.documentElement.dataset.bosqueCursorType === 'default'",
    5_000,
    "the gameplay cursor"
  );
  const gameplay = await readCursorState(client);
  assert.equal(gameplay.type, "default");
  assert.equal(gameplay.hidden, false);
  assert.match(gameplay.css, /32 32, default$/);

  const canvasCenter = await client.evaluate(`(() => {
    const rect = document.getElementById('renderCanvas').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: canvasCenter.x,
    y: canvasCenter.y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: canvasCenter.x,
    y: canvasCenter.y,
    button: "left",
    clickCount: 1,
  });
  let pointerLockMode = "native";
  try {
    await waitForExpression(
      client,
      "document.pointerLockElement?.id === 'renderCanvas' && document.documentElement.hasAttribute('data-bosque-cursor-hidden')",
      1_500,
      "native pointer lock cursor suppression"
    );
  } catch {
    pointerLockMode = "simulated-event";
    await client.evaluate(`(() => {
      let forcedPointerLockElement = null;
      Object.defineProperty(document, 'pointerLockElement', {
        configurable: true,
        get: () => forcedPointerLockElement,
      });
      globalThis.__setCursorVerificationPointerLock = (element) => {
        forcedPointerLockElement = element;
        document.dispatchEvent(new Event('pointerlockchange'));
      };
      globalThis.__setCursorVerificationPointerLock(
        document.getElementById('renderCanvas')
      );
      return true;
    })()`);
    await waitForExpression(
      client,
      "document.pointerLockElement?.id === 'renderCanvas' && document.documentElement.hasAttribute('data-bosque-cursor-hidden')",
      2_000,
      "simulated pointer lock cursor suppression"
    );
  }
  const pointerLocked = await readCursorState(client);
  assert.equal(pointerLocked.pointerLock, "renderCanvas");
  assert.equal(pointerLocked.hidden, true);

  if (pointerLockMode === "native") {
    await client.evaluate("document.exitPointerLock(); true");
  } else {
    await client.evaluate("globalThis.__setCursorVerificationPointerLock(null); true");
  }
  await waitForExpression(
    client,
    "!document.getElementById('pauseMenu')?.classList.contains('hidden') && document.documentElement.dataset.bosqueCursorType === 'menu' && !document.documentElement.hasAttribute('data-bosque-cursor-hidden')",
    5_000,
    "the pause menu cursor after leaving pointer lock"
  );
  const pause = await readCursorState(client);
  assert.equal(pause.type, "menu");
  assert.equal(pause.hidden, false);
  assert.equal(pause.pauseVisible, true);
  assert.equal(await client.evaluate("document.querySelectorAll('#pauseMenu').length"), 1);

  const cursorErrors = client.errors.filter((error) => /cursor/i.test(error));
  assert.deepEqual(cursorErrors, []);
  console.log(JSON.stringify({
    menu,
    gamepad,
    mouse,
    gameplay,
    pointerLockMode,
    pointerLocked,
    pause,
  }, null, 2));
  console.log("Cursor browser: menu, device switching, gameplay, pointer lock and pause OK");
} catch (error) {
  let pageState = null;
  try {
    pageState = await client?.evaluate(`({
      readyState: document.readyState,
      cursorType: document.documentElement.dataset.bosqueCursorType ?? null,
      cursorHidden: document.documentElement.hasAttribute('data-bosque-cursor-hidden'),
      cursorCss: document.documentElement.style.getPropertyValue('--bosque-cursor'),
      characterSelection: !!document.getElementById('characterSelection'),
      loadingText: document.getElementById('loadingText')?.textContent ?? null,
    })`);
  } catch {
    // Keep the original verification failure.
  }
  console.error(JSON.stringify({
    verificationError: error instanceof Error ? error.message : String(error),
    pageState,
    browserErrors: client?.errors ?? [],
  }, null, 2));
  throw error;
} finally {
  client?.close();
  const browserExited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill();
  await Promise.race([browserExited, delay(3_000)]);
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {
    // Crashpad can briefly retain a profile file on Windows; the OS temp
    // directory can safely reclaim it later without masking verification.
  });
}
