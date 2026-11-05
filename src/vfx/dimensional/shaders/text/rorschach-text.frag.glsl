// DIMENSIONAL FX LAB — RORSCHACH LIVING GLYPHS v0.13.
// The original text is only an INPUT MASK. The animated silhouette samples
// BOTH mask and signed distance through the SAME living spatial deformation.
// No static text copy is overlaid, even at maximum readability.
precision highp float;
varying vec2 vUV;
uniform sampler2D uTextMask,uTextField;
uniform float uTextTime,uInkMotion,uWarp,uGlow,uBreath,uReadability,uTextMode,uBleed;
uniform float uLiquify,uTendrils,uPooling,uBlotScale,uGlyphDrift;
uniform vec2 uTextResolution,uFieldResolution;
uniform vec3 uInkColor,uEdgeColor,uPaperColor;
#define INK_RANGE 22.0
float tiHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float tiNoise(vec2 p){
 vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(tiHash(i),tiHash(i+vec2(1.,0.)),f.x),
            mix(tiHash(i+vec2(0.,1.)),tiHash(i+vec2(1.,1.)),f.x),f.y);
}
float tiFBM(vec2 p){
 float value=0.0,amp=.5;
 for(int j=0;j<3;j++){
  value+=amp*tiNoise(p);p=p*2.03+vec2(17.3,9.1);amp*=.5;
 }
 return value;
}
float fieldDistance(vec2 uv){
 return (texture2D(uTextField,clamp(uv,vec2(.0001),vec2(.9999))).r-.5)*(2.*INK_RANGE);
}
void main(){
 vec2 uv=vUV;
 vec2 aspect=vec2(uTextResolution.x/max(1.,uTextResolution.y),1.0);
 vec2 p=uv*aspect;
 float t=uTextTime*uInkMotion;
 float scale=mix(1.75,.43,clamp(uBlotScale/3.0,0.,1.));
 // Connected displacement of the whole glyph mass. Changing the drift slider
 // moves the ACTUAL letter silhouettes, not a decorative layer on top.
 vec2 domain=p*vec2(7.4,11.8)*scale;
 float flowA=tiFBM(domain+vec2(t*.23,-t*.19));
 float flowB=tiFBM(domain.yx*1.13+vec2(-t*.21,t*.25)+4.7);
 vec2 curl=vec2(flowB-.45,-flowA+.45);
 vec2 glyphSway=vec2(
  sin(t*1.15+p.x*16.5+flowA*5.2),
  cos(t*.93+p.x*12.8+p.y*4.1+flowB*5.1)
 );
 vec2 displacement=curl*(.016*uWarp)+glyphSway*(.0052*uGlyphDrift);
 // Fine local eddies loosen strokes without moving the text as one rigid block.
 vec2 ripple=vec2(
  tiNoise(domain*2.6+vec2(t*.37,2.4)),
  tiNoise(domain*2.3+vec2(1.2,-t*.31)))-.5;
 displacement+=ripple*(.0028*uLiquify);
 vec2 warpedUV=uv+displacement;
 float signedInk=fieldDistance(warpedUV);
 float cleanMoved=texture2D(uTextMask,clamp(warpedUV,vec2(.0001),vec2(.9999))).r;
 float stain=tiFBM(p*vec2(21.,29.)*scale+curl*2.7+vec2(t*.18,-t*.15));
 float micro=tiFBM(p*vec2(42.,35.)*scale+vec2(-t*.27,t*.22));
 float breath=sin(t*.76+tiFBM(p*6.0)*4.0)*uBreath;
 float contour=(stain-.47)*(11.0*uLiquify)+(micro-.50)*(4.1*uLiquify)+breath*2.3;
 float liquidDistance=signedInk+contour;
 // Texture feels as though it has grown inside the letter itself.
 float strand=abs(sin((p.x+flowB*.08)*111.*scale+(p.y-flowA*.05)*71.*scale+micro*12.-t*.84));
 strand=pow(max(0.,1.-strand),10.);
 float around=1.-smoothstep(2.,19.,-signedInk);
 liquidDistance+=strand*around*uTendrils*5.0;
 vec2 droplets=p*(48.*scale)+curl*.46+vec2(t*.05,-t*.037);
 vec2 cell=floor(droplets),local=fract(droplets)-.5;
 vec2 beadPos=vec2(tiHash(cell),tiHash(cell+vec2(7.2,1.8)))-.5;
 float bead=(1.-smoothstep(.08,.21,length(local-beadPos*.67)))*smoothstep(.79,.96,tiHash(cell+vec2(3.4,15.7)));
 bead*= (1.-smoothstep(4.,21.,-signedInk))*smoothstep(.5,7.,-signedInk);
 liquidDistance+=bead*uTendrils*7.5;
 float evolvingShape=smoothstep(-1.1,1.1,liquidDistance);
 // Readability is the amount of the MOVING glyph core retained: it never
 // restores the static mask at the original UV coordinates.
 float legibleMovingCore=mix(evolvingShape,cleanMoved,.82);
 float coverage=mix(evolvingShape,legibleMovingCore,clamp(uReadability,0.,1.));
 float wet=tiFBM(p*vec2(24.,27.)*scale+curl*2.6+vec2(t*.19,t*.05));
 float cracks=tiNoise(p*vec2(58.,67.)*scale+vec2(-t*.26,t*.28));
 float pooling=smoothstep(.24,.77,wet+.14*cracks);
 float darkening=mix(1.0,.64+.34*pooling,clamp(uPooling,0.,1.));
 vec3 pigment=uInkColor*darkening;
 vec3 background;
 if(uTextMode<.5){
  vec2 q=(uv-.5)*vec2(1.78,1.0);
  background=mix(vec3(.027,.018,.043),vec3(.006,.008,.017),smoothstep(.25,.95,length(q)));
  float haze=tiFBM(vec2(abs(q.x)*3.1,q.y*3.7)+vec2(3.,t*.025));
  background+=uEdgeColor*.040*smoothstep(.41,.73,haze);
 }else{
  float speck=tiNoise(uv*vec2(580.,350.));
  background=uPaperColor*(.92+.10*(speck-.5)-.15*smoothstep(.28,.77,length(uv-.5)));
 }
 float halo=(1.-smoothstep(1.0,16.0,-signedInk))*smoothstep(-1.0,2.0,-signedInk)*uBleed*(.3+.7*stain);
 vec3 color=mix(background,pigment,clamp(coverage,0.,1.));
 if(uTextMode<.5){
  color+=uEdgeColor*halo*uGlow*.20;
  color+=uEdgeColor*bead*uTendrils*.075;
 }else{
  color=mix(color,color*.8,halo*.11);
 }
 gl_FragColor=vec4(max(color,vec3(0.0)),1.0);
}
