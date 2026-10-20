/**
 * StagePyro v3 — continuous stage flame -> blowout -> ember cloud -> black smoke.
 * Babylon.js / TypeScript. One shader + one billboard for the WHOLE active flame.
 * Clouds only appear when the fuel is cut; no separately superimposed 'head'.
 *
 * Integration:
 *   const show = new StagePyroShow(scene, positions, { jetHeight: 7 });
 *   show.fireAll();  show.fireSequence(.15);  show.fireAt(0);
 *   show.dispose();
 *
 * No FireMaterial and no external texture assets required.
 * This is a stylized real-time 2.5D effect, not volumetric CFD.
 */
import {
  Color3, Color4, DynamicTexture, Effect, Engine, Mesh,
  MeshBuilder, ParticleSystem, PointLight, Scene, ShaderMaterial, Vector3,
} from '@babylonjs/core';
import type { Observer } from '@babylonjs/core/Misc/observable';

export interface StagePyroOptions {
  jetHeight?: number;        // World units; nominal height of top of flame, default 7
  jetBaseWidth?: number;     // World units, diameter at the nozzle, default .38
  jetWidth?: number;         // Legacy v2 option: minimum billboard width
  headDiameter?: number;    // Approximate upper flame crown diameter, default 3.25
  jetTravelTime?: number;   // Ascending flame front reaches crown altitude, default .17 s
  headExpandTime?: number;  // Crown bulges AFTER arrival, default .13 s
  sustainTime?: number;     // Flame remains attached after arrival, default .27 s
  blowoutTime?: number;     // Fuel cuts, lower jet burns out upward, default .22 s
  emberTime?: number;       // Cloud retains orange fire, default .65 s
  smokeTime?: number;       // Further smoke dissipation, default 3.2 s
  duration?: number;        // Compatibility: if provided and no sustainTime, controls fire+embers duration
  brightness?: number;      // HDR output intensity, default 1
  particles?: boolean;      // Optional glowing sparks, default true
  smoke?: boolean;          // Black rolling shader clouds, default true (independent of particles)
  lighting?: boolean;       // Dynamic PointLight per emitter, default true
  cloudCount?: number;      // Rolling fire/smoke sprites per emitter, default 5
  wind?: Vector3;           // World-space lateral drift (units/second), default (.15,0,0)
}

const VERTEX = /* glsl */ `
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

/**
 * Active phase: body and crown exist IN THE SAME IMPLICIT FIELD on ONE billboard.
 * Smooth unions share exactly the same flow distortion, silhouette, material and
 * alpha calculation. Nothing is rendered as a second mesh above the jet.
 */
const FLAME_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform float uSeed;
uniform float uBrightness;
uniform float uOpacity;
uniform float uFlash;        // Brief brightening when the front reaches the crown
uniform float uRise;         // 0..1, tip ascending
uniform float uCrown;        // 0..1, crown expansion AFTER full rise
uniform float uCollapse;     // 0..1, lower jet eroded upwards
uniform float uJetHeight;
uniform float uHeadRadius;
uniform float uBaseRadius;
uniform float uCanvasWidth;
uniform float uCanvasHeight;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0,0.0)), f.x),
             mix(hash21(i + vec2(0.0,1.0)), hash21(i + vec2(1.0,1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float f = 0.0, a = .5;
  for (int i=0; i<4; i++) {
    f += a * noise2(p);
    p = p*2.03 + vec2(15.7,9.2);
    a *= .5;
  }
  return f;
}
float smin(float a, float b, float k) {
  float h = clamp(.5 + .5*(b-a)/max(k,.001), 0., 1.);
  return mix(b,a,h) - k*h*(1.-h);
}
float ellipse(vec2 p, vec2 radii) {
  return (length(p/max(radii,vec2(.01))) - 1.)*min(radii.x,radii.y);
}
float ramp(float a, float b, float x) { return smoothstep(a,b,x); }

void main(void) {
  float R = max(.15, uHeadRadius);
  float H = max(1., uJetHeight);
  float x = (vUV.x-.5)*uCanvasWidth;
  float y = vUV.y*uCanvasHeight;
  float t = uTime;
  float noiseScale = 1. / R;

  // All components use ONE warped coordinate domain: the edge cannot split.
  vec2 p = vec2(x,y);
  float adv = t*3.1 + uSeed*4.3;
  float coarse = fbm(vec2(p.x*1.35*noiseScale + uSeed,
                         p.y*1.35*noiseScale - adv));
  float medium = fbm(vec2(p.x*3.8*noiseScale - uSeed,
                         p.y*3.5*noiseScale - adv*1.8));
  float sway = (sin(y*1.55 + t*6.0 + uSeed*6.0)*.045*R
              + (coarse-.5)*.18*R)*ramp(0.,H*.55,y);
  vec2 q = p;
  q.x -= sway;
  q.x += (medium-.5)*.105*R;
  q.y += (coarse-.5)*.10*R;

  float targetFront = max(.2, H - .24*R);
  float tipY = max(.035, uRise*targetFront);
  float yn = clamp(q.y/max(tipY,.1),0.,1.);

  // Flaring column, tapering into a genuinely rounded moving tip.
  // At full growth the shoulder width almost equals the crown width.
  float shoulder = mix(.76*R, .96*R, uCrown);
  float w = mix(max(.04,uBaseRadius), shoulder, pow(yn,1.22));
  float capLen = max(.17, min(.57*R,tipY*.27));
  float capU = clamp((q.y - (tipY-capLen))/capLen,0.,1.);
  float capRound = sqrt(max(0., 1. - capU*capU));
  w *= capRound;
  float dBody = max(abs(q.x)-w, q.y-tipY);
  // Bumpy edges share the same continuous body+crown distance field.

  // Cauliflower crown integrates with the shoulder as ONE smooth SDF union,
  // not a second billboard. It grows only after the front arrives.
  float cr = max(.02, uCrown);
  vec2 center = vec2(0.,targetFront - .12*R);
  float rx = R*(.16 + .88*cr);
  float ry = R*(.16 + .70*cr);
  float crownD = ellipse(q-center, vec2(rx,ry));
  crownD = smin(crownD,
    ellipse(q-center-vec2(-.48*rx,.27*ry),vec2(.61*rx,.64*ry)), .21*R);
  crownD = smin(crownD,
    ellipse(q-center-vec2(.46*rx,.21*ry),vec2(.62*rx,.67*ry)), .19*R);
  crownD = smin(crownD,
    ellipse(q-center-vec2(-.12*rx,.54*ry),vec2(.59*rx,.56*ry)), .20*R);
  crownD = smin(crownD,
    ellipse(q-center-vec2(.23*rx,-.41*ry),vec2(.43*rx,.61*ry)), .18*R);
  float combined = smin(dBody,crownD,.28*R);
  float d = mix(dBody, combined, ramp(.01,.13,uCrown));

  // Scale of irregularity increases toward the upper plume.
  float growNoise = .18 + .82*ramp(.07,H*.58,y);
  float rimNoise = fbm(vec2(q.x*5.2*noiseScale + uSeed,
                             q.y*5.6*noiseScale - adv*2.2));
  float fineNoise = noise2(vec2(q.x*18.*noiseScale,
                                  q.y*16.*noiseScale - adv*4.2));
  d += growNoise*R*(.23*(rimNoise-.5)+.065*(fineNoise-.5));
  float feather = max(.035, R*.075);
  float edge = 1.-smoothstep(-feather,feather*1.5,d);

  // Gas shutoff burns away the column from the bottom, irregularly and softly.
  // The upper hot mass remains for the following cloud phase.
  float cutY = uCollapse*(targetFront+.22*R);
  float erosion = ramp(cutY-.43*R,cutY+.34*R,
                       y+(medium-.5)*.30*R);
  edge *= mix(1.,erosion,ramp(.02,.14,uCollapse));
  edge *= ramp(-.09,.13,y);

  // Structured convection and dark folds: avoid a single yellow plastic cone.
  float depth = ramp(.015*R,.60*R,-d);
  float axial = 1.-ramp(.02, max(.11,w)*1.15,abs(q.x));
  float cells = fbm(vec2(q.x*3.15*noiseScale+uSeed*3.,
                          q.y*3.3*noiseScale-adv*1.8));
  float cells2 = fbm(vec2(q.x*9.8*noiseScale-uSeed,
                           q.y*8.1*noiseScale-adv*3.4));
  float pockets = ramp(.53,.78,fbm(vec2(q.x*4.6*noiseScale+2.4,
                                      q.y*4.3*noiseScale-adv*.9)));
  float hot = clamp(.18 + .32*depth + .30*axial + .30*cells
                    +.18*cells2 - .36*pockets,0.,1.);
  hot += (1.-ramp(.10,H*.80,y))*.12*depth;
  float crownHeat = ramp(H*.62,H*.90,y);
  hot -= crownHeat*.10*(1.-cells);
  // Amber outer gas recedes into the glow instead of drawing a red outline.
  vec3 color = mix(vec3(.82,.26,.035),vec3(1.65,.48,.055),ramp(.13,.40,hot));
  color = mix(color,vec3(3.05,1.12,.15),ramp(.34,.67,hot));
  color = mix(color,vec3(4.2,2.85,1.10),ramp(.66,.97,hot)*.88);
  float ignitionBoost = 1.0 + .24*(1.0-ramp(.04,.38,uTime));
  color *= (.88 + .24*cells2)*ignitionBoost;
  float flashZone = ramp(H*.50,H*.86,y)
    * (1.0-ramp(.78*R,1.55*R,abs(q.x)));
  color += vec3(1.8,1.5,.65)*flashZone*uFlash;
  // Variable gas density lets the background show through the outer lobes.
  float density = mix(.34,.82,depth)*mix(.68,1.0,cells);
  float alpha = edge*density*(.78+.22*cells2)*uOpacity;
  if (alpha < .008) discard;
  gl_FragColor = vec4(color*uBrightness,clamp(alpha,0.,1.));
}
`;

/** Detached lobes: glowing clouds turn into soot in place, then drift/dissipate. */
const CLOUD_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform float uSeed;
uniform float uOpacity;
uniform float uSmokeBlend;  // 0=fire, 1=black smoke
uniform float uBrightness;

float hash21(vec2 p) {
  p=fract(p*vec2(127.1,311.7));
  p+=dot(p,p+43.17);
  return fract(p.x*p.y);
}
float noise2(vec2 p) {
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),
             mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.,1.)),f.x),f.y);
}
float fbm(vec2 p) {
  float a=.5, v=0.;
  for(int i=0;i<4;i++) { v+=a*noise2(p); p=p*2.07+vec2(11.9,7.3); a*=.5; }
  return v;
}
float smin(float a,float b,float k) {
  float h=clamp(.5+.5*(b-a)/max(k,.001),0.,1.);
  return mix(b,a,h)-k*h*(1.-h);
}
void main(void) {
  vec2 p=(vUV-.5)*2.;
  float t=uTime;
  float large=fbm(p*2.8+vec2(t*.27+uSeed,-t*.24));
  float mids=fbm(p*7.4+vec2(-t*.65,t*.61)+uSeed*1.4);
  vec2 q=p + vec2((large-.5)*.23,(mids-.5)*.16);
  float d=length((q-vec2(.0,-.07))*vec2(1.,.96))-.58;
  d=smin(d,length(q-vec2(-.34,.22))-.40,.19);
  d=smin(d,length(q-vec2(.32,.18))-.38,.19);
  d=smin(d,length(q-vec2(-.13,-.40))-.34,.20);
  d=smin(d,length(q-vec2(.22,.43))-.29,.16);
  d+=.25*(fbm(q*5.7+vec2(-t*.44,t*.78))-.5);
  d+=.08*(fbm(q*15.5+vec2(t*1.20,-t*.86))-.5);
  float alpha=1.-smoothstep(-.035,.12,d);
  float depth=1.-smoothstep(-.40,.0,d);
  float hotCell=fbm(q*5.2+vec2(t*.5,-t*1.6)+uSeed);
  float hotFine=fbm(q*13.5+vec2(-t*.9,t*1.1));
  float hot=clamp(.12+.38*depth+.45*hotCell+.25*hotFine,0.,1.);
  vec3 fire=mix(vec3(.47,.025,.007),vec3(1.85,.23,.018),smoothstep(.21,.52,hot));
  fire=mix(fire,vec3(3.7,1.7,.22),smoothstep(.49,.85,hot));
  fire=mix(fire,vec3(4.1,2.7,1.0),smoothstep(.83,1.,hot)*.5);
  // Dense but textured black smoke; slight brown-red residual at early times.
  float smokeDetail=fbm(q*5.1+vec2(-t*.21,t*.33)+uSeed*3.4);
  vec3 soot=mix(vec3(.018,.017,.020),vec3(.11,.099,.097),
                 clamp(.30+.44*smokeDetail+.30*depth,0.,1.));
  soot+=vec3(.035,.008,.001)*(1.-uSmokeBlend);
  vec3 rgb=mix(fire*uBrightness,soot,uSmokeBlend);
  alpha *= uOpacity * mix(1.,.93,uSmokeBlend);
  alpha *= (.85+.15*smokeDetail);
  if(alpha < .008) discard;
  gl_FragColor=vec4(rgb,clamp(alpha,0.,1.));
}
`;

const SHADER_KEY = 'concertStagePyroV3';
function registerShaders(): void {
  Effect.ShadersStore[`${SHADER_KEY}FlameVertexShader`] = VERTEX;
  Effect.ShadersStore[`${SHADER_KEY}FlameFragmentShader`] = FLAME_FRAGMENT;
  Effect.ShadersStore[`${SHADER_KEY}CloudVertexShader`] = VERTEX;
  Effect.ShadersStore[`${SHADER_KEY}CloudFragmentShader`] = CLOUD_FRAGMENT;
}
function clamp01(x: number): number { return Math.max(0,Math.min(1,x)); }
function smooth(a:number,b:number,x:number):number {
  const v=clamp01((x-a)/Math.max(b-a,1e-6)); return v*v*(3-2*v);
}
function hashSeed(x:number):number { const a=Math.sin(x*127.1+18.17)*43758.5453; return a-Math.floor(a); }

interface ResolvedOptions {
  jetHeight:number; jetBaseWidth:number; jetWidth:number; headDiameter:number;
  jetTravelTime:number; headExpandTime:number; sustainTime:number;
  blowoutTime:number; emberTime:number; smokeTime:number;
  brightness:number; particles:boolean; smoke:boolean; lighting:boolean;
  cloudCount:number; wind:Vector3;
}

function resolveOptions(input:StagePyroOptions):ResolvedOptions {
  const jetTravelTime=Math.max(.035,input.jetTravelTime??.17);
  const headExpandTime=Math.max(.035,input.headExpandTime??.13);
  const blowoutTime=Math.max(.05,input.blowoutTime??.22);
  const emberTime=Math.max(.06,input.emberTime??.65);
  // If an old v2 caller supplied duration, reinterpret it as the fiery-cycle
  // duration, rather than truncating smoke. Explicit sustainTime takes priority.
  const sustainTime=Math.max(headExpandTime+.035,
    input.sustainTime ?? (input.duration!==undefined
      ? Math.max(0,input.duration-jetTravelTime-blowoutTime-emberTime)
      : .27));
  const headDiameter=Math.max(.3,input.headDiameter??3.25);
  return {
    jetHeight:Math.max(.8,input.jetHeight??7),
    jetBaseWidth:Math.min(headDiameter*.80,Math.max(.06,input.jetBaseWidth??.38)),
    jetWidth:Math.max(.1,input.jetWidth??2.4),headDiameter,jetTravelTime,
    headExpandTime,sustainTime,blowoutTime,emberTime,
    smokeTime:Math.max(.05,input.smokeTime??3.2),
    brightness:Math.max(.1,input.brightness??1.0),
    particles:input.particles??true,smoke:input.smoke??true,
    lighting:input.lighting??true,
    cloudCount:Math.min(10,Math.max(2,Math.round(input.cloudCount??5))),
    wind:input.wind?.clone()??new Vector3(.17,0,.04),
  };
}

function shaderMaterial(scene:Scene,name:string,kind:'Flame'|'Cloud'):ShaderMaterial {
  const mat=new ShaderMaterial(name,scene,{
    vertex:`${SHADER_KEY}${kind}`,fragment:`${SHADER_KEY}${kind}`,
  },{
    attributes:['position','uv'],
    uniforms:['worldViewProjection','uTime','uSeed','uBrightness','uOpacity',
      ...(kind==='Flame'
        ? ['uFlash','uRise','uCrown','uCollapse','uJetHeight','uHeadRadius',
           'uBaseRadius','uCanvasWidth','uCanvasHeight']
        : ['uSmokeBlend'])],
    needAlphaBlending:true,
  });
  mat.backFaceCulling=false;
  mat.disableDepthWrite=true;
  // The luminous flame adds light without a flat opaque silhouette. Smoke
  // keeps standard alpha so its dark mass can cover the sky behind it.
  mat.alphaMode=kind==='Flame' ? Engine.ALPHA_ADD : Engine.ALPHA_COMBINE;
  return mat;
}

function sparkTexture(scene:Scene):DynamicTexture {
  const tex=new DynamicTexture('stagePyroV3Sparks', {width:64,height:64},scene,false);
  const ctx=tex.getContext();
  const grad=ctx.createRadialGradient(32,32,0,32,32,32);
  grad.addColorStop(0,'rgba(255,255,255,1)');
  grad.addColorStop(.22,'rgba(255,255,255,.9)');
  grad.addColorStop(.55,'rgba(255,255,255,.22)');
  grad.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=grad; ctx.fillRect(0,0,64,64);
  tex.hasAlpha=true; tex.update();
  return tex;
}

interface Cloud {
  mesh:Mesh;
  mat:ShaderMaterial;
  // normalized spawn origin around plume, stable across repeat triggers
  side:number;
  up:number;
  depth:number;
  size:number;
  variance:number;
}

class PyroUnit {
  private readonly flame:Mesh;
  private readonly flameMat:ShaderMaterial;
  private readonly clouds:Cloud[]=[];
  private readonly sparks:ParticleSystem|null;
  private readonly light:PointLight|null;
  private readonly pos:Vector3;
  private readonly opts:ResolvedOptions;
  private readonly id:number;
  private readonly cloudStart:number;
  private readonly emberEnd:number;
  private readonly total:number;
  private age=Number.POSITIVE_INFINITY;
  private sparksStarted=false;
  private active=false;

  constructor(scene:Scene,id:number,position:Vector3,opts:ResolvedOptions,tex:DynamicTexture|null) {
    this.pos=position.clone(); this.opts=opts; this.id=id;
    this.cloudStart=opts.jetTravelTime+opts.sustainTime;
    this.emberEnd=this.cloudStart+opts.blowoutTime+opts.emberTime;
    this.total=this.emberEnd+(opts.smoke?opts.smokeTime:0);
    const R=opts.headDiameter*.5;
    // All exposed flame pixels fit inside a single tall plane with margin.
    const meshWidth=Math.max(opts.jetWidth,opts.headDiameter*1.8);
    const meshHeight=opts.jetHeight+opts.headDiameter*.8;
    this.flame=MeshBuilder.CreatePlane(`pyroFlameV3_${id}`,
      {width:meshWidth,height:meshHeight,sideOrientation:Mesh.DOUBLESIDE},scene);
    this.flame.position.copyFrom(position);
    this.flame.position.y+=meshHeight*.5;
    this.flame.billboardMode=Mesh.BILLBOARDMODE_Y;
    this.flame.isPickable=false;
    this.flameMat=shaderMaterial(scene,`pyroFlameMaterialV3_${id}`,'Flame');
    this.flame.material=this.flameMat;
    this.flameMat.setFloat('uJetHeight',opts.jetHeight);
    this.flameMat.setFloat('uHeadRadius',R);
    this.flameMat.setFloat('uBaseRadius',opts.jetBaseWidth*.5);
    this.flameMat.setFloat('uCanvasWidth',meshWidth);
    this.flameMat.setFloat('uCanvasHeight',meshHeight);
    this.flameMat.setFloat('uSeed',id*.217+1.37);
    this.flameMat.setFloat('uBrightness',opts.brightness);
    this.flameMat.setFloat('uTime',0);
    this.flameMat.setFloat('uFlash',0);
    this.flameMat.setFloat('uRise',0);
    this.flameMat.setFloat('uCrown',0);
    this.flameMat.setFloat('uCollapse',0);
    this.flameMat.setFloat('uOpacity',0);
    // Disabled meshes do not compile on their own. Prepare both shaders while
    // the level loads so the first chorus has no missing fire or smoke frames.
    this.flameMat.isReadyForSubMesh(this.flame,this.flame.subMeshes[0]);
    this.flame.setEnabled(false);

    // Clouds are *not* the initial fireball: they're detached combustion/smoke
    // generated only from blowout onwards. They retain their silhouettes.
    for(let i=0;i<opts.cloudCount;i++) {
      const side=(hashSeed(id*29+i*11+.72)-.5)*1.85;
      const up=(hashSeed(id*17+i*19+4.5)-.5)*.70;
      const depth=(hashSeed(id*5+i*13+1.2)-.5)*.85;
      const size=.62+hashSeed(id*73+i*31+9.7)*.53;
      const variance=hashSeed(id*41+i*53+7.1);
      const planeSize=opts.headDiameter*1.18;
      const mesh=MeshBuilder.CreatePlane(`pyroAfterCloudV3_${id}_${i}`,
        {width:planeSize,height:planeSize,sideOrientation:Mesh.DOUBLESIDE},scene);
      mesh.billboardMode=Mesh.BILLBOARDMODE_ALL;
      mesh.isPickable=false;
      mesh.applyFog=false;
      const mat=shaderMaterial(scene,`pyroCloudMatV3_${id}_${i}`,'Cloud');
      mat.setFloat('uSeed',id*1.17+i*2.9+3.6);
      mat.setFloat('uBrightness',opts.brightness);
      mat.setFloat('uTime',0);
      mat.setFloat('uOpacity',0);
      mat.setFloat('uSmokeBlend',0);
      mesh.material=mat;
      mat.isReadyForSubMesh(mesh,mesh.subMeshes[0]);
      mesh.setEnabled(false);
      this.clouds.push({mesh,mat,side,up,depth,size,variance});
    }

    if(opts.particles&&tex) {
      const sparks=new ParticleSystem(`pyroSparksV3_${id}`,140,scene);
      sparks.particleTexture=tex;
      sparks.emitter=position.add(new Vector3(0,opts.jetHeight*.86,0));
      sparks.minEmitBox=new Vector3(-R*.38,-R*.16,-R*.3);
      sparks.maxEmitBox=new Vector3(R*.38,R*.16,R*.3);
      sparks.direction1=new Vector3(-2,.3,-1);
      sparks.direction2=new Vector3(2,3.3,1);
      sparks.minEmitPower=.3; sparks.maxEmitPower=2.1;
      sparks.minLifeTime=.16; sparks.maxLifeTime=.9;
      sparks.minSize=.025; sparks.maxSize=.105;
      sparks.emitRate=100;
      sparks.color1=new Color4(1,.90,.42,1);
      sparks.color2=new Color4(1,.28,.03,.75);
      sparks.colorDead=new Color4(.3,.07,.01,0);
      sparks.gravity=new Vector3(0,-2.1,0);
      sparks.blendMode=ParticleSystem.BLENDMODE_ADD;
      this.sparks=sparks;
    } else this.sparks=null;

    if(opts.lighting) {
      const light=new PointLight(`pyroPointV3_${id}`,
        position.add(new Vector3(0,opts.jetHeight*.68,0)),scene);
      light.intensity=0; light.range=opts.jetHeight*1.8;
      light.diffuse=new Color3(1,.38,.075);
      light.specular=new Color3(1,.26,.045);
      this.light=light;
    } else this.light=null;
  }

  cancel():void {
    this.active=false;this.age=Number.POSITIVE_INFINITY;
    this.flame.setEnabled(false);
    this.clouds.forEach(c=>c.mesh.setEnabled(false));
    this.sparks?.stop();
    if(this.light)this.light.intensity=0;
  }

  trigger(delay=0):void {
    this.sparks?.stop();this.sparks?.reset();
    this.sparksStarted=false;
    this.active=true;
    this.age=-Math.max(0,delay);
    this.flame.setEnabled(false);
    for(const cloud of this.clouds) cloud.mesh.setEnabled(false);
    if(this.light) this.light.intensity=0;
  }

  update(dt:number):void {
    if(!this.active)return;
    this.age+=dt;
    if(this.age<0)return;
    if(this.age>=this.total) {
      this.active=false;
      this.flame.setEnabled(false);
      this.clouds.forEach(c=>c.mesh.setEnabled(false));
      this.sparks?.stop();
      if(this.light)this.light.intensity=0;
      return;
    }
    const o=this.opts;
    const t=this.age;
    const rise=smooth(0,o.jetTravelTime,t);
    const crown=smooth(o.jetTravelTime,o.jetTravelTime+o.headExpandTime,t);
    const flash=Math.exp(-Math.pow(
      (t-o.jetTravelTime-o.headExpandTime*.5)/.075,2));
    const blow=smooth(this.cloudStart,this.cloudStart+o.blowoutTime,t);
    const flameOpacity=(1.-smooth(this.cloudStart+o.blowoutTime*.15,
                                this.cloudStart+o.blowoutTime*1.03,t));
    const flicker=.96+.04*Math.sin(t*37.2+this.id*8.1);
    this.flame.setEnabled(flameOpacity>.01);
    this.flameMat.setFloat('uTime',t);
    this.flameMat.setFloat('uFlash',flash);
    this.flameMat.setFloat('uRise',rise);
    this.flameMat.setFloat('uCrown',crown);
    this.flameMat.setFloat('uCollapse',blow);
    this.flameMat.setFloat('uOpacity',flameOpacity*flicker);
    const cloudAge=t-this.cloudStart;
    if(cloudAge>=0) {
      const fadeOut=o.smoke
        ? (1.-smooth(this.total-o.smokeTime*.50,this.total, t))
        : (1.-smooth(this.emberEnd-o.emberTime*.35,this.emberEnd,t));
      const appear=smooth(o.blowoutTime*.38,o.blowoutTime*.90,cloudAge);
      const smokeBlend=o.smoke
        ? smooth(o.blowoutTime*.5,o.blowoutTime+o.emberTime*.9,cloudAge)
        : 0;
      const R=o.headDiameter*.5;
      this.clouds.forEach((c,i)=>{
        const rel=Math.max(0,cloudAge-.055*c.variance);
        c.mesh.setEnabled(rel>=0 && appear*fadeOut>.015);
        const spread=(.30+.51*rel);
        c.mesh.position.set(
          this.pos.x + R*c.side*spread + o.wind.x*rel,
          this.pos.y + o.jetHeight - R*.17 + R*c.up*(.25+.30*rel)
            + rel*(.85+.44*c.variance)+o.wind.y*rel,
          this.pos.z + R*c.depth*spread + o.wind.z*rel,
        );
        const scale=c.size*(.38+.22*rel + .27*Math.sqrt(rel));
        c.mesh.scaling.set(scale,scale,1);
        c.mat.setFloat('uTime',rel);
        c.mat.setFloat('uOpacity',appear*fadeOut
          * (.78+.22*c.variance) * (i===0?1.0:.87));
        c.mat.setFloat('uSmokeBlend',smokeBlend);
      });
    } else this.clouds.forEach(c=>c.mesh.setEnabled(false));
    if(!this.sparksStarted && t>=this.cloudStart*.85) {
      this.sparks?.start();this.sparksStarted=true;
    }
    if(t>=this.cloudStart+o.blowoutTime+o.emberTime*.25)this.sparks?.stop();
    if(this.light) {
      const emberGlow=t>=this.cloudStart
        ? (1.-smooth(this.cloudStart+o.blowoutTime,
                     this.cloudStart+o.blowoutTime+o.emberTime,t)) : 0;
      this.light.intensity=(1.65*flameOpacity+.58*emberGlow+2.4*flash)*flicker;
    }
  }

  dispose():void {
    this.sparks?.dispose(false);
    this.flame.dispose(); this.flameMat.dispose();
    for(const c of this.clouds) { c.mesh.dispose(); c.mat.dispose(); }
    this.light?.dispose();
  }
}

/** API compatible with the original StagePyro v2; owns scene observer and resources. */
export class StagePyroShow {
  private readonly units:PyroUnit[];
  private readonly particleTexture:DynamicTexture|null;
  private readonly observer:Observer<Scene>|null;
  private readonly scene:Scene;
  private disposed=false;

  constructor(scene:Scene,positions:Vector3[],settings:StagePyroOptions={}) {
    this.scene=scene;
    registerShaders();
    const opts=resolveOptions(settings);
    this.particleTexture=opts.particles?sparkTexture(scene):null;
    this.units=positions.map((p,i)=>new PyroUnit(scene,i,p,opts,this.particleTexture));
    this.observer=scene.onBeforeRenderObservable.add(()=>{
      // Bound delta to avoid teleportation when the tab recovers from suspension.
      const dt=Math.max(0,Math.min(.06,scene.getEngine().getDeltaTime()/1000));
      for(const unit of this.units) unit.update(dt);
    });
  }
  /** Start all emitters on the same render frame. */
  fireAll():void { if(this.disposed)return;this.units.forEach(x=>x.trigger()); }
  /** Trigger in the same order as positions[]. No browser setTimeout. */
  fireSequence(staggerSeconds=.15):void {
    if(this.disposed)return;
    this.units.forEach((x,i)=>x.trigger(i*Math.max(0,staggerSeconds)));
  }
  /** Zero-based emitter index; invalid indices are a no-op. */
  fireAt(index:number):void { if(this.disposed)return;this.units[index]?.trigger(); }
  /** Rewinds and hides effects; does not allocate new Babylon resources. */
  stopAll():void { if(this.disposed)return;this.units.forEach(x=>x.cancel()); }
  dispose():void {
    if(this.disposed)return;
    this.disposed=true;
    if(this.observer)this.scene.onBeforeRenderObservable.remove(this.observer);
    this.units.forEach(x=>x.dispose());
    this.particleTexture?.dispose();
  }
}
