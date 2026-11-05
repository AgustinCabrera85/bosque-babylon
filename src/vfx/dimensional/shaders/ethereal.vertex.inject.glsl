#ifdef NORMAL
  vec3 fxNormalDirection = normalize(normalUpdated + vec3(0.0001));
#else
  vec3 fxNormalDirection = normalize(positionUpdated + vec3(0.0001));
#endif
  float fxPulse = sin(dot(positionUpdated, vec3(4.4, 3.1, 5.2)) * fxNoiseScale + fxTime * (1.2 + fxSpeed));
  fxPulse += 0.5 * sin(dot(positionUpdated, vec3(-8.1, 6.6, 2.9)) * fxNoiseScale - fxTime * 1.7);
  positionUpdated += fxNormalDirection * (fxPulse * fxWarp * 0.6);

