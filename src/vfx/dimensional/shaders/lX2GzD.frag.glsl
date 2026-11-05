// v1.0 — Rina / Synthwave Horizon. Original Babylon.js reconstruction,
// composed around the supplied 16:9 visual reference rather than the old
// circular sun + bare grid approximation. UV is authored for a 16:9 panel.
// Colors: uColorA = neon ground; uColorB = cyan mountain wires.
// Sun palette remains independent: uSunTopColor, uSunBottomColor, uSunHaloColor.
// Procedural low-poly ridge triangulation and atmospheric bloom; no textures.

float rinaSegment(vec2 p, vec2 a, vec2 b) {
  vec2 q = b-a;
  float h = clamp(dot(p-a,q)/max(dot(q,q),0.000001),0.,1.);
  return length(p-a-h*q);
}

// Consistent discrete vertices make the mountain silhouette genuinely angular.
float rinaRidge(float k, float layer, float hz){
  float nodes=mix(26.,20.,layer);
  float x=(k-layer*.42)/nodes;
  float fromCenter=abs(x-.5)*2.;
  float sides=smoothstep(.12,.78,fromCenter);
  float peak=hash21(vec2(k*1.73+layer*13.37,8.21));
  float broader=.55+.25*sin(k*.91+layer*.7)+.2*sin(k*1.81+2.3);
  float ridgeHeight=(.014+(.070+.075*peak)*sides*max(.26,broader))*mix(1.,.67,layer);
  return hz+ridgeHeight;
}

// Pixel-width wireframe lines. The area fill preserves the occlusion of the
// terrain without giving it a solid, unbroken 2D silhouette.
vec3 rinaMountain(vec2 uv, float hz, float layer, vec3 base){
  float n=mix(26.,20.,layer);
  float f=uv.x*n+layer*.42;
  float cell=floor(f);
  float local=fract(f);
  float x0=(cell-layer*.42)/n, x1=(cell+1.-layer*.42)/n;
  float top0=rinaRidge(cell,layer,hz);
  float top1=rinaRidge(cell+1.,layer,hz);
  float m0=mix(hz,top0,.27+.25*hash21(vec2(cell,layer+20.)));
  float m1=mix(hz,top1,.27+.25*hash21(vec2(cell+1.,layer+20.)));
  vec2 a=vec2(x0,top0), b=vec2(x1,top1);
  // The middle-row vertices are offset so the mesh forms irregular facets,
  // not repeating rectangular fence posts.
  vec2 c=vec2(mix(x0,x1,.23),m0), d=vec2(mix(x0,x1,.80),m1);
  vec2 e=vec2(x0,hz), g=vec2(x1,hz);
  vec2 p=uv*vec2(uAspect,1.);
  a.x*=uAspect;b.x*=uAspect;c.x*=uAspect;d.x*=uAspect;e.x*=uAspect;g.x*=uAspect;
  // 2D triangular mesh: crest, diagonal edges, midline and feet.
  float shortest=100.;
  shortest=min(shortest,rinaSegment(p,a,b));
  // Rare perpendicular edge; most facets remain oblique rather than a fence.
  shortest=min(shortest,rinaSegment(p,a,c))*.97;
  shortest=min(shortest,rinaSegment(p,b,d))*.97;
  shortest=min(shortest,rinaSegment(p,c,d));
  shortest=min(shortest,rinaSegment(p,a,d));
  shortest=min(shortest,rinaSegment(p,c,g));
  // Keep low-poly facets, with diagonals and horizontal cross-links.
  
  shortest=min(shortest,rinaSegment(p,e,g));
  float aa=max(.0007,1.0/max(360.,uResolution.y)*.46);
  float fine=1.-smoothstep(.0011,.0011+aa,shortest);
  float glow=exp(-shortest*110.);
  float crest=mix(top0,top1,local);
  float inside=smoothstep(hz-.005,hz+.002,uv.y)*(1.-smoothstep(crest-.004,crest+.003,uv.y));
  vec3 shaded=vec3(.0015,.021,.064)+uColorB*.011;
  base=mix(base,shaded,inside*.98);
  float brightness=mix(1.0,.68,layer);
  base+=uColorB*(fine*.94+glow*.42)*brightness;
  return base;
}

vec4 renderEffect(vec2 uv){
  float t=uTime*uSpeed;
  const float horizon=.433;
  const float sunY=.517;
  const float radius=.226;
  vec2 sunP=(uv-vec2(.5,sunY))*vec2(uAspect,1.);
  float r=length(sunP);
  float sdf=r-radius;

  // Reference palette: blue-night upper sky, magenta/purple near the sun.
  float nearHorizon=1.-smoothstep(horizon+.02,.94,uv.y);
  vec3 color=mix(vec3(.0005,.055,.225),vec3(.009,.044,.163),nearHorizon);
  float sunsetFog=exp(-pow((uv.y-horizon-.075)/.225,2.));
  float centralFog=exp(-pow((uv.x-.5)/.46,2.));
  color+=vec3(.100,.005,.170)*sunsetFog*centralFog;
  float sunBloom=exp(-pow(r/.275,1.85));
  color+=uSunHaloColor*(.33*sunBloom+.028*exp(-pow(r/.50,2.2)))*uSunGlow;
  color+=uColorA*.14*exp(-pow((uv.y-horizon)/.09,2.));

  // Vintage banded neon sunset: a warm cream disc with magenta cut-outs.
  float exposed=1.-smoothstep(-.001,.002,sdf);
  exposed*=smoothstep(horizon-.001,horizon+.003,uv.y);
  float grad=sat((sunY+radius-uv.y)/(2.*radius));
  vec3 sunFill=mix(uSunTopColor,uSunBottomColor,pow(grad,1.2));
  float bands=0.;
  for(int i=0;i<11;i++){
    float idx=float(i);
    float lineY=horizon+.018+idx*.0200;
    float width=mix(.0096,.0013,idx/10.);
    float d=abs(uv.y-lineY);
    bands=max(bands,1.-smoothstep(width,width+.0017,d));
  }
  color=mix(color,sunFill*(.85+.09*uIntensity),exposed);
  // Bands retain the hot-magenta luminosity seen in the target artwork.
  color=mix(color,uSunHaloColor*(.70+.12*uIntensity),exposed*bands*.92);
  // A bright thin upper arc is optional but defaults more subtle than v0.9.
  float rimW=max(.001,.0044*uSunRimWidth);
  float rim=exp(-pow(sdf/rimW,2.));
  float outer=exp(-pow(max(sdf,0.)/max(.005,.057*uSunGlowRadius),1.46));
  float rimVisible=smoothstep(horizon-.003,horizon+.006,uv.y);
  float exterior=smoothstep(-.003,.009,sdf);
  color+=uSunHaloColor*(rim*.31+outer*exterior*.32)*uSunGlow*rimVisible;

  // The reference has two cyan polygonal mountain ranges on both flanks.
  // The back range is smaller and dimmer; lines are triangles, not noise.
  if(uv.y>horizon-.005){
    color=rinaMountain(uv,horizon+.003,1.,color);
    color=rinaMountain(uv,horizon,0.,color);
  }
  color+=uColorA*.60*exp(-pow((uv.y-horizon)/.006,2.));

  // A receding, forward-moving magenta floor grid, stationary at the horizon.
  if(uv.y<horizon){
    float d=horizon-uv.y;
    float depth=max(.012,d);
    vec3 floorColor=mix(vec3(.008,.018,.105),vec3(.038,.009,.157),sat(1.-d/.55));
    float worldX=(uv.x-.5)*1.92/depth;
    float worldZ=.92/depth;
    // Antialias grid lines in *screen space*: reciprocal depth can become
    // arbitrarily dense at the horizon, so bare sin() produces dotted noise.
    float xSpan=.012+min(.22,1.92/(depth*max(360.,uResolution.x))*.60);
    float zSpan=.026+min(.29,.92/(depth*depth*max(270.,uResolution.y))*.60);
    float nearX=abs(fract(worldX+.5)-.5);
    float nearZ=abs(fract(worldZ+t*.50*uGridSpeed+.5)-.5);
    float xLine=1.-smoothstep(.002,min(.49,xSpan),nearX);
    float zLine=1.-smoothstep(.002,min(.49,zSpan),nearZ);
    // Thin lines forward, a continuous neon haze where cells become subpixel.
    float fade=.21+.79*smoothstep(.012,.12,d);
    float wire=max(xLine*.86,zLine);
    floorColor+=uColorA*(wire*(.59+.24*uIntensity)+pow(wire,2.)*.21)*fade;
    float horizonGridGlow=exp(-d*29.);
    floorColor+=uColorA*.25*horizonGridGlow;
    floorColor+=vec3(.025,.009,.086)*exp(-d*8.);
    // The reference primarily has reflected atmosphere, not repeated discs.
    float xToSun=abs((uv.x-.5)*uAspect);
    float reflection=exp(-pow(xToSun/(.19+.26*d),2.))
      *exp(-d*14.)*(.68+.16*sin(d*114.+t*2.9));
    floorColor+=mix(uSunTopColor,uSunHaloColor,.68)*reflection*.42*uReflection;
    floorColor+=uSunHaloColor*exp(-d*76.)*.30*uSunGlow*uReflection;
    color=floorColor;
  }
  color*=1.-.10*sat(length((uv-.5)*vec2(uAspect*.7,1.)));
  return vec4(max(color,vec3(0.)),1.);
}
