// Architectural gallery study: columns, vaulted ceiling and dark reflecting water.
// A 3D raymarched environment (NOT the old radial abstract spiral).
float galleryBox(vec3 p, vec3 b) {
  vec3 d=abs(p)-b;
  return length(max(d,vec3(0.0)))+min(max(d.x,max(d.y,d.z)),0.0);
}
vec2 galleryMap(vec3 p) {
  vec2 h=vec2(70.,0.);
  // Reflecting flooded floor / stone ceiling / actual side walls.
  float d=p.y;
  if(d<h.x)h=vec2(d,1.);
  d=4.05-p.y;if(d<h.x)h=vec2(d,2.);
  d=4.25-abs(p.x);if(d<h.x)h=vec2(d,3.);
  // Repeating real columns, capitals and heavy beams.
  float z=mod(p.z+1.55,3.35)-1.55;
  float x=abs(p.x)-2.85;
  d=max(length(vec2(x,z))-.215,abs(p.y-1.78)-1.61);
  if(d<h.x)h=vec2(d,4.);
  d=galleryBox(vec3(x,p.y-.33,z),vec3(.39,.31,.4));
  if(d<h.x)h=vec2(d,5.);
  d=galleryBox(vec3(x,p.y-3.48,z),vec3(.48,.24,.45));
  if(d<h.x)h=vec2(d,5.);
  // Rectangular wall arches and roof crossbeams.
  d=galleryBox(vec3(p.x,p.y-3.82,z),vec3(4.12,.14,.22));
  if(d<h.x)h=vec2(d,6.);
  // Recessed panels on the far walls increase architectural depth.
  d=galleryBox(vec3(abs(p.x)-4.03,p.y-1.95,z),vec3(.12,1.18,.63));
  if(d<h.x)h=vec2(d,7.);
  return h;
}
vec2 galleryTrace(vec3 ro,vec3 rd,float maxT){
  float t=.03;vec2 hit=vec2(maxT,0.);
  for(int i=0;i<74;i++){
    vec2 h=galleryMap(ro+rd*t);
    if(h.x<.003){hit=vec2(t,h.y);break;}
    t+=clamp(h.x*.77,.012,.87);
    if(t>maxT)break;
  }
  return hit;
}
vec3 galleryNormal(vec3 p){
  float e=.015;
  return normalize(vec3(
   galleryMap(p+vec3(e,0.,0.)).x-galleryMap(p-vec3(e,0.,0.)).x,
   galleryMap(p+vec3(0.,e,0.)).x-galleryMap(p-vec3(0.,e,0.)).x,
   galleryMap(p+vec3(0.,0.,e)).x-galleryMap(p-vec3(0.,0.,e)).x));
}
vec3 galleryShade(vec3 p, vec3 normal, float material) {
  float light=sat(dot(normal,normalize(vec3(-.55,.8,-.4))))*.42+.46;
  float lightBands=.42+.58*exp(-abs(mod(p.z+1.5,3.35)-1.5)*.5);
  vec3 marble=vec3(.81,.79,.76)+uColorB*.12;
  marble*=.90+.12*fbm(p.xz*.7+vec2(p.y*.16));
  vec3 trim=vec3(.53,.48,.46)+uColorB*.12;
  vec3 col=material<3.5?marble:material<4.5?marble:material<6.5?trim:marble*.72;
  if(material<1.5)col=uColorA*.2;
  if(material<2.5 && material>1.5)col=marble*.48;
  float rim=pow(1.-sat(dot(normal,normalize(vec3(.2,.4,-1.)))),4.);
  col=col*(light*lightBands)+uColorA*rim*.12;
  col*=.86+.14*sin(p.z*.7+p.x*.18);
  return col;
}
vec4 renderEffect(vec2 uv){
  vec2 p=screenUV(uv);float t=uTime*uSpeed*.24;
  // Slowly move into the gallery. The image is actual corridor perspective.
  vec3 ro=vec3(.06*sin(t*.35),1.55,t*1.7);
  vec3 rd=normalize(vec3(p.x*.92,p.y*.79,1.30));
  vec2 hit=galleryTrace(ro,rd,65.);
  vec3 deep=vec3(.032,.018,.022)+uColorA*.10;
  vec3 col=deep;
  if(hit.y>.5){
    vec3 pos=ro+rd*hit.x;
    if(hit.y<1.5){
      // Floor reflection uses a second actual scene trace, modulated by ripples.
      float ripple=fbm(pos.xz*vec2(2.3,1.15)+vec2(t*.3,t*.16));
      vec3 reflDir=normalize(reflect(rd,vec3(0.,1.,0.))+vec3((ripple-.5)*.043,0.,(ripple-.5)*.027));
      vec2 mirror=galleryTrace(pos+vec3(0.,.045,0.),reflDir,42.);
      vec3 reflected=deep;
      if(mirror.y>1.5){
        vec3 rp=pos+vec3(0.,.045,0.)+reflDir*mirror.x;
        reflected=galleryShade(rp,galleryNormal(rp),mirror.y);
        reflected=mix(reflected,deep,sat(mirror.x/48.));
      }
      float bands=sin(pos.z*4.6+t*1.2+noise(pos.xz*3.)*3.);
      vec3 water=vec3(.035,.014,.023)+uColorA*.30;
      col=mix(water,reflected,clamp(.45+.1*bands,0.,.7))*uIntensity;
      col+=uColorA*(.11+.13*pow(max(0.,bands),12.));
    }else{
      vec3 n=galleryNormal(pos);
      col=galleryShade(pos,n,hit.y);
      col=mix(col,deep,sat(hit.x/60.));
      if(hit.y>3.5 && hit.y<6.5)col+=uColorB*.10;
    }
  }
  // Slight sanctuary-red atmospheric distance haze; no spiral / radial spokes.
  float fog=exp(-hit.x*.06);
  col=mix(deep+uColorA*.07,col,clamp(fog*.88+.12,0.,1.));
  float vign=1.-.30*smoothstep(.45,2.,length(p));
  return vec4(pow(max(col*vign,vec3(0.)),vec3(.88)),1.);
}
