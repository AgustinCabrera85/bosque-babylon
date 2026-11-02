import type { SanctuaryPillarId } from "../levels/sanctuary/SanctuaryLayout";
import type { LevelId } from "./LevelTypes";

/** Portal destinations and sanctuary arrival islands. Edit routes here. */
type PortalRoute = {
  from: LevelId;
  to: LevelId;
  entryPoint: string;
  presentation: "liquid" | "white" | "return";
  arrivalStop?: SanctuaryPillarId;
  loadingText?: string;
  liquidTint?: string;
};

export const SANCTUARY_PORTAL_ROUTES = {
  "libre-de-culpas": {
    from: "sanctuary", to: "forest", entryPoint: "libre-de-culpas-portal",
    presentation: "liquid", loadingText: "Entrando al bosque...", liquidTint: "#63c9d9",
  },
  rina: {
    from: "sanctuary", to: "rina", entryPoint: "rina-portal",
    presentation: "liquid", loadingText: "Entrando al estadio de Rina...", liquidTint: "#d351ff",
  },
  fortaleza: null,
  teatro: {
    from: "sanctuary", to: "theatre", entryPoint: "teatro-portal",
    presentation: "liquid", loadingText: "Entrando al teatro...", liquidTint: "#ff537a",
  },
  encadenado: null,
} as const satisfies Record<SanctuaryPillarId, PortalRoute | null>;

export const LEVEL_EXIT_PORTAL_ROUTES = {
  forest: {
    from: "forest", to: "sanctuary", entryPoint: "forest-return",
    arrivalStop: "libre-de-culpas", presentation: "white",
  },
  rina: {
    from: "rina", to: "sanctuary", entryPoint: "rina-return",
    arrivalStop: "rina", presentation: "return",
  },
} as const satisfies Partial<Record<LevelId, PortalRoute>>;

export function getSanctuaryPortalRoute(stopId: SanctuaryPillarId): PortalRoute | null {
  return SANCTUARY_PORTAL_ROUTES[stopId];
}

export function getLevelExitPortalRoute(level: keyof typeof LEVEL_EXIT_PORTAL_ROUTES): PortalRoute {
  return LEVEL_EXIT_PORTAL_ROUTES[level];
}

export function findPortalRoute(from: LevelId | null, to: LevelId, entryPoint?: string): PortalRoute | null {
  if (!from || !entryPoint) return null;
  const routes: readonly (PortalRoute | null)[] = [
    ...Object.values(SANCTUARY_PORTAL_ROUTES),
    ...Object.values(LEVEL_EXIT_PORTAL_ROUTES),
  ];
  return routes.find((route) => route?.from === from && route.to === to &&
    route.entryPoint === entryPoint) ?? null;
}

export function getSanctuaryArrivalStop(entryPoint?: string): SanctuaryPillarId | null {
  const route = Object.values(LEVEL_EXIT_PORTAL_ROUTES).find((candidate) =>
    candidate.to === "sanctuary" && candidate.entryPoint === entryPoint);
  return route?.arrivalStop ?? null;
}
