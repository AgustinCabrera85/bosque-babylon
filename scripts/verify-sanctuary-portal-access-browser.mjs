import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
let browserPath;
for (const path of [process.env.CHROME_PATH, ...chrome].filter(Boolean)) {
  try { await access(path); browserPath = path; break; } catch { /* next */ }
}
assert.ok(browserPath, 'Chrome or Edge is required');
const profile = await mkdtemp(join(tmpdir(), 'bosque-sanctuary-portals-'));
const port = 9500 + Math.floor(Math.random() * 400);
const browser = spawn(browserPath, ['--headless=new', '--no-sandbox',
  '--no-first-run', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(profile, 'chrome')}`, 'about:blank'],
{ stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      target = tabs.find(tab => tab.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* launching */ }
    if (!target) await delay(100);
  }
  assert.ok(target, 'Chrome DevTools unavailable');
  socket = new WebSocket(target);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
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
    const response = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (response.result?.exceptionDetails) throw new Error(
      response.result.exceptionDetails.exception?.description ?? 'Evaluation failed');
    return response.result?.result?.value;
  };
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent',
      { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent',
      { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  await send('Page.enable');
  await send('Runtime.enable');
  const portrait = process.env.PORTAL_VIEWPORT === 'portrait';
  await send('Emulation.setDeviceMetricsOverride',
    { width: portrait ? 900 : 1500, height: portrait ? 1500 : 900,
      deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:5173/?level=sanctuary' });
  for (let attempt = 0; attempt < 240; attempt++) {
    if (await evaluate("document.getElementById('characterSelection')?.classList.contains('awaiting-initial-input')")) break;
    await delay(250);
  }
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',
    { key: 'a', code: 'KeyA', bubbles: true })); true`);
  await evaluate(`document.querySelector('.character-card[data-character="lautaro"]')?.click();
    document.getElementById('startCharacterButton')?.click(); true`);
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
  const setup = await evaluate(`(async () => {
    const debug = window.__bosqueSanctuaryDebug;
    const scene = debug.getScene();
    const root = debug.getPlayerPosition();
    window.__sanctuaryPortalScene = scene;
    window.__sanctuaryPlayerRoot = root;
    debug.teleportToStop(0);
    const portalX = -90 - 49;
    root.set(portalX + 5, 3.75, -80 + 8);
    return { root: root.asArray(), prompt: !!scene.metadata.sanctuaryPortalPrompt };
  })()`);
  assert.ok(setup.prompt, JSON.stringify(setup));
  let promptOpen = false;
  for (let attempt = 0; attempt < 80 && !promptOpen; attempt++) {
    promptOpen = await evaluate(`window.__sanctuaryPortalScene.metadata
      .sanctuaryPortalPrompt.isOpen`);
    if (!promptOpen) await delay(50);
  }
  assert.ok(promptOpen, 'The forest portal must ask for confirmation');
  const firstPrompt = await evaluate(`({ title: document.getElementById('sanctuaryPortalConfirmTitle')?.textContent,
    options: [...document.querySelectorAll('#sanctuaryPortalConfirm button')]
      .map(button => button.textContent),
    current: globalThis.__bosqueLevelDebug.current() })`);
  assert.ok(firstPrompt.title.includes('Libre de culpas') &&
    firstPrompt.options[0] === 'No' && firstPrompt.options[1] === 'Sí' &&
    firstPrompt.current === 'sanctuary', JSON.stringify(firstPrompt));
  const no = await evaluate(`(() => {
    const rect = document.querySelector('#sanctuaryPortalConfirm button')
      .getBoundingClientRect();
    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
  })()`);
  await click(...no);
  await delay(250);
  const declined = await evaluate(`({ open: window.__sanctuaryPortalScene.metadata
    .sanctuaryPortalPrompt.isOpen,
    current: globalThis.__bosqueLevelDebug.current(),
    x: window.__sanctuaryPlayerRoot.x })`);
  assert.ok(!declined.open && declined.current === 'sanctuary' &&
    Math.abs(declined.x - (-139 + 5)) < 0.1, JSON.stringify(declined));
  await evaluate("window.__sanctuaryPlayerRoot.x = -139 + 9");
  await delay(200);
  await evaluate("window.__sanctuaryPlayerRoot.x = -139 + 5");
  promptOpen = false;
  for (let attempt = 0; attempt < 80 && !promptOpen; attempt++) {
    promptOpen = await evaluate(`window.__sanctuaryPortalScene.metadata
      .sanctuaryPortalPrompt.isOpen`);
    if (!promptOpen) await delay(50);
  }
  assert.ok(promptOpen, 'Declining must allow a later entry');
  const yes = await evaluate(`(() => {
    const rect = document.querySelector('#sanctuaryPortalConfirm button.primary')
      .getBoundingClientRect();
    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
  })()`);
  await click(...yes);
  let sawBlack = false;
  let sawLoading = false;
  let sawForestLoadingImage = false;
  let sawIntro = false;
  let sawQuote = false;
  let sawRipple = false;
  let sawRippleShader = false;
  let sawFramedPortal = false;
  let capturedRipple = false;
  let capturedLoading = false;
  let rippleDiagnostic = null;
  let sawWalk = false;
  let sawApproachMotion = false;
  let forest = false;
  for (let attempt = 0; attempt < 240 && !forest; attempt++) {
    const state = await evaluate(`({
      current: globalThis.__bosqueLevelDebug?.current(),
      walk: window.__bosqueSanctuaryDebug?.isPlayerCinematic() &&
        window.__bosqueSanctuaryDebug?.getPlayerAnimationName() === 'Walk_InPlace',
      playerX: window.__sanctuaryPlayerRoot.x,
      camera: (() => {
        const camera = window.__sanctuaryPortalScene.activeCamera;
        return camera ? { x: camera.globalPosition.x,
          y: camera.globalPosition.y, fov: camera.fov } : null;
      })(),
      ripple: !window.__sanctuaryPortalScene.isDisposed &&
        window.__sanctuaryPortalScene.getMeshByName('libre-de-culpas_entryLiquidRipple')?.isVisible,
      rippleShader: (() => {
        if (window.__sanctuaryPortalScene.isDisposed) return null;
        const mesh = window.__sanctuaryPortalScene
          .getMeshByName('libre-de-culpas_entryLiquidRipple');
        const effect = mesh?.subMeshes[0]?.effect;
        return { ready: effect?.isReady() ?? false,
          error: effect?.getCompilationError() ?? null,
          hasEffect: !!effect, vertices: mesh?.getTotalVertices() };
      })(),
      black: document.getElementById('levelTransitionOverlay')?.classList.contains('black'),
      loading: !document.getElementById('loadingScreen')?.classList.contains('hidden'),
      loadingImage: getComputedStyle(document.getElementById('loadingScreen'))
        .backgroundImage.includes('select_character-bg.png'),
      loadingUncovered: (() => {
        const cover = getComputedStyle(document.getElementById('levelTransitionOverlay'));
        return cover.visibility === 'hidden' || Number(cover.opacity) < 0.02;
      })(),
      intro: document.getElementById('openingSequence')?.classList.contains('active'),
      quote: document.getElementById('openingQuote')?.classList.contains('visible')
    })`);
    sawWalk ||= state.walk;
    sawApproachMotion ||= state.playerX < -135;
    sawRipple ||= state.ripple;
    sawFramedPortal ||= state.ripple &&
      Math.abs(state.camera?.x + 112) < 0.5 &&
      Math.abs(state.camera?.y - 10.5) < 0.5 &&
      state.camera?.fov >= 0.95;
    if (state.ripple) rippleDiagnostic = state.rippleShader;
    sawRippleShader ||= state.ripple && state.rippleShader?.ready;
    if (state.ripple && !state.black && !capturedRipple && process.env.PORTAL_CAPTURE) {
      await delay(180);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(process.env.PORTAL_CAPTURE, Buffer.from(shot.result.data, 'base64'));
      capturedRipple = true;
    }
    sawBlack ||= state.black;
    sawLoading ||= sawBlack && state.loading;
    sawForestLoadingImage ||= sawBlack && state.loading && state.loadingImage;
    if (state.loading && state.loadingImage && state.loadingUncovered &&
        !capturedLoading &&
        process.env.PORTAL_LOADING_CAPTURE) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(process.env.PORTAL_LOADING_CAPTURE,
        Buffer.from(shot.result.data, 'base64'));
      capturedLoading = true;
    }
    sawIntro ||= sawLoading && state.intro;
    sawQuote ||= sawIntro && state.quote;
    forest = state.current === 'forest' && !state.loading && sawQuote;
    if (!forest) await delay(100);
  }
  assert.ok(forest, 'Accepting the portal must load the forest chapter');
  assert.ok(sawWalk && sawApproachMotion && sawRipple && sawRippleShader &&
    sawFramedPortal && sawBlack &&
    sawLoading && sawForestLoadingImage && sawIntro && sawQuote,
  JSON.stringify({ sawWalk, sawApproachMotion, sawRipple, sawRippleShader, sawFramedPortal,
    rippleDiagnostic, sawBlack, sawLoading, sawForestLoadingImage, sawIntro, sawQuote }));
  let cinematicDone = false;
  for (let attempt = 0; attempt < 180 && !cinematicDone; attempt++) {
    cinematicDone = await evaluate("document.getElementById('openingSequence')?.classList.contains('hidden')");
    if (!cinematicDone) await delay(100);
  }
  assert.ok(cinematicDone, 'The forest opening cinematic must complete');
  console.log({ firstPrompt, declined, sawWalk, sawApproachMotion,
    sawRipple, sawRippleShader, sawFramedPortal, sawBlack, sawLoading,
    sawForestLoadingImage, sawIntro, sawQuote,
    entered: 'forest' });
} finally {
  socket?.close();
  browser.kill();
  assert.ok(profile.startsWith(join(tmpdir(), 'bosque-sanctuary-portals-')));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
