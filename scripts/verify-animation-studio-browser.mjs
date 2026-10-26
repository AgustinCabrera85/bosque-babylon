import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const candidates = [process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
let executable;
for (const path of candidates) {
  try { await access(path); executable = path; break; } catch { /* next */ }
}
assert.ok(executable, "Chrome or Edge is required");
const profile = await mkdtemp(join(tmpdir(), "bosque-animation-studio-"));
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
      errors.push(message.params.exceptionDetails.exception?.description ??
        message.params.exceptionDetails.text);
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
    const response = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (response.result?.exceptionDetails)
      throw new Error(response.result.exceptionDetails.exception?.description ??
        "Browser evaluation failed");
    return response.result?.result?.value;
  };
  const waitFor = async (expression, label, attempts = 120) => {
    for (let i = 0; i < attempts; i++) {
      const result = await evaluate(expression);
      if (result) return result;
      await delay(250);
    }
    const status = await evaluate(`({status:document.querySelector('#studioStatus')?.textContent,
      busy:!document.querySelector('#busyOverlay')?.classList.contains('hidden')})`);
    throw new Error(`${label}: ${JSON.stringify(status)}; ${errors.join(" | ")}`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await send("Page.navigate", { url: "http://localhost:5173/animation-studio.html" });
  await waitFor("document.querySelector('#studioCanvas') && document.querySelector('#loadFan01')", "Studio page");
  await waitFor("document.querySelector('#loadLautaro')?.onclick !== null", "Studio initialization");
  const startup = await evaluate(`({status:document.querySelector('#studioStatus')?.textContent,
    width:document.querySelector('#studioCanvas')?.width,
    height:document.querySelector('#studioCanvas')?.height})`);
  assert.ok(startup.width > 0 && startup.height > 0, JSON.stringify(startup));
  await evaluate("document.querySelector('#loadLautaro').click(); true");
  const lautaro = await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('Modelo Lautaro_Animated.glb')", "Lautaro load");
  assert.ok(lautaro);
  await evaluate("document.querySelector('#loadFan01').click(); true");
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('Modelo Fan_01_LOD1_Animated_512.glb')", "Fan 01 LOD1 load");
  const fan = await evaluate(`({status:document.querySelector('#studioStatus')?.textContent,
    clips:document.querySelector('#baseAnimation')?.options.length,
    bones:document.querySelectorAll('#boneList button').length,
    lods:[...document.querySelector('#fanVariant').options].map(option=>option.value)})`);
  assert.ok(fan.clips >= 2 && fan.bones >= 20 &&
    fan.lods.includes('source') && fan.lods.includes('lod1') &&
    fan.lods.includes('lod2-0') && fan.lods.includes('lod2-1'),JSON.stringify(fan));
  await evaluate(`(() => {
    const select=document.querySelector('#fanVariant');select.value='lod2-0';
    select.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('LOD estático sin rig')", "Fan 01 LOD2 load");
  const staticLod = await evaluate(`(async () => {
    const storeUrl=performance.getEntriesByType('resource')
      .find(entry=>entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const {EngineStore}=await import(storeUrl??
      '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const root=EngineStore.LastCreatedScene.getTransformNodeByName('studioCharacterRoot');
    const meshes=root?.getChildMeshes(false).filter(mesh=>mesh.getTotalVertices()>0)??[];
    return {bones:document.querySelectorAll('#boneList button').length,
      animationDisabled:document.querySelector('#baseAnimation').disabled,
      photoDisabled:[...document.querySelector('#proceduralView').options]
        .find(option=>option.value==='rina-photo').disabled,
      height:Math.max(...meshes.map(mesh=>mesh.getBoundingInfo().boundingBox.maximumWorld.y))-
        Math.min(...meshes.map(mesh=>mesh.getBoundingInfo().boundingBox.minimumWorld.y))};
  })()`);
  assert.ok(staticLod.bones===0 && staticLod.animationDisabled && staticLod.photoDisabled &&
    Math.abs(staticLod.height-2.65)<0.02,JSON.stringify(staticLod));
  await evaluate(`(() => {
    const select=document.querySelector('#fanVariant');select.value='lod1';
    select.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('Modelo Fan_01_LOD1_Animated_512.glb')", "Fan 01 LOD1 reload");
  await evaluate(`(() => {
    const select=document.querySelector('#proceduralView');select.value='rina-photo';
    select.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('Vista previa de la foto procedural')", "Live Rina photo preview");
  await delay(2200);
  const photo = await evaluate(`(async () => {
    const storeUrl=performance.getEntriesByType('resource')
      .find(entry=>entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const {EngineStore}=await import(storeUrl??
      '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scene=EngineStore.LastCreatedScene;
    const wrapper=scene.getTransformNodeByName('theatrePhone_studio-fan_01');
    const phone=wrapper?.getChildMeshes(false).find(mesh=>mesh.name.includes('SmartPhone_Body'));
    const nonOpaque=wrapper?.getChildMeshes(false).filter(mesh=>mesh.getTotalVertices()>0)
      .flatMap(mesh=>{
        const materials=mesh.material?.subMaterials?.length
          ?mesh.material.subMaterials:[mesh.material];
        return materials.filter(Boolean).filter(material=>
          material.alpha!==1 || material.transparencyMode!==0);
      }).map(material=>material.name)??[];
    return {visible:wrapper?.isEnabled(),phone:!!phone,
      elapsed:document.querySelector('#proceduralInfo')?.textContent,
      replayDisabled:document.querySelector('#replayPhoto')?.disabled,
      nonOpaque};
  })()`);
  assert.ok(photo.visible && photo.phone && !photo.replayDisabled &&
    photo.elapsed?.includes('Foto de Rina') && photo.nonOpaque.length===0,
    JSON.stringify(photo));
  if (process.env.STUDIO_PHOTO_CAPTURE) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(process.env.STUDIO_PHOTO_CAPTURE,
      Buffer.from(shot.result.data, "base64"));
  }
  await evaluate(`(() => {
    const select=document.querySelector('#proceduralView');select.value='session';
    select.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  await waitFor("document.querySelector('#replayPhoto').disabled", "Photo preview cleanup");
  await evaluate(`(async () => {
    const response = await fetch('/assets/models/theatre/Smartphone_RinaReady.glb');
    if (!response.ok) throw new Error('Phone GLB fetch failed');
    const file = new File([await response.blob()], 'Smartphone_RinaReady.glb',
      {type:'model/gltf-binary'});
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('#propInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  })()`);
  await waitFor("document.querySelector('#propList button')?.textContent?.includes('Smartphone')", "Phone import");
  const prop = await evaluate(`({status:document.querySelector('#studioStatus')?.textContent,
    bone:document.querySelector('#propBone')?.value,
    meshes:document.querySelectorAll('#propList button').length})`);
  assert.ok(/RightHand/i.test(prop.bone), JSON.stringify(prop));
  const sizes = await evaluate(`(async () => {
    const storeUrl=performance.getEntriesByType('resource')
      .find(entry=>entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const {EngineStore}=await import(storeUrl??
      '/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scene=EngineStore.LastCreatedScene;
    const phone=scene.meshes.find(mesh=>mesh.name.includes('SmartPhone_Body'));
    const fan=scene.meshes.find(mesh=>mesh.skeleton&&mesh.getTotalVertices()>0);
    const height=mesh=>mesh ? mesh.getBoundingInfo().boundingBox.maximumWorld.y-
      mesh.getBoundingInfo().boundingBox.minimumWorld.y : null;
    const roots=['studioCharacterRoot','studioProp_prop_1']
      .map(name=>scene.getTransformNodeByName(name)).filter(Boolean);
    const opaqueIssues=roots.flatMap(root=>root.getChildMeshes(false))
      .filter(mesh=>mesh.getTotalVertices()>0).flatMap(mesh=>{
        const materials=mesh.material?.subMaterials?.length
          ?mesh.material.subMaterials:[mesh.material];
        return materials.filter(Boolean).flatMap(material=>
          material.alpha===1 && material.transparencyMode===0 &&
          !material.disableDepthWrite && material.forceDepthWrite &&
          mesh.visibility===1 && !mesh.hasVertexAlpha ? [] :
          [{mesh:mesh.name,material:material.name,alpha:material.alpha,
            mode:material.transparencyMode}]);
      });
    return {phoneHeight:height(phone),fanHeight:height(fan),
      opaqueIssues,
      propScale:scene.getTransformNodeByName('studioProp_prop_1')?.scaling.asArray(),
      phoneMeshes:scene.meshes.filter(mesh=>mesh.name.includes('SmartPhone')).map(mesh=>mesh.name).slice(0,5)};
  })()`);
  console.log("Studio prop sizes", sizes);
  assert.ok(sizes.fanHeight > 2.4 && sizes.fanHeight < 2.9 &&
    sizes.phoneHeight > 0.19 && sizes.phoneHeight < 0.25 &&
    sizes.opaqueIssues.length===0,
  `Fan or phone has the wrong scale: ${JSON.stringify(sizes)}`);
  if (process.env.STUDIO_CAPTURE) {
    await delay(200);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(process.env.STUDIO_CAPTURE,
      Buffer.from(shot.result.data, "base64"));
  }
  await evaluate(`(() => {
    const input = document.querySelector('#boneSearch');
    input.value='RightHand'; input.dispatchEvent(new Event('input', {bubbles:true}));
    return true;
  })()`);
  const selected = await evaluate(`(() => {
    const button = [...document.querySelectorAll('#boneList button')]
      .find(item => item.textContent.endsWith('mixamorig:RightHand'));
    if (!button) return null; button.click(); return button.textContent;
  })()`);
  assert.ok(selected, `RightHand bone was not selectable: ${await evaluate(
    "[...document.querySelectorAll('#boneList button')].map(item=>item.textContent).slice(0,12)")}`);
  await evaluate(`(() => {
    const input = document.querySelector('#boneRotX');
    input.value='12'; input.dispatchEvent(new Event('change', {bubbles:true}));
    document.querySelector('#captureKey').click();
    const slider=document.querySelector('#timeSlider');
    slider.value='0.8'; slider.dispatchEvent(new Event('input', {bubbles:true}));
    input.value='20'; input.dispatchEvent(new Event('change', {bubbles:true}));
    document.querySelector('#captureKey').click();
    return true;
  })()`);
  await evaluate(`(() => {
    document.querySelector('#timeSlider').value='0';
    document.querySelector('#timeSlider').dispatchEvent(new Event('input', {bubbles:true}));
    document.querySelector('#playPause').click();
    return true;
  })()`);
  await delay(350);
  const playbackTime = await evaluate("Number(document.querySelector('#timeInput').value)");
  assert.ok(playbackTime > 0.1, `Studio playback did not advance: ${playbackTime}`);
  await evaluate("document.querySelector('#playPause').click(); true");
  await evaluate(`(() => {
    globalThis.__studioBlobs=[];
    const original=URL.createObjectURL.bind(URL);
    URL.createObjectURL=(blob)=>{globalThis.__studioBlobs.push(blob);return original(blob);};
    document.querySelector('#saveProject').click();
    document.querySelector('#exportRuntime').click();
    document.querySelector('#exportAnimationOnly').click();
    return true;
  })()`);
  const exported = await evaluate(`(async () => {
    const blobs=globalThis.__studioBlobs;
    return Promise.all(blobs.map(async blob => JSON.parse(await blob.text())));
  })()`);
  assert.equal(exported.length, 3);
  assert.equal(exported[0].format, "bosque.animation-studio.session");
  assert.equal(exported[1].format, "bosque.animation-studio.runtime");
  assert.ok(exported[0].keys.length >= 2 && exported[1].props.length >= 1);
  await evaluate(`(async () => {
    const json = ${JSON.stringify(exported[0])};
    const file = new File([JSON.stringify(json)], 'fan01.studio.json',
      {type:'application/json'});
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('#sessionInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  })()`);
  await waitFor("document.querySelector('#keyList')?.textContent?.includes('0.8')", "Session reimport");
  const restored = await evaluate(`({
    prop:document.querySelector('#propList button')?.textContent,
    keyCount:document.querySelector('#keyCount')?.textContent,
    modelScale:document.querySelector('#modelScale')?.value,
  })`);
  assert.ok(restored.prop?.includes('Smartphone_RinaReady') &&
    restored.keyCount?.includes('2') &&
    Math.abs(Number(restored.modelScale) - 2.65) < 0.01,
  `Studio session did not restore the accessory and keyframes: ${JSON.stringify(restored)}`);
  await evaluate(`(async () => {
    const json = ${JSON.stringify(exported[1])};
    const file = new File([JSON.stringify(json)], 'fan01.runtime.json',
      {type:'application/json'});
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('#sessionInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  })()`);
  await waitFor("document.querySelector('#keyCount')?.textContent?.startsWith('3')", "Runtime JSON import");
  const runtime = await evaluate(`({prop:document.querySelector('#propList button')?.textContent,
    keys:Number.parseInt(document.querySelector('#keyCount')?.textContent,10),
    scale:Number(document.querySelector('#modelScale')?.value)})`);
  assert.ok(runtime.prop?.includes('Smartphone_RinaReady') && runtime.keys>=2 &&
    Math.abs(runtime.scale-2.65)<0.01,JSON.stringify(runtime));
  await evaluate(`(async () => {
    const json = ${JSON.stringify(exported[2])};
    const file = new File([JSON.stringify(json)], 'fan01.procedural.json',
      {type:'application/json'});
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('#sessionInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  })()`);
  await waitFor("document.querySelector('#propList')?.textContent?.includes('Sin objetos adjuntos')", "Procedural JSON import");
  const procedural = await evaluate(`({keys:document.querySelector('#keyCount')?.textContent,
    scale:Number(document.querySelector('#modelScale')?.value),
    id:document.querySelector('#animationName')?.value})`);
  assert.ok(Number.parseInt(procedural.keys,10)>=2 && procedural.id==='pose_corrections' &&
    Math.abs(procedural.scale-2.65)<0.01,JSON.stringify(procedural));
  await evaluate("document.querySelector('#loadFan04').click(); true");
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('Modelo Female_Fan_04_LOD1_Animated_512.glb')", "Fan 04 LOD1 load");
  const fan04 = await evaluate("[...document.querySelector('#fanVariant').options].map(option=>option.value)");
  assert.ok(fan04.includes('near') && fan04.includes('lod2-1'),JSON.stringify(fan04));
  await evaluate(`(() => {
    const select=document.querySelector('#fanVariant');select.value='near';
    select.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('Modelo fan_04_near_2k.glb')", "Fan 04 near variant load");
  await evaluate(`(() => {const select=document.querySelector('#proceduralView');
    select.value='rina-photo';select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await waitFor("!document.querySelector('#bakePhoto').disabled", "Fan 04 photo ready");
  await evaluate("document.querySelector('#bakePhoto').click(); true");
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('Foto de fan_04 convertida')", "Fan 04 photo conversion", 180);
  assert.ok(await evaluate("Number.parseInt(document.querySelector('#keyCount').textContent,10)>=25"),
    "Fan 04 photo keyframes missing");
  await evaluate("document.querySelector('#loadHermanoMayor').click(); true");
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('Modelo Hermano_mayor_Final_NLA.glb')", "Boss model load");
  await evaluate(`(() => {
    const select=document.querySelector('#proceduralView');select.value='boss-pickup';
    select.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('hermano-mayor-axe-pickup')", "Boss pickup procedural load");
  const pickup = await evaluate(`({keys:Number.parseInt(document.querySelector('#keyCount')?.textContent,10),
    name:document.querySelector('#animationName')?.value})`);
  assert.ok(pickup.keys>=5 && pickup.name==='hermano-mayor-axe-pickup',JSON.stringify(pickup));
  await evaluate(`(() => {
    const select=document.querySelector('#proceduralView');select.value='boss-attack';
    select.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('hermano-mayor-axe-attack')", "Boss attack procedural load");
  const attack = await evaluate(`({keys:Number.parseInt(document.querySelector('#keyCount')?.textContent,10),
    name:document.querySelector('#animationName')?.value})`);
  assert.ok(attack.keys>=3 && attack.name==='hermano-mayor-axe-attack',JSON.stringify(attack));
  await evaluate("document.querySelector('#loadFan01').click(); true");
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('Modelo Fan_01_LOD1_Animated_512.glb')", "Fan 01 for photo authoring");
  await evaluate(`(() => {
    const select=document.querySelector('#proceduralView');select.value='rina-photo';
    select.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  await waitFor("!document.querySelector('#bakePhoto').disabled", "Photo bake ready");
  await evaluate("document.querySelector('#bakePhoto').click(); true");
  await waitFor("document.querySelector('#studioStatus')?.textContent?.includes('convertida en')", "Photo keyframe conversion", 180);
  const authored = await evaluate(`(async () => {
    const storeUrl=performance.getEntriesByType('resource')
      .find(entry=>entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
    const {EngineStore}=await import(storeUrl??'/node_modules/@babylonjs/core/Engines/engineStore.js');
    const scene=EngineStore.LastCreatedScene;
    const phone=scene.meshes.find(mesh=>mesh.name.includes('SmartPhone_Body'));
    const box=phone?.getBoundingInfo().boundingBox;
    const size=box ? box.maximumWorld.subtract(box.minimumWorld) : null;
    const height=size?Math.max(size.x,size.y,size.z):null;
    const propRoot=scene.getTransformNodeByName('studioProp_prop_1');
    return {keys:Number.parseInt(document.querySelector('#keyCount').textContent,10),
      prop:document.querySelector('#propList button')?.textContent,
      views:scene.activeCameras?.length,phoneHeight:height,
      propScale:propRoot?.scaling.asArray(),
      duration:Number(document.querySelector('#duration').value)};
  })()`);
  assert.ok(authored.keys>=25 && authored.prop?.includes('Smartphone_RinaReady') &&
    authored.views===4 && authored.phoneHeight>0.18 && authored.phoneHeight<0.25 &&
    authored.duration>5 && authored.duration<6,JSON.stringify(authored));
  await evaluate("document.querySelector('#toggleMultiView').click(); true");
  const focus=await evaluate('globalThis.__animationStudioDebug.focusPhone("audience",0.8)');
  const orbit=await evaluate('globalThis.__animationStudioDebug.orbit(0.4,-0.1,0.75)');
  assert.ok(Math.abs(focus.radius-0.8)<0.001 &&
    Math.abs(orbit.alpha-focus.alpha-0.4)<0.001 &&
    Math.abs(orbit.beta-focus.beta+0.1)<0.001 &&
    Math.abs(orbit.radius-0.6)<0.001 && orbit.target.every(Number.isFinite),
    JSON.stringify({focus,orbit}));
  await evaluate("document.querySelector('#toggleMultiView').click(); true");
  const audit=await evaluate('globalThis.__animationStudioDebug.report()');
  const photoSample=audit?.samples?.find(sample=>Math.abs(sample.time-2)<0.01);
  assert.ok(audit?.samples?.length>=25 && audit.issues.length===0 &&
    photoSample?.screenFacesFan>0.9 && photoSample.phoneTiltDeg<10 &&
    photoSample.rightGripGap<0.055 && photoSample.leftGripGap<0.055 &&
    photoSample.aboveHead>0.08,JSON.stringify({count:audit?.samples?.length,
      issues:audit?.issues?.slice(0,5),photoSample}));
  if (process.env.STUDIO_DIAGNOSTICS) {
    const samples=await evaluate(`(async () => {
      const storeUrl=performance.getEntriesByType('resource')
        .find(entry=>entry.name.includes('/node_modules/@babylonjs/core/Engines/engineStore.js'))?.name;
      const {EngineStore}=await import(storeUrl??'/node_modules/@babylonjs/core/Engines/engineStore.js');
      const {Vector3}=await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
      const scene=EngineStore.LastCreatedScene;
      const node=suffix=>scene.transformNodes.find(item=>item.name.endsWith(suffix));
      const pos=suffix=>{const n=node(suffix);n?.computeWorldMatrix(true);return n?.getAbsolutePosition();};
      const out=[];
      for(const time of [0.6,1.2,2,2.8,3.5,4.5,5.4]){
        const slider=document.querySelector('#timeSlider');slider.value=String(time);
        slider.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,70));
        const body=scene.meshes.find(mesh=>mesh.name.includes('SmartPhone_Body'));
        body?.computeWorldMatrix(true);
        const box=body?.getBoundingInfo().boundingBox;
        const center=body&&box?Vector3.TransformCoordinates(box.center,body.getWorldMatrix()):null;
        const right=pos('RightHand'),left=pos('LeftHand'),head=pos('Head');
        const rightIndex=pos('RightHandIndex1'),leftIndex=pos('LeftHandIndex1');
        out.push({time,center:center?.asArray(),right:right?.asArray(),left:left?.asArray(),
          head:head?.asArray(),rightIndex:rightIndex?.asArray(),leftIndex:leftIndex?.asArray(),
          phoneLength:box?Math.max(...box.maximumWorld.subtract(box.minimumWorld).asArray()):null,
          rightDistance:center&&right?Vector3.Distance(center,right):null,
          leftDistance:center&&left?Vector3.Distance(center,left):null,
          rightIndexDistance:center&&rightIndex?Vector3.Distance(center,rightIndex):null,
          leftIndexDistance:center&&leftIndex?Vector3.Distance(center,leftIndex):null,
          aboveHead:center&&head?center.y-head.y:null});
      }
      return out;
    })()`);
    console.log('Studio photo diagnostics',JSON.stringify(samples));
    await evaluate(`(() => {const slider=document.querySelector('#timeSlider');slider.value='2.4';
      slider.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  }
  await evaluate("document.querySelector('#saveProject').click(); true");
  if (process.env.STUDIO_BAKE_CAPTURE) {
    const shot=await send('Page.captureScreenshot',{format:'png'});
    await writeFile(process.env.STUDIO_BAKE_CAPTURE,Buffer.from(shot.result.data,'base64'));
  }
  await evaluate(`(() => {
    document.querySelector('#targetRightHand').click();
    const x=document.querySelector('#handTargetX');x.value=String(Number(x.value)+0.04);
    x.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('#applyHandTarget').click();
    document.querySelector('#showRightFingers').click();
    return true;
  })()`);
  const handEdit=await evaluate(`({status:document.querySelector('#studioStatus').textContent,
    filter:document.querySelector('#boneSearch').value,
    selection:document.querySelector('#selectionTitle').textContent})`);
  assert.ok(handEdit.status.includes('Brazo derecho ajustado') &&
    handEdit.filter==='righthand' && handEdit.selection.includes('mano right'),
    JSON.stringify(handEdit));
  await evaluate(`(() => {
    const finger=[...document.querySelectorAll('#boneList button')]
      .find(item=>item.textContent.includes('RightHandIndex1'));
    if(!finger)throw new Error('Index finger not found: '+
      [...document.querySelectorAll('#boneList button')].map(item=>item.textContent).slice(0,20));
    finger.click();
    const z=document.querySelector('#boneRotZ');z.value='18';
    z.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('#saveProject').click();
    return true;
  })()`);
  const edits=await evaluate(`(async () => {
    const blobs=globalThis.__studioBlobs;
    const before=JSON.parse(await blobs[blobs.length-2].text());
    const after=JSON.parse(await blobs[blobs.length-1].text());
    const key=session=>session.keys.find(item=>Math.abs(item.time-2.4)<0.001);
    const arm='mixamorig:RightArm',finger='mixamorig:RightHandIndex1';
    return {beforeArm:key(before)?.bones[arm],afterArm:key(after)?.bones[arm],
      afterFinger:key(after)?.bones[finger],keys:after.keys.length,
      propKeys:key(after)?.props,baseAnimationTime:after.baseAnimationTime};
  })()`);
  assert.ok(edits.keys>=25 && edits.afterFinger &&
    JSON.stringify(edits.beforeArm)!==JSON.stringify(edits.afterArm) &&
    Object.keys(edits.propKeys??{}).length===1 &&
    Number.isFinite(edits.baseAnimationTime),JSON.stringify(edits));
  assert.equal(errors.length, 0, errors.join(" | "));
  console.log(`Animation Studio V2: Lautaro, Fan 01 LOD1 (${fan.bones} bones), ` +
    `LOD2, Fan 04 near, Rina photo bake and hand editing, four views, boss actions, exports, and JSON reimport passed`);
} finally {
  socket?.close();
  browser.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
