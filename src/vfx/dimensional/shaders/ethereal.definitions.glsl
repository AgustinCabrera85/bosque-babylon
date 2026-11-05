float fxHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float fxNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(fxHash(i), fxHash(i+vec3(1.0,0.0,0.0)),f.x),
                 mix(fxHash(i+vec3(0.0,1.0,0.0)),fxHash(i+vec3(1.0,1.0,0.0)),f.x),f.y),
             mix(mix(fxHash(i+vec3(0.0,0.0,1.0)),fxHash(i+vec3(1.0,0.0,1.0)),f.x),
                 mix(fxHash(i+vec3(0.0,1.0,1.0)),fxHash(i+vec3(1.0,1.0,1.0)),f.x),f.y),f.z);
}
float fxFbm(vec3 p) {
  float n = 0.0;
  n += 0.5*fxNoise(p);
  n += 0.25*fxNoise(p*2.03);
  n += 0.125*fxNoise(p*4.07);
  n += 0.0625*fxNoise(p*8.11);
  return n / 0.9375;
}

