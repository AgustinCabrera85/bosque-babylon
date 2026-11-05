// v0.8 — UV-space branching that starts thin and widens as it colonizes a GLB.
// Independent controls: width, repetition/density and infection spread.
// UV islands remain discontinuous; production continuity needs mesh-aware data.
float growDistance(vec2 p,vec2 a,vec2 b,out float h){
 vec2 edge=b-a;
 h=clamp(dot(p-a,edge)/max(.00001,dot(edge,edge)),0.,1.);
 return length(p-(a+h*edge));
}
vec4 renderEffect(vec2 uv){
 float t=uTime*uSpeed;
 float patternFreq=max(.28,uScale)*max(.35,uBranchDensity)*1.65;
 vec2 p=fract(uv*patternFreq)*2.-1.;
 float branch=0.,tip=0.,infection=0.;
 for(int root=0;root<4;root++){
  float f=float(root);
  vec2 seed=vec2(-.82+1.64*hash21(vec2(f,2.)),
                 -.82+1.64*hash21(vec2(6.,f)));
  float startAngle=6.283185*hash21(vec2(f,13.));
  for(int n=1;n<32;n++){
   float idx=float(n);
   float depth=floor(log2(idx));
   float bits=idx-exp2(depth);
   vec2 origin=seed;
   float angle=startAngle;
   float segLength=.64;
   vec2 end=origin;
   for(int level=0;level<5;level++){
    if(float(level)>depth)break;
    if(level>0){
     float side=mod(floor(bits/exp2(depth-float(level))),2.);
     angle+=mix(-1.,1.,side)*(.40+.25*hash21(vec2(idx,float(level)+f)));
    }
    end=origin+segLength*vec2(cos(angle),sin(angle));
    if(float(level)<depth){origin=end;segLength*=.73;}
   }
   float h=0.;
   float distanceToBranch=growDistance(p,origin,end,h);
   float stage=uProgress*5.-depth;
   float revealed=sat(stage);
   float along=1.-smoothstep(revealed-.07,revealed+.045,h);
   float branchActive=smoothstep(-.04,.14,stage);
   // A new branch starts as a very fine capillary and thickens with age.
   float age=smoothstep(.03,.98,stage-h*.30);
   float radius=(.040*pow(.77,depth)+.0045)*uBranchWidth
                  *(.25+.75*age)*(.87+.13*sin(idx*1.74+t*.46));
   float body=(1.-smoothstep(radius*.65,radius*1.55,distanceToBranch))
                 *along*branchActive;
   branch=max(branch,body);
   // Infected areas expand progressively from ALREADY visible branches.
   float spreadTime=smoothstep(.12,.95,stage-h*.6);
   float spreadRadius=(.010+.28*spreadTime)*uGrowthSpread;
   float spread=(1.-smoothstep(spreadRadius*.34,spreadRadius,
                              distanceToBranch))*along*branchActive;
   infection=max(infection,spread);
   float growingTip=exp(-pow((h-revealed)/.075,2.))
                    *branchActive*(1.-step(.99,revealed));
   tip=max(tip,growingTip*exp(-distanceToBranch*29.));
  }
 }
 float organic=fbm(p*10.+vec2(t*.07,-t*.11));
 float revealedGlow=branch*(.66+.33*organic);
 // Broad coverage is delayed; final frame still coats all UV islands.
 float finish=smoothstep(.82,1.,uProgress);
 float cover=max(infection,finish);
 float speckles=pow(max(0.,noise(p*85.+vec2(t*.17,-t*.09))-.68),4.)*tip*7.;
 vec3 col=uColorA*cover*(.17+.43*organic);
 col+=uColorA*revealedGlow*.6+uColorB*revealedGlow*(.34+.38*organic);
 col+=uColorB*tip*.83+uColorB*speckles*.16;
 return vec4(col*max(.01,uIntensity),1.);
}
