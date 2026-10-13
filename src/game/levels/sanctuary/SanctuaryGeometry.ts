import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { Scene } from "@babylonjs/core/scene";
import { SANCTUARY_CONFIG as CFG, SANCTUARY_ASCENT as ASCENT, SANCTUARY_STOPS,
  sanctuaryFlightStartZ, type SanctuaryPillarId, type SanctuaryProgress } from "./SanctuaryLayout";
import { createSanctuaryWater } from "./SanctuaryWater";
import { createSanctuaryClouds, type SanctuaryCloudMode } from "./SanctuaryClouds";
import { createSanctuaryStoneMaterials } from "./SanctuaryStone";
import { createSanctuaryAtmosphere } from "./SanctuaryAtmosphere";

export type OrbVisual = { sphere: AbstractMesh; halo: AbstractMesh; light: PointLight; home: Vector3 };
export type SanctuaryGeometry = {
  boatRoot: TransformNode;
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
#ifdef FOG
float sanctuaryLateralDistance = abs(vPositionW.x);
if (sanctuaryLateralDistance > 2900.0) {
  float sanctuaryLateralMist = smoothstep(2900.0, 7800.0, sanctuaryLateralDistance);
  float sanctuaryMistDither = fract(52.9829189 * fract(
    0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
  if (sanctuaryMistDither < sanctuaryLateralMist) discard;
}
#endif
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
    }
    const u = Math.hypot(...first) / 24;
    const v = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) / 24;
    uvs.push(0, 0, u, 0, u, v, 0, v);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  // Extrude one continuous closed profile per side. Internal caps at every rest
  // used to coincide and could read as dark gaps instead of solid stone.
  const profile: Array<[number, number]> = [[ASCENT.stairStartZ, ASCENT.lowerY + 12]];
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

function createShadowHand(scene: Scene, x: number, z: number, scale: number, shadow: StandardMaterial) {
  const root = new TransformNode(`shadowHand_${x}_${z}`, scene);
  root.position.set(x, CFG.riverY - 3, z);
  root.rotation.y = (x + z) * .029;
  slab(scene, "shadowPalm", 4.0 * scale, 8 * scale, 2.4 * scale, [0, 4 * scale, 0], shadow, root);
  for (let n = 0; n < 4; n++) {
    const finger = MeshBuilder.CreateCylinder(`shadowFinger_${n}`, {
      height: (10 + (n % 2) * 4) * scale,
      diameterTop: .12 * scale,
      diameterBottom: 1.7 * scale,
      tessellation: 5,
    }, scene);
    finger.parent = root;
    finger.position.set((n - 1.5) * 1.2 * scale, (12 + (n % 2) * 2) * scale, 0);
    finger.rotation.z = (n - 1.5) * .24;
    finger.material = shadow;
    finger.isPickable = false;
  }
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

export function createSanctuaryGeometry(scene: Scene, progress: SanctuaryProgress, mobile: boolean): SanctuaryGeometry {
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
  const stone = createSanctuaryStoneMaterials(scene, mobile,
    params?.get("sanctuaryHeightFog") !== "off", stoneVariant);
  const reflectors: AbstractMesh[] = [];
  const water = createSanctuaryWater(scene, mobile || params?.get("sanctuaryWater") === "lite");
  const black = mat(scene, "sanctuaryObsidan", new Color3(.017,.018,.022));
  const concrete = stone.pillar;
  const upperStructure = stone.upperStructure;
  const wallMat = stone.wall;
  const stairsMat = stone.stairs;
  new SanctuaryLateralBrumePlugin(wallMat);
  const wood = mat(scene, "sanctuaryBoatWood", new Color3(.087,.052,.05));
  const ember = mat(scene, "sanctuaryPortalEmber", new Color3(.42,.045,.031), new Color3(.32,.037,.024));
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

  // Top of wall is geometrically thousands of metres high and swallowed by red atmosphere.
  const wallHalfWidth = 24000;
  const gap = CFG.gateWidth;
  const wallHeight = 9000;
  const wallBottom = -8;
  const wallTop = wallBottom + wallHeight;
  const portalTop = ASCENT.upperY + ASCENT.portalHeight;
  // Beyond the accessible route, the long stone wings dissolve into the sky
  // before the camera can clip them; there are no return or rear walls.
  // Stone modules retain their texture scale, then merge to keep two wall draw calls.
  for (const side of [-1, 1]) {
    const modules: Mesh[] = [];
    for (let segment = 0; segment < 8; segment++) {
      const inner = gap / 2 + (wallHalfWidth - gap / 2) * segment / 8;
      const outer = gap / 2 + (wallHalfWidth - gap / 2) * (segment + 1) / 8;
      modules.push(slab(scene, `wallStoneModule_${side}_${segment}`, outer - inner, wallHeight,
        ASCENT.wallDepth, [side * (inner + outer) / 2, wallHeight / 2 + wallBottom, CFG.gateWallZ], wallMat));
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
  reflectors.push(slab(scene, "wallGateLower", gap + 4, ASCENT.upperY - wallBottom, ASCENT.wallDepth,
    [0, (ASCENT.upperY + wallBottom) / 2, CFG.gateWallZ], wallMat));
  reflectors.push(slab(scene, "wallGateLintel", gap + 4, wallTop - portalTop, ASCENT.wallDepth,
    [0, (wallTop + portalTop) / 2, CFG.gateWallZ], wallMat));
  reflectors.push(slab(scene, "gateRedVoid", gap - 13, ASCENT.portalHeight, 2,
    [0, ASCENT.upperY + ASCENT.portalHeight / 2, CFG.gateWallZ + ASCENT.wallDepth / 2 - 3.5], ember));
  for (const x of [-gap / 2, gap / 2]) {
    slab(scene, "gateJaw", 12, ASCENT.portalHeight, ASCENT.wallDepth,
      [x, ASCENT.upperY + ASCENT.portalHeight / 2, CFG.gateWallZ], black);
  }

  // Four steep flights and three level rests, all merged into one static stone draw call.
  const stairParts: Mesh[] = [];
  const foundationY = CFG.riverY - 1;
  const baseTopY = ASCENT.upperY - 22;
  const baseFrontZ = ASCENT.stairEndZ - 14;
  const baseBackZ = ASCENT.wallFrontZ + 10;
  const baseSegments: Mesh[] = [];
  baseSegments.push(slab(scene, "sanctuaryWallBaseCenter", 3000,
    baseTopY - foundationY, baseBackZ - baseFrontZ,
    [0, (baseTopY + foundationY) / 2, (baseFrontZ + baseBackZ) / 2], stairsMat));
  for (const side of [-1, 1]) {
    for (let segment = 0; segment < 8; segment++) {
      const inner = 1500 + segment * 3000;
      const outer = Math.min(wallHalfWidth, inner + 3000);
      baseSegments.push(slab(scene, `sanctuaryWallBase_${side}_${segment}`, outer - inner,
        baseTopY - foundationY, baseBackZ - baseFrontZ,
        [side * (inner + outer) / 2, (baseTopY + foundationY) / 2,
          (baseFrontZ + baseBackZ) / 2], stairsMat));
    }
  }
  const mergedBase = Mesh.MergeMeshes(baseSegments, true, true);
  if (mergedBase) {
    mergedBase.name = "sanctuaryContinuousWallBase";
    mergedBase.material = stairsMat;
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
          (ASCENT.stairEndZ + ASCENT.wallFrontZ) / 2], stairsMat);
      part.receiveShadows = false;
      wingParts.push(part);
    }
    const mergedWing = Mesh.MergeMeshes(wingParts, true, true);
    if (mergedWing) {
      mergedWing.name = side < 0 ? "sanctuaryUpperPlinthLeft" : "sanctuaryUpperPlinthRight";
      mergedWing.material = stairsMat;
      mergedWing.isPickable = false;
      mergedWing.receiveShadows = false;
    }
  }
  createStairParapets(scene, stone.parapet, foundationY);
  // Future narrow cascades: x=-590..-530 and +530..+590, in front of the
  // stepped stone facade, with open water before baseFrontZ for their impact.
  // No cascade geometry or water changes belong to this phase.

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

    // Reachable landing for future LevelGate interactions.
    const dockX = stop.x + stop.side * 27;
    slab(scene, `${stop.id}_landing`, 55, 2.5, 60, [dockX, .8, stop.z], concrete);
    slab(scene, `${stop.id}_pier`, 45, 1.6, 22, [stop.x + stop.side * 13, .65, stop.z], stairsMat);
    slab(scene, `${stop.id}_doorSlab`, 4, 16, 24, [stop.x + stop.side * 51, 8.5, stop.z + 8], black);
    slab(scene, `${stop.id}_doorGlow`, 1.2, 10, 10, [stop.x + stop.side * 49, 7.5, stop.z + 8], ember);
  }

  // Uncanny, organic shadows: deliberately sparse to keep the entrance and stairway clear.
  [
    [-310, -260, 1.35], [300, -30, 1.6], [-355, 190, 1.4],
    [345, 420, 1.8], [-385, 670, 2.1], [380, 915, 1.4]
  ].forEach(([x, z, s]) => createShadowHand(scene, x, z, s, black));

  // A spare wooden raft with enough space for the existing character model.
  const boatRoot = new TransformNode("sanctuaryBoat", scene);
  slab(scene, "raftDeck", 7.4, .6, 11.3, [0, .35, 0], wood, boatRoot);
  for (const x of [-3.7, 3.7]) {
    slab(scene, "raftRail", .25, .9, 10.5, [x, 1.05, 0], wood, boatRoot);
  }
  for (const z of [-5.1, 5.1]) slab(scene, "raftEnd", 7.5, .4, .5, [0, .74, z], wood, boatRoot);
  boatRoot.position.set(0, CFG.riverY + .05, CFG.boatStartZ);

  // Render-to-texture reflections only include a small, stable scene subset.
  // Excluding the water itself is essential: otherwise it reflects its own RTT.
  water.addReflectors(reflectors);

  const visuals = [...orbs.entries()];
  return {
    boatRoot,
    orbs,
    cloudMode: clouds.mode,
    waterMode: water.quality,
    update(_dt, elapsed, currentProgress) {
      water.update(elapsed);
      atmosphere.update(elapsed);
      const cameraPosition = scene.activeCamera?.globalPosition ?? Vector3.Zero();
      clouds.update(elapsed, cameraPosition);
      const bx = boatRoot.position.x;
      const bz = boatRoot.position.z;
      boatRoot.position.y = CFG.riverY + .10 + water.sampleHeight(bx, bz, elapsed);
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
