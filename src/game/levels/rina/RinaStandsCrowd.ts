import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Scene } from "@babylonjs/core/scene";
import type { Light } from "@babylonjs/core/Lights/light";
import {
  getRinaSideStandAudienceAnchor,
  RINA_DOUBLE_TIER_PROFILE,
} from "./RinaDoubleTierSideStands";
import { RINA_BACK_STAND_LED_PROFILE } from "./RinaBackStandExit";
import { RINA_STADIUM_SCALE } from "./RinaLevelConfig";
import { RINA_ANIMATED_FAN_CLEARANCE, RINA_CROWD_FANS,
  type RinaCrowdQuality } from "./crowd/RinaCrowdAssetManifest";
import { RinaCrowdAssetRegistry } from "./crowd/RinaCrowdAssetRegistry";

/**
 * UPDATE 06 — real procedural 3D people for NON-INTERACTIVE stadium seating.
 *
 * Three procedural mesh complexities remain as the fallback. A bounded subset
 * is replaced with posed or animated GLB thin instances after the shared models load.
 *
 * IMPORTANT: source geometry is authored in LOCAL stadium units.  The stadium
 * root scales it by RINA_STADIUM_SCALE. Human height is therefore ~1.70 m
 * in world space, not 1.70 * RINA_STADIUM_SCALE.
 *
 * The 2K fan is reserved for the field crowd; the stands use its 1K version.
 * Never place these spectators into EnemyManager.
 */
export type RinaStandsCrowdTier = "desktop" | "mobile";
export type RinaStandsCrowdLod = "near" | "middle" | "far";

type Color = readonly [number, number, number];
type V3 = readonly [number, number, number];

type Pose = "relaxed" | "one-hand-up" | "both-hands-up" | "clapping";
type Outfit = Readonly<{
  shirt: Color;
  pants: Color;
  skin: Color;
  hair: Color;
  pose: Pose;
  longHair?: boolean;
  phone?: boolean;
}>;

type Placement = Readonly<{
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  phase: number;
}>;

type Prototype = {
  mesh: Mesh;
  placements: Placement[];
  matrixData: Float32Array;
  lod: RinaStandsCrowdLod;
};

type CrowdCandidate = { prototype: Prototype; placement: Placement };

export interface RinaStandsCrowdHandle {
  readonly root: TransformNode;
  readonly counts: Readonly<{ near: number; middle: number; far: number; total: number }>;
  readonly assetMetrics: Readonly<{ loadedVariants: number; spectatorsByVariant: Readonly<Record<string, number>>; activeRigs: number; approximateBytes: number }>;
  update(dt: number, beatPulse: number): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** Tunable without changing the positions/geometry of existing stands. */
export const RINA_STANDS_CROWD_CONFIG = {
  desktopFanNearLimit: 12,
  desktopFanMiddleLimit: 160,
  mobileFanMiddleLimit: 40,
  sideZMin: -51,
  sideZMax: 30,
  aisleExtraClearance: 0.32,
  rearExitExtraClearance: 0.75,
  desktop: {
    nearSpacing: 0.88,
    middleSpacing: 1.02,
    farSpacing: 1.20,
    fillNear: 0.83,
    fillMiddle: 0.80,
    fillFar: 0.71,
    danceFrameSeconds: 0.095,
  },
  mobile: {
    nearSpacing: 1.44,
    middleSpacing: 1.64,
    farSpacing: 1.95,
    fillNear: 0.64,
    fillMiddle: 0.61,
    fillFar: 0.52,
    danceFrameSeconds: Infinity,
  },
} as const;

const NEAR_OUTFITS: readonly Outfit[] = [
  { shirt: [0.10, 0.11, 0.14], pants: [0.06, 0.09, 0.15], skin: [0.68, 0.43, 0.29], hair: [0.08, 0.065, 0.06], pose: "both-hands-up" },
  { shirt: [0.34, 0.06, 0.18], pants: [0.08, 0.085, 0.105], skin: [0.84, 0.59, 0.43], hair: [0.22, 0.115, 0.08], pose: "one-hand-up", longHair: true },
  { shirt: [0.55, 0.53, 0.48], pants: [0.12, 0.14, 0.21], skin: [0.72, 0.46, 0.33], hair: [0.10, 0.09, 0.07], pose: "relaxed" },
  { shirt: [0.07, 0.14, 0.18], pants: [0.075, 0.075, 0.09], skin: [0.94, 0.71, 0.53], hair: [0.46, 0.33, 0.20], pose: "clapping" },
  { shirt: [0.21, 0.19, 0.26], pants: [0.15, 0.18, 0.25], skin: [0.53, 0.32, 0.23], hair: [0.04, 0.045, 0.055], pose: "both-hands-up", longHair: true },
  { shirt: [0.09, 0.085, 0.095], pants: [0.20, 0.20, 0.22], skin: [0.87, 0.64, 0.47], hair: [0.10, 0.07, 0.055], pose: "one-hand-up", phone: true },
  { shirt: [0.23, 0.30, 0.33], pants: [0.09, 0.095, 0.12], skin: [0.74, 0.49, 0.35], hair: [0.07, 0.06, 0.065], pose: "relaxed", longHair: true },
  { shirt: [0.40, 0.38, 0.41], pants: [0.07, 0.10, 0.16], skin: [0.95, 0.70, 0.52], hair: [0.12, 0.09, 0.10], pose: "clapping" },
];
const MID_OUTFITS: readonly Outfit[] = [
  NEAR_OUTFITS[0], NEAR_OUTFITS[1], NEAR_OUTFITS[2],
  NEAR_OUTFITS[3], NEAR_OUTFITS[5], NEAR_OUTFITS[6],
];
const FAR_OUTFITS: readonly Outfit[] = [
  NEAR_OUTFITS[0], NEAR_OUTFITS[2], NEAR_OUTFITS[3], NEAR_OUTFITS[4],
];

const OUTFITS: Readonly<Record<RinaStandsCrowdLod, readonly Outfit[]>> = {
  near: NEAR_OUTFITS,
  middle: MID_OUTFITS,
  far: FAR_OUTFITS,
};

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

type ShapeData = {
  positions: number[];
  indices: number[];
  colors: number[];
};

/** Each quad has four separate vertices for flat, concert-friendly facets. */
function quad(d: ShapeData, a: V3, b: V3, c: V3, e: V3, color: Color, shade = 1) {
  const offset = d.positions.length / 3;
  for (const p of [a, b, c, e]) {
    d.positions.push(p[0], p[1], p[2]);
    d.colors.push(
      clamp(color[0] * shade, 0, 1),
      clamp(color[1] * shade, 0, 1),
      clamp(color[2] * shade, 0, 1), 1,
    );
  }
  d.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

function tri(d: ShapeData, a: V3, b: V3, c: V3, color: Color, shade = 1) {
  const offset = d.positions.length / 3;
  for (const p of [a, b, c]) {
    d.positions.push(p[0], p[1], p[2]);
    d.colors.push(
      clamp(color[0] * shade, 0, 1),
      clamp(color[1] * shade, 0, 1),
      clamp(color[2] * shade, 0, 1), 1,
    );
  }
  d.indices.push(offset, offset + 1, offset + 2);
}

function sixSides(d: ShapeData, bottom: readonly V3[], top: readonly V3[], color: Color) {
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(d, bottom[j], bottom[i], top[i], top[j], color, [0.79, 0.93, 1, 0.81][i]);
  }
  quad(d, bottom[0], bottom[1], bottom[2], bottom[3], color, 0.7);
  quad(d, top[3], top[2], top[1], top[0], color, 1.07);
}

/** Tapered square-section limb from bottom to top in local XY. */
function limb(d: ShapeData, a: V3, b: V3, sizeA: number, sizeB: number, depth: number, color: Color) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.max(0.0001, Math.hypot(dx, dy));
  const ox = -dy / len;
  const oy = dx / len;
  const corners = (p: V3, w: number): V3[] => [
    [p[0] - ox * w, p[1] - oy * w, p[2] - depth],
    [p[0] + ox * w, p[1] + oy * w, p[2] - depth],
    [p[0] + ox * w, p[1] + oy * w, p[2] + depth],
    [p[0] - ox * w, p[1] - oy * w, p[2] + depth],
  ];
  sixSides(d, corners(a, sizeA), corners(b, sizeB), color);
}

function block(d: ShapeData, x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number, color: Color) {
  const base: V3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
  const high: V3[] = [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  sixSides(d, base, high, color);
}

/** Low-poly head with front (+Z) and distinguishable hair cap. */
function roundedHead(d: ShapeData, x: number, y: number, color: Color, segments: number) {
  const radiusX = 0.094, radiusY = 0.123, radiusZ = 0.081;
  const low = y - radiusY * 0.70;
  const high = y + radiusY * 0.69;
  const rings: V3[][] = [];
  for (const [ry, scale] of [[low, 0.67], [y, 1], [high, 0.68]] as const) {
    const points: V3[] = [];
    for (let i = 0; i < segments; i++) {
      const t = i * Math.PI * 2 / segments;
      points.push([x + Math.cos(t) * radiusX * scale, ry,
        Math.sin(t) * radiusZ * scale]);
    }
    rings.push(points);
  }
  const [bottom, center, top] = rings;
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    quad(d, bottom[j], bottom[i], center[i], center[j], color);
    quad(d, center[j], center[i], top[i], top[j], color, 1.035);
    tri(d, top[i], [x, y + radiusY, 0], top[j], color, 1.07);
    tri(d, bottom[i], bottom[j], [x, y - radiusY, 0], color, 0.88);
  }
}

/** A silhouette is still a person in every LOD — never a cylinder. */
function generateFigure(lod: RinaStandsCrowdLod, outfit: Outfit) {
  const d: ShapeData = { positions: [], indices: [], colors: [] };
  const near = lod === "near";
  const far = lod === "far";
  // All values in LOCAL stadium units. 1.14 * 1.5 ~= 1.71 m tall.
  // Separated feet + trouser legs are legible even in the far archetype.
  for (const sign of [-1, 1]) {
    limb(d, [sign * 0.10, 0.075, 0], [sign * 0.088, 0.49, 0],
      0.049, 0.070, 0.074, outfit.pants);
    if (!far) block(d, sign * 0.10 - 0.079, 0.016, 0.018,
      sign * 0.10 + 0.079, 0.075, 0.155, [0.047, 0.05, 0.065]);
  }
  // Torso with waist narrower than the shoulders, not a simple capsule.
  const shirtDepth = far ? 0.074 : 0.093;
  sixSides(d,
    [[-0.145, 0.50, -shirtDepth], [0.145, 0.50, -shirtDepth],
      [0.145, 0.50, shirtDepth], [-0.145, 0.50, shirtDepth]],
    [[-0.205, 0.92, -shirtDepth], [0.205, 0.92, -shirtDepth],
      [0.205, 0.92, shirtDepth], [-0.205, 0.92, shirtDepth]],
    outfit.shirt);
  // Neck / faceted head (more polygons for front-row spectators).
  if (near) block(d, -0.049, 0.899, -0.049, 0.049, 0.99, 0.049, outfit.skin);
  roundedHead(d, 0, 1.024, outfit.skin, near ? 8 : far ? 5 : 6);
  // Cap and different hair silhouettes: human detail without alpha cards.
  block(d, -0.104, 1.091, -0.080, 0.104, 1.145, 0.07, outfit.hair);
  if (outfit.longHair && !far) {
    block(d, -0.109, 0.86, -0.104, -0.069, 1.10, 0.035, outfit.hair);
    block(d, 0.069, 0.86, -0.104, 0.109, 1.10, 0.035, outfit.hair);
  }
  if (!far) {
    const liftedLeft = outfit.pose === "both-hands-up" || outfit.pose === "clapping";
    const liftedRight = outfit.pose === "both-hands-up" || outfit.pose === "one-hand-up" || outfit.pose === "clapping";
    for (const sign of [-1, 1]) {
      const lifted = sign < 0 ? liftedLeft : liftedRight;
      const clapping = outfit.pose === "clapping";
      const shoulder: V3 = [sign * 0.208, 0.879, 0];
      const elbow: V3 = clapping ? [sign * 0.275, 0.79, 0.10]
        : lifted ? [sign * 0.299, 0.992, 0.02]
        : [sign * 0.275, 0.689, 0.012];
      const wrist: V3 = clapping ? [sign * 0.052, 0.915, 0.178]
        : lifted ? [sign * 0.335, 1.142, 0.07]
        : [sign * 0.26, 0.545, 0.055];
      limb(d, elbow, shoulder, 0.050, 0.059, 0.055, outfit.shirt);
      limb(d, wrist, elbow, 0.033, 0.044, 0.039, outfit.skin);
      if (near) {
        block(d, wrist[0] - 0.039, wrist[1] - 0.044, wrist[2] - 0.027,
          wrist[0] + 0.039, wrist[1] + 0.041, wrist[2] + 0.027, outfit.skin);
        if (outfit.phone && sign === 1) {
          block(d, wrist[0] - 0.030, wrist[1] + 0.030, wrist[2] + 0.025,
            wrist[0] + 0.030, wrist[1] + 0.115, wrist[2] + 0.038,
            [0.43, 0.69, 0.74]);
        }
      }
    }
  } else {
    // Far spectators retain recognisable shoulders/arms at stadium distance.
    limb(d, [-0.255, 0.63, 0.0], [-0.202, 0.88, 0.0],
      0.036, 0.05, 0.055, outfit.shirt);
    limb(d, [0.255, 0.63, 0.0], [0.202, 0.88, 0.0],
      0.036, 0.05, 0.055, outfit.shirt);
  }
  const vd = new VertexData();
  vd.positions = d.positions;
  vd.indices = d.indices;
  vd.colors = d.colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(d.positions, d.indices, normals);
  vd.normals = normals;
  return vd;
}

/** Zero-allocation column-major Y-rotation + translation matrix. */
function writeMatrix(buffer: Float32Array, offset: number, p: Placement, bounce = 0, turn = 0) {
  const yaw = p.yaw + turn;
  const c = Math.cos(yaw) * p.scale;
  const s = Math.sin(yaw) * p.scale;
  buffer[offset] = c;
  buffer[offset + 1] = 0;
  buffer[offset + 2] = -s;
  buffer[offset + 3] = 0;
  buffer[offset + 4] = 0;
  buffer[offset + 5] = p.scale;
  buffer[offset + 6] = 0;
  buffer[offset + 7] = 0;
  buffer[offset + 8] = s;
  buffer[offset + 9] = 0;
  buffer[offset + 10] = c;
  buffer[offset + 11] = 0;
  buffer[offset + 12] = p.x;
  buffer[offset + 13] = p.y + bounce;
  buffer[offset + 14] = p.z;
  buffer[offset + 15] = 1;
}

function lodForRow(tier: "side-lower" | "side-upper" | "rear-lower" | "rear-upper", row: number): RinaStandsCrowdLod {
  if (tier === "side-lower") return row < 4 ? "near" : row < 8 ? "middle" : "far";
  if (tier === "side-upper") return row < 2 ? "middle" : "far";
  if (tier === "rear-lower") return row < 3 ? "near" : row < 6 ? "middle" : "far";
  return "far";
}

/**
 * Build spectators from the *actual* seating formulas, preserving side aisles,
 * lower rear central EXIT opening and back-row stair strips.
 */
export function createRinaStandsCrowd(scene: Scene, tier: RinaStandsCrowdTier,
    actorLights: readonly Light[]): RinaStandsCrowdHandle {
  const root = new TransformNode("rinaStandsCrowdRoot", scene);
  const settings = RINA_STANDS_CROWD_CONFIG[tier];
  const random = lcg(0x51a0c26d);
  const prototypes = new Map<string, Prototype>();
  const registry = new RinaCrowdAssetRegistry(scene, actorLights);
  const candidatePool: Record<RinaCrowdQuality, CrowdCandidate[]> = {
    near: [], middle: [],
  };
  const animatedCandidates: Record<"front" | "side" | "rear", CrowdCandidate[]> = {
    front: [], side: [], rear: [],
  };
  const fanGroups: { mesh: Mesh; placements: Placement[]; matrixData: Float32Array;
    quality: RinaCrowdQuality; inverseMeshWorld?: Matrix }[] = [];
  const animatedGroups: { clips: readonly AnimationGroup[]; playingIndex: number }[] = [];
  const spectatorsByVariant: Record<string, number> = {};
  let approximateBytes = 0;
  const materials: StandardMaterial[] = [];
  const counts = { near: 0, middle: 0, far: 0, total: 0 };

  for (const lod of ["near", "middle", "far"] as const) {
    const mat = new StandardMaterial(`rinaStandsCrowdMaterial_${lod}`, scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = new Color3(0.038, 0.039, 0.047);
    mat.backFaceCulling = true;
    materials.push(mat);
    OUTFITS[lod].forEach((outfit, index) => {
      const mesh = new Mesh(`rinaStandsCrowd_${lod}_${index}`, scene);
      generateFigure(lod, outfit).applyToMesh(mesh, false);
      mesh.useVertexColors = true;
      mesh.hasVertexAlpha = false;
      mesh.material = mat;
      mesh.parent = root;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.receiveShadows = false;
      prototypes.set(`${lod}_${index}`, { mesh, placements: [], matrixData: new Float32Array(), lod });
    });
  }

  function place(lod: RinaStandsCrowdLod, x: number, y: number, z: number, yaw: number,
      section: "side" | "rear") {
    const index = Math.floor(random() * OUTFITS[lod].length);
    const proto = prototypes.get(`${lod}_${index}`)!;
    const scale = (0.91 + random() * 0.17) * (1.5 / RINA_STADIUM_SCALE);
    const placement = { x, y, z, yaw: yaw + (random() - 0.5) * 0.22,
      scale, phase: random() * Math.PI * 2 };
    proto.placements.push(placement);
    const candidate = { prototype: proto, placement };
    if (lod !== "far") candidatePool[lod].push(candidate);
    if (lod === "near") animatedCandidates.front.push(candidate);
    if (section === "rear" && lod !== "near") animatedCandidates.rear.push(candidate);
    if (section === "side" && lod === "middle") animatedCandidates.side.push(candidate);
    counts[lod]++;
    counts.total++;
  }

  function spacing(lod: RinaStandsCrowdLod) {
    return settings[lod === "near" ? "nearSpacing" : lod === "middle" ? "middleSpacing" : "farSpacing"];
  }
  function fill(lod: RinaStandsCrowdLod) {
    return settings[lod === "near" ? "fillNear" : lod === "middle" ? "fillMiddle" : "fillFar"];
  }

  const p = RINA_DOUBLE_TIER_PROFILE;
  for (const side of [-1, 1] as const) {
    for (const standTier of ["lower", "upper"] as const) {
      const totalRows = standTier === "lower" ? p.lowerRows : p.upperRows;
      for (let row = 0; row < totalRows; row++) {
        const lod = lodForRow(standTier === "lower" ? "side-lower" : "side-upper", row);
        const step = spacing(lod);
        const count = Math.floor((RINA_STANDS_CROWD_CONFIG.sideZMax - RINA_STANDS_CROWD_CONFIG.sideZMin) / step);
        for (let col = 0; col < count; col++) {
          if (random() > fill(lod)) continue;
          const z = RINA_STANDS_CROWD_CONFIG.sideZMin + (col + 0.5) * step + (random() - 0.5) * step * 0.28;
          if (p.aislePositions.some(aisleZ => Math.abs(z - aisleZ) < p.aisleHalfWidth + RINA_STANDS_CROWD_CONFIG.aisleExtraClearance)) continue;
          const anchor = getRinaSideStandAudienceAnchor(side, standTier, row, z);
          const xOffset = (random() - 0.5) * (standTier === "lower" ? p.lowerTread : p.upperTread) * 0.11;
          place(lod, anchor.x + side * xOffset, anchor.y, z, (random() - 0.5) * 0.15, "side");
        }
      }
    }
  }

  // Back stand geometry is authored separately from the side stands. Match
  // its actual row centers and top surfaces rather than interpolating a ramp.
  const rear = RINA_BACK_STAND_LED_PROFILE;
  const lowerStartZ = rear.rearZ - 3.0;
  const lowerTopY = 0.45 + (rear.lowerRows - 1) * rear.rowHeight + rear.rowHeight * 0.5;
  const upperRows = 11; // Current RinaBackStandExit upper bowl has 11 rows.
  const upperStartZ = rear.rearZ - rear.lowerRows * rear.lowerRowDepth
    - rear.concourseDepth - 2.35;
  const upperStartY = lowerTopY + rear.concourseHeight + 0.75;
  for (const standTier of ["lower", "upper"] as const) {
    const rows = standTier === "lower" ? rear.lowerRows : upperRows;
    for (let row = 0; row < rows; row++) {
      const lod = lodForRow(standTier === "lower" ? "rear-lower" : "rear-upper", row);
      const rowHalfWidth = standTier === "lower" ? rear.halfWidth
        : (rear.halfWidth * 2 - row * 1.0) * 0.5;
      const spanX = rowHalfWidth - 0.85;
      const step = spacing(lod);
      const colCount = Math.floor(spanX * 2 / step);
      const rowY = standTier === "lower"
        ? 0.45 + row * rear.rowHeight + rear.rowHeight * 0.5 + 0.07
        : upperStartY + row * rear.rowHeight + rear.rowHeight * 0.5 + 0.07;
      const rowZ = standTier === "lower"
        ? lowerStartZ - row * rear.lowerRowDepth
        : upperStartZ - row * 1.55;
      for (let col = 0; col < colCount; col++) {
        if (random() > fill(lod)) continue;
        const x = -spanX + (col + 0.5) * step + (random() - 0.5) * step * 0.28;
        if (standTier === "lower" &&
            Math.abs(x) < rear.openingHalfWidth + RINA_STANDS_CROWD_CONFIG.rearExitExtraClearance) continue;
        // Omit the rear-stand aisle/stair regions.
        if (Math.abs(Math.abs(x) - (rear.halfWidth - 8.5)) < 1.45) continue;
        if (standTier === "upper" && [-22, 0, 22].some(ax => Math.abs(x - ax) < 0.75)) continue;
        place(lod, x, rowY, rowZ + (random() - 0.5) * 0.17, (random() - 0.5) * 0.21, "rear");
      }
    }
  }

  // One mutable matrix buffer per near archetype; middle and distant groups
  // are static. We never allocate new Babylon matrices in the update loop.
  function refreshPrototype(prototype: Prototype) {
    if (prototype.placements.length === 0) {
      prototype.mesh.setEnabled(false);
      return;
    }
    const data = new Float32Array(prototype.placements.length * 16);
    for (let i = 0; i < prototype.placements.length; i++) {
      writeMatrix(data, i * 16, prototype.placements[i]);
    }
    prototype.matrixData = data;
    prototype.mesh.thinInstanceSetBuffer("matrix", data, 16, prototype.lod !== "near" || tier === "mobile");
    prototype.mesh.thinInstanceRefreshBoundingInfo(true);
  }
  for (const prototype of prototypes.values()) refreshPrototype(prototype);

  let disposed = false;
  let elapsed = 0;
  let danceAccumulator = 0;

  function evenlySelected(pool: readonly CrowdCandidate[], limit: number) {
    const count = Math.min(limit, pool.length);
    return Array.from({ length: count }, (_, i) => pool[Math.floor((i + 0.5) * pool.length / count)]);
  }

  // Thin-instance transforms run after the imported mesh's own glTF parent
  // transforms. Cancel those transforms so seating coordinates remain in
  // stadium-local units even when the GLB has an Armature scale of 0.01.
  const desired = Matrix.Identity();
  const instanceMatrix = Matrix.Identity();
  function writeAnimatedMatrix(buffer: Float32Array, offset: number, placement: Placement,
      inverseMeshWorld: Matrix, bounce = 0, turn = 0) {
    writeMatrix(buffer, offset, placement, bounce, turn);
    Matrix.FromArrayToRef(buffer, offset, desired);
    desired.multiplyToRef(inverseMeshWorld, instanceMatrix);
    instanceMatrix.copyToArray(buffer, offset);
  }

  for (const quality of ["near", "middle"] as const) {
    const limit = quality === "near"
      ? (tier === "desktop" ? RINA_STANDS_CROWD_CONFIG.desktopFanNearLimit : 0)
      : (tier === "desktop" ? RINA_STANDS_CROWD_CONFIG.desktopFanMiddleLimit : RINA_STANDS_CROWD_CONFIG.mobileFanMiddleLimit);
    // Animated spectators use the cheap 1K variant in the stands.
    const eligibleFans = RINA_CROWD_FANS.filter(fan => quality !== "near" || !fan.animationNames);
    if (!limit || eligibleFans.length === 0) continue;
    const posedFans = eligibleFans.filter(fan => !fan.animationNames);
    const selected = posedFans.length ? evenlySelected(candidatePool[quality], limit) : [];
    const posedSlots = Math.max(1, quality === "near" ? posedFans.length : posedFans.length + 1);
    const posedMembers = selected.filter((_, i) => i % posedSlots < posedFans.length);
    // Reserve placements synchronously, before either GLB finishes loading.
    // Animated archetypes must never claim the same seat.
    const occupied = posedMembers.map(member => member.placement);
    for (const fan of eligibleFans) {
      let members = fan.animationNames ? [] : selected.filter((_, i) =>
        i % posedSlots === posedFans.indexOf(fan));
      if (fan.animationNames) {
        const frontLimit = tier === "desktop" ? 3 : 0;
        const rearLimit = tier === "desktop" ? 48 : 12;
        const sideLimit = tier === "desktop" ? 20 : 4;
        const available = (pool: readonly CrowdCandidate[]) => pool.filter(member =>
          occupied.every(other => Math.hypot(member.placement.x - other.x,
            member.placement.z - other.z) >= RINA_ANIMATED_FAN_CLEARANCE));
        members = [
          ...evenlySelected(available(animatedCandidates.front), frontLimit),
          ...evenlySelected(available(animatedCandidates.rear), rearLimit),
          ...evenlySelected(available(animatedCandidates.side), sideLimit),
        ].filter(member => {
          const clear = occupied.every(other =>
            Math.hypot(member.placement.x - other.x, member.placement.z - other.z) >= RINA_ANIMATED_FAN_CLEARANCE);
          if (clear) occupied.push(member.placement);
          return clear;
        });
      }
      if (members.length === 0) continue;
      if (fan.animationNames) {
        void registry.loadAnimated(fan, quality, 1).then(groups => {
          if (!groups || disposed) return;
          const removed = new Set(members.map(member => member.placement));
          const touched = new Set(members.map(member => member.prototype));
          for (const prototype of prototypes.values()) {
            for (const placement of prototype.placements) {
              if (members.some(member => Math.hypot(
                placement.x - member.placement.x, placement.z - member.placement.z) < RINA_ANIMATED_FAN_CLEARANCE)) {
                removed.add(placement);
                touched.add(prototype);
              }
            }
          }
          for (const [index, group] of groups.entries()) {
            const assigned = members.filter((_, memberIndex) => memberIndex % groups.length === index);
            if (assigned.length === 0) continue;
            const { mesh } = group;
            mesh.computeWorldMatrix(true);
            const inverseMeshWorld = mesh.getWorldMatrix().clone().invert();
            const localHeight = mesh.getBoundingInfo().boundingBox.extendSize.y * 2;
            const factor = fan.targetWorldHeight / (localHeight * RINA_STADIUM_SCALE);
            const placements = assigned.map(({ placement }) => ({ ...placement,
              scale: factor * (1 + (placement.scale - 1) * 0.25) }));
            const matrixData = new Float32Array(placements.length * 16);
            for (let i = 0; i < placements.length; i++) {
              writeAnimatedMatrix(matrixData, i * 16, placements[i], inverseMeshWorld);
            }
            for (const node of group.roots) node.parent = root;
            mesh.thinInstanceSetBuffer("matrix", matrixData, 16, quality !== "near");
            mesh.thinInstanceRefreshBoundingInfo(true, true);
            fanGroups.push({ mesh, placements, matrixData, quality, inverseMeshWorld });
            const playingIndex = Math.floor(random() * group.clips.length);
            group.clips[playingIndex].start(false);
            animatedGroups.push({ clips: group.clips, playingIndex });
          }
          for (const prototype of touched) {
            prototype.placements = prototype.placements.filter(placement => !removed.has(placement));
            refreshPrototype(prototype);
          }
          spectatorsByVariant[`${fan.id}:${quality}`] = members.length;
          approximateBytes += fan.variants[quality].bytes;
        });
        continue;
      }
      void registry.loadPosed(fan, quality).then(mesh => {
        if (!mesh || disposed) return;
        mesh.parent = root;
        const factor = fan.targetWorldHeight / (fan.variants[quality].posedHeight! * RINA_STADIUM_SCALE);
        // Keep only slight stature variation; the imported fan should remain
        // taller than Rina even when the procedural placeholder was shorter.
        const placements = members.map(({ placement }) => ({ ...placement,
          scale: factor * (1 + (placement.scale - 1) * 0.25) }));
        const matrixData = new Float32Array(placements.length * 16);
        for (let i = 0; i < placements.length; i++) writeMatrix(matrixData, i * 16, placements[i]);
        mesh.thinInstanceSetBuffer("matrix", matrixData, 16, quality !== "near");
        mesh.thinInstanceRefreshBoundingInfo(true);
        fanGroups.push({ mesh, placements, matrixData, quality });
        const removed = new Set(members.map(member => member.placement));
        const touched = new Set(members.map(member => member.prototype));
        for (const prototype of touched) {
          prototype.placements = prototype.placements.filter(placement => !removed.has(placement));
          refreshPrototype(prototype);
        }
        const key = `${fan.id}:${quality}`;
        spectatorsByVariant[key] = placements.length;
        approximateBytes += fan.variants[quality].bytes;
      });
    }
  }

  return {
    root,
    counts,
    get assetMetrics() {
      return { loadedVariants: registry.loadedVariants, spectatorsByVariant: { ...spectatorsByVariant },
        activeRigs: registry.activeRigs, approximateBytes };
    },
    update(dt, beatPulse) {
      if (disposed || !root.isEnabled()) return;
      for (const group of animatedGroups) {
        if (group.clips[group.playingIndex].isPlaying) continue;
        // Choose a different clip each time a one-shot animation finishes.
        const next = Math.floor(random() * (group.clips.length - 1));
        group.playingIndex = next >= group.playingIndex ? next + 1 : next;
        group.clips[group.playingIndex].start(false);
      }
      if (tier === "mobile") return;
      const safeDt = clamp(dt, 0, 0.05);
      elapsed += safeDt;
      danceAccumulator += safeDt;
      if (danceAccumulator < settings.danceFrameSeconds) return;
      danceAccumulator = 0;
      const beat = clamp(beatPulse, 0, 1);
      for (const prototype of prototypes.values()) {
        if (prototype.lod !== "near" || prototype.placements.length === 0) continue;
        for (let i = 0; i < prototype.placements.length; i++) {
          const spectator = prototype.placements[i];
          const phase = elapsed * 2.15 + spectator.phase;
          const sway = Math.sin(phase) * 0.035;
          const bounce = Math.max(0, Math.sin(phase * 1.65)) * (0.011 + beat * 0.022);
          writeMatrix(prototype.matrixData, i * 16, spectator, bounce, sway);
        }
        prototype.mesh.thinInstanceBufferUpdated("matrix");
      }
      for (const group of fanGroups) {
        if (group.quality !== "near") continue;
        for (let i = 0; i < group.placements.length; i++) {
          const spectator = group.placements[i];
          const phase = elapsed * 2.15 + spectator.phase;
          const bounce = Math.max(0, Math.sin(phase * 1.65)) * (0.011 + beat * 0.022);
          const sway = Math.sin(phase) * 0.035;
          if (group.inverseMeshWorld) {
            writeAnimatedMatrix(group.matrixData, i * 16, spectator, group.inverseMeshWorld, bounce, sway);
          } else {
            writeMatrix(group.matrixData, i * 16, spectator, bounce, sway);
          }
        }
        group.mesh.thinInstanceBufferUpdated("matrix");
      }
    },
    setEnabled(enabled) {
      if (!disposed) root.setEnabled(enabled);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      registry.dispose();
      for (const prototype of prototypes.values()) {
        if (!prototype.mesh.isDisposed()) prototype.mesh.dispose();
      }
      root.dispose(false, false);
      for (const material of materials) material.dispose();
    },
  };
}
