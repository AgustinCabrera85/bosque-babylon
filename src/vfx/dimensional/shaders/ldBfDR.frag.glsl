// Self-contained lava globe with emissive fissures, dark crust and atmosphere
vec4 renderEffect(vec2 uv){
 vec2 p=screenUV(uv);p*=1.18;float t=uTime*uSpeed*.18;
 float r=length(p);float disk=sat((.72-r)*110.);
 vec3 col=vec3(.013,.003,.009)+vec3(.3,.08,.07)*exp(-abs(r-.78)*23.)*.16;
 col+=starfield(p*56.)*.18;
 if(r<.73){
   vec3 n=vec3(p/.73,sqrt(max(0.,1.-dot(p,p)/(.73*.73))));
   vec3 pos=n*uScale*3.+vec3(t*.72,t*.2,0.);
   float f=fbm3(pos*1.75);float fiss=1.-smoothstep(.035,.15,abs(f-.46));
   fiss*=pow(fbm3(pos*3.1+.5),1.4);
   float light=sat(dot(n,normalize(vec3(-.45,.6,.9))))*.65+.16;
   vec3 crust=mix(vec3(.045,.018,.024),uColorA*.23,fbm3(pos*2.3));
   vec3 lava=mix(uColorA,uColorB,fiss)* (1.1+3.4*fiss*uIntensity);
   col=mix(col,crust*light+lava*pow(fiss,2.7),disk);
   col+=uColorB*pow(1.-n.z,4.)*uIntensity*.85;
 }
 return vec4(col,1.);
}
