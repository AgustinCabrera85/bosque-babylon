import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector2 } from '@babylonjs/core/Maths/math.vector';
import type { Effect } from '@babylonjs/core/Materials/effect';
import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import type { ProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture';
import type { DimensionalFXId } from './catalog';
import { getDimensionalFX } from './catalog';
import { evaluateAperture, COSMIC_APERTURE, DARKNESS_APERTURE, type ApertureSettings } from './controllers';

export interface DimensionalFXParams {
  intensity: number; speed: number; scale: number; progress: number;
  colorA: string; colorB: string;
  branchWidth: number; branchDensity: number; growthSpread: number;
  gridSpeed: number; reflection: number;
  sunGlow: number; sunGlowRadius: number; sunRimWidth: number;
  sunTopColor: string; sunBottomColor: string; sunHaloColor: string;
  cosmicAperture: ApertureSettings; darknessAperture: ApertureSettings;
}
export type DimensionalFXParamsPatch = Partial<Omit<DimensionalFXParams,'cosmicAperture'|'darknessAperture'>> & {
  cosmicAperture?: Partial<ApertureSettings>; darknessAperture?: Partial<ApertureSettings>;
};
export const PARAMETER_UNIFORMS = [
  'uTime','uIntensity','uScale','uSpeed','uProgress','uAspect','uResolution','uColorA','uColorB',
  'uBranchWidth','uBranchDensity','uGrowthSpread','uGridSpeed','uReflection','uSunGlow','uSunGlowRadius','uSunRimWidth',
  'uSunTopColor','uSunBottomColor','uSunHaloColor','uVoidCenter','uVoidRadius','uVoidOpen','uVoidSoftness','uVoidPhase','uVoidWobble',
  'uDarkCenter','uDarkRadius','uDarkOpen','uDarkSoftness','uDarkPhase','uDarkWobble',
] as const;
export const SURFACE_VERTEX = `precision highp float;
attribute vec3 position; attribute vec2 uv;
uniform mat4 worldViewProjection; varying vec2 vUV;
void main(void){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}`;

export function defaultDimensionalParams(id: DimensionalFXId): DimensionalFXParams {
  const e=getDimensionalFX(id);
  return {
    intensity:e.intensity, speed:e.speed, scale:e.scale, progress:e.progress,
    colorA:e.colors[0], colorB:e.colors[1],
    branchWidth:.72, branchDensity:1.35, growthSpread:.75,
    gridSpeed:id==='lX2GzD'?2.3:1.7, reflection:id==='lX2GzD'?.6:1.25,
    sunGlow:id==='lX2GzD'?1.4:1.15, sunGlowRadius:id==='lX2GzD'?1.35:1.15,
    sunRimWidth:id==='lX2GzD'?.65:1,
    sunTopColor:id==='lX2GzD'?'#fff5bc':'#ffe2a2',
    sunBottomColor:id==='lX2GzD'?'#ffb0bd':'#ff347f',
    sunHaloColor:id==='lX2GzD'?'#ff19b9':'#ff7fd9',
    cosmicAperture:{...COSMIC_APERTURE}, darknessAperture:{...DARKNESS_APERTURE},
  };
}
type UniformTarget = Effect | ShaderMaterial | ProceduralTexture;
function color(hex:string):Color3{try{return Color3.FromHexString(hex);}catch{return Color3.White();}}
/** Uniforms are per-effect instance, never global shader state. */
export function applyDimensionalUniforms(target: UniformTarget, id:DimensionalFXId, p:DimensionalFXParams, time:number, width:number, height:number):void {
  const aspect=id==='lX2GzD'?16/9:id==='ldK3RW'?1:width/Math.max(1,height);
  target.setFloat('uTime',time);
  target.setFloat('uIntensity',p.intensity); target.setFloat('uScale',p.scale);
  target.setFloat('uSpeed',p.speed); target.setFloat('uProgress',p.progress);
  target.setFloat('uAspect',aspect);
  target.setVector2('uResolution',new Vector2(width,height));
  target.setColor3('uColorA',color(p.colorA)); target.setColor3('uColorB',color(p.colorB));
  target.setFloat('uBranchWidth',p.branchWidth); target.setFloat('uBranchDensity',p.branchDensity);
  target.setFloat('uGrowthSpread',p.growthSpread); target.setFloat('uGridSpeed',p.gridSpeed);
  target.setFloat('uReflection',p.reflection); target.setFloat('uSunGlow',p.sunGlow);
  target.setFloat('uSunGlowRadius',p.sunGlowRadius); target.setFloat('uSunRimWidth',p.sunRimWidth);
  target.setColor3('uSunTopColor',color(p.sunTopColor));
  target.setColor3('uSunBottomColor',color(p.sunBottomColor));
  target.setColor3('uSunHaloColor',color(p.sunHaloColor));
  // Keep all uniforms initialized even if the selected variant doesn't use them.
  const cosmic=evaluateAperture(p.cosmicAperture,time);
  target.setVector2('uVoidCenter',new Vector2(cosmic.x,cosmic.y));
  target.setFloat('uVoidRadius',cosmic.radius);target.setFloat('uVoidOpen',cosmic.open);
  target.setFloat('uVoidSoftness',cosmic.softness);target.setFloat('uVoidPhase',cosmic.phase);
  target.setFloat('uVoidWobble',cosmic.wobble);
  const darkness=evaluateAperture(p.darknessAperture,time);
  target.setVector2('uDarkCenter',new Vector2(darkness.x,darkness.y));
  target.setFloat('uDarkRadius',darkness.radius);target.setFloat('uDarkOpen',darkness.open);
  target.setFloat('uDarkSoftness',darkness.softness);target.setFloat('uDarkPhase',darkness.phase);
  target.setFloat('uDarkWobble',darkness.wobble);
}
/** Patch settings without inadvertently sharing the mutable controller objects between instances. */
export function applyParamPatch(target:DimensionalFXParams, patch:DimensionalFXParamsPatch):void {
  const {cosmicAperture,darknessAperture,...other}=patch;
  Object.assign(target,other);
  if(cosmicAperture)Object.assign(target.cosmicAperture,cosmicAperture);
  if(darknessAperture)Object.assign(target.darknessAperture,darknessAperture);
}
