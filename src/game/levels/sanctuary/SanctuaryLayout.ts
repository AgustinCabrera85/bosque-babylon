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
  gateWallZ: 1570,
  gateWidth: 115,
  gateLandingZ: 1190,
  eyeHeight: 1.7,
  boatSpeed: 20,
} as const;

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
