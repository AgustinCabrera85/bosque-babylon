import "@babylonjs/loaders/glTF";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../utils/asset";
import { SANCTUARY_CONFIG as CFG, SANCTUARY_ASCENT as ASCENT, SANCTUARY_STOPS,
  SANCTUARY_WATERFALL_X, sanctuaryFlightStartZ, type SanctuaryPillarId,
  type SanctuaryProgress } from "./SanctuaryLayout";
import { createSanctuaryWater } from "./SanctuaryWater";
import { createSanctuaryClouds, type SanctuaryCloudMode } from "./SanctuaryClouds";
import { createSanctuaryPortalWaterfalls } from "./SanctuaryPortalWaterfalls";
import { createSanctuaryLevelPortals } from "./SanctuaryLevelPortals";
import { createSanctuaryGuardians, type SanctuaryGuardiansHandle } from "./SanctuaryGuardians";
import { SanctuaryDistanceHazePlugin } from "./SanctuaryDistanceHaze";
import { createSanctuaryStoneMaterials } from "./SanctuaryStone";
import { createSanctuaryAtmosphere } from "./SanctuaryAtmosphere";
import { createSanctuaryAbyssPortalHybrid } from "../../shaders/SanctuaryAbyssPortalHybrid";

export type OrbVisual = { sphere: AbstractMesh; halo: AbstractMesh; light: PointLight; home: Vector3 };
export type SanctuaryGeometry = {
  boatRoot: TransformNode;
  guardians: SanctuaryGuardiansHandle;
  orbs: Map<SanctuaryPillarId, OrbVisual>;
  cloudMode: SanctuaryCloudMode;
  waterMode: "reflective" | "lightweight";
  update(dt: number, elapsed: number, progress: SanctuaryProgress): void;
};

function mat(scene: Scene, name: string, color: Color3, glow?: Color3) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = new Color3(0.02, 0.015, 0.013);
  material.emissiveColor = glow ?? Color3.Black();
  return material;
}

function slab(scene: Scene, name: string, width: number, height: number, depth: number,
  xyz: [number, number, number], material: StandardMaterial, parent?: TransformNode) {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position.set(...xyz);
  mesh.material = material;
  if (parent) mesh.parent = parent;
  mesh.isPickable = false;
  return mesh;
}

// Keep the wall's stone grain at one world scale across the immense side slabs
// and the tall lintel, instead of stretching one box UV over each whole face.
function alignWallStoneUvs(mesh: Mesh) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!positions || !normals) return;
  const uvs = new Float32Array(positions.length / 3 * 2);
  const span = 180;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const i = vertex * 3;
    const x = positions[i] + mesh.position.x;
    const y = positions[i + 1] + mesh.position.y;
    const z = positions[i + 2] + mesh.position.z;
    const u = Math.abs(normals[i + 2]) > .5 ? x : Math.abs(normals[i]) > .5 ? z : x;
    const v = Math.abs(normals[i + 1]) > .5 ? z : y;
    uvs[vertex * 2] = u / span;
    uvs[vertex * 2 + 1] = v / span;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}

function roughStoneSkin(scene: Scene, name: string, x: number, z: number,
  height: number, index: number, material: StandardMaterial) {
  type Corner = [number, number, number];
  type SurfacePoint = { along: number; elevation: number; xyz: Corner };
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const quad = (a: Corner, b: Corner, c: Corner, d: Corner,
    u0: number, u1: number, v0: number, v1: number) => {
    const first = positions.length / 3;
    for (const vertex of [a, b, c, d]) positions.push(...vertex);
    uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  };
  const grain = (seed: number) => {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
  const point = (side: number, along: number, elevation: number, relief: number): Corner => {
    const y = elevation - height / 2;
    if (side === 0) return [-32.5 + along, y, -33 - relief];
    if (side === 1) return [32.5 + relief, y, -33 + along];
    if (side === 2) return [32.5 - along, y, 33 + relief];
    return [-32.5 - relief, y, 33 - along];
  };
  // Retain the original six strips and staggered blocks. Subdivide each face
  // so its seams, shallow hollows and raised areas curve instead of forming slots.
  for (let side = 0; side < 4; side++) {
    const span = side % 2 === 0 ? 65 : 66;
    for (let strip = 0; strip < 6; strip++) {
      const pitch = 44 + ((strip + side + index) % 3) * 8;
      const stagger = (strip * 13 + side * 7 + index * 5) % pitch;
      let block = 0;
      for (let start = -stagger; start < height; start += pitch, block++) {
        const bottom = Math.max(0, start + .7);
        const top = Math.min(height, start + pitch - .7);
        if (top - bottom < 8) continue;
        const seed = index * 101 + side * 29 + strip * 11 + block * 3;
        const phase = seed * .173;
        const left = strip * span / 6 + .5 + .7 * grain(seed + 1);
        const right = (strip + 1) * span / 6 - .5 - .7 * grain(seed + 2);
        const depth = .65 + 1.4 * grain(seed + 4);
        const columns = 3;
        const rows = 3;
        const first = positions.length / 3;
        const grid: SurfacePoint[][] = [];
        for (let row = 0; row <= rows; row++) {
          const v = row / rows;
          const gridRow: SurfacePoint[] = [];
          for (let column = 0; column <= columns; column++) {
            const u = column / columns;
            const leftBend = .38 * Math.sin(v * 4.1 + phase);
            const rightBend = .38 * Math.sin(v * 3.6 + phase * 1.3);
            const along = left + (right - left) * u + leftBend * (1 - u) + rightBend * u
              + .22 * Math.sin(u * 5 + v * 3 + phase) * Math.sin(Math.PI * u);
            const low = bottom + 1.1 * grain(seed + 6) + .65 * Math.sin(u * 3.2 + phase);
            const high = top - 1.3 * grain(seed + 8) + .65 * Math.sin(u * 3.4 + phase * 1.2);
            const elevation = low + (high - low) * v
              + .55 * Math.sin(u * 4 + v * 3.2 + phase) * Math.sin(Math.PI * v);
            const relief = Math.max(.24, depth + .45 * Math.sin(Math.PI * u)
              + .4 * Math.sin(u * 3.7 + v * 3.1 + phase)
              + .24 * Math.sin(u * 6.3 - v * 2.4 + phase * 1.7));
            const xyz = point(side, along, elevation, relief);
            gridRow.push({ along, elevation, xyz });
            positions.push(...xyz);
            uvs.push(along / span, elevation / height);
          }
          grid.push(gridRow);
        }
        for (let row = 0; row < rows; row++) {
          for (let column = 0; column < columns; column++) {
            const a = first + row * (columns + 1) + column;
            const b = a + columns + 1;
            indices.push(a, b, b + 1, a, b + 1, a + 1);
          }
        }
        const back = (vertex: SurfacePoint, shift = 0) =>
          point(side, vertex.along + shift, vertex.elevation, .08);
        for (let row = 0; row < rows; row++) {
          const leftA = grid[row][0];
          const leftB = grid[row + 1][0];
          const rightA = grid[row][columns];
          const rightB = grid[row + 1][columns];
          quad(back(leftA, -.4), back(leftB, -.4), leftB.xyz, leftA.xyz,
            leftA.along / span, leftB.along / span, leftA.elevation / height, leftB.elevation / height);
          quad(rightA.xyz, rightB.xyz, back(rightB, .4), back(rightA, .4),
            rightA.along / span, rightB.along / span, rightA.elevation / height, rightB.elevation / height);
        }
        for (let column = 0; column < columns; column++) {
          const lowA = grid[0][column];
          const lowB = grid[0][column + 1];
          const highA = grid[rows][column];
          const highB = grid[rows][column + 1];
          quad(back(lowA), lowA.xyz, lowB.xyz, back(lowB),
            lowA.along / span, lowB.along / span, lowA.elevation / height, lowB.elevation / height);
          quad(highA.xyz, back(highA), back(highB), highB.xyz,
            highA.along / span, highB.along / span, highA.elevation / height, highB.elevation / height);
        }
      }
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(`${name}_roughSkin`, scene);
  const vertices = new VertexData();
  vertices.positions = positions;
  vertices.normals = normals;
  vertices.uvs = uvs;
  vertices.indices = indices;
  vertices.applyToMesh(mesh);
  mesh.position.set(x, height / 2 - 6, z);
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

// Shared world-space UVs prevent all 360 treads from repeating the same image.
// Only texture coordinates change; stair geometry and collisions remain intact.
function alignStairStoneUvs(mesh: Mesh) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  const uvs = mesh.getVerticesData(VertexBuffer.UVKind);
  if (!positions || !normals || !uvs) return;
  const stoneSpan = 56;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const x = positions[vertex * 3] + mesh.position.x;
    const y = positions[vertex * 3 + 1] + mesh.position.y;
    const z = positions[vertex * 3 + 2] + mesh.position.z;
    const nx = Math.abs(normals[vertex * 3]);
    const ny = Math.abs(normals[vertex * 3 + 1]);
    uvs[vertex * 2] = (nx > .5 ? z : x) / stoneSpan;
    uvs[vertex * 2 + 1] = (ny > .5 ? z : y) / stoneSpan;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}

// Screen-door coverage lets the existing moving sky show through the distant
// stone without turning the entire wall into a transparent, depth-sorted mesh.
class SanctuaryLateralBrumePlugin extends MaterialPluginBase {
  constructor(material: StandardMaterial) {
    super(material, "SanctuaryLateralBrume", 210);
    this._enable(true);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: `
float sanctuaryLateralDistance = abs(vPositionW.x);
if (sanctuaryLateralDistance > 2900.0) {
  float sanctuaryLateralMist = smoothstep(2900.0, 7800.0, sanctuaryLateralDistance);
  float sanctuaryMistDither = fract(52.9829189 * fract(
    0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
  if (sanctuaryMistDither < sanctuaryLateralMist) discard;
}
`,
    };
  }
}

// The route to the gate needs more definition than the surrounding river and wall.
class SanctuaryApproachFogPlugin extends MaterialPluginBase {
  constructor(material: StandardMaterial) {
    super(material, "SanctuaryApproachFog", 230);
    this._enable(true);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef FOG
vec3 sanctuaryApproachClearColor = color.rgb;
#endif
`,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
#ifdef FOG
float sanctuaryApproachLane = (1.0 - smoothstep(180.0, 540.0, abs(vPositionW.x)))
  * smoothstep(1130.0, 1450.0, vPositionW.z);
color.rgb = mix(color.rgb, sanctuaryApproachClearColor, sanctuaryApproachLane * 0.50);
#endif
`,
    };
  }
}

// Light the actual upper landing stone, so the glow cannot float over the stair edge.
export class SanctuaryPortalFloorLightPlugin extends MaterialPluginBase {
  private time = 0;
  private pulse = 0.8;

  constructor(material: StandardMaterial) {
    super(material, "SanctuaryPortalFloorLight", 240);
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  update(time: number): void {
    this.time = time;
    this.pulse = 0.80 + 0.20 * Math.sin(time * 1.7) + 0.09 * Math.sin(time * 2.9);
  }

  getUniforms() {
    return { ubo: [{ name: "sanctuaryPortalFloorLight", size: 4, type: "vec4" }] };
  }

  hardBindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: unknown,
    _subMesh: SubMesh): void {
    uniformBuffer.updateFloat4("sanctuaryPortalFloorLight", this.time, this.pulse, 0, 0);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    const mouthZ = ASCENT.wallFrontZ - 6;
    const sourceZ = CFG.gateWallZ + ASCENT.wallDepth / 2 - 5.2;
    const stairZ = ASCENT.stairEndZ;
    const upperY = ASCENT.upperY;
    const portalHalfWidth = (CFG.gateWidth - 13) / 2;
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
if (vPositionW.z >= ${stairZ.toFixed(3)}
  && vPositionW.z <= ${sourceZ.toFixed(3)}
  && vPositionW.y >= ${(upperY - 0.32).toFixed(3)}
  && vPositionW.y <= ${(upperY + 0.20).toFixed(3)}
  && abs(vPositionW.x) <= ${(portalHalfWidth * 1.72).toFixed(3)}) {
float sanctuaryFloorApproach = clamp((${mouthZ.toFixed(3)} - vPositionW.z)
  / ${(mouthZ - stairZ).toFixed(3)}, 0.0, 1.0);
float sanctuaryFloorInterior = clamp((vPositionW.z - ${mouthZ.toFixed(3)})
  / ${(sourceZ - mouthZ).toFixed(3)}, 0.0, 1.0);
float sanctuaryFloorAlong = 1.0 - smoothstep(0.92, 1.0, sanctuaryFloorApproach);
float sanctuaryFloorTop = smoothstep(${(upperY - 0.32).toFixed(3)},
  ${(upperY - 0.05).toFixed(3)}, vPositionW.y)
  * (1.0 - smoothstep(${(upperY + 0.04).toFixed(3)},
    ${(upperY + 0.20).toFixed(3)}, vPositionW.y));
float sanctuaryFloorHalfWidth = mix(${(portalHalfWidth * 1.05).toFixed(3)},
  ${(portalHalfWidth * 1.72).toFixed(3)}, sanctuaryFloorApproach);
float sanctuaryFloorSide = abs(vPositionW.x) / sanctuaryFloorHalfWidth;
float sanctuaryFloorSpread = 1.0 - smoothstep(0.58, 1.05, sanctuaryFloorSide);
float sanctuaryFloorRipple = 0.86 + 0.14
  * sin(vPositionW.x * 0.12 + sanctuaryFloorApproach * 5.0
    - sanctuaryPortalFloorLight.x * 0.48)
  * sin(sanctuaryFloorApproach * 7.0 + sanctuaryPortalFloorLight.x * 0.31);
float sanctuaryFloorPower = mix(0.72, 0.16, sanctuaryFloorApproach)
  + 0.55 * sanctuaryFloorInterior;
float sanctuaryFloorStrength = sanctuaryFloorAlong * sanctuaryFloorTop
  * sanctuaryFloorSpread * sanctuaryFloorRipple
  * sanctuaryFloorPower
  * (0.84 + 0.16 * sanctuaryPortalFloorLight.y);
color.rgb += vec3(0.36, 0.57, 0.84) * sanctuaryFloorStrength;
}
`,
    };
  }
}

// Use the portal's dark distance haze on the wall, then dissolve its upper stone
// into the crimson sky. Babylon's brighter EXP2 fog would wash the wall red.
class SanctuaryWallFogPlugin extends MaterialPluginBase {
  constructor(material: StandardMaterial, private readonly heightFogEnabled: boolean) {
    super(material, "SanctuaryWallFog", 235);
    this._enable(true);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
float sanctuaryWallRange = length(vPositionW - vEyePosition.xyz);
float sanctuaryWallHaze = smoothstep(280.0, 1550.0, sanctuaryWallRange) * 0.62;
color.rgb = mix(color.rgb, vec3(0.105, 0.024, 0.028), sanctuaryWallHaze);
${this.heightFogEnabled ? `
vec3 sanctuaryWallRay = normalize(vPositionW - vEyePosition.xyz);
float sanctuaryWallElevation = clamp(sanctuaryWallRay.y * 0.75 + 0.42, 0.0, 1.0);
vec3 sanctuaryWallSky = mix(vec3(0.075, 0.009, 0.014),
  vec3(0.19, 0.027, 0.03), sanctuaryWallElevation);
float sanctuaryWallHorizon = 1.0 - smoothstep(0.0, 0.24, abs(sanctuaryWallRay.y));
sanctuaryWallSky = mix(sanctuaryWallSky, vec3(0.18, 0.028, 0.032),
  sanctuaryWallHorizon * 0.75);
float sanctuaryWallAltitude = smoothstep(650.0, 3400.0, vPositionW.y);
color.rgb = mix(color.rgb, sanctuaryWallSky, sanctuaryWallAltitude);
` : ""}
`,
    };
  }
}

function createStairParapets(scene: Scene, material: StandardMaterial, foundationY: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  type Corner = [number, number, number];
  const face = (a: Corner, b: Corner, c: Corner, d: Corner) => {
    const first = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const second = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      first[1] * second[2] - first[2] * second[1],
      first[2] * second[0] - first[0] * second[2],
      first[0] * second[1] - first[1] * second[0],
    ];
    const length = Math.hypot(...normal);
    const start = positions.length / 3;
    for (const corner of [a, b, c, d]) {
      positions.push(...corner);
      normals.push(normal[0] / length, normal[1] / length, normal[2] / length);
      // World-space projection keeps the masonry legible along the full ascent.
      uvs.push((Math.abs(normal[0]) > length * .5 ? corner[2] : corner[0]) / 24,
        (Math.abs(normal[1]) > length * .5 ? corner[2] : corner[1]) / 24);
    }
    // Babylon's left-handed box builder uses this winding for the face whose
    // normal points outward. The old winding exposed only the inside surfaces.
    indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
  };
  // Extrude one continuous closed profile per side. Internal caps at every rest
  // used to coincide and could read as dark gaps instead of solid stone.
  const profile: Array<[number, number]> = [
    [ASCENT.lowerPlatformStartZ, ASCENT.lowerY + 12],
    [ASCENT.stairStartZ, ASCENT.lowerY + 12],
  ];
  for (let flight = 0; flight < ASCENT.flights; flight++) {
    const endZ = sanctuaryFlightStartZ(flight) + ASCENT.stepsPerFlight * ASCENT.treadDepth;
    const topY = ASCENT.lowerY + (flight + 1) * ASCENT.stepsPerFlight * ASCENT.riserHeight + 12;
    profile.push([endZ, topY]);
    if (flight < ASCENT.flights - 1) profile.push([endZ + ASCENT.landingDepth, topY]);
  }
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -ASCENT.stairWidth / 2 - 24 : ASCENT.stairWidth / 2;
    const x1 = x0 + 24;
    for (let segment = 0; segment < profile.length - 1; segment++) {
      const [z0, top0] = profile[segment];
      const [z1, top1] = profile[segment + 1];
      face([x0, top0, z0], [x0, top1, z1], [x1, top1, z1], [x1, top0, z0]);
      face([x0, foundationY, z0], [x0, foundationY, z1], [x0, top1, z1], [x0, top0, z0]);
      face([x1, foundationY, z1], [x1, foundationY, z0], [x1, top0, z0], [x1, top1, z1]);
    }
    const [frontZ, frontTop] = profile[0];
    const [backZ, backTop] = profile[profile.length - 1];
    face([x0, foundationY, frontZ], [x0, frontTop, frontZ],
      [x1, frontTop, frontZ], [x1, foundationY, frontZ]);
    face([x1, foundationY, backZ], [x1, backTop, backZ],
      [x0, backTop, backZ], [x0, foundationY, backZ]);
    face([x0, foundationY, frontZ], [x1, foundationY, frontZ],
      [x1, foundationY, backZ], [x0, foundationY, backZ]);
  }
  const parapets = new Mesh("sanctuaryStairStoneParapets", scene);
  const vertices = new VertexData();
  vertices.positions = positions;
  vertices.normals = normals;
  vertices.uvs = uvs;
  vertices.indices = indices;
  vertices.applyToMesh(parapets);
  parapets.material = material;
  parapets.isPickable = false;
  parapets.receiveShadows = false;
}

// One continuous ground: 10-unit cells along the whole raft route and wider
// cells in the distant mist. The outer rim still reaches the old 5000x5000
// footprint; there are no overlapping water planes or per-frame mesh updates.
function createAdaptiveWaterGround(scene: Scene): Mesh {
  const xs = [-2500, -1800, -1300, -900, -650, -470, -350, -280, -250];
  for (let x = -240; x <= 240; x += 10) xs.push(x);
  xs.push(250, 280, 350, 470, 650, 900, 1300, 1800, 2500);

  // Local Z is shifted +320 below, just like the original ground.
  const zs = [-2500, -1900, -1450, -1150, -950, -850, -780];
  for (let z = -770; z <= 1010; z += 10) zs.push(z);
  zs.push(1020, 1040, 1080, 1150, 1250, 1400, 1650, 2000, 2500);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const z of zs) {
    for (const x of xs) {
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      uvs.push((x + 2500) / 5000, (z + 2500) / 5000);
    }
  }
  for (let row = 0; row < zs.length - 1; row++) {
    for (let column = 0; column < xs.length - 1; column++) {
      const a = row * xs.length + column;
      const b = a + 1;
      const c = a + xs.length;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const water = new Mesh("sanctuaryRedWater", scene);
  const vertices = new VertexData();
  vertices.positions = positions;
  vertices.normals = normals;
  vertices.uvs = uvs;
  vertices.indices = indices;
  vertices.applyToMesh(water);
  return water;
}

export async function createSanctuaryGeometry(scene: Scene, progress: SanctuaryProgress, mobile: boolean): Promise<SanctuaryGeometry> {
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const skyTest = params?.get("sanctuaryClouds");
  const mode = skyTest === "off" || skyTest === "layered" || skyTest === "volumetric"
    ? skyTest : skyTest === "high" ? "volumetric" : undefined;
  const clouds = createSanctuaryClouds(scene, {
    mobile, mode, quality: skyTest === "high" ? "high" : "standard",
  });
  // The local smoke sheets remain a complementary low-altitude effect.
  const atmosphere = createSanctuaryAtmosphere(scene, mobile, clouds.mode === "volumetric" ? 0.43 : clouds.mode === "off" ? 0 : 1);
  const stoneVariant = params?.get("sanctuaryStone") === "original" ? "original" : "megalithic";
  const heightFogEnabled = params?.get("sanctuaryHeightFog") !== "off";
  const stone = createSanctuaryStoneMaterials(scene, mobile, heightFogEnabled, stoneVariant);
  const reflectors: AbstractMesh[] = [];
  const water = createSanctuaryWater(scene, mobile || params?.get("sanctuaryWater") === "lite");
  const black = mat(scene, "sanctuaryObsidan", new Color3(.017,.018,.022));
  const concrete = stone.pillar;
  const upperStructure = stone.upperStructure;
  const wallMat = stone.wall;
  const stairsMat = stone.stairs;
  wallMat.fogEnabled = false;
  new SanctuaryLateralBrumePlugin(wallMat);
  new SanctuaryWallFogPlugin(wallMat, heightFogEnabled);
  new SanctuaryApproachFogPlugin(stairsMat);
  const portalFloorLight = new SanctuaryPortalFloorLightPlugin(stairsMat);
  // The inner passage floor is wallGateLower's top face, which uses wall stone.
  const portalInnerFloorLight = new SanctuaryPortalFloorLightPlugin(wallMat);
  if (stone.parapet !== stairsMat) new SanctuaryApproachFogPlugin(stone.parapet);
  const gold = mat(scene, "sanctuaryCagedLight", new Color3(.95,.68,.38), new Color3(.9,.64,.35));
  const freed = mat(scene, "sanctuaryFreedLight", new Color3(.55,.67,.9), new Color3(.27,.39,.69));
  const haloMat = mat(scene, "sanctuaryHalo", new Color3(.87,.33,.19), new Color3(.55,.19,.09));
  haloMat.alpha = .16;
  haloMat.disableLighting = true;
  haloMat.backFaceCulling = false;
  const redWater = water.quality === "lightweight"
    ? MeshBuilder.CreateGround("sanctuaryRedWater", { width: 5000, height: 5000, subdivisions: 2 }, scene)
    : createAdaptiveWaterGround(scene);
  redWater.position.z = 320;
  redWater.position.y = CFG.riverY;
  redWater.material = water.material;
  redWater.isPickable = false;
  water.addSurfaceDetail(redWater);

  // Top of wall is geometrically thousands of metres high and swallowed by red atmosphere.
  const wallHalfWidth = 24000;
  const gap = CFG.gateWidth;
  const wallHeight = 9000;
  const wallBottom = -8;
  const wallTop = wallBottom + wallHeight;
  const portalTop = ASCENT.upperY + ASCENT.portalHeight;
  // Beyond the accessible route, the long stone wings dissolve into the sky
  // before the camera can clip them; there are no return or rear walls.
  // World-space UVs remain continuous when the stone modules merge.
  for (const side of [-1, 1]) {
    const modules: Mesh[] = [];
    for (let segment = 0; segment < 8; segment++) {
      const inner = gap / 2 + (wallHalfWidth - gap / 2) * segment / 8;
      const outer = gap / 2 + (wallHalfWidth - gap / 2) * (segment + 1) / 8;
      const module = slab(scene, `wallStoneModule_${side}_${segment}`, outer - inner, wallHeight,
        ASCENT.wallDepth, [side * (inner + outer) / 2, wallHeight / 2 + wallBottom, CFG.gateWallZ], wallMat);
      alignWallStoneUvs(module);
      modules.push(module);
    }
    const mergedWall = Mesh.MergeMeshes(modules, true, true);
    if (mergedWall) {
      mergedWall.name = side < 0 ? "wallInfiniteLeft" : "wallInfiniteRight";
      mergedWall.material = wallMat;
      mergedWall.isPickable = false;
      reflectors.push(mergedWall);
    } else {
      reflectors.push(...modules);
    }
  }
  // Fill the former ground-level opening; its top is the walkable floor inside the elevated gate.
  const gateLower = slab(scene, "wallGateLower", gap + 4, ASCENT.upperY - wallBottom, ASCENT.wallDepth,
    [0, (ASCENT.upperY + wallBottom) / 2, CFG.gateWallZ], wallMat);
  const gateLintel = slab(scene, "wallGateLintel", gap + 4, wallTop - portalTop, ASCENT.wallDepth,
    [0, (wallTop + portalTop) / 2, CFG.gateWallZ], wallMat);
  alignWallStoneUvs(gateLower);
  alignWallStoneUvs(gateLintel);
  reflectors.push(gateLower, gateLintel);
  const portalSurface = slab(scene, "gateRedVoid", gap - 13, ASCENT.portalHeight, 2,
    [0, ASCENT.upperY + ASCENT.portalHeight / 2, CFG.gateWallZ + ASCENT.wallDepth / 2 - 3.5], black);
  const portalEffect = createSanctuaryAbyssPortalHybrid(scene, portalSurface, {
    mobile, portalMouthZ: ASCENT.wallFrontZ - 6,
  });
  portalEffect.material.setFloat("uFog", 1.2);
  portalEffect.material.setFloat("uGlow", 1.4);
  scene.onDisposeObservable.addOnce(() => portalEffect.dispose());
  reflectors.push(portalSurface);
  for (const x of [-gap / 2, gap / 2]) {
    const jaw = slab(scene, "gateJaw", 12, ASCENT.portalHeight, ASCENT.wallDepth,
      [x, ASCENT.upperY + ASCENT.portalHeight / 2, CFG.gateWallZ], wallMat);
    alignWallStoneUvs(jaw);
  }

  // The supplied arch is one unit tall. Raise it above the existing gate
  // opening and sink its rear into the wall so the masonry frames the red void.
  const mainPortal = await SceneLoader.LoadAssetContainerAsync(
    asset("assets/models/sanctuary/"), "Portal_principal.glb", scene);
  if (scene.isDisposed) {
    mainPortal.dispose();
    throw new Error("The sanctuary closed while loading its main portal.");
  }
  const mainPortalRoot = new TransformNode("sanctuaryMainPortal", scene);
  mainPortalRoot.position.set(0, ASCENT.upperY, ASCENT.wallFrontZ - 6);
  mainPortalRoot.scaling.set(gap * 2.25, ASCENT.portalHeight * 1.25, gap * 1.75);
  mainPortal.addAllToScene();
  const frameLight = new PointLight("sanctuaryPortalFrameFill", new Vector3(
    0, ASCENT.upperY + ASCENT.portalHeight * 0.56, ASCENT.wallFrontZ + 22,
  ), scene);
  frameLight.diffuse = new Color3(0.58, 0.76, 1.0);
  frameLight.specular = new Color3(0.38, 0.57, 0.82);
  frameLight.range = mobile ? 145 : 175;
  frameLight.intensity = 0;
  frameLight.includedOnlyMeshes.push(...mainPortal.meshes);
  for (const root of mainPortal.rootNodes) root.parent = mainPortalRoot;
  for (const material of mainPortal.materials) {
    if (!(material instanceof PBRMaterial)) continue;
    material.albedoColor = new Color3(.30, .30, .30);
    material.emissiveColor = Color3.Black();
    material.metallic = 0;
    material.roughness = .95;
    material.specularIntensity = .035;
    material.environmentIntensity = .035;
    material.maxSimultaneousLights = mobile ? 5 : 6;
    // Use a darker, controlled distance haze instead of the bright scene fog.
    material.fogEnabled = false;
    new SanctuaryDistanceHazePlugin(material, 0.40);
  }
  for (const mesh of mainPortal.meshes) {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
  }
  const portalBounds = mainPortalRoot.getHierarchyBoundingVectors(true);
  const guardians = await createSanctuaryGuardians(scene,
    portalBounds.max.y - portalBounds.min.y,
    (portalBounds.max.x - portalBounds.min.x) / 2);

  // Four steep flights and three level rests, all merged into one static stone draw call.
  const stairParts: Mesh[] = [];
  const foundationY = CFG.riverY - 1;
  const baseTopY = ASCENT.upperY - 22;
  const baseFrontZ = ASCENT.stairEndZ - 14;
  const baseBackZ = ASCENT.wallFrontZ + 10;
  const baseSegments: Mesh[] = [];
  baseSegments.push(slab(scene, "sanctuaryWallBaseCenter", 3000,
    baseTopY - foundationY, baseBackZ - baseFrontZ,
    [0, (baseTopY + foundationY) / 2, (baseFrontZ + baseBackZ) / 2], wallMat));
  for (const side of [-1, 1]) {
    for (let segment = 0; segment < 8; segment++) {
      const inner = 1500 + segment * 3000;
      const outer = Math.min(wallHalfWidth, inner + 3000);
      baseSegments.push(slab(scene, `sanctuaryWallBase_${side}_${segment}`, outer - inner,
        baseTopY - foundationY, baseBackZ - baseFrontZ,
        [side * (inner + outer) / 2, (baseTopY + foundationY) / 2,
          (baseFrontZ + baseBackZ) / 2], wallMat));
    }
  }
  for (const segment of baseSegments) alignWallStoneUvs(segment);
  const mergedBase = Mesh.MergeMeshes(baseSegments, true, true);
  if (mergedBase) {
    mergedBase.name = "sanctuaryContinuousWallBase";
    mergedBase.material = wallMat;
    mergedBase.isPickable = false;
    mergedBase.receiveShadows = false;
  }
  const stairBlock = (name: string, width: number, startZ: number, endZ: number, topY: number) => {
    const part = slab(scene, name, width, topY - foundationY, endZ - startZ,
      [0, (topY + foundationY) / 2, (startZ + endZ) / 2], stairsMat);
    if (stoneVariant === "megalithic") alignStairStoneUvs(part);
    part.receiveShadows = false;
    stairParts.push(part);
  };
  stairBlock("sanctuaryLowerPlatform", ASCENT.platformWidth,
    ASCENT.lowerPlatformStartZ, ASCENT.stairStartZ, ASCENT.lowerY);
  for (let flight = 0; flight < ASCENT.flights; flight++) {
    const flightStart = sanctuaryFlightStartZ(flight);
    for (let step = 0; step < ASCENT.stepsPerFlight; step++) {
      const index = flight * ASCENT.stepsPerFlight + step;
      const startZ = flightStart + step * ASCENT.treadDepth;
      stairBlock(`sanctuaryStair_${index}`, ASCENT.stairWidth, startZ,
        startZ + ASCENT.treadDepth, ASCENT.lowerY + (index + 1) * ASCENT.riserHeight);
    }
    if (flight < ASCENT.flights - 1) {
      const landingStart = flightStart + ASCENT.stepsPerFlight * ASCENT.treadDepth;
      stairBlock(`sanctuaryStairRest_${flight}`, ASCENT.platformWidth, landingStart,
        landingStart + ASCENT.landingDepth,
        ASCENT.lowerY + (flight + 1) * ASCENT.stepsPerFlight * ASCENT.riserHeight);
    }
  }
  stairBlock("sanctuaryUpperPlatform", ASCENT.platformWidth,
    ASCENT.stairEndZ, ASCENT.wallFrontZ, ASCENT.upperY);
  const mergedStairs = Mesh.MergeMeshes(stairParts, true, true);
  if (mergedStairs) {
    mergedStairs.name = "sanctuaryMonumentalStairway";
    mergedStairs.material = stairsMat;
    mergedStairs.isPickable = false;
    mergedStairs.receiveShadows = false;
  }
  // The upper stone tier continues with the wall; no exposed end at x=+/-450.
  // It rests on the continuous lower base and leaves the central stair landing clear.
  const halfPlatform = ASCENT.platformWidth / 2;
  for (const side of [-1, 1]) {
    const wingParts: Mesh[] = [];
    for (let segment = 0; segment < 8; segment++) {
      const inner = halfPlatform + (wallHalfWidth - halfPlatform) * segment / 8;
      const outer = halfPlatform + (wallHalfWidth - halfPlatform) * (segment + 1) / 8;
      const part = slab(scene, `sanctuaryUpperPlinth_${side}_${segment}`, outer - inner,
        ASCENT.upperY - baseTopY, ASCENT.wallFrontZ - ASCENT.stairEndZ,
        [side * (inner + outer) / 2, (ASCENT.upperY + baseTopY) / 2,
          (ASCENT.stairEndZ + ASCENT.wallFrontZ) / 2], wallMat);
      alignWallStoneUvs(part);
      part.receiveShadows = false;
      wingParts.push(part);
    }
    const mergedWing = Mesh.MergeMeshes(wingParts, true, true);
    if (mergedWing) {
      mergedWing.name = side < 0 ? "sanctuaryUpperPlinthLeft" : "sanctuaryUpperPlinthRight";
      mergedWing.material = wallMat;
      mergedWing.isPickable = false;
      mergedWing.receiveShadows = false;
    }
  }
  createStairParapets(scene, stone.parapet, foundationY);
  const portalFalls = createSanctuaryPortalWaterfalls(scene, {
    wallFrontZ: ASCENT.wallFrontZ,
    baseFrontZ,
    portalTopY: ASCENT.upperY + ASCENT.portalHeight,
    riverY: CFG.riverY,
    sampleWaterHeight: water.sampleHeight,
    placeholderStone: wallMat,
    lateralOffset: SANCTUARY_WATERFALL_X,
    width: 22,
    sourceRise: 225,
    impactClearance: 32,
    bendDrop: 96,
    bendLip: 27,
    meander: 1.0,
    topNarrowing: 0.28,
    bottomSpread: 0.22,
    shapeChaos: 0.65,
    edgeRaggedness: 0.44,
    opacity: 0.91,
    quality: mobile ? "low" : "high",
    enabled: params?.get("sanctuaryFalls") !== "off",
  });
  const gargoyleAsset = await SceneLoader.LoadAssetContainerAsync(
    asset("assets/models/sanctuary/"), "Gargola1.glb", scene);
  if (scene.isDisposed) {
    gargoyleAsset.dispose();
    throw new Error("The sanctuary closed while loading its waterfall gargoyles.");
  }
  gargoyleAsset.addAllToScene();
  const gargoyleSource = gargoyleAsset.rootNodes[0];
  if (!(gargoyleSource instanceof TransformNode)) {
    throw new Error("The waterfall gargoyle has no root transform.");
  }
  const gargoyleBounds = gargoyleSource.getHierarchyBoundingVectors(true);
  const gargoyleScale = 82 / (gargoyleBounds.max.y - gargoyleBounds.min.y);
  const gargoyleCenterX = (gargoyleBounds.min.x + gargoyleBounds.max.x) / 2;
  for (const material of gargoyleAsset.materials) {
    if (!(material instanceof PBRMaterial)) continue;
    material.albedoColor = new Color3(.28, .28, .28);
    material.emissiveColor = Color3.Black();
    material.metallic = 0;
    material.roughness = 1;
    material.specularIntensity = .04;
    material.environmentIntensity = .03;
    material.backFaceCulling = false; // The left statue has a mirrored X scale.
    material.fogEnabled = false;
    new SanctuaryDistanceHazePlugin(material);
  }
  for (const fall of portalFalls.sources) {
    // The stone perch reaches into the wall and carries the gargoyle's feet.
    // The crimson stream emerges just beyond its river-facing lip.
    const perch = MeshBuilder.CreateBox(`sanctuaryGargoylePerch_${fall.id}`,
      { width: 68, height: 12, depth: 54 }, scene);
    perch.parent = fall.gargoyleMount;
    perch.position.set(0, -6, -16);
    perch.material = wallMat;
    perch.isPickable = false;
    perch.checkCollisions = false;

    const root = new TransformNode(`sanctuaryGargoyle_${fall.id}`, scene);
    root.parent = fall.gargoyleMount;
    const mirror = fall.id === "left" ? -1 : 1;
    root.scaling.set(mirror * gargoyleScale, gargoyleScale, gargoyleScale);
    root.position.set(-mirror * gargoyleCenterX * gargoyleScale,
      -gargoyleBounds.min.y * gargoyleScale - .35,
      -42 - gargoyleBounds.min.z * gargoyleScale);
    // Tripo's +Z is its face; the waterfall mount already turns it toward the river.
    const statue = fall.id === "right" ? gargoyleSource
      : gargoyleSource.clone("sanctuaryGargoyleMirroredModel", root);
    if (!statue) throw new Error("Could not mirror the left waterfall gargoyle.");
    statue.parent = root;
    for (const mesh of statue.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.checkCollisions = false;
    }
    fall.setPlaceholderVisible(false);
  }

  // Sparse monumental rectangular pillars: each contains a story level, topped with a trapped orb.
  const orbs = new Map<SanctuaryPillarId, OrbVisual>();
  for (const [index, stop] of SANCTUARY_STOPS.entries()) {
    const x = stop.x + stop.side * 166;
    const z = stop.z + 54;
    const h = stop.height;
    const monolith = slab(scene, `${stop.id}_monolith`, 65, h, 66, [x, h / 2 - 6, z], concrete);
    const roughSkin = roughStoneSkin(scene, `${stop.id}_monolith`, x, z, h, index, concrete);
    stone.setPillarHeightFog(monolith, h);
    stone.setPillarHeightFog(roughSkin, h);
    reflectors.push(monolith);
    // Very sparse concrete seams; no Gothic trim, no pointed spires.
    const ridge = slab(scene, `${stop.id}_ridge`, 65.8, 5.5, 67, [x, h * .28, z], upperStructure);
    stone.setPillarHeightFog(ridge, h);
    for (const angle of [0, 1, 2, 3]) {
      const px = x + (angle % 2 ? 22 : -22);
      const pz = z + (angle < 2 ? -22 : 22);
      const cage = slab(scene, `${stop.id}_orbPrison_${angle}`, 8, 30, 8, [px, h + 7, pz], upperStructure);
      stone.setPillarHeightFog(cage, h);
    }
    const sphere = MeshBuilder.CreateSphere(`${stop.id}_lightOrb`, { diameter: 15, segments: 12 }, scene);
    sphere.position.set(x, h + 17, z);
    sphere.material = progress[stop.id] ? freed : gold;
    sphere.isPickable = false;
    reflectors.push(sphere);
    const halo = MeshBuilder.CreateSphere(`${stop.id}_halo`, { diameter: 31, segments: 12 }, scene);
    halo.position.copyFrom(sphere.position);
    halo.material = haloMat;
    halo.isPickable = false;
    const light = new PointLight(`${stop.id}_localGlow`, sphere.position.clone(), scene);
    light.diffuse = new Color3(1, .46, .25);
    light.intensity = .6;
    light.range = 85;
    // Only a single near pillar's light is enabled at once in the update loop.
    light.setEnabled(false);
    orbs.set(stop.id, { sphere, halo, light, home: sphere.position.clone() });

    // Reachable landing for the level portal scenery.
    const dockX = stop.x + stop.side * 27;
    slab(scene, `${stop.id}_landing`, 55, 2.5, 60, [dockX, .8, stop.z], concrete);
    slab(scene, `${stop.id}_pier`, 45, 1.6, 22, [stop.x + stop.side * 13, .65, stop.z], stairsMat);
  }
  const levelPortals = await createSanctuaryLevelPortals(scene, SANCTUARY_STOPS);

  // Keep the established route and water response; only replace its visual raft.
  const boatRoot = new TransformNode("sanctuaryBoat", scene);
  boatRoot.position.set(0, CFG.riverY + .25, CFG.boatStartZ);
  const raft = await SceneLoader.LoadAssetContainerAsync(
    asset("assets/models/sanctuary/"), "Balsa_Oscura.glb", scene);
  if (scene.isDisposed) {
    raft.dispose();
    throw new Error("The sanctuary closed while loading its raft.");
  }
  const raftVisual = new TransformNode("sanctuaryRaftVisual", scene);
  raftVisual.parent = boatRoot;
  // The GLB's long axis is X. Turn its raised prow toward the next stop.
  // Uniform scale preserves the narrow hull and tall prow of the source model.
  raftVisual.rotation.y = -Math.PI / 2;
  raftVisual.scaling.setAll(12);
  raftVisual.position.y = -.23;
  raft.addAllToScene();
  for (const root of raft.rootNodes) root.parent = raftVisual;
  // Keep the model's wood grain, but remove the wet-looking PBR highlights.
  for (const material of raft.materials) {
    if (!(material instanceof PBRMaterial)) continue;
    material.metallic = 0;
    material.roughness = 1;
    material.specularIntensity = 0.04;
    material.environmentIntensity = 0;
    material.clearCoat.isEnabled = false;
  }
  for (const mesh of raft.meshes) {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
  }

  // The imported hull has a low inner floor. Wave crests can render over it,
  // exposing a red rectangle between the cross planks. A recessed, matte wood
  // liner closes that area while remaining below the player's standing height.
  const innerFloor = MeshBuilder.CreateGround("sanctuaryRaftInnerFloor",
    { width: 1.9, height: 6.2 }, scene);
  innerFloor.parent = boatRoot;
  innerFloor.position.y = .45;
  innerFloor.isPickable = false;
  innerFloor.checkCollisions = false;
  const innerFloorMat = new StandardMaterial("sanctuaryRaftInnerWood", scene);
  const innerWood = new Texture(asset("assets/textures/theatre/stage/wooden-scenario-floor-texture.png"), scene);
  innerWood.wAng = Math.PI / 2;
  innerWood.uScale = 1.5;
  innerWood.vScale = 2.5;
  innerFloorMat.diffuseTexture = innerWood;
  innerFloorMat.diffuseColor = new Color3(.24, .20, .18);
  innerFloorMat.specularColor = Color3.Black();
  innerFloor.material = innerFloorMat;

  // Render-to-texture reflections only include a small, stable scene subset.
  // Excluding the water itself is essential: otherwise it reflects its own RTT.
  water.addReflectors(reflectors);

  const visuals = [...orbs.entries()];
  return {
    boatRoot,
    guardians,
    orbs,
    cloudMode: clouds.mode,
    waterMode: water.quality,
    update(_dt, elapsed, currentProgress) {
      portalFloorLight.update(elapsed);
      portalInnerFloorLight.update(elapsed);
      const portalPulse = 0.80 + 0.20 * Math.sin(elapsed * 1.7)
        + 0.09 * Math.sin(elapsed * 2.9);
      frameLight.intensity = (mobile ? 2.6 : 3.6) * portalPulse;
      water.update(elapsed);
      atmosphere.update(elapsed);
      const cameraPosition = scene.activeCamera?.globalPosition ?? Vector3.Zero();
      clouds.update(elapsed, cameraPosition);
      portalFalls.update(elapsed, cameraPosition);
      levelPortals.update(elapsed);
      const bx = boatRoot.position.x;
      const bz = boatRoot.position.z;
      boatRoot.position.y = CFG.riverY + .25 + water.sampleHeight(bx, bz, elapsed);
      const leftH = water.sampleHeight(bx - 3.7, bz, elapsed);
      const rightH = water.sampleHeight(bx + 3.7, bz, elapsed);
      const frontH = water.sampleHeight(bx, bz + 5.5, elapsed);
      const rearH = water.sampleHeight(bx, bz - 5.5, elapsed);
      boatRoot.rotation.z = Math.atan2(leftH - rightH, 7.4);
      boatRoot.rotation.x = Math.atan2(rearH - frontH, 11);
      const numberFreed = visuals.filter(([id]) => currentProgress[id] === true).length;
      let freedIndex = 0;
      for (const [id, v] of visuals) {
        const isFreed = currentProgress[id] === true;
        v.sphere.material = isFreed ? freed : gold;
        if (isFreed) {
          // The freed lights leave their cages and accompany the raft.
          const angle = (freedIndex++ / Math.max(1, numberFreed)) * Math.PI * 2 + elapsed * .12;
          v.sphere.position.set(
            boatRoot.position.x + Math.cos(angle) * 3,
            boatRoot.position.y + 5.5 + Math.sin(elapsed * .8 + freedIndex) * .4,
            boatRoot.position.z + Math.sin(angle) * 3
          );
        } else {
          v.sphere.position.copyFrom(v.home);
        }
        v.halo.position.copyFrom(v.sphere.position);
        v.light.position.copyFrom(v.sphere.position);
        v.sphere.scaling.setAll(1 + Math.sin(elapsed * .83 + v.home.z) * .045);
        v.halo.scaling.setAll(1 + Math.sin(elapsed * .51 + v.home.x) * .1);
        const dx = v.sphere.position.x - boatRoot.position.x;
        const dz = v.sphere.position.z - boatRoot.position.z;
        const nearby = dx * dx + dz * dz < 160 * 160;
        v.light.setEnabled(nearby);
        if (nearby) v.light.intensity = isFreed ? .15 : .52 + .12 * Math.sin(elapsed * 1.6);
      }
    },
  };
}
