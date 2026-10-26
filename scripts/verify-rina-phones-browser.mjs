import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const mobile = process.argv.includes("mobile");
const allPhones = process.argv.includes("all");
const browserPath = [process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"]
  .filter(Boolean);
let executable;
for (const path of browserPath) {
  try { await access(path); executable = path; break; } catch { /* next */ }
}
assert.ok(executable, "Chrome or Edge is required");
const profile = await mkdtemp(join(tmpdir(), "bosque-rina-phones-"));
const port = 9500 + Math.floor(Math.random() * 400);
const browser = spawn(executable, ["--headless=new", "--no-first-run",
  "--no-sandbox", "--enable-unsafe-swiftshader",
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(profile, "chrome")}`,
  "about:blank"], { stdio: "ignore", windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      target = tabs.find(tab => tab.type === "page")?.webSocketDebuggerUrl;
    } catch { /* launching */ }
    if (!target) await delay(100);
  }
  assert.ok(target, "DevTools did not start");
  socket = new WebSocket(target);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let serial = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (!message.id) return;
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message); }
  });
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++serial;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const message = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (message.result?.exceptionDetails)
      throw new Error(message.result.exceptionDetails.exception?.description ?? "Runtime error");
    return message.result?.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", mobile
    ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
    : { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://localhost:5173/?level=rina&rinaPhonesDebug" +
    (process.env.RINA_COLLISION_DEBUG ? "&rinaCollisionDebug=1" : "") });
  let menuReady = false;
  for (let i = 0; i < 240; i++) {
    menuReady = await evaluate("document.documentElement.dataset.bosqueCursorType === 'menu' && document.documentElement.style.getPropertyValue('--bosque-cursor').includes('blob:')");
    if (menuReady) break;
    await delay(250);
  }
  assert.ok(menuReady, `Character selection did not initialize: ${errors.join(" | ")}`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    document.querySelector('.character-card[data-character="lautaro"]')?.click();
    document.getElementById('startCharacterButton')?.click(); true`);
  let loaded = false;
  let state;
  for (let i = 0; i < 240; i++) {
    state = await evaluate(`({ current: globalThis.__bosqueLevelDebug?.current(),
      loading: document.getElementById('loadingText')?.textContent,
      hidden: document.getElementById('loadingScreen')?.classList.contains('hidden') })`);
    loaded = state?.current === "rina" && state.hidden;
    if (loaded) break;
    if (state?.loading?.startsWith("No se pudo iniciar")) break;
    await delay(500);
  }
  assert.ok(loaded, `Rina did not load: ${JSON.stringify(state)}; ${errors.join(" | ")}`);
  await delay(1800);
  const inspect = `async () => {
    const storeUrl = performance.getEntriesByType('resource')
      .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const { Vector3 } = await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
    const scene = EngineStore.LastCreatedScene;
    const phones = scene.metadata?.rinaPhones?.phones;
    const feed = phones?.feed;
    const islandBodies = scene.meshes.filter(m => m.name.startsWith('rinaIslandPhoneBody_'));
    const islandScreens = scene.meshes.filter(m => m.name.startsWith('rinaIslandPhoneScreen_'));
    const pixels = feed ? await Promise.resolve(feed.readPixels()) : null;
    const bytes = pixels ? new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) : [];
    let lit = 0;
    let maxRgb = 0;
    for (let i = 0; i < bytes.length; i += 4) if (bytes[i] + bytes[i+1] + bytes[i+2] > 24) lit++;
    for (let i = 0; i < bytes.length; i += 4) maxRgb = Math.max(maxRgb, bytes[i], bytes[i+1], bytes[i+2]);
    const phoneSizes = (phones?.ids ?? []).map(id => {
      const wrapper = scene.getTransformNodeByName('theatrePhone_' + id);
      const anchor = scene.getTransformNodeByName('rinaPhoneHand_' + id);
      const body = wrapper?.getChildMeshes(false).find(m => m.name.includes('SmartPhone_Body'));
      const display = wrapper?.getChildMeshes(false).find(m => m.name.includes('RinaPhone_DisplayOverlay'));
      const bounds = body?.getBoundingInfo().boundingBox;
      const center = bounds && body ? Vector3.TransformCoordinates(bounds.center,
        body.computeWorldMatrix(true)) : null;
      const hand = anchor?.getAbsolutePosition();
      const fanId = id.slice(0, id.lastIndexOf('-'));
      const index = Number(id.slice(id.lastIndexOf('-') + 1));
      const groupIndex = ${mobile ? 0 : 1} + Math.floor(index / ${mobile ? 3 : 5});
      const fanMesh = scene.getMeshByName('rinaCrowd_' + fanId + ':field-lod1:group_' + groupIndex);
      const handBone = fanMesh?.skeleton?.bones.find(b => b.name.endsWith('RightHand'));
      const middleBone = fanMesh?.skeleton?.bones.find(b => b.name.endsWith('RightHandMiddle1'));
      const leftBone = fanMesh?.skeleton?.bones.find(b => b.name.endsWith('LeftHand'));
      const headBone = fanMesh?.skeleton?.bones.find(b => b.name.endsWith('Head'));
      const shoulderBone = fanMesh?.skeleton?.bones.find(b => b.name.endsWith('RightArm'));
      const wrist = handBone?.getAbsolutePosition(fanMesh);
      const middle = middleBone?.getAbsolutePosition(fanMesh);
      const left = leftBone?.getAbsolutePosition(fanMesh);
      const head = headBone?.getAbsolutePosition(fanMesh);
      const shoulder = shoulderBone?.getAbsolutePosition(fanMesh);
      const palm = wrist && middle ? [
        wrist.x + (middle.x - wrist.x) * 0.55,
        wrist.y + (middle.y - wrist.y) * 0.55,
        wrist.z + (middle.z - wrist.z) * 0.55,
      ] : null;
      const matrix = display?.getWorldMatrix().m;
      const normal = matrix ? [matrix[4], matrix[5], matrix[6]] : null;
      const normalLength = normal ? Math.hypot(...normal) : 1;
      const normals = display?.getVerticesData('normal');
      const actualNormal = normals && display ? Vector3.TransformNormal(
        new Vector3(normals[0], normals[1], normals[2]),
        display.getWorldMatrix()).normalize().asArray() : null;
      const singer = scene.getMeshByName('rinaMainStage')?.getAbsolutePosition();
      const toStage = singer && center ? [singer.x-center.x, singer.y-center.y,
        singer.z-center.z] : null;
      const stageLength = toStage ? Math.hypot(...toStage) : 1;
      return { id, height: bounds ? bounds.maximumWorld.y-bounds.minimumWorld.y : null,
        length: bounds ? Math.max(
          bounds.maximumWorld.x-bounds.minimumWorld.x,
          bounds.maximumWorld.y-bounds.minimumWorld.y,
          bounds.maximumWorld.z-bounds.minimumWorld.z) : null,
        visible: wrapper?.isEnabled() ?? false,
        hand: hand?.asArray(),
        center: center?.asArray(), palm, head: head?.asArray(),
        shoulder: shoulder?.asArray(), middle: middle?.asArray(),
        fanHeight: fanMesh ? fanMesh.getBoundingInfo().boundingBox.maximumWorld.y -
          fanMesh.getBoundingInfo().boundingBox.minimumWorld.y : null,
        handDistance: hand && center ? Math.hypot(center.x-hand.x, center.y-hand.y,
          center.z-hand.z) : null,
        wristDistance: wrist && center ? Math.hypot(center.x-wrist.x,
          center.y-wrist.y, center.z-wrist.z) : null,
        palmDistance: palm && center ? Math.hypot(center.x-palm[0],
          center.y-palm[1], center.z-palm[2]) : null,
        leftHandDistance: left && center ? Vector3.Distance(left, center) : null,
        aboveHead: head && center ? center.y-head.y : null,
        inFrontOfHead: head && center && singer ?
          ((center.x-head.x)*(singer.x-head.x) +
            (center.z-head.z)*(singer.z-head.z)) /
          Math.max(0.001, Math.hypot(singer.x-head.x, singer.z-head.z)) : null,
        screenFacesFan: normal && toStage ?
          -(normal[0]*toStage[0]+normal[1]*toStage[1]+normal[2]*toStage[2]) /
            normalLength / stageLength : null,
        actualScreenFacesFan: actualNormal && toStage ?
          -Vector3.Dot(new Vector3(...actualNormal),
            new Vector3(...toStage).normalize()) : null,
        actualNormal, localNormal: normals ? Array.from(normals.slice(0, 3)) : null };
    });
    return { count: phones?.count ?? -1, ids: phones?.ids ?? [],
      targets: scene.customRenderTargets.filter(t => t.name === 'theatrePhoneSharedStageFeed').length,
      feedMeshes: feed?.renderList?.map(m => m.name) ?? [],
      phoneMeshes: scene.meshes.filter(m => m.name.includes('theatrePhone_')).length,
      flashes: scene.lights.filter(l => l.name === 'theatrePhonePooledFlash').length,
      litPixels: lit, pixelCount: bytes.length / 4,
      maxRgb, firstPixel: Array.from(bytes.slice(0, 12)),
      frameId: scene.getFrameId(), feedReady: feed?.isReady(),
      refresh: feed?.refreshRate,
      islandPhones: islandBodies.reduce((sum, mesh) => sum + mesh.thinInstanceCount, 0),
      islandBatches: islandBodies.length,
      islandSample: islandBodies[0]?.thinInstanceGetWorldMatrices()
        .slice(0, 2).map(matrix => [matrix.m[12], matrix.m[13], matrix.m[14]]),
      islandScreensShareFeed: islandScreens.length === islandBodies.length &&
        islandScreens.every(mesh => mesh.material?.emissiveTexture === feed &&
          mesh.thinInstanceCount > 0),
      camera: feed?.activeCamera?.position.asArray(),
      stage: scene.getMeshByName('rinaMainStage')?.getAbsolutePosition().asArray(),
      phoneSizes,
      panel: !!document.getElementById('rinaPhonesDebug'),
      liveScenes: globalThis.__bosqueLevelDebug.snapshot().liveScenes };
  }`;
  let before;
  for (let i = 0; i < 24; i++) {
    before = await evaluate(`(${inspect})()`);
    if (before?.litPixels > before.pixelCount * 0.005) break;
    await delay(500);
  }
  console.log(`${mobile ? "mobile" : "desktop"} phones: ${before.count}, ` +
    `${before.targets} feed, ${before.litPixels} lit pixels, ` +
    `heights ${before.phoneSizes.map(p => p.height.toFixed(3)).join(", ")} m`);
  if (process.env.RINA_COLLISION_DEBUG) {
    const traces = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ??
        '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const { createRinaFieldCrowdMazeLayout } = await import(
        '/src/game/levels/rina/RinaFieldCrowdMazeLayout.ts');
      const scene = EngineStore.LastCreatedScene;
      const layout = createRinaFieldCrowdMazeLayout();
      const crowd = scene.getMeshByName('rinaCollisionCrowdTrace');
      const stadium = scene.getMeshByName('rinaCollisionStadiumTrace');
      const root = scene.getTransformNodeByName('rinaCollisionDebugRoot');
      return { panel: !!document.getElementById('rinaCollisionDebug'),
        crowdVertices: crowd?.getTotalVertices(),
        stadiumVertices: stadium?.getTotalVertices(),
        parent: root?.parent?.name, enabled: root?.isEnabled(),
        westTurnMargin: layout.marginToCrowd(-11.8, -12),
        eastTurnMargin: layout.marginToCrowd(8.1, -10.1),
        narrowLaneOpen: !layout.blocksPlayerLocal(-12.08, -21, 0.48),
        narrowLaneSideBlocked: layout.blocksPlayerLocal(-10.5, -21, 0.48),
        westCornerClear: !layout.blocksPlayerLocal(-13.9, -12.55, 0.48),
        eastCornerClear: !layout.blocksPlayerLocal(8.55, -10.9, 0.48),
        westClusterBlocked: layout.blocksPlayerLocal(-17, -15, 0.48),
        eastClusterBlocked: layout.blocksPlayerLocal(14, -10, 0.48),
        westScreenshotBlocked: scene.metadata.playerWorld.isColliding(-12.2 * 1.5, -13 * 1.5),
        eastScreenshotBlocked: scene.metadata.playerWorld.isColliding(8.1 * 1.5, -10.3 * 1.5),
        westTurnBlocked: scene.metadata.playerWorld.isColliding(-11.8 * 1.5, -12 * 1.5),
        eastTurnBlocked: scene.metadata.playerWorld.isColliding(8.1 * 1.5, -10.1 * 1.5) };
    })()`);
    assert.ok(traces.panel && traces.crowdVertices > 100 &&
      traces.stadiumVertices > 20 && traces.parent === 'rinaStadiumRoot' &&
      traces.enabled && traces.westTurnMargin < -0.32 &&
      traces.eastTurnMargin < -0.32 &&
      traces.narrowLaneOpen && traces.narrowLaneSideBlocked &&
      traces.westCornerClear && traces.eastCornerClear &&
      traces.westClusterBlocked && traces.eastClusterBlocked &&
      !traces.westScreenshotBlocked && !traces.eastScreenshotBlocked &&
      !traces.westTurnBlocked && !traces.eastTurnBlocked,
    `Rina collision traces or turn clearance missing: ${JSON.stringify(traces)}`);
    console.log('collision traces', traces);
    if (process.env.RINA_COLLISION_CAPTURE) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(process.env.RINA_COLLISION_CAPTURE,
        Buffer.from(shot.result.data, 'base64'));
    }
    await evaluate(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'F8', code: 'F8', bubbles: true }));
      return true;
    })()`);
    assert.equal(await evaluate(`document.getElementById('rinaCollisionDebug')?.style.display === 'none'`), true);
    await evaluate(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'F8', code: 'F8', bubbles: true }));
      return true;
    })()`);
  }
  assert.ok(before.count >= (mobile ? 3 : 8), "Too few real phone holders");
  assert.equal(before.targets, 1);
  assert.equal(before.flashes, 1);
  assert.ok(before.phoneMeshes > 0 && before.panel);
  assert.ok(before.phoneSizes.every(p => p.length >= 0.18 && p.length <= 0.29 &&
    p.fanHeight >= 2.3 && p.fanHeight <= 3 &&
    p.hand[1] >= 0.8 && p.hand[1] <= 3.1),
  `Phone scale, grip, or orientation is wrong: ${JSON.stringify(before.phoneSizes)}`);
  assert.ok(before.feedMeshes.some(name => name.includes("rina")));
  assert.ok(before.feedMeshes.every(name => !name.includes("Phone")));
  assert.ok(before.litPixels > before.pixelCount * 0.005, "Stage feed stayed black");
  assert.ok(before.islandPhones >= (mobile ? 80 : 200) &&
    before.islandBatches >= 4 && before.islandScreensShareFeed,
  `Internal-island recording phones are missing: ${JSON.stringify(before)}`);
  console.log(`island recording phones: ${before.islandPhones} in ${before.islandBatches} batches, shared stage feed`);
  assert.equal(before.liveScenes, 1);
  if (process.env.RINA_PHONES_FEED_CAPTURE) {
    console.log('feed framing', { camera: before.camera, stage: before.stage,
      islandSample: before.islandSample,
      meshes: before.feedMeshes });
    const capture = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ??
        '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const feed = EngineStore.LastCreatedScene.metadata.rinaPhones.phones.feed;
      const pixels = await Promise.resolve(feed.readPixels());
      return { size: feed.getSize(), bytes: Array.from(new Uint8Array(pixels.buffer,
        pixels.byteOffset, pixels.byteLength)) };
    })()`);
    await sharp(Buffer.from(capture.bytes), { raw: { width: capture.size.width,
      height: capture.size.height, channels: 4 } }).flip().png()
      .toFile(process.env.RINA_PHONES_FEED_CAPTURE);
  }
  if (process.env.RINA_ISLAND_CAPTURE) {
    const focus = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ??
        '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const { FreeCamera } = await import('/node_modules/@babylonjs/core/Cameras/freeCamera.js');
      const { Vector3 } = await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
      const { Color3 } = await import('/node_modules/@babylonjs/core/Maths/math.color.js');
      const { HemisphericLight } = await import('/node_modules/@babylonjs/core/Lights/hemisphericLight.js');
      const scene = EngineStore.LastCreatedScene;
      const mesh = scene.meshes.find(item => item.name.startsWith('rinaIslandPhoneBody_') &&
        item.name.includes(${JSON.stringify(process.env.RINA_ISLAND_VARIANT ?? '')}));
      const screen = scene.getMeshByName(mesh.name.replace('PhoneBody_', 'PhoneScreen_'));
      const fan = scene.getMeshByName(mesh.name.replace(/^rinaIslandPhoneBody_fan_[0-9]+_/,
        'rinaMazeRealStatic_') + ':field');
      const qaLayer = 0x10000000;
      const originalLayers = [fan.layerMask, mesh.layerMask, screen.layerMask];
      for (const item of [fan, mesh, screen]) item.layerMask |= qaLayer;
      const clearColor = scene.clearColor.clone();
      scene.clearColor.set(0.20, 0.20, 0.20, 1);
      const vertices = mesh.getVerticesData('position');
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < vertices.length; i += 3) {
        minX = Math.min(minX, vertices[i]); maxX = Math.max(maxX, vertices[i]);
        minY = Math.min(minY, vertices[i+1]); maxY = Math.max(maxY, vertices[i+1]);
        minZ = Math.min(minZ, vertices[i+2]); maxZ = Math.max(maxZ, vertices[i+2]);
      }
      const matrix = mesh.thinInstanceGetWorldMatrices()[0].multiply(mesh.getWorldMatrix());
      const center = Vector3.TransformCoordinates(new Vector3((minX+maxX)/2,
        (minY+maxY)/2, (minZ+maxZ)/2), matrix);
      const facing = Vector3.TransformNormal(new Vector3(0, 0, -1), matrix).normalize();
      const right = Vector3.TransformNormal(new Vector3(1, 0, 0), matrix).normalize();
      const phoneFoot = Vector3.TransformCoordinates(Vector3.Zero(), matrix);
      let closest = -1, closestDistance = Infinity;
      for (let i = 0; i < fan.thinInstanceCount; i++) {
        const point = Vector3.TransformCoordinates(Vector3.Zero(),
          fan.thinInstanceGetWorldMatrices()[i].multiply(fan.getWorldMatrix()));
        const distance = Vector3.DistanceSquared(point, phoneFoot);
        if (distance < closestDistance) { closest = i; closestDistance = distance; }
      }
      const fanData = fan._thinInstanceDataStorage.matrixData;
      const originalMatrix = fanData.slice(0, 16);
      const selectedMatrix = fanData.slice(closest * 16, closest * 16 + 16);
      const originalFanCount = fan.thinInstanceCount;
      const originalPhoneCount = mesh.thinInstanceCount;
      fan.thinInstanceCount = 1;
      mesh.thinInstanceCount = 1;
      screen.thinInstanceCount = 1;
      const pinFan = scene.onBeforeRenderObservable.add(() => {
        fanData.set(selectedMatrix, 0);
        fan.thinInstanceBufferUpdated('matrix');
      });
      const originalEmission = fan.material.emissiveColor?.clone();
      const originalEmissiveTexture = fan.material.emissiveTexture;
      if (originalEmission) {
        fan.material.emissiveTexture = fan.material.albedoTexture;
        fan.material.emissiveColor = new Color3(0.7, 0.7, 0.7);
      }
      const light = new HemisphericLight('rinaIslandPhoneQaLight',
        new Vector3(0, 1, -0.4), scene);
      light.intensity = 0.55;
      light.includedOnlyMeshes = fan ? [fan] : [];
      const camera = new FreeCamera('rinaIslandPhoneQaCamera',
        center.add(facing.scale(1.55)).addInPlaceFromFloats(0, -0.15, 0), scene);
      camera.layerMask = qaLayer;
      camera.fov = 0.65;
      camera.setTarget(center.add(new Vector3(0, -0.18, 0)));
      globalThis.__rinaIslandQaCamera = { camera, previous: scene.activeCamera,
        originalLayers, clearColor, light, fan, fanData, originalMatrix,
        originalFanCount, originalPhoneCount, mesh, screen, pinFan,
        originalEmission, originalEmissiveTexture, center, facing, right };
      scene.activeCamera = camera;
      return { center: center.asArray(), mesh: mesh.name,
        localX: [minX,maxX], localY: [minY,maxY],
        localZ: [minZ,maxZ], fan: fan?.name,
        closest, closestDistance,
        facing: facing.asArray(),
        material: { type: fan.material.getClassName(),
          diffuseTexture: fan.material.diffuseTexture?.name,
          albedoTexture: fan.material.albedoTexture?.name,
          emissiveColor: originalEmission?.asArray() } };
    })()`);
    console.log('island focus', focus);
    await delay(500);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.RINA_ISLAND_CAPTURE,
      Buffer.from(shot.result.data, 'base64'));
    await evaluate(`(() => {
      const qa = globalThis.__rinaIslandQaCamera;
      qa.camera.position.copyFrom(qa.center).addInPlace(qa.right.scale(1.45))
        .addInPlace(qa.facing.scale(0.15));
      qa.camera.setTarget(qa.center.clone().addInPlaceFromFloats(0, -0.15, 0));
      return true;
    })()`);
    await delay(120);
    const sideShot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.RINA_ISLAND_CAPTURE.replace(/\.png$/i, '-side.png'),
      Buffer.from(sideShot.result.data, 'base64'));
    await evaluate(`(() => {
      const qa = globalThis.__rinaIslandQaCamera;
      const scene = qa.camera.getScene();
      scene.activeCamera = qa.previous;
      scene.clearColor = qa.clearColor;
      for (const [i, mesh] of [qa.fan, qa.mesh, qa.screen].entries())
        mesh.layerMask = qa.originalLayers[i];
      scene.onBeforeRenderObservable.remove(qa.pinFan);
      qa.fanData.set(qa.originalMatrix, 0);
      qa.fan.thinInstanceCount = qa.originalFanCount;
      qa.mesh.thinInstanceCount = qa.originalPhoneCount;
      qa.screen.thinInstanceCount = qa.originalPhoneCount;
      qa.fan.thinInstanceBufferUpdated('matrix');
      if (qa.originalEmission) qa.fan.material.emissiveColor = qa.originalEmission;
      qa.fan.material.emissiveTexture = qa.originalEmissiveTexture;
      qa.light.dispose();
      qa.camera.dispose(); delete globalThis.__rinaIslandQaCamera;
      return true;
    })()`);
  }
  let actionStarted = Date.now();
  await evaluate(allPhones ? `(async () => {
    const storeUrl = performance.getEntriesByType('resource')
      .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(storeUrl ??
      '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const phones = EngineStore.LastCreatedScene.metadata.rinaPhones.phones;
    for (const id of phones.ids) phones.triggerPhoto(id);
    return true;
  })()` : `(() => {
    document.getElementById('rinaPhonesDebug')?.querySelector('button')?.click();
    return true;
  })()`);
  await delay(1450);
  const raised = await evaluate(`(${inspect})()`);
  assert.ok(raised.phoneSizes[0].visible &&
    raised.phoneSizes[0].screenFacesFan > 0.7 &&
    raised.phoneSizes[0].palmDistance < 0.16 &&
    raised.phoneSizes[0].palmDistance < raised.phoneSizes[0].wristDistance &&
    raised.phoneSizes[0].aboveHead > 0.05 &&
    raised.phoneSizes[0].inFrontOfHead > 0.15 &&
    raised.phoneSizes[0].leftHandDistance < 0.25,
  `Raised phone did not point at Rina: ${JSON.stringify(raised.phoneSizes[0])}`);
  if (allPhones) assert.ok(raised.phoneSizes.every(p =>
    p.visible && p.screenFacesFan > 0.65 &&
    p.palmDistance > 0.02 && p.palmDistance < 0.19 &&
    p.palmDistance < p.wristDistance &&
    p.aboveHead > 0.18 && p.aboveHead < 0.42 &&
    p.inFrontOfHead > 0.10 && p.leftHandDistance < 0.25),
  `Some fans missed the two-handed photo pose: ${JSON.stringify(raised.phoneSizes)}`);
  console.log(`raised phone: screen-to-fan ${raised.phoneSizes[0].screenFacesFan.toFixed(3)}, ` +
    `palm ${raised.phoneSizes[0].palmDistance.toFixed(3)} m, ` +
    `above head ${raised.phoneSizes[0].aboveHead.toFixed(3)} m, ` +
    `left hand ${raised.phoneSizes[0].leftHandDistance.toFixed(3)} m`);
  console.log("display normals", raised.phoneSizes.map(p => ({ id: p.id,
    local: p.localNormal, dot: p.actualScreenFacesFan })));
  if (!allPhones) {
  if (process.env.RINA_PHONES_CAPTURE_PREFIX) {
    await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ??
        '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const { FreeCamera } = await import('/node_modules/@babylonjs/core/Cameras/freeCamera.js');
      const { Vector3 } = await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
      const { Color3, Color4 } = await import('/node_modules/@babylonjs/core/Maths/math.color.js');
      const scene = EngineStore.LastCreatedScene;
      const fan = scene.getMeshByName('rinaCrowd_fan_01:field-lod1:group_1');
      const wrapper = scene.getTransformNodeByName('theatrePhone_fan_01-0');
      const keep = new Set([fan, ...wrapper.getChildMeshes(false),
        ...scene.metadata.rinaPhones.phones.feed.renderList]);
      const hidden = scene.meshes.filter(mesh => mesh.isEnabled() &&
        mesh.getTotalVertices() > 0 && !keep.has(mesh));
      for (const mesh of hidden) mesh.setEnabled(false);
      const materials = [...new Set([...keep].map(mesh => mesh?.material).filter(Boolean))]
        .filter(material => material.name !== 'theatrePhoneSharedDisplay')
        .filter(material => material.emissiveColor)
        .map(material => ({ material, color: material.emissiveColor.clone() }));
      for (const item of materials) item.material.emissiveColor =
        new Color3(0.10, 0.10, 0.10);
      const body = wrapper.getChildMeshes(false).find(mesh => mesh.name.includes('SmartPhone_Body'));
      if (body?.material?.emissiveColor) body.material.emissiveColor =
        new Color3(0.7, 0.35, 0.08);
      const clearColor = scene.clearColor.clone();
      scene.clearColor = new Color4(0.24, 0.24, 0.24, 1);
      const head = fan.skeleton.bones.find(b => b.name.endsWith('Head')).getAbsolutePosition(fan);
      const camera = new FreeCamera('rinaPhoneQaCamera', head.add(new Vector3(0, 0.1, 3)), scene);
      camera.fov = 0.55;
      camera.setTarget(head.add(new Vector3(0, 0.10, 0)));
      globalThis.__rinaPhoneQa = { camera, head, previous: scene.activeCamera,
        hidden, materials, clearColor };
      scene.activeCamera = camera;
      return true;
    })()`);
    await delay(180);
    for (const [side, z] of [['stage', 3], ['opposite', -3]]) {
      await evaluate(`(() => {
        const qa = globalThis.__rinaPhoneQa;
        qa.camera.position.copyFrom(qa.head).addInPlaceFromFloats(0, 0.1, ${z});
        qa.camera.setTarget(qa.head);
        return true;
      })()`);
      await delay(100);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(`${process.env.RINA_PHONES_CAPTURE_PREFIX}-${side}.png`,
        Buffer.from(shot.result.data, "base64"));
    }
    await evaluate(`(() => {
      const qa = globalThis.__rinaPhoneQa;
      const scene = qa.camera.getScene(); scene.activeCamera = qa.previous;
      scene.clearColor = qa.clearColor;
      for (const item of qa.materials) item.material.emissiveColor = item.color;
      for (const mesh of qa.hidden) mesh.setEnabled(true);
      qa.camera.dispose(); delete globalThis.__rinaPhoneQa;
      return true;
    })()`);
  }
  let flashed = false;
  for (let i = 0; i < 60 && !flashed; i++) {
    flashed = await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ??
        '/node_modules/@babylonjs/core/Engines/engineStore.js');
      return !!EngineStore.LastCreatedScene.getMeshByName(
        'theatrePhoneFlare_' + ${JSON.stringify(before.ids[0])})?.isEnabled();
    })()`);
    if (!flashed) await delay(50);
  }
  assert.ok(flashed, "Photo action never fired its flash");
  const flareState = await evaluate(`(async () => {
    const storeUrl = performance.getEntriesByType('resource')
      .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(storeUrl ??
      '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const flare = EngineStore.LastCreatedScene.getMeshByName(
      'theatrePhoneFlare_' + ${JSON.stringify(before.ids[0])});
    return { depthFunction: flare.material.depthFunction,
      group: flare.renderingGroupId, size: flare.getBoundingInfo().boundingBox.extendSize.y * 2 };
  })()`);
  assert.ok(flareState.depthFunction === 519 && flareState.group === 2 &&
    flareState.size >= 0.25, `Flash billboard can be occluded: ${JSON.stringify(flareState)}`);
  if (process.env.RINA_FLASH_CAPTURE) {
    const captureStarted = Date.now();
    await evaluate(`(async () => {
      const storeUrl = performance.getEntriesByType('resource')
        .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const { EngineStore } = await import(storeUrl ??
        '/node_modules/@babylonjs/core/Engines/engineStore.js');
      const { FreeCamera } = await import('/node_modules/@babylonjs/core/Cameras/freeCamera.js');
      const { Vector3 } = await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
      const scene = EngineStore.LastCreatedScene;
      const phones = scene.metadata.rinaPhones.phones;
      const flare = scene.getMeshByName('theatrePhoneFlare_' +
        ${JSON.stringify(before.ids[0])});
      const light = scene.getLightByName('theatrePhonePooledFlash');
      const previousUpdate = phones.update;
      const previousLightIntensity = light.intensity;
      phones.update = () => {};
      flare.setEnabled(true);
      flare.scaling.setAll(1.4);
      light.position.copyFrom(flare.position);
      light.intensity = 30;
      const point = flare.position.clone();
      const camera = new FreeCamera('rinaFlashQaCamera',
        point.add(new Vector3(0, 0.1, 2.8)), scene);
      camera.fov = 0.55;
      camera.setTarget(point);
      globalThis.__rinaFlashQaCamera = { camera, previous: scene.activeCamera,
        phones, previousUpdate, light, previousLightIntensity, flare };
      scene.activeCamera = camera;
      return true;
    })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.RINA_FLASH_CAPTURE,
      Buffer.from(shot.result.data, 'base64'));
    await evaluate(`(() => {
      const qa = globalThis.__rinaFlashQaCamera;
      qa.camera.getScene().activeCamera = qa.previous;
      qa.phones.update = qa.previousUpdate;
      qa.light.intensity = qa.previousLightIntensity;
      qa.flare.setEnabled(false);
      qa.camera.dispose(); delete globalThis.__rinaFlashQaCamera;
      return true;
    })()`);
    actionStarted += Date.now() - captureStarted;
  }
  const flash = await evaluate(`(async () => {
    const storeUrl = performance.getEntriesByType('resource')
      .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scene = EngineStore.LastCreatedScene;
    const phones = scene.metadata.rinaPhones.phones;
    const second = phones.ids[1];
    phones.triggerPhoto(second);
    return { secondVisible: scene.getTransformNodeByName('theatrePhone_' + second)?.isEnabled(),
      lightRange: scene.getLightByName('theatrePhonePooledFlash')?.range };
  })()`);
  assert.ok(flash.secondVisible &&
    flash.lightRange >= 4 && flash.lightRange <= 5,
    `Second photo or pooled light is wrong: ${JSON.stringify(flash)}`);
  await delay(Math.max(0, 4000 - (Date.now() - actionStarted)));
  const duringAction = await evaluate(`(${inspect})()`);
  assert.ok(duringAction.phoneSizes[0].visible,
    "Phone action ended before four seconds");
  await delay(Math.max(0, 5500 - (Date.now() - actionStarted)));
  const lowered = await evaluate(`(${inspect})()`);
  assert.ok(!lowered.phoneSizes[0].visible,
    `Phone stayed visible after the photo sequence: ${JSON.stringify(lowered.phoneSizes[0])}`);
  await evaluate("globalThis.__bosqueLevelDebug.load('sanctuary')");
  const afterExit = await evaluate(`(async () => {
    const storeUrl = performance.getEntriesByType('resource')
      .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    return { level: globalThis.__bosqueLevelDebug.current(),
      liveScenes: globalThis.__bosqueLevelDebug.snapshot().liveScenes,
      oldPhoneScene: EngineStore.Instances.flatMap(e => e.scenes)
        .some(s => s.metadata?.rinaPhones) };
  })()`);
  assert.equal(afterExit.level, "sanctuary");
  assert.equal(afterExit.liveScenes, 1);
  assert.equal(afterExit.oldPhoneScene, false);
  await evaluate("globalThis.__bosqueLevelDebug.load('rina')");
  const afterReturn = await evaluate(`(${inspect})()`);
  assert.equal(afterReturn.count, before.count);
  assert.equal(afterReturn.targets, 1);
  assert.equal(afterReturn.flashes, 1);
  assert.equal(afterReturn.liveScenes, 1);
  console.log("Rina phones: feed, real rigs, and level reentry passed");
  } else console.log(`Rina phones: ${raised.phoneSizes.length} two-handed poses passed`);
} finally {
  socket?.close();
  browser.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
