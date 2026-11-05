// v0.7 — overlapping organic ignitions and inside-out burnout.
// Every emitter has its own life cycle; new fiery lobes appear while older
// lobes hollow out and fall to sooty smoke. Continuous after start; no exact
// fluid/napalm simulation and no original Shadertoy code used.
vec4 renderEffect(vec2 uv){
 vec2 p=screenUV(uv);
 float t=uTime*uSpeed;
 vec3 col=vec3(.007,.004,.007);
 float smokeTotal=0.;
 for(int j=0;j<5;j++){
  float id=float(j);
  float age=fract(uProgress*1.0+id*.208);
  float born=smoothstep(.0,.095,age);
  float fading=1.-smoothstep(.78,1.,age);
  float size=.21+.72*age;
  vec2 center=vec2((id-2.)*.22+.16*sin(id*3.1),-.38+.41*age);
  vec2 q=p-center;
  // Different curl fields for each ignition: fronts are not repeated circles.
  vec3 field=vec3(q*2.65,age*1.6+t*.15+id*6.7);
  float large=fbm3(field);
  float curled=fbm3(field*1.9+vec3(3.1,-4.7,2.9));
  float small=noise3(field*4.1+vec3(7.,-2.,t*.12));
  vec2 warp=q+vec2(large-.5,curled-.5)*(.19+.26*age);
  float radial=length(warp*vec2(.89,1.10));
  float ragged=radial+.19*(large-.5)+.095*(small-.5);
  float outer=1.-smoothstep(size-.095,size+.072,ragged);
  // Inner edge advances OUTWARDS after ignition, consuming the fire volume.
  float charRadius=size*(.03+.47*smoothstep(.32,.92,age));
  float inner=smoothstep(charRadius-.07,charRadius+.085,ragged);
  float fire=outer*inner*born*fading;
  float residual=outer*(1.-inner)*born*(1.-smoothstep(.66,.98,age))
                  *(.20+.45*curled);
  float hotShell=fire*pow(sat(.4+.69*small+.48*(curled-.5)),2.1);
  float ash=outer*(1.-inner)*smoothstep(.23,.9,age)*born;
  float smoke=outer*smoothstep(.23,.58,age)*(1.-smoothstep(.87,1.,age))
              *(.27+.67*large)*(.38+.43*curled);
  float sparks=pow(sat((small-.70)*4.5),5.)*fire;
  vec3 emberColor=mix(vec3(.34,.025,.015),uColorA,.54+.29*curled);
  vec3 flaming=emberColor*fire*(.78+.66*curled)*uIntensity;
  flaming+=uColorB*(hotShell*.90+sparks*.66)*uIntensity;
  float smokeCover=sat(smoke*.36+ash*.52);
  col=col*(1.-smokeCover*.35)+flaming;
  col+=uColorA*residual*(.22+.38*small)*uIntensity;
  col=mix(col,col*.75+vec3(.020,.013,.014)*large,ash*.30);
  smokeTotal=max(smokeTotal,smoke);
 }
 // Warm depth haze survives while neighboring events begin.
 float glow=exp(-dot((p+vec2(0.,.29))*vec2(.7,1.3),
                     (p+vec2(0.,.29))*vec2(.7,1.3))*2.2);
 col+=uColorA*glow*.09*uIntensity;
 col+=vec3(.025,.018,.019)*smokeTotal;
 return vec4(max(col,vec3(0.)),1.);
}
