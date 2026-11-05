// Procedural turbulent flame sheet; use as masked emissive plane in a scene
vec4 renderEffect(vec2 uv){
 vec2 p=(uv-vec2(.5,.0))*vec2(uAspect,1.);float t=uTime*uSpeed;
 float rise=uv.y, spread=.12+.27*(1.-rise);
 float n=fbm(vec2(p.x*5.6*uScale+sin(rise*7.+t)*.17, rise*3.2-t*.88));
 float jet=1.-smoothstep(spread*.4,spread*1.6,abs(p.x+(.5-n)*.26));
 float tips=1.-smoothstep(.53,.98,rise+.24*n+.10*sin(p.x*18.-t*2.));
 float flick=sin(uv.y*35.-t*7.+n*8.)*.055;
 float mask=sat(jet*tips*(.7+n+flick));
 float hot=sat(1.-rise*1.4-abs(p.x)*2.);
 vec3 fire=mix(uColorA,uColorB,sat(hot+.15*n));
 fire=mix(vec3(.06,.005,.008),fire,mask);
 fire+=vec3(1.,.7,.18)*pow(hot,4.)*mask*uIntensity;
 float sparks=step(.988,noise(p*75.+vec2(0.,t*3.)))*step(.32,rise);
 fire+=uColorB*sparks*.55*uIntensity;
 return vec4(fire,sat(mask*.98+sparks*.5));
}
