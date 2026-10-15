/**
 * Lo real y lo otro — LIBRE DE CULPAS / forest destination portal.
 *
 * Extends only the existing portal's VORTEX surface with a new backdrop and
 * independent atlas-sprite planes. The masonry arch (Portal_generico_1.glb),
 * geometry, collision, interaction and four other destination portals remain
 * untouched. Fallback is the existing crimson material until assets are ready.
 *
 * Tested against SanctuaryLevelPortals.ts on feature/sanctuary-v02-atmosphere
 * (2026-10-15). No code from the other destination portals is duplicated.
 *
 * ?sanctuaryForestPortal=off     Show original red vortex instead.
 * ?sanctuaryForestQuality=low   Reduce sprite count for constrained devices.
 */
import {
  Constants, Effect, Mesh, MeshBuilder, Scene, ShaderMaterial, Texture,
  TransformNode, Vector2, Vector3, VertexBuffer,
} from "@babylonjs/core";
import type { Material } from "@babylonjs/core/Materials/material";
import { asset } from "../../../utils/asset";

const ROOT = "assets/textures/sanctuary/forest_portal/";
const MANIFEST_SCHEMA = "lrlo.sanctuary.forest_portal.atlas.v1";
const COMPOSITION_SCHEMA = "lrlo.sanctuary.forest_portal.composition.v1";

// The mesh in SanctuaryLevelPortals.ts has these six aperture rows.
// Duplicated as clipping data, NOT as new physical geometry.
// Coordinates are in the local space of the existing GLB's root.
const ROWS = [
  { y: 0.012, left: -0.105, right: 0.125 },
  { y: 0.180, left: -0.110, right: 0.130 },
  { y: 0.350, left: -0.135, right: 0.150 },
  { y: 0.520, left: -0.150, right: 0.170 },
  { y: 0.680, left: -0.165, right: 0.180 },
  { y: 0.777, left: -0.180, right: 0.180 },
] as const;
const MIN_Y = ROWS[0].y;
const MAX_Y = ROWS[ROWS.length - 1].y;
const MID_Y = (MIN_Y + MAX_Y) / 2;
const HEIGHT = MAX_Y - MIN_Y;
const WIDTH = 0.35;

interface Rect { x: number; y: number; width: number; height: number }
interface UVRect { u0: number; v0: number; u1: number; v1: number }
interface ForestSprite {
  id: string;
  category: string;
  atlas: string;
  rect_px: Rect;
  uv_bottom_origin: UVRect;
  size_original: { width: number; height: number };
}
interface ForestManifest {
  schema: string;
  portal_id: string;
  atlases: { file: string; width: number; height: number }[];
  sprites: ForestSprite[];
}
interface Placement {
  id: string; x: number; y: number; height_fraction: number;
  depth: number; opacity: number;
  motion: "still" | "sway" | "mist" | "wisp";
  phase: number;
}
interface Composition { schema: string; portal_id: string; background_file: string; placements: Placement[] }
interface SpriteInstance { mesh: Mesh; x: number; y: number; depth: number; phase: number; motion: Placement["motion"] }

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const validAtlas = (name: string): boolean => /^forest_atlas_\d\d\.webp$/.test(name);

Effect.ShadersStore["lrloForestPortalBackVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position,1.0);
}
`;

Effect.ShadersStore["lrloForestPortalBackFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uBackdrop;
uniform float uTime;
uniform vec2 uLook;
float hash(vec2 p) {return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
             mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
}
void main() {
  vec2 uv = clamp(vUV + uLook*vec2(0.028,0.010), vec2(.003),vec2(.997));
  vec3 c=texture2D(uBackdrop,uv).rgb;
  // Slow breathing mist, not a bright, cartoon-style vortex.
  float fog=n2(vec2(uv.x*4.0+uTime*.016,uv.y*7.0-uTime*.024));
  float band=exp(-pow((uv.y-(.29+.03*sin(uTime*.1)))/.15,2.0));
  c=mix(c,vec3(.12,.17,.18),(.055+.055*fog)*band);
  // A weak pale glimmer on the path: remains an environment, not a teleport effect.
  float slit=exp(-pow((uv.x-.5)/.15,2.0)) * exp(-pow((uv.y-.46)/.30,2.0));
  c+=vec3(.027,.055,.063)*slit*(.9+.1*sin(uTime*.37));
  float edge=min(uv.x,1.0-uv.x);
  c *= .66+.34*smoothstep(.0,.19,edge);
  c = pow(c,vec3(.88));
  gl_FragColor=vec4(c,1.0);
}
`;

Effect.ShadersStore["lrloForestPortalSpriteVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform mat4 uRootInverse;
varying vec2 vAtlasUV;
varying vec2 vRootXY;
varying vec4 vParams;
void main() {
  vAtlasUV=uv;
  vRootXY=(uRootInverse*world*vec4(position,1.0)).xy;
  vParams=color;
  gl_Position=worldViewProjection*vec4(position,1.0);
}
`;

// APERTURE clipping is computed in the root's local coordinates. Even when
// parallax moves the sprite, fragments outside the physical opening disappear.
Effect.ShadersStore["lrloForestPortalSpriteFragmentShader"] = `
precision highp float;
varying vec2 vAtlasUV;
varying vec2 vRootXY;
varying vec4 vParams;
uniform sampler2D uAtlas;
uniform float uTime;
vec2 openingAt(float y) {
  if(y<.180) {float t=clamp((y-.012)/(.180-.012),0.,1.);return mix(vec2(-.105,.125),vec2(-.110,.130),t);}
  if(y<.350) {float t=clamp((y-.180)/(.350-.180),0.,1.);return mix(vec2(-.110,.130),vec2(-.135,.150),t);}
  if(y<.520) {float t=clamp((y-.350)/(.520-.350),0.,1.);return mix(vec2(-.135,.150),vec2(-.150,.170),t);}
  if(y<.680) {float t=clamp((y-.520)/(.680-.520),0.,1.);return mix(vec2(-.150,.170),vec2(-.165,.180),t);}
  float t=clamp((y-.680)/(.777-.680),0.,1.);return mix(vec2(-.165,.180),vec2(-.180,.180),t);
}
void main() {
  if(vRootXY.y < .012 || vRootXY.y > .777) discard;
  vec2 b=openingAt(vRootXY.y);
  float border=min(vRootXY.x-b.x,b.y-vRootXY.x);
  if(border<.0) discard;
  vec4 texel=texture2D(uAtlas,vAtlasUV);
  if(texel.a<.015) discard;
  // r=mist flag, g=depth, b=phase (normalized), a=placement opacity.
  float breath=.92+.08*sin(uTime*.26+vParams.b*6.283);
  float mistFactor=vParams.r;
  float soft = smoothstep(.0,.009,border);
  texel.a *= vParams.a * soft * mix(1.0,breath,mistFactor);
  // Small distance desaturation prevents the portal becoming oversaturated green.
  vec3 c=mix(texel.rgb,vec3(.080,.116,.119),(.18*(1.-vParams.g))+.08*mistFactor);
  c=pow(c,vec3(.92));
  gl_FragColor=vec4(c,clamp(texel.a,0.,1.));
}
`;

async function getJSON<T>(filename: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(asset(ROOT + filename), { signal });
  if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
  return await response.json() as T;
}

function atlasTexture(scene: Scene, name: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    let tex: Texture | null = null;
    let failed = false;
    const onLoad = () => { if (tex) resolve(tex); };
    const onError = (message?: string, error?: any) => {
      failed = true;
      if (tex) tex.dispose();
      reject(new Error(`Forest atlas ${name}: ${message ?? String(error ?? "unknown error")}`));
    };
    tex = new Texture(asset(ROOT + name), scene, false, true,
      Texture.TRILINEAR_SAMPLINGMODE, onLoad, onError);
    tex.hasAlpha = true;
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    if (failed) tex.dispose();
  });
}

/** Overlay function. Does not change any other portal or the forest level itself. */
export function createSanctuaryForestPortal(
  scene: Scene,
  root: TransformNode,
  vortex: Mesh,
  oldVortexMaterial: Material,
) {
  const url = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const disabled = url?.get("sanctuaryForestPortal") === "off";
  if (disabled) return { dispose: () => undefined };
  const lowQuality = url?.get("sanctuaryForestQuality") === "low";
  const aborter = new AbortController();
  let isDisposed = false;
  const inverseRoot = root.computeWorldMatrix(true).clone().invert();
  const cameraInRoot = Vector3.Zero();
  const drift = Vector2.Zero();
  const textures: Texture[] = [];
  const materials: ShaderMaterial[] = [];
  const instances: SpriteInstance[] = [];
  let backMaterial: ShaderMaterial | null = null;
  let seconds = 0;

  const onFrame = scene.onBeforeRenderObservable.add(() => {
    if (isDisposed || !backMaterial) return;
    seconds += Math.min(scene.getEngine().getDeltaTime()/1000,0.10);
    const cam = scene.activeCamera;
    if (cam) Vector3.TransformCoordinatesToRef(cam.globalPosition,inverseRoot,cameraInRoot);
    const lookX=cam ? clamp(cameraInRoot.x*.10,-1,1) : 0;
    const lookY=cam ? clamp((cameraInRoot.y - MID_Y)*.10,-1,1) : 0;
    drift.set(lookX,lookY);
    backMaterial.setFloat("uTime",seconds);
    backMaterial.setVector2("uLook",drift);
    for (const instance of instances) {
      const depth=instance.depth;
      let moving=instance.motion==="mist" ? 1.0 : instance.motion==="wisp" ? .85 : instance.motion==="sway" ? .23 : 0;
      instance.mesh.position.x=instance.x - lookX*.012*depth*depth +
        Math.sin(seconds*.19 + instance.phase) *.0034*moving;
      instance.mesh.position.y=instance.y - lookY*.003*depth +
        Math.cos(seconds*.11 + instance.phase*1.2) *.003*moving;
    }
    for(const mat of materials) mat.setFloat("uTime",seconds);
  });

  function dispose() {
    if (isDisposed) return;
    isDisposed=true;
    aborter.abort();
    scene.onBeforeRenderObservable.remove(onFrame);
    // Do not replace the default material with a disposed one during scene teardown.
    if (!scene.isDisposed && vortex.material === backMaterial) vortex.material=oldVortexMaterial;
    for(const instance of instances) instance.mesh.dispose();
    for(const mat of materials) mat.dispose();
    for(const tex of textures) tex.dispose();
  }
  scene.onDisposeObservable.addOnce(dispose);

  void (async()=>{
    try {
      const [manifest, comp] = await Promise.all([
        getJSON<ForestManifest>("forest_portal_manifest.json",aborter.signal),
        getJSON<Composition>("forest_portal_composition.json",aborter.signal),
      ]);
      if(isDisposed||scene.isDisposed)return;
      if(manifest.schema!==MANIFEST_SCHEMA || comp.schema!==COMPOSITION_SCHEMA ||
          manifest.portal_id!=="libre-de-culpas" || comp.portal_id!=="libre-de-culpas" ||
          !Array.isArray(manifest.sprites) || !Array.isArray(manifest.atlases) ||
          !Array.isArray(comp.placements) || comp.background_file!=="forest_backdrop.webp")
        throw new Error("Forest portal JSON does not match the expected schema");
      const byId=new Map(manifest.sprites.map(s=>[s.id,s]));
      const chosen=comp.placements.filter((p,i)=>
        (!lowQuality || i<14 || p.motion==="mist") &&
        byId.has(p.id) && finite(p.x) && finite(p.y) && finite(p.depth) &&
        finite(p.opacity) && finite(p.height_fraction) && finite(p.phase) &&
        ["still","sway","mist","wisp"].includes(p.motion) &&
        Math.abs(p.x)<1.5 && Math.abs(p.y)<1.5 &&
        p.opacity>=0 && p.opacity<=1 && p.height_fraction>0 && p.height_fraction<2);
      if(chosen.length===0) throw new Error("Forest portal composition is empty");
      const needed=["forest_backdrop.webp", ...new Set(chosen.map(p=>byId.get(p.id)!.atlas))];
      if(needed.some(n=>n!=="forest_backdrop.webp" &&
          (!validAtlas(n) || !manifest.atlases.some(a=>a.file===n))))
        throw new Error("Unrecognized atlas reference");
      const atlasMap=new Map<string,Texture>();
      for(const name of needed){
        const tx=await atlasTexture(scene,name);
        if(isDisposed||scene.isDisposed){tx.dispose();return;}
        textures.push(tx);atlasMap.set(name,tx);
      }
      const bg=new ShaderMaterial("sanctuaryForestPortalBackdrop",scene,
        {vertex:"lrloForestPortalBack",fragment:"lrloForestPortalBack"},
        {attributes:["position","uv"],uniforms:["worldViewProjection","uTime","uLook"],samplers:["uBackdrop"]});
      bg.backFaceCulling=false;
      bg.fogEnabled=false;
      bg.setTexture("uBackdrop",atlasMap.get("forest_backdrop.webp")!);
      bg.setFloat("uTime",0);bg.setVector2("uLook",new Vector2(0,0));
      materials.push(bg);
      const materialsByAtlas=new Map<string,ShaderMaterial>();
      for(const name of needed.slice(1)) {
        const mat=new ShaderMaterial(`sanctuaryForestPortalSprites_${name}`,scene,
          {vertex:"lrloForestPortalSprite",fragment:"lrloForestPortalSprite"},
          {attributes:["position","uv","color"],
            uniforms:["world","worldViewProjection","uRootInverse","uTime"],
            samplers:["uAtlas"],needAlphaBlending:true});
        mat.backFaceCulling=false;
        mat.fogEnabled=false;
        mat.alphaMode=Constants.ALPHA_COMBINE;
        mat.disableDepthWrite=true;
        mat.setTexture("uAtlas",atlasMap.get(name)!);
        mat.setMatrix("uRootInverse",inverseRoot);
        mat.setFloat("uTime",0);
        materials.push(mat);
        materialsByAtlas.set(name,mat);
      }
      for(let i=0;i<chosen.length;i++){
        const p=chosen[i],sprite=byId.get(p.id)!;
        const dims=sprite.size_original;
        const v=sprite.uv_bottom_origin;
        if(!finite(dims.width)||!finite(dims.height)||dims.width<=0||dims.height<=0||
          ![v.u0,v.u1,v.v0,v.v1].every(t=>finite(t)&&t>=0&&t<=1))continue;
        const h=clamp(p.height_fraction,.015,1.25)*HEIGHT;
        const w=h*(dims.width/dims.height);
        if(!Number.isFinite(w)||w<=0||w>3)continue;
        const quad=MeshBuilder.CreatePlane(`forestPortal_${p.id}_${i}`,
          {width:w,height:h,sideOrientation:Mesh.FRONTSIDE},scene);
        quad.parent=root;
        const xx=p.x*WIDTH,yy=MID_Y+p.y*HEIGHT;
        const depth=clamp(p.depth,0,1);
        quad.position.set(xx,yy,.003+depth*.028);
        quad.isPickable=false;
        quad.checkCollisions=false;
        quad.receiveShadows=false;
        quad.alphaIndex=100+Math.floor(depth*1000)+i;
        // UVs of a standalone tile in a top-origin atlas, converted to Babylon's
        // bottom-origin sampling convention; all sprites share just two atlases.
        const uv=quad.getVerticesData(VertexBuffer.UVKind);
        if(!uv){quad.dispose();continue;}
        const mapped=new Float32Array(uv.length);
        for(let j=0;j<uv.length;j+=2){
          mapped[j]=v.u0+(v.u1-v.u0)*uv[j];
          mapped[j+1]=v.v0+(v.v1-v.v0)*uv[j+1];
        }
        quad.setVerticesData(VertexBuffer.UVKind,mapped);
        const positions=quad.getVerticesData(VertexBuffer.PositionKind)!;
        const colors=new Float32Array(positions.length/3*4);
        for(let j=0;j<positions.length/3;j++){
          colors[j*4]=p.motion==="mist" ? 1 : 0;
          colors[j*4+1]=depth;
          colors[j*4+2]=((p.phase % 6.283)+6.283)%6.283/6.283;
          colors[j*4+3]=p.opacity;
        }
        quad.setVerticesData(VertexBuffer.ColorKind,colors);
        quad.material=materialsByAtlas.get(sprite.atlas)!;
        instances.push({mesh:quad,x:xx,y:yy,depth,phase:p.phase,motion:p.motion});
      }
      if(isDisposed||scene.isDisposed)return;
      if(instances.length===0) throw new Error("All forest sprites were rejected");
      backMaterial=bg;
      vortex.material=bg; // forest variant only; four crimson portal shaders unchanged
    } catch (error) {
      if(!isDisposed&&!aborter.signal.aborted){
        // Keep original crimson shader in place rather than blanking portal.
        if (vortex.material===backMaterial) vortex.material=oldVortexMaterial;
        for(const instance of instances) instance.mesh.dispose();
        instances.length=0;
        for(const mat of materials) mat.dispose();
        materials.length=0;
        for(const tex of textures) tex.dispose();
        textures.length=0;
        backMaterial=null;
        console.warn("Forest portal hybrid unavailable; using original sanctuary vortex:",error);
      }
    }
  })();
  return {dispose};
}
