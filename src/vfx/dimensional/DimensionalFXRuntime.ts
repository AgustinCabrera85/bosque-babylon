import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { getDimensionalFX, type DimensionalFXId } from './catalog';
import { applyDimensionalUniforms, applyParamPatch, defaultDimensionalParams, PARAMETER_UNIFORMS, SURFACE_VERTEX, type DimensionalFXParams, type DimensionalFXParamsPatch } from './params';
import { loadDimensionalSource, type SourceVariant } from './source';

export interface DimensionalFXOptions extends SourceVariant {
  /** Tweak a copy; presets in the shared catalog are immutable. */
  params?: DimensionalFXParamsPatch;
  /** Pause effect time, not the game's scene clock. */
  paused?: boolean;
  /** Optional per-effect quality scaling for postprocessors (0.25..1). */
  resolutionRatio?: number;
}
export interface DimensionalFXHandle<T> {
  readonly value: T;
  readonly params: DimensionalFXParams;
  update(next: DimensionalFXParamsPatch): void;
  setPaused(paused: boolean): void;
  resetTime(): void;
  dispose(): void;
}

let nextInstance=0;
function ensureMode(id: DimensionalFXId, mode: 'surface'|'postprocess'|'projection') {
  const actual=getDimensionalFX(id).kind;
  if(actual!==mode)throw new Error(`${id}: mode ${actual} cannot be created as ${mode}`);
}
function createParams(id:DimensionalFXId, options:DimensionalFXOptions):DimensionalFXParams {
  const defaults=defaultDimensionalParams(id);
  if(options.params)applyParamPatch(defaults,options.params);
  return defaults;
}
function makeTicker(scene:Scene, pausedInitially:boolean, tick:(elapsed:number)=>void) {
  let elapsed=0,paused=pausedInitially,disposed=false;
  const observer=scene.onBeforeRenderObservable.add(()=>{
    if(disposed)return;
    if(!paused)elapsed+=Math.max(0,scene.getEngine().getDeltaTime())*.001;
    tick(elapsed);
  });
  return {
    setPaused(value:boolean){paused=value;},resetTime(){elapsed=0;tick(0);},
    dispose(){disposed=true;scene.onBeforeRenderObservable.remove(observer);},
  };
}
function registeredShader(name:string,source:string,withVertex:boolean):string {
  if(withVertex)Effect.ShadersStore[`${name}VertexShader`]=SURFACE_VERTEX;
  Effect.ShadersStore[`${name}FragmentShader`]=source;
  return name;
}
/** Returns a GPU material; assign value to one or more UV-mapped meshes. */
export async function createDimensionalSurface(
  scene:Scene,id:DimensionalFXId, options:DimensionalFXOptions={}
):Promise<DimensionalFXHandle<ShaderMaterial>> {
  ensureMode(id,'surface');
  const name=`dimensional_${id}_${++nextInstance}`;
  const fragment=await loadDimensionalSource(id,options);
  registeredShader(name,fragment,true);
  const alpha=id==='MdfGRX'||id==='XsXSWS';
  const material=new ShaderMaterial(name,scene,name,{
    attributes:['position','uv'], uniforms:['worldViewProjection',...PARAMETER_UNIFORMS],
    needAlphaBlending:alpha,
  });
  material.backFaceCulling=false;
  if(alpha)material.disableDepthWrite=true;
  const params=createParams(id,options);
  const tick=makeTicker(scene,!!options.paused,t=>{
    applyDimensionalUniforms(material,id,params,t,
      scene.getEngine().getRenderWidth(),scene.getEngine().getRenderHeight());
  });
  tick.resetTime();
  let disposed=false;
  return {value:material,params,
    update(next){applyParamPatch(params,next);},setPaused:tick.setPaused,resetTime:tick.resetTime,
    dispose(){if(disposed)return;disposed=true;tick.dispose();material.dispose();delete Effect.ShadersStore[`${name}VertexShader`];delete Effect.ShadersStore[`${name}FragmentShader`];}
  };
}
/** Applies the selected effect as a genuine Babylon postprocess over camera output. */
export async function createDimensionalPostProcess(
  scene:Scene,camera:Camera,id:DimensionalFXId,options:DimensionalFXOptions={}
):Promise<DimensionalFXHandle<PostProcess>> {
  ensureMode(id,'postprocess');
  const name=`dimensional_post_${id}_${++nextInstance}`;
  registeredShader(name,await loadDimensionalSource(id,options),false);
  const ratio=Math.max(.25,Math.min(1,options.resolutionRatio??1));
  const post=new PostProcess(name,name,[...PARAMETER_UNIFORMS],['textureSampler'],ratio,camera,
    Texture.BILINEAR_SAMPLINGMODE,scene.getEngine(),false);
  const params=createParams(id,options);
  let elapsed=0,paused=!!options.paused,disposed=false;
  const observer=scene.onBeforeRenderObservable.add(()=>{
    if(!paused)elapsed+=Math.max(0,scene.getEngine().getDeltaTime())*.001;
  });
  const postApply=post.onApplyObservable.add(effect=>applyDimensionalUniforms(
    effect,id,params,elapsed,post.width||scene.getEngine().getRenderWidth(),post.height||scene.getEngine().getRenderHeight()
  ));
  return {value:post,params,
    update(next){applyParamPatch(params,next);},setPaused(value){paused=value;},resetTime(){elapsed=0;},
    dispose(){if(disposed)return;disposed=true;scene.onBeforeRenderObservable.remove(observer);
      post.onApplyObservable.remove(postApply);post.dispose();delete Effect.ShadersStore[`${name}FragmentShader`];}
  };
}

export interface MeshProjection {
  readonly texture: ProceduralTexture;
  readonly meshes: readonly AbstractMesh[];
}
/**
 * Preserves the original PBR/Standard textures and rig animations by cloning materials,
 * adding the procedural texture as an emissive overlay. UV islands remain independent.
 * Original materials are restored when disposed.
 */
export async function createDimensionalProjection(
  scene:Scene,id:DimensionalFXId,meshes:readonly AbstractMesh[],options:DimensionalFXOptions={}
):Promise<DimensionalFXHandle<MeshProjection>> {
  ensureMode(id,'projection');
  const name=`dimensional_projection_${id}_${++nextInstance}`;
  Effect.ShadersStore[`${name}PixelShader`]=await loadDimensionalSource(id,options);
  const tex=new ProceduralTexture(name,512,name,scene,null,true,false);
  tex.refreshRate=1;
  tex.wrapU=Texture.WRAP_ADDRESSMODE;
  tex.wrapV=Texture.WRAP_ADDRESSMODE;
  const params=createParams(id,options);
  const originalMaterials=new Map<AbstractMesh,Material|null>();
  const clones=new Map<Material,Material>();
  const owned=new Set<Material>();
  const makeMaterial=(source:Material|null):Material|null=>{
    if(!source)return null;
    if(clones.has(source))return clones.get(source)!;
    if(source instanceof MultiMaterial) {
      const multi=new MultiMaterial(`${source.name}_dimensional`,scene);
      clones.set(source,multi);owned.add(multi);
      multi.subMaterials=source.subMaterials.map(m=>makeMaterial(m));
      return multi;
    }
    if(!(source instanceof PBRMaterial || source instanceof StandardMaterial))return source;
    const clone=source.clone(`${source.name}_dimensional`);
    if(!clone)return source;
    clones.set(source,clone);owned.add(clone);
    clone.emissiveTexture=tex;
    if(clone instanceof PBRMaterial)clone.emissiveIntensity=Math.max(0.01,params.intensity);
    return clone;
  };
  for(const mesh of meshes) {
    if(mesh.getTotalVertices()<=0)continue;
    originalMaterials.set(mesh,mesh.material);
    mesh.material=makeMaterial(mesh.material);
  }
  const ticker=makeTicker(scene,!!options.paused,elapsed=>{
    applyDimensionalUniforms(tex,id,params,elapsed,512,512);
    for(const m of owned)if(m instanceof PBRMaterial)m.emissiveIntensity=Math.max(0,params.intensity);
  });
  ticker.resetTime();
  let disposed=false;
  return {value:{texture:tex,meshes},params,
    update(next){applyParamPatch(params,next);},setPaused:ticker.setPaused,resetTime:ticker.resetTime,
    dispose(){if(disposed)return;disposed=true;ticker.dispose();
      for(const [mesh,original] of originalMaterials)if(!mesh.isDisposed())mesh.material=original;
      for(const material of owned)material.dispose(false,false);
      tex.dispose();delete Effect.ShadersStore[`${name}PixelShader`];}
  };
}
