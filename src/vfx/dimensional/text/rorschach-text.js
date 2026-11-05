// Standalone Babylon.js text material. No game or lab UI dependency.
import {createSignedInkField} from './ink-distance-field.js';
// Use shader source via import ?raw (Vite) or fetch it as the lab does.
let instanceCounter=0;
const VERTEX=`precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}`;

export const INK_PRESETS={
 darkness:{mode:'dialogue',ink:'#c9bacf',edge:'#7d4092',paper:'#cfbd9e',motion:1.12,warp:1.08,glyphDrift:1.30,glow:.24,breath:1.08,readability:.66,bleed:1.48,liquify:1.42,tendrils:1.15,pooling:.9,blotScale:1.16},
 note:{mode:'note',ink:'#241623',edge:'#4f2240',paper:'#d2c3a2',motion:.82,warp:.85,glyphDrift:.95,glow:.0,breath:.83,readability:.73,bleed:1.20,liquify:1.2,tendrils:.9,pooling:1.0,blotScale:1.0},
 possessed:{mode:'dialogue',ink:'#cba0a8',edge:'#ae204f',paper:'#cab9a4',motion:1.72,warp:1.57,glyphDrift:1.75,glow:.65,breath:1.8,readability:.48,bleed:1.9,liquify:2.25,tendrils:1.85,pooling:1.0,blotScale:1.43}
};

function toColor3(B,hex,fallback='#ffffff'){
 try{return B.Color3.FromHexString(/^#[0-9a-fA-F]{6}$/.test(hex)?hex:fallback);}catch{return B.Color3.FromHexString(fallback);}
}
function chars(value){return Array.from(String(value??''));}
export class RorschachTextRenderer {
 constructor({BABYLON,scene,fragment,width=1280,height=720,planeWidth=10,settings=INK_PRESETS.darkness}){
  if(!BABYLON?.ShaderMaterial||!scene||!fragment)throw Error('Babylon, escena y GLSL son obligatorios.');
  this.B=BABYLON;this.scene=scene;this.width=width;this.height=height;
  this.settings={...INK_PRESETS.darkness,...settings};this.text='';this.speaker='';this.currentChars=-1;
  this.mask=new BABYLON.DynamicTexture('rorschachTextMask_'+(++instanceCounter),{width,height},scene,false,BABYLON.Texture.BILINEAR_SAMPLINGMODE);
  this.mask.wrapU=BABYLON.Texture.CLAMP_ADDRESSMODE;
  this.mask.wrapV=BABYLON.Texture.CLAMP_ADDRESSMODE;
  this.fieldWidth=Math.max(128,Math.round(width*.4));this.fieldHeight=Math.max(96,Math.round(height*.4));
  this.field=new BABYLON.DynamicTexture('livingInkField_'+instanceCounter,{width:this.fieldWidth,height:this.fieldHeight},scene,false,BABYLON.Texture.BILINEAR_SAMPLINGMODE);
  this.field.wrapU=BABYLON.Texture.CLAMP_ADDRESSMODE;this.field.wrapV=BABYLON.Texture.CLAMP_ADDRESSMODE;
  this.lastFieldUpdate=-Infinity;this.fieldRefreshMs=145;
  this.key='rorschachTextFX_'+instanceCounter;
  BABYLON.Effect.ShadersStore[this.key+'VertexShader']=VERTEX;
  BABYLON.Effect.ShadersStore[this.key+'FragmentShader']=fragment;
  this.material=new BABYLON.ShaderMaterial('rorschachTextMaterial_'+instanceCounter,scene,this.key,{
   attributes:['position','uv'],uniforms:['worldViewProjection','uInkColor','uEdgeColor','uPaperColor','uGlyphDrift','uTextTime','uInkMotion','uWarp','uGlow','uBreath','uReadability','uTextMode','uBleed','uLiquify','uTendrils','uPooling','uBlotScale','uTextResolution','uFieldResolution'],samplers:['uTextMask','uTextField']
  });
  this.material.backFaceCulling=false;
  this.material.setTexture('uTextMask',this.mask);
  this.material.setTexture('uTextField',this.field);
  this.plane=BABYLON.MeshBuilder.CreatePlane('rorschachTextPlane_'+instanceCounter,{width:planeWidth,height:planeWidth*height/width},scene);
  this.plane.material=this.material;
  this.elapsed=0;
  this.setContent('La oscuridad me habla.','LA OSCURIDAD');
 }
 setContent(text,speaker=''){
  this.text=String(text??'');this.speaker=String(speaker??'');this.currentChars=-1;
  this.lastFieldUpdate=-Infinity;
  this.updateMask(chars(this.text).length);
 }
 setSettings(settings){
  const modeChanged=!!settings.mode && settings.mode!==this.settings.mode;
  this.settings={...this.settings,...settings};
  if(modeChanged){this.currentChars=-1;this.updateMask(chars(this.text).length);}
 }
 updateMask(limit=Infinity){
  const characters=chars(this.text);
  const count=Math.min(characters.length,Math.max(0,Math.floor(limit)));
  if(this.currentChars===count)return;
  this.currentChars=count;
  const ctx=this.mask.getContext(),W=this.width,H=this.height;
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
  ctx.save();ctx.fillStyle='#fff';ctx.textBaseline='alphabetic';
  const note=this.settings.mode==='note';
  const marginX=note?W*.13:W*.115;
  const maxWidth=W-marginX*2;
  const maximumLines=note?12:6;
  let size=note?47:55,lines=[];
  const visible=characters.slice(0,count).join('');
  // Measure full content first: animated reveal must not reflow existing lines.
  while(size>=26){
   ctx.font=`${note?'normal':'600'} ${size}px ${note?'Georgia,serif':'Georgia,serif'}`;
   lines=this.wrap(this.text,ctx,maxWidth);
   if(lines.length<=maximumLines)break;
   size-=2;
  }
  const step=size*(note?1.57:1.55);
  const allVisible=chars(visible);
  let visibleRemaining=allVisible.length;
  const blockHeight=lines.length*step;
  const top=note?H*.235:Math.max(H*.34,(H-blockHeight)*.55);
  if(this.speaker){
   ctx.font=`600 ${note?25:31}px Georgia,serif`;
   ctx.letterSpacing='1px';
   ctx.fillText(this.speaker.toLocaleUpperCase('es'),marginX,top-(note?57:88),maxWidth);
  }
  ctx.font=`${note?'normal':'600'} ${size}px Georgia,serif`;
  ctx.letterSpacing='0px';
  for(let i=0;i<lines.length;i++){
   // A newline in the original content also consumes a reveal character.
   const line=lines[i],sub=chars(line);
   if(visibleRemaining<=0)break;
   const current=sub.slice(0,visibleRemaining).join('');
   ctx.fillText(current,marginX,top+i*step,maxWidth);
   visibleRemaining-=sub.length;
   if(visibleRemaining>0)visibleRemaining-=1;
  }
  ctx.restore();
  this.mask.update(true); // Flip Canvas top-to-bottom for plane UVs (WebGL texture origin).
  const now=globalThis.performance?.now?.()??Date.now();
  // During typewriter reveal, throttle CPU SDF generation; the high-res mask
  // still updates every character. Always refresh on blank and final frames.
  if(now-this.lastFieldUpdate>=this.fieldRefreshMs || count===0 || count===characters.length){
   this.refreshDistanceField(ctx);this.lastFieldUpdate=now;
  }
 }
 refreshDistanceField(maskContext){
  const ctx=this.field.getContext();
  if(typeof ctx.drawImage!=='function'||typeof ctx.getImageData!=='function'||typeof ctx.putImageData!=='function')return;
  const W=this.fieldWidth,H=this.fieldHeight;
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(maskContext.canvas,0,0,W,H);
  const data=ctx.getImageData(0,0,W,H);
  data.data.set(createSignedInkField(data.data,W,H,22));
  ctx.putImageData(data,0,0);
  this.field.update(true);
 }
 wrap(message,ctx,maxWidth){
  const result=[];
  for(const paragraph of String(message).split('\n')){
   const words=paragraph.split(/\s+/).filter(Boolean);
   if(!words.length){result.push('');continue;}
   let line='';
   for(const word of words){
    const candidate=line?line+' '+word:word;
    if(ctx.measureText(candidate).width<=maxWidth){line=candidate;continue;}
    if(line)result.push(line);
    line=word;
    // Long unbroken strings should not disappear offscreen.
    if(ctx.measureText(line).width>maxWidth){
     const graphemes=chars(line);let acc='';
     for(const char of graphemes){
      if(acc&&ctx.measureText(acc+char).width>maxWidth){result.push(acc);acc=char;}else acc+=char;
     }
     line=acc;
    }
   }
   result.push(line);
  }
  return result;
 }
 tick(dt,paused=false){
  if(!paused)this.elapsed+=Math.max(0,dt);
  const mat=this.material,s=this.settings;
  mat.setFloat('uTextTime',this.elapsed);
  mat.setFloat('uInkMotion',s.motion);
  mat.setFloat('uWarp',s.warp);
  mat.setFloat('uGlyphDrift',s.glyphDrift??1.15);
  mat.setFloat('uGlow',s.glow);
  mat.setFloat('uBreath',s.breath);
  mat.setFloat('uReadability',s.readability);
  mat.setFloat('uBleed',s.bleed);
  mat.setFloat('uLiquify',s.liquify??1);mat.setFloat('uTendrils',s.tendrils??1);
  mat.setFloat('uPooling',s.pooling??1);mat.setFloat('uBlotScale',s.blotScale??1);
  mat.setFloat('uTextMode',s.mode==='note'?1:0);
  mat.setVector2('uTextResolution',new this.B.Vector2(this.width,this.height));
  mat.setVector2('uFieldResolution',new this.B.Vector2(this.fieldWidth,this.fieldHeight));
  mat.setColor3('uInkColor',toColor3(this.B,s.ink,'#d9c0e8'));
  mat.setColor3('uEdgeColor',toColor3(this.B,s.edge,'#b55bea'));
  mat.setColor3('uPaperColor',toColor3(this.B,s.paper,'#d2c3a2'));
 }
 dispose(){
  this.plane.dispose();this.material.dispose();this.mask.dispose();this.field.dispose();
  delete this.B.Effect.ShadersStore[this.key+'VertexShader'];
  delete this.B.Effect.ShadersStore[this.key+'FragmentShader'];
 }
}
