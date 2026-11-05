import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import etherealVertex from './shaders/ethereal.vertex.inject.glsl?raw';
import etherealDefinitions from './shaders/ethereal.definitions.glsl?raw';
import etherealFragment from './shaders/ethereal.fragment.inject.glsl?raw';

/** Adaptation, not a direct port of the original SDF/raymarch Ethereal Solids. */
export interface EtherealOptions {
 dissolve:number; energy:number; noiseScale:number; noiseSpeed:number;
 edgeWidth:number;edgeGlow:number;warp:number;shimmer:number;stripes:number;
 hueA:string;hueB:string;
}
export const ETHEREAL_OPTIONS:Readonly<EtherealOptions>={
 dissolve:.16,energy:.74,noiseScale:1.95,noiseSpeed:.42,edgeWidth:.12,
 edgeGlow:2.4,warp:.095,shimmer:1.1,stripes:8,hueA:'#b86cff',hueB:'#54e0ff',
};
let nextPlugin=0;
class EtherealMaterialPlugin extends MaterialPluginBase {
  private readonly clock:{time:number};
  private readonly state:EtherealOptions;
  constructor(material:PBRMaterial,state:EtherealOptions,clock:{time:number}) {
    super(material,`EtherealMeshFX_${++nextPlugin}`,160,{DIM_ETHEREAL:true},true,true);
    this.state=state;this.clock=clock;
  }
  getClassName():string {return 'DimensionalEtherealPBRPlugin';}
  getUniforms(){return {ubo:[
    {name:'fxTime',size:1,type:'float'},
    {name:'fxDissolve',size:1,type:'float'},
    {name:'fxEnergy',size:1,type:'float'},
    {name:'fxNoiseScale',size:1,type:'float'},
    {name:'fxSpeed',size:1,type:'float'},
    {name:'fxEdgeWidth',size:1,type:'float'},
    {name:'fxEdgeGlow',size:1,type:'float'},
    {name:'fxWarp',size:1,type:'float'},
    {name:'fxShimmer',size:1,type:'float'},
    {name:'fxStripes',size:1,type:'float'},
    {name:'fxColorA',size:3,type:'vec3'},
    {name:'fxColorB',size:3,type:'vec3'},
  ]};}
  getCustomCode(shaderType:string): { [pointName:string]:string } | null {
    if(shaderType==='vertex')return {CUSTOM_VERTEX_UPDATE_POSITION:etherealVertex};
    if(shaderType==='fragment')return {
      CUSTOM_FRAGMENT_DEFINITIONS:etherealDefinitions,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR:etherealFragment,
    };
    return null;
  }
  bindForSubMesh(ubo:UniformBuffer):void {
    const s=this.state;
    ubo.updateFloat('fxTime',this.clock.time);
    ubo.updateFloat('fxDissolve',s.dissolve);ubo.updateFloat('fxEnergy',s.energy);
    ubo.updateFloat('fxNoiseScale',s.noiseScale);ubo.updateFloat('fxSpeed',s.noiseSpeed);
    ubo.updateFloat('fxEdgeWidth',s.edgeWidth);ubo.updateFloat('fxEdgeGlow',s.edgeGlow);
    ubo.updateFloat('fxWarp',s.warp);ubo.updateFloat('fxShimmer',s.shimmer);
    ubo.updateFloat('fxStripes',s.stripes);
    ubo.updateColor3('fxColorA',Color3.FromHexString(s.hueA));
    ubo.updateColor3('fxColorB',Color3.FromHexString(s.hueB));
  }
}
export class EtherealMeshFX {
  readonly params:EtherealOptions;
  private readonly originals=new Map<AbstractMesh, Material|null>();
  private readonly cloned=new Map<Material,Material>();
  private readonly owned=new Set<Material>();
  private readonly clock={time:0};
  private paused=false;
  private disposed=false;
  private readonly observer:Observer<Scene>;
  constructor(private readonly scene:Scene,meshes:readonly AbstractMesh[],options:Partial<EtherealOptions>={}){
    this.params={...ETHEREAL_OPTIONS,...options};
    const clone=(material:Material|null):Material|null=>{
      if(!material)return null;
      const prev=this.cloned.get(material);if(prev)return prev;
      if(material instanceof MultiMaterial){
        const multi=new MultiMaterial(`${material.name}_ethereal`,scene);
        this.cloned.set(material,multi);this.owned.add(multi);
        multi.subMaterials=material.subMaterials.map(m=>clone(m));
        return multi;
      }
      if(!(material instanceof PBRMaterial))return material;
      const cloned=material.clone(`${material.name}_ethereal`);
      if(!cloned)return material;
      this.cloned.set(material,cloned);this.owned.add(cloned);
      new EtherealMaterialPlugin(cloned,this.params,this.clock);
      return cloned;
    };
    for(const mesh of meshes){
      if(mesh.getTotalVertices()<=0)continue;
      this.originals.set(mesh,mesh.material);
      mesh.material=clone(mesh.material);
    }
    this.observer=scene.onBeforeRenderObservable.add(()=>{
      if(!this.paused)this.clock.time+=Math.max(0,scene.getEngine().getDeltaTime())*.001;
    });
  }
  update(next:Partial<EtherealOptions>):void{Object.assign(this.params,next);}
  setPaused(value:boolean):void{this.paused=value;}
  dispose():void{
    if(this.disposed)return;this.disposed=true;
    for(const [mesh,material] of this.originals)if(!mesh.isDisposed())mesh.material=material;
    for(const m of this.owned)m.dispose(false,false);
    this.scene.onBeforeRenderObservable.remove(this.observer);
  }
}
