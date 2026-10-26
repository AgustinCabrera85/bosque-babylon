import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const level = process.argv[2];
assert.ok(["forest", "theatre", "sanctuary", "rina"].includes(level),
  "Usage: node scripts/verify-level-load-browser.mjs <forest|theatre|sanctuary|rina>");
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
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "performance.setResourceTimingBufferSize(20000)",
  });
  if ((process.env.PORTAL_CAPTURE && level === "sanctuary") ||
      (level === "rina" && !process.env.RINA_MOBILE_VERIFY)) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
    });
  }
  await send("Page.navigate", { url: `http://localhost:5173/?level=${level}${
    process.env.PORTAL_QUERY ? `&${process.env.PORTAL_QUERY}` : ""}` });
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
  const character = process.argv[3] === "sofia" ? "sofia" : "lautaro";
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true })); document.querySelector('.character-card[data-character="${character}"]')?.click(); document.getElementById('startCharacterButton')?.click(); true`);
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
    if (process.env.PORTAL_APPROACH_VERIFY) {
      const collisions = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.LastCreatedScene;
        const world = scene.metadata.playerWorld;
        const stops = [
          { id: 'libre-de-culpas', x: -90, z: -80, side: -1 },
          { id: 'rina', x: 90, z: 155, side: 1 },
          { id: 'fortaleza', x: -80, z: 385, side: -1 },
          { id: 'teatro', x: 88, z: 620, side: 1 },
          { id: 'encadenado', x: -85, z: 850, side: -1 },
        ];
        return stops.map((stop, index) => {
          window.__bosqueSanctuaryDebug.teleportToStop(index);
          const px = stop.x + stop.side * 49;
          const pz = stop.z + 8;
          const front = px - stop.side * 2.7;
          const boxes = scene.meshes.filter((mesh) =>
            mesh.name.startsWith(stop.id + '_stoneCollider_'));
          return { id: stop.id, blocks: boxes.length,
            proxies: boxes.every((box) => box.checkCollisions &&
              !box.isVisible && box.metadata?.portalStoneCollider),
            left: world.isColliding(front, pz - stop.side * 5.4, 0, 2.05, 4.1),
            right: world.isColliding(front, pz + stop.side * 5.4, 0, 2.05, 4.1),
            doorway: world.isColliding(front, pz, 0, 2.05, 4.1),
            lintel: world.isColliding(px, pz, 0, 17, 20) };
        });
      })()`, true);
      assert.ok(collisions.every((portal) => portal.blocks === 5 &&
        portal.proxies && portal.left && portal.right &&
        !portal.doorway && portal.lintel),
      `Stone blocks did not fit the openings: ${JSON.stringify(collisions)}`);
      await evaluate(`(async () => {
        window.__bosqueSanctuaryDebug.teleportToStop(1);
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        EngineStore.LastCreatedScene.getTransformNodeByName('playerRoot')
          .position.set(126.5, 3.75, 145);
      })()`, true);
      await delay(2300);
      const midway = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.LastCreatedScene;
        return { veil: scene.getMeshByName('rina_lockedVeil')?.isVisible,
          glow: scene.getMeshByName('rina_portalEdgeGlow')?.isVisible };
      })()`, true);
      assert.ok(!midway.veil && midway.glow,
        `Rina portal stayed locked at the platform midpoint: ${JSON.stringify(midway)}`);
      await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        EngineStore.LastCreatedScene.getTransformNodeByName('playerRoot')
          .position.set(114, 3.75, 145);
      })()`, true);
      await delay(1800);
      const retreat = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.LastCreatedScene;
        return { veil: scene.getMeshByName('rina_lockedVeil')?.isVisible,
          glow: scene.getMeshByName('rina_portalEdgeGlow')?.isVisible };
      })()`, true);
      assert.ok(retreat.veil && !retreat.glow,
        `Rina portal did not close on retreat: ${JSON.stringify(retreat)}`);
    }
    if (process.env.PORTAL_VERIFY_REVEAL) {
      await evaluate(`(async () => {
        window.__bosqueSanctuaryDebug.teleportToPortal();
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        EngineStore.LastCreatedScene.getTransformNodeByName('playerRoot')
          .position.set(-139, 3.75, -72);
      })()`, true);
      await delay(2300);
      const revealed = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.LastCreatedScene;
        const veil = scene.getMeshByName('libre-de-culpas_lockedVeil');
        const light = scene.getLightByName('libre-de-culpas_portalInnerStoneLight');
        const spill = scene.getMeshByName('libre-de-culpas_portalFloorSpill');
        const volume = scene.getMeshByName('libre-de-culpas_portalLightSlice_0');
        return { visible: veil?.isVisible, lit: light?.isEnabled(), intensity: light?.intensity,
          lightType: light?.getClassName(), stoneCount: light?.includedOnlyMeshes.length,
          floorExcluded: !light?.includedOnlyMeshes.some((mesh) =>
            mesh.name === 'libre-de-culpas_landing' || mesh.name === 'libre-de-culpas_pier'),
          spillStartsInsidePortal: spill?.getVerticesData('position')?.[0] < -139,
          floorLit: spill?.isVisible, floorReady: spill?.material?.isReady(spill),
          volumeLit: volume?.isVisible, volumeReady: volume?.material?.isReady(volume) };
      })()`, true);
      assert.equal(revealed.visible, false, `Portal did not reveal: ${JSON.stringify(revealed)}`);
      assert.ok(revealed.lit && revealed.intensity > .5 &&
        revealed.lightType === 'PointLight' && revealed.stoneCount > 0 &&
        revealed.floorExcluded && revealed.spillStartsInsidePortal &&
        revealed.floorLit && revealed.floorReady && revealed.volumeLit && revealed.volumeReady,
        `Revealed portal did not light the opening correctly: ${JSON.stringify(revealed)}`);
    }
    if (process.env.PORTAL_CAPTURE && process.env.PORTAL_CAPTURE_TARGET !== "rina") {
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
    if (process.env.PORTAL_VERIFY_REVEAL) {
      await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        EngineStore.LastCreatedScene.getTransformNodeByName('playerRoot')
          .position.set(0, 3.75, -72);
      })()`, true);
      await delay(1800);
      const hidden = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.LastCreatedScene;
        const veil = scene.getMeshByName('libre-de-culpas_lockedVeil');
        const light = scene.getLightByName('libre-de-culpas_portalInnerStoneLight');
        const spill = scene.getMeshByName('libre-de-culpas_portalFloorSpill');
        const volume = scene.getMeshByName('libre-de-culpas_portalLightSlice_0');
        return { visible: veil?.isVisible, lit: light?.isEnabled(),
          floorLit: spill?.isVisible, volumeLit: volume?.isVisible };
      })()`, true);
      assert.ok(hidden.visible && !hidden.lit && !hidden.floorLit && !hidden.volumeLit,
        `Portal did not close and dim after departure: ${JSON.stringify(hidden)}`);
    }
    if (process.env.RINA_VERIFY) {
      const rinaParams = new URLSearchParams(process.env.PORTAL_QUERY ?? "");
      const disabled = rinaParams.get("sanctuaryRinaPortal") === "off";
      const version1 = rinaParams.get("sanctuaryRinaVersion") === "1";
      let rina;
      for (let i = 0; i < 80; i++) {
        rina = await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          const scene = EngineStore.LastCreatedScene;
          const panel = scene.getMeshByName('rina_concertPanel');
          const forestPanel = scene.getMeshByName('libre-de-culpas_forestVistaV4');
          const overscan = scene.getMeshByName('rina_concertOverscan');
          const vortex = scene.getMeshByName('rina_crimsonVortex');
          const veil = scene.getMeshByName('rina_lockedVeil');
          const forestVeil = scene.getMeshByName('libre-de-culpas_lockedVeil');
        const edgeGlow = scene.getMeshByName('rina_portalEdgeGlow');
          const uv = panel?.getVerticesData('uv');
          const layers = scene.meshes.filter((mesh) => mesh.name.startsWith('rina_v2_'));
          return { panel: !!panel, ready: panel?.material?.isReady(panel),
            overscan: !!overscan,
            material: panel?.material?.name, redVisible: vortex?.isVisible,
            bounds: panel?.getBoundingInfo().boundingBox.extendSize.asArray(),
            position: panel?.position.asArray(),
            forestBounds: forestPanel?.getBoundingInfo().boundingBox.extendSize.asArray(),
            forestPosition: forestPanel?.position.asArray(),
            uvMin: uv ? Math.min(uv[1], uv[3], uv[5], uv[7]) : null,
            layers: layers.map((mesh) => ({ name: mesh.name,
              ready: mesh.material?.isReady(mesh), visible: mesh.isVisible,
              z: mesh.position.z, y: mesh.position.y,
              width: mesh.getBoundingInfo().boundingBox.extendSize.x * 2,
              height: mesh.getBoundingInfo().boundingBox.extendSize.y * 2 })),
            veilBounds: veil?.getBoundingInfo().boundingBox.extendSize.asArray(),
            veilCenter: veil?.getBoundingInfo().boundingBox.center.asArray(),
            veilPosition: veil?.position.asArray(),
            forestVeilBounds: forestVeil?.getBoundingInfo().boundingBox.extendSize.asArray(),
            forestVeilCenter: forestVeil?.getBoundingInfo().boundingBox.center.asArray(),
            forestVeilPosition: forestVeil?.position.asArray(),
            edgeGlowVisible: edgeGlow?.isVisible,
            edgeGlowBounds: edgeGlow?.getBoundingInfo().boundingBox.extendSize.asArray() };
        })()`, true);
        if (disabled || (rina?.panel && rina.ready && !rina.redVisible)) break;
        await delay(250);
      }
      if (disabled) {
        assert.ok(!rina.panel && rina.redVisible,
          `Rina A/B fallback failed: ${JSON.stringify(rina)}`);
      } else {
        assert.ok(rina.panel && rina.ready && !rina.redVisible &&
          rina.material === (version1 ? 'sanctuaryRinaConcertPortal' : 'sanctuaryRinaV2Backdrop'),
          `Rina concert panel did not replace the red vortex: ${JSON.stringify(rina)}`);
        assert.ok(Math.abs(rina.bounds[0] - .245) < .0001 &&
          Math.abs(rina.bounds[1] - .42) < .0001 &&
          Math.abs(rina.position[0] - .025) < .0001 &&
          Math.abs(rina.position[1] - .4) < .0001 &&
          Math.abs(rina.position[2] + .01) < .0001 &&
          rina.bounds.every((value, index) =>
            Math.abs(value - rina.forestBounds[index]) < .0001) &&
          rina.position.every((value, index) =>
            Math.abs(value - rina.forestPosition[index]) < .0001) &&
          !rina.overscan &&
          (version1 ? rina.uvMin > .18 && rina.uvMin < .2 :
            rina.layers.length >= 12 && rina.layers.every((layer) => layer.ready && layer.visible) &&
            rina.layers.every((layer) => Math.abs(layer.z + .009) < .0001) &&
            rina.layers.some((layer) => layer.name === 'rina_v2_rina_foot_mist' &&
              Math.abs(layer.y - .283) < .002) &&
            rina.layers.some((layer) => layer.name === 'rina_v2_rina_cutout' &&
              Math.abs(layer.width - .134) < .0001 &&
              Math.abs(layer.height - .22) < .0001 &&
              Math.abs(layer.y - .393) < .002) &&
            ['stage_left', 'stage_right', 'rina_cutout', 'katy_visible',
              'beam_pink', 'beam_blue'].every((name) =>
              rina.layers.some((layer) => layer.name === `rina_v2_${name}`))) &&
          Math.abs(rina.veilBounds[0] - .245) < .0001 &&
          Math.abs(rina.veilBounds[1] - .42) < .0001 &&
          rina.veilBounds.every((value, index) =>
            Math.abs(value - rina.forestVeilBounds[index]) < .0001) &&
          rina.veilCenter.every((value, index) =>
            Math.abs(value - rina.forestVeilCenter[index]) < .0001) &&
          rina.veilPosition.every((value, index) =>
            Math.abs(value - rina.forestVeilPosition[index]) < .0001) &&
          !rina.edgeGlowVisible &&
          rina.edgeGlowBounds.every((value, index) =>
            Math.abs(value - rina.forestBounds[index]) < .0001),
          `Rina panel or veil does not fit the forest portal: ${JSON.stringify(rina)}`);
        if (process.env.PORTAL_CAPTURE_LOCKED) {
          const distance = Number(process.env.PORTAL_CAPTURE_DISTANCE ?? 8);
          const lateral = Number(process.env.PORTAL_CAPTURE_LATERAL ?? 5);
          const eye = Number(process.env.PORTAL_CAPTURE_EYE ?? 3.5);
          const lookY = Number(process.env.PORTAL_CAPTURE_LOOK_Y ?? 12);
          await evaluate(`(async () => {
            const storeUrl = performance.getEntriesByType('resource')
              .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
            const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
            const { Vector3 } = await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
            const scene = EngineStore.LastCreatedScene;
            const camera = scene.activeCamera.clone('rinaLockedCaptureCamera');
            camera.parent = null;
            camera.position.set(${139 - distance}, ${eye}, ${163 + lateral});
            camera.setTarget(new Vector3(139, ${lookY}, 163));
            scene.activeCamera = camera;
          })()`, true);
          await delay(500);
          const screenshot = await send("Page.captureScreenshot", { format: "png" });
          await writeFile(process.env.PORTAL_CAPTURE_LOCKED,
            Buffer.from(screenshot.result.data, "base64"));
        }
        await evaluate(`(async () => {
          window.__bosqueSanctuaryDebug.teleportToPortal();
          const storeUrl = performance.getEntriesByType('resource')
            .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          EngineStore.LastCreatedScene.getTransformNodeByName('playerRoot')
            .position.set(139, 3.75, 163);
        })()`, true);
        await delay(2300);
        const revealed = await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          const scene = EngineStore.LastCreatedScene;
          const veil = scene.getMeshByName('rina_lockedVeil');
          const light = scene.getLightByName('rina_portalInnerStoneLight');
          const contacts = ['left', 'right', 'top'].map((side) =>
            scene.getLightByName('rina_portalStoneContact_' + side));
          const stoneMaterial = contacts[0]?.includedOnlyMeshes[0]?.material;
          const spill = scene.getMeshByName('rina_portalFloorSpill');
          const volume = scene.getMeshByName('rina_portalLightSlice_0');
          const edgeGlow = scene.getMeshByName('rina_portalEdgeGlow');
          return { veil: veil?.isVisible, light: light?.isEnabled(),
            floor: spill?.isVisible, volume: volume?.isVisible,
            edgeGlow: edgeGlow?.isVisible,
            edgeGlowReady: edgeGlow?.material?.isReady(edgeGlow),
            contacts: contacts.map((bounce) => ({ enabled: bounce?.isEnabled(),
              intensity: bounce?.intensity, range: bounce?.range,
              stoneCount: bounce?.includedOnlyMeshes.length,
              materialLights: bounce?.includedOnlyMeshes[0]?.material?.maxSimultaneousLights,
              floorExcluded: !bounce?.includedOnlyMeshes.some((mesh) =>
                mesh.name === 'rina_landing' || mesh.name === 'rina_pier') })),
            stoneContactReveal: stoneMaterial?.pluginManager
              ?.getPlugin('SanctuaryPortalStoneContact')?.reveal,
            floorExcluded: !light?.includedOnlyMeshes.some((mesh) =>
              mesh.name === 'rina_landing' || mesh.name === 'rina_pier'),
            spillStartsInsidePortal: spill?.getVerticesData('position')?.[0] > 139 };
        })()`, true);
        assert.ok(!revealed.veil && revealed.light && revealed.floor &&
          revealed.edgeGlow && revealed.edgeGlowReady &&
          revealed.volume && revealed.floorExcluded && revealed.spillStartsInsidePortal &&
          revealed.stoneContactReveal > .99 &&
          revealed.contacts.length === 3 && revealed.contacts.every((bounce) =>
            bounce.enabled && bounce.intensity > 4 && bounce.range < 8 &&
            bounce.stoneCount > 0 && bounce.materialLights >= 8 &&
            bounce.floorExcluded),
          `Rina reveal or lighting failed: ${JSON.stringify(revealed)}`);
        if (process.env.PORTAL_CAPTURE && process.env.PORTAL_CAPTURE_TARGET === "rina") {
          const distance = Number(process.env.PORTAL_CAPTURE_DISTANCE ?? 19);
          const lateral = Number(process.env.PORTAL_CAPTURE_LATERAL ?? 0);
          const eye = Number(process.env.PORTAL_CAPTURE_EYE ?? 8);
          const lookY = Number(process.env.PORTAL_CAPTURE_LOOK_Y ?? 9);
          await evaluate(`(async () => {
            const storeUrl = performance.getEntriesByType('resource')
              .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
            const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
            const { Vector3 } = await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
            const scene = EngineStore.LastCreatedScene;
            const hiddenLayers = ${JSON.stringify((process.env.RINA_CAPTURE_LAYERS_OFF ?? "").split(",").filter(Boolean))};
            for (const id of hiddenLayers) {
              const layer = scene.getMeshByName('rina_v2_' + id);
              if (layer) layer.isVisible = false;
            }
            const camera = scene.activeCamera.clone('rinaPortalCaptureCamera');
            camera.parent = null;
            camera.position.set(${139 - distance}, ${eye}, ${163 + lateral});
            camera.setTarget(new Vector3(139, ${lookY}, 163));
            scene.activeCamera = camera;
          })()`, true);
          await delay(1500);
          const screenshot = await send("Page.captureScreenshot", { format: "png" });
          await writeFile(process.env.PORTAL_CAPTURE,
            Buffer.from(screenshot.result.data, "base64"));
        }
        await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          EngineStore.LastCreatedScene.getTransformNodeByName('playerRoot')
            .position.set(0, 3.75, 163);
        })()`, true);
        await delay(1800);
        const hidden = await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          const scene = EngineStore.LastCreatedScene;
          const contactStone = scene.getLightByName('rina_portalStoneContact_left')
            ?.includedOnlyMeshes[0]?.material?.pluginManager
            ?.getPlugin('SanctuaryPortalStoneContact');
          return { veil: scene.getMeshByName('rina_lockedVeil')?.isVisible,
            light: scene.getLightByName('rina_portalInnerStoneLight')?.isEnabled(),
            edgeGlow: scene.getMeshByName('rina_portalEdgeGlow')?.isVisible,
            contactsOff: ['left', 'right', 'top'].every((side) =>
              !scene.getLightByName('rina_portalStoneContact_' + side)?.isEnabled()),
            stoneContactOff: contactStone?.reveal < .01,
            floor: scene.getMeshByName('rina_portalFloorSpill')?.isVisible };
        })()`, true);
        assert.ok(hidden.veil && !hidden.light && !hidden.edgeGlow && hidden.contactsOff &&
          hidden.stoneContactOff && !hidden.floor,
          `Rina did not close after departure: ${JSON.stringify(hidden)}`);
        if (process.env.RINA_VERIFY_REENTRY) {
          await evaluate("window.__bosqueLevelDebug.load('sanctuary')", true);
          let reentered;
          for (let i = 0; i < 80; i++) {
            reentered = await evaluate(`(async () => {
              const storeUrl = performance.getEntriesByType('resource')
                .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
              const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
              const scene = EngineStore.LastCreatedScene;
              const panel = scene?.getMeshByName('rina_concertPanel');
              return { ...window.__bosqueLevelDebug.snapshot(),
                panelCount: scene?.meshes.filter((mesh) => mesh.name === 'rina_concertPanel').length,
                panelReady: panel?.material?.isReady(panel),
                redVisible: scene?.getMeshByName('rina_crimsonVortex')?.isVisible };
            })()`, true);
            if (reentered?.panelReady && !reentered.redVisible) break;
            await delay(250);
          }
          assert.ok(reentered?.liveScenes === 1 && reentered.panelCount === 1 &&
            reentered.panelReady && !reentered.redVisible,
            `Rina scene reentry leaked or lost its panel: ${JSON.stringify(reentered)}`);
        }
      }
      assert.ok(!errors.some((error) => /RinaPortal|Shader compilation|INVALID_OPERATION|texture not found/i.test(error)),
        `Rina runtime error: ${errors.join(" | ")}`);
    }
    if (process.env.SECONDARY_PORTALS_VERIFY) {
      await evaluate("window.__bosqueSanctuaryDebug.teleportToPortal()", true);
      const stops = [
        { id: 'fortaleza', x: -129, z: 393 },
        { id: 'teatro', x: 137, z: 628 },
        { id: 'encadenado', x: -134, z: 858 },
      ];
      for (const stop of stops) {
        const inspected = await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          const scene = EngineStore.LastCreatedScene;
          const id = ${JSON.stringify(stop.id)};
          const veil = scene.getMeshByName(id + '_lockedVeil');
          const vortex = scene.getMeshByName(id + '_crimsonVortex');
          const edgeGlow = scene.getMeshByName(id + '_portalEdgeGlow');
          const forestVeil = scene.getMeshByName('libre-de-culpas_lockedVeil');
          const contacts = ['left', 'right', 'top'].map((side) =>
            scene.getLightByName(id + '_portalStoneContact_' + side));
          return { veil: veil?.isVisible, ready: veil?.material?.isReady(veil),
            edgeGlowVisible: edgeGlow?.isVisible,
            edgeGlowBounds: edgeGlow?.getBoundingInfo().boundingBox.extendSize.asArray(),
            bounds: veil?.getBoundingInfo().boundingBox.extendSize.asArray(),
            center: veil?.getBoundingInfo().boundingBox.center.asArray(),
            position: veil?.position.asArray(),
            vortexBounds: vortex?.getBoundingInfo().boundingBox.extendSize.asArray(),
            vortexCenter: vortex?.getBoundingInfo().boundingBox.center.asArray(),
            forestBounds: forestVeil?.getBoundingInfo().boundingBox.extendSize.asArray(),
            forestCenter: forestVeil?.getBoundingInfo().boundingBox.center.asArray(),
            forestPosition: forestVeil?.position.asArray(),
            contacts: contacts.map((light) => ({ exists: !!light,
              enabled: light?.isEnabled(), stoneCount: light?.includedOnlyMeshes.length,
              plugin: light?.includedOnlyMeshes[0]?.material?.pluginManager
                ?.getPlugin('SanctuaryPortalStoneContact')?.name })) };
        })()`, true);
        assert.ok(inspected.veil && inspected.ready &&
          !inspected.edgeGlowVisible &&
          Math.abs(inspected.bounds[0] - .245) < .0001 &&
          Math.abs(inspected.bounds[1] - .42) < .0001 &&
          inspected.bounds.every((value, index) =>
            Math.abs(value - inspected.forestBounds[index]) < .0001) &&
          inspected.center.every((value, index) =>
            Math.abs(value - inspected.forestCenter[index]) < .0001) &&
          inspected.position.every((value, index) =>
            Math.abs(value - inspected.forestPosition[index]) < .0001) &&
          inspected.vortexBounds.every((value, index) =>
            Math.abs(value - inspected.forestBounds[index]) < .0001) &&
          inspected.edgeGlowBounds.every((value, index) =>
            Math.abs(value - inspected.forestBounds[index]) < .0001) &&
          inspected.vortexCenter.every((value, index) =>
            Math.abs(value - inspected.forestCenter[index]) < .0001) &&
          inspected.contacts.every((contact) => contact.exists &&
            !contact.enabled && contact.stoneCount > 0 &&
            contact.plugin === 'SanctuaryPortalStoneContact'),
          `${stop.id} placeholder or contacts missing: ${JSON.stringify(inspected)}`);
        await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          EngineStore.LastCreatedScene.getTransformNodeByName('playerRoot')
            .position.set(${stop.x}, 3.75, ${stop.z});
        })()`, true);
        await delay(2200);
        const revealed = await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          const scene = EngineStore.LastCreatedScene;
          const id = ${JSON.stringify(stop.id)};
          const light = scene.getLightByName(id + '_portalStoneContact_left');
          return { veil: scene.getMeshByName(id + '_lockedVeil')?.isVisible,
            edgeGlow: scene.getMeshByName(id + '_portalEdgeGlow')?.isVisible,
            edgeGlowReady: scene.getMeshByName(id + '_portalEdgeGlow')?.material
              ?.isReady(scene.getMeshByName(id + '_portalEdgeGlow')),
            contact: light?.isEnabled(), intensity: light?.intensity,
            stoneReveal: light?.includedOnlyMeshes[0]?.material?.pluginManager
              ?.getPlugin('SanctuaryPortalStoneContact')?.reveal,
            floor: scene.getMeshByName(id + '_portalFloorSpill')?.isVisible };
        })()`, true);
        assert.ok(!revealed.veil && revealed.edgeGlow && revealed.edgeGlowReady &&
          revealed.contact &&
          revealed.intensity > 4 && revealed.stoneReveal > .99 && revealed.floor,
          `${stop.id} did not reveal and light: ${JSON.stringify(revealed)}`);
        await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          EngineStore.LastCreatedScene.getTransformNodeByName('playerRoot')
            .position.set(0, 3.75, 163);
        })()`, true);
        await delay(1800);
        const hidden = await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          const scene = EngineStore.LastCreatedScene;
          const id = ${JSON.stringify(stop.id)};
          return { veil: scene.getMeshByName(id + '_lockedVeil')?.isVisible,
            edgeGlow: scene.getMeshByName(id + '_portalEdgeGlow')?.isVisible,
            contact: scene.getLightByName(id + '_portalStoneContact_left')?.isEnabled(),
            floor: scene.getMeshByName(id + '_portalFloorSpill')?.isVisible };
        })()`, true);
        assert.ok(hidden.veil && !hidden.edgeGlow && !hidden.contact && !hidden.floor,
          `${stop.id} did not close after departure: ${JSON.stringify(hidden)}`);
      }
    }
  }
  if (level === "rina") {
    const heights = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
          .find((item) => item.metadata?.rinaLevel);
        for (const mesh of scene.meshes) {
          if (mesh.skeleton && mesh.getTotalVertices() > 0) {
            mesh.refreshBoundingInfo(true, true);
          }
        }
        const height = (name) => {
          const bounds = scene.getTransformNodeByName(name)?.getHierarchyBoundingVectors(true);
          return bounds ? bounds.max.y - bounds.min.y : null;
        };
        return { player: height('playerAvatarRoot'), rina: height('enemy:rina-stage:visualRoot') };
      })()`, true);
    assert.ok(heights.player > 2.35 && heights.player < 2.8 &&
      heights.rina > 2.5 && heights.rina < 2.65 &&
      (character === 'sofia' ? heights.rina > heights.player : heights.rina < heights.player),
      `Character height order is wrong (${character}): ${JSON.stringify(heights)}`);
    console.log(`${character} ${heights.player.toFixed(2)} m; Rina ${heights.rina.toFixed(2)} m`);
    const guitarist = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
        .find(item => item.metadata?.rinaLevel);
      const body = scene.getMeshByName('rinaGuitaristBody');
      const guitar = scene.getMeshByName('rinaGuitaristGuitar');
      const root = scene.getTransformNodeByName('rinaGuitaristRoot');
      body?.refreshBoundingInfo(true);
      const bounds = mesh => mesh ? {
        min: mesh.getBoundingInfo().boundingBox.minimumWorld.asArray(),
        max: mesh.getBoundingInfo().boundingBox.maximumWorld.asArray(),
      } : null;
      return { root: root?.position.asArray(), scale: root?.scaling.x,
        rotation: root?.rotation.y, body: bounds(body), guitar: bounds(guitar),
        skeletonBones: body?.skeleton?.bones.length,
        playing: scene.animationGroups.filter(group => group.isPlaying &&
          group.name === 'Tocando').map(group => group.name),
        lit: ['rinaActorBounce', 'rinaActorStageRim'].every(name =>
          [body, guitar].every(mesh => scene.getLightByName(name)?.includedOnlyMeshes.includes(mesh))),
        key: [body, guitar].every(mesh =>
          scene.getLightByName('rinaGuitaristKey')?.includedOnlyMeshes.includes(mesh)) };
    })()`, true);
    console.log(`Rina guitarist: ${JSON.stringify(guitarist)}`);
    assert.ok(guitarist?.body && guitarist.guitar && guitarist.skeletonBones >= 60 &&
      guitarist.playing.length === 1 && guitarist.lit && guitarist.key &&
      guitarist.body.max[1] - guitarist.body.min[1] > heights.rina + 0.1 &&
      guitarist.body.max[1] - guitarist.body.min[1] < heights.rina + 0.35 &&
      Math.abs(guitarist.body.min[1] - 5.79) < 0.2 &&
      Math.abs(guitarist.root[0] - 20.1) < 0.01 &&
      Math.abs(guitarist.root[2] - 62.55) < 0.01,
      `Rina guitarist is missing, incorrectly sized, or off the right riser: ${JSON.stringify(guitarist)}`);
    const drummer = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
        .find(item => item.metadata?.rinaLevel);
      const root = scene.getTransformNodeByName('rinaDrummerRoot');
      const body = scene.getMeshByName('rinaDrummerBody');
      const kit = scene.meshes.filter(mesh => mesh.name.startsWith('rinaDrumKit_'));
      for (const mesh of [body, ...kit]) mesh?.refreshBoundingInfo(true);
      const bounds = mesh => mesh ? {
        min: mesh.getBoundingInfo().boundingBox.minimumWorld.asArray(),
        max: mesh.getBoundingInfo().boundingBox.maximumWorld.asArray(),
      } : null;
      const kitBounds = kit.reduce((result, mesh) => {
        const current = bounds(mesh);
        if (!result) return current;
        return { min: result.min.map((value, i) => Math.min(value, current.min[i])),
          max: result.max.map((value, i) => Math.max(value, current.max[i])) };
      }, null);
      return { root: root?.position.asArray(), scale: root?.scaling.x,
        rotation: root?.rotation.y, body: bounds(body), kit: kitBounds,
        kitMeshes: kit.length, skeletonBones: body?.skeleton?.bones.length,
        playing: scene.animationGroups.filter(group => group.isPlaying &&
          group.name === 'rinaDrummerTocando').map(group => group.name),
        lit: ['rinaActorBounce', 'rinaActorStageRim'].every(name =>
          [body, ...kit].every(mesh => scene.getLightByName(name)?.includedOnlyMeshes.includes(mesh))),
        key: [body, ...kit].every(mesh =>
          scene.getLightByName('rinaDrummerKey')?.includedOnlyMeshes.includes(mesh)) };
    })()`, true);
    console.log(`Rina drummer: ${JSON.stringify(drummer)}`);
    assert.ok(drummer?.body && drummer.kit && drummer.kitMeshes >= 1 &&
      drummer.skeletonBones >= 60 && drummer.playing.length === 1 &&
      drummer.lit && drummer.key && drummer.root[0] < -10 &&
      Math.abs(drummer.root[1] - 5.79) < 0.2 &&
      Math.abs(drummer.root[2] - 62.55) < 0.01 &&
      drummer.body.max[1] - drummer.body.min[1] > 2.0 &&
      drummer.body.max[1] - drummer.body.min[1] <
        guitarist.body.max[1] - guitarist.body.min[1] - 0.2 &&
      Math.abs(drummer.body.min[1] - 5.79) < 0.2 &&
      Math.abs(drummer.kit.min[1] - 5.79) < 0.2 &&
      drummer.kit.min[0] > -29.7 && drummer.kit.max[0] < -10.5 &&
      drummer.kit.min[2] > 56.7 && drummer.kit.max[2] < 68.1,
      `Rina drummer is missing or off the center-left riser: ${JSON.stringify(drummer)}`);
    const fieldMaze = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      return EngineStore.Instances.flatMap(engine => engine.scenes)
        .find(item => item.metadata?.rinaLevel)?.metadata?.rinaLevel?.crowdSystem === 'field-maze';
    })()`, true);
    // The field maze uses GLBs only on the pitch rim; its stands are sprites.
    // These checks belong to the older GLB stands renderer.
    if (!fieldMaze) {
    let fanAssets;
    for (let i = 0; i < 80; i++) {
      fanAssets = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
          .find((item) => item.metadata?.rinaLevel);
        return scene?.meshes.filter(mesh => mesh.name.startsWith('rinaCrowd_fan_01:') &&
          mesh.getTotalVertices() > 0)
          .map(mesh => ({ name: mesh.name, count: mesh.thinInstanceCount,
            emissive: mesh.material?.emissiveColor?.r,
            direct: mesh.material?.directIntensity,
            textured: !!mesh.material?.albedoTexture,
            selfLit: !!mesh.material?.emissiveTexture,
            actorLight: ['rinaActorBounce', 'rinaActorStageRim'].every(name =>
              scene.getLightByName(name)?.includedOnlyMeshes.includes(mesh)),
            rigged: !!mesh.skeleton,
            bones: mesh.skeleton?.bones.length }));
      })()`, true);
      if (fanAssets?.length >= (fieldMaze && !process.env.RINA_MOBILE_VERIFY ? 2 : 1) &&
          fanAssets.every(fan => fan.count > 0)) break;
      await delay(250);
    }
    assert.equal(fanAssets?.length, fieldMaze && !process.env.RINA_MOBILE_VERIFY ? 2 : 1,
      `Rina animated fan 01 did not replace the posed model: ${JSON.stringify(fanAssets)}; ${errors.join(' | ')}`);
    assert.ok(fanAssets.every(fan => fan.count > 0 && fan.emissive === 0 &&
      fan.direct === 1 && fan.textured && !fan.selfLit && fan.actorLight && fan.rigged &&
      fan.bones === 65 && fan.name.includes(':middle:')),
      `Rina animated fan 01 is unlit or missing its rig: ${JSON.stringify(fanAssets)}`);
    console.log(`Rina fan variants: ${JSON.stringify(fanAssets)}`);
    const crowdTotals = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
        .find((item) => item.metadata?.rinaLevel);
      const count = prefix => scene.meshes.filter(mesh => mesh.name.startsWith(prefix))
        .reduce((sum, mesh) => sum + Math.max(0, mesh.thinInstanceCount), 0);
      return { procedural: count('rinaStandsCrowd_'), fan: count('rinaCrowd_fan_01:') };
    })()`, true);
    assert.ok(crowdTotals.fan >= (process.env.RINA_MOBILE_VERIFY ? 8 : 30),
      `Rina animated fan 01 did not populate the stands: ${JSON.stringify(crowdTotals)}`);
    const animatedFans = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
        .find((item) => item.metadata?.rinaLevel);
      const meshes = scene.meshes.filter(mesh => mesh.name.startsWith('rinaCrowd_fan_04:') &&
        mesh.getTotalVertices() > 0);
      return { meshes: meshes.map(mesh => ({ name: mesh.name, count: mesh.thinInstanceCount,
        bones: mesh.skeleton?.bones.length, textured: !!mesh.material?.albedoTexture,
        selfLit: !!mesh.material?.emissiveTexture,
        actorLight: ['rinaActorBounce', 'rinaActorStageRim'].every(name =>
          scene.getLightByName(name)?.includedOnlyMeshes.includes(mesh)),
        height: mesh.getBoundingInfo().boundingBox.maximumWorld.y -
          mesh.getBoundingInfo().boundingBox.minimumWorld.y,
        rearCount: mesh.name.includes(':middle:') ? mesh.thinInstanceGetWorldMatrices()
          .filter(matrix => matrix.multiply(mesh.getWorldMatrix()).getTranslation().z < -90).length : 0,
        field: (() => { let node = mesh.parent; while (node) {
          if (node.name === 'rinaFieldAnimatedCrowdRoot') return true; node = node.parent;
        } return false; })() })),
        playingNames: scene.animationGroups.filter(group =>
          group.name.startsWith('rinaCrowd_fan_04:') && group.isPlaying)
          .map(group => group.name) };
    })()`, true);
    assert.equal(animatedFans.meshes.length,
      process.env.RINA_MOBILE_VERIFY || fieldMaze ? 1 : 2);
    const middleAnimatedCount = animatedFans.meshes.filter(mesh => !mesh.field)
      .reduce((sum, mesh) => sum + mesh.count, 0);
    const rearAnimatedCount = animatedFans.meshes.reduce((sum, mesh) => sum + mesh.rearCount, 0);
    assert.ok(middleAnimatedCount >= (process.env.RINA_MOBILE_VERIFY ? 8 : 40) &&
      middleAnimatedCount <= (process.env.RINA_MOBILE_VERIFY ? 16 : 68) &&
      rearAnimatedCount >= (process.env.RINA_MOBILE_VERIFY ? 5 : 25) &&
      rearAnimatedCount > middleAnimatedCount / 2);
    assert.ok(animatedFans.meshes.every(mesh => mesh.count > 0 && mesh.bones === 65 &&
      mesh.textured && !mesh.selfLit && mesh.actorLight) &&
      animatedFans.meshes.filter(mesh => mesh.field).reduce((sum, mesh) => sum + mesh.count, 0) ===
        (process.env.RINA_MOBILE_VERIFY || fieldMaze ? 0 : 1) &&
      animatedFans.playingNames.length === animatedFans.meshes.length &&
      (fieldMaze ? ['middle'] : ['near', 'middle']).every(quality =>
        process.env.RINA_MOBILE_VERIFY && quality === 'near' ||
        new Set(animatedFans.playingNames.filter(name => name.includes(`fan_04:${quality}:`))
          .map(name => name.slice(name.lastIndexOf(':') + 1))).size === 1),
      `Rina fan 04 animation groups did not load: ${JSON.stringify(animatedFans)}; ${errors.join(' | ')}`);
    console.log(`Rina animated fans: ${JSON.stringify(animatedFans)}`);
    let fan05;
    for (let attempt = 0; attempt < 40; attempt++) {
      fan05 = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
          .find(item => item.metadata?.rinaLevel);
        const meshes = scene.meshes.filter(mesh => mesh.name.startsWith('rinaCrowd_fan_05:') &&
          mesh.getTotalVertices() > 0);
        const clips = scene.animationGroups.filter(group => group.name.startsWith('rinaCrowd_fan_05:'));
        return {
          meshes: meshes.map(mesh => ({ name: mesh.name, count: mesh.thinInstanceCount,
            bones: mesh.skeleton?.bones.length, textured: !!mesh.material?.albedoTexture,
            selfLit: !!mesh.material?.emissiveTexture,
            actorLight: ['rinaActorBounce', 'rinaActorStageRim'].every(name =>
              scene.getLightByName(name)?.includedOnlyMeshes.includes(mesh)),
            field: (() => { let node = mesh.parent; while (node) {
              if (node.name === 'rinaFieldAnimatedCrowdRoot' ||
                  node.name === 'rinaFieldCrowdMazeRoot') return true; node = node.parent;
            } return false; })(),
            rearCount: mesh.thinInstanceGetWorldMatrices()
              .filter(matrix => matrix.multiply(mesh.getWorldMatrix()).getTranslation().z < -90).length })),
          clipCount: clips.length, playing: clips.filter(group => group.isPlaying).map(group => group.name),
        };
      })()`, true);
      if (fan05.meshes.length === (process.env.RINA_MOBILE_VERIFY ? 1 : 2)) break;
      await delay(250);
    }
    assert.equal(fan05.meshes.length, process.env.RINA_MOBILE_VERIFY ? 1 : 2,
      `Rina fan 05 did not load: ${JSON.stringify(fan05)}; ${errors.join(' | ')}`);
    const fieldFan05Count = fan05.meshes.filter(mesh => mesh.field)
      .reduce((sum, mesh) => sum + mesh.count, 0);
    assert.ok(fan05.meshes.every(mesh => mesh.count > 0 && mesh.bones === 65 &&
      mesh.textured && !mesh.selfLit && mesh.actorLight &&
      mesh.name.includes(':middle:')) &&
      (process.env.RINA_MOBILE_VERIFY ? fieldFan05Count === 0 :
        fieldMaze ? fieldFan05Count > 0 : fieldFan05Count === 1) &&
      fan05.meshes.filter(mesh => !mesh.field).reduce((sum, mesh) => sum + mesh.count, 0) >=
        (process.env.RINA_MOBILE_VERIFY ? 8 : 30) &&
      fan05.meshes.reduce((sum, mesh) => sum + mesh.rearCount, 0) >=
        (process.env.RINA_MOBILE_VERIFY ? 5 : 20) &&
      fan05.clipCount === fan05.meshes.length * 5 &&
      fan05.playing.length === fan05.meshes.length,
    `Rina fan 05 is missing the 1K model, rig, or one-shot clips: ${JSON.stringify(fan05)}`);
    console.log(`Rina fan 05: ${JSON.stringify(fan05)}`);
    let newFans;
    for (let attempt = 0; attempt < 40; attempt++) {
      newFans = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
          .find(item => item.metadata?.rinaLevel);
        return ['fan_01', 'fan_02', 'fan_03'].map(id => {
          const mesh = scene.meshes.find(item => item.name.startsWith('rinaCrowd_' + id + ':') &&
            item.getTotalVertices() > 0 && (() => { let node = item.parent;
              while (node) { if (node.name === 'rinaFieldCrowdMazeRoot') return false;
                node = node.parent; } return true; })());
          const clips = scene.animationGroups.filter(group =>
            group.name.startsWith(mesh?.name + ':'));
          const world = mesh?.thinInstanceCount > 0 ?
            mesh.thinInstanceGetWorldMatrices()[0].multiply(mesh.getWorldMatrix()) : null;
          return { id, count: mesh?.thinInstanceCount ?? 0,
            bones: mesh?.skeleton?.bones.length,
            clipNames: [...new Set(clips.map(group =>
              group.name.slice(group.name.lastIndexOf(':') + 1)))],
            playing: clips.filter(group => group.isPlaying).length,
            scaleY: world ? Math.abs(world.m[5]) : null,
            poseHeight: world ? Math.abs(world.m[5]) *
              mesh.getBoundingInfo().boundingBox.extendSize.y * 2 : null };
        });
      })()`, true);
      if (newFans.every(fan => fan.count > 0)) break;
      await delay(250);
    }
    assert.ok(newFans.every((fan, index) => fan.count >=
      (process.env.RINA_MOBILE_VERIFY ? 8 : 30) && fan.bones === 65 &&
      fan.clipNames.length === (index === 0 ? 5 : 4) &&
      fan.playing === (fieldMaze && !process.env.RINA_MOBILE_VERIFY && index !== 1 ? 2 : 1)),
    `Rina fans 01–03 lack instances, rigs or clips: ${JSON.stringify(newFans)}; ${errors.join(' | ')}`);
    assert.ok(Math.abs(newFans[0].scaleY * 100 - 2.65) < 0.20 &&
      Math.abs(newFans[1].scaleY * 100 - 2.55) < 0.20 &&
      Math.abs(newFans[2].scaleY * 100 - 2.80) < 0.20 &&
      newFans[1].scaleY < newFans[0].scaleY &&
      newFans[0].scaleY < newFans[2].scaleY,
    `Rina fans 01–03 have incorrect relative stature: ${JSON.stringify(newFans)}`);
    console.log(`Rina new animated fans: ${JSON.stringify(newFans)}`);
    const fanSeparation = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
        .find((item) => item.metadata?.rinaLevel);
      const positions = prefix => scene.meshes.filter(mesh => mesh.name.startsWith(prefix) &&
        mesh.getTotalVertices() > 0 && mesh.thinInstanceCount > 0)
        .flatMap(mesh => mesh.thinInstanceGetWorldMatrices().map(matrix => {
          const position = matrix.multiply(mesh.getWorldMatrix()).getTranslation();
          return [position.x, position.y, position.z];
        }));
      const fan04 = positions('rinaCrowd_fan_04:');
      const fan05 = positions('rinaCrowd_fan_05:');
      const fieldFan04 = positions('rinaCrowd_fan_04:near:');
      const allAnimated = ['fan_01', 'fan_02', 'fan_03']
        .flatMap(id => positions('rinaCrowd_' + id + ':')).concat(fan04, fan05);
      const others = positions('rinaStandsCrowd_');
      const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      let closestFan = Infinity;
      let closestOther = Infinity;
      let duplicates = 0;
      for (let i = 0; i < allAnimated.length; i++) {
        for (let j = i + 1; j < allAnimated.length; j++) {
          const d = distance(allAnimated[i], allAnimated[j]);
          closestFan = Math.min(closestFan, d);
          if (d < 0.05) duplicates++;
        }
        for (const other of others) {
          const d = distance(allAnimated[i], other);
          closestOther = Math.min(closestOther, d);
          if (d < 0.05) duplicates++;
        }
      }
      return { closestFan, closestOther, duplicates,
        showcaseDistance: fieldFan04.length ? Math.min(...fieldFan04.map(position =>
          Math.hypot(position[0], position[2] - (-26 * 1.5)))) : null,
        fan05ShowcaseDistance: fan05.length ? Math.min(...fan05.map(position =>
          Math.hypot(position[0] - 3.6 * 1.5, position[2] - (-26 * 1.5)))) : null };
    })()`, true);
    assert.equal(fanSeparation.duplicates, 0,
      `Rina animated fans have overlapping instance origins: ${JSON.stringify(fanSeparation)}`);
    if (!process.env.RINA_MOBILE_VERIFY && !fieldMaze) assert.ok(fanSeparation.showcaseDistance < 0.1,
      `Rina fan 04 showcase is not at the field test point: ${JSON.stringify(fanSeparation)}`);
    if (!process.env.RINA_MOBILE_VERIFY && !fieldMaze) assert.ok(fanSeparation.fan05ShowcaseDistance < 0.1,
      `Rina fan 05 showcase is not beside fan 04: ${JSON.stringify(fanSeparation)}`);
    console.log(`Rina fan separation: ${JSON.stringify(fanSeparation)}`);
    console.log(`Rina stands crowd: ${JSON.stringify(crowdTotals)}`);
    }
    if (fieldMaze) {
      const expectedStaticMin = process.env.RINA_MOBILE_VERIFY ? 1000 : 2500;
      const expectedStaticMax = process.env.RINA_MOBILE_VERIFY ? 3000 : 6000;
      for (let attempt = 0; attempt < 100; attempt++) {
        const loadedStatic = await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
            .find(item => item.metadata?.rinaLevel);
          return scene.meshes.filter(mesh => mesh.name.startsWith('rinaMazeRealStatic_'))
            .reduce((sum, mesh) => sum + mesh.thinInstanceCount, 0);
        })()`, true);
        if (loadedStatic >= expectedStaticMin && loadedStatic <= expectedStaticMax) break;
        await delay(250);
      }
      const maze = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const { createRinaFieldCrowdMazeLayout } = await import('/src/game/levels/rina/RinaFieldCrowdMazeLayout.ts');
        const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
          .find(item => item.metadata?.rinaLevel);
        const layout = createRinaFieldCrowdMazeLayout();
        const silhouettes = scene.meshes.filter(mesh => mesh.name.startsWith('rinaMazeCore_'));
        const staticMeshes = scene.meshes.filter(mesh => mesh.name.startsWith('rinaMazeRealStatic_'));
        const staticSources = scene.meshes.filter(mesh => mesh.name.startsWith('rinaMazeLOD2Source_'));
        const staticColors = staticMeshes.map(mesh =>
          mesh._userThinInstanceBuffersStorage?.data.instanceColor);
        const staticShades = staticMeshes.flatMap((mesh, index) =>
          Array.from({ length: mesh.thinInstanceCount }, (_, i) =>
            staticColors[index]?.[i * 4] ?? Number.NaN));
        const staticPlacements = staticMeshes.flatMap(mesh => mesh.thinInstanceGetWorldMatrices()
          .map(matrix => {
            const worldMatrix = matrix.multiply(mesh.getWorldMatrix());
            const local = worldMatrix.getTranslation().scale(1 / 1.5);
            // getBoundingInfo() expands after thinInstanceRefreshBoundingInfo;
            // rawBoundingInfo retains the baked GLB's original mesh bounds.
            const sourceHeight = mesh.rawBoundingInfo.boundingBox.extendSize.y * 2;
            const height = sourceHeight *
              Math.hypot(worldMatrix.m[4], worldMatrix.m[5], worldMatrix.m[6]);
            return { name: mesh.name, x: local.x, z: local.z,
              margin: layout.marginToCrowd(local.x, local.z), height,
              sourceHeight };
          }));
        const fieldRigged = scene.meshes.filter(mesh => mesh.name.startsWith('rinaCrowd_fan_') &&
          mesh.getTotalVertices() > 0 && mesh.thinInstanceCount > 0 && (() => { let parent = mesh.parent;
            while (parent) { if (parent.name === 'rinaFieldCrowdMazeRoot') return true;
              parent = parent.parent; } return false; })());
        const fieldRigHeights = fieldRigged.map(mesh => {
          const instance = mesh.thinInstanceGetWorldMatrices()[0];
          const worldMatrix = instance?.multiply(mesh.getWorldMatrix());
          const sourceHeight = mesh.rawBoundingInfo.boundingBox.extendSize.y * 2;
          return { name: mesh.name, sourceHeight,
            effectiveHeight: worldMatrix && sourceHeight *
              Math.hypot(worldMatrix.m[4], worldMatrix.m[5], worldMatrix.m[6]),
            meshYScale: Math.hypot(mesh.getWorldMatrix().m[4],
              mesh.getWorldMatrix().m[5], mesh.getWorldMatrix().m[6]) };
        });
        const fieldRigPositions = fieldRigged.flatMap(mesh =>
          mesh.thinInstanceGetWorldMatrices().map(matrix =>
            matrix.multiply(mesh.getWorldMatrix()).getTranslation().scale(1 / 1.5)));
        const fieldClips = ['fan_01', 'fan_02', 'fan_03', 'fan_04', 'fan_05'].map(id => {
          const clips = scene.animationGroups.filter(group =>
            group.name.startsWith('rinaCrowd_' + id + ':field-lod1:group_0:'));
          return { id, count: clips.length, playing: clips.filter(clip => clip.isPlaying).length,
            names: clips.map(clip => clip.name.slice(clip.name.lastIndexOf(':') + 1)) };
        });
        const world = scene.metadata.playerWorld;
        const scale = scene.metadata.rinaLevel.stadiumScale;
        const isOpen = point => !layout.blocksPlayerLocal(point.x, point.z, 0.48);
        const key = point => point.x + ',' + point.z;
        const adjacent = new Map();
        for (const passage of layout.passages) {
          for (const [from, to] of [[passage.a, passage.b], [passage.b, passage.a]]) {
            if (!adjacent.has(key(from))) adjacent.set(key(from), new Set());
            adjacent.get(key(from)).add(key(to));
          }
        }
        const reachable = new Set([key(layout.entry)]);
        const queue = [key(layout.entry)];
        for (let i = 0; i < queue.length; i++) {
          for (const next of adjacent.get(queue[i]) ?? []) {
            if (reachable.has(next)) continue;
            reachable.add(next);
            queue.push(next);
          }
        }
        return {
          silhouettes: silhouettes.reduce((sum, mesh) => sum + mesh.thinInstanceCount, 0),
          batches: silhouettes.length,
          staticVariants: new Set(staticMeshes.map(mesh =>
            mesh.name.split(':')[0])).size,
          staticSectors: staticMeshes.length,
          visibleSources: staticSources.filter(mesh => mesh.isVisible).length,
          staticFans: staticMeshes.reduce((sum, mesh) => sum + mesh.thinInstanceCount, 0),
          staticRim: staticPlacements.filter(p => p.margin < 0.35).length,
          staticTinted: staticMeshes.every((mesh, index) =>
            staticColors[index]?.length === mesh.thinInstanceCount * 4),
          shadeRange: [Math.min(...staticShades), Math.max(...staticShades)],
          staticRigs: staticMeshes.filter(mesh => !!mesh.skeleton).length,
          staticLighted: staticMeshes.every(mesh => scene.lights.some(light =>
            light.includedOnlyMeshes.includes(mesh))),
          staticSample: staticPlacements.slice(0, 3),
          staticPlacementViolations: staticPlacements.filter(p =>
            p.margin < .079).length,
          staticHeightRange: [Math.min(...staticPlacements.map(p => p.height)),
            Math.max(...staticPlacements.map(p => p.height))],
          fieldRigs: fieldRigged.length,
          fieldRigHeights,
          staticRigMinDistance: fieldRigPositions.length ? staticPlacements.reduce((minimum, p) =>
            fieldRigPositions.reduce((distance, rig) => Math.min(distance,
              Math.hypot(p.x - rig.x, p.z - rig.z)), minimum), Infinity) : null,
          fieldClips,
          fieldFanCount: fieldRigged.reduce((sum, mesh) => sum + mesh.thinInstanceCount, 0),
          paths: layout.passages.length,
          pockets: layout.rescuePockets.length,
          loops: layout.passages.length - adjacent.size + 1,
          deadEnds: [...adjacent.values()].filter(neighbors => neighbors.size === 1).length,
          connected: reachable.size === adjacent.size &&
            layout.rescuePockets.every(pocket => reachable.has(key(pocket.point))) &&
            reachable.has(key(layout.exitToStage)),
          spawnOpen: isOpen({ x: 0, z: -34 }) && !world.isColliding(0, -34 * scale),
          passagesOpen: layout.passages.every(path => isOpen(path.a) && isOpen(path.b) &&
            isOpen({ x: (path.a.x + path.b.x) / 2, z: (path.a.z + path.b.z) / 2 })),
          blockedWorldPassages: layout.passages.filter(path =>
            Array.from({ length: 21 }, (_, i) => i / 20).some(t =>
              world.isColliding((path.a.x + (path.b.x - path.a.x) * t) * scale,
                (path.a.z + (path.b.z - path.a.z) * t) * scale))).map(path => path.id),
          pocketsOpen: layout.rescuePockets.every(pocket => isOpen(pocket.point)),
          stageApproachOpen: isOpen(layout.exitToStage) &&
            !world.isColliding(layout.exitToStage.x * scale, layout.exitToStage.z * scale),
          sideBlocks: [-39, 39].every(x => world.isColliding(x * scale, 0)) &&
            world.isColliding(0, 0),
          placementViolations: staticPlacements.filter(p => p.margin < 0).length,
          catwalkOverlap: staticPlacements.filter(p => Math.abs(p.x) < 4.6 && p.z > 14.9).length,
          individualColliders: silhouettes.filter(mesh => mesh.checkCollisions).length,
        };
      })()`, true);
      console.log(`Rina field maze: ${JSON.stringify(maze)}`);
      assert.ok(maze.batches === 0 && maze.silhouettes === 0 &&
        maze.staticVariants === 10 &&
        maze.visibleSources === 0 && maze.staticSectors >= 10 &&
        maze.staticFans >= expectedStaticMin && maze.staticFans <= expectedStaticMax &&
        maze.staticRigs === 0 && maze.staticLighted && maze.staticTinted &&
        maze.shadeRange[0] < 0.3 && maze.shadeRange[1] > 0.85 &&
        maze.staticPlacementViolations === 0 &&
        maze.staticHeightRange[0] > 2.25 && maze.staticHeightRange[1] < 3.1 &&
        maze.paths >= 28 &&
        maze.pockets === 4 && maze.loops >= 2 && maze.deadEnds >= 5 &&
        maze.connected && maze.spawnOpen && maze.passagesOpen &&
        maze.blockedWorldPassages.length === 0 &&
        maze.pocketsOpen && maze.stageApproachOpen && maze.sideBlocks &&
        maze.placementViolations === 0 && maze.catwalkOverlap === 0 &&
        maze.individualColliders === 0 &&
        maze.fieldRigs === (process.env.RINA_MOBILE_VERIFY ? 0 : 5) &&
        (process.env.RINA_MOBILE_VERIFY || maze.staticRigMinDistance >= 0.45) &&
        maze.fieldClips.every((fan, index) => process.env.RINA_MOBILE_VERIFY
          ? fan.count === (index === 0 ? 5 : index === 1 || index === 2 ? 4 : 0) &&
            fan.playing <= 1
          : fan.count === (index === 0 || index === 4 ? 5 : index === 3 ? 3 : 4) &&
            fan.playing <= 1) &&
        (process.env.RINA_MOBILE_VERIFY || maze.fieldClips.some(fan => fan.playing === 1)) &&
        (process.env.RINA_MOBILE_VERIFY || maze.fieldClips[2].names.includes('fan_03_rallying_inplace')) &&
        maze.fieldRigHeights.every(rig =>
          rig.effectiveHeight >= 2.4 && rig.effectiveHeight <= 2.9) &&
        (process.env.RINA_MOBILE_VERIFY ? maze.fieldFanCount === 0 :
          maze.fieldFanCount >= 700 && maze.fieldFanCount <= 1000 &&
          maze.staticRim <= 100 &&
          maze.fieldFanCount + maze.staticFans >= 3250),
      `Rina field crowd maze is blocked, visually misplaced, or too costly: ${JSON.stringify(maze)}`);
    }
    const crowdPerformance = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
        .find(item => item.metadata?.rinaLevel);
      const { SceneInstrumentation } = await import('/node_modules/@babylonjs/core/Instrumentation/sceneInstrumentation.js');
      const instrumentation = new SceneInstrumentation(scene);
      const engine = scene.getEngine();
      const fps = [], drawCalls = [];
      await new Promise(resolve => setTimeout(resolve, 500));
      for (let sample = 0; sample < 16; sample++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        fps.push(engine.getFps());
        drawCalls.push(instrumentation.drawCallsCounter.current);
      }
      instrumentation.dispose();
      const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const staticMeshes = scene.meshes.filter(mesh => mesh.name.startsWith('rinaMazeRealStatic_'));
      const staticAssets = performance.getEntriesByType('resource').filter(entry =>
        /(?:Fan_0[1-3]|Female_Fan_0[45])_LOD2_Static_.*_512\.glb/.test(entry.name));
      return { fps: median(fps), drawCalls: median(drawCalls),
        activeTriangles: scene.getActiveIndices() / 3,
        staticTriangles: staticMeshes.reduce((sum, mesh) =>
          sum + mesh.getTotalIndices() / 3 * mesh.thinInstanceCount, 0),
        staticAssetResources: staticAssets.length,
        staticAssetsReadyMs: Math.round(Math.max(0, ...staticAssets.map(entry => entry.responseEnd))),
        loadedResources: performance.getEntriesByType('resource').length };
    })()`, true);
    console.log(`Rina crowd performance (${fieldMaze ? 'maze' : 'preview'}): ${JSON.stringify(crowdPerformance)}`);
    rinaCrowdRoundTrip: {
    if (fieldMaze && process.env.RINA_LOD_ONLY_VERIFY) {
      await evaluate("globalThis.__bosqueLevelDebug.load('sanctuary')", true);
      await evaluate("globalThis.__bosqueLevelDebug.load('rina')", true);
      const reloaded = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scenes = EngineStore.Instances.flatMap(engine => engine.scenes)
          .filter(scene => scene.metadata?.rinaLevel && !scene.isDisposed);
        const scene = scenes[0];
        const staticMeshes = scene?.meshes.filter(mesh =>
          mesh.name.startsWith('rinaMazeRealStatic_')) ?? [];
        const rigs = scene?.meshes.filter(mesh => mesh.name.includes(':field-lod1:group_') &&
          mesh.getTotalVertices() > 0) ?? [];
        return { scenes: scenes.length, parent: scene?.getTransformNodeByName('rinaFieldCrowdMazeRoot')?.parent?.name,
          staticFans: staticMeshes.reduce((sum, mesh) => sum + mesh.thinInstanceCount, 0),
          animatedFans: rigs.reduce((sum, mesh) => sum + mesh.thinInstanceCount, 0),
          liveScenes: globalThis.__bosqueLevelDebug.snapshot().liveScenes };
      })()`, true);
      assert.ok(reloaded.scenes === 1 && reloaded.liveScenes === 1 &&
        reloaded.parent === 'rinaStadiumRoot' &&
        reloaded.staticFans >= (process.env.RINA_MOBILE_VERIFY ? 1000 : 2500) &&
        reloaded.staticFans <= (process.env.RINA_MOBILE_VERIFY ? 3000 : 6000) &&
        (process.env.RINA_MOBILE_VERIFY ? reloaded.animatedFans === 0 :
          reloaded.animatedFans >= 700 && reloaded.animatedFans <= 1000 &&
          reloaded.animatedFans + reloaded.staticFans >= 3250),
      `Rina LOD crowd did not cleanly reload: ${JSON.stringify(reloaded)}`);
      console.log(`Rina LOD crowd after reload: ${JSON.stringify(reloaded)}`);
      break rinaCrowdRoundTrip;
    }
    if (fieldMaze && process.env.RINA_MAZE_CAPTURE) {
      await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
          .find(item => item.metadata?.rinaLevel);
        const scale = scene.metadata.rinaLevel.stadiumScale;
        scene.getTransformNodeByName('playerRoot').position.set(6 * scale, 1.7, -8 * scale);
      })()`, true);
      await delay(900);
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(process.env.RINA_MAZE_CAPTURE,
        Buffer.from(screenshot.result.data, 'base64'));
      await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.Instances.flatMap(engine => engine.scenes)
          .find(item => item.metadata?.rinaLevel);
        scene.getTransformNodeByName('playerRoot').position.set(0, 1.7,
          -34 * scene.metadata.rinaLevel.stadiumScale);
      })()`, true);
    }
    let concert;
    for (let i = 0; i < 120; i++) {
      concert = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
          .find((item) => item.metadata?.rinaLevel);
        const isFieldMaze = scene?.metadata?.rinaLevel?.crowdSystem === 'field-maze';
        const pitch = scene?.getMeshByName('rinaPitch');
        const grass = pitch?.material;
        const pitchBounds = pitch?.getBoundingInfo().boundingBox;
        const scale = scene?.metadata?.rinaLevel?.stadiumScale;
        const crowd = scene?.getMeshByName('rinaCrowdPreviewSource') ??
          scene?.getMeshByName('rinaMazeSpectators_0');
        const crowdBounds = crowd?.getBoundingInfo().boundingBox;
        const stageBounds = scene?.getMeshByName('rinaMainStage')?.getBoundingInfo().boundingBox;
        const rearBounds = scene?.getMeshByName('rinaRearStandConcrete')?.getBoundingInfo().boundingBox;
        const sideMesh = scene?.getMeshByName('rinaDoubleStandStructure');
        const sideBounds = sideMesh?.getBoundingInfo().boundingBox;
        const sidePositions = sideMesh?.getVerticesData('position');
        let sideBaseInnerX = Infinity;
        if (sidePositions) {
          for (let i = 0; i < sidePositions.length; i += 3) {
            if (sidePositions[i] > 0 && sidePositions[i + 1] < 2 &&
              sidePositions[i + 2] < -50) {
              sideBaseInnerX = Math.min(sideBaseInnerX, sidePositions[i]);
            }
          }
        }
        const exit = scene?.getMeshByName('rinaExitMarker');
        return {
          rina: scene?.metadata?.rinaLevel?.realRinaAsset,
          scale,
          pitchWidth: pitchBounds && pitchBounds.maximumWorld.x - pitchBounds.minimumWorld.x,
          pitchLength: pitchBounds && pitchBounds.maximumWorld.z - pitchBounds.minimumWorld.z,
          crowdHeight: crowdBounds && crowdBounds.maximumWorld.y - crowdBounds.minimumWorld.y,
          stageWidth: stageBounds && stageBounds.maximumWorld.x - stageBounds.minimumWorld.x,
          rearWidth: rearBounds && rearBounds.maximumWorld.x - rearBounds.minimumWorld.x,
          cornerBaseGapX: rearBounds && scale &&
            sideBaseInnerX - rearBounds.maximumWorld.x / scale,
          sideRearGapZ: sideBounds && rearBounds && scale &&
            (sideBounds.minimumWorld.z - rearBounds.maximumWorld.z) / scale,
          sideLength: sideBounds && sideBounds.maximumWorld.z - sideBounds.minimumWorld.z,
          fieldEdges: isFieldMaze
            ? !scene?.metadata?.playerWorld?.isColliding(0, -34 * scale) &&
              scene?.metadata?.playerWorld?.isColliding(40 * scale, 0)
            : !scene?.metadata?.playerWorld?.isColliding(39 * scale, 0) &&
              scene?.metadata?.playerWorld?.isColliding(40 * scale, 0),
          stageFrontZ: stageBounds?.minimumWorld.z,
          exitZ: exit?.getAbsolutePosition().z,
          rinaZ: scene?.getTransformNodeByName('enemy:rina-stage:root')?.position.z,
          grass: grass?.name,
          ready: grass?.isReady(pitch),
          textures: [grass?.albedoTexture, grass?.bumpTexture, grass?.metallicTexture]
            .map((texture) => ({ url: texture?.url, ready: texture?.isReady() })),
          singing: scene?.animationGroups?.some((group) =>
            group.name.includes('rina_emote_sing') && group.isPlaying),
          catwalk: !!scene?.getMeshByName('rinaStageCatwalk'),
          tunnelOpen: [-58, -55, -52, -50].every((z) =>
            !scene?.metadata?.playerWorld?.isColliding(0, z * scale)),
          catwalkBlocks: scene?.metadata?.playerWorld?.isColliding(0, 20 * scale),
          stageFence: (() => {
            const planes = scene?.meshes?.filter((mesh) =>
              mesh.name.startsWith('rinaStageFenceCollider_')) ?? [];
            const spectators = scene?.getMeshByName('rinaCrowdPreviewSource')?.instances ?? [];
            const world = scene?.metadata?.playerWorld;
            const frontZ = (32.5 - 7.75) * scale;
            return {
              planeCount: planes.length,
              thinInstances: scene?.getMeshByName('rinaStageFence_Model')?.thinInstanceCount,
              aligned: planes.every((plane) => {
                plane.computeWorldMatrix(true);
                const bounds = plane.getBoundingInfo().boundingBox;
                return plane.parent?.name === 'rinaStageSecurityFenceRoot' &&
                  plane.checkCollisions && !plane.isVisible && !plane.isPickable &&
                  Math.abs(bounds.maximumWorld.y - bounds.minimumWorld.y -
                    1.29 * scale) < 0.01;
              }),
              blocksLeft: world?.isColliding(-18 * scale, frontZ, 0, 0, 1.8),
              blocksRight: world?.isColliding(18 * scale, frontZ, 0, 0, 1.8),
              leftStairOpen: !world?.isColliding(-9 * scale, frontZ, 0, 0, 1.8),
              rightStairOpen: !world?.isColliding(9 * scale, frontZ, 0, 0, 1.8),
              clearAbove: !world?.isColliding(18 * scale, frontZ, 0, 2.1, 2.5),
              catwalkSidesBlock: [-1, 1].every((side) =>
                world?.isColliding(side * 4.2 * scale, 20 * scale, 0, 0, 1.8)),
              catwalkTipBlocks: world?.isColliding(0, 15.65 * scale, 0, 0, 1.8),
              outsideCatwalkOpen: !world?.isColliding(4.65 * scale, 20 * scale, 0, 0, 1.8),
              spectatorCount: spectators.length,
              spectatorViolations: spectators.filter((mesh) =>
                !(mesh.position.z <= 24 &&
                  (mesh.position.z <= 14.9 || Math.abs(mesh.position.x) >= 4.6)))
                .slice(0, 5).map((mesh) => ({ name: mesh.name,
                  x: mesh.position.x, z: mesh.position.z })),
              spectatorsOutside: isFieldMaze || spectators.length > 0 && spectators.every((mesh) =>
                mesh.position.z <= 24 &&
                (mesh.position.z <= 14.9 || Math.abs(mesh.position.x) >= 4.6)),
            };
          })(),
          backStand: [
            'rinaRearStandConcrete', 'rinaRearStandDarkConcrete',
            'rinaRearStandAisles', 'rinaRearStandRibbons',
          ].every((name) => !!scene?.getMeshByName(name)),
          rearVisualOnly: scene?.meshes?.filter((mesh) =>
            mesh.name.startsWith('rinaRearStand') ||
            mesh.name === 'rinaRearExitSign').every((mesh) =>
              !mesh.checkCollisions && !mesh.isPickable),
          exitSign: (() => {
            const sign = scene?.getMeshByName('rinaRearExitSign');
            const roof = scene?.getMeshByName('rinaExitTunnelRoof');
            if (!sign || !roof) return false;
            const signBounds = sign.getBoundingInfo().boundingBox;
            const roofBounds = roof.getBoundingInfo().boundingBox;
            return sign.parent?.name === 'rinaStadiumRoot' &&
              Math.abs(signBounds.maximumWorld.y - signBounds.minimumWorld.y -
                0.25 * scale) < 0.01 &&
              signBounds.minimumWorld.y > roofBounds.maximumWorld.y &&
              Math.abs(signBounds.minimumWorld.z -
                roofBounds.maximumWorld.z) < 0.2;
          })(),
          lights: scene?.lights?.filter((light) => light.name.startsWith('rinaMovingSpot_')).length,
          ambient: scene?.getLightByName('rinaStadiumAmbient')?.intensity,
          moon: scene?.getLightByName('rinaStadiumMoon')?.intensity,
          spill: !!scene?.getLightByName('rinaAudienceSpill'),
          screenLights: scene?.lights?.filter((light) =>
            light.name.startsWith('rinaScreenLight_')).length,
          beams: scene?.meshes?.filter((mesh) =>
            mesh.name.startsWith('rinaSpotBeam_')).length,
          architectureParent: scene?.getTransformNodeByName('rinaStageV2Root')?.parent?.name,
          speakerRigParent: scene?.getTransformNodeByName('rinaV3SpeakerRig')?.parent?.name,
          speakerModules: scene?.transformNodes?.filter((node) =>
            node.name.startsWith('rinaSpeakerCabinet_')).length,
          subwoofers: scene?.transformNodes?.filter((node) =>
            node.name.startsWith('rinaSubwoofer_')).length,
          stageMonitors: scene?.transformNodes?.filter((node) =>
            node.name.startsWith('rinaMonitorWedge_')).length,
          speakerCurve: Math.abs(
            (scene?.getTransformNodeByName('rinaSpeakerCabinet_1_0')?.rotation.x ?? 0) -
            (scene?.getTransformNodeByName('rinaSpeakerCabinet_1_7') ??
              scene?.getTransformNodeByName('rinaSpeakerCabinet_1_5'))?.rotation.x),
          mergedSpeakers: scene?.meshes?.filter((mesh) =>
            mesh.name.startsWith('rinaV3SpeakerMerged_')).length,
          oldSpeakers: scene?.meshes?.filter((mesh) =>
            mesh.name.startsWith('rinaV2LineArray_') ||
            mesh.name.startsWith('rinaV2Monitor_')).length,
          speakerGrilles: [
            scene?.getMaterialByName('rinaSpeakerPerforatedGrille')?.diffuseTexture?.name,
            scene?.getMaterialByName('rinaSpeakerSubwooferGrille')?.diffuseTexture?.name,
          ],
          smoke: !!scene?.particleSystems?.find((system) =>
            system.name === 'rinaStageSmoke'),
          rinaFill: scene?.getLightByName('rinaPortraitFill')?.intensity,
          rinaFillMeshes: scene?.getLightByName('rinaPortraitFill')?.includedOnlyMeshes.length,
        };
      })()`, true);
      if (concert?.ready && concert.textures.every((texture) => texture.ready) && concert.singing) break;
      await delay(250);
    }
    assert.ok(concert.rina && concert.scale >= 1.3 &&
      Math.abs(concert.pitchWidth - 80 * concert.scale) < 0.1 &&
      Math.abs(concert.rearWidth - 89 * concert.scale) < 0.1 &&
      concert.cornerBaseGapX > 0.5 && concert.cornerBaseGapX < 3 &&
      concert.sideRearGapZ > 5 && concert.sideRearGapZ < 9 &&
      Math.abs(concert.sideLength - 112 * concert.scale) < 1 &&
      concert.fieldEdges &&
      concert.pitchLength >= 105 * 1.3 &&
      (fieldMaze || concert.crowdHeight > 2.45 && concert.crowdHeight < 2.6) &&
      concert.stageWidth >= 58 * 1.3 &&
      Math.abs(concert.exitZ - (-59 + 1.2) * concert.scale) < 0.1 &&
      concert.rinaZ > concert.stageFrontZ &&
      concert.rinaZ - concert.stageFrontZ < 8 &&
      concert.grass === 'rinaPitchGrass' && concert.ready &&
      concert.textures.every((texture) => texture.ready &&
        texture.url.includes('/assets/textures/rina/stadium/grass/')) &&
      concert.singing && concert.catwalk && concert.tunnelOpen &&
      concert.catwalkBlocks && concert.backStand && concert.rearVisualOnly &&
      concert.stageFence.planeCount === 13 &&
      concert.stageFence.thinInstances > 20 && concert.stageFence.aligned &&
      concert.stageFence.blocksLeft && concert.stageFence.blocksRight &&
      concert.stageFence.leftStairOpen && concert.stageFence.rightStairOpen &&
      concert.stageFence.clearAbove && concert.stageFence.catwalkSidesBlock &&
      concert.stageFence.catwalkTipBlocks && concert.stageFence.outsideCatwalkOpen &&
      concert.stageFence.spectatorsOutside &&
      concert.exitSign && concert.lights >= 2 &&
      concert.ambient <= 0.15 && concert.moon <= 0.05 &&
      concert.spill && concert.screenLights === 2 &&
      concert.beams === concert.lights && concert.smoke &&
      concert.rinaFill > 0 && concert.rinaFillMeshes > 0,
      `Rina concert incomplete: ${JSON.stringify(concert)}; ${errors.join(' | ')}`);
    assert.ok(concert.architectureParent === 'rinaStadiumRoot' &&
      concert.speakerRigParent === 'rinaStageV2Root' &&
      ((concert.speakerModules === 12 && concert.subwoofers === 2) ||
        (concert.speakerModules === 16 && concert.subwoofers === 4)) &&
      concert.stageMonitors === 6 && concert.speakerCurve > 0.15 &&
      concert.mergedSpeakers >= 5 && concert.oldSpeakers === 0 &&
      concert.speakerGrilles[0] === 'rinaSpeakerGrilleTexture' &&
      concert.speakerGrilles[1] === 'rinaSubwooferGrilleTexture',
      `Rina V3 speaker rig incomplete: ${JSON.stringify(concert)}`);
    if (!process.env.RINA_SKIP_SHOW) {
    const audioPrototype = await send('Runtime.evaluate', {
      expression: 'HTMLAudioElement.prototype',
    });
    const audioInstances = await send('Runtime.queryObjects', {
      prototypeObjectId: audioPrototype.result.result.objectId,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88,
    });
    const songAudio = async (seek = null) => {
      const reply = await send('Runtime.callFunctionOn', {
        objectId: audioInstances.result.objects.objectId,
        functionDeclaration: `function(seek) {
          const song = this.find((audio) => audio.currentSrc.includes('Rina%20-%20Si%20Me%20Miras.mp3'));
          if (!song) return null;
          if (seek !== null) song.currentTime = seek;
          return { time: song.currentTime, duration: song.duration,
            paused: song.paused, ready: song.readyState, volume: song.volume };
        }`,
        arguments: [{ value: seek }],
        returnByValue: true,
      });
      if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails));
      return reply.result?.result?.value;
    };
    let audio;
    for (let i = 0; i < 80; i++) {
      audio = await songAudio();
      if (audio?.ready >= 2 && !audio.paused && audio.time > 0) break;
      await delay(250);
    }
    assert.ok(audio?.duration > 230 && audio.duration < 240 &&
      audio.ready >= 2 && !audio.paused && audio.time > 0,
      `Rina song did not play: ${JSON.stringify(audio)}; ${errors.join(' | ')}`);
    const inspectLiveScreens = () => evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
        .find((item) => item.metadata?.rinaLevel);
      const feed = scene.textures.find((texture) => texture.name === 'rinaSingerLiveFeed');
      const left = scene.getMeshByName('rinaStageSingerScreen_-1');
      const right = scene.getMeshByName('rinaStageSingerScreen_1');
      const pixels = await feed?.readPixels();
      let bright = 0;
      for (let index = 0; pixels && index < pixels.length; index += 16) {
        const intensity = pixels[index] + pixels[index + 1] + pixels[index + 2];
        if (intensity > 45) bright++;
      }
      return {
        left: !!left,
        right: !!right,
        shared: left?.material?.emissiveTexture === feed &&
          right?.material?.emissiveTexture === feed,
        camera: feed?.activeCamera?.name,
        playerCamera: scene.activeCamera?.name,
        renderCount: feed?.renderList?.length,
        size: feed?.getSize(),
        bright,
      };
    })()`, true);
    let liveScreens;
    for (let attempt = 0; attempt < 40; attempt++) {
      liveScreens = await inspectLiveScreens();
      if (liveScreens?.bright > 50) break;
      await delay(250);
    }
    assert.ok(liveScreens.left && liveScreens.right && liveScreens.shared &&
      liveScreens.camera === 'rinaSingerScreenCamera' &&
      liveScreens.playerCamera !== liveScreens.camera &&
      liveScreens.renderCount > 0 &&
      liveScreens.size.width >= 512 && liveScreens.bright > 50,
      `Rina live side screens did not render the singer: ${JSON.stringify(liveScreens)}`);
    const stageLights = () => evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
        .find((item) => item.metadata?.rinaLevel);
      const mouth = scene.meshes.flatMap((mesh) => {
        const manager = mesh.morphTargetManager;
        return manager ? Array.from({ length: manager.numTargets }, (_, index) =>
          manager.getTarget(index)) : [];
      }).find((target) => target.name === 'Mouth_Open');
      const pyroMeshes = scene.meshes.filter((mesh) =>
        mesh.name.startsWith('pyroFlameV3_') ||
        mesh.name.startsWith('pyroAfterCloudV3_'));
      const activeClouds = pyroMeshes.filter((mesh) =>
        mesh.name.startsWith('pyroAfterCloudV3_') && mesh.isEnabled());
      const shaderStatus = pyroMeshes.map((mesh) => ({
        name: mesh.name,
        ready: mesh.material?.isReadyForSubMesh(mesh, mesh.subMeshes[0]),
        error: mesh.subMeshes[0]?.effect?.getCompilationError(),
      }));
      return {
        screen: scene.getMaterialByName('rinaStagePinkScreen')?.emissiveColor.r,
        flames: pyroMeshes.filter((mesh) =>
          mesh.name.startsWith('pyroFlameV3_') && mesh.isEnabled()).length,
        clouds: activeClouds.length,
        cloudAboveStage: activeClouds.every((mesh) =>
          mesh.position.y > scene.getMeshByName('rinaMainStage')
            .getBoundingInfo().boundingBox.maximumWorld.y + 2),
        shaderReady: shaderStatus.length > 0 && shaderStatus.every((status) =>
          status.ready && !status.error),
        shaderStatus,
        legacyFlames: scene.meshes.filter((mesh) =>
          mesh.name.startsWith('rinaPyroJet_') ||
          mesh.name.startsWith('pyroJet_') ||
          mesh.name.startsWith('pyroHead_')).length,
        stageTop: scene.getMeshByName('rinaMainStage')?.getBoundingInfo().boundingBox.maximumWorld.y,
        catwalkTop: scene.getMeshByName('rinaStageCatwalk')?.getBoundingInfo().boundingBox.maximumWorld.y,
        rinaZ: scene.getTransformNodeByName('enemy:rina-stage:root')?.position.z,
        walkLower: scene.animationGroups.find((group) =>
          group.name === 'rina_locomotion_walk_lower')?.isPlaying,
        singUpper: scene.animationGroups.find((group) =>
          group.name === 'rina_emote_sing_upper')?.isPlaying,
        fullSing: scene.animationGroups.some((group) =>
          group.name.includes('rina_emote_sing') &&
          group.name !== 'rina_emote_sing_upper' && group.isPlaying),
        mouthOpen: mouth?.influence,
        wash: scene.getLightByName('rinaStageWash')?.intensity,
        spill: scene.getLightByName('rinaAudienceSpill')?.intensity,
        spot: scene.getLightByName('rinaMovingSpot_0')?.intensity,
        actorBounce: scene.getLightByName('rinaActorBounce')?.intensity,
        actorRim: scene.getLightByName('rinaActorStageRim')?.intensity,
        actorKeyDirectionZ: scene.getLightByName('rinaActorBounce')?.direction.z,
        actorRimDirectionZ: scene.getLightByName('rinaActorStageRim')?.direction.z,
        screenLightLeft: scene.getLightByName('rinaScreenLight_-1')?.intensity,
        screenLight: scene.getLightByName('rinaScreenLight_1')?.intensity,
        singerLight: scene.getLightByName('rinaRinaKeyLight')?.intensity,
        pyroLight: scene.getLightByName('rinaPyroLightLeft')?.intensity,
        pyroLightEnabled: scene.getLightByName('rinaPyroLightLeft')?.isEnabled(),
        singerLightZ: scene.getLightByName('rinaRinaKeyLight')?.position.z,
        singerLightMeshes: scene.getLightByName('rinaRinaKeyLight')?.includedOnlyMeshes.length,
        screenCameraZ: scene.getCameraByName('rinaSingerScreenCamera')?.position.z,
        cameraRoll: scene.activeCamera?.rotation.z,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      };
    })()`, true);
    const screenSamples = [];
    for (let i = 0; i < 10; i++) {
      screenSamples.push((await stageLights()).screen);
      await delay(180);
    }
    assert.ok(Math.max(...screenSamples) - Math.min(...screenSamples) > 0.015,
      `Rina screens did not react to the song: ${JSON.stringify(screenSamples)}`);
    assert.equal((await stageLights()).flames, 0,
      'Rina fire activated before the chorus');
    const startState = await stageLights();
    assert.ok(Math.abs(startState.stageTop - startState.catwalkTop) < 0.01,
      `Rina catwalk is not level with the stage: ${JSON.stringify(startState)}`);
    await songAudio(50);
    await delay(220);
    const walking = await stageLights();
    assert.ok(walking.rinaZ < startState.rinaZ - 1 &&
      walking.rinaZ > 19 * concert.scale &&
      walking.screenCameraZ < startState.screenCameraZ - 1 &&
      walking.walkLower && walking.singUpper && !walking.fullSing,
      `Rina did not walk and sing toward the catwalk: ${JSON.stringify(walking)}`);
    await delay(700);
    const farther = await stageLights();
    assert.ok(farther.rinaZ < walking.rinaZ - 0.2,
      `Rina did not keep moving toward the audience: ${JSON.stringify({ walking, farther })}`);
    await songAudio(55.1);
    await delay(280);
    const chorus = await stageLights();
    assert.ok(chorus.actorKeyDirectionZ > 0 && chorus.actorRimDirectionZ < 0,
      `Rina actor lights do not illuminate from opposite sides: ${JSON.stringify(chorus)}`);
    assert.ok(chorus.flames > 0 && chorus.clouds === 0 &&
      chorus.pyroLightEnabled && chorus.pyroLight > 8 &&
      chorus.shaderReady && chorus.legacyFlames === 0 &&
      Math.abs(chorus.rinaZ - 19 * concert.scale) < 0.1 &&
      Math.abs(chorus.singerLightZ - 16) < 0.1 &&
      chorus.singerLightMeshes > 0 &&
      chorus.fullSing && !chorus.walkLower && !chorus.singUpper &&
      chorus.mouthOpen > 0.01,
      `Rina chorus did not start at the catwalk with singing face and fire: ${JSON.stringify(chorus)}; ${errors.join(' | ')}`);
    const rollSamples = [];
    for (let sample = 0; sample < 14; sample++) {
      rollSamples.push(Math.abs((await stageLights()).cameraRoll));
      await delay(90);
    }
    if (!chorus.reducedMotion) {
      assert.ok(Math.max(...rollSamples) > 0.00008,
        `Rina beat did not add subtle camera motion: ${JSON.stringify(rollSamples)}`);
    }
    const sustained = await stageLights();
    assert.ok(sustained.flames > 0 && sustained.clouds === 0 &&
      sustained.pyroLightEnabled && sustained.pyroLight > 8,
      `Rina fire or local light faded before the sustained burn ended: ${JSON.stringify(sustained)}`);
    let afterglow = sustained;
    for (let sample = 0; sample < 20 &&
      (afterglow.flames > 0 || afterglow.clouds === 0 ||
        afterglow.pyroLightEnabled); sample++) {
      await delay(100);
      afterglow = await stageLights();
    }
    assert.ok(afterglow.flames === 0 && afterglow.clouds > 0 &&
      afterglow.cloudAboveStage && afterglow.shaderReady &&
      !afterglow.pyroLightEnabled && afterglow.pyroLight < 0.03,
      `Rina fire did not become clouds above the stage: ${JSON.stringify(afterglow)}; ${errors.join(' | ')}`);
    await songAudio(77);
    await delay(360);
    const returning = await stageLights();
    assert.ok(returning.flames === 0 && returning.clouds > 0 &&
      returning.walkLower && returning.singUpper &&
      returning.rinaZ > chorus.rinaZ && returning.rinaZ < startState.rinaZ,
      `Rina did not return after the first chorus: ${JSON.stringify(returning)}`);
    await songAudio(132.1);
    const extendedSamples = [];
    for (let sample = 0; sample < 45; sample++) {
      extendedSamples.push(await stageLights());
      await delay(60);
    }
    if (!chorus.reducedMotion) {
      const wash = extendedSamples.map((state) => state.wash);
      const floor = Math.min(...wash);
      const peak = Math.max(...wash);
      const threshold = floor + (peak - floor) * 0.55;
      const litIntervals = wash.filter((value, index) =>
        value >= threshold && (index === 0 || wash[index - 1] < threshold)).length;
      assert.ok(peak - floor > 22 && litIntervals >= 3,
        `Rina extended chorus lacked distinct light pulses: ${JSON.stringify({ wash, litIntervals })}`);
      await songAudio(150.6);
      await delay(200);
      const briefCut = await stageLights();
      assert.ok(briefCut.wash < peak - 15,
        `Rina extended chorus did not leave a dark interval at the break: ${JSON.stringify({ peak, briefCut })}`);
    }
    await songAudio(180.2);
    for (let sample = 0; sample < 35 && (await stageLights()).flames > 0; sample++) {
      await delay(100);
    }
    await songAudio(202.2);
    await delay(250);
    const finaleEntrance = await stageLights();
    assert.equal(finaleEntrance.flames, 0,
      `Rina final chorus fire started before the 3:22 lighting entrance: ${JSON.stringify(finaleEntrance)}`);
    await songAudio(204.1);
    const finaleSamples = [];
    for (let sample = 0; sample < 40; sample++) {
      finaleSamples.push(await stageLights());
      await delay(80);
    }
    assert.ok(finaleSamples.some((state) => state.flames > 0),
      `Rina final chorus did not trigger pyro: ${JSON.stringify(finaleSamples.slice(0, 3))}`);
    if (!chorus.reducedMotion) {
      const screenPeaks = finaleSamples.map((state) => state.screenLight);
      const washPeaks = finaleSamples.map((state) => state.wash);
      assert.ok(Math.max(...screenPeaks) > chorus.screenLight + 14 &&
        Math.max(...screenPeaks) > Math.min(...screenPeaks) + 12 &&
        Math.max(...washPeaks) > chorus.wash + 25,
        `Rina finale lights did not strobe above the earlier chorus: ${JSON.stringify({ chorus, screenPeaks, washPeaks })}`);
      assert.ok(finaleSamples.some((state) =>
        state.screenLightLeft > state.screenLight + 6) &&
        finaleSamples.some((state) =>
          state.screenLight > state.screenLightLeft + 6),
      `Rina finale lights did not alternate sides: ${JSON.stringify(finaleSamples.map((state) => [state.screenLightLeft, state.screenLight]))}`);
    }
    await songAudio(1);
    await delay(1100);
    const quiet = await stageLights();
    await send('Runtime.callFunctionOn', {
      objectId: audioInstances.result.objects.objectId,
      functionDeclaration: `function() {
        this.find((audio) => audio.currentSrc.includes('Rina%20-%20Si%20Me%20Miras.mp3'))?.pause();
      }`,
    });
    await delay(1200);
    const paused = await stageLights();
    assert.ok(quiet.wash > paused.wash * 2 &&
      quiet.spill > paused.spill * 2 &&
      quiet.screen > paused.screen * 2 &&
      quiet.spot > paused.spot * 2 &&
      quiet.screenLight > paused.screenLight * 2 &&
      quiet.singerLight > paused.singerLight * 2 &&
      quiet.actorBounce > paused.actorBounce * 2 &&
      quiet.actorRim > paused.actorRim * 2,
      `Rina stage lights did not fade during an audio pause: ${JSON.stringify({ quiet, paused })}`);
    assert.ok(Math.abs(paused.cameraRoll) < 0.00001,
      `Rina camera kept shaking after the song paused: ${paused.cameraRoll}`);
    await send('Runtime.callFunctionOn', {
      objectId: audioInstances.result.objects.objectId,
      functionDeclaration: `async function() {
        await this.find((audio) => audio.currentSrc.includes('Rina%20-%20Si%20Me%20Miras.mp3'))?.play();
      }`,
      awaitPromise: true,
    });
    console.log(`Rina song ${audio.duration.toFixed(2)} s; catwalk, mixed animation, singing face and rhythmic lights passed`);
    if (process.argv[3]?.endsWith('.png')) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      await songAudio(55.1);
      await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
          .find((item) => item.metadata?.rinaLevel);
        const scale = scene.metadata.rinaLevel.stadiumScale;
        const maze = scene.metadata.rinaLevel.crowdSystem === 'field-maze';
        scene.getTransformNodeByName('playerRoot').position.set(
          (maze ? 6 : 8) * scale, 1.7, (maze ? -8 : -20) * scale);
      })()`, true);
      await delay(700);
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(process.argv[3], Buffer.from(screenshot.result.data, 'base64'));
    }
    }
    await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
        .find((item) => item.metadata?.rinaLevel);
      await scene.whenReadyAsync();
      return true;
    })()`, true);
    await delay(1500);
    await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
        .find((item) => item.metadata?.rinaLevel);
      scene.getTransformNodeByName('playerRoot').position.set(0, 1.7,
        -54 * scene.metadata.rinaLevel.stadiumScale);
    })()`, true);
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true })); true");
    await delay(150);
    await evaluate("window.dispatchEvent(new KeyboardEvent('keyup', { key: 'e', code: 'KeyE', bubbles: true })); true");
    let returned;
    for (let i = 0; i < 240; i++) {
      returned = await evaluate(`(async () => {
        const storeUrl = performance.getEntriesByType('resource')
          .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
        const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
        const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
          .find((item) => item.metadata?.sanctuary);
        return { level: globalThis.__bosqueLevelDebug?.current(),
          player: scene?.getTransformNodeByName('playerRoot')?.position.asArray(),
          boat: scene?.getTransformNodeByName('sanctuaryBoat')?.position.asArray() };
      })()`, true);
      if (returned.level === 'sanctuary' && returned.player) break;
      await delay(250);
    }
    assert.equal(returned?.level, 'sanctuary',
      `Rina exit did not return to Sanctuary: ${JSON.stringify(returned)}; ${errors.join(' | ')}`);
    assert.ok(Math.abs(returned.player[0] - 114) < 2 &&
      Math.abs(returned.player[2] - 145) < 2,
      `Rina return did not land at her Sanctuary stop: ${JSON.stringify(returned)}`);
    assert.ok(Math.abs(returned.boat?.[0] - 74) < 2 &&
      Math.abs(returned.boat?.[2] - 155) < 2,
      `Rina return did not place the raft at her dock: ${JSON.stringify(returned)}`);
    await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
        .find((item) => item.metadata?.sanctuary);
      await scene.whenReadyAsync();
      return true;
    })()`, true);
    await delay(1500);
    await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find((entry) => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const scene = EngineStore.Instances.flatMap((engine) => engine.scenes)
        .find((item) => item.metadata?.sanctuary);
      scene.getTransformNodeByName('playerRoot').position.set(132, 3.75, 163);
    })()`, true);
    await delay(250);
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true })); true");
    await delay(150);
    await evaluate("window.dispatchEvent(new KeyboardEvent('keyup', { key: 'e', code: 'KeyE', bubbles: true })); true");
    let reentered;
    for (let i = 0; i < 240; i++) {
      reentered = await evaluate("globalThis.__bosqueLevelDebug?.current()");
      if (reentered === 'rina') break;
      await delay(250);
    }
    assert.equal(reentered, 'rina',
      `Rina portal did not reopen the stadium: ${reentered}; ${errors.join(' | ')}`);
    await delay(500);
    if (fieldMaze) {
      let afterReentry;
      for (let attempt = 0; attempt < 60; attempt++) {
        afterReentry = await evaluate(`(async () => {
          const storeUrl = performance.getEntriesByType('resource')
            .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
          const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
          const scenes = EngineStore.Instances.flatMap(engine => engine.scenes)
            .filter(item => item.metadata?.rinaLevel);
          const scene = scenes[0];
          const fieldMeshes = scene?.meshes.filter(mesh => mesh.name.startsWith('rinaCrowd_fan_') &&
            mesh.getTotalVertices() > 0 && mesh.thinInstanceCount > 0 && (() => { let parent = mesh.parent;
              while (parent) { if (parent.name === 'rinaFieldCrowdMazeRoot') return true;
                parent = parent.parent; } return false; })()) ?? [];
          const staticMeshes = scene?.meshes.filter(mesh =>
            mesh.name.startsWith('rinaMazeRealStatic_')) ?? [];
          return { scenes: scenes.length,
            parent: scene?.getTransformNodeByName('rinaFieldCrowdMazeRoot')?.parent?.name,
            rigs: fieldMeshes.length,
            instances: fieldMeshes.reduce((sum, mesh) => sum + mesh.thinInstanceCount, 0),
            staticVariants: new Set(staticMeshes.map(mesh =>
              mesh.name.split(':')[0])).size,
            staticFans: staticMeshes.reduce((sum, mesh) => sum + mesh.thinInstanceCount, 0) };
        })()`, true);
        if (afterReentry.rigs === (process.env.RINA_MOBILE_VERIFY ? 0 : 5) &&
            afterReentry.parent === 'rinaStadiumRoot' &&
            afterReentry.staticVariants === 10 &&
            afterReentry.staticFans >= (process.env.RINA_MOBILE_VERIFY ? 270 : 990) &&
            afterReentry.staticFans <= (process.env.RINA_MOBILE_VERIFY ? 300 : 1100)) break;
        await delay(250);
      }
      assert.ok(afterReentry.scenes === 1 && afterReentry.parent === 'rinaStadiumRoot' &&
        afterReentry.rigs === (process.env.RINA_MOBILE_VERIFY ? 0 : 5) &&
        afterReentry.instances === (process.env.RINA_MOBILE_VERIFY ? 0 : 38) &&
        afterReentry.staticVariants === 10 &&
        afterReentry.staticFans >= (process.env.RINA_MOBILE_VERIFY ? 270 : 990) &&
        afterReentry.staticFans <= (process.env.RINA_MOBILE_VERIFY ? 300 : 1100),
      `Rina field crowd did not cleanly reload: ${JSON.stringify(afterReentry)}`);
      console.log(`Rina field crowd after reentry: ${JSON.stringify(afterReentry)}`);
    }
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
  console.log(`${level}: loaded; SpotLight and ParticleSystem are constructors${level === 'rina' ? '; Sanctuary round trip passed' : ''}`);
  if (errors.length) console.warn(`${level}: ${errors.length} browser error(s):\n${errors.slice(-3).join("\n")}`);
} finally {
  socket?.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
