  vec3 fxP = vPositionW * fxNoiseScale;
  float fxT = fxTime * fxSpeed;
  fxP += vec3(sin(fxP.y*0.75+fxT),cos(fxP.z*0.8-fxT*0.8),sin(fxP.x*0.7+fxT*0.6))*0.28;
  float fxN = fxFbm(fxP + vec3(fxT*0.31, fxT*0.19, -fxT*0.27));
  float fxCut = fxDissolve * 1.025 - 0.01;
  if (fxDissolve > 0.001 && fxN < fxCut) { discard; }
  float fxEdge = 1.0 - smoothstep(0.0, max(0.007,fxEdgeWidth), fxN-fxCut);
  float fxRidge = pow(1.0-abs(sin((fxP.x + fxP.y*0.7 - fxP.z*0.41 + fxN*2.8)*fxStripes + fxTime*fxShimmer)), 10.0);
  float fxLattice = pow(1.0-abs(sin((fxP.x-fxP.y+fxN)*fxStripes*0.55-fxTime*fxShimmer*0.4)), 18.0);
  float fxSpark = pow(fxNoise(fxP*4.2 + fxTime*0.7), 10.0);
  float fxPulse = 0.65 + 0.35*sin(fxTime*(1.9+fxShimmer)+fxN*12.0);
  float fxMix = clamp(fxEnergy, 0.0, 1.0);
  vec3 fxTint = mix(fxColorA, fxColorB, clamp(fxN*1.4 + 0.15*sin(fxTime*0.4+fxP.x),0.0,1.0));
  float fxFilaments = clamp(fxRidge*0.6 + fxLattice*0.4 + fxSpark*0.45, 0.0, 1.0);
  vec3 fxRadiance = fxTint * ((fxEdge*fxEdgeGlow*1.4) + (fxFilaments*fxPulse*fxEdgeGlow*0.7));
  finalColor.rgb = mix(finalColor.rgb, finalColor.rgb*0.24 + fxTint*0.45, fxMix*0.65);
  finalColor.rgb += fxRadiance * fxMix;

