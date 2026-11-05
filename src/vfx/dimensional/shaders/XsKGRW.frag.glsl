// Sampled radial post blur; composition preserves 3D geometry and HUD DOM
vec4 renderEffect(vec2 uv){
 vec2 center=vec2(.5+.16*(uProgress-.5),.5);
 vec2 p=uv-center;float amount=.23*uIntensity;
 vec4 accum=vec4(0.);float sum=0.;
 for(int i=0;i<17;i++){
  float f=float(i)/16.;float w=1.-f*.6;
  vec2 sampleUV=clamp(uv-p*(f*f)*amount,.002,.998);
  accum+=texture2D(textureSampler,sampleUV)*w;sum+=w;
 }
 vec4 col=accum/max(1.,sum);
 col.rgb=mix(col.rgb,mix(uColorA,uColorB,.65)*dot(col.rgb,vec3(.25,.5,.25)),uProgress*.11*uIntensity);
 return vec4(col.rgb,1.);
}
