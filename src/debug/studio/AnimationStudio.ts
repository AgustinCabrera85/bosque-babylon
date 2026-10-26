import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Rendering/edgesRenderer";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { SkeletonViewer } from "@babylonjs/core/Debug/skeletonViewer";
import { GizmoCoordinatesMode } from "@babylonjs/core/Gizmos/gizmo";
import { GizmoManager } from "@babylonjs/core/Gizmos/gizmoManager";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { Scene } from "@babylonjs/core/scene";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { BonePoseController } from "../animation/BonePoseController";
import { RINA_CROWD_FANS } from "../../game/levels/rina/crowd/RinaCrowdAssetManifest";
import { RINA_FIELD_CROWD_LODS } from "../../game/levels/rina/crowd/RinaFieldCrowdLODManifest";
import { createRinaAudiencePhoneIntegration } from "../../game/levels/rina/RinaAudiencePhoneIntegration";
import { MixamoProceduralRig } from "../../game/animation/MixamoProceduralRig";
import {
  exportRuntime, identityTransform, newSession, importStudioJson, sampleSession, upsertKey,
  type QuatData, type StudioKeyframe, type StudioPropSpec, type StudioSession,
  type StudioTransform, type Vec3Data,
} from "./StudioSession";

const DEG=180/Math.PI;
const RAD=Math.PI/180;
const DEV_COLOR=new Color3(0.9,0.75,0.39);
const BONE_COLOR=new Color3(0.39,0.82,0.64);
const LAB_PRESETS={
  lautaro:{path:"/assets/models/character/",name:"Lautaro_Animated.glb",scale:1},
  sofia:{path:"/assets/models/character/",name:"Sofia_Animated.glb",scale:1},
} as const;
const RINA_PHONE_WORLD_HEIGHT=0.144;
type FanId=(typeof RINA_FIELD_CROWD_LODS)[number]["id"];
type FanVariant={id:string;label:string;path:string;filename:string;targetHeight:number};

function getFanVariants(id:FanId):FanVariant[]{
  const fan=RINA_CROWD_FANS.find(item=>item.id===id);
  const lod=RINA_FIELD_CROWD_LODS.find(item=>item.id===id);
  if(!fan||!lod)throw Error(`No hay variantes LOD registradas para ${id}`);
  const fromPath=(key:string,label:string,path:string):FanVariant=>{
    const slash=path.lastIndexOf("/");
    return {id:key,label,path:`/${path.slice(0,slash+1)}`,filename:path.slice(slash+1),
      targetHeight:fan.targetWorldHeight};
  };
  const variants=[fromPath("source", "Original · rig 1K",fan.variants.middle.riggedPath)];
  if(fan.variants.near.riggedPath!==fan.variants.middle.riggedPath)
    variants.push(fromPath("near", "Cercano · rig 2K",fan.variants.near.riggedPath));
  variants.push(fromPath("lod1", "LOD1 · animado 512",
    `assets/models/rina/crowd/lod/${lod.animated}`));
  lod.static.forEach((filename,index)=>variants.push(fromPath(`lod2-${index}`,
    `LOD2 · estático ${index+1} (${filename.includes("cheer")?"cheer":filename.includes("clap")?"clap":filename.includes("dance")?"dance":filename.includes("rally")?"rally":"idle"})`,
    `assets/models/rina/crowd/lod/${filename}`)));
  return variants;
}

/** Studio preview surfaces are solid even when a source GLB uses alpha blending. */
function forceOpaqueMaterials(meshes:readonly AbstractMesh[]){
  const seen=new Set<Material>();
  const makeOpaque=(material:Material|null)=>{
    if(!material||seen.has(material))return;
    seen.add(material);
    const subMaterials=(material as Material & {subMaterials?:Array<Material|null>}).subMaterials;
    for(const child of subMaterials??[])makeOpaque(child);
    material.alpha=1;
    material.transparencyMode=Material.MATERIAL_OPAQUE;
    material.disableDepthWrite=false;
    material.forceDepthWrite=true;
    if(material instanceof PBRMaterial){
      material.useAlphaFromAlbedoTexture=false;
      material.forceAlphaTest=false;
      material.opacityTexture=null;
    }else if(material instanceof StandardMaterial){
      material.useAlphaFromDiffuseTexture=false;
      material.opacityTexture=null;
    }
  };
  for(const mesh of meshes){
    mesh.visibility=1;
    mesh.hasVertexAlpha=false;
    makeOpaque(mesh.material);
  }
}

type LoadedModel={root:TransformNode;meshes:AbstractMesh[];groups:AnimationGroup[];skeletons:Skeleton[];
  skeleton:Skeleton|null;mesh:AbstractMesh|null;controller:BonePoseController|null;
  viewer:SkeletonViewer|null;name:string;seekObserver:Observer<Scene>|null};
type LabProp={spec:StudioPropSpec;node:TransformNode;meshes:AbstractMesh[];placeholder:boolean};
type Selection="bone"|"prop"|"hand"|null;
type AnimationAuditIssue={time:number;kind:"motion"|"scale"|"grip"|"framing";message:string};
type AnimationAuditSample={time:number;phoneLength?:number;rightGripGap?:number;
  leftGripGap?:number;rightGripOffset?:Vec3Data;leftGripOffset?:Vec3Data;
  phoneSizeLocal?:Vec3Data;phoneMinLocal?:Vec3Data;phoneMaxLocal?:Vec3Data;
  rightGripLocal?:Vec3Data;leftGripLocal?:Vec3Data;
  fingerTips?:Record<string,{local:Vec3Data;distance:number}>;
  rightPinchWidth?:number;leftPinchWidth?:number;
  shoulderWidth?:number;handSideSeparation?:number;gripSideSpread?:number;
  aboveHead?:number;phoneTiltDeg?:number;phoneLeanDeg?:number;
  screenFacesFan?:number;largestJointStep?:number};
type AnimationAuditReport={animation:string;model:string|null;samples:AnimationAuditSample[];
  issues:AnimationAuditIssue[]};

/** Additive, isolated editor. Nothing here modifies source GLBs or the game's runtime state. */
export class AnimationStudio {
  public readonly scene:Scene;
  private readonly engine:Engine;
  private readonly camera:ArcRotateCamera;
  private readonly comparisonCameras:ArcRotateCamera[]=[];
  private multiView=false;
  private inspectionMode=false;
  private readonly gizmos:GizmoManager;
  private readonly boneGizmoNode:TransformNode;
  private readonly handTarget:TransformNode;
  private handSide:"right"|"left"|null=null;
  private readonly markers=new Map<string,Mesh>();
  private readonly props=new Map<string,LabProp>();
  private current:LoadedModel|null=null;
  private baseClip:AnimationGroup|null=null;
  private session:StudioSession=newSession();
  private selectedBone:string|null=null;
  private selectedProp:string|null=null;
  private selection:Selection=null;
  private gizmoMode:"move"|"rotate"|"scale"="move";
  private playback=false;
  private time=0;
  private busy=false;
  private disposed=false;
  private generation=0;
  private draggingBone=false;
  private draggingProp=false;
  private dragStartRotation=Quaternion.Identity();
  private dragStartOffset=Quaternion.Identity();
  private previousFrameMs=0;
  private nextPropId=1;
  private pendingSession:StudioSession|null=null;
  private selectedFan:FanId|null=null;
  private photoPreview:Awaited<ReturnType<typeof createRinaAudiencePhoneIntegration>>|null=null;
  private photoPreviewTime=0;
  private photoBaseClipTime:number|null=null;
  private readonly photoTarget=new Vector3(0,1.5,8);
  private photoCameraState:{alpha:number;beta:number;radius:number;target:Vector3}|null=null;
  private photoBaseObserver:Observer<Scene>|null=null;
  private readonly photoBaseRotations=new Map<string,Quaternion>();
  private bakingPhoto=false;
  private analyzing=false;
  private auditReport:AnimationAuditReport|null=null;
  private readonly wiredGizmos=new WeakSet<object>();

  constructor(private readonly canvas:HTMLCanvasElement){
    this.engine=new Engine(canvas,true,{preserveDrawingBuffer:false,stencil:true});
    this.scene=new Scene(this.engine);
    this.scene.clearColor=new Color4(0.043,0.068,0.074,1);
    this.scene.ambientColor=new Color3(0.17,0.2,0.2);
    this.camera=new ArcRotateCamera("studioCamera",Math.PI/2,Math.PI/2.4,3.8,new Vector3(0,0.9,0),this.scene);
    this.camera.minZ=0.005;
    this.camera.lowerRadiusLimit=0.13;
    this.camera.upperRadiusLimit=100;
    this.camera.wheelDeltaPercentage=0.012;
    this.camera.attachControl(canvas,true);
    this.camera.panningSensibility=500;
    this.scene.activeCamera=this.camera;
    for(const [name,alpha,beta] of [["front",Math.PI/2,Math.PI/2.35],
      ["side",0,Math.PI/2.35],["hands",-Math.PI/2-0.35,Math.PI/2.7]] as const){
      const camera=new ArcRotateCamera(`studio${name}Camera`,alpha,beta,3,new Vector3(0,1,0),this.scene);
      camera.minZ=0.005;this.comparisonCameras.push(camera);
    }
    const fill=new HemisphericLight("studioHemi",new Vector3(0,1,0),this.scene);
    fill.intensity=1.05;fill.diffuse=new Color3(0.75,0.83,0.82);fill.groundColor=new Color3(0.25,0.25,0.25);
    const key=new DirectionalLight("studioKey",new Vector3(-0.5,-0.8,-0.3),this.scene);
    key.position=new Vector3(3,6,4);key.intensity=1.15;
    const ground=MeshBuilder.CreateGround("studioGround",{width:30,height:30},this.scene);
    const mat=new StandardMaterial("studioFloorMat",this.scene);
    mat.diffuseColor=new Color3(0.07,0.115,0.115);mat.specularColor=Color3.Black();ground.material=mat;ground.isPickable=false;
    const axis=MeshBuilder.CreateLines("studioAxis",{points:[new Vector3(-15,0.002,0),new Vector3(15,0.002,0)]},this.scene);
    axis.color=new Color3(0.1,0.3,0.27);axis.isPickable=false;
    this.boneGizmoNode=new TransformNode("studioBoneEditHandle",this.scene);
    this.boneGizmoNode.rotationQuaternion=Quaternion.Identity();
    this.handTarget=new TransformNode("studioHandTarget",this.scene);
    this.gizmos=new GizmoManager(this.scene);
    this.gizmos.usePointerToAttachGizmos=false;
    this.gizmos.clearGizmoOnEmptyPointerEvent=false;
    this.gizmos.coordinatesMode=GizmoCoordinatesMode.Local;
    this.gizmos.scaleRatio=0.8;
    this.gizmos.rotationGizmoEnabled=true;
    this.gizmos.attachToNode(null);
    this.wireRotationGizmo();
    this.scene.onPointerObservable.add(e=>{
      if(e.type!==PointerEventTypes.POINTERPICK)return;
      const mesh=e.pickInfo?.pickedMesh;
      const name=mesh?.metadata?.studioBoneName as string|undefined;
      if(name){this.selectBone(name);return;}
      const propId=mesh?.metadata?.studioPropId as string|undefined;
      if(propId)this.selectProp(propId);
    });
    this.scene.onAfterAnimationsObservable.add(()=>this.updateBoneGizmoPose());
    this.registerEvents();
    this.refreshAll();
  }

  public initialize(){
    this.engine.runRenderLoop(()=>this.frame());
    window.addEventListener("resize",this.resize);
    this.resize();
  }
  public async prepareFanPhotoForAutomation(id:FanId){
    await this.prepareAnimationForAutomation(id,"rina-photo");
  }
  public async prepareAnimationForAutomation(
    preset:FanId|"hermano-mayor",
    action:"rina-photo"|"boss-pickup"|"boss-attack",
    variant?:string,
  ){
    if(preset==="hermano-mayor"){
      if(action==="rina-photo")throw Error("La foto de Rina necesita un fan con rig.");
      await this.loadBossPreset();
    }else{
      if(action!=="rina-photo")throw Error("Esta accion del jefe necesita Hermano Mayor.");
      await this.loadFanPreset(preset);
      if(variant&&variant!=="lod1"){
        this.select("fanVariant").value=variant;
        await this.loadFanVariant();
      }
    }
    this.scene.render();
    await this.setProceduralView(action);
    if(action==="rina-photo"){
      this.scene.render();
      await this.bakePhotoToKeys();
    }
  }
  public seekForAutomation(seconds:number){this.seek(seconds);}
  public focusPhoneForAutomation(view:"stage"|"audience"|"side"="stage",radius=0.65){
    const phone=[...this.props.values()].find(prop=>prop.spec.fileName==="Smartphone_RinaReady.glb");
    const body=phone?.meshes.find(mesh=>mesh.name.includes("SmartPhone_Body"));
    if(!body)throw Error("Cargá y convertí una foto con celular antes de enfocar la cámara.");
    const center=Vector3.TransformCoordinates(body.getBoundingInfo().boundingBox.center,
      body.computeWorldMatrix(true));
    this.camera.setTarget(center);
    this.camera.alpha=view==="stage"?Math.PI/2:view==="audience"?-Math.PI/2:0;
    this.camera.beta=view==="audience"?1.0:Math.PI/2.35;
    this.camera.radius=Math.max(0.2,Math.min(5,radius));
    this.scene.render();
    return this.getAutomationCamera();
  }
  public orbitForAutomation(deltaAlpha:number,deltaBeta=0,zoomFactor=1){
    if(![deltaAlpha,deltaBeta,zoomFactor].every(Number.isFinite)||zoomFactor<=0)
      throw Error("Órbita o zoom inválidos.");
    this.camera.alpha+=deltaAlpha;
    this.camera.beta=Math.max(0.15,Math.min(Math.PI-0.15,this.camera.beta+deltaBeta));
    this.camera.radius=Math.max(0.2,Math.min(5,this.camera.radius*zoomFactor));
    this.scene.render();
    return this.getAutomationCamera();
  }
  private getAutomationCamera(){return {alpha:this.camera.alpha,beta:this.camera.beta,
    radius:this.camera.radius,target:this.camera.target.asArray()};}
  private readonly resize=()=>this.engine.resize();

  private input(id:string){const e=document.getElementById(id);if(!(e instanceof HTMLInputElement))throw Error(`Missing input #${id}`);return e;}
  private select(id:string){const e=document.getElementById(id);if(!(e instanceof HTMLSelectElement))throw Error(`Missing select #${id}`);return e;}
  private button(id:string){const e=document.getElementById(id);if(!(e instanceof HTMLButtonElement))throw Error(`Missing button #${id}`);return e;}
  private element(id:string){const e=document.getElementById(id);if(!e)throw Error(`Missing #${id}`);return e;}
  private status(text:string,error=false){const node=this.element("studioStatus");node.textContent=text;node.classList.toggle("error",error);}
  private setBusy(value:boolean){this.busy=value;this.element("busyOverlay").classList.toggle("hidden",!value);}
  private catch(action:()=>Promise<unknown>){void action().catch(error=>{this.status(String(error),true);console.error(error);}).finally(()=>this.setBusy(false));}
  private registerEvents(){
    this.button("loadLautaro").onclick=()=>this.catch(()=>this.loadPreset("lautaro"));
    this.button("loadSofia").onclick=()=>this.catch(()=>this.loadPreset("sofia"));
    this.button("loadHermanoMayor").onclick=()=>this.catch(()=>this.loadBossPreset());
    for(const id of ["fan01","fan02","fan03","fan04","fan05"] as const)
      this.button(`load${id[0].toUpperCase()}${id.slice(1)}`).onclick=()=>this.catch(()=>this.loadFanPreset(`fan_${id.slice(-2)}` as FanId));
    this.select("fanVariant").onchange=()=>this.catch(()=>this.loadFanVariant());
    this.select("proceduralView").onchange=()=>this.catch(()=>this.setProceduralView(this.select("proceduralView").value));
    this.button("openProcedural").onclick=()=>this.input("sessionInput").click();
    this.button("replayPhoto").onclick=()=>this.replayPhoto();
    this.button("bakePhoto").onclick=()=>this.catch(()=>this.bakePhotoToKeys());
    this.button("analyzeAnimation").onclick=()=>this.runAnimationAudit();
    this.button("exportAnalysis").onclick=()=>{
      if(this.auditReport)this.downloadJson(`${this.session.id}.audit.json`,this.auditReport);
      else this.status("Analiza primero una animacion con keyframes.",true);
    };
    this.button("toggleMultiView").onclick=()=>this.toggleMultiView();
    this.button("toggleInspection").onclick=()=>this.toggleInspectionMode();
    this.button("targetRightHand").onclick=()=>this.selectHandTarget("right");
    this.button("targetLeftHand").onclick=()=>this.selectHandTarget("left");
    this.button("applyHandTarget").onclick=()=>this.applyHandTarget();
    this.button("showRightFingers").onclick=()=>this.filterFingers("right");
    this.button("showLeftFingers").onclick=()=>this.filterFingers("left");
    this.input("modelInput").onchange=()=>{const f=this.input("modelInput").files?.[0];if(f){this.clearFanSelection();this.catch(()=>this.loadModel(f));}};
    this.select("baseAnimation").onchange=()=>{this.session.baseAnimationTime=null;
      this.chooseBaseClip(this.select("baseAnimation").value);};
    this.input("modelScale").onchange=()=>{
      const scale=Number(this.input("modelScale").value);
      if(!this.current||!Number.isFinite(scale)||scale<=0)return;
      this.current.root.scaling.setAll(Math.max(0.001,Math.min(100,scale)));
      this.session.modelScale=this.current.root.scaling.x;this.focusCamera();
    };
    this.input("showSkeleton").onchange=()=>this.updateSkeleton();
    this.input("boneSearch").oninput=()=>this.renderBones();
    this.button("resetBone").onclick=()=>{if(this.selectedBone){this.current?.controller?.resetBone(this.selectedBone);this.maybeAutoKey();this.renderBones();this.refreshSelection();}};
    this.button("resetAllBones").onclick=()=>{this.current?.controller?.resetAll();this.maybeAutoKey();this.renderBones();this.refreshSelection();};
    (["boneRotX","boneRotY","boneRotZ"] as const).forEach(id=>this.input(id).onchange=()=>this.setBoneEuler());
    this.button("addBox").onclick=()=>this.addPrimitive("box");
    this.button("addSphere").onclick=()=>this.addPrimitive("sphere");
    this.input("propInput").onchange=()=>{const f=this.input("propInput").files?.[0];if(f)this.catch(()=>this.loadProp(f));};
    this.select("propBone").onchange=()=>this.bindSelectedProp(this.select("propBone").value||null);
    this.button("removeProp").onclick=()=>this.removeSelectedProp();
    this.button("gizmoMove").onclick=()=>this.setPropGizmo("move");
    this.button("gizmoRotate").onclick=()=>this.setPropGizmo("rotate");
    this.button("gizmoScale").onclick=()=>this.setPropGizmo("scale");
    (["posX","posY","posZ","rotX","rotY","rotZ","scaleX","scaleY","scaleZ"] as const).forEach(id=>{
      this.input(id).onchange=()=>this.setPropTransformFromFields();
    });
    this.button("focusCamera").onclick=()=>this.focusCamera();
    this.button("viewFront").onclick=()=>this.setCameraView(Math.PI/2);
    this.button("viewSide").onclick=()=>this.setCameraView(0);
    this.button("viewBack").onclick=()=>this.setCameraView(-Math.PI/2);
    this.button("rewind").onclick=()=>this.seek(0);
    this.button("playPause").onclick=()=>this.togglePlay();
    this.button("stepBack").onclick=()=>this.seek(this.time-1/Number(this.select("fps").value));
    this.button("stepForward").onclick=()=>this.seek(this.time+1/Number(this.select("fps").value));
    this.input("loop").onchange=()=>{this.session.loop=this.input("loop").checked;};
    this.input("duration").onchange=()=>{
      this.session.duration=Math.max(0.1,Math.min(600,Number(this.input("duration").value)||3));
      this.session.keys=this.session.keys.filter(k=>k.time<=this.session.duration);
      this.clearAnimationAudit();this.seek(this.time);
      this.refreshTimeline();
    };
    this.input("timeSlider").oninput=()=>this.seek(Number(this.input("timeSlider").value));
    this.input("timeInput").onchange=()=>this.seek(Number(this.input("timeInput").value));
    this.button("captureKey").onclick=()=>this.captureKey();
    this.button("deleteKey").onclick=()=>this.deleteCurrentKey();
    this.button("saveProject").onclick=()=>this.saveSession();
    this.button("openProject").onclick=()=>this.input("sessionInput").click();
    this.input("sessionInput").onchange=()=>{
      const f=this.input("sessionInput").files?.[0];
      if(f)this.catch(async()=>this.loadSessionJson(await f.text()));
    };
    this.button("exportRuntime").onclick=()=>this.exportForGame();
    this.button("exportAnimationOnly").onclick=()=>this.exportAnimationOnly();
    this.input("animationName").onchange=()=>{this.session.id=this.input("animationName").value.trim()||"pose_corrections";};
    this.select("easing").onchange=()=>this.changeCurrentKeyEasing();
    const drop=this.element("dropZone");
    drop.addEventListener("dragenter",event=>{event.preventDefault();drop.classList.add("dragover");});
    drop.addEventListener("dragover",event=>event.preventDefault());
    drop.addEventListener("dragleave",event=>{if(!drop.contains(event.relatedTarget as Node))drop.classList.remove("dragover");});
    drop.addEventListener("drop",event=>{
      event.preventDefault();drop.classList.remove("dragover");
      const files=(event as DragEvent).dataTransfer?.files;
      const file=files?.[0];if(!file)return;
      if(!file.name.toLowerCase().endsWith(".glb")){this.status("Sólo se admiten archivos .glb en el visor.",true);return;}
      if(!(event as DragEvent).shiftKey)this.clearFanSelection();
      this.catch(()=>(event as DragEvent).shiftKey ? this.loadProp(file):this.loadModel(file));
    });
    window.addEventListener("keydown",e=>{
      if(e.key===" "&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLSelectElement)){
        e.preventDefault();this.togglePlay();
      }
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){
        e.preventDefault();this.saveSession();
      }
    });
  }

  private async loadPreset(name:keyof typeof LAB_PRESETS){
    this.clearFanSelection();
    const {path,name:fileName,scale}=LAB_PRESETS[name];await this.loadModel(null,path,fileName,scale);
  }
  private async loadBossPreset(){
    this.clearFanSelection();
    await this.loadModel(null,"/assets/models/enemies/boss/","Hermano_mayor_Final_NLA.glb",1,4.05);
  }
  private clearFanSelection(){
    this.selectedFan=null;
    this.element("fanVariantRow").classList.add("hidden");
    this.element("fanVariantInfo").classList.add("hidden");
  }
  private async loadFanPreset(id:FanId){
    this.selectedFan=id;
    const variants=getFanVariants(id),select=this.select("fanVariant");
    select.replaceChildren(...variants.map(variant=>new Option(variant.label,variant.id)));
    select.value="lod1";
    this.element("fanVariantRow").classList.remove("hidden");
    this.element("fanVariantInfo").classList.remove("hidden");
    await this.loadFanVariant();
  }
  private async loadFanVariant(){
    const id=this.selectedFan;if(!id)return;
    const variant=getFanVariants(id).find(item=>item.id===this.select("fanVariant").value);
    if(!variant)throw Error("Variante LOD desconocida");
    this.element("fanVariantInfo").textContent=variant.id.startsWith("lod2")
      ?"LOD2 es una pose estática sin esqueleto: sirve para inspeccionar el modelo, no para editar huesos ni reproducir la foto."
      :"El cambio de LOD carga otro GLB y comienza una sesión nueva. Guardá la sesión actual antes de cambiar si querés conservarla.";
    await this.loadModel(null,variant.path,variant.filename,1,variant.targetHeight);
  }
  private stopPhotoPreview(){
    this.photoPreview?.dispose();this.photoPreview=null;this.photoPreviewTime=0;
    this.photoBaseClipTime=null;
    if(this.photoBaseObserver){this.scene.onAfterAnimationsObservable.remove(this.photoBaseObserver);this.photoBaseObserver=null;}
    this.photoBaseRotations.clear();
    if(this.photoCameraState){
      const state=this.photoCameraState;this.photoCameraState=null;
      this.camera.setTarget(state.target);
      this.camera.alpha=state.alpha;this.camera.beta=state.beta;this.camera.radius=state.radius;
    }
    this.select("proceduralView").value="session";
    this.button("replayPhoto").disabled=true;
    this.button("bakePhoto").disabled=true;
    this.element("proceduralInfo").textContent="La sesión o el JSON abierto se reproduce y edita en la línea de tiempo. La foto de Rina muestra la acción procedural actual del juego.";
    this.setTimelineEnabled(true);
  }
  private setTimelineEnabled(enabled:boolean){
    for(const id of ["rewind","playPause","stepBack","stepForward","captureKey","deleteKey"])
      this.button(id).disabled=!enabled;
    for(const id of ["timeSlider","timeInput","duration","loop","autoKey"])
      this.input(id).disabled=!enabled;
  }
  private async setProceduralView(value:string){
    this.stopPhotoPreview();
    if(value==="session"){
      this.applyAtTime(this.time);
      return;
    }
    if(value==="boss-pickup"||value==="boss-attack"){
      const model=this.current;
      if(model?.name!=="Hermano_mayor_Final_NLA.glb"||!model.controller){
        this.status("Cargá Hermano Mayor para ver esta animación procedural.",true);return;
      }
      this.setBusy(true);
      const ticket=this.generation;
      try{
        const definition=value==="boss-pickup"
          ?(await import("../../game/enemies/boss/HermanoMayorAxePickupAction")).HERMANO_MAYOR_AXE_PICKUP_ANIMATION
          :(await import("../../game/enemies/boss/HermanoMayorAxeAttackAction")).HERMANO_MAYOR_AXE_ATTACK_ANIMATION;
        if(this.current!==model||ticket!==this.generation)return;
        const loaded=importStudioJson(definition,{modelFile:model.name,
          baseAnimation:this.baseClip?.name??null,modelScale:model.root.scaling.x});
        this.installSession(loaded);
        this.select("proceduralView").value=value;
        this.playback=true;this.refreshPlayButton();
        this.element("proceduralInfo").textContent="Capa procedural de huesos del juego, editable en la línea de tiempo. La interacción con el hacha usa lógica adicional del nivel.";
        this.status(`Animación procedural '${definition.id}' cargada en la línea de tiempo`);
      }finally{this.setBusy(false);}
      return;
    }
    if(value!=="rina-photo")return;
    const model=this.current,fanId=this.selectedFan;
    if(!fanId||!model?.controller||!(model.mesh instanceof Mesh)){
      this.status("La foto de Rina necesita un Fan 01–05 con rig. Los LOD2 son estáticos.",true);
      return;
    }
    this.setBusy(true);
    const ticket=this.generation;
    try{
      this.playback=false;
      model.controller.setProceduralOffsets(new Map());
      this.photoBaseClipTime=this.time;
      this.photoBaseObserver=this.scene.onAfterAnimationsObservable.add(()=>{
        if(this.current!==model||!model.controller)return;
        for(const bone of model.controller.getBones()){
          const rotation=model.controller.getBoneTransformNode(bone.name)?.rotationQuaternion;
          if(rotation)this.photoBaseRotations.set(bone.name,rotation.clone());
        }
      });
      const photoMesh=model.mesh;
      const preview=await createRinaAudiencePhoneIntegration(this.scene,"desktop",[
        {id:`studio-${fanId}`,fanId,mesh:photoMesh,clips:model.groups,
          getWorldFootPositionToRef:result=>{result.copyFrom(photoMesh.getAbsolutePosition());},
          setPhotoActionActive:()=>{},retire:()=>{}},
      ],[],this.photoTarget);
      if(this.disposed||ticket!==this.generation||this.current!==model){preview.dispose();return;}
      this.photoPreview=preview;
      const livePhone=this.scene.getTransformNodeByName(`theatrePhone_studio-${fanId}`);
      if(livePhone)forceOpaqueMaterials(livePhone.getChildMeshes(false));
      this.select("proceduralView").value="rina-photo";
      preview.phones.setFeedEnabled(false);
      this.photoCameraState={alpha:this.camera.alpha,beta:this.camera.beta,
        radius:this.camera.radius,target:this.camera.target.clone()};
      const bounds=this.getModelBounds();
      this.camera.setTarget(bounds?new Vector3(
        (bounds.min.x+bounds.max.x)*0.5,
        bounds.min.y+(bounds.max.y-bounds.min.y)*0.82,
        (bounds.min.z+bounds.max.z)*0.5):new Vector3(0,2.1,0));
      this.camera.alpha=-Math.PI/2+0.55;
      this.camera.beta=Math.PI/2.45;
      this.camera.radius=1.75;
      this.replayPhoto();
      this.button("bakePhoto").disabled=false;
      this.setTimelineEnabled(false);
      this.status(`Vista previa de la foto procedural de ${fanId} · acción real del nivel de Rina`);
    }catch(error){this.stopPhotoPreview();throw error;}
    finally{this.setBusy(false);}
  }
  private replayPhoto(){
    if(!this.photoPreview)return;
    this.photoPreviewTime=0;
    this.photoPreview.phones.triggerPhoto();
    this.button("replayPhoto").disabled=false;
    this.element("proceduralInfo").textContent="Vista en vivo de la foto. Pulsá Convertir foto en keyframes editables para corregir brazos, manos, dedos y celular.";
  }
  private async bakePhotoToKeys(){
    const model=this.current,preview=this.photoPreview,fanId=this.selectedFan;
    if(!model?.controller||!preview||!fanId)return;
    this.setBusy(true);this.bakingPhoto=true;this.playback=false;
    const handName=model.controller.getBones().find(b=>/righthand$/i.test(b.name))?.name;
    const hand=handName?model.controller.getBoneTransformNode(handName):null;
    const phone=this.scene.getTransformNodeByName(`theatrePhone_studio-${fanId}`);
    if(!hand||!phone){this.bakingPhoto=false;this.setBusy(false);
      throw Error("No se encontraron la mano derecha y el celular para convertir la foto.");}
    type PhotoSample={time:number;bones:StudioKeyframe["bones"];phoneWorld:Matrix;handWorld:Matrix};
    const samples:PhotoSample[]=[];
    const duration=5.8;
    try{
      this.replayPhoto();
      // The observer before Rina's action records each original animation rotation.
      for(let tick=0;tick<=58;tick++){
        const t=tick/10;
        this.time=t;
        preview.update(tick===0?0:0.1,this.photoTarget);
        this.scene.render();
        if(tick%2!==0&&tick!==58)continue;
        const bones:StudioKeyframe["bones"]={};
        for(const bone of model.controller.getBones()){
          const base=this.photoBaseRotations.get(bone.name);
          const current=model.controller.getBoneTransformNode(bone.name)?.rotationQuaternion;
          if(!base||!current)continue;
          const offset=base.conjugate().multiply(current).normalize();
          if(Math.abs(offset.x)+Math.abs(offset.y)+Math.abs(offset.z)+Math.abs(offset.w-1)>0.0001)
            bones[bone.name]=[offset.x,offset.y,offset.z,offset.w];
        }
        hand.computeWorldMatrix(true);phone.computeWorldMatrix(true);
        samples.push({time:t,bones,phoneWorld:phone.getWorldMatrix().clone(),
          handWorld:hand.getWorldMatrix().clone()});
      }
      const frozenBaseTime=this.photoBaseClipTime;
      this.stopPhotoPreview();
      this.clearProps();
      this.session=newSession();
      this.session.id=`rina_photo_${fanId}`;
      this.session.modelFile=model.name;
      this.session.modelScale=model.root.scaling.x;
      this.session.baseAnimation=this.baseClip?.name??null;
      this.session.baseAnimationTime=frozenBaseTime;
      this.session.duration=duration;this.session.loop=false;
      const response=await fetch("/assets/models/theatre/Smartphone_RinaReady.glb");
      if(!response.ok)throw Error("No se pudo cargar el celular para editarlo en el estudio.");
      const file=new File([await response.blob()],"Smartphone_RinaReady.glb",{type:"model/gltf-binary"});
      await this.loadProp(file);
      const prop=[...this.props.values()].find(p=>p.spec.fileName===file.name);
      if(!prop)throw Error("No se pudo adjuntar el celular editable a la mano.");
      prop.spec.boneName=handName!;
      const calibratedPhoneScale=prop.node.scaling.x;
      const worldToLocal=(sample:PhotoSample):StudioTransform=>{
        const local=sample.phoneWorld.multiply(Matrix.Invert(sample.handWorld));
        const scaling=Vector3.One(),rotation=Quaternion.Identity(),position=Vector3.Zero();
        local.decompose(scaling,rotation,position);
        return {position:[position.x,position.y,position.z],
          rotation:[rotation.x,rotation.y,rotation.z,rotation.w],
          scaling:[Math.sign(scaling.x)*calibratedPhoneScale,
            Math.sign(scaling.y)*calibratedPhoneScale,
            Math.sign(scaling.z)*calibratedPhoneScale]};
      };
      for(const sample of samples)upsertKey(this.session,{time:sample.time,easing:"smooth",
        bones:sample.bones,props:{[prop.spec.id]:worldToLocal(sample)}});
      prop.spec.defaultTransform=structuredClone(this.session.keys[0].props[prop.spec.id]);
      this.input("animationName").value=this.session.id;
      this.input("loop").checked=false;
      this.seek(2.4);
      this.select("proceduralView").value="session";
      this.element("proceduralInfo").textContent=`Foto de ${fanId} convertida: ${samples.length} keyframes editables. Ajusta brazos, manos, dedos y celular; guarda la sesion antes de cambiar de modelo.`;
      this.status(`Foto de ${fanId} convertida en ${samples.length} keyframes con celular editable.`);
      this.refreshAll();
      this.toggleMultiView(true);
      this.runAnimationAudit(true);
    }finally{this.bakingPhoto=false;this.setBusy(false);}
  }
  private async loadModel(file:File|null,path="",fileName="",modelScale=1,targetHeight?:number){
    if(this.disposed)return;
    this.setBusy(true);
    const ticket=++this.generation;
    let imported:Awaited<ReturnType<typeof SceneLoader.ImportMeshAsync>>|null=null;
    try{
      imported=file ? await SceneLoader.ImportMeshAsync(null,"",file,this.scene) :
        await SceneLoader.ImportMeshAsync(null,path,fileName,this.scene);
      if(this.disposed||ticket!==this.generation){this.disposeImport(imported);return;}
      const skeletonMesh=imported.meshes
        .filter(m=>m.skeleton&&m.getTotalVertices()>0)
        .sort((a,b)=>(b.skeleton?.bones.length??0)-(a.skeleton?.bones.length??0))[0];
      const skeleton=skeletonMesh?.skeleton??null;
      const boneNodes=skeleton?.bones.filter(b=>b.getTransformNode())??[];
      if(skeleton&&!boneNodes.length)throw Error("El GLB tiene skeleton pero no expone TransformNodes para editar. Debe exportarse con rig compatible (glTF/Mixamo).");
      const root=new TransformNode("studioCharacterRoot",this.scene);
      for(const node of [...imported.meshes,...imported.transformNodes])if(!node.parent)node.parent=root;
      root.scaling.setAll(modelScale);
      for(const group of imported.animationGroups)group.stop();
      const meshes=imported.meshes.filter(m=>m.getTotalVertices()>0);
      for(const mesh of meshes){mesh.isPickable=false;mesh.receiveShadows=true;}
      forceOpaqueMaterials(meshes);
      const controller=skeleton&&skeletonMesh ? new BonePoseController(this.scene,skeleton,skeletonMesh,root):null;
      const model:LoadedModel={root,meshes,groups:imported.animationGroups,skeletons:imported.skeletons,skeleton,
        mesh:skeletonMesh,controller,viewer:null,name:file?.name??fileName,seekObserver:null};
      imported=null;
      this.clearModel();
      this.current=model;
      this.session=newSession();this.session.modelFile=model.name;
      if(targetHeight){
        const bounds=this.getModelBounds();
        const height=bounds ? bounds.max.y-bounds.min.y : 0;
        if(height>0.0001)root.scaling.setAll(root.scaling.x*targetHeight/height);
      }
      this.session.modelScale=root.scaling.x;
      this.selectedBone=null;this.selectedProp=null;this.selection=null;
      this.boneGizmoNode.parent=null;this.gizmos.attachToNode(null);
      this.centerModel();
      // The controller restores its previous offsets before animations. A base clip must
      // be sampled AFTER that restore and BEFORE controller's after-animation overlay.
      model.seekObserver=this.scene.onBeforeAnimationsObservable.add(()=>{
        if(this.current!==model||!this.baseClip)return;
        const clip=this.baseClip;
        const fps=clip.targetedAnimations[0]?.animation.framePerSecond||30;
        const clipDuration=Math.max(0.0001,(clip.to-clip.from)/fps);
        const studioTime=this.photoBaseClipTime??this.session.baseAnimationTime??this.time;
        const sampleTime=this.session.loop ? studioTime%clipDuration : Math.min(studioTime,clipDuration);
        const frame=Math.max(clip.from,Math.min(clip.to,clip.from+sampleTime*fps));
        clip.goToFrame(frame);
      });
      if(controller){
        controller.onPoseApplied=()=>this.updateBoneGizmoPose();
        controller.onOffsetsChanged=()=>{this.renderBones();this.refreshBoneFields();};
      }
      this.createBoneMarkers();
      const selector=this.select("baseAnimation");selector.replaceChildren();
      selector.add(new Option("Sin animación",""));
      for(const group of model.groups)selector.add(new Option(group.name,group.name));
      selector.disabled=!controller||model.groups.length===0;
      const selected=model.groups.find(g=>/idle/i.test(g.name))?.name??model.groups[0]?.name??"";
      this.chooseBaseClip(selected);
      if(this.pendingSession&&(!this.pendingSession.modelFile||this.pendingSession.modelFile===model.name)){
        const pending=this.pendingSession;this.pendingSession=null;
        this.installSession(pending);
      }
      this.refreshAll();
      this.setTimelineEnabled(Boolean(controller));
      this.input("showSkeleton").disabled=!controller;
      const photoOption=[...this.select("proceduralView").options]
        .find(option=>option.value==="rina-photo");
      if(photoOption)photoOption.disabled=!controller||!this.selectedFan;
      for(const value of ["boss-pickup","boss-attack"]){
        const option=[...this.select("proceduralView").options]
          .find(item=>item.value===value);
        if(option)option.disabled=!controller||model.name!=="Hermano_mayor_Final_NLA.glb";
      }
      this.element("viewportEmpty").classList.add("hidden");
      this.status(controller
        ?`Modelo ${model.name} · ${boneNodes.length} huesos editables · ${model.groups.length} clips originales`
        :`Modelo ${model.name} · LOD estático sin rig; vista de geometría solamente`);
    }catch(error){if(imported)this.disposeImport(imported);throw error;}
    finally{this.setBusy(false);}
  }
  private disposeImport(data:Awaited<ReturnType<typeof SceneLoader.ImportMeshAsync>>){
    for(const group of data.animationGroups)group.dispose();
    for(const root of [...data.meshes,...data.transformNodes])if(!root.parent)root.dispose(false,true);
    for(const skeleton of data.skeletons)skeleton.dispose();
  }
  private clearModel(){
    this.playback=false;
    this.stopPhotoPreview();
    this.handSide=null;this.selection=null;
    this.clearAnimationAudit();
    this.clearProps();
    this.clearBoneMarkers();
    if(!this.current)return;
    this.current.viewer?.dispose();
    if(this.current.seekObserver)this.scene.onBeforeAnimationsObservable.remove(this.current.seekObserver);
    if(this.current.controller){
      this.current.controller.onPoseApplied=null;
      this.current.controller.onOffsetsChanged=null;
      this.current.controller.dispose();
    }
    for(const group of this.current.groups)group.dispose();
    for(const skeleton of this.current.skeletons)skeleton.dispose();
    this.current.root.dispose(false,true);
    this.current=null;this.baseClip=null;
  }
  private chooseBaseClip(name:string){
    if(!this.current)return;
    for(const g of this.current.groups)g.stop();
    const clip=this.current.groups.find(g=>g.name===name)??null;
    this.baseClip=clip;
    this.session.baseAnimation=clip?.name??null;
    if(clip){clip.start(false,1,clip.from,clip.to);clip.pause();
      const fps=clip.targetedAnimations[0]?.animation.framePerSecond||30;
      const duration=Math.max(0.1,(clip.to-clip.from)/fps);
      if(this.session.keys.length===0)this.session.duration=Math.round(duration*100)/100;
    }
    this.seek(0);this.refreshTimeline();
  }
  private centerModel(){
    const c=this.current;if(!c)return;
    c.root.computeWorldMatrix(true);for(const mesh of c.meshes)mesh.computeWorldMatrix(true);
    const limits=this.getModelBounds();if(!limits)return;
    c.root.position.y-=limits.min.y;
    this.focusCamera();
  }
  private getModelBounds(){
    const c=this.current;if(!c)return null;
    const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);
    let found=false;
    for(const m of c.meshes){m.computeWorldMatrix(true);const b=m.getBoundingInfo().boundingBox;
      if(!Number.isFinite(b.minimumWorld.x))continue;
      min.minimizeInPlace(b.minimumWorld);max.maximizeInPlace(b.maximumWorld);found=true;}
    return found?{min,max}:null;
  }
  private focusCamera(){
    const bounds=this.getModelBounds();if(!bounds)return;
    const size=bounds.max.subtract(bounds.min),middle=bounds.min.add(size.scale(0.5));
    this.camera.setTarget(middle);
    this.camera.radius=Math.max(0.7,size.y*1.55,size.x*1.6,size.z*1.6);
    this.camera.lowerRadiusLimit=Math.max(0.04,this.camera.radius*0.08);
    this.camera.upperRadiusLimit=Math.max(10,this.camera.radius*5);
  }
  private setCameraView(alpha:number){this.camera.alpha=alpha;this.camera.beta=Math.PI/2.35;this.focusCamera();}
  private toggleInspectionMode(){
    this.inspectionMode=!this.inspectionMode;
    this.button("toggleInspection").textContent=this.inspectionMode?"Mostrar controles 3D":"Ocultar controles 3D";
    if(this.inspectionMode){this.gizmos.attachToNode(null);return;}
    if(this.selection==="bone")this.gizmos.attachToNode(this.boneGizmoNode);
    else if(this.selection==="hand")this.gizmos.attachToNode(this.handTarget);
    else if(this.selection==="prop")this.gizmos.attachToNode(this.selectedProp?this.props.get(this.selectedProp)?.node??null:null);
  }
  private toggleMultiView(force?:boolean){
    this.multiView=force??!this.multiView;
    this.camera.viewport=this.multiView?new Viewport(0,0.5,0.5,0.5):new Viewport(0,0,1,1);
    const slots=[new Viewport(0.5,0.5,0.5,0.5),new Viewport(0,0,0.5,0.5),
      new Viewport(0.5,0,0.5,0.5)];
    this.comparisonCameras.forEach((camera,index)=>camera.viewport=slots[index]);
    this.scene.activeCameras=this.multiView?[this.camera,...this.comparisonCameras]:null;
    this.scene.activeCamera=this.camera;
    this.element("multiViewLabels").classList.toggle("hidden",!this.multiView);
    this.button("toggleMultiView").textContent=this.multiView?"1 vista":"4 vistas";
  }
  private updateComparisonCameras(){
    if(!this.multiView)return;
    const bounds=this.getModelBounds();if(!bounds)return;
    const center=bounds.min.add(bounds.max).scale(0.5);
    const height=Math.max(0.8,bounds.max.y-bounds.min.y);
    for(let i=0;i<2;i++){
      this.comparisonCameras[i].setTarget(center);
      this.comparisonCameras[i].radius=height*1.55;
    }
    const controller=this.current?.controller;
    const handName=controller?.getBones().find(b=>/righthand$/i.test(b.name))?.name;
    const hand=handName?controller?.getBoneTransformNode(handName):null;
    const detail=hand?.getAbsolutePosition()??center.add(new Vector3(0,height*0.3,0));
    this.comparisonCameras[2].setTarget(detail);
    this.comparisonCameras[2].radius=Math.max(0.85,height*0.55);
  }
  private createBoneMarkers(){
    const controller=this.current?.controller;if(!controller)return;
    const material=new StandardMaterial("studioJointMarkerMat",this.scene);
    material.diffuseColor=Color3.Black();material.emissiveColor=BONE_COLOR;material.disableLighting=true;
    for(const bone of controller.getBones()){
      if(!controller.getBoneTransformNode(bone.name))continue;
      const marker=MeshBuilder.CreateSphere(`studioJoint_${bone.name}`,{diameter:0.035,segments:5},this.scene);
      marker.material=material;marker.metadata={studioBoneName:bone.name};marker.isPickable=true;
      marker.isVisible=false;this.markers.set(bone.name,marker);
    }
  }
  private clearBoneMarkers(){for(const marker of this.markers.values())marker.dispose(false,false);this.markers.clear();
    this.scene.getMaterialByName("studioJointMarkerMat")?.dispose();}
  private updateSkeleton(){
    const model=this.current;if(!model||!model.skeleton||!model.mesh)return;
    const enabled=this.input("showSkeleton").checked;
    if(!model.viewer&&enabled){model.viewer=new SkeletonViewer(model.skeleton,model.mesh,this.scene,true,2,{displayMode:SkeletonViewer.DISPLAY_LINES});model.viewer.color=BONE_COLOR;}
    if(model.viewer)model.viewer.isEnabled=enabled;
    for(const marker of this.markers.values())marker.isVisible=enabled;
  }
  private syncMarkers(){
    if(!this.input("showSkeleton").checked)return;
    const controller=this.current?.controller;if(!controller)return;
    for(const [name,marker] of this.markers){const node=controller.getBoneTransformNode(name);
      if(node){node.computeWorldMatrix(true);marker.position.copyFrom(node.getAbsolutePosition());}}
  }
  private renderBones(){
    const container=this.element("boneList");container.replaceChildren();
    const bones=this.current?.controller?.getBones()??[];
    const filter=this.input("boneSearch").value.trim().toLowerCase();
    const modified=new Set(this.current?.controller?.getEditedBoneNames()??[]);
    for(const bone of bones){
      if(filter&&!`${bone.name} ${bone.alias??""}`.toLowerCase().includes(filter))continue;
      const btn=document.createElement("button");btn.className="bone-button";
      if(bone.name===this.selectedBone)btn.classList.add("active");
      if(modified.has(bone.name))btn.classList.add("changed");
      btn.textContent=bone.alias?`${bone.alias} · ${bone.name}`:bone.name;
      const dot=document.createElement("small");dot.textContent=modified.has(bone.name)?"◆":"";btn.append(dot);
      btn.onclick=()=>this.selectBone(bone.name);container.append(btn);
    }
    if(!container.childNodes.length){const span=document.createElement("div");span.className="empty";span.textContent="No hay huesos que coincidan";container.append(span);}
  }
  private selectBone(name:string){
    const node=this.current?.controller?.getBoneTransformNode(name);if(!node)return;
    this.playback=false;
    this.selectedBone=name;this.selection="bone";this.selectedProp=null;this.handSide=null;
    this.boneGizmoNode.parent=node.parent;
    this.boneGizmoNode.position.copyFrom(node.position);
    this.boneGizmoNode.rotationQuaternion?.copyFrom(node.rotationQuaternion??Quaternion.Identity());
    this.gizmos.positionGizmoEnabled=false;this.gizmos.scaleGizmoEnabled=false;this.gizmos.rotationGizmoEnabled=true;
    this.wireRotationGizmo();
    if(!this.inspectionMode)this.gizmos.attachToNode(this.boneGizmoNode);
    this.refreshSelection();this.renderBones();this.renderProps();
    const guide=this.element("poseGuide");
    guide.textContent=/hand(thumb|index|middle|ring|pinky)/i.test(name)
      ?"Dobla esta falange sobre el borde del celular. Evita atravesar la pantalla; revisa el resultado desde el costado y en el detalle antes de capturar el keyframe."
      :/forearm|shoulder|(?<!fore)arm$/i.test(name)
        ?"Lleva el brazo hacia adelante y arriba, con el codo debajo de la mano. Usa el objetivo de mano para desplazarla y esta rotacion para afinar el gesto."
        :/hand$/i.test(name)
          ?"La muneca debe seguir la linea del antebrazo. El celular debe quedar entre los dedos; corrige la inclinacion con movimientos pequenos."
          :"Gira el hueso en el tiempo elegido y revisa la pose en las cuatro vistas. Auto-key guarda el cambio en ese keyframe.";
  }
  private updateBoneGizmoPose(){
    if(this.draggingBone||this.selection!=="bone"||!this.selectedBone)return;
    const node=this.current?.controller?.getBoneTransformNode(this.selectedBone);
    if(!node)return;
    this.boneGizmoNode.parent=node.parent;this.boneGizmoNode.position.copyFrom(node.position);
    this.boneGizmoNode.rotationQuaternion?.copyFrom(node.rotationQuaternion??Quaternion.Identity());
  }
  private onDragStart(){
    if(this.selection==="bone"&&this.selectedBone){
      this.playback=false;this.draggingBone=true;
      this.dragStartRotation.copyFrom(this.boneGizmoNode.rotationQuaternion??Quaternion.Identity());
      this.dragStartOffset.copyFrom(this.current?.controller?.getRotationOffset(this.selectedBone)??Quaternion.Identity());
    }else if(this.selection==="prop"){
      this.playback=false;this.draggingProp=true;
    }
  }
  private onRotationDrag(){
    if(this.selection!=="bone"||!this.draggingBone||!this.selectedBone)return;
    const rotation=this.boneGizmoNode.rotationQuaternion;if(!rotation)return;
    const delta=this.dragStartRotation.conjugate().multiply(rotation).normalize();
    const offset=this.dragStartOffset.multiply(delta).normalize();
    this.current?.controller?.setRotationOffset(this.selectedBone,offset);
  }
  private onDragEnd(){
    if(this.draggingBone||this.draggingProp){
      this.draggingBone=false;this.draggingProp=false;
      this.updateBoneGizmoPose();this.refreshSelection();this.maybeAutoKey();
    }else if(this.selection==="hand"){
      this.refreshHandTargetFields();this.applyHandTarget();
    }
  }
  private refreshBoneFields(){
    if(this.selection!=="bone"||!this.selectedBone)return;
    const q=this.current?.controller?.getRotationOffset(this.selectedBone)??Quaternion.Identity();
    const angles=q.toEulerAngles();
    const degrees=[angles.x*DEG,angles.y*DEG,angles.z*DEG];
    ["boneRotX","boneRotY","boneRotZ"].forEach((id,i)=>{
      const field=this.input(id);
      if(document.activeElement!==field)field.value=degrees[i].toFixed(2);
    });
  }
  private setBoneEuler(){
    if(!this.selectedBone)return;
    this.playback=false;
    const x=Number(this.input("boneRotX").value)*RAD;
    const y=Number(this.input("boneRotY").value)*RAD;
    const z=Number(this.input("boneRotZ").value)*RAD;
    this.current?.controller?.setRotationOffset(this.selectedBone,Quaternion.FromEulerAngles(x,y,z));
    this.refreshBoneFields();this.maybeAutoKey();
  }

  private filterFingers(side:"right"|"left"){
    this.input("boneSearch").value=`${side}hand`;
    this.renderBones();
    this.element("poseGuide").textContent=`Selecciona Thumb, Index, Middle, Ring y Pinky de la mano ${side==="right"?"derecha":"izquierda"}. Gira cada falange con los anillos o XYZ; ajusta la curva de los dedos alrededor de los bordes del celular. Revisa frente, costado y detalle antes de guardar el keyframe.`;
  }
  private selectHandTarget(side:"right"|"left"){
    const controller=this.current?.controller;
    const bone=controller?.getBones().find(b=>new RegExp(`${side}hand$`,"i").test(b.name));
    const node=bone?controller?.getBoneTransformNode(bone.name):null;
    if(!node){this.status("Esta variante no tiene mano editable; elegi un fan con rig.",true);return;}
    this.playback=false;this.handSide=side;this.selectedBone=null;this.selectedProp=null;this.selection="hand";
    node.computeWorldMatrix(true);this.handTarget.position.copyFrom(node.getAbsolutePosition());
    this.gizmos.attachToNode(null);
    this.gizmos.rotationGizmoEnabled=false;this.gizmos.scaleGizmoEnabled=false;
    this.gizmos.positionGizmoEnabled=true;
    if(!this.inspectionMode)this.gizmos.attachToNode(this.handTarget);
    this.wirePropGizmo(this.gizmos.gizmos.positionGizmo);
    this.refreshHandTargetFields();this.refreshSelection();this.renderBones();this.renderProps();
    this.element("poseGuide").textContent=`Mueve el objetivo de la mano ${side==="right"?"derecha":"izquierda"} con las flechas o XYZ y aplica la posicion. El brazo se resuelve desde hombro y codo; luego ajusta muneca y dedos por separado.`;
  }
  private refreshHandTargetFields(){
    const p=this.handTarget.position;
    for(const [id,value] of [["handTargetX",p.x],["handTargetY",p.y],["handTargetZ",p.z]] as const)
      if(document.activeElement!==this.input(id))this.input(id).value=value.toFixed(3);
  }
  private applyHandTarget(){
    const model=this.current,side=this.handSide;
    if(!model?.controller||!(model.mesh instanceof Mesh)||!side)return;
    const x=Number(this.input("handTargetX").value),y=Number(this.input("handTargetY").value),z=Number(this.input("handTargetZ").value);
    if([x,y,z].every(Number.isFinite))this.handTarget.position.set(x,y,z);
    const rig=new MixamoProceduralRig([model.mesh],model.groups,[]);
    const names=[`${side}ForeArm`,`${side}Arm`,`${side}Shoulder`] as const;
    const before=new Map<string,Quaternion>();
    for(const alias of names){
      const node=rig.getJointNode(alias);
      if(node?.rotationQuaternion)before.set(node.name,node.rotationQuaternion.clone());
    }
    const chain=names.map((joint,index)=>({joint,maxAngle:[0.38,0.42,0.20][index]}));
    if(!rig.solveCcdToTarget(chain,`${side}Hand`,this.handTarget.position,12)){
      this.status("No se pudo resolver el brazo de este rig.",true);return;
    }
    const existing=model.controller.createPose("ik",{}).bones;
    const offsets=new Map(Object.entries(existing).map(([name,bone])=>[name,new Quaternion(...bone.rotationOffset)]));
    for(const [name,start] of before){
      const node=model.controller.getBoneTransformNode(name);
      const after=node?.rotationQuaternion?.clone();if(!node||!after)continue;
      const old=offsets.get(name)??Quaternion.Identity();
      offsets.set(name,old.multiply(start.conjugate().multiply(after)).normalize());
      node.rotationQuaternion?.copyFrom(start);
    }
    model.controller.loadPose({id:"handTarget",bones:Object.fromEntries([...offsets].map(([name,q])=>
      [name,{rotationOffset:[q.x,q.y,q.z,q.w] as QuatData}]))});
    this.maybeAutoKey();this.refreshHandTargetFields();this.renderBones();
    this.status(`Brazo ${side==="right"?"derecho":"izquierdo"} ajustado en t=${this.time.toFixed(2)}s. Revisa la muneca y los dedos en las 4 vistas.`);
  }

  private createPropNode(spec:StudioPropSpec,primitive:"box"|"sphere"|"cylinder"|"placeholder"="box"){
    const root=new TransformNode(`studioProp_${spec.id}`,this.scene);
    const parent=this.findAttachmentParent(spec.boneName);root.parent=parent;
    const mesh=primitive==="sphere"?MeshBuilder.CreateSphere(`mesh_${spec.id}`,{diameter:0.22,segments:14},this.scene)
      :primitive==="cylinder"?MeshBuilder.CreateCylinder(`mesh_${spec.id}`,{height:0.23,diameter:0.08},this.scene)
      :MeshBuilder.CreateBox(`mesh_${spec.id}`,{size:primitive==="placeholder"?0.16:0.20},this.scene);
    const material=new StandardMaterial(`studioPropMat_${spec.id}`,this.scene);
    material.diffuseColor=primitive==="placeholder"?new Color3(0.88,0.64,0.3):DEV_COLOR;
    material.specularColor=new Color3(0.12,0.12,0.12);
    mesh.material=material;mesh.parent=root;mesh.isPickable=true;mesh.metadata={studioPropId:spec.id};
    return {node:root,meshes:[mesh] as AbstractMesh[]};
  }
  private findAttachmentParent(bone:string|null):TransformNode|null {
    return (bone?this.current?.controller?.getBoneTransformNode(bone):null)??this.current?.root??null;
  }
  private initialBoneForNewProp(){
    if(this.selectedBone)return this.selectedBone;
    return this.current?.controller?.getBones().find(b=>/righthand$/i.test(b.name))?.name??null;
  }
  private createSpec(name:string,kind:StudioPropSpec["kind"],fileName:string|null){
    return {id:`prop_${this.nextPropId++}`,name,kind,fileName,boneName:this.initialBoneForNewProp(),defaultTransform:identityTransform()} satisfies StudioPropSpec;
  }
  private addPrimitive(kind:"box"|"sphere"){
    if(!this.current){this.status("Cargá primero un personaje con rig.",true);return;}
    const spec=this.createSpec(kind==="box"?"Caja de referencia":"Esfera de referencia",kind,null);
    const primitive=this.createPropNode(spec,kind);
    this.props.set(spec.id,{spec,node:primitive.node,meshes:primitive.meshes,placeholder:false});
    this.session.props.push(spec);this.selectProp(spec.id);this.status(`Accesorio ${spec.name} unido a ${spec.boneName??"raíz"}`);
  }
  private async loadProp(file:File){
    if(!this.current){this.status("Primero importá un personaje con rig.",true);return;}
    if(!file.name.toLowerCase().endsWith(".glb"))throw Error("Los accesorios deben estar en formato .glb");
    this.setBusy(true);
    const match=[...this.props.values()].find(p=>p.placeholder&&p.spec.kind==="glb"&&p.spec.fileName===file.name);
    const spec=match?.spec??this.createSpec(file.name.replace(/\.glb$/i,""),"glb",file.name);
    const result=await SceneLoader.ImportMeshAsync(null,"",file,this.scene);
    if(this.disposed||!this.current){this.disposeImport(result);return;}
    for(const a of result.animationGroups)a.stop();
    const root=new TransformNode(`studioProp_${spec.id}`,this.scene);
    root.parent=this.findAttachmentParent(spec.boneName);
    for(const node of [...result.meshes,...result.transformNodes])if(!node.parent)node.parent=root;
    const meshes=result.meshes.filter(m=>m.getTotalVertices()>0);
    for(const mesh of meshes){mesh.isPickable=true;mesh.metadata={studioPropId:spec.id};}
    forceOpaqueMaterials(meshes);
    if(file.name==="Smartphone_RinaReady.glb"){
      const body=meshes.find(mesh=>mesh.name.includes("SmartPhone_Body"));
      body?.enableEdgesRendering(0.995);
      if(body){body.edgesColor=new Color4(0.33,0.9,0.75,1);body.edgesWidth=1.8;}
    }
    if(!match&&file.name==="Smartphone_RinaReady.glb"){
      const body=meshes.find(mesh=>mesh.name.includes("SmartPhone_Body"));
      if(body){
        root.computeWorldMatrix(true);body.computeWorldMatrix(true);
        const box=body.getBoundingInfo().boundingBox;
        const size=box.maximumWorld.subtract(box.minimumWorld);
        const longest=Math.max(size.x,size.y,size.z);
        const fanHeight=RINA_CROWD_FANS.find(fan=>fan.id===this.selectedFan)?.targetWorldHeight;
        const desiredHeight=RINA_PHONE_WORLD_HEIGHT*(fanHeight?fanHeight/1.6:1);
        if(longest>0.000001)root.scaling.setAll(desiredHeight/longest);
      }
    }
    if(match){
      const transform=this.readTransform(match.node);const old=this.props.get(spec.id);
      if(old){old.node.dispose(false,true);this.props.delete(spec.id);}
      this.applyTransform(root,transform);
    } else {
      spec.defaultTransform=this.readTransform(root);
      this.session.props.push(spec);
    }
    this.props.set(spec.id,{spec,node:root,meshes,placeholder:false});
    this.selectProp(spec.id);
    this.status(`${file.name} agregado. Elegí la mano, mové el objeto y registrá keyframes.`);
    this.setBusy(false);
  }
  private selectProp(id:string){
    const prop=this.props.get(id);if(!prop)return;
    this.playback=false;this.selection="prop";this.selectedProp=id;this.selectedBone=null;this.handSide=null;
    this.setPropGizmo(this.gizmoMode);
    this.refreshSelection();this.renderBones();this.renderProps();
    this.element("poseGuide").textContent=prop.spec.fileName==="Smartphone_RinaReady.glb"
      ?"Mueve y rota el celular entre ambas manos. La pantalla debe mirar al fan; la camara y el flash, al escenario de Rina. Revisa el agarre y el tamano en la vista de detalle."
      :"Mueve el accesorio en el tiempo elegido; su posicion y rotacion siguen el hueso al que esta unido.";
  }
  private setPropGizmo(mode:"move"|"rotate"|"scale"){
    this.gizmoMode=mode;
    if(this.selection==="prop"){
      this.gizmos.attachToNode(null);
      this.gizmos.positionGizmoEnabled=mode==="move";
      this.gizmos.rotationGizmoEnabled=mode==="rotate";
      this.gizmos.scaleGizmoEnabled=mode==="scale";
      this.wireRotationGizmo();
      const prop=this.selectedProp?this.props.get(this.selectedProp):null;
      if(prop&&!this.inspectionMode)this.gizmos.attachToNode(prop.node);
      this.wirePropGizmo(this.gizmos.gizmos.positionGizmo);
      this.wirePropGizmo(this.gizmos.gizmos.scaleGizmo);
    }
    for(const id of ["gizmoMove","gizmoRotate","gizmoScale"]){
      this.button(id).classList.toggle("selected",id===(mode==="move"?"gizmoMove":mode==="rotate"?"gizmoRotate":"gizmoScale"));
    }
  }
  private wireRotationGizmo(){
    const gizmo=this.gizmos.gizmos.rotationGizmo;
    if(!gizmo||this.wiredGizmos.has(gizmo))return;
    this.wiredGizmos.add(gizmo);
    gizmo.onDragStartObservable.add(()=>this.onDragStart());
    gizmo.onDragObservable.add(()=>this.onRotationDrag());
    gizmo.onDragEndObservable.add(()=>this.onDragEnd());
  }
  private wirePropGizmo(gizmo:{onDragStartObservable:{add(callback:()=>void):unknown};onDragEndObservable:{add(callback:()=>void):unknown}}|null|undefined){
    if(!gizmo||this.wiredGizmos.has(gizmo))return;
    this.wiredGizmos.add(gizmo);
    gizmo.onDragStartObservable.add(()=>{if(this.selection==="prop"){this.draggingProp=true;this.playback=false;}
      if(this.selection==="hand")this.playback=false;});
    gizmo.onDragEndObservable.add(()=>{if(this.draggingProp||this.selection==="hand")this.onDragEnd();});
  }
  private renderProps(){
    const target=this.element("propList");target.replaceChildren();
    if(!this.props.size){const empty=document.createElement("span");empty.className="help";empty.textContent="Sin objetos adjuntos.";target.append(empty);return;}
    for(const [id,prop] of this.props){
      const button=document.createElement("button");
      button.textContent=`${prop.placeholder?"⚠ ":""}${prop.spec.name}  ·  ${prop.spec.boneName??"raíz"}`;
      if(this.selectedProp===id)button.classList.add("active");
      button.onclick=()=>this.selectProp(id);target.append(button);
    }
  }
  private bindSelectedProp(boneName:string|null){
    const p=this.selectedProp?this.props.get(this.selectedProp):null;if(!p)return;
    this.playback=false;
    p.spec.boneName=boneName;
    const previousScale=p.node.scaling.clone();
    p.node.parent=this.findAttachmentParent(boneName);
    p.node.position.setAll(0);p.node.rotationQuaternion=Quaternion.Identity();p.node.scaling.copyFrom(previousScale);
    p.spec.defaultTransform=this.readTransform(p.node);
    for(const key of this.session.keys)delete key.props[p.spec.id];
    this.status("Objeto re-vinculado. Se limpiaron sus keyframes anteriores porque cambió el espacio local.");
    this.renderProps();this.refreshPropFields();this.maybeAutoKey();
  }
  private removeSelectedProp(){
    const id=this.selectedProp;const prop=id?this.props.get(id):null;if(!id||!prop)return;
    this.gizmos.attachToNode(null);
    prop.node.dispose(false,true);this.props.delete(id);
    this.session.props=this.session.props.filter(p=>p.id!==id);
    for(const key of this.session.keys)delete key.props[id];
    this.selectedProp=null;this.selection=null;this.refreshSelection();this.renderProps();this.refreshTimeline();
  }
  private clearProps(){
    this.gizmos.attachToNode(null);
    for(const prop of this.props.values())prop.node.dispose(false,true);
    this.props.clear();this.selectedProp=null;
  }
  private readTransform(node:TransformNode):StudioTransform{
    if(!node.rotationQuaternion){node.rotationQuaternion=Quaternion.FromEulerAngles(node.rotation.x,node.rotation.y,node.rotation.z);node.rotation.setAll(0);}
    const p=node.position,q=node.rotationQuaternion,s=node.scaling;
    return {position:[p.x,p.y,p.z],rotation:[q.x,q.y,q.z,q.w],scaling:[s.x,s.y,s.z]};
  }
  private applyTransform(node:TransformNode,transform:StudioTransform){
    const {position,rotation,scaling}=transform;
    node.position.set(...position);node.rotationQuaternion=new Quaternion(...rotation);node.scaling.set(...scaling);
  }
  private refreshPropFields(){
    const p=this.selectedProp?this.props.get(this.selectedProp):null;if(!p||this.selection!=="prop")return;
    const t=this.readTransform(p.node);
    const e=new Quaternion(...t.rotation).toEulerAngles();
    const vals={posX:t.position[0],posY:t.position[1],posZ:t.position[2],rotX:e.x*DEG,rotY:e.y*DEG,rotZ:e.z*DEG,
      scaleX:t.scaling[0],scaleY:t.scaling[1],scaleZ:t.scaling[2]};
    for(const [id,val] of Object.entries(vals)){const field=this.input(id);if(document.activeElement!==field)field.value=val.toFixed(3);}
  }
  private setPropTransformFromFields(){
    const p=this.selectedProp?this.props.get(this.selectedProp):null;if(!p)return;
    this.playback=false;
    const value=(name:string,defaultValue:number)=>Number.isFinite(Number(this.input(name).value))?Number(this.input(name).value):defaultValue;
    p.node.position.set(value("posX",0),value("posY",0),value("posZ",0));
    p.node.rotationQuaternion=Quaternion.FromEulerAngles(value("rotX",0)*RAD,value("rotY",0)*RAD,value("rotZ",0)*RAD);
    p.node.scaling.set(value("scaleX",1),value("scaleY",1),value("scaleZ",1));
    this.maybeAutoKey();this.refreshPropFields();
  }
  private refreshSelection(){
    this.element("selectionTitle").textContent=this.selection==="bone"?`Hueso · ${this.selectedBone}`:
      this.selection==="prop"?`Accesorio · ${this.props.get(this.selectedProp??"")?.spec.name}`:"Ninguna selección";
    if(this.selection==="hand")this.element("selectionTitle").textContent=`Objetivo de mano ${this.handSide}`;
    this.element("boneInspector").classList.toggle("disabled-inspector",this.selection!=="bone");
    this.element("propInspector").classList.toggle("disabled-inspector",this.selection!=="prop");
    const choice=this.select("propBone");const chosen=this.selectedProp?this.props.get(this.selectedProp)?.spec.boneName??"":"";
    choice.replaceChildren();choice.add(new Option("Raíz del personaje",""));
    for(const bone of this.current?.controller?.getBones()??[])choice.add(new Option(bone.alias?`${bone.alias} · ${bone.name}`:bone.name,bone.name));
    choice.value=chosen;
    this.refreshBoneFields();this.refreshPropFields();
  }

  private captureKey(silent=false){
    if(!this.current?.controller){if(!silent)this.status("Para grabar poses tenés que cargar un modelo con rig. LOD2 es estático.",true);return;}
    const bones:StudioKeyframe["bones"]={};
    const pose=this.current.controller.createPose("capture",{model:this.current.name,animation:this.session.baseAnimation??undefined,time:this.time});
    for(const [name,data] of Object.entries(pose.bones))bones[name]=[...data.rotationOffset] as QuatData;
    const props:StudioKeyframe["props"]={};
    for(const [id,p] of this.props)props[id]=this.readTransform(p.node);
    upsertKey(this.session,{time:this.time,easing:this.select("easing").value==="linear"?"linear":"smooth",bones,props});
    this.clearAnimationAudit();
    this.refreshTimeline();
    if(!silent)this.status(`Keyframe guardado en t=${this.time.toFixed(3)}s (${Object.keys(bones).length} huesos, ${Object.keys(props).length} objetos).`);
  }
  private maybeAutoKey(){if(this.input("autoKey").checked&&!this.playback)this.captureKey(true);}
  private deleteCurrentKey(){
    const pos=this.session.keys.findIndex(k=>Math.abs(k.time-this.time)<0.01);
    if(pos<0){this.status("Colocá el cursor temporal sobre un keyframe para eliminarlo.",true);return;}
    this.session.keys.splice(pos,1);this.clearAnimationAudit();this.refreshTimeline();this.seek(this.time);
  }
  private changeCurrentKeyEasing(){
    const key=this.session.keys.find(k=>Math.abs(k.time-this.time)<0.01);
    if(key){key.easing=this.select("easing").value==="linear"?"linear":"smooth";this.clearAnimationAudit();}
  }
  private seek(seconds:number){
    this.playback=false;
    this.time=Math.max(0,Math.min(this.session.duration,Number.isFinite(seconds)?seconds:0));
    this.applyAtTime(this.time);this.refreshTimeline();
  }
  private applyAtTime(t:number,playbackSample=false){
    const sample=sampleSession(this.session,t);
    if(this.current?.controller){
      const pose={id:"studioPreview",bones:Object.fromEntries(Object.entries(sample.bones).map(([name,rotationOffset])=>[name,{rotationOffset}]))};
      if(playbackSample){
        const offsets=new Map(Object.entries(sample.bones).map(([name,quat])=>[name,new Quaternion(...quat)]));
        this.current.controller.setProceduralOffsets(offsets);
      }else this.current.controller.loadPose(pose);
    }
    for(const [id,transform] of Object.entries(sample.props)){
      const prop=this.props.get(id);if(prop&&!this.draggingProp)this.applyTransform(prop.node,transform);
    }
    this.updateBoneGizmoPose();this.refreshPropFields();this.refreshBoneFields();
  }
  private togglePlay(){
    if(!this.current)return;
    this.playback=!this.playback;
    if(this.playback&&this.time>=this.session.duration-0.001)this.time=0;
    this.refreshPlayButton();
  }
  private frame(){
    if(this.disposed)return;
    if(this.bakingPhoto||this.analyzing)return;
    const now=performance.now();const dt=this.previousFrameMs?Math.min(0.08,(now-this.previousFrameMs)/1000):0;
    this.previousFrameMs=now;
    if(this.photoPreview&&this.photoPreviewTime<6.25){
      this.photoPreviewTime+=dt;
      this.photoPreview.update(dt,this.photoTarget);
      this.element("proceduralInfo").textContent=
        `Foto de Rina · ${this.photoPreviewTime.toFixed(1)} s · acción actual del juego. Podés convertirla en keyframes editables.`;
    }
    if(this.playback){
      this.time+=dt;
      if(this.time>=this.session.duration){if(this.session.loop)this.time%=this.session.duration;
        else{this.time=this.session.duration;this.playback=false;this.refreshPlayButton();}}
      this.applyAtTime(this.time,true);
      this.refreshTimelineTimeOnly();
    }
    this.updateComparisonCameras();
    this.scene.render();
    this.syncMarkers();
    if(this.selection==="prop"&&!this.draggingProp)this.refreshPropFields();
    if(this.draggingProp)this.refreshPropFields();
  }
  private refreshPlayButton(){this.button("playPause").textContent=this.playback?"Ⅱ Pausar":"▶ Reproducir";}
  private refreshTimelineTimeOnly(){
    this.input("timeSlider").value=String(this.time);
    if(document.activeElement!==this.input("timeInput"))this.input("timeInput").value=this.time.toFixed(3);
  }
  private refreshTimeline(){
    const duration=this.session.duration;
    this.input("timeSlider").max=String(duration);
    this.input("timeInput").max=String(duration);
    this.input("duration").value=duration.toFixed(2);
    this.element("timelineEnd").textContent=`${duration.toFixed(2)}s`;
    this.refreshTimelineTimeOnly();this.refreshPlayButton();
    this.element("keyCount").textContent=`${this.session.keys.length} keys`;
    const track=this.element("keyTrack"),list=this.element("keyList");track.replaceChildren();list.replaceChildren();
    for(const key of this.session.keys){
      const near=Math.abs(this.time-key.time)<0.01;
      const marker=document.createElement("button");marker.className="key-diamond"+(near?" active":"");
      marker.title=`t=${key.time.toFixed(3)}s · ${Object.keys(key.bones).length} huesos`;
      marker.style.left=`${(key.time/duration)*100}%`;marker.onclick=()=>this.seek(key.time);track.append(marker);
      const chip=document.createElement("button");chip.className="key-chip"+(near?" active":"");
      chip.textContent=`◆ ${key.time.toFixed(2)}s`;
      chip.title=`${Object.keys(key.bones).length} huesos · ${Object.keys(key.props).length} props`;
      chip.onclick=()=>this.seek(key.time);list.append(chip);
      const timeField=document.createElement("input");
      timeField.type="number";timeField.className="key-time-input";
      timeField.min="0";timeField.max=String(this.session.duration);
      timeField.step="0.01";timeField.value=key.time.toFixed(2);
      timeField.title="Cambiar tiempo del keyframe";
      timeField.onchange=()=>{
        const next=Math.max(0,Math.min(this.session.duration,Number(timeField.value)));
        if(this.session.keys.some(other=>other!==key&&Math.abs(other.time-next)<0.001)){
          this.status("Ya existe otro keyframe en ese instante.",true);this.refreshTimeline();return;
        }
        key.time=Math.round(next*1000)/1000;
        this.session.keys.sort((a,b)=>a.time-b.time);
        this.seek(key.time);
      };
      list.append(timeField);
    }
    if(!this.session.keys.length){const e=document.createElement("span");e.className="help";e.textContent="Sin keys. Colocá el cursor y tocá Capturar keyframe.";list.append(e);}
    const match=this.session.keys.find(k=>Math.abs(this.time-k.time)<0.01);
    if(match)this.select("easing").value=match.easing;
  }
  private refreshAll(){
    this.input("animationName").value=this.session.id;
    this.input("loop").checked=this.session.loop;
    this.input("modelScale").value=this.session.modelScale.toFixed(3);
    this.renderBones();this.renderProps();this.refreshSelection();this.refreshTimeline();this.updateSkeleton();
  }
  private clearAnimationAudit(){
    this.auditReport=null;
    this.element("animationAnalysis").textContent="El análisis revisa saltos de articulaciones, tamaño del celular y contacto de los dedos. Seleccioná un resultado para ir a ese keyframe.";
  }
  public getAnimationAuditReport(){return this.auditReport?structuredClone(this.auditReport):null;}
  public runAnimationAudit(silent=false):AnimationAuditReport|null{
    const model=this.current,controller=model?.controller;
    if(!controller||!this.session.keys.length){
      if(!silent)this.status("Cargá una sesión con keyframes para analizarla.",true);
      return null;
    }
    const previousTime=this.time,wasPlaying=this.playback;
    const activeCameras=this.scene.activeCameras;
    const phone=[...this.props.values()].find(prop=>prop.spec.fileName==="Smartphone_RinaReady.glb");
    const body=phone?.meshes.find(mesh=>mesh.name.includes("SmartPhone_Body"))??null;
    const display=phone?.meshes.find(mesh=>mesh.name.includes("RinaPhone_DisplayOverlay"))??null;
    const boneNode=(suffix:string)=>{
      const bone=controller.getBones().find(item=>item.name.toLowerCase().endsWith(suffix.toLowerCase()));
      return bone?controller.getBoneTransformNode(bone.name):null;
    };
    const fingerNames=(side:"Right"|"Left")=>["Thumb1","Thumb2","Index1","Index2","Index3","Middle1","Middle2","Middle3"]
      .map(suffix=>`${side}Hand${suffix}`);
    const rightFingers=fingerNames("Right").map(boneNode).filter((node):node is TransformNode=>!!node);
    const leftFingers=fingerNames("Left").map(boneNode).filter((node):node is TransformNode=>!!node);
    const head=boneNode("Head");
    const rightShoulder=boneNode("RightShoulder"),leftShoulder=boneNode("LeftShoulder");
    const rightHand=boneNode("RightHand"),leftHand=boneNode("LeftHand");
    const samples:AnimationAuditSample[]=[],issues:AnimationAuditIssue[]=[];
    const expectedLength=RINA_PHONE_WORLD_HEIGHT*(RINA_CROWD_FANS.find(fan=>fan.id===this.selectedFan)?.targetWorldHeight??1.6)/1.6;
    this.analyzing=true;this.playback=false;this.setBusy(true);
    this.scene.activeCameras=[this.camera];
    try{
      const keys=[...this.session.keys].sort((a,b)=>a.time-b.time);
      for(let index=0;index<keys.length;index++){
        const key=keys[index],previous=keys[index-1];
        this.time=key.time;this.applyAtTime(key.time,true);
        this.scene.render();
        const sample:AnimationAuditSample={time:key.time};
        if(rightShoulder&&leftShoulder&&rightHand&&leftHand){
          for(const node of [rightShoulder,leftShoulder,rightHand,leftHand])node.computeWorldMatrix(true);
          const shoulderAxis=rightShoulder.getAbsolutePosition().subtract(leftShoulder.getAbsolutePosition());
          sample.shoulderWidth=shoulderAxis.length();
          if(sample.shoulderWidth>0.001){shoulderAxis.normalize();
            sample.handSideSeparation=Vector3.Dot(rightHand.getAbsolutePosition().subtract(
              leftHand.getAbsolutePosition()),shoulderAxis);}
        }
        if(previous){
          let maximum=0;
          const jointNames=new Set([...Object.keys(previous.bones),...Object.keys(key.bones)]);
          for(const name of jointNames){
            if(!/(shoulder|forearm|arm|hand|neck|head)$/i.test(name))continue;
            const a=previous.bones[name]??[0,0,0,1],b=key.bones[name]??[0,0,0,1];
            const dot=Math.min(1,Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]));
            maximum=Math.max(maximum,2*Math.acos(dot));
          }
          sample.largestJointStep=maximum;
          if(maximum>0.65)issues.push({time:key.time,kind:"motion",
            message:`Salto de ${Math.round(maximum*DEG)}° en una articulación principal desde el keyframe anterior.`});
        }
        if(body&&!body.isDisposed()){
          const world=body.computeWorldMatrix(true),bounds=body.getBoundingInfo().boundingBox;
          const size=bounds.maximum.subtract(bounds.minimum);
          sample.phoneSizeLocal=[size.x,size.y,size.z];
          sample.phoneMinLocal=[bounds.minimum.x,bounds.minimum.y,bounds.minimum.z];
          sample.phoneMaxLocal=[bounds.maximum.x,bounds.maximum.y,bounds.maximum.z];
          const axes=[new Vector3(size.x,0,0),new Vector3(0,size.y,0),new Vector3(0,0,size.z)]
            .map(axis=>Vector3.TransformNormal(axis,world));
          const lengths=axes.map(axis=>axis.length());
          sample.phoneLength=Math.max(...lengths);
          const longAxis=axes[lengths.indexOf(sample.phoneLength)].normalize();
          sample.phoneTiltDeg=Math.acos(Math.min(1,Math.abs(longAxis.y)))*DEG;
          if(longAxis.y<0)longAxis.negateInPlace();
          sample.phoneLeanDeg=Math.atan2(longAxis.x,longAxis.y)*DEG;
          const inverse=Matrix.Invert(world);
          const gripGap=(nodes:TransformNode[])=>{
            let distance=Infinity;
            let offset:Vec3Data|undefined;
            let localContact:Vec3Data|undefined;
            for(const node of nodes){
              node.computeWorldMatrix(true);
              const point=node.getAbsolutePosition();
              const local=Vector3.TransformCoordinates(point,inverse);
              const nearest=new Vector3(
                Math.max(bounds.minimum.x,Math.min(bounds.maximum.x,local.x)),
                Math.max(bounds.minimum.y,Math.min(bounds.maximum.y,local.y)),
                Math.max(bounds.minimum.z,Math.min(bounds.maximum.z,local.z)));
              const contact=Vector3.TransformCoordinates(nearest,world);
              const candidate=Vector3.Distance(point,contact);
              if(candidate<distance){distance=candidate;localContact=[nearest.x,nearest.y,nearest.z];
                const delta=contact.subtract(point);offset=[delta.x,delta.y,delta.z];}
            }
            return {distance:Number.isFinite(distance)?distance:undefined,offset,localContact};
          };
          const rightContact=gripGap(rightFingers),leftContact=gripGap(leftFingers);
          sample.rightGripGap=rightContact.distance;sample.rightGripOffset=rightContact.offset;
          sample.rightGripLocal=rightContact.localContact;
          sample.leftGripGap=leftContact.distance;sample.leftGripOffset=leftContact.offset;
          sample.leftGripLocal=leftContact.localContact;
          sample.fingerTips={};
          const tipWorld=new Map<string,Vector3>();
          for(const name of ["RightHandThumb3","RightHandIndex3","LeftHandThumb3","LeftHandIndex3"]){
            const node=boneNode(name);if(!node)continue;
            node.computeWorldMatrix(true);
            const point=node.getAbsolutePosition();
            tipWorld.set(name,point.clone());
            const local=Vector3.TransformCoordinates(point,inverse);
            const nearest=new Vector3(
              Math.max(bounds.minimum.x,Math.min(bounds.maximum.x,local.x)),
              Math.max(bounds.minimum.y,Math.min(bounds.maximum.y,local.y)),
              Math.max(bounds.minimum.z,Math.min(bounds.maximum.z,local.z)));
            const contact=Vector3.TransformCoordinates(nearest,world);
            sample.fingerTips[name]={local:[local.x,local.y,local.z],distance:Vector3.Distance(point,contact)};
          }
          const rightThumb=tipWorld.get("RightHandThumb3"),rightIndex=tipWorld.get("RightHandIndex3");
          const leftThumb=tipWorld.get("LeftHandThumb3"),leftIndex=tipWorld.get("LeftHandIndex3");
          if(rightThumb&&rightIndex)sample.rightPinchWidth=Vector3.Distance(rightThumb,rightIndex);
          if(leftThumb&&leftIndex)sample.leftPinchWidth=Vector3.Distance(leftThumb,leftIndex);
          if(rightContact.localContact&&leftContact.localContact&&size.x>0.001)
            sample.gripSideSpread=Math.abs(rightContact.localContact[0]-leftContact.localContact[0])/size.x;
          head?.computeWorldMatrix(true);
          const center=Vector3.TransformCoordinates(bounds.center,world);
          sample.aboveHead=head?center.y-head.getAbsolutePosition().y:undefined;
          const normals=display?.getVerticesData("normal");
          if(display&&normals?.length){
            display.computeWorldMatrix(true);
            const normal=Vector3.TransformNormal(Vector3.FromArray(normals,0),
              display.getWorldMatrix()).normalize();
            const toStage=this.photoTarget.subtract(center).normalize();
            sample.screenFacesFan=-Vector3.Dot(normal,toStage);
          }
          if(Math.abs(sample.phoneLength-expectedLength)>expectedLength*0.2)
            issues.push({time:key.time,kind:"scale",message:`Celular de ${(sample.phoneLength*100).toFixed(1)} cm; esperado cerca de ${(expectedLength*100).toFixed(1)} cm.`});
          if(key.time>=1.1&&key.time<=3.9){
            if((sample.handSideSeparation??1)<0.02)
              issues.push({time:key.time,kind:"grip",message:"Las manos se cruzan frente al celular; separá los codos y apoyá los dedos en lados opuestos."});
            if(sample.screenFacesFan!==undefined&&sample.screenFacesFan<0.7)
              issues.push({time:key.time,kind:"framing",message:`Pantalla mal orientada: alineación ${sample.screenFacesFan.toFixed(2)} (ideal ≥ 0.70).`});
            if(sample.phoneTiltDeg>25)
              issues.push({time:key.time,kind:"framing",message:`Celular inclinado ${Math.round(sample.phoneTiltDeg)}° durante la foto.`});
            if((sample.rightGripGap??0)>0.055)
              issues.push({time:key.time,kind:"grip",message:`Dedos derechos a ${((sample.rightGripGap??0)*100).toFixed(1)} cm del celular.`});
            if((sample.leftGripGap??0)>0.055)
              issues.push({time:key.time,kind:"grip",message:`Dedos izquierdos a ${((sample.leftGripGap??0)*100).toFixed(1)} cm del celular.`});
            for(const [label,thumb,index,pinchWidth] of [
              ["derecha","RightHandThumb3","RightHandIndex3",sample.rightPinchWidth],
              ["izquierda","LeftHandThumb3","LeftHandIndex3",sample.leftPinchWidth],
            ] as const){
              const thumbTip=sample.fingerTips?.[thumb],indexTip=sample.fingerTips?.[index];
              if(thumbTip&&indexTip&&Math.max(thumbTip.distance,indexTip.distance)>0.045)
                issues.push({time:key.time,kind:"grip",message:`Pulgar o índice de la mano ${label} separado del celular más de 4,5 cm.`});
              if(pinchWidth!==undefined&&pinchWidth<0.035)
                issues.push({time:key.time,kind:"grip",message:`Pulgar e índice de la mano ${label} demasiado juntos; revisar si la mano quedó cerrada.`});
            }
            if(sample.gripSideSpread!==undefined&&sample.gripSideSpread<0.25)
              issues.push({time:key.time,kind:"grip",message:"Ambas manos tocan el mismo lado del celular; separá los dedos hacia los bordes opuestos."});
            if((sample.aboveHead??0)<0.08)
              issues.push({time:key.time,kind:"framing",message:"El celular no alcanza la altura prevista sobre la cabeza."});
          }
        }
        samples.push(sample);
      }
      this.auditReport={animation:this.session.id,model:model?.name??null,samples,issues};
      this.renderAnimationAudit();
      if(!silent)this.status(`Análisis de ${samples.length} keyframes: ${issues.length} observaciones geométricas. Revisá también las vistas cercanas.`);
      return this.getAnimationAuditReport();
    }finally{
      this.time=previousTime;this.applyAtTime(previousTime,true);this.scene.activeCameras=activeCameras;
      this.scene.render();this.refreshTimeline();this.playback=wasPlaying;
      this.refreshPlayButton();this.analyzing=false;this.setBusy(false);
    }
  }
  private renderAnimationAudit(){
    const target=this.element("animationAnalysis");target.replaceChildren();
    const report=this.auditReport;if(!report)return;
    const summary=document.createElement("strong");
    summary.textContent=`${report.samples.length} keys · ${report.issues.length} observaciones`;
    target.append(summary);
    if(!report.issues.length){const ok=document.createElement("p");ok.textContent="Sin observaciones geométricas. Revisá visualmente intersecciones de malla y pantalla.";target.append(ok);return;}
    for(const issue of report.issues.slice(0,24)){
      const button=document.createElement("button");button.className="analysis-issue";
      button.textContent=`${issue.time.toFixed(2)}s · ${issue.message}`;
      button.onclick=()=>this.seek(issue.time);target.append(button);
    }
    if(report.issues.length>24){const more=document.createElement("span");
      more.textContent=`${report.issues.length-24} observaciones más en el diagnóstico exportable.`;target.append(more);}
  }
  private saveSession(){
    this.session.id=this.input("animationName").value.trim()||"pose_corrections";
    this.downloadJson(`${this.session.id}.studio.json`,this.session);
    this.status("Sesión editable guardada como JSON. Conservá también los archivos GLB de modelo y accesorios.");
  }
  private async loadSessionJson(json:string){
    this.stopPhotoPreview();
    const loaded=importStudioJson(JSON.parse(json),{
      modelFile:this.current?.name??null,baseAnimation:this.baseClip?.name??null,
      modelScale:this.current?.root.scaling.x??1,
    });
    if(!this.current||(loaded.modelFile!==null&&loaded.modelFile!==this.current.name)){
      this.pendingSession=loaded;
      this.status(`Sesión leída para '${loaded.modelFile??"modelo"}'. Importá ese GLB para restaurarla automáticamente.`,true);
      return;
    }
    this.installSession(loaded);
    this.status(loaded.props.some(p=>p.kind==="glb")
      ?"Sesión cargada. Reimportá los GLB accesorios con sus nombres originales para sustituir los proxies amarillos."
      :"Sesión cargada. Podés seguir editando poses y keyframes.");
  }
  private installSession(loaded:StudioSession){
    this.playback=false;this.pendingSession=null;this.clearProps();
    this.clearAnimationAudit();
    this.session=loaded;
    this.nextPropId=Math.max(1,...loaded.props.map(p=>Number(p.id.match(/^prop_(\d+)$/)?.[1]??0)+1));
    if(this.current){
      this.current.root.scaling.setAll(this.session.modelScale);
      this.select("baseAnimation").value=this.session.baseAnimation??"";
      this.chooseBaseClip(this.select("baseAnimation").value);
      this.session.duration=loaded.duration;
    }
    for(const spec of this.session.props){
      const item=this.createPropNode(spec,spec.kind==="glb"?"placeholder":spec.kind);
      this.applyTransform(item.node,spec.defaultTransform);
      this.props.set(spec.id,{spec,node:item.node,meshes:item.meshes,placeholder:spec.kind==="glb"});
    }
    this.seek(0);this.refreshAll();
  }
  private exportForGame(){
    this.session.id=this.input("animationName").value.trim()||"pose_corrections";
    const runtime=exportRuntime(this.session);
    this.downloadJson(`${this.session.id}.runtime.json`,runtime);
    this.status("Exportada animación procedural + accesorios y sus pistas locales para integración.");
  }
  private exportAnimationOnly(){
    this.session.id=this.input("animationName").value.trim()||"pose_corrections";
    this.downloadJson(`${this.session.id}.procedural.json`,exportRuntime(this.session).animation);
    this.status("Exportado ProceduralAnimationDefinition compatible con el reproductor existente.");
  }
  private downloadJson(filename:string,value:unknown){
    const blob=new Blob([JSON.stringify(value,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;
    document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  public dispose(){
    if(this.disposed)return;this.disposed=true;
    ++this.generation;
    window.removeEventListener("resize",this.resize);
    this.engine.stopRenderLoop();
    this.gizmos.dispose();this.clearModel();
    this.scene.dispose();this.engine.dispose();
  }
}
