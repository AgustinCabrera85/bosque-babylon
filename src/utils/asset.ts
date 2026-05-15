export function asset(pathFromPublic: string): string {
  // pathFromPublic ejemplo: "assets/textures/terrain/ground_camino/ground.jpg"
  const base = (import.meta as any).env?.BASE_URL ?? "/";
  const cleanBase = base.endsWith("/") ? base : base + "/";
  const cleanPath = pathFromPublic.replace(/\\/g, "/").replace(/^\//, "");
  return cleanBase + cleanPath;
}
