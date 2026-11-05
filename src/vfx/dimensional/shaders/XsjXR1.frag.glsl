// v0.7 — Enrolled, intertwined organic ribbons with electric impulses that
// run along the filament rather than flashing across the entire screen.
// Stylized 2.5D approximation, NOT Shadertoy source or physical 3D geometry.
vec2 filamentPath(float u, float id, float t){
 float phase=id*2.39996323;
 float direction=phase+1.4*sin(id*1.31);
 vec2 axis=vec2(cos(direction),sin(direction));
 vec2 normal=vec2(-axis.y,axis.x);
 float cluster=floor(id/3.0);
 vec2 center=vec2((cluster-1.0)*.40+.12*sin(id*3.4),
                  -.17+.28*sin(id*2.7));
 float twist=6.283185*(2.1+.7*hash21(vec2(id,1.)))*u+phase+t*.17;
 float env=pow(sin(3.141593*u),.7);
 float coil=env*(.19*sin(twist)+.063*sin(twist*2.1-id));
 float lengthwise=(u-.5)*(1.95+.4*hash21(vec2(id,3.)));
 vec2 pos=center+axis*lengthwise+normal*coil;
 pos+=normal*.07*env*sin(t*.53+id+u*8.8);
 return pos;
}
vec4 renderEffect(vec2 uv){
 vec2 p=screenUV(uv);float t=uTime*uSpeed;
 float nearest=20., width=.05, localU=0., filamentId=0., localSide=0.;
 float glow=0.;
 for(int i=0;i<9;i++){
  float id=float(i);
  for(int k=0;k<36;k++){
   float a=float(k)/36.,b=float(k+1)/36.;
   vec2 x=filamentPath(a,id,t),y=filamentPath(b,id,t);
   vec2 tang=y-x;float h=clamp(dot(p-x,tang)/max(.00001,dot(tang,tang)),0.,1.);
   float u=mix(a,b,h);vec2 d=p-mix(x,y,h);
   float taper=smoothstep(.0,.045,u)*(1.-smoothstep(.965,1.,u));
   float w=(.060+.015*sin(id*1.9)+.010*sin(u*29.+id))*taper;
   w=max(.003,w);
   float distanceToSurface=length(d)-w;
   // Two nonuniform electrical wavefronts propagate FROM TAIL TO HEAD.
   float e1=fract(t*.42+id*.173);float e2=fract(t*.28+id*.397+.31);
   float pulse=exp(-pow((u-e1)/.033,2.)) + .7*exp(-pow((u-e2)/.048,2.));
   float halo=exp(-max(0.,distanceToSurface)*27.)*pulse;
   // Glow is applied after selecting the nearest strand; do not flood the frame.
   glow=max(glow,exp(-max(0.,distanceToSurface)*13.)*.06);
   if(distanceToSurface<nearest){
    nearest=distanceToSurface;width=w;localU=u;filamentId=id;
    localSide=dot(normalize(d+vec2(.0001)),normalize(vec2(-tang.y,tang.x)));
   }
  }
 }
 float body=1.-smoothstep(-.006,.010,nearest);
 float profile=sqrt(max(0.,1.-pow(sat((nearest+width)/max(.001,width)),2.)));
 float ribs=.5+.5*sin(localU*103.+filamentId*1.7+t*.45);
 float creases=pow(ribs,8.);
 float skin=fbm3(vec3(localU*12.,filamentId*.67,t*.13));
 vec3 flesh=mix(vec3(.092,.029,.047),uColorA*.7,.20+.48*profile);
 flesh+=uColorB*(.12+.33*profile)*(.45+.55*skin);
 flesh*=.64+.29*creases+.38*profile;
 // The discharge is a travelling, jagged line INSIDE each enrolled ribbon.
 float front1=fract(t*.42+filamentId*.173),front2=fract(t*.28+filamentId*.397+.31);
 float current=exp(-pow((localU-front1)/.029,2.))+.7*exp(-pow((localU-front2)/.044,2.));
 float zig=sin(localU*147.+sin(localU*41.+filamentId)*3.+t*2.)*.38;
 float arc=exp(-pow((localSide-zig)/.29,2.))*current;
 vec3 electricity=vec3(.53,.83,1.)*(.7+uIntensity*.75);
 vec3 bg=vec3(.005,.004,.010)+uColorA*fbm3(vec3(p*1.4,t*.07))*.032;
 vec3 col=bg+flesh*body*uIntensity*.82;
 col+=electricity*arc*body*1.8;
 col+=electricity*current*exp(-max(0.,nearest)*28.)*.30+uColorB*glow*.5;
 col+=electricity*current*body*.31;
 return vec4(max(col,vec3(0.)),1.);
}
