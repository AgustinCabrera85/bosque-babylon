import "./studio.css";
import { AnimationStudio } from "./AnimationStudio";
const root = document.getElementById("studioCanvas");
if (!(root instanceof HTMLCanvasElement)) throw new Error("Canvas no disponible");
if (!import.meta.env.DEV) {
  const notice=document.getElementById("studioStatus");
  if (notice) notice.textContent="Animation Studio sólo está disponible en modo desarrollo (npm run dev).";
} else {
  const studio=new AnimationStudio(root);
  studio.initialize();
  Object.assign(window,{__animationStudioDebug:{
    prepareFanPhoto:(fanId:"fan_01"|"fan_02"|"fan_03"|"fan_04"|"fan_05")=>studio.prepareFanPhotoForAutomation(fanId),
    prepare:(preset:"fan_01"|"fan_02"|"fan_03"|"fan_04"|"fan_05"|"hermano-mayor",
      action:"rina-photo"|"boss-pickup"|"boss-attack",variant?:string)=>
      studio.prepareAnimationForAutomation(preset,action,variant),
    seek:(time:number)=>studio.seekForAutomation(time),
    focusPhone:(view:"stage"|"audience"|"side"="stage",radius?:number)=>
      studio.focusPhoneForAutomation(view,radius),
    orbit:(deltaAlpha:number,deltaBeta?:number,zoomFactor?:number)=>
      studio.orbitForAutomation(deltaAlpha,deltaBeta,zoomFactor),
    audit:()=>studio.runAnimationAudit(),
    report:()=>studio.getAnimationAuditReport(),
  }});
  window.addEventListener("pagehide",()=>studio.dispose(),{once:true});
}
