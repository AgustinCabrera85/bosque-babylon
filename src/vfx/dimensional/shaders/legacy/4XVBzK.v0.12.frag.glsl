// v0.6: a living, near-absolute-black cloud whose ragged front invades a scene.
// Light veins are suspended within and around the cloud, not radial spokes.
vec4 renderEffect(vec2 uv){
 vec2 p=screenUV(uv);float t=uTime*uSpeed;
 vec2 wind=vec2(.14*t,-.065*t);
 vec2 q=p+wind;
 float coarse=fbm3(vec3(q*1.35*uScale,t*.15));
 float fold=fbm3(vec3(q*3.4*uScale+vec2(4.,-7.),-t*.23));
 vec2 warp=vec2(coarse-.5,fold-.5)*.52;
 q+=warp;
 float wisps=fbm3(vec3(q*6.8+vec2(-4.,6.),t*.30));
 float shape=length((q-vec2(.28*sin(t*.26),-.12*cos(t*.41)))*vec2(.85,1.12));
 float cloudBoundary=shape-.65*(coarse-.5)-.25*(fold-.5)-.16*(wisps-.5);
 float reach=mix(-.22,2.7,smoothstep(0.,1.,uProgress));
 float edge=smoothstep(reach-.18,reach+.20,cloudBoundary);
 float black=1.-edge;
 float tangle=fbm3(vec3((q+warp)*10.5,t*.26));
 float veins=pow(sat(.5+.5*sin(q.x*21.+q.y*13.+fold*13.+t*.8)),12.);
 veins*=smoothstep(.43,.68,tangle)*(.33+.67*(1.-abs(cloudBoundary-reach)));
 vec3 field=mix(uColorA*.48,uColorB*.13,coarse);
 field+=uColorB*(pow(sat(wisps),5.)*.18);
 vec3 abyss=vec3(.0003,.0002,.0011)+uColorB*veins*.12;
 vec3 col=mix(field,abyss,sat(black*uIntensity));
 float illuminated=exp(-pow((cloudBoundary-reach)/.17,2.));
 col+=uColorB*illuminated*(.08+.20*fold)+uColorB*veins*black*.09;
 return vec4(max(col,vec3(0.)),1.);
}
