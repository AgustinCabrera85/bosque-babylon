import type { SanctuaryStop } from "./SanctuaryLayout";
import { PORTAL_CLEAR_OPENING } from "./SanctuaryPortalCollisions";

const PORTAL_SCALE = 18;
const PLAYER_RADIUS = 0.45;
export const PORTAL_PROMPT_DISTANCE = 5.8;
export const PORTAL_PROMPT_RESET_DISTANCE = 8.4;

/** Only the walkable space in front of an unlocked portal offers entry. */
export function isAtSanctuaryPortalApproach(stop: SanctuaryStop, x: number, z: number): boolean {
  if (!stop.destination) return false;
  const portalX = stop.x + stop.side * 49;
  const portalZ = stop.z + 8;
  const frontDistance = stop.side * (portalX - x);
  if (frontDistance < 0.75 || frontDistance > PORTAL_PROMPT_DISTANCE) return false;
  const localX = stop.side * (z - portalZ) / PORTAL_SCALE;
  const clearance = PLAYER_RADIUS / PORTAL_SCALE;
  return localX >= PORTAL_CLEAR_OPENING.left + clearance &&
    localX <= PORTAL_CLEAR_OPENING.right - clearance;
}

/** After declining, the player must step away before the same question can recur. */
export function hasLeftSanctuaryPortalApproach(stop: SanctuaryStop, x: number, z: number): boolean {
  const portalX = stop.x + stop.side * 49;
  const frontDistance = stop.side * (portalX - x);
  return frontDistance > PORTAL_PROMPT_RESET_DISTANCE || frontDistance < -1 ||
    Math.abs(z - (stop.z + 8)) > 4;
}
