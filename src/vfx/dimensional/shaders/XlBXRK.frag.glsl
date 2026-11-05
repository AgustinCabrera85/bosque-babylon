// v0.7 — Filmic impact: displacement + transient radial motion blur +
// restrained chromatic dispersion. No neon circles, bright cartoon cracks.
// Designed as a screen-space PostProcess over the Babylon scene.
vec4 renderEffect(vec2 uv){
 float phase=sat(uProgress);
 vec2 p=(uv-.5)*vec2(uAspect,1.);
 float r=length(p),t=uTime*uSpeed;
 float impulse=exp(-phase*12.0);
 float shockRadius=.035+phase*.92;
 float shock=exp(-pow((r-shockRadius)/(.035+.04*phase),2.))
            *(1.-smoothstep(.60,1.,phase));
 float fractured=(smoothstep(.055,.15,phase)-smoothstep(.24,.42,phase))*.3;
 float grain=fbm(p*31.+vec2(12.1,-6.8));
 float irregular=(grain-.5)*.56;
 vec2 radial=normalize(p+vec2(.0001));
 float displacement= uIntensity*(impulse*.009*exp(-r*3.2)
                        +shock*(.012+irregular*.003));
 vec2 jitter=vec2(sin(t*29.1),cos(t*37.7))*.0028*impulse*uIntensity;
 vec2 baseUV=clamp(uv+radial*displacement+jitter,.001,.999);
 // Short exposure-style motion blur: streaks are sampled from the REAL scene.
 vec3 blurred=vec3(0.);
 float blurRadius=(.007*impulse+.004*shock)*uIntensity;
 for(int i=-2;i<=2;i++){
  float fi=float(i);
  vec2 sampleUV=clamp(baseUV+radial*blurRadius*fi*.5,.001,.999);
  blurred+=texture2D(textureSampler,sampleUV).rgb;
 }
 blurred*=.2;
 float dispersion=uIntensity*(.0022*impulse+.0012*shock);
 vec3 separated=vec3(texture2D(textureSampler,clamp(baseUV+radial*dispersion,.001,.999)).r,
                     texture2D(textureSampler,baseUV).g,
                     texture2D(textureSampler,clamp(baseUV-radial*dispersion,.001,.999)).b);
 vec3 col=mix(separated,blurred,sat(impulse*.55+shock*.26));
 float deSat=.22*impulse+.07*fractured;
 col=mix(col,vec3(dot(col,vec3(.299,.587,.114))),deSat);
 float vignette=smoothstep(.91,.15,length(p*vec2(.91,1.05)));
 col*=1.-(.32*impulse+.10*shock)*(1.-vignette);
 // Brief exposure flicker, not a colored outline or glowing ripple.
 col+=vec3(.09,.085,.08)*impulse*uIntensity;
 return vec4(max(col,vec3(0.)),1.);
}
