// ADVANCING DARKNESS — controlled, living black cloud (v0.13)
// Unlike the legacy shader, the cloud's center never drifts with elapsed time.
// uDarkCenter.xy: screen-relative [0,1], lower-left origin.
// uDarkRadius: fraction of viewport height (0.05–1.35).
// uDarkOpen: continuous temporal envelope, 0 (closed) to 1 (fully open).
// uDarkSoftness: diffuse edge; uDarkWobble: irregular border and breathing.
vec4 renderEffect(vec2 uv){
 vec2 p=screenUV(uv);
 vec2 anchor=(uDarkCenter-0.5)*vec2(uAspect,1.0)*2.0;
 float tm=uTime*uSpeed;
 vec2 q=p-anchor;
 // Bounded organic motion: time changes density and silhouette, not its center.
 q+=vec2(sin(tm*.28)*.065,cos(tm*.23)*.075)*uDarkWobble;
 float coarse=fbm3(vec3(q*1.4*uScale,tm*.14));
 float fold=fbm3(vec3(q*3.5*uScale+vec2(4.,-7.),-tm*.22));
 vec2 warp=vec2(coarse-.5,fold-.5)*(.18+.48*uDarkWobble);
 float wisps=fbm3(vec3((q+warp)*6.8+vec2(-4.,6.),tm*.32));
 float foldFine=fbm3(vec3((q+warp)*10.5,tm*.26));
 float open=clamp(uDarkOpen,0.0,1.0);
 float radius=max(.00001,uDarkRadius*2.0*open);
 float rimVariation=(.65*(coarse-.5)+.31*(fold-.5)+.18*(wisps-.5))*radius*uDarkWobble;
 float shape=length((q+warp*.43)*vec2(.85,1.12));
 float signedEdge=shape-radius-rimVariation;
 float softness=max(.012,uDarkSoftness*.23);
 float reveal=smoothstep(.0,.045,open);
 float black=(1.0-smoothstep(-softness,softness,signedEdge))*reveal;
 float veins=pow(clamp(.5+.5*sin(q.x*21.+q.y*13.+fold*13.+tm*.8),0.,1.),12.);
 veins*=smoothstep(.43,.68,foldFine)*(.25+.75*exp(-abs(signedEdge)*3.4));
 vec3 field=mix(uColorA*.48,uColorB*.13,coarse);
 field+=uColorB*pow(clamp(wisps,0.,1.),5.)*.18;
 vec3 abyss=vec3(.0003,.0002,.0011)+uColorB*veins*.12;
 vec3 col=mix(field,abyss,clamp(black*uIntensity,0.,1.));
 float edgeGlow=exp(-pow(signedEdge/max(.025,softness*.72),2.0))*reveal;
 col+=uColorB*edgeGlow*(.08+.20*fold)+uColorB*veins*black*.09;
 return vec4(max(col,vec3(0.0)),1.0);
}
