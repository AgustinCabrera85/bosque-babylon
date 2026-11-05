// Claustrophobic projected corridor: architectural impression, not walkable scene
vec4 renderEffect(vec2 uv){
 vec2 p=screenUV(uv);float t=uTime*uSpeed*.45;
 p.x+=.012*sin(p.y*26.+t*3.)*uIntensity;
 float d=1./(max(.06,max(abs(p.x)*.83,abs(p.y)*1.55))+.07);
 float a=atan(p.y,p.x);vec2 coord=vec2(a,d*1.35-t);
 float seams=pow(abs(sin(coord.y*PI*1.4)),38.);
 float stones=fbm3(vec3(cos(a)*2.2,sin(a)*2.2,d*1.35-t)*uScale);
 float walls=pow(1.-sat(abs(p.y)*.4),.6);
 vec3 col=mix(uColorA*.15,uColorA*.65,stones);
 col*=.4+.6*walls;
 col+=uColorB*seams*.33*uIntensity;
 float lamp=exp(-abs(p.x)*10.)*pow(.5+.5*cos(d*2.7-t*2.),20.);
 col+=vec3(1.,.25,.14)*lamp*uIntensity*2.;
 col*=.65+.35*sin(t*1.3+stones*4.)*sin(t*1.3+stones*4.);
 float vign=1.-.56*sat(dot(p,p)*.49);
 return vec4(col*vign,1.);
}
