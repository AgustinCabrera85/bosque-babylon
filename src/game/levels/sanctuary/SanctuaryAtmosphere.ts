import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";

/** Layered red gaseous sky. Screen-friendly noise rather than expensive volumetric raymarching. */
export function createSanctuaryAtmosphere(scene: Scene, mobile: boolean, intensity = 1) {
  Effect.ShadersStore.sanctuarySmokeVertexShader = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    varying vec2 vUV;
    void main(void){ vUV=uv; gl_Position=worldViewProjection*vec4(position,1.0); }
  `;
  Effect.ShadersStore.sanctuarySmokeFragmentShader = `
    precision highp float;
    varying vec2 vUV;
    uniform float time;
    uniform float alphaScale;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){
      vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
                 mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
    }
    void main(void){
      vec2 p=vec2(vUV.x*5.,vUV.y*2.4);
      p.x += sin(p.y*1.8 + time*.025)*.24;
      p.y -= time*.016;
      float n=noise(p)*.53 + noise(p*2.15+4.2)*.31 + noise(p*4.4-1.7)*.16;
      float shape=smoothstep(.31,.73,n);
      float edge=smoothstep(0.,.22,vUV.y) * smoothstep(0.,.24,1.-vUV.y);
      edge*=smoothstep(0.,.12,vUV.x)*smoothstep(0.,.12,1.-vUV.x);
      float a=shape*edge*.29*alphaScale;
      vec3 red=mix(vec3(.21,.028,.039),vec3(.68,.097,.087),shape);
      gl_FragColor=vec4(red,a);
    }
  `;
  const material = new ShaderMaterial("sanctuarySmokySky", scene, "sanctuarySmoke", {
    attributes: ["position", "uv"],
    uniforms: ["worldViewProjection", "time", "alphaScale"],
    needAlphaBlending: true,
  });
  material.backFaceCulling = false;
  material.setFloat("time", 0);
  material.setFloat("alphaScale", intensity);
  const planes = mobile ? 2 : 4;
  for (let i = 0; i < planes; i++) {
    const mesh = MeshBuilder.CreatePlane(`crimsonSmokeSheet_${i}`, {
      width: 1700 + i*580,
      height: 800 + i*310,
      sideOrientation: 2,
    }, scene);
    mesh.position.set((i%2?1:-1)*90, 260+i*170, 110+i*390);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.applyFog = false;
    mesh.rotation.y = (i%2?-.05:.05);
  }
  return { update(time: number) { material.setFloat("time",time); } };
}
