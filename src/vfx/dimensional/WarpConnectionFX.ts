import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Axis } from '@babylonjs/core/Maths/math.axis';
import { Scalar } from '@babylonjs/core/Maths/math.scalar';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import warpVertex from './shaders/warp.vertex.glsl?raw';
import warpFragment from './shaders/warp.fragment.glsl?raw';

/** Connected 3D volume for the eye's gaze / Rina absorption. Rendering only; no sanity logic. */
export interface WarpOptions {
  speed:number; spin:number; turbulence:number; radius:number;
  opacity:number; filaments:number; ringDensity:number; intensity:number;
  colorA:string; colorB:string;
}
export const WARP_OPTIONS:Readonly<WarpOptions>={
  speed:1.35,spin:.7,turbulence:.62,radius:1.05,opacity:.82,
  filaments:8,ringDensity:12,intensity:1,colorA:'#9e4ee8',colorB:'#5eb9ef',
};
let counter=0;
function buildShell(scene:Scene,name:string):Mesh {
  const radial=32,axial=48;
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(let i=0;i<=axial;i++){
    const t=i/axial;
    const f=Math.pow(Math.max(0,Math.sin(t*Math.PI)),.62);
    const r=.08+.92*f;
    for(let j=0;j<=radial;j++){
      const a=2*Math.PI*j/radial;
      positions.push(t-.5,Math.cos(a)*r,Math.sin(a)*r);
      uvs.push(t,j/radial);
    }
  }
  for(let i=0;i<axial;i++)for(let j=0;j<radial;j++){
    const n=i*(radial+1)+j;
    indices.push(n,n+1,n+radial+1,n+1,n+radial+2,n+radial+1);
  }
  const mesh=new Mesh(name,scene);
  const data=new VertexData();data.positions=positions;data.uvs=uvs;data.indices=indices;
  data.applyToMesh(mesh);mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;
  return mesh;
}
export class WarpConnectionFX {
  readonly options:WarpOptions;
  readonly shells:Mesh[]=[];
  readonly materials:ShaderMaterial[]=[];
  private readonly name:string;
  private from=new Vector3(-3,1.5,0);
  private to=new Vector3(3,1.2,0);
  private elapsed=0;
  private paused=false;
  private disposed=false;
  private readonly observer:Observer<Scene>;
  constructor(private readonly scene:Scene, options:Partial<WarpOptions>={}) {
    this.options={...WARP_OPTIONS,...options};
    this.name=`dimensional_warp_${++counter}`;
    Effect.ShadersStore[`${this.name}VertexShader`]=warpVertex;
    Effect.ShadersStore[`${this.name}FragmentShader`]=warpFragment;
    for(let i=0;i<3;i++){
      const mesh=buildShell(scene,`${this.name}_shell_${i}`);
      const mat=new ShaderMaterial(`${this.name}_mat_${i}`,scene,this.name,{
        attributes:['position','uv'],uniforms:['worldViewProjection','uTime','uSpin','uSpeed','uTurbulence',
          'uLayer','uOpacity','uFilaments','uRingDensity','uIntensity','uColorA','uColorB'],
        needAlphaBlending:true,
      });
      mat.backFaceCulling=false;mat.disableDepthWrite=true;
      mesh.material=mat;mesh.renderingGroupId=2;
      this.shells.push(mesh);this.materials.push(mat);
    }
    this.observer=scene.onBeforeRenderObservable.add(()=>this.update());
    this.update();
  }
  setEndpoints(from:Vector3,to:Vector3):void {this.from.copyFrom(from);this.to.copyFrom(to);this.updateTransform();}
  setVisible(visible:boolean):void {for(const mesh of this.shells)mesh.isVisible=visible;}
  setPaused(paused:boolean):void {this.paused=paused;}
  updateOptions(next:Partial<WarpOptions>):void {Object.assign(this.options,next);this.updateTransform();}
  private updateTransform():void {
    const delta=this.to.subtract(this.from), len=Math.max(.001,delta.length());
    const dir=delta.scale(1/len);
    const dot=Scalar.Clamp(Vector3.Dot(Axis.X,dir),-1,1);
    const rot=dot>.99999?Quaternion.Identity():dot<-.99999?Quaternion.RotationAxis(Axis.Y,Math.PI):
      Quaternion.RotationAxis(Vector3.Cross(Axis.X,dir).normalize(),Math.acos(dot));
    const center=Vector3.Center(this.from,this.to);
    this.shells.forEach((mesh,i)=>{
      const radius=this.options.radius*(.94+i*.22);
      mesh.position.copyFrom(center);mesh.rotationQuaternion=rot;
      mesh.scaling.set(len,radius,radius);
    });
  }
  private update():void {
    if(this.disposed)return;
    if(!this.paused)this.elapsed+=Math.max(0,this.scene.getEngine().getDeltaTime())*.001;
    this.updateTransform();
    this.materials.forEach((mat,i)=>{
      const s=this.options;
      mat.setFloat('uTime',this.elapsed);mat.setFloat('uSpin',s.spin);
      mat.setFloat('uSpeed',s.speed);mat.setFloat('uTurbulence',s.turbulence);
      mat.setFloat('uLayer',i*.87);mat.setFloat('uOpacity',s.opacity*[1,.63,.4][i]);
      mat.setFloat('uFilaments',s.filaments+i*2);mat.setFloat('uRingDensity',s.ringDensity*(1-i*.12));
      mat.setFloat('uIntensity',s.intensity);
      mat.setColor3('uColorA',Color3.FromHexString(s.colorA));
      mat.setColor3('uColorB',Color3.FromHexString(s.colorB));
    });
  }
  dispose():void {
    if(this.disposed)return;this.disposed=true;
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.shells.forEach(m=>m.dispose());this.materials.forEach(m=>m.dispose());
    delete Effect.ShadersStore[`${this.name}VertexShader`];
    delete Effect.ShadersStore[`${this.name}FragmentShader`];
  }
}
