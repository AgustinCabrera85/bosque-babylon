import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mobile = process.argv[2] === "mobile";
const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
let browserPath;
for (const candidate of candidates) {
  try { await access(candidate); browserPath = candidate; break; } catch { /* Try next. */ }
}
assert.ok(browserPath, "Chrome or Edge is required");
const profile = await mkdtemp(join(tmpdir(), "rina-storm-sky-"));
const port = 9700 + Math.floor(Math.random() * 300);
const chrome = spawn(browserPath, [
  "--headless=new", "--no-first-run", "--no-sandbox", "--enable-unsafe-swiftshader",
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(profile, "chrome")}`, "about:blank",
], { stdio: "ignore", windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      target = tabs.find(tab => tab.type === "page")?.webSocketDebuggerUrl;
    } catch { /* Browser starting. */ }
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
  const evaluate = async (expression, awaitPromise = false) => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (reply.result?.exceptionDetails) {
      throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text);
    }
    return reply.result?.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", mobile
    ? { width: 650, height: 800, deviceScaleFactor: 1, mobile: true }
    : { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://localhost:5173/?level=rina" });
  for (let i = 0; i < 240; i++) {
    const ready = await evaluate("document.documentElement.dataset.bosqueCursorType === 'menu' && document.documentElement.style.getPropertyValue('--bosque-cursor').includes('blob:')");
    if (ready) break;
    if (i === 239) throw new Error(`Character menu did not load: ${errors.join(" | ")}`);
    await delay(250);
  }
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true })); document.querySelector('.character-card[data-character=\"lautaro\"]')?.click(); document.getElementById('startCharacterButton')?.click(); true");
  for (let i = 0; i < 240; i++) {
    const level = await evaluate("window.__bosqueLevelDebug?.current()");
    if (level === "rina") break;
    if (i === 239) throw new Error(`Rina did not load: ${errors.join(" | ")}`);
    await delay(250);
  }
  const skyState = `async () => {
    const resource = performance.getEntriesByType('resource')
      .find(item => item.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(resource ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scenes = EngineStore.Instances.flatMap(engine => engine.scenes);
    const scene = scenes.find(item => item.metadata?.rinaLevel);
    const domes = scene?.meshes.filter(mesh => mesh.name === 'rinaStormSkyboxDome') ?? [];
    const dome = domes[0];
    const panorama = dome?.material?.getActiveTextures().find(texture =>
      texture.name.includes('rina_storm_sky_'));
    const camera = scene?.activeCamera;
    return { scenes: scenes.length, domes: domes.length,
      parent: dome?.parent?.name ?? null, materialReady: dome?.material?.isReady(dome),
      textureReady: panorama?.isReady(), texture: panorama?.name,
      offset: dome && camera ? dome.position.subtract(camera.globalPosition).length() : null,
      maxZ: camera?.maxZ, lights: scene?.lights.length,
      screenIncludesSky: scene?.customRenderTargets.some(target => target.renderList?.includes(dome)),
    };
  }`;
  const state = () => evaluate(`(${skyState})()`, true);
  let first;
  for (let i = 0; i < 100; i++) {
    first = await state();
    if (first?.textureReady && first?.materialReady) break;
    await delay(200);
  }
  const expectedTexture = mobile ? "rina_storm_sky_1024.webp" : "rina_storm_sky_2048.webp";
  assert.ok(first?.texture?.includes(expectedTexture), `Wrong panorama: ${JSON.stringify(first)}`);
  assert.ok(first.materialReady && first.textureReady && first.domes === 1 &&
    first.parent === null && first.maxZ >= 600 && first.offset < 0.1 &&
    !first.screenIncludesSky && first.scenes === 1, `Invalid sky state: ${JSON.stringify(first)}`);

  const lightningState = `async () => {
    const resource = performance.getEntriesByType('resource')
      .find(item => item.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(resource ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
      .find(item => item.metadata?.rinaLevel);
    const core = scene?.getMeshByName('rinaSkyLightningCore');
    const halo = scene?.getMeshByName('rinaSkyLightningHalo');
    return { core: !!core, halo: !!halo, active: core?.isEnabled() ?? false,
      coreReady: core?.material?.isReady(core) ?? false,
      haloReady: halo?.material?.isReady(halo) ?? false,
      textureCount: core?.material?.getActiveTextures().length ?? 0,
      parent: core?.parent?.name ?? null,
      group: core?.renderingGroupId ?? null,
      bounds: core ? { minX: core.getBoundingInfo().boundingBox.minimumWorld.x,
        maxX: core.getBoundingInfo().boundingBox.maximumWorld.x } : null,
    };
  }`;
  const lightning = () => evaluate(`(${lightningState})()`, true);
  let strike = await lightning();
  if (mobile) {
    assert.ok(!strike.core && !strike.halo,
      `Mobile must keep its static sky: ${JSON.stringify(strike)}`);
  } else {
    if (process.env.RINA_SKY_SCREENSHOT) {
      await evaluate(`(async () => {
        const resource = performance.getEntriesByType('resource')
          .find(item => item.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(resource ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
          .find(item => item.metadata?.rinaLevel);
        scene.onBeforeRenderObservable.add(() => {
          scene.activeCamera.rotation.x = -0.43;
          scene.activeCamera.rotation.y = 0.75;
        });
      })()`, true);
    }
    assert.ok(strike.core && strike.halo &&
      strike.textureCount === 3 && strike.parent === null && strike.group === 0,
      `Desktop lightning shader or textures are not ready: ${JSON.stringify(strike)}`);
    for (let i = 0; i < 100 && !strike.active; i++) {
      await delay(100);
      strike = await lightning();
    }
    assert.ok(strike.active, "Desktop sky never produced a lightning strike");
    await delay(130);
    strike = await lightning();
    assert.ok(strike.coreReady && strike.haloReady,
      `Lightning shader did not compile: ${JSON.stringify(strike)}; ${errors.join(" | ")}`);
    assert.ok(strike.bounds.minX > 160 || strike.bounds.maxX < -160,
      `Lightning entered the stadium footprint: ${JSON.stringify(strike.bounds)}`);
    if (process.env.RINA_SKY_SCREENSHOT) {
      const image = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(process.env.RINA_SKY_SCREENSHOT, Buffer.from(image.result.data, "base64"));
    }
  }

  const stadiumState = `async () => {
    const resource = performance.getEntriesByType('resource')
      .find(item => item.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(resource ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
      .find(item => item.metadata?.rinaLevel);
    const names = scene?.meshes.map(mesh => mesh.name) ?? [];
    const wings = scene?.meshes.filter(mesh => mesh.name.startsWith('rinaNorthStageWings')) ?? [];
    const vertices = wings.flatMap(mesh => Array.from(mesh.getVerticesData('position') ?? []));
    let minAbsX = Infinity;
    let minZ = Infinity;
    for (let i = 0; i < vertices.length; i += 3) {
      minAbsX = Math.min(minAbsX, Math.abs(vertices[i]));
      minZ = Math.min(minZ, vertices[i + 2]);
    }
    return {
      sceneCount: EngineStore.Instances.flatMap(engine => engine.scenes).length,
      meshCount: names.length,
      oldFloatingTiers: names.filter(name => name.startsWith('rinaNorthUpperStand_')).length,
      stageCornerGroups: names.filter(name => name.startsWith('rinaStageCornerV3_')).length,
      rearCornerGroups: names.filter(name => name.startsWith('rinaCornerV3_')).length,
      perimeterWalls: names.filter(name => name.startsWith('rinaPerimeter') && name.includes('Wall_')).length,
      wingGroups: wings.length, minAbsX, minZ,
      wingParents: wings.map(mesh => mesh.parent?.name ?? null),
      stageCornerBounds: scene?.meshes.filter(mesh => mesh.name.startsWith('rinaStageCornerV3_'))
        .map(mesh => ({ minZ: mesh.getBoundingInfo().boundingBox.minimumWorld.z,
          maxZ: mesh.getBoundingInfo().boundingBox.maximumWorld.z })),
    };
  }`;
  const stadium = await evaluate(`(${stadiumState})()`, true);
  assert.ok(stadium.oldFloatingTiers === 0 && stadium.stageCornerGroups === 5 &&
    stadium.rearCornerGroups === 5 && stadium.perimeterWalls === 4 && stadium.wingGroups === 4 &&
    stadium.minAbsX >= 34.4 && stadium.minZ >= 63 &&
    stadium.wingParents.every(name => name === 'rinaStadiumRoot') &&
    stadium.stageCornerBounds.every(bounds => bounds.minZ > 70) &&
    stadium.stageCornerBounds.some(bounds => bounds.maxZ > 95),
    `Stage-end stands are disconnected or obstruct the stage: ${JSON.stringify(stadium)}`);
  const standsState = `async () => {
    const resource = performance.getEntriesByType('resource')
      .find(item => item.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(resource ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
      .find(item => item.metadata?.rinaLevel);
    const batches = scene.meshes.filter(mesh => mesh.name.startsWith('rinaStandsSprite_'));
    return { batches: batches.length,
      spectators: batches.reduce((count, mesh) => count + mesh.thinInstanceCount, 0),
      ready: batches.every(mesh => mesh.material?.isReady(mesh, true)),
      materials: new Set(batches.map(mesh => mesh.material?.name)).size };
  }`;
  let stands;
  for (let i = 0; i < 100; i++) {
    stands = await evaluate(`(${standsState})()`, true);
    if (stands.ready) break;
    await delay(100);
  }
  assert.ok(stands.ready && stands.materials === 4 &&
    stands.spectators > (mobile ? 1000 : 2000),
    `Stands sprite shader or crowd batches are invalid: ${JSON.stringify(stands)}`);
  const fieldLighting = await evaluate(`(async () => {
    const resource = performance.getEntriesByType('resource')
      .find(item => item.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(resource ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
      .find(item => item.metadata?.rinaLevel);
    const values = mesh => {
      const material = mesh.material;
      return (material?.subMaterials?.length ? material.subMaterials : [material])
        .filter(entry => entry && typeof entry.directIntensity === 'number')
        .map(entry => entry.directIntensity);
    };
    const field = scene.meshes.filter(mesh =>
      mesh.name.startsWith('rinaMazeRealStatic_') ||
      mesh.name.startsWith('rinaCrowd_') && mesh.name.includes(':group_'));
    const player = scene.getTransformNodeByName('playerRoot')?.getChildMeshes(false) ?? [];
    return { fieldMeshes: field.length, fieldDirect: field.flatMap(values),
      playerDirect: player.flatMap(values), ambient: scene.lights
        .find(light => light.name === 'rinaStadiumAmbient')?.intensity ?? null };
  })()`, true);
  assert.ok(fieldLighting.fieldMeshes > 0 && fieldLighting.fieldDirect.length > 0 &&
    fieldLighting.fieldDirect.every(value => Math.abs(value - 0.5) < 0.001),
    `Field GLB lighting is too strong: ${JSON.stringify(fieldLighting)}`);
  assert.ok(fieldLighting.playerDirect.every(value => value > 0.5),
    `Player lighting changed with crowd materials: ${JSON.stringify(fieldLighting)}`);
  assert.equal(fieldLighting.ambient, 0.12, "Rina's ambient light changed for the player");
  await evaluate("window.__bosqueLevelDebug.load('sanctuary')", true);
  assert.equal(await evaluate("window.__bosqueLevelDebug.current()"), "sanctuary");
  await evaluate("window.__bosqueLevelDebug.load('rina')", true);
  let second;
  for (let i = 0; i < 100; i++) {
    second = await state();
    if (second?.textureReady && second?.materialReady) break;
    await delay(200);
  }
  assert.ok(second?.domes === 1 && second.scenes === 1 && second.parent === null &&
    second.lights === first.lights && second.offset < 0.1,
    `Sky leaked or lost its camera after level transition: ${JSON.stringify(second)}`);
  const secondStrike = await lightning();
  assert.equal(secondStrike.core, !mobile, "Sky lightning leaked or was lost after level transition");
  assert.ok(!errors.some(error => /rinaStormSkybox|Rina skybox texture/i.test(error)),
    `Sky shader or texture error: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ mode: mobile ? "mobile" : "desktop", first, strike, stadium,
    stands,
    fieldLighting, second,
    browserErrors: errors }, null, 2));
} finally {
  socket?.close();
  chrome.kill();
  await delay(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
}
