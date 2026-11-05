precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform float uTime;
uniform float uSpin;
uniform float uTurbulence;
uniform float uSpeed;
uniform float uLayer;
varying vec2 vUV;
varying float vTwirl;
void main() {
  vec3 p = position;
  float t = uv.x;
  float f = pow(max(0.0, sin(t*3.14159265)), 1.45);
  float phase = uTime*uSpeed*0.7 + t*19.0 + uv.y*12.566;
  float spiral = t*5.3 + uTime*uSpin*1.7 + 0.35*sin(t*21.0-uTime);
  mat2 spin = mat2(cos(spiral), -sin(spiral), sin(spiral), cos(spiral));
  p.yz = spin * p.yz;
  p.y += (sin(phase*0.67+uLayer)*0.07 + sin(phase*2.25)*0.024)*uTurbulence*f;
  p.z += (cos(phase*0.59-uLayer)*0.07 + cos(phase*1.81)*0.028)*uTurbulence*f;
  vUV = uv;
  vTwirl = spiral;
  gl_Position = worldViewProjection * vec4(p,1.0);
}
