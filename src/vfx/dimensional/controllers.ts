/** Reusable, deterministic timing controllers, independent from DOM or Babylon. */
export type Movement = 'fixed' | 'orbit' | 'organic';
export type Playback = 'manual' | 'auto';
export type Easing = 'linear' | 'smooth' | 'quick';
export interface ApertureSettings {
  playback: Playback;
  loop: boolean;
  opening: number;
  hold: number;
  closing: number;
  rest: number;
  easing: Easing;
  manualOpen: number;
  radius: number;
  softness: number;
  wobble: number;
  x: number;
  y: number;
  positionMode: Movement;
  moveX: number;
  moveY: number;
}
export interface ApertureFrame {
  x: number; y: number; open: number; radius: number;
  softness: number; wobble: number; phase: number;
  stage: 'manual' | 'abriendo' | 'abierta' | 'cerrando' | 'descanso' | 'finalizada';
  period: number;
}
export const COSMIC_APERTURE: ApertureSettings = {
  playback: 'auto', loop: true, opening: 2.4, hold: 3, closing: 2.2,
  rest: 1.5, easing: 'smooth', manualOpen: .85,
  radius: .14, softness: .28, wobble: .18, x: .5, y: .5,
  positionMode: 'fixed', moveX: .12, moveY: .08,
};
export const DARKNESS_APERTURE: ApertureSettings = {
  playback: 'auto', loop: true, opening: 3.2, hold: 5,
  closing: 2.8, rest: 1.8, easing: 'smooth', manualOpen: .8,
  radius: .6, softness: .38, wobble: .72, x: .5, y: .5,
  positionMode: 'fixed', moveX: .1, moveY: .07,
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));
function easing(v: number, mode: Easing): number {
  v=clamp(v, 0, 1);
  if(mode==='linear')return v;
  if(mode==='quick')return 1-Math.pow(1-v, 3);
  return v*v*(3-2*v);
}
/** Fixed periodic phase avoids the leftward drift previously seen in the cosmic shader. */
export function evaluateAperture(v: ApertureSettings, timeSeconds: number): ApertureFrame {
  const opening=clamp(v.opening,.05,60), hold=clamp(v.hold,0,60);
  const closing=clamp(v.closing,.05,60), rest=clamp(v.rest,0,60);
  const period=opening+hold+closing+rest;
  const elapsed=Math.max(0, timeSeconds);
  const raw=v.playback==='manual' ? 0 : v.loop ? elapsed % period : Math.min(elapsed,period);
  const phase=raw/period;
  let open=0;
  let stage:ApertureFrame['stage']='descanso';
  if(v.playback==='manual') {open=clamp(v.manualOpen,0,1);stage='manual';}
  else if(raw<opening) {open=easing(raw/opening,v.easing);stage='abriendo';}
  else if(raw<opening+hold) {open=1;stage='abierta';}
  else if(raw<opening+hold+closing) {open=1-easing((raw-opening-hold)/closing,v.easing);stage='cerrando';}
  else {stage=v.loop?'descanso':'finalizada';}
  const a=2*Math.PI*phase;
  let x=clamp(v.x,0,1), y=clamp(v.y,0,1);
  if(v.playback==='auto' && v.positionMode==='orbit') {
    x+=clamp(v.moveX,0,.4)*Math.sin(a);
    y+=clamp(v.moveY,0,.4)*(1-Math.cos(a));
  } else if(v.playback==='auto' && v.positionMode==='organic') {
    x+=clamp(v.moveX,0,.4)*(.7*Math.sin(a)+.3*Math.sin(2*a));
    y+=clamp(v.moveY,0,.4)*(.8*Math.sin(a)+.2*Math.sin(3*a));
  }
  return {
    x:clamp(x,0,1), y:clamp(y,0,1), open, phase, stage, period,
    radius:clamp(v.radius,.025,1.35), softness:clamp(v.softness,.005,.95),
    wobble:clamp(v.wobble,0,2),
  };
}
