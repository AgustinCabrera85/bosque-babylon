import { getRinaSideStandAudienceAnchor, RINA_DOUBLE_TIER_PROFILE } from "../RinaDoubleTierSideStands";
import { RINA_BACK_STAND_LED_PROFILE } from "../RinaBackStandExit";
import type { StandsSpectator } from "./RinaStandsSpriteAtlas";

export type StandsSector = "rear-lower" | "rear-upper" | "side-left-lower" |
  "side-left-upper" | "side-right-lower" | "side-right-upper";

export type SpritePlacement = {
  spectator: StandsSpectator;
  sector: StandsSector;
  batch: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  brightness: number;
};

type Seat = Omit<SpritePlacement, "spectator" | "width" | "height">;

export const RINA_STANDS_SPRITE_CONFIG = {
  desktop: { rearPerSegment: 500, sidePerStand: 850, rearSpacing: 0.58, sideSpacing: 1.62 },
  mobile: { rearPerSegment: 250, sidePerStand: 400, rearSpacing: 0.88, sideSpacing: 2.0 },
  sideZMin: -51,
  sideZMax: 30,
} as const;

export const RINA_STANDS_SPRITE_DARKENING = {
  enabled: true,
  rearLower: { firstRow: 0.78, lastRow: 0.42 },
  rearUpper: { firstRow: 0.50, lastRow: 0.34 },
  sideLower: { firstRow: 0.80, lastRow: 0.44 },
  sideUpper: { firstRow: 0.52, lastRow: 0.36 },
} as const;

function getRowBrightness(sector: StandsSector, row: number, rowCount: number): number {
  if (!RINA_STANDS_SPRITE_DARKENING.enabled) return 1;
  const range = sector === "rear-lower" ? RINA_STANDS_SPRITE_DARKENING.rearLower
    : sector === "rear-upper" ? RINA_STANDS_SPRITE_DARKENING.rearUpper
    : sector.endsWith("-lower") ? RINA_STANDS_SPRITE_DARKENING.sideLower
    : RINA_STANDS_SPRITE_DARKENING.sideUpper;
  const t = Math.max(0, Math.min(1, row / Math.max(1, rowCount - 1)));
  const smooth = t * t * (3 - 2 * t);
  return range.firstRow + (range.lastRow - range.firstRow) * smooth;
}

function evenlySelect<T>(items: readonly T[], limit: number): T[] {
  const count = Math.min(items.length, limit);
  return Array.from({ length: count }, (_, i) => items[Math.floor((i + 0.5) * items.length / count)]);
}

function rearSeats(spacing: number): Seat[] {
  const p = RINA_BACK_STAND_LED_PROFILE;
  const lowerTopY = 0.45 + (p.lowerRows - 1) * p.rowHeight + p.rowHeight * 0.5;
  const upperBaseY = lowerTopY + p.concourseHeight + 0.75;
  const upperBaseZ = p.rearZ - p.lowerRows * p.lowerRowDepth - p.concourseDepth - 2.35;
  const seats: Seat[] = [];
  for (const tier of ["lower", "upper"] as const) {
    const rows = tier === "lower" ? p.lowerRows : 11;
    for (let row = 0; row < rows; row++) {
      const halfWidth = tier === "lower" ? p.halfWidth : Math.max(16, p.halfWidth * 2 - row) * 0.5;
      const span = halfWidth - 1.1;
      const columns = Math.floor(2 * span / spacing);
      // Two staggered ranks fit on each tread. Both stand on the same step top.
      for (let rank = 0; rank < 2; rank++) for (let col = 0; col < columns; col++) {
        const x = -span + (col + (rank ? 0.72 : 0.28)) * (2 * span / columns);
        if (tier === "lower" && Math.abs(x) < p.openingHalfWidth + 0.85) continue;
        if (tier === "lower" && Math.abs(Math.abs(x) - (p.halfWidth - 8.5)) < 1.6) continue;
        if (tier === "upper" && [-22, 0, 22].some(axis => Math.abs(x - axis) < 1.0)) continue;
        const y = tier === "lower"
          ? 0.45 + row * p.rowHeight + p.rowHeight * 0.5 + 0.07
          : upperBaseY + row * p.rowHeight + p.rowHeight * 0.5 + 0.07;
        const zCenter = tier === "lower"
          ? p.rearZ - 3 - row * p.lowerRowDepth
          : upperBaseZ - row * 1.55;
        const z = zCenter + (rank === 0 ? 0.32 : -0.32);
        const segment = tier === "lower" ? (x < 0 ? "left" : "right")
          : String(Math.min(3, Math.floor((x + p.halfWidth) / (p.halfWidth * 0.5))));
        const sector = tier === "lower" ? "rear-lower" : "rear-upper";
        seats.push({ sector, batch: `rear-${tier}-${segment}`, x, y, z,
          brightness: getRowBrightness(sector, row, rows) });
      }
    }
  }
  return seats;
}

function sideSeats(side: -1 | 1, spacing: number): Seat[] {
  const p = RINA_DOUBLE_TIER_PROFILE;
  const seats: Seat[] = [];
  const zMin = RINA_STANDS_SPRITE_CONFIG.sideZMin;
  const zMax = RINA_STANDS_SPRITE_CONFIG.sideZMax;
  const columns = Math.floor((zMax - zMin) / spacing);
  for (const tier of ["lower", "upper"] as const) {
    const rows = tier === "lower" ? p.lowerRows : p.upperRows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const z = zMin + (col + 0.5) * ((zMax - zMin) / columns);
        if (p.aislePositions.some(aisle => Math.abs(z - aisle) < p.aisleHalfWidth + 0.4)) continue;
        const anchor = getRinaSideStandAudienceAnchor(side, tier, row, z);
        const band = Math.min(2, Math.floor((z - zMin) / ((zMax - zMin) / 3)));
        const sector: StandsSector = `side-${side < 0 ? "left" : "right"}-${tier}`;
        seats.push({
          sector,
          batch: `side-${side < 0 ? "left" : "right"}-${tier}-${band}`,
          x: anchor.x, y: anchor.y, z,
          brightness: getRowBrightness(sector, row, rows),
        });
      }
    }
  }
  return seats;
}

export function createRinaStandsSpritePlacements(
  tier: "desktop" | "mobile", spectators: readonly StandsSpectator[]
): SpritePlacement[] {
  const settings = RINA_STANDS_SPRITE_CONFIG[tier];
  const rear = rearSeats(settings.rearSpacing);
  const rearBatches = ["rear-lower-left", "rear-lower-right",
    "rear-upper-0", "rear-upper-1", "rear-upper-2", "rear-upper-3"];
  const sections = [
    ...rearBatches.map(batch => evenlySelect(rear.filter(seat => seat.batch === batch),
      settings.rearPerSegment)),
    evenlySelect(sideSeats(-1, settings.sideSpacing), settings.sidePerStand),
    evenlySelect(sideSeats(1, settings.sideSpacing), settings.sidePerStand),
  ];
  const placements: SpritePlacement[] = [];
  sections.forEach((seats, section) => seats.forEach((seat, i) => {
    // Each desktop rear segment receives the full 500-person source block.
    // Other sectors reuse it with different deterministic offsets.
    const spectator = spectators[((i * 137) + section * 173) % spectators.length];
    const rearSection = section < rearBatches.length;
    placements.push({ ...seat, spectator,
      width: spectator.width * (rearSection ? 1.05 : 1.0),
      height: spectator.height * (rearSection ? 1.26 : 1.18) });
  }));
  return placements;
}
