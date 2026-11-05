precision highp float;
varying vec2 vUV;
varying float vTwirl;
uniform float uTime;
uniform float uSpeed;
uniform float uSpin;
uniform float uTurbulence;
uniform float uOpacity;
uniform float uFilaments;
uniform float uRingDensity;
uniform float uIntensity;
uniform float uLayer;
uniform vec3 uColorA;
uniform vec3 uColorB;
float hash(vec3 p) { p=fract(p*0.1031);p+=dot(p,p.yxz+33.33);return fract((p.x+p.y)*p.z); }
float noise3(vec3 p) {
 vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
void main(){
  float u=vUV.x, v=vUV.y;
  float time=uTime*uSpeed;
  float theta=v*6.28318 + u*6.5 + time*uSpin*0.32 + uLayer;
  float flow=u*uRingDensity*6.28318 - time*2.6;
  float n=noise3(vec3(cos(theta)*2.3, sin(theta)*2.3, u*9.0-time*0.45));
  float ripple=sin(flow + sin(theta*3.0 + time)*uTurbulence*1.5 + n*4.0);
  float rings=pow(max(0.0,ripple),11.0);
  float silk=sin(theta*uFilaments + u*24.0 - time*1.3 + n*uTurbulence*5.0);
  float silkLines=pow(max(0.0,silk),9.0);
  float other=pow(max(0.0,sin(theta*(uFilaments*0.5)+u*17.0+time*1.3)),15.0);
  float particles=pow(n,13.0)*0.7;
  float energy=(rings*1.25 + silkLines*0.9 + other*0.45 + particles+ 0.12)*uIntensity;
  float pulse=0.7+0.3*sin(time*1.7+u*9.0);
  energy*=pulse;
  vec3 rgb=mix(uColorA,uColorB,clamp(0.22+0.55*n + 0.24*sin(theta*0.45 + time*0.2),0.0,1.0));
  rgb*= (0.4+energy*1.9);
  float gate=smoothstep(0.0,0.085,u)*(1.0-smoothstep(0.91,1.0,u));
  float alpha=clamp(uOpacity*(0.10+energy*0.44)*gate,0.0,0.92);
  gl_FragColor=vec4(rgb,alpha);
}
