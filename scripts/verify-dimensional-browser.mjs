import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

const candidates = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let chromePath;
for (const candidate of candidates) {
  try { await access(candidate); chromePath = candidate; break; } catch { /* Next browser. */ }
}
assert.ok(chromePath, 'Chrome or Edge required; set CHROME_PATH.');
const profile = await mkdtemp(join(tmpdir(), 'bosque-dimensional-smoke-'));
const port = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, [
  '--headless=new', '--no-first-run', '--no-sandbox', '--enable-unsafe-swiftshader',
  '--enable-webgl', `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(profile, 'chrome')}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      target = tabs.find(tab => tab.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* Browser is starting. */ }
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
  const errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown')
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
      errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
    if (!message.id) return;
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message); }
  });
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 960, height: 540, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', {
    url: process.env.DIMENSIONAL_SMOKE_URL ?? 'http://localhost:5173/dev/dimensional-smoke.html',
  });
  let result;
  for (let i = 0; i < 300 && !result?.done; i++) {
    const reply = await send('Runtime.evaluate', {
      expression: 'window.__dimensionalSmoke ?? null', returnByValue: true,
    });
    result = reply.result?.result?.value;
    if (!result?.done) await delay(250);
  }
  if (!result?.done) {
    const diagnostic = await send('Runtime.evaluate', {
      expression: '({url: location.href, state: document.readyState, body: document.body?.innerText?.slice(0, 2000)})',
      returnByValue: true,
    });
    throw new Error(`Timed out: ${JSON.stringify(diagnostic.result?.result?.value)}; ${errors.slice(-5).join(' | ')}`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) console.error('Browser errors:', errors.join('\n'));
  assert.ok(result.checks.every(check => check.ok), 'Dimensional FX smoke checks failed');
  assert.equal(errors.length, 0, 'Browser reported errors');
} finally {
  socket?.close();
  chrome.kill();
  assert.ok(resolve(profile).startsWith(resolve(tmpdir()) + sep)
    && basename(profile).startsWith('bosque-dimensional-smoke-'), 'Unsafe temporary profile path');
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
