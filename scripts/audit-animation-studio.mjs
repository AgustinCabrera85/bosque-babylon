/** Reproducible visual and geometric audit of procedural clips in Animation Studio.
 * Run Vite first, then: node scripts/audit-animation-studio.mjs --preset fan_01 --out .studio-audit
 * Options: --action rina-photo|boss-pickup|boss-attack, --variant lod1|source|near,
 *          --times 0.6,1.2,2,3.5, --strict, --out DIRECTORY, --closeups,
 *          --closeup-radius 0.65.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
const preset=option("--preset","fan_01");
const action=option("--action",preset==="hermano-mayor"?"boss-pickup":"rina-photo");
const variant=option("--variant","lod1");
const times=option("--times",action==="rina-photo"?"0.6,1.2,2,2.8,3.5,4.5":"")
  .split(",").filter(Boolean).map(Number);
const out=option("--out",null);
const strict=args.includes("--strict");
const closeups=args.includes("--closeups");
const closeupRadius=Number(option("--closeup-radius","0.65"));
assert.ok(["fan_01","fan_02","fan_03","fan_04","fan_05","hermano-mayor"].includes(preset),"Unknown preset");
assert.ok(["rina-photo","boss-pickup","boss-attack"].includes(action),"Unknown action");
assert.ok(times.every(Number.isFinite),"Invalid --times");
assert.ok(Number.isFinite(closeupRadius)&&closeupRadius>=0.25&&closeupRadius<=2,
  "--closeup-radius must be between 0.25 and 2 metres");
const server=await fetch("http://localhost:5173/animation-studio.html").catch(()=>null);
assert.ok(server?.ok,"Start the dev server first: npm run dev");
const candidates=[process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
let executable;
for(const candidate of candidates){try{await access(candidate);executable=candidate;break;}catch{/* next */}}
assert.ok(executable,"Chrome or Edge is required");
const profile=await mkdtemp(join(tmpdir(),"bosque-studio-audit-"));
const port=9600+Math.floor(Math.random()*300);
const browser=spawn(executable,["--headless=new","--no-first-run","--no-sandbox",
  "--enable-unsafe-swiftshader",`--remote-debugging-port=${port}`,
  `--user-data-dir=${join(profile,"chrome")}`,"about:blank"],
{stdio:"ignore",windowsHide:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;
try{
  let target;
  for(let i=0;i<100&&!target;i++){
    try{const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
      target=tabs.find(tab=>tab.type==="page")?.webSocketDebuggerUrl;}catch{/* launching */}
    if(!target)await delay(100);
  }
  assert.ok(target,"Chrome DevTools did not start");
  socket=new WebSocket(target);
  await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});
    socket.addEventListener("error",reject,{once:true});});
  let serial=0;
  const pending=new Map(),errors=[];
  socket.addEventListener("message",event=>{
    const message=JSON.parse(event.data);
    if(message.method==="Runtime.exceptionThrown")errors.push(
      message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
    if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}
  });
  const send=(method,params={})=>new Promise(resolve=>{const id=++serial;pending.set(id,resolve);
    socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const result=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if(result.result?.exceptionDetails)throw Error(result.result.exceptionDetails.exception?.description??
      JSON.stringify(result.result.exceptionDetails));
    return result.result?.result?.value;
  };
  await send("Page.enable");await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride",{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:"http://localhost:5173/animation-studio.html"});
  let ready=false;
  for(let i=0;i<120&&!ready;i++){
    ready=await evaluate("!!globalThis.__animationStudioDebug");
    if(!ready)await delay(250);
  }
  assert.ok(ready,`Animation Studio did not initialize: ${errors.join(" | ")}`);
  await evaluate(`globalThis.__animationStudioDebug.prepare(${JSON.stringify(preset)},
    ${JSON.stringify(action)},${JSON.stringify(variant)})`);
  const report=await evaluate("globalThis.__animationStudioDebug.audit()");
  assert.ok(report?.samples?.length,`No keyframes audited: ${errors.join(" | ")}`);
  console.log(`${preset} · ${variant} · ${action} · ${report.samples.length} keyframes · ${report.issues.length} observations`);
  for(const issue of report.issues.slice(0,12))console.log(`  ${issue.time.toFixed(2)}s [${issue.kind}] ${issue.message}`);
  if(report.issues.length>12)console.log(`  ... ${report.issues.length-12} more in JSON report`);
  if(out){
    const directory=resolve(out);await mkdir(directory,{recursive:true});
    const stem=`${preset}-${variant}-${action}`;
    await writeFile(join(directory,`${stem}.audit.json`),JSON.stringify(report,null,2));
    await evaluate("document.querySelector('#toggleInspection').click(); true");
    for(const time of times){
      await evaluate(`globalThis.__animationStudioDebug.seek(${time})`);
      await delay(170);
      const shot=await send("Page.captureScreenshot",{format:"png"});
      await writeFile(join(directory,`${stem}-${time.toFixed(2)}s.png`),
        Buffer.from(shot.result.data,"base64"));
    }
    if(closeups){
      await evaluate("document.querySelector('#toggleMultiView').click(); true");
      for(const time of times){
        await evaluate(`globalThis.__animationStudioDebug.seek(${time})`);
        for(const view of ["stage","audience","side"]){
          await evaluate(`globalThis.__animationStudioDebug.focusPhone(${JSON.stringify(view)},${closeupRadius})`);
          await delay(120);
          const shot=await send("Page.captureScreenshot",{format:"png"});
          await writeFile(join(directory,`${stem}-${time.toFixed(2)}s-${view}-close.png`),
            Buffer.from(shot.result.data,"base64"));
        }
        for(const [view,angle] of [["oblique-left",-0.55],["oblique-right",0.55]]){
          await evaluate(`globalThis.__animationStudioDebug.focusPhone("audience",${closeupRadius})`);
          await evaluate(`globalThis.__animationStudioDebug.orbit(${angle},-0.10,1)`);
          await delay(120);
          const shot=await send("Page.captureScreenshot",{format:"png"});
          await writeFile(join(directory,`${stem}-${time.toFixed(2)}s-${view}-close.png`),
            Buffer.from(shot.result.data,"base64"));
        }
      }
    }
    console.log(`Report and ${times.length} four-view captures saved to ${directory}`);
  }
  assert.equal(errors.length,0,errors.join(" | "));
  if(strict&&report.issues.length)process.exitCode=1;
}finally{
  socket?.close();browser.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
