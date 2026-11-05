// v0.8 — Nebular passage, NOT a radial spiral. Independent Babylon/GLSL
// interpretation of a tunnel whose inner wall is made of connected clouds.
// Density is sampled in 3-D around an irregular cylindrical void; every
// cloud patch follows world coordinates and moves toward the camera.
vec4 renderEffect(vec2 uv){
 vec2 screen=screenUV(uv);
 float t=uTime*uSpeed;
 vec3 ray=normalize(vec3(screen*.86,1.55));
 vec3 result=vec3(.0015,.0025,.010);
 float opacity=0.;
 float marchJitter=hash21(floor(uv*vec2(1280.,720.)))*.35;
 // 38 slices of 3-D cloud density, back-to-front through a curved pipe.
 // No atan(), arm patterns, radial sin(), or concentric rings are involved.
 for(int k=37;k>=0;k--){
   float z=.6+(float(k)+marchJitter)*.64;
   vec2 bending=vec2(.22*sin(z*.11+t*.07),.19*cos(z*.09+t*.06));
   vec2 crossSection=ray.xy*(z/max(.3,ray.z))-bending;
   float radius=length(crossSection);
   vec3 field=vec3(crossSection*1.25,z*.53-t*2.9)*max(.4,uScale);
   // Coherent 3-D domains produce recognizable joined nebulae.
   vec3 warped=field+vec3(
      (noise3(field*.53+vec3(1.7,5.1,3.4))-.5)*.90,
      (noise3(field*.57+vec3(7.2,-1.1,5.3))-.5)*.83,
      (noise3(field*.46+vec3(0.7,8.5,-2.2))-.5)*1.10);
   float n1=fbm3(warped*.60);
   float n2=fbm3(warped*1.42+vec3(0.,5.,2.));
   float n3=noise3(warped*3.1+vec3(2.,-5.,3.));
   // Each cloud bulges into the passage, leaving a dark central aperture.
   float innerRadius=1.75+(.67*(n1-.48))+(.31*(n2-.5));
   float cloudBand=smoothstep(innerRadius-.22,innerRadius+.78,radius)
                   *(1.-smoothstep(innerRadius+1.3,innerRadius+3.2,radius));
   float billows=smoothstep(.35,.71,n1*.71+n2*.27+n3*.12);
   float wisps=smoothstep(.35,.58,n2*.75+n3*.25);
   float density=cloudBand*sat(billows*.86+wisps*.27);
   float sampleAlpha=clamp(density*.21*uIntensity,0.,.45);
   // Vary color spatially on cloud patches (not around the polar angle).
   float temperature=fbm3(warped*.35+vec3(13.,1.,0.));
   float cold=fbm3(warped*.44+vec3(-3.,9.,14.));
   float warm=fbm3(warped*.37+vec3(8.,-1.,4.));
   vec3 purple=mix(vec3(.10,.04,.34),uColorA*.9+vec3(.22,.04,.18),.48);
   vec3 blue=mix(vec3(.08,.30,.84),uColorB+vec3(0.,.04,.13),.43);
   vec3 cyan=vec3(.08,.82,.97);
   vec3 pink=vec3(.94,.16,.57);
   vec3 amber=vec3(.99,.39,.11);
   vec3 nebula=mix(purple,blue,smoothstep(.33,.64,cold));
   nebula=mix(nebula,pink,smoothstep(.43,.73,temperature)*.82);
   nebula=mix(nebula,cyan,smoothstep(.51,.75,cold)*.75);
   nebula+=amber*pow(smoothstep(.49,.77,warm),2.)*.80;
   // Internal faint threads emphasize cloud edges, not a spiral.
   float bright=pow(sat((n2-.42)*2.5),2.0);
   nebula*=.60+1.7*bright;
   result=mix(result,nebula,sampleAlpha);
   opacity=opacity+(1.-opacity)*sampleAlpha;
 }
 // Sparse stars in the distant center and gently vignetted corners.
 float aperture=(1.-smoothstep(.04,.35,length(screen)));
 float stars=starfield(screen*vec2(50.,29.)+vec2(t*.16,-t*.13));
 result+=vec3(.65,.79,1.)*stars*.16;
 result=mix(result,vec3(.003,.004,.017),aperture*.22);
 result*=1.-.15*smoothstep(.9,1.85,length(screen));
 return vec4(max(result,vec3(0.)),1.);
}
