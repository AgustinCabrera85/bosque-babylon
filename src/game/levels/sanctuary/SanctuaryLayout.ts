/** Layout data, intentionally separate from Babylon rendering and story logic. */
export type SanctuaryPillarId = "libre-de-culpas" | "rina" | "fortaleza" | "teatro" | "encadenado";

export interface SanctuaryStop {
  id: SanctuaryPillarId;
  title: string;
  destination: "forest" | "theatre" | null;
  z: number;
  x: number;
  side: -1 | 1;
  height: number;
}

export const SANCTUARY_STOPS: readonly SanctuaryStop[] = [
  { id: "libre-de-culpas", title: "Libre de culpas", destination: "forest", z: -80, x: -90, side: -1, height: 340 },
  { id: "rina", title: "La Sombra de Rina", destination: null, z: 155, x: 90, side: 1, height: 390 },
  { id: "fortaleza", title: "La Fortaleza Inquebrantable", destination: null, z: 385, x: -80, side: -1, height: 450 },
  { id: "teatro", title: "El libro que ensayaba a los hombres", destination: "theatre", z: 620, x: 88, side: 1, height: 520 },
  { id: "encadenado", title: "Encadenado a la oscuridad", destination: null, z: 850, x: -85, side: -1, height: 590 },
];

export const SANCTUARY_CONFIG = {
  riverY: -0.26,
  boatDeckY: 0.65,
  boatStartZ: -355,
  gateStopZ: 1190,
  gateWallZ: 2180,
  gateWidth: 80,
  gateLandingZ: 1198,
  eyeHeight: 1.7,
  boatSpeed: 20,
} as const;

/** Shared visual/collision dimensions for the final, climbable approach. */
export const SANCTUARY_ASCENT = {
  lowerY: 1.55,
  lowerPlatformStartZ: SANCTUARY_CONFIG.gateLandingZ,
  stairStartZ: 1260,
  flights: 4,
  stepsPerFlight: 90,
  treadDepth: 2,
  riserHeight: .6,
  landingDepth: 26,
  stairWidth: 112,
  platformWidth: 124,
  wallDepth: 105,
  portalHeight: 240,
  get stairEndZ() { return this.stairStartZ + this.flights * this.stepsPerFlight * this.treadDepth + (this.flights - 1) * this.landingDepth; },
  get upperY() { return this.lowerY + this.flights * this.stepsPerFlight * this.riserHeight; },
  get wallFrontZ() { return SANCTUARY_CONFIG.gateWallZ - this.wallDepth / 2; },
  get portalApproachEndZ() { return SANCTUARY_CONFIG.gateWallZ + this.wallDepth / 2 - 7.5; },
} as const;

export function sanctuaryFlightStartZ(flight: number): number {
  const ascent = SANCTUARY_ASCENT;
  return ascent.stairStartZ + flight * (ascent.stepsPerFlight * ascent.treadDepth + ascent.landingDepth);
}

export function getSanctuaryStairSurface(z: number) {
  const ascent = SANCTUARY_ASCENT;
  for (let flight = 0; flight < ascent.flights; flight++) {
    const start = sanctuaryFlightStartZ(flight);
    const end = start + ascent.stepsPerFlight * ascent.treadDepth;
    if (z < start || z >= end) continue;
    const localStep = Math.min(ascent.stepsPerFlight - 1, Math.floor((z - start) / ascent.treadDepth));
    const stepIndex = flight * ascent.stepsPerFlight + localStep;
    const stepProgress = (z - start - localStep * ascent.treadDepth) / ascent.treadDepth;
    return {
      stepIndex,
      stepProgress,
      surfaceHeight: ascent.lowerY + (stepIndex + 1) * ascent.riserHeight,
      presentationHeight: ascent.lowerY + (stepIndex + stepProgress) * ascent.riserHeight,
      ascentDirectionX: 0,
      ascentDirectionZ: 1,
    };
  }
  return null;
}

export function getSanctuaryAscentHeight(z: number): number {
  const ascent = SANCTUARY_ASCENT;
  if (z < ascent.stairStartZ) return ascent.lowerY;
  const stair = getSanctuaryStairSurface(z);
  if (stair) return stair.surfaceHeight;
  for (let flight = 0; flight < ascent.flights - 1; flight++) {
    const landingStart = sanctuaryFlightStartZ(flight) + ascent.stepsPerFlight * ascent.treadDepth;
    if (z >= landingStart && z < landingStart + ascent.landingDepth) {
      return ascent.lowerY + (flight + 1) * ascent.stepsPerFlight * ascent.riserHeight;
    }
  }
  return ascent.upperY;
}

/** Release only as an explicit result of completing the matching story. */
export type SanctuaryProgress = Partial<Record<SanctuaryPillarId, boolean>>;

export const SANCTUARY_PROGRESS_KEY = "lrlo.sanctuary.orbs.v1";

export function readSanctuaryProgress(): SanctuaryProgress {
  try {
    const raw = localStorage.getItem(SANCTUARY_PROGRESS_KEY);
    if (!raw) return {};
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const source = obj as Record<string, unknown>;
    const progress: SanctuaryProgress = {};
    for (const stop of SANCTUARY_STOPS) {
      if (source[stop.id] === true) progress[stop.id] = true;
    }
    return progress;
  } catch {
    return {};
  }
}

export function setSanctuaryOrbFreed(id: SanctuaryPillarId, freed = true) {
  const progress = readSanctuaryProgress();
  if (freed) progress[id] = true;
  else delete progress[id];
  try { localStorage.setItem(SANCTUARY_PROGRESS_KEY, JSON.stringify(progress)); } catch { /* storage optional */ }
  return progress;
}
