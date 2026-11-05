// Full-scene perception displacement + RGB fringing; requires textureSampler
vec4 renderEffect(vec2 uv){
 float t=uTime*uSpeed;vec2 p=uv-.5;
 float radial=length(p);float n=fbm(uv*8.*uScale+vec2(t*.15,t*.12));
 vec2 shift=(uv-.5)*(.03+.018*sin(t*2.7+radial*25.))*(n-.32)*uIntensity;
 shift+=vec2(sin(uv.y*47.+t*2.3),cos(uv.x*28.-t))*uIntensity*.0045;
 float split=.006*uIntensity;
 vec2 v=clamp(uv+shift,.002,.998);
 float r=texture2D(textureSampler,clamp(v+vec2(split,0.),0.,1.)).r;
 float g=texture2D(textureSampler,v).g;
 float b=texture2D(textureSampler,clamp(v-vec2(split,0.),0.,1.)).b;
 vec3 col=vec3(r,g,b);
 col=mix(col,vec3(dot(col,vec3(.3,.59,.11))),uProgress*.45);
 col*=1.-.4*smoothstep(.23,.8,radial);
 col+=uColorB*pow(max(0.,sin(uv.y*330.+t*12.)),24.)*.015*uIntensity;
 return vec4(col,1.);
}
