import type { SanctuaryStop } from "./SanctuaryLayout";

// Local bounds measured from Portal_generico_1.glb. Splitting each tapered
// upright keeps the passage open while following the stone more closely than
// one box around the whole arch.
export const PORTAL_STONE_BLOCKS = [
  { name: "leftLower", x: [-0.476, -0.135], y: [0, 0.42], z: [-0.2, 0.2] },
  { name: "leftUpper", x: [-0.44, -0.17], y: [0.42, 0.78], z: [-0.2, 0.2] },
  { name: "rightLower", x: [0.145, 0.476], y: [0, 0.42], z: [-0.2, 0.2] },
  { name: "rightUpper", x: [0.19, 0.44], y: [0.42, 0.78], z: [-0.2, 0.2] },
  { name: "lintel", x: [-0.38, 0.42], y: [0.78, 1], z: [-0.203, 0.165] },
] as const;

const PORTAL_SCALE = 18;
const PORTAL_BASE_Y = 2.05;
const PLAYER_RADIUS = 0.45;

export function collidesWithPortalStone(
  stop: SanctuaryStop, worldX: number, worldZ: number,
  additionalClearance = 0, minY?: number, maxY?: number,
): boolean {
  const portalX = stop.x + stop.side * 49;
  const portalZ = stop.z + 8;
  // The arch is rotated a quarter turn toward its dock. In this orientation
  // local X crosses the doorway and local Z runs through its stone depth.
  const localX = stop.side * (worldZ - portalZ) / PORTAL_SCALE;
  const localZ = -stop.side * (worldX - portalX) / PORTAL_SCALE;
  const radius = (PLAYER_RADIUS + Math.max(0, additionalClearance)) / PORTAL_SCALE;
  return PORTAL_STONE_BLOCKS.some((block) => {
    if (minY !== undefined && minY > PORTAL_BASE_Y + block.y[1] * PORTAL_SCALE) return false;
    if (maxY !== undefined && maxY < PORTAL_BASE_Y + block.y[0] * PORTAL_SCALE) return false;
    return localX >= block.x[0] - radius && localX <= block.x[1] + radius &&
      localZ >= block.z[0] - radius && localZ <= block.z[1] + radius;
  });
}
