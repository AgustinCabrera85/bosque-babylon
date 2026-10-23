import { RINA_STAGE_SECURITY, RINA_STADIUM } from "./RinaLevelConfig";

/**
 * Crowd islands / alleys on the FIELD, not the stands. Pure deterministic data.
 * Units are local to rinaStadiumRoot (the parent applies the 1.5x scale once).
 *
 * The solid crowd is the complement of the connected walking corridors inside
 * bounds. Gameplay collision and visual density MUST use this same layout.
 * The route network is moderately labyrinthine, not a grid or a maze puzzle:
 * it has several loops, rescue alcoves and a few short dead ends.
 */
export interface RinaCrowdMazePoint { readonly x: number; readonly z: number }
export interface RinaCrowdMazeBounds { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
export type RinaMazePassageKind = "spine" | "loop" | "spur";
export interface RinaCrowdMazePassage {
  readonly id: string;
  readonly a: RinaCrowdMazePoint;
  readonly b: RinaCrowdMazePoint;
  /** Walking corridor HALF-width; includes room for the player clearance. */
  readonly halfWidth: number;
  readonly kind: RinaMazePassageKind;
}
export interface RinaCrowdRescuePocket {
  readonly id: string;
  readonly label: string;
  readonly point: RinaCrowdMazePoint;
  /** Open ground reserved around a potential victim; NOT a mission trigger. */
  readonly radius: number;
}
export interface RinaFieldCrowdMazeLayout {
  readonly bounds: RinaCrowdMazeBounds;
  readonly passages: readonly RinaCrowdMazePassage[];
  readonly rescuePockets: readonly RinaCrowdRescuePocket[];
  readonly entry: RinaCrowdMazePoint;
  readonly exitToStage: RinaCrowdMazePoint;
  /** Negative = inside corridor, positive = within the solid crowd. */
  marginToCrowd(x: number, z: number): number;
  isCrowdInterior(x: number, z: number, margin?: number): boolean;
  /** True only inside the maze area AND outside all walkable corridors. */
  blocksPlayerLocal(x: number, z: number, clearance?: number): boolean;
}

const P = (x: number, z: number): RinaCrowdMazePoint => ({ x, z });

// Named nodes make it possible to move a whole intersection without hunting
// through hard-coded mesh coordinates. All rescue alcoves are on this network.
export const RINA_FIELD_MAZE_NODES = {
  entry: P(0, -44), start: P(0, -34),
  west1: P(-13, -27), west2: P(-11, -14),
  middle1: P(6, -8), middle2: P(9, 3),
  upperWest: P(-7, 13), stageApproach: P(-10, 23),

  eastLower1: P(13, -32), eastLower2: P(22, -26),
  eastMiddle: P(18, -16),
  westLower1: P(-26, -25), westLower2: P(-24, -12),
  westMiddle: P(-22, -3), westUpper: P(-24, 9),
  east1: P(21, -7), east2: P(24, 8), eastUpper: P(15, 16),

  deadEastSouth: P(30, -37),
  rescueWestSouth: P(-32, -14),
  rescueEastSouth: P(31, -13),
  rescueWestUpper: P(-32, 2),
  rescueEastUpper: P(33, 14),
} as const;

// Each corridor is a capsule segment; smoothly joined crossings leave plenty
// of room to turn in third-person camera. The wider corridors are not straight
// lines, making rescues require a choice of route / occasional backtracking.
const PATHS: readonly (readonly [string, keyof typeof RINA_FIELD_MAZE_NODES, keyof typeof RINA_FIELD_MAZE_NODES, number, RinaMazePassageKind])[] = [
  // Main route: approximately 45% longer than straight-line travel.
  ["entry", "entry", "start", 3.6, "spine"],
  ["s1", "start", "west1", 2.65, "spine"],
  ["s2", "west1", "west2", 2.65, "spine"],
  ["s3", "west2", "middle1", 2.65, "spine"],
  ["s4", "middle1", "middle2", 2.65, "spine"],
  ["s5", "middle2", "upperWest", 2.65, "spine"],
  ["s6", "upperWest", "stageApproach", 3.3, "spine"],

  // First alternate: a wide right-hand loop with a blind side passage.
  ["e1", "start", "eastLower1", 2.45, "loop"],
  ["e2", "eastLower1", "eastLower2", 2.45, "loop"],
  ["e3", "eastLower2", "eastMiddle", 2.40, "loop"],
  ["e4", "eastMiddle", "middle1", 2.50, "loop"],
  ["deadE1", "eastLower1", "deadEastSouth", 2.20, "spur"],

  // Left-side loop and a small pocket for the first victim.
  ["w1", "west1", "westLower1", 2.50, "loop"],
  ["w2", "westLower1", "westLower2", 2.40, "loop"],
  ["w3", "westLower2", "west2", 2.45, "loop"],
  ["rescue1", "westLower2", "rescueWestSouth", 2.20, "spur"],

  // Upper loop: two ways to reach the west victim rather than a single tunnel.
  ["w4", "west2", "westMiddle", 2.50, "loop"],
  ["w5", "westMiddle", "westUpper", 2.45, "loop"],
  ["w6", "westUpper", "upperWest", 2.45, "loop"],
  ["rescue3", "westMiddle", "rescueWestUpper", 2.25, "spur"],

  // Right upper loop offers alternate approach, not a second straight road.
  ["e5", "middle1", "east1", 2.50, "loop"],
  ["e6", "east1", "east2", 2.45, "loop"],
  ["e7", "east2", "eastUpper", 2.45, "loop"],
  // Join the west approach below the catwalk tip; a direct crossing here
  // would intersect the existing stage barrier and cut this loop in two.
  ["e8", "eastUpper", "upperWest", 2.50, "loop"],
  ["e9", "middle2", "eastUpper", 2.30, "loop"],
  ["rescue2", "east1", "rescueEastSouth", 2.20, "spur"],
  ["rescue2alt", "eastMiddle", "rescueEastSouth", 2.25, "loop"],
  ["rescue4", "east2", "rescueEastUpper", 2.15, "spur"],
] as const;

/** Anchors for future rescue logic, not active rescues yet. */
export const RINA_FIELD_MAZE_RESCUE_POCKETS: readonly RinaCrowdRescuePocket[] = [
  { id: "rina-rescue-west-south", label: "Oeste / primera extracción", point: RINA_FIELD_MAZE_NODES.rescueWestSouth, radius: 2.6 },
  { id: "rina-rescue-east-south", label: "Este / segunda extracción", point: RINA_FIELD_MAZE_NODES.rescueEastSouth, radius: 2.6 },
  { id: "rina-rescue-west-upper", label: "Oeste / tercera extracción", point: RINA_FIELD_MAZE_NODES.rescueWestUpper, radius: 2.6 },
  { id: "rina-rescue-east-upper", label: "Este / cuarta extracción", point: RINA_FIELD_MAZE_NODES.rescueEastUpper, radius: 2.6 },
];

const CAP = 0.10;
function distanceToClearanceRectangle(x: number, z: number): number {
  // Preserve the security fence and catwalk gap used by the previous crowd.
  // The extra margin covers the width of silhouettes and animated arms.
  const halfWidth = RINA_STAGE_SECURITY.catwalkFenceHalfWidth +
    RINA_STAGE_SECURITY.spectatorClearance + 1.0;
  const minZ = RINA_STAGE_SECURITY.catwalkFenceTipZ -
    RINA_STAGE_SECURITY.spectatorClearance - 0.4;
  const maxZ = RINA_STAGE_SECURITY.frontZ;
  const dx = Math.abs(x) - halfWidth;
  const dz = Math.max(minZ - z, z - maxZ);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) +
    Math.min(Math.max(dx, dz), 0);
}
function distanceToSegment(x: number, z: number, passage: RinaCrowdMazePassage): number {
  const dx = passage.b.x - passage.a.x, dz = passage.b.z - passage.a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - passage.a.x) * dx + (z - passage.a.z) * dz) / l2)) : 0;
  return Math.hypot(x - (passage.a.x + dx * t), z - (passage.a.z + dz * t));
}

export function createRinaFieldCrowdMazeLayout(): RinaFieldCrowdMazeLayout {
  const passages = PATHS.map(([id, a, b, halfWidth, kind]) => ({
    id, a: RINA_FIELD_MAZE_NODES[a], b: RINA_FIELD_MAZE_NODES[b], halfWidth, kind,
  }));
  // Dense crowd reaches the edge of the existing allowed field rectangle;
  // beyond this boundary the level's original exit/stage logic is untouched.
  const bounds: RinaCrowdMazeBounds = {
    minX: -RINA_STADIUM.pitchWidth * 0.5 - 0.65,
    maxX: RINA_STADIUM.pitchWidth * 0.5 + 0.65,
    minZ: -44.0,
    maxZ: Math.min(22.5, RINA_STADIUM.stage.frontZ - 9),
  };
  const marginToCrowd = (x: number, z: number) => {
    let best = Number.POSITIVE_INFINITY;
    for (const seg of passages) best = Math.min(best, distanceToSegment(x, z, seg) - seg.halfWidth);
    for (const pocket of RINA_FIELD_MAZE_RESCUE_POCKETS)
      best = Math.min(best, Math.hypot(x - pocket.point.x, z - pocket.point.z) - pocket.radius);
    best = Math.min(best, distanceToClearanceRectangle(x, z));
    return best;
  };
  const insideBounds = (x: number, z: number) =>
    x >= bounds.minX - CAP && x <= bounds.maxX + CAP &&
    z >= bounds.minZ - CAP && z <= bounds.maxZ + CAP;
  return {
    bounds, passages, rescuePockets: RINA_FIELD_MAZE_RESCUE_POCKETS,
    entry: RINA_FIELD_MAZE_NODES.entry,
    exitToStage: RINA_FIELD_MAZE_NODES.stageApproach,
    marginToCrowd,
    isCrowdInterior(x, z, margin = 0) {
      return insideBounds(x, z) && marginToCrowd(x, z) >= margin;
    },
    blocksPlayerLocal(x, z, clearance = 0) {
      if (!insideBounds(x, z)) return false;
      // The crowd edge is visible at the corridor border. Keep a small
      // clearance for Lautaro without creating a wide invisible wall.
      return marginToCrowd(x, z) > -Math.min(Math.max(0, clearance), 0.32);
    },
  };
}
