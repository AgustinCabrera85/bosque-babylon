// Red mountainous silhouettes and atmospheric layers in a procedural sky
float mountain(vec2 p){float h=fbm(vec2(p.x*1.3,p.y*.6));return h;}
vec4 renderEffect(vec2 uv){
 vec2 p=screenUV(uv);float t=uTime*uSpeed*.06;
 float sky=sat(uv.y);vec3 col=mix(uColorA*.13+vec3(.018,.002,.012),uColorB*.33,sky);
 float fog=fbm(p*vec2(2.,4.)+vec2(t,0.));
 col+=uColorA*fog*.13;
 vec2 sunP=p-vec2(.42,.29);float sun=exp(-length(sunP)*14.);
 col+=uColorB*sun*.66;
 for(int i=0;i<5;i++){
  float fi=float(i);float z=fi/4.;
  float x=p.x*(1.3+z*.3)+t*(.12+z*.04);
  float height= -.13 + .20*z + (fbm(vec2(x*(.65+z)*uScale,fi*2.1))-.5)*(.24+.27*z);
  height+=.05*sin(x*5.6+fi*1.2);
  float edge=1.-smoothstep(height-.005,height+.009,p.y);
  vec3 layer=mix(uColorA*.12,uColorA*.75+uColorB*.12,z);
  col=mix(col,layer,edge);
 }
 col+=vec3(.07,.01,.015)*pow(1.-sat(uv.y*1.4),4.)*.55;
 return vec4(col,1.);
}
