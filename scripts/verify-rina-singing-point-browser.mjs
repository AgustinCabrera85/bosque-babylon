import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let chrome;
for (const candidate of [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(candidate); chrome = candidate; break; } catch { /* next */ }
}
assert.ok(chrome);
const profile = await mkdtemp(join(tmpdir(), 'bosque-rina-aim-'));
const port = 9400 + Math.floor(Math.random() * 500);
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-sandbox',
  '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`,
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
  assert.ok(target);
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
    const reply = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (reply.result?.exceptionDetails) throw new Error(
      reply.result.exceptionDetails.exception?.description ?? 'Evaluation failed');
    return reply.result?.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:5173/?level=rina' });
  let menuReady = false;
  for (let i = 0; i < 240 && !menuReady; i++) {
    menuReady = await evaluate("document.documentElement.dataset.bosqueCursorType === 'menu' && document.documentElement.style.getPropertyValue('--bosque-cursor').includes('blob:')");
    if (!menuReady) await delay(250);
  }
  assert.ok(menuReady);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    document.querySelector('.character-card[data-character="lautaro"]')?.click();
    document.getElementById('startCharacterButton')?.click(); true`);
  let ready;
  for (let i = 0; i < 240; i++) {
    ready = await evaluate(`({ current: globalThis.__bosqueLevelDebug?.current(),
      hidden: document.getElementById('loadingScreen')?.classList.contains('hidden') })`);
    if (ready?.current === 'rina' && ready.hidden) break;
    await delay(500);
  }
  assert.ok(ready?.current === 'rina' && ready.hidden);
  await evaluate(`(async () => {
    const storeUrl = performance.getEntriesByType('resource')
      .find(entry => entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const { EngineStore } = await import(storeUrl ?? '/node_modules/@babylonjs/core/Engines/engineStore.js');
    window.__rinaAimScene = EngineStore.LastCreatedScene;
    return true;
  })()`);
  const phoneId = await evaluate(`(() => {
    const scene = window.__rinaAimScene;
    return scene.metadata.rinaPhones.phones.ids[0];
  })()`);
  assert.ok(phoneId, 'The Rina level needs a rigged fan phone for the shutter test');
  await evaluate(`(() => {
    const scene = window.__rinaAimScene;
    scene.metadata.rinaPhones.phones.triggerPhoto(${JSON.stringify(phoneId)});
    return true;
  })()`);
  let actualShutter = false;
  for (let i = 0; i < 120 && !actualShutter; i++) {
    actualShutter = await evaluate(`(() => {
      const scene = window.__rinaAimScene;
      return scene.metadata.rinaPhotoAttack.lastShutterFanId === ${JSON.stringify(phoneId)};
    })()`);
    if (!actualShutter) await delay(50);
  }
  assert.ok(actualShutter, 'A fan phone shutter must notify Rina with that fan ID');
  const attackedFanId = await evaluate(`(() => {
    const scene = window.__rinaAimScene;
    return scene.metadata.rinaAbsorption.victimId;
  })()`);
  assert.ok(attackedFanId, 'A photographed fan must be selected for absorption');
  const expectedColor = /^fan_0[45]-/.test(attackedFanId) ? '#A53BFF' : '#189CFF';
  let arcsStarted = false;
  for (let i = 0; i < 120 && !arcsStarted; i++) {
    arcsStarted = await evaluate(`(() => {
      const effect = window.__rinaAimScene.metadata.rinaAbsorption;
      return effect.phase === 'charging' && effect.arcVisible;
    })()`);
    if (!arcsStarted) await delay(50);
  }
  assert.ok(arcsStarted, 'Violet rays must start when Rina points at the victim');
  await delay(2400);
  const arcState = await evaluate(`(() => {
    const scene = window.__rinaAimScene;
    const effect = scene.metadata.rinaAbsorption;
    const hand = scene.getTransformNodeByName('rina-stage:mixamorig:LeftHand');
    hand.computeWorldMatrix(true);
    const [start, end] = effect.arcEndpoints;
    const midpoint = effect.arcMidpoint;
    const target = effect.victimTarget;
    return { phase: effect.phase, elapsed: effect.chargeElapsed,
      visible: effect.arcVisible,
      rayCount: scene.meshes.filter(mesh =>
        mesh.name.startsWith('rinaAttackArcCore_') && mesh.isEnabled()).length,
      handError: Math.hypot(start[0] - hand.getAbsolutePosition().x,
        start[1] - hand.getAbsolutePosition().y,
        start[2] - hand.getAbsolutePosition().z),
      archHeight: midpoint[1] - (start[1] + end[1]) * 0.5,
      targetError: Math.hypot(end[0] - target[0], end[1] - target[1],
        end[2] - target[2]),
      reach: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) };
  })()`);
  assert.ok(arcState.phase === 'charging' && arcState.visible &&
    arcState.rayCount === 3 && arcState.handError < 0.35 &&
    arcState.archHeight > 0.8 && arcState.targetError < 0.25 &&
    arcState.reach > 2 &&
    arcState.elapsed > 1.8 && arcState.elapsed < 3.7,
    `Three rays must remain attached throughout the charge: ${JSON.stringify(arcState)}`);
  const arcScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (arcScreenshot.result?.data) await writeFile('dist/rina-electric-arc-link.png',
    Buffer.from(arcScreenshot.result.data, 'base64'));
  let lateCharge = null;
  for (let i = 0; i < 90; i++) {
    const sample = await evaluate(`(() => {
      const effect = window.__rinaAimScene.metadata.rinaAbsorption;
      return { phase: effect.phase, elapsed: effect.chargeElapsed,
        visible: effect.arcVisible };
    })()`);
    if (sample.phase !== 'charging') break;
    lateCharge = sample;
    if (sample.elapsed > 3.8) break;
    await delay(30);
  }
  assert.ok(lateCharge?.elapsed > 3.8 && lateCharge.visible,
    `The victim must still exist just before four seconds: ${JSON.stringify(lateCharge)}`);
  let exploded = false;
  for (let i = 0; i < 180 && !exploded; i++) {
    exploded = await evaluate(`window.__rinaAimScene.metadata.rinaAbsorption.phase === 'rising'`);
    if (!exploded) await delay(50);
  }
  assert.ok(exploded, 'Electric charge must end in a coloured light burst');
  const transformationAt = await evaluate(
    'window.__rinaAimScene.metadata.rinaAbsorption.lastTransformationAt');
  assert.ok(transformationAt >= 4 && transformationAt < 4.07,
    `The victim must transform four seconds after Rina points: ${transformationAt}`);
  assert.equal(await evaluate('window.__rinaAimScene.metadata.rinaAbsorption.arcVisible'), false,
    'The connecting rays must stop at the light burst');
  const riseStart = await evaluate(`window.__rinaAimScene.metadata.rinaAbsorption.orbPosition`);
  await delay(300);
  const riseLater = await evaluate(`window.__rinaAimScene.metadata.rinaAbsorption.orbPosition`);
  assert.ok(riseLater?.[1] > riseStart?.[1] + 0.1 &&
    Math.hypot(riseLater[0] - riseStart[0], riseLater[2] - riseStart[2]) < 0.2,
    'The absorbed orb must rise vertically before it travels');
  let absorbed = false;
  for (let i = 0; i < 120 && !absorbed; i++) {
    absorbed = await evaluate(`window.__rinaAimScene.metadata.rinaAbsorption.lastAbsorbedId === ${JSON.stringify(attackedFanId)}`);
    if (!absorbed) await delay(50);
  }
  assert.ok(absorbed, 'The orb must reach Rina and finish the absorption');
  const absorption = await evaluate(`(() => {
    const scene = window.__rinaAimScene;
    const wrapper = scene.getTransformNodeByName('theatrePhone_' + ${JSON.stringify(attackedFanId)});
    return { color: scene.metadata.rinaAbsorption.lastAbsorbedColor,
      phase: scene.metadata.rinaAbsorption.phase,
      phoneVisible: wrapper?.isEnabled() };
  })()`);
  assert.equal(absorption.color, expectedColor);
  assert.equal(absorption.phoneVisible, false);
  assert.equal(absorption.phase, 'idle');
  const started = await evaluate(`(async () => {
    const scene = window.__rinaAimScene;
    const root = scene.getTransformNodeByName('enemy:rina-stage:root');
    const block = scene.animationGroups.find(g => g.name.endsWith('rina_combat_block_idle'));
    const sing = scene.animationGroups.find(g => g.name.endsWith('rina_emote_sing'));
    const bone = suffix => block.targetedAnimations.find(t =>
      t.animation.targetProperty === 'rotationQuaternion' &&
      t.target.name.endsWith('mixamorig:' + suffix))?.target;
    const player = scene.getTransformNodeByName('playerRoot');
    player.position.set(-3, 5.45, 61);
    player.rotation.y = Math.PI;
    const target = root.position.clone();
    target.set(20, 0, -10);
    window.__rinaAimTest = { scene, root, block, sing, bone, target };
    return scene.metadata.rinaPhotoAttack.trigger(target, true);
  })()`);
  assert.equal(started, true);
  await delay(1600);
  const front = await evaluate(`(() => {
    const { scene, root, block, sing, bone, target } = window.__rinaAimTest;
    const shoulder = bone('LeftShoulder');
    const elbow = bone('LeftForeArm');
    const wrist = bone('LeftHand');
    const rightShoulder = bone('RightShoulder');
    const rightWrist = bone('RightHand');
    shoulder.computeWorldMatrix(true); elbow.computeWorldMatrix(true);
    wrist.computeWorldMatrix(true); rightShoulder.computeWorldMatrix(true);
    rightWrist.computeWorldMatrix(true);
    const delta = wrist.getAbsolutePosition().subtract(shoulder.getAbsolutePosition());
    const yaw = root.rotation.y;
    const leftSide = shoulder.getAbsolutePosition().subtract(rightShoulder.getAbsolutePosition());
    leftSide.y = 0; leftSide.normalize();
    const chest = shoulder.getAbsolutePosition().add(rightShoulder.getAbsolutePosition()).scale(0.5);
    const elbowSide = elbow.getAbsolutePosition().subtract(chest).dot(leftSide);
    const wristSide = wrist.getAbsolutePosition().subtract(chest).dot(leftSide);
    const handSeparation = wrist.getAbsolutePosition().subtract(rightWrist.getAbsolutePosition()).length();
    const handElectricMeshes = scene.meshes.filter(mesh =>
      mesh.name.startsWith('rinaElectricFX_') && mesh.isEnabled() &&
      mesh.material?._newUniformInstances?.['float-uArcRegionRadius'] < 1);
    const desired = Math.atan2(target.x - root.position.x, target.z - root.position.z);
    return { active: scene.metadata.rinaPhotoAttack.active,
      pointing: scene.metadata.rinaPhotoAttack.pointing,
      weight: scene.metadata.rinaPhotoAttack.weight,
      elapsed: scene.metadata.rinaPhotoAttack.elapsed,
      yawError: Math.abs(Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw))),
      forwardReach: delta.x * Math.sin(yaw) + delta.z * Math.cos(yaw),
      lateralReach: delta.x * Math.cos(yaw) - delta.z * Math.sin(yaw),
      elbowSide, wristSide, handSeparation,
      shoulderToRootRight: leftSide.x * Math.cos(yaw) - leftSide.z * Math.sin(yaw),
      shoulderForward: leftSide.x * Math.sin(yaw) + leftSide.z * Math.cos(yaw),
      handElectricMeshes: handElectricMeshes.length,
      delta: delta.asArray(),
      shoulder: shoulder.getAbsolutePosition().asArray(),
      wrist: wrist.getAbsolutePosition().asArray(),
      armRotation: bone('LeftArm').rotationQuaternion?.asArray(),
      singPlaying: sing.isPlaying, blockPlaying: block.isPlaying,
      microphoneParent: scene.getTransformNodeByName('rinaMicrophoneGrip')?.parent?.name };
  })()`);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (screenshot.result?.data) await writeFile('dist/rina-singing-point.png',
    Buffer.from(screenshot.result.data, 'base64'));
  assert.ok(front.active && front.pointing, JSON.stringify(front));
  assert.ok(front.yawError < 0.16 && front.forwardReach > 0.32,
    `The free arm must point ahead of Rina toward the photographer: ${JSON.stringify(front)}`);
  assert.ok(front.elbowSide > 0.2 && front.wristSide > 0.2 &&
    front.handSeparation > 0.3,
    `The free arm must remain clear of the torso and microphone arm: ${JSON.stringify(front)}`);
  assert.ok(front.handElectricMeshes > 0,
    `The purple electricity must activate on Rina's hand: ${JSON.stringify(front)}`);
  assert.ok(front.singPlaying && !front.blockPlaying &&
    front.microphoneParent?.endsWith('RightHand'), JSON.stringify(front));
  await evaluate(`(() => {
    const player = window.__rinaAimTest.scene.getTransformNodeByName('playerRoot');
    player.position.set(0, 5.45, 49);
    player.rotation.y = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true }));
    return true;
  })()`);
  await delay(400);
  const frontScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (frontScreenshot.result?.data) await writeFile('dist/rina-singing-point-front.png',
    Buffer.from(frontScreenshot.result.data, 'base64'));

  await evaluate(`(() => {
    const { scene, root } = window.__rinaAimTest;
    const behind = root.position.clone(); behind.set(0, 0, 90);
    scene.metadata.rinaPhotoAttack.trigger(behind, true);
    return true;
  })()`);
  await delay(120);
  const early = await evaluate('window.__rinaAimTest.scene.metadata.rinaPhotoAttack.pointing');
  assert.equal(early, false, 'The arm must wait for the body to turn before aiming behind Rina');
  await delay(2100);
  const rear = await evaluate(`(() => {
    const { scene, root, bone } = window.__rinaAimTest;
    const leftShoulder = bone('LeftShoulder');
    const rightShoulder = bone('RightShoulder');
    const elbow = bone('LeftForeArm');
    const wrist = bone('LeftHand');
    const rightWrist = bone('RightHand');
    for (const joint of [leftShoulder, rightShoulder, elbow, wrist, rightWrist]) {
      joint.computeWorldMatrix(true);
    }
    const side = leftShoulder.getAbsolutePosition()
      .subtract(rightShoulder.getAbsolutePosition());
    side.y = 0; side.normalize();
    const chest = leftShoulder.getAbsolutePosition()
      .add(rightShoulder.getAbsolutePosition()).scale(0.5);
    return { yaw: root.rotation.y, pointing: scene.metadata.rinaPhotoAttack.pointing,
      singPlaying: window.__rinaAimTest.sing.isPlaying,
      elbowSide: elbow.getAbsolutePosition().subtract(chest).dot(side),
      wristSide: wrist.getAbsolutePosition().subtract(chest).dot(side),
      handSeparation: wrist.getAbsolutePosition()
        .subtract(rightWrist.getAbsolutePosition()).length() };
  })()`);
  assert.ok(rear.pointing && rear.singPlaying &&
    Math.abs(Math.atan2(Math.sin(rear.yaw), Math.cos(rear.yaw))) < 0.2 &&
    rear.elbowSide > 0.2 && rear.wristSide > 0.2 && rear.handSeparation > 0.3,
    `Rina must turn fully before aiming behind: ${JSON.stringify(rear)}`);
  await delay(5600);
  const recovered = await evaluate(`(() => {
    const { scene, root, sing } = window.__rinaAimTest;
    return { active: scene.metadata.rinaPhotoAttack.active,
      yaw: root.rotation.y, singPlaying: sing.isPlaying };
  })()`);
  assert.ok(!recovered.active && recovered.singPlaying &&
    Math.abs(Math.atan2(Math.sin(recovered.yaw - Math.PI),
      Math.cos(recovered.yaw - Math.PI))) < 0.12,
    `Rina must smoothly return to singing toward the audience: ${JSON.stringify(recovered)}`);
  await evaluate(`(() => {
    const { scene, root } = window.__rinaAimTest;
    const target = root.position.clone(); target.z -= 30;
    return scene.metadata.rinaPhotoAttack.trigger(target, true);
  })()`);
  const haloVisibility = () => evaluate(`(() => {
    const halo = window.__rinaAimTest.scene.getMeshByName('rinaElectricHandHalo');
    return halo.isEnabled() ? halo.visibility : 0;
  })()`);
  await delay(2200);
  const bright = await haloVisibility();
  await delay(100);
  const pulseB = await haloVisibility();
  await delay(100);
  const pulseC = await haloVisibility();
  await delay(2550);
  const fading = await haloVisibility();
  await delay(350);
  const nearlyGone = await haloVisibility();
  await delay(450);
  const gone = await haloVisibility();
  const pulseRange = Math.max(bright, pulseB, pulseC) - Math.min(bright, pulseB, pulseC);
  assert.ok(bright > 0.45 && pulseRange > 0.05 &&
    fading > nearlyGone && nearlyGone > 0.01 && gone === 0,
    `Purple electricity must pulse, then fade with the arm: ${JSON.stringify({ bright, pulseB, pulseC, fading, nearlyGone, gone })}`);
  const femaleFanId = await evaluate(`window.__rinaAimScene.metadata.rinaPhones.phones.ids
    .find(id => /^fan_0[45]-/.test(id))`);
  assert.ok(femaleFanId, 'A female phone holder must be available for the violet variant');
  const femaleStarted = await evaluate(`window.__rinaAimScene.metadata.rinaAbsorption
    .triggerFan(${JSON.stringify(femaleFanId)})`);
  assert.equal(femaleStarted, true);
  let violetBurst = false;
  for (let i = 0; i < 180 && !violetBurst; i++) {
    violetBurst = await evaluate(`(() => {
      const effect = window.__rinaAimScene.metadata.rinaAbsorption;
      return effect.phase === 'rising' && effect.color === '#A53BFF';
    })()`);
    if (!violetBurst) await delay(50);
  }
  assert.ok(violetBurst, 'A female spectator must release a violet orb');
  let femaleAbsorbed = false;
  for (let i = 0; i < 120 && !femaleAbsorbed; i++) {
    femaleAbsorbed = await evaluate(`window.__rinaAimScene.metadata.rinaAbsorption.lastAbsorbedId === ${JSON.stringify(femaleFanId)}`);
    if (!femaleAbsorbed) await delay(50);
  }
  assert.ok(femaleAbsorbed, 'The violet orb must reach Rina');
  const violetImpact = await evaluate(`(() => {
    const scene = window.__rinaAimScene;
    return { color: scene.metadata.rinaAbsorption.lastAbsorbedColor,
      localizedMeshes: scene.meshes.filter(mesh =>
        mesh.name.startsWith('rinaElectricFX_') && mesh.isEnabled() &&
        mesh.material?._newUniformInstances?.['float-uArcRegionRadius'] === 0.58).length };
  })()`);
  assert.equal(violetImpact.color, '#A53BFF');
  assert.ok(violetImpact.localizedMeshes > 0,
    'The absorbed color must flash on a small region of Rina’s body');
  console.log({ attackedFanId, expectedColor, arcState, lateCharge, transformationAt,
    absorption, front, early, rear, recovered,
    fade: { bright, pulseB, pulseC, fading, nearlyGone, gone },
    femaleFanId, violetImpact });
} finally {
  socket?.close();
  browser.kill();
  assert.ok(profile.startsWith(join(tmpdir(), 'bosque-rina-aim-')));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
