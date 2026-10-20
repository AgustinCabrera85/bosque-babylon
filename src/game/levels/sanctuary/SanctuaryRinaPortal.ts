/**
 * Lo real y lo otro — La Sombra de Rina, concert portal (visual-only).
 *
 * Based on the successful texture-atlas architecture of SanctuaryAbyssPortalHybrid:
 *  - fits the concert to the same panel bounds as the forest portal;
 *  - preserves the stone arch and crimson vortex as a loading fallback;
 *  - uses one single-perspective scene and separately matted atlas sprites;
 *  - animates a 12 s ritual: audience -> photograph -> essence absorption -> oblivion -> loop.
 *
 * No level transitions, collision, audio, gameplay, or other portal is modified.
 * Options: ?sanctuaryRinaPortal=off, ?sanctuaryRinaSpeed=0.8,
 *          ?sanctuaryRinaNeon=1.15, ?sanctuaryRinaParallax=1.25,
 *          ?sanctuaryRinaQuality=low, ?sanctuaryRinaFreeze=5.5.
 */
import {
  Mesh, MeshBuilder, Scene, ShaderMaterial, Texture, TransformNode, Vector2, Vector3,
  Vector4, VertexBuffer,
} from "@babylonjs/core";
import { asset } from "../../../utils/asset";
import { FOREST_PORTAL_PANEL } from "./SanctuaryForestPortal";

const ROOT = "assets/textures/sanctuary/rina_portal/";
const SCHEMA = "lrlo.sanctuary.rina_concert.atlas.v1";
const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main(void) {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uBackdrop;
uniform sampler2D uAtlas;
uniform vec4 uKatyRect, uKatyBounds;
uniform vec4 uAuraRect, uAuraBounds;
uniform vec4 uLeftRect, uLeftBounds, uRightRect, uRightBounds;
uniform vec4 uPinkRect, uPinkBounds, uBlueRect, uBlueBounds;
uniform vec4 uFlashRect, uFlashBounds;
uniform vec2 uKatyOrigin, uRinaSink, uFlashOrigin;
uniform vec2 uParallax;
uniform float uTime, uCycleSeconds, uBeatSeconds, uNeon, uQuality;

float hash21(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),
             mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.,1.)),f.x),f.y);
}
float fbm(vec2 p) {
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){v+=a*noise2(p);p=p*2.05+vec2(17.1,9.7);a*=0.5;}
  return v;
}
vec4 sprite(vec2 uv, vec4 bounds, vec4 rect) {
  vec2 p = (uv - bounds.xy)/max(bounds.zw,vec2(0.0001));
  if (p.x<0.0 || p.y<0.0 || p.x>1.0 || p.y>1.0) return vec4(0.0);
  // uv_bottom_origin is stored in the manifest. A small inward inset eliminates
  // bleed from adjacent atlas rectangles and avoids mirrored/repeated edges.
  vec2 tc = mix(rect.xy,rect.zw,clamp(p,vec2(0.001),vec2(0.999)));
  return texture2D(uAtlas,tc);
}
float bell(float t, float center, float width) {return exp(-pow((t-center)/width,2.0));}

void main(void) {
  vec2 uv=vUV;
  float t=mod(uTime,max(uCycleSeconds,0.01));
  float beat=0.74+0.26*pow(0.5+0.5*sin(6.2831853*uTime/max(uBeatSeconds,0.15)),4.0);
  float photo=bell(t,2.94,0.13);
  float dissolve= smoothstep(3.10,7.55,t);
  float restored=smoothstep(9.65,uCycleSeconds,t);
  float coherence=clamp(1.0-dissolve+restored,0.0,1.0);
  float transfer=smoothstep(3.06,4.02,t)*(1.0-smoothstep(7.25,8.65,t));
  float hush=smoothstep(7.55,8.4,t)*(1.0-smoothstep(9.55,10.3,t));
  vec3 color=texture2D(uBackdrop,uv).rgb;
  // Single coherent camera: backdrop never wraps or shifts past a source edge.

  // Optional independently moving soft audience silhouettes (actual alpha sprites).
  // They are kept intentionally faint, as the source background already has a crowd.
  vec2 audienceShift=uParallax*vec2(0.60,0.18);
  float sway=0.0017*sin(uTime*1.2+uv.y*9.0);
  vec4 left=sprite(uv+audienceShift+vec2(sway,0.0),uLeftBounds,uLeftRect);
  vec4 right=sprite(uv+audienceShift-vec2(sway,0.0),uRightBounds,uRightRect);
  color=mix(color,left.rgb,left.a*(0.18*uQuality));
  color=mix(color,right.rgb,right.a*(0.16*uQuality));

  // Katy is a physically separated sprite sampled from the same painting.
  // During the photo her alpha is eroded into particles; the memory void below
  // remains, so the disappearance is real and not just extra purple light.
  vec2 katyShift=uParallax*vec2(0.27,0.06);
  vec2 katyUV=uv+katyShift;
  vec4 katy=sprite(katyUV,uKatyBounds,uKatyRect);
  float grain=fbm(katyUV*vec2(37.0,96.0)+vec2(uTime*0.16,-uTime*0.28));
  float edgeThreshold=1.0-coherence;
  float survive=smoothstep(edgeThreshold-0.16,edgeThreshold+0.16,grain);
  survive=mix(1.0,survive,smoothstep(0.005,0.32,1.0-coherence));
  survive*=smoothstep(0.0,0.16,coherence);
  float visibleKaty=katy.a*survive;
  color=mix(color,katy.rgb,visibleKaty);
  float breakingEdge=exp(-abs(grain-edgeThreshold)*17.0)*katy.a*transfer;
  color+=breakingEdge*vec3(0.65,0.11,0.50)*0.54*uNeon;

  // Violet/cyan essences travel upward from Katy to Rina (NOT from the singer).
  float height=clamp((uv.y-uKatyOrigin.y)/max(0.05,uRinaSink.y-uKatyOrigin.y),0.0,1.0);
  float corridor=smoothstep(uKatyOrigin.y-0.13,uKatyOrigin.y+0.025,uv.y)
                *(1.0-smoothstep(uRinaSink.y-0.015,uRinaSink.y+0.15,uv.y));
  float envelope=sin(height*3.14159265);
  float drift=0.024*sin(height*17.0-uTime*1.05)*envelope;
  float pathX=mix(uKatyOrigin.x,uRinaSink.x,height)+drift;
  float ribbonX=uv.x-pathX;
  float ribbonA=exp(-pow((ribbonX-0.021*sin(height*13.0+uTime*0.7))/0.026,2.0));
  float ribbonB=exp(-pow((ribbonX+0.026*sin(height*10.0-uTime*0.6))/0.022,2.0));
  float travelling=pow(max(0.0,sin(height*56.0-uTime*15.0)),13.0);
  float ribbon=(ribbonA+ribbonB*0.72)*(0.16+travelling*0.9)*corridor*transfer;
  vec3 magenta=vec3(1.0,0.082,0.72);
  vec3 cyan=vec3(0.13,0.65,1.0);
  color+=mix(magenta,cyan,0.45+0.40*sin(height*9.0+uTime*1.2)) * ribbon * 0.30*uNeon;

  // Discrete lights flowing toward the singer's palms/chest.
  float sparks=0.0;
  for(int i=0;i<14;i++) {
    float n=float(i);
    float f=fract(hash21(vec2(n,37.0))+(uTime-3.0)*(0.15+0.035*hash21(vec2(n,91.0))));
    vec2 q=mix(uKatyOrigin,uRinaSink,f);
    q.x+=sin(n*9.3+f*11.0+uTime*1.1)*0.044*(1.0-f);
    q.y+=sin(n*3.6+f*16.0)*0.014;
    float d=length((uv-q)*vec2(0.75,1.0));
    sparks+=exp(-d*d/(0.000015+0.000012*hash21(vec2(n,77.0))));
  }
  sparks*=transfer*mix(0.33,1.0,uQuality);
  color+=vec3(0.70,0.38,1.0)*min(sparks,1.9)*0.22*uNeon;

  // Stage aurora, synchronized to beat and absorption: Rina receives the glow.
  vec4 aura=sprite(uv,uAuraBounds,uAuraRect);
  color+=aura.rgb * aura.a * (0.10*beat+0.32*transfer) * uNeon;
  float stageHalo=exp(-pow(distance(uv,uRinaSink)/0.23,2.0));
  color+=mix(magenta,cyan,0.35+0.3*sin(uTime*.76))
         *stageHalo*(.045*beat+.19*transfer)*uNeon;

  // Mist in the audience, not over the rock frame. Offsets are sampled inside
  // soft RGBA masks, so no rectangular gradients or UV wrap can appear.
  vec4 mistPink=sprite(uv+uParallax*.25+vec2(sin(uTime*.21)*.021,cos(uTime*.12)*.014),uPinkBounds,uPinkRect);
  vec4 mistBlue=sprite(uv+uParallax*.10+vec2(cos(uTime*.17)*.015,sin(uTime*.09)*.014),uBlueBounds,uBlueRect);
  color+=mistPink.rgb*mistPink.a*.18*(.35+.65*transfer)*uQuality;
  color+=mistBlue.rgb*mistBlue.a*.17*(.4+.6*beat)*uQuality;

  // The phone flash is short and sharply localized. After the absorption the
  // concert falls into an instant of near silence (visual damping only).
  vec4 flashSprite=sprite(uv,uFlashBounds,uFlashRect);
  float localFlash=flashSprite.a*photo*.61;
  float cameraFlash=photo*.20;
  color+=vec3(0.99,0.68,1.0)*(localFlash+cameraFlash)*uNeon;
  color=mix(color,color*.44,hush*.56);

  // Fade out at the irregular aperture edge without affecting the existing GLB.
  float edge=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));
  float vignette=.55+.45*smoothstep(0.0,.10,edge);
  color*=vignette;
  // Keep color bounded to avoid HDR spill / fluorescent clipping.
  gl_FragColor=vec4(clamp(color,0.0,1.0),1.0);
}
`;

interface SpriteUV { u0: number; v0: number; u1: number; v1: number }
interface SpriteRecord { id: string; atlas: string; uv_bottom_origin: SpriteUV }
interface RectUV { x:number; y:number; w:number; h:number }
interface Placement { id:string; bounds_uv_bottom:RectUV; opacity:number; depth:number; motion:string }
interface RinaManifest {
  schema:string;
  atlas:{file:string;width:number;height:number};
  backdrop:{file:string;width:number;height:number};
  sprites: SpriteRecord[];
  placements: Placement[];
  effects:{cycle_seconds:number;katy_origin_uv:number[];rina_sink_uv:number[];photo_flash_uv:number[];beat_seconds:number};
}
export interface SanctuaryRinaPortalHandle {dispose():void;}
const finite = (v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const validAsset=(str:unknown)=>typeof str==="string"&&/^[a-z0-9_]+\.webp$/.test(str);
function getParam(name:string):string|null {
  if (typeof window==="undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}
function numberParam(name:string,defaultValue:number,min:number,max:number):number {
  const n=Number(getParam(name));
  return getParam(name)!==null&&Number.isFinite(n)?clamp(n,min,max):defaultValue;
}

function readVec2(v:unknown, fallback:[number,number]):Vector2 {
  if(!Array.isArray(v)||v.length!==2||!finite(v[0])||!finite(v[1])) return new Vector2(...fallback);
  return new Vector2(clamp(v[0],0,1),clamp(v[1],0,1));
}

function loadTexture(scene:Scene, filename:string):Promise<Texture>{
  if(!validAsset(filename)) return Promise.reject(new Error("Ruta de textura no permitida"));
  return new Promise((resolve,reject)=>{
    let texture:Texture|null=null;
    let loadedBeforeAssign=false;
    let errorBeforeAssign:string|null=null;
    const onLoad=()=> {if(texture) resolve(texture);else loadedBeforeAssign=true;};
    const onError=(message?:string)=>{
      const error=message??`No se pudo cargar ${filename}`;
      if(texture){texture.dispose();reject(new Error(error));}else errorBeforeAssign=error;
    };
    texture=new Texture(asset(ROOT+filename),scene,false,true,Texture.TRILINEAR_SAMPLINGMODE,onLoad,onError);
    texture.wrapU=Texture.CLAMP_ADDRESSMODE;
    texture.wrapV=Texture.CLAMP_ADDRESSMODE;
    if(errorBeforeAssign){texture.dispose();reject(new Error(errorBeforeAssign));return;}
    if(loadedBeforeAssign) resolve(texture);
  });
}
function checkedManifest(raw:unknown):RinaManifest {
  const m=raw as RinaManifest;
  if(!m||m.schema!==SCHEMA||!m.atlas||!m.backdrop||
     !validAsset(m.atlas.file)||!validAsset(m.backdrop.file)||
     !finite(m.backdrop.width)||!finite(m.backdrop.height)||
     m.backdrop.width<=0||m.backdrop.height<=0||
     !Array.isArray(m.sprites)||!Array.isArray(m.placements)||!m.effects)
    throw new Error("Manifiesto de Rina ausente o incompatible");
  if(!m.sprites.some(s=>s.id==="rina_katy_dissolving"))throw new Error("Falta Katy en el atlas");
  if(!m.placements.some(p=>p.id==="rina_katy_dissolving"))throw new Error("Falta la posición de Katy");
  return m;
}

/** Mount only for stop.id === 'rina'. Keep the red vortex until the panel is ready. */
export function createSanctuaryRinaPortal(
  scene:Scene, root:TransformNode, vortex:Mesh, fallbackMaterial:ShaderMaterial
):SanctuaryRinaPortalHandle {
  if(getParam("sanctuaryRinaPortal")==="off") return {dispose(){/* original red vortex */}};

  const abort=new AbortController();
  let disposed=false;
  let material:ShaderMaterial|null=null;
  let panel:Mesh|null=null;
  let active=false;
  const originalVisible=vortex.isVisible;
  const textures:Texture[]=[];
  const speed=numberParam("sanctuaryRinaSpeed",1.0,0,3);
  const neon=numberParam("sanctuaryRinaNeon",1.0,0,2.2);
  const parallaxGain=numberParam("sanctuaryRinaParallax",1.0,0,3);
  const quality=getParam("sanctuaryRinaQuality")==="low"?.35:1.0;
  const frozen=getParam("sanctuaryRinaFreeze")!==null
      ?numberParam("sanctuaryRinaFreeze",0,0,12):null;
  const localCamera=Vector3.Zero();
  const inverseWorld=root.computeWorldMatrix(true).clone().invert();
  const parallax=Vector2.Zero();
  let elapsed=0;
  let observer:ReturnType<typeof scene.onBeforeRenderObservable.add>|null=null;

  const update=()=>{
    if(!material||!panel||disposed) return;
    if(!active){
      if(!material.isReady(panel))return;
      panel.isVisible=true;
      vortex.isVisible=false;
      active=true;
    }
    elapsed+=Math.min(.09,scene.getEngine().getDeltaTime()/1000)*speed;
    const camera=scene.activeCamera;
    if(camera){
      Vector3.TransformCoordinatesToRef(camera.globalPosition,inverseWorld,localCamera);
      const distance=Math.max(.35,Math.abs(localCamera.z));
      const follow=localCamera.x/Math.max(.8,distance*1.7);
      const height=localCamera.y/Math.max(1.0,distance*3.0);
      parallax.set(clamp(follow*parallaxGain,-.075,.075),clamp(height*parallaxGain,-.025,.025));
      material.setVector2("uParallax",parallax);
    }
    material.setFloat("uTime",frozen??elapsed);
  };
  const dispose=()=>{
    if(disposed)return;
    disposed=true;
    abort.abort();
    if(observer)scene.onBeforeRenderObservable.remove(observer);
    if(panel&&!scene.isDisposed&&!vortex.isDisposed()){
      vortex.material=fallbackMaterial;
      vortex.isVisible=originalVisible;
    }
    panel?.dispose();
    material?.dispose();
    for(const t of textures)t.dispose();
    textures.length=0;
  };
  scene.onDisposeObservable.addOnce(dispose);

  async function initialize(){
    try{
      const res=await fetch(asset(ROOT+"rina_concert_manifest.json"),{signal:abort.signal});
      if(!res.ok)throw new Error(`JSON Rina HTTP ${res.status}`);
      const manifest=checkedManifest(await res.json());
      if(disposed||scene.isDisposed)return;
      // Load both images before replacing the red fallback. No half-loaded portal.
      for(const file of [manifest.backdrop.file,manifest.atlas.file]){
        const texture=await loadTexture(scene,file);
        if(disposed||scene.isDisposed){texture.dispose();return;}
        textures.push(texture);
      }
      const shader=new ShaderMaterial("sanctuaryRinaConcertPortal",scene,
        {vertexSource:VERTEX,fragmentSource:FRAGMENT},
        {attributes:["position","uv"],
         uniforms:["worldViewProjection","uTime","uParallax","uKatyRect","uKatyBounds",
          "uAuraRect","uAuraBounds","uLeftRect","uLeftBounds","uRightRect","uRightBounds",
          "uPinkRect","uPinkBounds","uBlueRect","uBlueBounds","uFlashRect","uFlashBounds",
          "uKatyOrigin","uRinaSink","uFlashOrigin","uCycleSeconds","uBeatSeconds","uNeon","uQuality"],
         samplers:["uBackdrop","uAtlas"],needAlphaBlending:false});
      shader.backFaceCulling=false;
      shader.fogEnabled=false;
      shader.setTexture("uBackdrop",textures[0]);
      shader.setTexture("uAtlas",textures[1]);
      const sprites=new Map(manifest.sprites.map(s=>[s.id,s]));
      const placements=new Map(manifest.placements.map(p=>[p.id,p]));
      const uniformMap=[
        ["rina_katy_dissolving","uKatyRect","uKatyBounds"],
        ["rina_stage_aura","uAuraRect","uAuraBounds"],
        ["rina_crowd_left","uLeftRect","uLeftBounds"],
        ["rina_crowd_right","uRightRect","uRightBounds"],
        ["rina_mist_fuchsia","uPinkRect","uPinkBounds"],
        ["rina_mist_cyan","uBlueRect","uBlueBounds"],
        ["rina_photo_flash","uFlashRect","uFlashBounds"],
      ] as const;
      for(const [id,texUniform,boundsUniform] of uniformMap){
        const uv=sprites.get(id)?.uv_bottom_origin;
        const p=placements.get(id)?.bounds_uv_bottom;
        if(!uv||!p||![uv.u0,uv.v0,uv.u1,uv.v1,p.x,p.y,p.w,p.h].every(finite)){
          shader.dispose(); throw new Error(`Falta rectángulo de ${id}`);
        }
        shader.setVector4(texUniform,new Vector4(uv.u0,uv.v0,uv.u1,uv.v1));
        shader.setVector4(boundsUniform,new Vector4(p.x,p.y,p.w,p.h));
      }
      shader.setVector2("uKatyOrigin",readVec2(manifest.effects.katy_origin_uv,[.365,.30]));
      shader.setVector2("uRinaSink",readVec2(manifest.effects.rina_sink_uv,[.52,.72]));
      shader.setVector2("uFlashOrigin",readVec2(manifest.effects.photo_flash_uv,[.45,.505]));
      shader.setFloat("uCycleSeconds",finite(manifest.effects.cycle_seconds)?clamp(manifest.effects.cycle_seconds,8,24):12);
      shader.setFloat("uBeatSeconds",finite(manifest.effects.beat_seconds)?clamp(manifest.effects.beat_seconds,.3,4):1.42);
      shader.setFloat("uNeon",neon);
      shader.setFloat("uQuality",quality);
      shader.setFloat("uTime",frozen??0);
      shader.setVector2("uParallax",Vector2.Zero());
      if(disposed||scene.isDisposed){shader.dispose();return;}

      const bounds=FOREST_PORTAL_PANEL;
      const width=bounds.right-bounds.left;
      const height=bounds.top-bounds.bottom;
      const visibleV=(manifest.backdrop.width/manifest.backdrop.height)/(width/height);
      if(visibleV<=0||visibleV>1){shader.dispose();throw new Error("La imagen de Rina no cabe en el plano del portal");}
      const concert=MeshBuilder.CreatePlane("rina_concertPanel",
        {width,height},scene);
      concert.parent=root;
      concert.position.set((bounds.left+bounds.right)*.5,
        (bounds.bottom+bounds.top)*.5,-.01);
      const originalUV=concert.getVerticesData(VertexBuffer.UVKind);
      if(!originalUV){concert.dispose();shader.dispose();throw new Error("El plano de Rina no tiene UVs");}
      const coveredUV=new Float32Array(originalUV.length);
      for(let i=0;i<originalUV.length;i+=2){
        coveredUV[i]=originalUV[i];
        coveredUV[i+1]=1-visibleV+originalUV[i+1]*visibleV;
      }
      concert.setVerticesData(VertexBuffer.UVKind,coveredUV);
      concert.material=shader;
      concert.isPickable=false;
      concert.checkCollisions=false;
      concert.receiveShadows=false;
      concert.renderingGroupId=vortex.renderingGroupId;
      concert.isVisible=false;
      material=shader;
      panel=concert;
      observer=scene.onBeforeRenderObservable.add(update);
    }catch(error){
      if(!disposed&&!abort.signal.aborted){
        // Restore immediately if any initialization failed, even if partially done.
        if(panel){panel.dispose();panel=null;}
        material?.dispose();material=null;
        for(const tex of textures)tex.dispose();textures.length=0;
        console.warn("[RinaPortal] Se conserva el vórtice original:",error);
      }
    }
  }
  void initialize();
  return {dispose};
}
