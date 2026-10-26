import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let executable;
for (const candidate of [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean)) {
  try { await access(candidate); executable = candidate; break; } catch { /* next */ }
}
assert.ok(executable, "Chrome or Edge is required");
const profile = await mkdtemp(join(tmpdir(), "bosque-rina-audio-"));
const port = 9900 + Math.floor(Math.random() * 500);
const browser = spawn(executable, ["--headless=new", "--no-first-run", "--no-sandbox",
  "--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${port}`,
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
    } catch { /* launching */ }
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
  socket.addEventListener("message", event => {
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
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: "http://localhost:5173/" });
  await delay(1000);
  const result = await send("Runtime.evaluate", {
    expression: `(async () => {
      const context = new AudioContext();
      const decode = context.decodeAudioData.bind(context);
      const decoded = [];
      const labels = new WeakMap();
      context.decodeAudioData = async bytes => {
        const buffer = await decode(bytes);
        let sum = 0, count = 0, peak = 0;
        const bins = Array.from({ length: 30 }, () => ({ sum: 0, count: 0 }));
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let index = 0; index < samples.length; index += 16) {
            const value = Math.abs(samples[index]);
            sum += value * value;
            peak = Math.max(peak, value);
            count++;
            const bin = bins[Math.min(29, Math.floor(index / samples.length * 30))];
            bin.sum += value * value;
            bin.count++;
          }
        }
        decoded.push({ duration: buffer.duration, channels: buffer.numberOfChannels,
          rms: Math.sqrt(sum / count), peak,
          envelope: bins.map(bin => Number(Math.sqrt(bin.sum / bin.count).toFixed(3))) });
        labels.set(buffer, buffer.duration > 2 ? 'scream'
          : Math.sqrt(sum / count) > 0.1 ? 'energetic' : 'base');
        return buffer;
      };
      const original = context.createBufferSource.bind(context);
      const starts = [];
      context.createBufferSource = () => {
        const source = original();
        const start = source.start.bind(source);
        source.start = (...args) => {
          starts.push({ at: args[0], offset: args[1] ?? 0,
            playLength: args[2] ?? source.buffer.duration,
            rate: source.playbackRate.value,
            kind: labels.get(source.buffer),
            duration: source.buffer.duration, loop: source.loop });
          start(...args);
        };
        return source;
      };
      const { loadRinaAudienceAudio } = await import('/src/game/audio/RinaAudienceAudio.ts');
      const audio = await loadRinaAudienceAudio(context, context.destination);
      await context.resume();
      audio.setVolume(0.85);
      audio.start();
      audio.update({ track: 'assets/audio/music/Rina - Si Me Miras.mp3',
        currentTime: 55, playing: true, energy: 0.7, bass: 0.8, voice: 0.5 });
      audio.triggerPyro(0.2);
      audio.update({ track: 'assets/audio/music/Rina - Si Me Miras.mp3',
        currentTime: 120.4, playing: true, energy: 0.1, bass: 0.1, voice: 0.2 });
      audio.update({ track: 'assets/audio/music/Rina - Si Me Miras.mp3',
        currentTime: 120.6, playing: true, energy: 0.1, bass: 0.1, voice: 0.2 });
      const result = { starts, decoded, state: context.state };
      audio.dispose();
      await context.close();
      const renderLayer = async music => {
        const offline = new OfflineAudioContext(2, 44100 * 8, 44100);
        const layer = await loadRinaAudienceAudio(offline, offline.destination);
        layer.setVolume(0.85);
        layer.start();
        layer.update(music);
        let suspended = offline.suspend(2);
        const rendering = offline.startRendering();
        for (const time of [2, 4, 6]) {
          await suspended;
          layer.update(music);
          suspended = time < 6 ? offline.suspend(time + 2) : null;
          await offline.resume();
        }
        const rendered = await rendering;
        layer.dispose();
        const samples = rendered.getChannelData(0);
        const windows = [];
        for (let start = Math.round(1.8 * 44100); start < 7.8 * 44100;
          start += 4410) {
          let sum = 0;
          for (let index = start; index < start + 4410; index++)
            sum += samples[index] * samples[index];
          windows.push(Math.sqrt(sum / 4410));
        }
        return windows;
      };
      result.baseWindows = await renderLayer(null);
      result.energeticWindows = await renderLayer({
        track: 'assets/audio/music/Rina - Si Me Miras.mp3',
        currentTime: 140, playing: true, energy: 0.7, bass: 0.8, voice: 0.5,
      });
      return result;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.exception?.description ?? "Browser audio error");
  }
  const audio = result.result.result.value;
  assert.equal(audio.state, "running");
  const base = audio.starts.filter(source => source.kind === "base");
  const energetic = audio.starts.filter(source => source.kind === "energetic");
  const screams = audio.starts.filter(source => source.kind === "scream");
  assert.ok(base.length >= 2 && energetic.length >= 2,
    "Both audience layers need overlapping instances");
  assert.ok([...base, ...energetic].every(source =>
    !source.loop && source.offset > 0 && source.playLength < source.duration));
  assert.ok([...base, ...energetic].every(source =>
    source.offset + source.playLength <= source.duration - 0.5),
    "Neither sustained layer may play the defective last 0.5 seconds");
  assert.ok(Math.abs(base[1].at - base[0].at -
    base[0].playLength / base[0].rate / 3) < 0.01);
  assert.ok(Math.abs(energetic[1].at - energetic[0].at -
    energetic[0].playLength / energetic[0].rate / 3) < 0.01);
  assert.ok(new Set(base.slice(0, 7).map(source => source.offset)).size >= 5);
  assert.ok(new Set(energetic.slice(0, 7).map(source => source.rate)).size >= 5);
  assert.equal(screams.length, 1, "A scream should play only on the quiet cue");
  for (const [name, windows] of Object.entries({
    base: audio.baseWindows, energetic: audio.energeticWindows,
  })) {
    const sorted = [...windows].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    assert.ok(sorted[0] > median * 0.5,
      `${name} had an audible gap in the sustained render: ${JSON.stringify(windows)}`);
  }
  console.log("Rina audience audio decoded; overlapping sustained layers and quiet scream started:",
    { base: base.length, energetic: energetic.length, scream: screams.length,
      overlapSeconds: base[1].at - base[0].at,
      grainSeconds: base[0].playLength / base[0].rate });
  console.log("Sustained RMS range over six seconds:", Object.fromEntries(
    Object.entries({ base: audio.baseWindows, energetic: audio.energeticWindows })
      .map(([name, windows]) => [name,
        { min: Math.min(...windows), max: Math.max(...windows) }])));
} finally {
  socket?.close();
  browser.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
