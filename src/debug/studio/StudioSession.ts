/** Pure, browser-independent data layer. Studio keyframes store additive bone offsets. */
export type Vec3Data = [number, number, number];
export type QuatData = [number, number, number, number];
export type StudioTransform = { position: Vec3Data; rotation: QuatData; scaling: Vec3Data };
export type StudioPropSpec = {
  id: string;
  name: string;
  kind: "glb" | "box" | "sphere" | "cylinder";
  fileName: string | null;
  /** Null means under the imported character's root node. */
  boneName: string | null;
  defaultTransform: StudioTransform;
};
export type StudioKeyframe = {
  time: number;
  easing: "linear" | "smooth";
  /** Mixamo/glTF raw bone names; quaternion offsets relative to base animation. */
  bones: Record<string, QuatData>;
  props: Record<string, StudioTransform>;
};
export type StudioSession = {
  format: "bosque.animation-studio.session";
  version: 1;
  id: string;
  modelFile: string | null;
  modelScale: number;
  baseAnimation: string | null;
  /** Fixed clip sample while a photographed fan interrupts its prior action. */
  baseAnimationTime: number | null;
  duration: number;
  loop: boolean;
  keys: StudioKeyframe[];
  props: StudioPropSpec[];
};
export type ProceduralPoseJson = { id: string; source?: { model?: string; animation?: string; time?: number }; bones: Record<string, {rotationOffset: QuatData}> };
export type ProceduralDefinitionJson = {
  id: string;
  poses: Record<string, ProceduralPoseJson>;
  timeline: {time: number; poseId: string; easing: "linear" | "smooth"}[];
};
export type StudioRuntimeExport = {
  format: "bosque.animation-studio.runtime";
  version: 1;
  modelFile: string | null;
  baseAnimation: string | null;
  baseAnimationTime: number | null;
  duration: number;
  loop: boolean;
  animation: ProceduralDefinitionJson;
  props: StudioPropSpec[];
  propKeys: {time: number; easing: "linear" | "smooth"; props: Record<string, StudioTransform>}[];
};

const EPS = 1e-7;
export const IDENTITY: QuatData = [0, 0, 0, 1];
export function identityTransform(): StudioTransform {
  return {position: [0, 0, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1]};
}
export function newSession(): StudioSession {
  return {format: "bosque.animation-studio.session", version: 1,
    id: "pose_corrections", modelFile: null, modelScale: 1,
    baseAnimation: null, baseAnimationTime:null, duration: 3, loop: true, keys: [], props: []};
}
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
export function normalizeQuaternion(q: QuatData): QuatData {
  const magnitude = Math.hypot(...q);
  if (magnitude < EPS) return [...IDENTITY];
  const s = q[3] < 0 ? -1 / magnitude : 1 / magnitude;
  return [q[0]*s,q[1]*s,q[2]*s,q[3]*s];
}
export function slerp(a0: QuatData,b0: QuatData,t0: number): QuatData {
  const t=clamp(t0,0,1); const a=normalizeQuaternion(a0); const b=normalizeQuaternion(b0);
  let dot=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
  if(dot<0){dot=-dot; for(let i=0;i<4;i++) b[i]*=-1;}
  if(dot>0.9995) return normalizeQuaternion([
    a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,a[3]+(b[3]-a[3])*t]);
  const theta=Math.acos(clamp(dot,-1,1)); const sin=Math.sin(theta);
  const aw=Math.sin((1-t)*theta)/sin, bw=Math.sin(t*theta)/sin;
  return normalizeQuaternion([a[0]*aw+b[0]*bw,a[1]*aw+b[1]*bw,a[2]*aw+b[2]*bw,a[3]*aw+b[3]*bw]);
}
function lerp(a:number,b:number,t:number){return a+(b-a)*t;}
function lerpVec(a:Vec3Data,b:Vec3Data,t:number):Vec3Data {
  return [lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
}
function interpTransform(a:StudioTransform,b:StudioTransform,t:number):StudioTransform {
  return {position:lerpVec(a.position,b.position,t),rotation:slerp(a.rotation,b.rotation,t),scaling:lerpVec(a.scaling,b.scaling,t)};
}
export type StudioSample = {bones: Record<string,QuatData>; props:Record<string,StudioTransform>};
export function sampleSession(session:StudioSession,time:number):StudioSample {
  const keys=[...session.keys].sort((a,b)=>a.time-b.time);
  const baseProps=Object.fromEntries(session.props.map(p=>[p.id,p.defaultTransform]));
  if(!keys.length) return {bones:{},props:structuredClone(baseProps)};
  const t=clamp(time,0,session.duration);
  let before:StudioKeyframe|null=null; let after:StudioKeyframe|null=null;
  if(t<=keys[0].time){after=keys[0];if(keys[0].time<=EPS)before=keys[0];}
  else if(t>=keys[keys.length-1].time){before=keys[keys.length-1];after=before;}
  else {
    for(let i=1;i<keys.length;i++) if(t<=keys[i].time){before=keys[i-1];after=keys[i];break;}
  }
  if(!after) after=keys[keys.length-1];
  const startTime=before?.time??0;
  const raw=(t-startTime)/Math.max(EPS,after.time-startTime);
  const linear=before===after ? 1:clamp(raw,0,1);
  const factor=after.easing==="smooth" ? linear*linear*(3-2*linear):linear;
  const bones:Record<string,QuatData>={};
  const allBones=new Set([...Object.keys(before?.bones??{}),...Object.keys(after.bones)]);
  for(const name of allBones){
    const q=slerp(before?.bones[name]??IDENTITY,after.bones[name]??IDENTITY,factor);
    if(Math.abs(q[0])+Math.abs(q[1])+Math.abs(q[2])+Math.abs(q[3]-1)>1e-6) bones[name]=q;
  }
  const props:Record<string,StudioTransform>={};
  const allIds=new Set([...Object.keys(baseProps),...Object.keys(before?.props??{}),...Object.keys(after.props)]);
  for(const id of allIds){
    const p=before?.props[id]??baseProps[id]??identityTransform();
    const n=after.props[id]??baseProps[id]??identityTransform();
    props[id]=interpTransform(p,n,factor);
  }
  return {bones,props};
}
export function upsertKey(session:StudioSession,key:StudioKeyframe):StudioKeyframe {
  const fixed={...key,time:Math.round(clamp(key.time,0,session.duration)*1000)/1000};
  const existing=session.keys.findIndex(k=>Math.abs(k.time-fixed.time)<0.0005);
  if(existing>=0)session.keys[existing]=fixed; else session.keys.push(fixed);
  session.keys.sort((a,b)=>a.time-b.time);
  return fixed;
}
export function exportRuntime(session:StudioSession):StudioRuntimeExport {
  const poses:ProceduralDefinitionJson["poses"]={};
  const timeline:ProceduralDefinitionJson["timeline"]=[];
  const keys=[...session.keys].sort((a,b)=>a.time-b.time);
  // The existing ProceduralAnimationPlayer takes duration from its final key.
  // Hold the last pose until the studio clip endpoint to preserve looping cadence.
  if(keys.length&&keys[keys.length-1].time<session.duration-0.0005){
    const last=keys[keys.length-1];
    keys.push({...last,time:session.duration,easing:"linear"});
  }
  for(let i=0;i<keys.length;i++){
    const key=keys[i]; const poseId=Object.keys(key.bones).length ? `studio_key_${String(i).padStart(3,"0")}`:"neutral";
    if(poseId!=="neutral"){
      poses[poseId]={id:poseId,source:{model:session.modelFile??undefined,animation:session.baseAnimation??undefined,time:key.time},
        bones:Object.fromEntries(Object.entries(key.bones).map(([name,rotationOffset])=>[name,{rotationOffset:normalizeQuaternion(rotationOffset)}]))};
    }
    timeline.push({time:key.time,poseId,easing:key.easing});
  }
  if(!timeline.length)timeline.push({time:0,poseId:"neutral",easing:"linear"});
  return {
    format:"bosque.animation-studio.runtime",version:1,modelFile:session.modelFile,
    baseAnimation:session.baseAnimation,baseAnimationTime:session.baseAnimationTime,
    duration:session.duration,loop:session.loop,
    animation:{id:session.id||"pose_corrections",poses,timeline},
    props:structuredClone(session.props),
    propKeys:keys.map(k=>({time:k.time,easing:k.easing,props:structuredClone(k.props)})),
  };
}
/** Validate user-authored JSON before handing to Babylon. Reject invalid quaternion and time values. */
export function readSession(input:unknown):StudioSession {
  if(!input||typeof input!=="object")throw new Error("El JSON no contiene una sesión de Studio.");
  const x=input as Partial<StudioSession>;
  if(x.format!=="bosque.animation-studio.session"||x.version!==1)throw new Error("Formato/versión de sesión no reconocidos.");
  if(!Array.isArray(x.keys)||!Array.isArray(x.props))throw new Error("La sesión debe tener arrays 'keys' y 'props'.");
  if(x.keys.length>2000||x.props.length>200)throw new Error("Sesión demasiado grande.");
  const duration=clamp(Number(x.duration),0.1,600);
  const vec=(candidate:unknown,fallback:Vec3Data):Vec3Data=>Array.isArray(candidate)&&candidate.length===3&&candidate.every(n=>typeof n==="number"&&Number.isFinite(n)) ? [candidate[0],candidate[1],candidate[2]]: [...fallback];
  const quat=(candidate:unknown):QuatData=>Array.isArray(candidate)&&candidate.length===4&&candidate.every(n=>typeof n==="number"&&Number.isFinite(n))?normalizeQuaternion([candidate[0],candidate[1],candidate[2],candidate[3]]):[...IDENTITY];
  const tx=(candidate:unknown):StudioTransform=>{const t=(candidate&&typeof candidate==="object"?candidate:{}) as Partial<StudioTransform>;
    return {position:vec(t.position,[0,0,0]),rotation:quat(t.rotation),scaling:vec(t.scaling,[1,1,1])};};
  const props:StudioPropSpec[]=x.props.map((p,index)=>{if(!p||typeof p!=="object")throw new Error(`Accesorio inválido ${index}`);
    const prop=p as StudioPropSpec;return {id:String(prop.id??`prop_${index}`).slice(0,80),name:String(prop.name??`Prop ${index}`).slice(0,120),
      kind:["glb","box","sphere","cylinder"].includes(prop.kind)?prop.kind:"box",
      fileName:typeof prop.fileName==="string"?prop.fileName.slice(0,260):null,
      boneName:typeof prop.boneName==="string"?prop.boneName.slice(0,240):null,defaultTransform:tx(prop.defaultTransform)};});
  const ids=new Set<string>(); for(const p of props){if(ids.has(p.id))throw new Error(`ID de accesorio duplicado: ${p.id}`);ids.add(p.id);}
  const keys:StudioKeyframe[]=x.keys.map((k,i)=>{if(!k||typeof k!=="object")throw new Error(`Keyframe inválido ${i}`);
    if(typeof k.time!=="number"||!Number.isFinite(k.time)||k.time<0||k.time>duration)throw new Error(`Tiempo inválido en keyframe ${i}`);
    const bones:StudioKeyframe["bones"]={};
    if(k.bones&&typeof k.bones==="object")for(const [name,rotation] of Object.entries(k.bones))bones[name]=quat(rotation);
    const keyProps:StudioKeyframe["props"]={};
    if(k.props&&typeof k.props==="object")for(const [id,t] of Object.entries(k.props))if(ids.has(id))keyProps[id]=tx(t);
    return {time:k.time,easing:k.easing==="smooth"?"smooth":"linear",bones,props:keyProps};});
  keys.sort((a,b)=>a.time-b.time);
  if(keys.some((k,i)=>i>0&&Math.abs(k.time-keys[i-1].time)<0.0005))throw new Error("Hay keyframes duplicados en el mismo instante.");
  return {format:"bosque.animation-studio.session",version:1,
    id:String(x.id??"pose_corrections").slice(0,120),modelFile:typeof x.modelFile==="string"?x.modelFile:null,
    modelScale:clamp(Number(x.modelScale??1),0.001,100),baseAnimation:typeof x.baseAnimation==="string"?x.baseAnimation:null,
    baseAnimationTime:typeof x.baseAnimationTime==="number"?clamp(x.baseAnimationTime,0,600):null,
    duration,loop:Boolean(x.loop),props,keys};
}
/** Import either an editable session, the studio runtime bundle, or a native game ProceduralAnimationDefinition. */
export function importStudioJson(input:unknown, fallback?:{modelFile?:string|null;baseAnimation?:string|null;modelScale?:number}):StudioSession {
  if(!input||typeof input!=="object")throw Error("El archivo JSON no contiene un objeto.");
  const raw=input as Record<string,unknown>;
  if(raw.format==="bosque.animation-studio.session")return readSession(input);
  const base=newSession();
  base.modelFile=fallback?.modelFile??null;base.baseAnimation=fallback?.baseAnimation??null;
  base.modelScale=fallback?.modelScale??1;
  let definition:unknown=input;
  let props:unknown=[];
  let propKeys:unknown=[];
  if(raw.format==="bosque.animation-studio.runtime"){
    base.modelFile=typeof raw.modelFile==="string"?raw.modelFile:base.modelFile;
    base.baseAnimation=typeof raw.baseAnimation==="string"?raw.baseAnimation:base.baseAnimation;
    base.baseAnimationTime=typeof raw.baseAnimationTime==="number"?clamp(raw.baseAnimationTime,0,600):null;
    base.loop=Boolean(raw.loop);
    definition=raw.animation;
    props=raw.props;propKeys=raw.propKeys;
  }
  const d=definition as Partial<ProceduralDefinitionJson>|null;
  if(!d||typeof d!=="object"||typeof d.id!=="string"||!Array.isArray(d.timeline)||!d.poses||typeof d.poses!=="object"){
    throw Error("No es un StudioSession ni un ProceduralAnimationDefinition válido.");
  }
  if(d.timeline.length>2000)throw Error("Demasiados keyframes para importar.");
  base.id=d.id;
  if(Array.isArray(props)){
    const p=props as StudioPropSpec[];
    // Reuse strict validator for user-provided spec and transform payloads.
    base.props=readSession({...base,props:p}).props;
  }
  const track=Array.isArray(propKeys)?propKeys as {time:number;props:Record<string,StudioTransform>}[]:[];
  for(let index=0;index<d.timeline.length;index++){
    const key=d.timeline[index];
    if(!key||!Number.isFinite(key.time)||key.time<0||key.time>600)throw Error(`Tiempo inválido en key ${index}`);
    const pose=key.poseId==="neutral"?null:d.poses[key.poseId];
    if(key.poseId!=="neutral"&&!pose)throw Error(`La pose '${key.poseId}' no existe en el JSON.`);
    const bones:Record<string,QuatData>={};
    if(pose)for(const [name,entry] of Object.entries(pose.bones??{})){
      if(!entry||!Array.isArray(entry.rotationOffset)||entry.rotationOffset.length!==4)continue;
      const q=entry.rotationOffset;
      if(!q.every(n=>typeof n==="number"&&Number.isFinite(n)))continue;
      bones[name]=normalizeQuaternion([...q] as QuatData);
    }
    const propStep=track.find(s=>Math.abs(s.time-key.time)<0.0005);
    base.keys.push({time:key.time,easing:key.easing==="smooth"?"smooth":"linear",bones,props:propStep?.props??{}});
  }
  const lastTime=base.keys.reduce((max,k)=>Math.max(max,k.time),0);
  base.duration=clamp(typeof raw.duration==="number"?raw.duration:lastTime||3,0.1,600);
  return readSession(base);
}
