// v0.12 | Optimized connected-nebula passage with anchored, timed dark aperture.
// The black opening is independent of cosmic cloud scroll: no drift on repeats.
// Controls: uVoidCenter (UV 0..1), uVoidRadius (fraction of image height),
// uVoidOpen (0..1), uVoidSoftness (edge), uVoidPhase (0..1 cyclic),
// uVoidWobble (organic outline). All controlled by Cosmic Void Lab.
// 12/20/28 samples. Older unmodified v0.10 remains in shaders/legacy/.
#ifndef DFX_COSMIC_STEPS
#define DFX_COSMIC_STEPS 20
#endif
vec4 renderEffect(vec2 uv){
 vec2 screen=screenUV(uv);
 vec2 center=(uVoidCenter-.5)*vec2(uAspect,1.)*2.0;
 vec2 relative=screen-center;
 float openness=sat(uVoidOpen);
 float rRelative=length(relative);
 float radiusUI=max(.025,uVoidRadius);
 float cycleAngle=6.28318530718*uVoidPhase;
 float t=uTime*uSpeed;
 // A stable camera axis: cyclic wobble, NO unbounded camera translation.
 vec3 ray=normalize(vec3(relative*(.86*.14/radiusUI),1.55));
 float jitter=.18*noise(uv*vec2(520.,290.));
 vec3 acc=vec3(0.0);
 float transmit=1.0;
 for(int k=0;k<DFX_COSMIC_STEPS;k++){
  float along=(float(k)+jitter)/float(DFX_COSMIC_STEPS);
  float z=.70+along*25.4;
  // Small depth variation gives the nebula texture without moving the hole.
  vec2 bend=.06*vec2(sin(z*.11),cos(z*.09));
  bend+=.018*openness*vec2(sin(cycleAngle),sin(cycleAngle*2.0));
  vec2 crossSection=ray.xy*(z/max(.3,ray.z))-bend;
  float radius=length(crossSection);
  if(radius>5.80 || (radius<.62 && openness>.99))continue;
  vec3 field=vec3(crossSection*1.25,z*.53-t*2.9)*max(.4,uScale);
  vec3 warp=field+vec3(sin(field.y*.74+field.z*.49),
                       cos(field.x*.61-field.z*.39),
                       sin(field.x*.37+field.y*.43))*.35;
  float n1=noise3(warp*.69);
  float n2=noise3(warp*1.49+vec3(0.,4.1,2.3));
  float fine=.5+.5*sin(warp.x*2.5+sin(warp.y*1.8+warp.z*2.1));
  // When aperture is closed, cloud density fills the center organically.
  float inner=mix(-.55,1.64+.53*(n1-.5)+.25*(n2-.5),openness);
  float shell=smoothstep(inner-.25,inner+.68,radius)
              *(1.-smoothstep(inner+1.25,inner+2.9,radius));
  float body=smoothstep(.26,.68,n1*.72+n2*.25+fine*.15);
  float detail=smoothstep(.43,.67,n2*.64+fine*.35);
  float density=shell*sat(body*.91+detail*.31);
  float alpha=sat(density*uIntensity*.27);
  if(alpha<.003)continue;
  float cool=sat(n1*.78+n2*.55+.15*sin(warp.z*.35));
  float hot=sat(n2*.75+fine*.23+.09*cos(warp.y*.56));
  vec3 violet=mix(vec3(.09,.045,.29),uColorA*.92+vec3(.23,.07,.20),.55);
  vec3 blue=mix(vec3(.09,.25,.77),uColorB+vec3(0.,.06,.10),.49);
  vec3 col=mix(violet,blue,smoothstep(.32,.72,cool));
  col=mix(col,vec3(.94,.17,.63),smoothstep(.53,.83,hot)*.83);
  col=mix(col,vec3(.07,.78,.98),smoothstep(.61,.92,cool)*.60);
  col+=vec3(1.,.39,.16)*pow(smoothstep(.73,.98,hot),2.)*.75;
  col*=.52+1.7*pow(sat((n2-.35)*2.),2.);
  acc+=col*alpha*transmit;
  transmit*=1.-alpha;
  if(transmit<.025)break;
 }
 vec3 bg=vec3(.0015,.0025,.010);
 bg+=vec3(.65,.79,1.)*starfield(screen*vec2(50.,29.)+vec2(t*.16,-t*.13))*.10;
 vec3 result=acc+bg*transmit;
 // The black opening is screen-anchored and its size is set relative to HEIGHT.
 // Integer angular harmonics avoid atan seam at +/-PI.
 float angle=atan(relative.y,relative.x);
 float organic=(.065*sin(7.0*angle+cycleAngle)+.04*sin(11.0*angle-2.0*cycleAngle))*uVoidWobble;
 float voidRadius=2.0*radiusUI*openness*(1.0+organic);
 float feather=max(.008,voidRadius*uVoidSoftness*.65);
 float d=rRelative;
 float voidMask=(1.0-smoothstep(max(0.0,voidRadius-feather),voidRadius+feather,d))*openness;
 // Close to black, not a colored translucent overlay.
 result=mix(result,vec3(.00015,.00010,.00040),voidMask);
 float ring=(1.0-smoothstep(0.0,max(.014,feather*2.8),abs(d-voidRadius)))*openness;
 result+=ring*vec3(.09,.12,.23)*uIntensity*.34;
 result*=1.-.14*smoothstep(.9,1.85,length(screen));
 return vec4(max(result,vec3(0.)),1.);
}
