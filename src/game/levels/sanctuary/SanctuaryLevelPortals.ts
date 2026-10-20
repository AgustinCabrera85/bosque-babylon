import "@babylonjs/loaders/glTF";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../utils/asset";
import type { SanctuaryStop } from "./SanctuaryLayout";
import { createSanctuaryForestPortal, FOREST_PORTAL_PANEL } from "./SanctuaryForestPortal";
import { createSanctuaryRinaPortalV2 } from "./SanctuaryRinaPortalV2";
import { SanctuaryPortalStoneContact } from "./SanctuaryPortalStoneContact";
import { PORTAL_STONE_BLOCKS } from "./SanctuaryPortalCollisions";

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

const VEIL_FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorld;
uniform float uTime;
uniform float uOpacity;
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
  float spin = uTime * 0.2;
  mat2 turn = mat2(cos(spin), -sin(spin), sin(spin), cos(spin));
  vec2 q = turn * p;
  float angle = atan(q.y, q.x);
  float broad = noise2(q * 5.0 + vec2(1.7, -2.3));
  float billows = noise2(q * 13.0 - vec2(uTime * 0.035, 0.0));
  float detail = noise2(q * 31.0 + vec2(2.8, uTime * 0.04));
  float warpedRadius = radius + (broad - 0.5) * 0.075 + (billows - 0.5) * 0.028;
  float spiral = warpedRadius * 31.0 - angle * 4.0;
  float cloudEdge = sin(spiral) + (billows - 0.5) * 1.45 + (detail - 0.5) * 0.7;
  float bank = smoothstep(-0.45, 0.5, cloudEdge);
  float scallops = smoothstep(0.28, 0.76, billows * 0.67 + detail * 0.33);
  float clouds = bank * (0.5 + scallops * 0.5);
  float rim = (1.0 - smoothstep(0.08, 0.42, abs(cloudEdge - 0.3)))
    * (0.38 + detail * 0.62);
  float inner = 1.0 - smoothstep(0.13, 0.9, radius);
  vec3 color = vec3(0.002, 0.004, 0.009);
  color += vec3(0.014, 0.021, 0.038) * broad;
  color += vec3(0.021, 0.029, 0.052) * clouds;
  color += vec3(0.027, 0.032, 0.055) * rim * clouds * inner;
  color += vec3(0.035, 0.028, 0.068) * exp(-radius * radius * 24.0);
  color += vec3(0.16, 0.13, 0.24) * exp(-radius * radius * 210.0);
  float fog = 1.0 - exp(-pow(distance(vWorld, uCameraPosition) * uFogDensity, 2.0));
  gl_FragColor = vec4(mix(color, uFogColor, clamp(fog * 0.55, 0.0, 1.0)), uOpacity);
}
`;

const PORTAL_EDGE_GLOW_FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform vec3 uTint;
uniform float uReveal;
uniform float uTime;
void main(void) {
  float edge = min(min(vUV.x, 1.0 - vUV.x),
    min(vUV.y, 1.0 - vUV.y));
  float softness = smoothstep(0.0, 0.012, edge)
    * (1.0 - smoothstep(0.018, 0.085, edge));
  float breath = 0.94 + 0.06 * sin(uTime * 1.1 + vUV.y * 9.0);
  gl_FragColor = vec4(uTint, uReveal * softness * breath * 0.12);
}
`;

const FLOOR_SPILL_FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform vec3 uTint;
uniform float uReveal;
uniform float uTime;

void main(void) {
  float across = abs(vUV.x * 2.0 - 1.0);
  float sides = 1.0 - smoothstep(0.72, 1.0, across);
  float lengthFade = 1.0 - smoothstep(0.75, 1.0, vUV.y);
  float center = 1.0 - smoothstep(0.0, 0.8, across);
  float ripple = 0.96 + 0.04 * sin(vUV.y * 19.0 - uTime * 0.65);
  float strength = uReveal * sides * lengthFade * ripple
    * (0.17 + center * 0.07) * (1.0 - vUV.y * 0.35);
  gl_FragColor = vec4(uTint, strength);
}
`;

const LIGHT_VOLUME_FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform vec3 uTint;
uniform float uReveal;
uniform float uDensity;
uniform float uTime;

void main(void) {
  float across = abs(vUV.x * 2.0 - 1.0);
  float sides = 1.0 - smoothstep(0.55, 1.0, across);
  float height = smoothstep(0.0, 0.13, vUV.y)
    * (1.0 - smoothstep(0.78, 1.0, vUV.y));
  float drift = 0.9 + 0.1 * sin(vUV.x * 11.0 + uTime * 0.25)
    * sin(vUV.y * 14.0 - uTime * 0.18);
  gl_FragColor = vec4(uTint, uReveal * uDensity * sides * height * drift);
}
`;

const LIGHT_VOLUME_SHELL_FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform vec3 uTint;
uniform float uReveal;
uniform float uTime;

void main(void) {
  float along = 1.0 - smoothstep(0.82, 1.0, vUV.x);
  float across = 1.0 - smoothstep(0.58, 1.0, abs(vUV.y * 2.0 - 1.0));
  float drift = 0.92 + 0.08 * sin(vUV.x * 13.0 - uTime * 0.28);
  gl_FragColor = vec4(uTint, uReveal * 0.025 * along * across * drift);
}
`;

const REVEAL_DISTANCE = 22;
const HIDE_DISTANCE = 25;
const REVEAL_DURATION = 1.8;
const HIDE_DURATION = 1.4;
// Shared bounds for the portal-sized rear face and the wider front face.
const BEAM_FLOOR_Y = 2.075;
const BEAM_NEAR_WIDTH = 4;
const BEAM_FAR_WIDTH = 21;
const BEAM_NEAR_TOP = 16.8;
const BEAM_FAR_TOP = 19.3;
const BEAM_LENGTH = 38;
const BEAM_NEAR_OFFSET = -0.4;

// All level portal surfaces use the successful forest fit against the common
// stone arch. Only the shader or scene content inside this rectangle changes.
const LEVEL_PORTAL_APERTURE: readonly [number, number, number][] = [
  [FOREST_PORTAL_PANEL.bottom, FOREST_PORTAL_PANEL.left, FOREST_PORTAL_PANEL.right],
  [FOREST_PORTAL_PANEL.top, FOREST_PORTAL_PANEL.left, FOREST_PORTAL_PANEL.right],
];

function createLevelPortalSurface(scene: Scene, name: string, parent: TransformNode) {
  const aperture = LEVEL_PORTAL_APERTURE;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  aperture.forEach(([y, left, right], row) => {
    positions.push(left, y, 0, right, y, 0);
    const v = (y - aperture[0][0]) / (aperture[aperture.length - 1][0] - aperture[0][0]);
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

function createLockedPlaceholder(scene: Scene, root: TransformNode, id: string) {
  const mesh = createLevelPortalSurface(scene, `${id}_lockedVeil`, root);
  mesh.position.z = 0.03;
  mesh.alphaIndex = 1001;
  const material = new ShaderMaterial(`${id}_lockedVeilMaterial`, scene,
    { vertexSource: VERTEX, fragmentSource: VEIL_FRAGMENT },
    { attributes: ["position", "uv"], uniforms: ["world", "worldViewProjection", "uTime",
      "uOpacity", "uFogDensity", "uFogColor", "uCameraPosition"], needAlphaBlending: true });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.setFloat("uFogDensity", scene.fogDensity);
  material.setColor3("uFogColor", scene.fogColor);
  material.setFloat("uOpacity", 1);
  mesh.material = material;
  return { mesh, material };
}

function createPortalEdgeGlow(scene: Scene, root: TransformNode, stop: SanctuaryStop) {
  const mesh = createLevelPortalSurface(scene, `${stop.id}_portalEdgeGlow`, root);
  mesh.position.z = -0.008;
  mesh.alphaIndex = 1000;
  mesh.isVisible = false;
  const material = new ShaderMaterial(`${stop.id}_portalEdgeGlowMaterial`, scene,
    { vertexSource: VERTEX, fragmentSource: PORTAL_EDGE_GLOW_FRAGMENT },
    { attributes: ["position", "uv"], uniforms: ["world", "worldViewProjection",
      "uTint", "uReveal", "uTime"], needAlphaBlending: true });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.fogEnabled = false;
  material.setColor3("uTint", stop.id === "libre-de-culpas"
    ? new Color3(0.84, 0.93, 1)
    : stop.id === "rina" ? new Color3(0.96, 0.88, 1)
      : new Color3(1, 0.91, 0.9));
  material.setFloat("uReveal", 0);
  material.setFloat("uTime", 0);
  mesh.material = material;
  return { mesh, material };
}

function beamSection(stop: SanctuaryStop, portalX: number, progress: number) {
  return {
    x: portalX - stop.side * (BEAM_NEAR_OFFSET
      + progress * (BEAM_LENGTH - BEAM_NEAR_OFFSET)),
    halfWidth: BEAM_NEAR_WIDTH + progress * (BEAM_FAR_WIDTH - BEAM_NEAR_WIDTH),
    top: BEAM_NEAR_TOP + progress * (BEAM_FAR_TOP - BEAM_NEAR_TOP),
  };
}

function createFloorSpill(scene: Scene, stop: SanctuaryStop, portalX: number) {
  const near = beamSection(stop, portalX, 0);
  const far = beamSection(stop, portalX, 1);
  const z = stop.z + 8;
  const mesh = new Mesh(`${stop.id}_portalFloorSpill`, scene);
  const data = new VertexData();
  data.positions = [
    near.x, BEAM_FLOOR_Y, z - near.halfWidth,
    near.x, BEAM_FLOOR_Y, z + near.halfWidth,
    far.x, BEAM_FLOOR_Y, z - far.halfWidth,
    far.x, BEAM_FLOOR_Y, z + far.halfWidth,
  ];
  data.uvs = [0, 0, 1, 0, 0, 1, 1, 1];
  data.indices = [0, 1, 2, 1, 3, 2];
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  mesh.alphaIndex = 1100;
  mesh.isVisible = false;
  const material = new ShaderMaterial(`${stop.id}_portalFloorSpillMaterial`, scene,
    { vertexSource: VERTEX, fragmentSource: FLOOR_SPILL_FRAGMENT },
    { attributes: ["position", "uv"], uniforms: ["world", "worldViewProjection",
      "uTint", "uReveal", "uTime"], needAlphaBlending: true });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.alphaMode = Constants.ALPHA_ADD;
  material.setColor3("uTint", stop.id === "libre-de-culpas"
    ? new Color3(0.32, 0.46, 0.8)
    : stop.id === "rina" ? new Color3(0.56, 0.26, 0.72)
      : new Color3(0.72, 0.23, 0.32));
  material.setFloat("uReveal", 0);
  mesh.material = material;
  return { mesh, material };
}

function createLightVolume(scene: Scene, stop: SanctuaryStop, portalX: number) {
  const slices: { mesh: Mesh; material: ShaderMaterial }[] = [];
  const z = stop.z + 8;
  const tint = stop.id === "libre-de-culpas"
    ? new Color3(0.28, 0.39, 0.67)
    : stop.id === "rina" ? new Color3(0.4, 0.2, 0.55)
      : new Color3(0.54, 0.19, 0.26);
  for (let i = 0; i < 7; i++) {
    const progress = i / 6;
    const section = beamSection(stop, portalX, progress);
    const mesh = new Mesh(`${stop.id}_portalLightSlice_${i}`, scene);
    const data = new VertexData();
    data.positions = [
      section.x, BEAM_FLOOR_Y, z - section.halfWidth,
      section.x, BEAM_FLOOR_Y, z + section.halfWidth,
      section.x, section.top, z - section.halfWidth,
      section.x, section.top, z + section.halfWidth,
    ];
    data.uvs = [0, 0, 1, 0, 0, 1, 1, 1];
    data.indices = [0, 1, 2, 1, 3, 2];
    data.applyToMesh(mesh);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = false;
    mesh.alphaIndex = 1002 + i;
    mesh.isVisible = false;
    const material = new ShaderMaterial(`${stop.id}_portalLightSliceMaterial_${i}`, scene,
      { vertexSource: VERTEX, fragmentSource: LIGHT_VOLUME_FRAGMENT },
      { attributes: ["position", "uv"], uniforms: ["world", "worldViewProjection",
        "uTint", "uReveal", "uDensity", "uTime"], needAlphaBlending: true });
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.alphaMode = Constants.ALPHA_ADD;
    material.setColor3("uTint", tint);
    material.setFloat("uDensity", 0.022 + progress * 0.006);
    material.setFloat("uReveal", 0);
    mesh.material = material;
    slices.push({ mesh, material });
  }
  const near = beamSection(stop, portalX, 0);
  const far = beamSection(stop, portalX, 1);
  const addShell = (part: string, positions: number[], uvs: number[]) => {
    const mesh = new Mesh(`${stop.id}_portalLightShell_${part}`, scene);
    const data = new VertexData();
    data.positions = positions;
    data.uvs = uvs;
    data.indices = [0, 1, 2, 1, 3, 2];
    data.applyToMesh(mesh);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = false;
    mesh.alphaIndex = 1010;
    mesh.isVisible = false;
    const material = new ShaderMaterial(`${stop.id}_portalLightShellMaterial_${part}`, scene,
      { vertexSource: VERTEX, fragmentSource: LIGHT_VOLUME_SHELL_FRAGMENT },
      { attributes: ["position", "uv"], uniforms: ["world", "worldViewProjection",
        "uTint", "uReveal", "uTime"], needAlphaBlending: true });
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.alphaMode = Constants.ALPHA_ADD;
    material.setColor3("uTint", tint);
    material.setFloat("uReveal", 0);
    mesh.material = material;
    slices.push({ mesh, material });
  };
  for (const side of [-1, 1]) {
    addShell(side < 0 ? "left" : "right", [
      near.x, BEAM_FLOOR_Y, z + side * near.halfWidth,
      near.x, near.top, z + side * near.halfWidth,
      far.x, BEAM_FLOOR_Y, z + side * far.halfWidth,
      far.x, far.top, z + side * far.halfWidth,
    ], [0, 0, 0, 1, 1, 0, 1, 1]);
  }
  addShell("top", [
    near.x, near.top, z - near.halfWidth,
    near.x, near.top, z + near.halfWidth,
    far.x, far.top, z - far.halfWidth,
    far.x, far.top, z + far.halfWidth,
  ], [0, 0, 0, 1, 1, 0, 1, 1]);
  return slices;
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
  const veils: { stop: SanctuaryStop; mesh: Mesh; material: ShaderMaterial;
    light: PointLight; contactLights: PointLight[];
    stoneContacts: SanctuaryPortalStoneContact[];
    edgeGlow: ReturnType<typeof createPortalEdgeGlow>;
    floorSpill: ReturnType<typeof createFloorSpill>;
    lightVolume: ReturnType<typeof createLightVolume>;
    opacity: number; near: boolean }[] = [];
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
    for (const block of PORTAL_STONE_BLOCKS) {
      const collider = MeshBuilder.CreateBox(`${stop.id}_stoneCollider_${block.name}`,
        { width: block.x[1] - block.x[0],
          height: block.y[1] - block.y[0],
          depth: block.z[1] - block.z[0] }, scene);
      collider.parent = root;
      collider.position.set((block.x[0] + block.x[1]) / 2,
        (block.y[0] + block.y[1]) / 2,
        (block.z[0] + block.z[1]) / 2);
      collider.isVisible = false;
      collider.isPickable = false;
      collider.checkCollisions = true;
      collider.metadata = { portalStoneCollider: true, block: block.name };
    }
    const isLevelPortal = stop.id !== "libre-de-culpas";
    const stoneContacts: SanctuaryPortalStoneContact[] = [];
    if (isLevelPortal) {
      // The imported stone material is shared across all the arches. Clone it
      // per level so its glow never spills onto the main portal.
      const stoneCopies = new Map<PBRMaterial, PBRMaterial>();
      const leftTint = stop.id === "rina"
        ? new Color3(0.38, 0.22, 0.72) : new Color3(0.56, 0.12, 0.2);
      const rightTint = stop.id === "rina"
        ? new Color3(0.72, 0.16, 0.72) : new Color3(0.72, 0.1, 0.16);
      for (const mesh of arch.getChildMeshes()) {
        const original = mesh.material;
        if (!(original instanceof PBRMaterial)) continue;
        let copy = stoneCopies.get(original);
        if (!copy) {
          copy = original.clone(`${stop.id}Contact_${original.name}`);
          copy.maxSimultaneousLights = 8;
          stoneContacts.push(new SanctuaryPortalStoneContact(copy,
            root.position.x, root.position.y, root.position.z,
            leftTint, rightTint));
          stoneCopies.set(original, copy);
        }
        mesh.material = copy;
      }
    }
    const vortex = createLevelPortalSurface(scene, `${stop.id}_crimsonVortex`, root);
    vortex.position.z = -0.01;
    const material = new ShaderMaterial(`${stop.id}_crimsonVortexMaterial`, scene,
      { vertexSource: VERTEX, fragmentSource: FRAGMENT },
      { attributes: ["position", "uv"], uniforms: ["world", "worldViewProjection", "uTime",
        "uFogDensity", "uFogColor", "uCameraPosition"] });
    material.backFaceCulling = false;
    material.setFloat("uFogDensity", scene.fogDensity);
    material.setColor3("uFogColor", scene.fogColor);
    vortex.material = material;
    vortexMaterials.push(material);
    if (stop.id === "libre-de-culpas") {
      createSanctuaryForestPortal(scene, root, vortex, material);
    } else if (stop.id === "rina") {
      createSanctuaryRinaPortalV2(scene, root, vortex, material);
    }
    const { mesh: veil, material: veilMaterial } =
      createLockedPlaceholder(scene, root, stop.id);
    const edgeGlow = createPortalEdgeGlow(scene, root, stop);
    const light = new PointLight(`${stop.id}_portalInnerStoneLight`,
      new Vector3(root.position.x - stop.side * 0.8, 9.2, root.position.z), scene);
    light.diffuse = stop.id === "libre-de-culpas"
      ? new Color3(0.32, 0.48, 0.72)
      : stop.id === "rina" ? new Color3(0.58, 0.3, 0.7)
        : new Color3(0.65, 0.23, 0.3);
    light.specular = Color3.Black();
    light.range = 15;
    light.falloffType = PointLight.FALLOFF_STANDARD;
    light.intensity = 0;
    light.includedOnlyMeshes.push(...arch.getChildMeshes());
    light.setEnabled(false);
    const contactLights: PointLight[] = [];
    if (isLevelPortal) {
      // The broad fill reaches the arch, but the three faces nearest the
      // portal need their own short-range bounce from its luminous edge.
      const isRina = stop.id === "rina";
      const contacts = [
        { name: "left", y: 9.1, z: -1.35, range: 5.4,
          tint: isRina ? new Color3(0.78, 0.3, 0.95)
            : new Color3(0.85, 0.22, 0.3) },
        { name: "right", y: 9.1, z: 1.35, range: 5.4,
          tint: isRina ? new Color3(0.9, 0.3, 0.88)
            : new Color3(0.92, 0.18, 0.26) },
        { name: "top", y: 16.4, z: 0, range: 5.5,
          tint: isRina ? new Color3(0.74, 0.36, 1)
            : new Color3(0.8, 0.24, 0.35) },
      ] as const;
      for (const contact of contacts) {
        const bounce = new PointLight(`${stop.id}_portalStoneContact_${contact.name}`,
          new Vector3(root.position.x - stop.side * 4.25,
            contact.y, root.position.z + contact.z), scene);
        bounce.diffuse = contact.tint;
        bounce.specular = Color3.Black();
        bounce.range = contact.range;
        bounce.falloffType = PointLight.FALLOFF_STANDARD;
        bounce.intensity = 0;
        bounce.includedOnlyMeshes.push(...arch.getChildMeshes());
        bounce.setEnabled(false);
        contactLights.push(bounce);
      }
    }
    const floorSpill = createFloorSpill(scene, stop, root.position.x);
    const lightVolume = createLightVolume(scene, stop, root.position.x);
    veils.push({ stop, mesh: veil, material: veilMaterial, light, contactLights,
      stoneContacts, edgeGlow,
      floorSpill, lightVolume,
      opacity: 1, near: false });
  });

  return {
    update(elapsed: number, dt: number, playerPosition: Vector3) {
      const camera = scene.activeCamera?.globalPosition ?? Vector3.Zero();
      vortexMaterials.forEach((material, index) => {
        material.setFloat("uTime", elapsed + index * 1.7);
        material.setVector3("uCameraPosition", camera);
      });
      for (const veil of veils) {
        const dx = playerPosition.x - (veil.stop.x + veil.stop.side * 49);
        const dz = playerPosition.z - (veil.stop.z + 8);
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared <= REVEAL_DISTANCE * REVEAL_DISTANCE) veil.near = true;
        else if (distanceSquared >= HIDE_DISTANCE * HIDE_DISTANCE) veil.near = false;
        veil.opacity = veil.near
          ? Math.max(0, veil.opacity - dt / REVEAL_DURATION)
          : Math.min(1, veil.opacity + dt / HIDE_DURATION);
        veil.mesh.isVisible = veil.opacity > 0;
        veil.material.setFloat("uOpacity", veil.opacity);
        const reveal = 1 - veil.opacity;
        veil.light.setEnabled(reveal > 0.01);
        if (reveal > 0.01) {
          veil.light.intensity = reveal * (veil.stop.id === "libre-de-culpas" ? 3 : 2.2);
        }
        for (const bounce of veil.contactLights) {
          bounce.setEnabled(reveal > 0.01);
          if (reveal > 0.01) bounce.intensity = reveal *
            (bounce.name.endsWith("_top") ? 6.8 : 8.2);
        }
        for (const contact of veil.stoneContacts) contact.update(reveal, elapsed);
        veil.edgeGlow.mesh.isVisible = reveal > 0.01;
        veil.edgeGlow.material.setFloat("uReveal", reveal);
        veil.edgeGlow.material.setFloat("uTime", elapsed);
        veil.floorSpill.mesh.isVisible = reveal > 0.01;
        veil.floorSpill.material.setFloat("uReveal", reveal);
        veil.floorSpill.material.setFloat("uTime", elapsed);
        for (const slice of veil.lightVolume) {
          slice.mesh.isVisible = reveal > 0.01;
          if (!slice.mesh.isVisible) continue;
          slice.material.setFloat("uReveal", reveal);
          slice.material.setFloat("uTime", elapsed);
        }
        if (!veil.mesh.isVisible) continue;
        veil.material.setFloat("uTime", elapsed);
        veil.material.setVector3("uCameraPosition", camera);
      }
    },
  };
}
