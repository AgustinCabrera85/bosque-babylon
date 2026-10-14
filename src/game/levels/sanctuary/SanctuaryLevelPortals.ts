import "@babylonjs/loaders/glTF";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../utils/asset";
import type { SanctuaryStop } from "./SanctuaryLayout";

const VERTEX = `
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

const FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorld;
uniform float uTime;
uniform float uFogDensity;
uniform vec3 uFogColor;
uniform vec3 uCameraPosition;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main(void) {
  vec2 p = (vUV - vec2(0.5, 0.53)) * vec2(1.0, 2.5);
  float radius = length(p);
  float angle = atan(p.y, p.x);
  float smoke = noise2(p * 6.0 + vec2(uTime * 0.065, -uTime * 0.045));
  float folds = noise2(p * 15.0 - vec2(uTime * 0.12, uTime * 0.08));
  float warpedRadius = radius + (smoke - 0.5) * 0.055 + (folds - 0.5) * 0.015;
  float spiral = sin(warpedRadius * 49.0 - angle * 3.3 - uTime * 0.82);
  float counterSpiral = sin(warpedRadius * 31.0 + angle * 4.8 + uTime * 0.46);
  float rings = pow(max(spiral, 0.0), 12.0) * 0.72
    + pow(max(counterSpiral, 0.0), 18.0) * 0.28;
  rings *= smoothstep(0.055, 0.19, radius) * (1.0 - smoothstep(0.63, 0.86, radius));
  float core = exp(-radius * radius * 68.0);
  float haze = smoothstep(0.27, 0.78, smoke * 0.68 + folds * 0.32);
  float edge = min(min(vUV.x, 1.0 - vUV.x), min(vUV.y, 1.0 - vUV.y));
  float rim = 1.0 - smoothstep(0.0, 0.042, edge);

  vec3 color = vec3(0.006, 0.001, 0.003);
  color += vec3(0.12, 0.006, 0.015) * haze * (1.0 - core * 0.7);
  color += vec3(0.49, 0.024, 0.035) * rings * (0.45 + 0.55 * smoke);
  color += vec3(0.72, 0.055, 0.042) * core;
  color += vec3(0.22, 0.012, 0.018) * rim * (0.55 + smoke * 0.45);
  float fog = 1.0 - exp(-pow(distance(vWorld, uCameraPosition) * uFogDensity, 2.0));
  gl_FragColor = vec4(mix(color, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
}
`;

// Measured against the opening in the supplied GLB. The stone overlaps this
// surface slightly so the vortex stays inside the irregular masonry outline.
const APERTURE: readonly [number, number, number][] = [
  [0.012, -0.105, 0.125],
  [0.18, -0.11, 0.13],
  [0.35, -0.135, 0.15],
  [0.52, -0.15, 0.17],
  [0.68, -0.165, 0.18],
  [0.777, -0.18, 0.18],
];

function createVortexSurface(scene: Scene, name: string, parent: TransformNode) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  APERTURE.forEach(([y, left, right], row) => {
    positions.push(left, y, 0, right, y, 0);
    const v = (y - APERTURE[0][0]) / (APERTURE[APERTURE.length - 1][0] - APERTURE[0][0]);
    uvs.push(0, v, 1, v);
    if (row === 0) return;
    const a = (row - 1) * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  });
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.parent = parent;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  return mesh;
}

/** Scenery only. Level activation and transitions are deliberately separate. */
export async function createSanctuaryLevelPortals(scene: Scene, stops: readonly SanctuaryStop[]) {
  const container = await SceneLoader.LoadAssetContainerAsync(
    asset("assets/models/sanctuary/"), "Portal_generico_1.glb", scene);
  if (scene.isDisposed) {
    container.dispose();
    throw new Error("The sanctuary closed while loading its portal arches.");
  }
  container.addAllToScene();
  const source = container.rootNodes[0];
  if (!(source instanceof TransformNode)) throw new Error("The sanctuary portal has no root transform.");
  for (const material of container.materials) {
    if (!(material instanceof PBRMaterial)) continue;
    material.albedoColor = new Color3(0.13, 0.11, 0.12);
    material.emissiveColor = new Color3(0, 0, 0);
    material.metallic = 0;
    material.roughness = 1;
    material.specularIntensity = 0.05;
    material.environmentIntensity = 0.05;
  }

  const vortexMaterials: ShaderMaterial[] = [];
  stops.forEach((stop, index) => {
    const root = new TransformNode(`${stop.id}_levelPortal`, scene);
    root.position.set(stop.x + stop.side * 49, 2.05, stop.z + 8);
    root.rotation.y = -stop.side * Math.PI / 2;
    root.scaling.setAll(18);
    const arch = index === 0 ? source : source.clone(`${stop.id}_stoneArch`, root);
    if (!arch) throw new Error(`Could not clone the ${stop.id} portal arch.`);
    arch.parent = root;
    for (const mesh of arch.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.checkCollisions = false;
    }
    const vortex = createVortexSurface(scene, `${stop.id}_crimsonVortex`, root);
    const material = new ShaderMaterial(`${stop.id}_crimsonVortexMaterial`, scene,
      { vertexSource: VERTEX, fragmentSource: FRAGMENT },
      { attributes: ["position", "uv"], uniforms: ["world", "worldViewProjection", "uTime",
        "uFogDensity", "uFogColor", "uCameraPosition"] });
    material.backFaceCulling = false;
    material.setFloat("uFogDensity", scene.fogDensity);
    material.setColor3("uFogColor", scene.fogColor);
    vortex.material = material;
    vortexMaterials.push(material);
  });

  return {
    update(elapsed: number) {
      const camera = scene.activeCamera?.globalPosition ?? Vector3.Zero();
      vortexMaterials.forEach((material, index) => {
        material.setFloat("uTime", elapsed + index * 1.7);
        material.setVector3("uCameraPosition", camera);
      });
    },
  };
}
