// v0.6: front-to-back ray-integrated 3D density for infernal smoke.
// Geometry is still a translucent portal plane, but the smoke is sampled as
// an actual volumetric density along a ray (not a stock Babylon smoke texture).
vec4 renderEffect(vec2 uv){
 vec2 p=(uv-.5)*2.0;
 float t=uTime*uSpeed;
 float warp=fbm3(vec3(p*2.0,t*.18));
 float aperture=length(vec2(p.x*1.09,(p.y+.10)*.79));
 float rim=.85+.075*(warp-.5);
 float portal=1.-smoothstep(rim-.11,rim+.06,aperture);
 float smokeColumn=0.;
 float accumulated=0.;
 vec3 rgb=vec3(0.);
 float transmittance=1.0;
 float jitter=hash21(floor(uv*vec2(500.,330.)))*.75;
 // 24 samples are independent layers of a 3D, time-varying density field.
 // Bright sources below illuminate smoke lobes through simplified scattering.
 for(int i=0;i<24;i++){
   float dz=(float(i)+.48+jitter*.26)/24.;
   float z=mix(-1.25,1.4,dz);
   vec3 pos=vec3(p*.92,z);
   pos.y-=t*.22 + .11*sin(pos.x*2.8+t*.4);
   pos.x+=.23*sin(pos.y*2.6+z*.75+t*.28);
   float large=fbm3(pos*2.15+vec3(7.,-3.,0.));
   float small=noise3(pos*5.2+vec3(1.,5.,t*.22));
   float density=sat((large-.32)*2.8+(small-.5)*.45);
   float puff=sat(1.-abs(p.x-(large-.5)*.5)/(.72-.17*dz));
   float vertical=smoothstep(-1.,-.55,p.y)*(1.-smoothstep(.72,1.22,p.y));
   float volume=density*puff*vertical;
   float sampleAlpha=sat(volume*.23*(.62+.35*uIntensity));
   float heat=sat((large-.44)*2.+(.28-p.y)*.43+(small-.5)*.72);
   // A moving fire source back-lights the soot and creates warm internal folds.
   float combustion=pow(heat,3.)*sat((.55-p.y)*1.65)*(1.-dz*.58);
   float scatter=.13+.45*heat+.19*small;
   vec3 sooty=vec3(.022,.014,.022)+uColorA*.18*scatter;
   vec3 ember=mix(uColorA,uColorB,sat(combustion*.86));
   vec3 lightColor=mix(sooty,ember*1.35,combustion);
   rgb+=transmittance*sampleAlpha*lightColor;
   transmittance*=1.-sampleAlpha;
   accumulated+=volume/24.;
 }
 smokeColumn=sat(accumulated*1.4);
 // Turbulent fire flashes on the lower edge and inside the aperture.
 float flameNoise=fbm3(vec3(p*6.1+vec2(0.,-t*.75),t*.20));
 float emberBurst=sat((flameNoise-.47)*3.)*smoothstep(-.95,-.12,p.y)*(1.-smoothstep(.03,.72,p.y));
 float edgelight=exp(-pow((aperture-rim)*8.,2.));
 vec3 flame=mix(uColorA,uColorB,sat(flameNoise*1.4));
 rgb+=flame*emberBurst*.77*uIntensity*portal;
 rgb+=uColorB*edgelight*.19*(.4+flameNoise)*uIntensity;
 float alpha=portal*(1.-transmittance)+emberBurst*.32*portal+edgelight*.19;
 // Allow stray wisps beyond the edge, without making a rectangular quad visible.
 float wisps=smokeColumn*.11*exp(-pow((aperture-.90)*3.5,2.));
 rgb+=uColorA*wisps*.12;
 alpha=sat(alpha+wisps);
 return vec4(max(rgb,vec3(0.)),alpha);
}
