import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const level = process.argv[2];
assert.ok(["forest", "theatre", "sanctuary"].includes(level),
  "Usage: node scripts/verify-level-load-browser.mjs <forest|theatre|sanctuary>");
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
  if (process.env.PORTAL_CAPTURE && level === "sanctuary") {
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
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true })); document.getElementById('startCharacterButton')?.click(); true");
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
  const constructors = await evaluate(`(async () => ({
    spot: typeof (await import('/node_modules/@babylonjs/core/Lights/spotLight.js')).SpotLight,
    particles: typeof (await import('/node_modules/@babylonjs/core/Particles/particleSystem.js')).ParticleSystem,
  }))()`, true);
  assert.equal(constructors.spot, "function");
  assert.equal(constructors.particles, "function");
  assert.ok(!errors.some((error) => /(?:SpotLight|ParticleSystem) is not a constructor/.test(error)),
    `Babylon constructor error in ${level}: ${errors.join(" | ")}`);
  console.log(`${level}: loaded; SpotLight and ParticleSystem are constructors`);
  if (errors.length) console.warn(`${level}: ${errors.length} browser error(s):\n${errors.slice(-3).join("\n")}`);
} finally {
  socket?.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
