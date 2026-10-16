/**
 * Lo real y lo otro — Forest portal v4 (Libre de culpas).
 *
 * Adapts the *working main portal* hybrid pattern:
 *   immutable procedural/background surface + separately positioned RGBA atlas
 *   sprites with stable IDs, opacity, animated mist and camera-local parallax.
 *
 * Existing Portal_generico_1.glb, SanctuaryLevelPortals.ts, other four portals,
 * main sanctuary gate, golems, interaction and level transitions are untouched.
 * Replacement is compatible with the existing createSanctuaryForestPortal(...) call.
 *
 * The scenic backdrop is an UNDISTORTED portrait crop from ONE consistent
 * user-approved frame (moon / path / cabin). Small masked foreground objects
 * supplement it; overlapping, unrelated 16:9 images are not laminated together.
 *
 * ?sanctuaryForestPortal=off        -> original crimson vortex
 * ?sanctuaryForestGreen=0..1.5   -> spectral green grading, default 0.65
 * ?sanctuaryForestParallax=0..3  -> camera-responsive near foliage, default 1.2
 * ?sanctuaryForestMist=0..1.5     -> fog animation, default 0.6
 * ?sanctuaryForestQuality=low     -> reduce draw calls/fragment cost
 */
import {
  Constants, Effect, Mesh, MeshBuilder, Scene, ShaderMaterial, Texture,
  TransformNode, Vector3, VertexBuffer,
} from "@babylonjs/core";
import type { Material } from "@babylonjs/core/Materials/material";
import { asset } from "../../../utils/asset";

const ROOT = "assets/textures/sanctuary/forest_portal/v4/";
const MANIFEST = "lrlo.sanctuary.forest_portal.atlas.v4";
const COMPOSITION = "lrlo.sanctuary.forest_portal.composition.v4";
// Preserve the fitted v3 panel exactly. Only the image and foreground layers
// change in v4; the stone arch still hides these straight panel edges.
const PANEL_LEFT = -.22;
const PANEL_RIGHT = .27;
const PANEL_BOTTOM = -.02;
const PANEL_TOP = .82;
const PANEL_Z = -.01;
const Y_MIN = 0.012;
const Y_MAX = 0.777;
const MID_Y = (Y_MIN + Y_MAX) * 0.5;
const PORTAL_HEIGHT = Y_MAX - Y_MIN;
const PORTAL_WIDTH = 0.38;

interface UvRect { u0: number; v0: number; u1: number; v1: number }
interface AtlasSprite {
  id: string;
  category: "tree" | "foliage" | "mist";
  atlas: string;
  width: number;
  height: number;
  uv_bottom_origin: UvRect;
}
interface ForestManifest {
  schema: string;
  portal_id: string;
  base: { file: string; width: number; height: number };
  atlases: { file: string; width: number; height: number }[];
  sprites: AtlasSprite[];
}
interface Placement {
  id: string;
  x: number;
  y: number;
  height_fraction: number;
  depth: number;
  opacity: number;
  motion: "still" | "sway" | "mist";
  phase: number;
}
interface ForestComposition {
  schema: string;
  portal_id: string;
  placements: Placement[];
}
interface Instance { mesh: Mesh; x: number; y: number; height: number; depth: number; motion: Placement["motion"]; phase: number }

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const safeTextureFilename = (s: unknown): s is string =>
  typeof s === "string" && /^[a-z0-9_-]+\.webp$/.test(s);
function param(params: URLSearchParams | null, name: string, otherwise: number, top: number) {
  const raw = params?.get(name);
  if (raw == null || !raw.trim()) return otherwise;
  const value = Number(raw);
  return Number.isFinite(value) ? clamp(value, 0, top) : otherwise;
}

// Atlas sprites may extend beyond the panel for parallax, but their visible
// pixels must stay within the same rectangle used by the backdrop.
const CLIP = `
float panelCoverage(vec2 p) {
  float edge=min(min(p.x+.22,.27-p.x),min(p.y+.02,.82-p.y));
  return smoothstep(-.001,.003,edge);
}
`;
const NOISE = `
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
float fbm21(vec2 p){float a=.5,s=0.;for(int i=0;i<3;i++){s+=a*n21(p);p=p*2.03+vec2(6.1,17.3);a*=.5;}return s;}
`;
Effect.ShadersStore["lrloForestMainStyleVistaVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform mat4 uRootInverse;
varying vec2 vUV;
varying vec2 vRootXY;
void main(){vUV=uv;vRootXY=(uRootInverse*world*vec4(position,1.)).xy;
gl_Position=worldViewProjection*vec4(position,1.);}
`;
Effect.ShadersStore["lrloForestMainStyleSpriteVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform mat4 uRootInverse;
varying vec2 vUV;
varying vec2 vRootXY;
varying vec4 vSpriteProps;
void main(){vUV=uv;vRootXY=(uRootInverse*world*vec4(position,1.)).xy;
vSpriteProps=color;gl_Position=worldViewProjection*vec4(position,1.);}
`;

Effect.ShadersStore["lrloForestMainStyleBackdropFragmentShader"] = `
precision highp float;
varying vec2 vUV;
varying vec2 vRootXY;
uniform sampler2D uVista;
uniform float uTime;
uniform float uGreen;
uniform float uMist;
${CLIP}
${NOISE}
void main(){
  // One camera, one photo. The quad UVs crop the image to its original aspect.
  vec3 still=texture2D(uVista,vUV).rgb;
  // Only dark treetops move. The moon, cabin and path stay fixed in the scene.
  float rightTrees=smoothstep(.53,.70,vUV.y)*smoothstep(.29,.44,vUV.x);
  float leftBranches=smoothstep(.78,.90,vUV.y)*(1.-smoothstep(.10,.20,vUV.x));
  float silhouette=1.-smoothstep(.045,.16,dot(still,vec3(.2126,.7152,.0722)));
  float windMask=max(rightTrees,leftBranches)*silhouette;
  float wind=.0035*sin(uTime*.83+vUV.y*12.+vUV.x*5.)
    +.0012*sin(uTime*1.47+vUV.y*19.);
  vec3 col=texture2D(uVista,vec2(clamp(vUV.x+wind*windMask,0.,1.),vUV.y)).rgb;
  float warm=smoothstep(.03,.25,col.r-max(col.g,col.b)*.98)*smoothstep(.08,.24,col.r);
  float shadow=clamp(1.-dot(col,vec3(.2126,.7152,.0722)),0.,1.);
  float grade=clamp(uGreen*.42*(1.-warm*.9),0.,.65);
  col=mix(col,col*vec3(.79,1.19,.89)+vec3(.002,.025,.010)*shadow,grade);
  // Low-frequency volumetric-looking mist that breathes but never repeats image edges.
  float clouds=fbm21(vec2(vUV.x*2.8+uTime*.012,vUV.y*4.2-uTime*.008));
  float band=exp(-pow((vUV.y-(.42+.027*sin(uTime*.10)))/.22,2.));
  float fog=clamp(uMist*band*(.016+.055*clouds),0.,.07);
  col=mix(col,vec3(.028,.15,.112),fog*(1.-warm*.7));
  // The existing warm window gains a small, irregular candle-like flicker.
  vec2 windowDistance=(vUV-vec2(.627,.493))/vec2(.044,.058);
  float windowCore=exp(-2.2*dot(windowDistance,windowDistance));
  float windowHalo=exp(-.65*dot(windowDistance,windowDistance));
  float windowWarm=smoothstep(.045,.16,col.r-max(col.g,col.b)*.8);
  float flicker=clamp(.60+.22*sin(uTime*2.1)+.12*sin(uTime*4.7+1.3)
    +.06*sin(uTime*9.2+2.4),.18,1.);
  col+=(vec3(.38,.15,.025)*windowCore+vec3(.055,.022,.003)*windowHalo)
    *windowWarm*flicker;
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}
`;

Effect.ShadersStore["lrloForestMainStyleAtlasFragmentShader"] = `
precision highp float;
varying vec2 vUV;
varying vec2 vRootXY;
varying vec4 vSpriteProps;
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uGreen;
${CLIP}
void main(){
  float clipping=panelCoverage(vRootXY);
  if(clipping<.003)discard;
  vec4 tex=texture2D(uAtlas,vUV);
  if(tex.a<.008)discard;
  // Like the main portal: R=mist, G=depth, B=phase, A=opacity.
  float mistFlag=vSpriteProps.r;
  float pulse=.92+.08*sin(uTime*.24+vSpriteProps.b*6.283);
  tex.a*=vSpriteProps.a*clipping*mix(1.,pulse,mistFlag);
  vec3 col=tex.rgb;
  float warmth=smoothstep(.035,.20,col.r-max(col.g,col.b)*.98);
  float green=clamp(uGreen*(.10+.08*mistFlag)*(1.-.7*warmth),0.,.32);
  col=mix(col,vec3(col.r*.68+.01,col.g*1.2+.035,col.b*.83+.013),green);
  gl_FragColor=vec4(col,clamp(tex.a,0.,1.));
}
`;

async function loadJson<T>(filename: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(asset(ROOT+filename), { signal });
  if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
  return await response.json() as T;
}
function loadTexture(scene: Scene, filename: string): Promise<Texture> {
  return new Promise((resolve,reject)=>{
    let tex: Texture | null = null;
    let complete = false;
    const onLoad = () => { complete=true; if(tex)resolve(tex); };
    const onError = (message?: string, ex?: any) => {
      if(complete)return;
      complete=true;
      if(tex)tex.dispose();
      reject(new Error(`${filename}: ${message??String(ex??"Texture load error")}`));
    };
    tex=new Texture(asset(ROOT+filename),scene,false,true,Texture.TRILINEAR_SAMPLINGMODE,onLoad,onError);
    tex.hasAlpha=true;
    tex.wrapU=Texture.CLAMP_ADDRESSMODE;
    tex.wrapV=Texture.CLAMP_ADDRESSMODE;
  });
}

/** Visual-only. Compatible with the existing stop.id==='libre-de-culpas' caller. */
export function createSanctuaryForestPortal(
  scene: Scene,
  root: TransformNode,
  vortex: Mesh,
  oldVortexMaterial: Material,
): { dispose(): void } {
  const query = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  if(query?.get("sanctuaryForestPortal")==="off")return { dispose:()=>undefined };
  const green=param(query,"sanctuaryForestGreen",.65,1.5);
  const mist=param(query,"sanctuaryForestMist",.60,1.5);
  const parallax=param(query,"sanctuaryForestParallax",1.2,3);
  const lowQuality=query?.get("sanctuaryForestQuality")==="low";
  const debug=query?.get("sanctuaryForestDebug")==="1";
  const originMaterial=vortex.material??oldVortexMaterial;
  const originalVisible=vortex.isVisible;
  const originalEnabled=vortex.isEnabled();
  const abort=new AbortController();
  const meshes: Mesh[]=[];
  const instances: Instance[]=[];
  const materials: ShaderMaterial[]=[];
  const textures: Texture[]=[];
  const inverseRoot=root.computeWorldMatrix(true).clone().invert();
  const cameraLocal=Vector3.Zero();
  let active=false, disposed=false, seconds=0;

  const observer=scene.onBeforeRenderObservable.add(()=>{
    if(!active||disposed)return;
    seconds+=Math.min(.08,scene.getEngine().getDeltaTime()/1000);
    const camera=scene.activeCamera;
    if(camera)Vector3.TransformCoordinatesToRef(camera.globalPosition,inverseRoot,cameraLocal);
    // Camera-relative PARALLAX: move actual independent meshes, NOT atlas UVs.
    // Near layers cover around 6-10% of the opening across a short lateral walk.
    const mx=camera?clamp(cameraLocal.x/.22,-1,1)*parallax:0;
    const my=camera?clamp((cameraLocal.y-.10)/.20,-1,1)*parallax:0;
    for(const item of instances){
      const weight=item.depth*item.depth;
      // Rotate each tree around its foot so the trunk stays rooted while the
      // crown follows two gentle wind frequencies.
      const windAngle=item.motion==="sway"
        ? Math.sin(seconds*.83+item.phase)*.012
          +Math.sin(seconds*1.47+item.phase*1.7)*.004
        : 0;
      item.mesh.rotation.z=windAngle;
      const rootedOffset=-Math.sin(windAngle)*item.height*.5;
      const drifting=item.motion==="mist" ? Math.sin(seconds*.16+item.phase)*.0022 : 0;
      item.mesh.position.x=item.x-mx*.027*weight+rootedOffset+drifting;
      item.mesh.position.y=item.y-my*.009*weight
        +(item.motion==="mist"?Math.cos(seconds*.12+item.phase)*.002:0);
    }
    for(const material of materials)material.setFloat("uTime",seconds);
  });

  function dispose(){
    if(disposed)return;
    disposed=true;
    active=false;
    abort.abort();
    scene.onBeforeRenderObservable.remove(observer);
    if(!scene.isDisposed && vortex.material===originMaterial && originalEnabled){
      vortex.isVisible=originalVisible;
    }
    for(const mesh of meshes)mesh.dispose();
    for(const material of materials)material.dispose();
    for(const texture of textures)texture.dispose();
    meshes.length=materials.length=textures.length=instances.length=0;
  }
  scene.onDisposeObservable.addOnce(dispose);

  void (async()=>{
    try{
      const [manifest,composition]=await Promise.all([
        loadJson<ForestManifest>("forest_manifest.json",abort.signal),
        loadJson<ForestComposition>("forest_composition.json",abort.signal),
      ]);
      if(disposed||scene.isDisposed)return;
      if(manifest.schema!==MANIFEST||composition.schema!==COMPOSITION||
         manifest.portal_id!=="libre-de-culpas"||composition.portal_id!=="libre-de-culpas"||
         !Array.isArray(manifest.atlases)||!Array.isArray(manifest.sprites)||
         !Array.isArray(composition.placements)||!safeTextureFilename(manifest.base.file)) {
        throw new Error("Forest v4 manifest/composition schema mismatch");
      }
      const spriteById=new Map(manifest.sprites.map(sprite=>[sprite.id,sprite]));
      const placements=composition.placements.filter(p=>
        typeof p.id==="string" && spriteById.has(p.id) &&
        [p.x,p.y,p.height_fraction,p.depth,p.opacity,p.phase].every(isFiniteNumber) &&
        p.height_fraction>0 && p.height_fraction<=2.0 &&
        p.opacity>0 && p.opacity<=1 && p.depth>=0 && p.depth<=1 &&
        (!lowQuality||p.motion!=="mist"||p.depth<.3)
      );
      const atlases=[...new Set(placements.map(p=>spriteById.get(p.id)!.atlas))];
      const accepted=new Set(manifest.atlases.map(a=>a.file));
      if(!atlases.every(a=>safeTextureFilename(a)&&accepted.has(a)))throw new Error("Invalid forest atlas filename");
      // Keep red fallback VISIBLE during async loading; commit only when ready.
      const vista=await loadTexture(scene,manifest.base.file);
      if(disposed||scene.isDisposed){vista.dispose();return;}
      textures.push(vista);
      const atlasByName=new Map<string,Texture>();
      for(const filename of atlases){
        const texture=await loadTexture(scene,filename);
        if(disposed||scene.isDisposed){texture.dispose();return;}
        atlasByName.set(filename,texture);
        textures.push(texture);
      }

      const bg=new ShaderMaterial("lrloForestVistaV4",scene,
        {vertex:"lrloForestMainStyleVista",fragment:"lrloForestMainStyleBackdrop"},
        {attributes:["position","uv"],
         uniforms:["world","worldViewProjection","uRootInverse","uTime","uGreen","uMist"],
         samplers:["uVista"]});
      bg.fogEnabled=false;
      bg.backFaceCulling=false;
      bg.setMatrix("uRootInverse",inverseRoot);
      bg.setTexture("uVista",vista);
      bg.setFloat("uTime",0);
      bg.setFloat("uGreen",green);
      bg.setFloat("uMist",mist);
      materials.push(bg);
      const atlasMaterials=new Map<string,ShaderMaterial>();
      for(const filename of atlases){
        const mat=new ShaderMaterial(`lrloForestAtlasV4_${filename}`,scene,
          {vertex:"lrloForestMainStyleSprite",fragment:"lrloForestMainStyleAtlas"},
          {attributes:["position","uv","color"],
           uniforms:["world","worldViewProjection","uRootInverse","uTime","uGreen"],
           samplers:["uAtlas"],needAlphaBlending:true});
        mat.setTexture("uAtlas",atlasByName.get(filename)!);
        mat.setMatrix("uRootInverse",inverseRoot);
        mat.setFloat("uTime",0);
        mat.setFloat("uGreen",green);
        mat.backFaceCulling=false;
        mat.alphaMode=Constants.ALPHA_COMBINE;
        mat.disableDepthWrite=true;
        mat.fogEnabled=false;
        materials.push(mat);
        atlasMaterials.set(filename,mat);
      }

      const background=MeshBuilder.CreatePlane("libre-de-culpas_forestVistaV4",
        {width:PANEL_RIGHT-PANEL_LEFT,height:PANEL_TOP-PANEL_BOTTOM},scene);
      background.parent=root;
      background.position.set((PANEL_LEFT+PANEL_RIGHT)*.5,(PANEL_BOTTOM+PANEL_TOP)*.5,PANEL_Z);
      // The source is 768x1673. Cover the established .49x.84 panel by
      // cropping its lower edge; this keeps the moon and cabin undistorted.
      const backgroundUV=background.getVerticesData(VertexBuffer.UVKind);
      if(!backgroundUV)throw new Error("Forest v4 backdrop has no UVs");
      const visibleV=(manifest.base.width/manifest.base.height)/
        ((PANEL_RIGHT-PANEL_LEFT)/(PANEL_TOP-PANEL_BOTTOM));
      const cropBottom=.99-visibleV;
      const coveredUV=new Float32Array(backgroundUV.length);
      for(let i=0;i<backgroundUV.length;i+=2){
        coveredUV[i]=backgroundUV[i];
        coveredUV[i+1]=cropBottom+backgroundUV[i+1]*visibleV;
      }
      background.setVerticesData(VertexBuffer.UVKind,coveredUV);
      background.material=bg;
      background.isPickable=false;
      background.checkCollisions=false;
      background.receiveShadows=false;
      background.renderingGroupId=vortex.renderingGroupId;
      meshes.push(background);

      for(const p of placements){
        const def=spriteById.get(p.id)!;
        if(def.width<=0||def.height<=0||!
          [def.uv_bottom_origin.u0,def.uv_bottom_origin.u1,
           def.uv_bottom_origin.v0,def.uv_bottom_origin.v1].every(isFiniteNumber))continue;
        const height=PORTAL_HEIGHT*p.height_fraction;
        const width=height*def.width/def.height; // NO ASPECT RATIO STRETCHING.
        const plane=MeshBuilder.CreatePlane(`libre-de-culpas_forestAsset_${p.id}`,
          {width,height},scene);
        plane.parent=root;
        const cx=p.x*PORTAL_WIDTH;
        const cy=MID_Y+p.y*PORTAL_HEIGHT;
        plane.position.set(cx,cy,PANEL_Z+.001+p.depth*.018);
        plane.isPickable=false;
        plane.checkCollisions=false;
        plane.receiveShadows=false;
        plane.renderingGroupId=vortex.renderingGroupId;
        plane.alphaIndex=Math.floor(p.depth*1000);
        const orig=plane.getVerticesData(VertexBuffer.UVKind);
        if(!orig){plane.dispose();continue;}
        const u=def.uv_bottom_origin;
        const texUV=new Float32Array(orig.length);
        for(let i=0;i<orig.length;i+=2){
          texUV[i]=u.u0+orig[i]*(u.u1-u.u0);
          texUV[i+1]=u.v0+orig[i+1]*(u.v1-u.v0);
        }
        plane.setVerticesData(VertexBuffer.UVKind,texUV);
        const vertexCount=plane.getVerticesData(VertexBuffer.PositionKind)!.length/3;
        const vertColor=new Float32Array(vertexCount*4);
        for(let i=0;i<vertexCount;i++){
          vertColor[i*4]=def.category==="mist"?1:0;
          vertColor[i*4+1]=p.depth;
          vertColor[i*4+2]=((p.phase%6.283)+6.283)%6.283/6.283;
          vertColor[i*4+3]=p.opacity;
        }
        plane.setVerticesData(VertexBuffer.ColorKind,vertColor);
        plane.material=atlasMaterials.get(def.atlas)!;
        meshes.push(plane);
        instances.push({mesh:plane,x:cx,y:cy,height,depth:p.depth,motion:p.motion,phase:p.phase});
      }
      if(disposed||scene.isDisposed)return;
      // Atomic swap: hide only the old RED mesh, never the stone arch or other portals.
      vortex.isVisible=false;
      active=true;
      if(debug)console.info("Forest Portal V4 active:",{sprites:instances.length,atlases:atlases.length,
        green,mist,parallax,sceneRoot:root.name,originalVortex:vortex.name});
    }catch(error){
      if(!disposed&&!abort.signal.aborted){
        console.warn("Forest portal v4 unavailable; original crimson vortex retained:",error);
        dispose();
      }
    }
  })();
  return {dispose};
}
