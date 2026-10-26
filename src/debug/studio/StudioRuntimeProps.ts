import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { sampleSession, type StudioRuntimeExport, type StudioSession, type StudioPropSpec, type StudioTransform } from "./StudioSession";

/** Attach an already-instantiated prop's parent node to the named rig bone. Returns false on unresolved bones. */
export function attachStudioProp(
  objectRoot:TransformNode,
  prop:StudioPropSpec,
  characterRoot:TransformNode,
  skeleton:Skeleton
):boolean{
  const target=prop.boneName ? skeleton.bones.find(b=>b.name===prop.boneName)?.getTransformNode():null;
  if(prop.boneName&&!target)return false;
  objectRoot.parent=target??characterRoot;
  applyStudioTransform(objectRoot,prop.defaultTransform);
  return true;
}
export function applyStudioTransform(node:TransformNode,transform:StudioTransform){
  node.position.copyFrom(Vector3.FromArray(transform.position));
  if(!node.rotationQuaternion)node.rotationQuaternion=Quaternion.Identity();
  node.rotationQuaternion.copyFrom(Quaternion.FromArray(transform.rotation));
  node.scaling.copyFrom(Vector3.FromArray(transform.scaling));
}
/** Prop-track playback. The host keeps ownership of imported meshes and advances this with the animation clock. */
export class StudioRuntimeProps {
  private readonly session:StudioSession;
  constructor(runtime:StudioRuntimeExport,private readonly propRoots:ReadonlyMap<string,TransformNode>){
    this.session={format:"bosque.animation-studio.session",version:1,
      id:runtime.animation.id,modelFile:runtime.modelFile,modelScale:1,baseAnimation:runtime.baseAnimation,
      baseAnimationTime:runtime.baseAnimationTime??null,
      duration:Math.max(0.1,runtime.duration),loop:runtime.loop,
      props:runtime.props,keys:runtime.propKeys.map(k=>({time:k.time,easing:k.easing,bones:{},props:k.props}))};
  }
  applyTime(t:number){
    const sample=sampleSession(this.session,t);
    for(const [id,transform] of Object.entries(sample.props)){
      const node=this.propRoots.get(id);if(node)applyStudioTransform(node,transform);
    }
  }
}
