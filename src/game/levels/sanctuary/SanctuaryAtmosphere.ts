import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { SANCTUARY_ASCENT as ASCENT, SANCTUARY_CONFIG as CFG } from "./SanctuaryLayout";

// The level owns its EXP2 fog. A small additive adjustment retains nearby
// readability while letting distant masonry fade into the procedural sky.
const FOG_DENSITY_BOOST = {
  desktop: 0.000055,
  mobile: 0.000015,
  maximum: 0.00078,
} as const;

const MIST_SHADER = "sanctuarySurfaceMistV1";

const MIST_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec2 vUV;
varying vec3 vWorld;
void main(void) {
  vUV = uv;
  vWorld = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const MIST_FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorld;
uniform float uTime;
uniform float uDensity;
uniform vec3 uCameraPosition;
uniform vec3 uTint;
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), f.x),
    mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), f.x), f.y);
}
void main(void) {
  vec2 p = vWorld.xz * 0.018;
  vec2 drift = vec2(uTime * 0.031, -uTime * 0.019);
  float broad = noise2(p * 0.48 + drift);
  float detail = noise2(p * 1.15 - drift * 0.63 + broad * 0.42);
  float wisps = smoothstep(0.30, 0.72, broad * 0.63 + detail * 0.37);
  float edge = smoothstep(0.0, 0.13, vUV.x) * (1.0-smoothstep(0.87, 1.0, vUV.x))
    * smoothstep(0.0, 0.13, vUV.y) * (1.0-smoothstep(0.87, 1.0, vUV.y));
  float range = length(uCameraPosition.xz - vWorld.xz);
  float distanceFade = smoothstep(65.0, 260.0, range)
    * (1.0-smoothstep(2400.0, 3300.0, range));
  float portalLane = 1.0 - 0.32 * (1.0-smoothstep(95.0, 270.0, abs(vWorld.x)))
    * smoothstep(1250.0, 1700.0, vWorld.z);
  float alpha = uDensity * wisps * edge * distanceFade * portalLane;
  if (alpha < 0.008) discard;
  vec3 color = mix(uTint * 0.62, uTint * 1.20, broad * 0.7 + detail * 0.3);
  gl_FragColor = vec4(color, alpha);
}
`;

/** Thin, animated crimson mist immediately above the river, plus stable distance fog. */
export function createSanctuaryAtmosphere(scene: Scene, mobile: boolean, intensity = 1) {
  const strength = Math.max(0, Math.min(1, intensity));
  if (scene.fogMode === Scene.FOGMODE_EXP2 && strength > 0) {
    const boost = mobile ? FOG_DENSITY_BOOST.mobile : FOG_DENSITY_BOOST.desktop;
    scene.fogDensity = Math.min(FOG_DENSITY_BOOST.maximum, scene.fogDensity + boost * strength);
  }

  Effect.ShadersStore[`${MIST_SHADER}VertexShader`] = MIST_VERTEX;
  Effect.ShadersStore[`${MIST_SHADER}FragmentShader`] = MIST_FRAGMENT;
  const materials: ShaderMaterial[] = [];
  const tint = new Color3(.24, .046, .055);
  const makeMist = (name: string, density: number) => {
    const material = new ShaderMaterial(name, scene, MIST_SHADER, {
      attributes: ["position", "uv"],
      uniforms: ["world", "worldViewProjection", "uTime", "uDensity", "uCameraPosition", "uTint"],
      needAlphaBlending: true,
    });
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.setFloat("uTime", 0);
    material.setFloat("uDensity", density * (.75 + .25 * strength));
    material.setVector3("uCameraPosition", Vector3.Zero());
    material.setColor3("uTint", tint);
    materials.push(material);
    return material;
  };
  const general = makeMist("sanctuarySurfaceMistGeneral", .28);
  const wall = makeMist("sanctuarySurfaceMistWall", .34);
  const impact = mobile ? null : makeMist("sanctuarySurfaceMistImpact", .26);
  const sheet = (name: string, width: number, depth: number,
    x: number, z: number, height: number, material: ShaderMaterial) => {
    const mesh = MeshBuilder.CreateGround(name, { width, height: depth, subdivisions: 1 }, scene);
    mesh.position.set(x, CFG.riverY + height, z);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
  };
  sheet("sanctuaryMistRiver", 1350, 1900, 0, 410, .78, general);
  sheet("sanctuaryMistWall", 1750, 1040, 0, 1715, .92, wall);
  if (impact) {
    const fallZ = ASCENT.stairEndZ - 14 - 32;
    sheet("sanctuaryMistFallLeft", 310, 240, -560, fallZ, 1.02, impact);
    sheet("sanctuaryMistFallRight", 310, 240, 560, fallZ, 1.02, impact);
  }

  return {
    update(timeSeconds: number) {
      const cameraPosition = scene.activeCamera?.globalPosition ?? Vector3.Zero();
      for (const material of materials) {
        material.setFloat("uTime", timeSeconds);
        material.setVector3("uCameraPosition", cameraPosition);
      }
    },
  };
}
