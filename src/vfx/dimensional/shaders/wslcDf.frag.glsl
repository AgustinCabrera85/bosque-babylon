// v0.6: continuously morphing symmetric ink, not a still Rorschach texture.
// The effect is an abstract artistic stimulus, not a clinical Rorschach test.
vec4 renderEffect(vec2 uv){
 vec2 p=screenUV(uv);p.x=abs(p.x);
 float t=uTime*uSpeed;
 float inhale=.5+.5*sin(t*.43);
 float drift=sin(t*.37)*.075;
 float n1=fbm3(vec3(p*2.8*uScale,t*.19));
 float n2=fbm3(vec3(p*5.3*uScale+vec2(7.,-4.),-t*.23));
 // Bilateral domain warp; every layer grows, splits and rejoins at its own speed.
 vec2 q=p+vec2((n1-.5)*.21,(n2-.5)*.16);
 q.x*=1.+.12*sin(t*.67+p.y*5.);
 q.y+=drift+.07*sin(t*.39+q.x*6.);
 float petals=exp(-pow((q.x-(.28+.10*cos(q.y*4.6+t*.42)))/(.13+.10*n1+.025*inhale),2.));
 petals*=exp(-pow((q.y-(.08+.09*sin(t*.27)))/(.47+.13*n2),2.));
 float horns=exp(-pow((q.x-(.39+.08*sin(q.y*7.-t*.53)))/.085,2.));
 horns*=exp(-pow((q.y-.34-.06*sin(t*.56)) / (.17+.025*inhale),2.));
 float trunk=exp(-pow(q.x/(.048+.054*n1+.018*inhale),2.))*exp(-pow(q.y/.68,2.));
 float arms=pow(1.-sat(abs(sin(atan(q.y+.17,q.x-.13)*5.+n2*4.+t*.15))),5.);
 arms*=exp(-length(q-vec2(.30,.12))*3.7);
 float barbs=pow(.5+.5*sin(q.y*22.+q.x*13.+t*.72),7.);
 barbs*=exp(-pow((q.x-.66)/.14,2.))*exp(-pow(q.y/.7,2.));
 float droplets=0.;
 for(int k=0;k<8;k++){
  float f=float(k);float a=f*2.4;
  vec2 c=vec2(.12+.65*hash21(vec2(f,1.))+.06*sin(t*.21+a),
              (hash21(vec2(f,4.))-.5)*1.5+.08*cos(t*.29+a));
  float d=.015+.022*hash21(vec2(f,6.));
  droplets=max(droplets,1.-smoothstep(d,d+.026,length(q-c)));
 }
 float ink=trunk*.92+petals*(.43+.61*n2)+horns*.65+arms*.58+barbs*.25+droplets*.60;
 float grain=fbm3(vec3(q*13.+n1*3.,t*.12));
 float threshold=mix(.39,.55,.5+.5*sin(t*.18));
 ink=smoothstep(threshold-.12-.06*uProgress,threshold+.12,ink+grain*.21);
 vec3 paper=vec3(.89,.85,.76)+(noise(uv*500.)-.5)*.022;
 vec3 pigment=mix(uColorA*.31,uColorB*.30,sat(.6*n1+.4*n2));
 vec3 col=mix(paper,pigment,sat(ink*uIntensity));
 col*=.99-.05*length(p);
 return vec4(col,1.);
}
