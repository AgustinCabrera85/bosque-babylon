// DIMENSIONAL FX LAB — shared GLSL 1.00 functions
// Original, independently authored procedural helpers. Not Shadertoy source.
#define PI 3.141592653589793
float sat(float x){ return clamp(x,0.0,1.0); }
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float hash31(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
vec2 hash22(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
float noise(vec2 p){ vec2 i=floor(p), f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y); }
float noise3(vec3 p){vec3 i=floor(p), f=fract(p);f=f*f*(3.-2.*f);
 float a=mix(hash31(i),hash31(i+vec3(1,0,0)),f.x), b=mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x);
 float c=mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x), d=mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x);
 return mix(mix(a,b,f.y),mix(c,d,f.y),f.z); }
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(14.3,7.8);a*=.5;}return v;}
float fbm3(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise3(p);p=p*2.02+vec3(7.9,12.1,4.7);a*=.5;}return v;}
mat2 rot(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
float ridge(float x){return 1.-abs(2.*x-1.);}
float line(float x,float w){return 1.-smoothstep(0.,max(.0001,w),abs(x));}
float starfield(vec2 p){ vec2 cell=floor(p), f=fract(p)-.5;float h=hash21(cell);vec2 c=hash22(cell)-.5;
 return step(.988,h)*pow(sat(1.-length(f-c)*8.),2.);}
vec3 palette(float t){return mix(uColorA,uColorB,sat(t));}
vec2 screenUV(vec2 uv){return (uv-.5)*vec2(uAspect,1.)*2.;}
