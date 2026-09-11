import type {
  PlayerStatsEvent,
  PlayerStatsSnapshot,
  PlayerStatsSystem,
} from "./PlayerStatsSystem";

type StatusHudArtwork = {
  healthFill: SVGRectElement | null;
  healthSurface: SVGPathElement | null;
  healthValue: SVGTextElement | null;
  healthOrb: SVGGElement | null;
  sanityFill: SVGRectElement | null;
  sanitySurface: SVGPathElement | null;
  sanityValue: SVGTextElement | null;
  sanityOrb: SVGGElement | null;
  sanityShadow: SVGGElement | null;
  absorptionMarks: SVGCircleElement[];
  desktop: boolean;
};

const SVG_NS = "http://www.w3.org/2000/svg";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** Event-driven adapter for both authored Vida/Cordura SVG variants. */
export class PlayerStatusHud {
  private readonly root = document.getElementById("playerStatusHud");
  private readonly healthAnnouncer = document.getElementById("playerHealthValue");
  private readonly sanityAnnouncer = document.getElementById("playerSanityValue");
  private readonly artworks = new Map<HTMLObjectElement, StatusHudArtwork>();
  private readonly abortController = new AbortController();
  private readonly unsubscribe: () => void;
  private latestSnapshot: PlayerStatsSnapshot;
  private disposed = false;

  public constructor(stats: PlayerStatsSystem) {
    this.latestSnapshot = stats.snapshot;
    const signal = this.abortController.signal;
    const elements = Array.from(
      document.querySelectorAll<HTMLObjectElement>(".player-status-hud-art")
    );
    for (const element of elements) {
      element.addEventListener("load", () => this.bindArtwork(element), { signal });
      this.bindArtwork(element);
    }
    this.unsubscribe = stats.onChange((event) => this.render(event));
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.unsubscribe();
    this.artworks.clear();
  }

  private render(event: PlayerStatsEvent) {
    this.latestSnapshot = event.snapshot;
    const snapshot = event.snapshot;
    if (this.healthAnnouncer) {
      this.healthAnnouncer.textContent = `Vida ${Math.round(snapshot.health)} de ${snapshot.maxHealth}.`;
    }
    if (this.sanityAnnouncer) {
      this.sanityAnnouncer.textContent = `Cordura ${Math.round(snapshot.sanity)} de ${snapshot.maxSanity}.`;
    }
    this.root?.classList.toggle("critical-health", snapshot.health <= 25);
    this.root?.classList.toggle("critical-sanity", snapshot.sanity <= 25);
    this.root?.classList.toggle("absorbing", snapshot.isAbsorbingLight);
    for (const artwork of this.artworks.values()) this.renderArtwork(artwork, snapshot);
  }

  private bindArtwork(element: HTMLObjectElement) {
    const svg = element.contentDocument;
    if (!svg?.documentElement) return;
    const desktop = element.classList.contains("player-status-hud-art-desktop");
    this.installRuntimeStyle(svg);
    const artwork: StatusHudArtwork = {
      healthFill: svg.querySelector<SVGRectElement>("#health-fill"),
      healthSurface: svg.querySelector<SVGPathElement>("#health-surface"),
      healthValue: svg.querySelector<SVGTextElement>("#health-value"),
      healthOrb: svg.querySelector<SVGGElement>("#health-orb"),
      sanityFill: svg.querySelector<SVGRectElement>("#sanity-fill"),
      sanitySurface: svg.querySelector<SVGPathElement>("#sanity-surface"),
      sanityValue: svg.querySelector<SVGTextElement>("#sanity-value"),
      sanityOrb: svg.querySelector<SVGGElement>("#sanity-orb"),
      sanityShadow: svg.querySelector<SVGGElement>("#sanity-shadow"),
      absorptionMarks: this.createAbsorptionMarks(svg, desktop),
      desktop,
    };
    this.artworks.set(element, artwork);
    this.renderArtwork(artwork, this.latestSnapshot);
  }

  private renderArtwork(artwork: StatusHudArtwork, snapshot: PlayerStatsSnapshot) {
    const health = clamp01(snapshot.health / snapshot.maxHealth);
    const sanity = clamp01(snapshot.sanity / snapshot.maxSanity);
    const maxHeight = artwork.desktop ? 98 : 60;
    const baseline = artwork.desktop ? 132 : 80;
    const healthX = artwork.desktop ? 43 : 35;
    const healthRight = artwork.desktop ? 141 : 95;
    const healthMiddleLeft = artwork.desktop ? 59 : 45;
    const healthMiddleRight = artwork.desktop ? 76 : 55;
    const healthCenter = artwork.desktop ? 92 : 65;
    const sanityX = artwork.desktop ? 379 : 205;
    const sanityRight = artwork.desktop ? 477 : 265;
    const sanityMiddleLeft = artwork.desktop ? 394 : 214;
    const sanityMiddleRight = artwork.desktop ? 410 : 223;
    const sanityCenter = artwork.desktop ? 426 : 233;

    const healthY = baseline - maxHeight * health;
    const sanityY = baseline - maxHeight * sanity;
    this.setFill(artwork.healthFill, maxHeight * health, healthY);
    this.setFill(artwork.sanityFill, maxHeight * sanity, sanityY);
    artwork.healthSurface?.setAttribute(
      "d",
      `M${healthX} ${healthY}C${healthMiddleLeft} ${healthY - (artwork.desktop ? 6 : 4)} ${healthMiddleRight} ${healthY + (artwork.desktop ? 5 : 3)} ${healthCenter} ${healthY - 1}S${artwork.desktop ? 124 : 85} ${healthY + (artwork.desktop ? 4 : 2)} ${healthRight} ${healthY - 1}`
    );
    artwork.sanitySurface?.setAttribute(
      "d",
      `M${sanityX} ${sanityY}C${sanityMiddleLeft} ${sanityY + (artwork.desktop ? 7 : 4)} ${sanityMiddleRight} ${sanityY - (artwork.desktop ? 7 : 4)} ${sanityCenter} ${sanityY + (artwork.desktop ? 2 : 1)}S${artwork.desktop ? 459 : 253} ${sanityY - (artwork.desktop ? 6 : 3)} ${sanityRight} ${sanityY}`
    );
    if (artwork.healthValue) artwork.healthValue.textContent = String(Math.round(snapshot.health));
    if (artwork.sanityValue) artwork.sanityValue.textContent = String(Math.round(snapshot.sanity));
    artwork.healthOrb?.classList.toggle("critical", snapshot.health <= 25);
    artwork.healthOrb?.classList.toggle("regenerating", snapshot.isRegeneratingHealth);
    artwork.sanityOrb?.classList.toggle("critical", snapshot.sanity <= 25);
    if (artwork.sanityShadow) {
      artwork.sanityShadow.style.opacity = String(0.25 + (1 - sanity) * 0.75);
    }
    this.renderAbsorptionMarks(artwork.absorptionMarks, snapshot);
  }

  private setFill(fill: SVGRectElement | null, height: number, y: number) {
    fill?.setAttribute("height", height.toFixed(2));
    fill?.setAttribute("y", y.toFixed(2));
  }

  private installRuntimeStyle(svg: Document) {
    if (svg.querySelector("#player-status-runtime-style")) return;
    const style = svg.createElementNS(SVG_NS, "style");
    style.id = "player-status-runtime-style";
    style.textContent = `
      #health-orb.regenerating { animation: playerHealthRegen 1.35s ease-in-out infinite; }
      #sanity-absorption-marks { transition: opacity .16s ease; }
      @keyframes playerHealthRegen {
        0%,100% { filter: brightness(1); }
        50% { filter: brightness(1.24) drop-shadow(0 0 4px rgba(211,116,86,.65)); }
      }
      @media (prefers-reduced-motion: reduce) {
        #health-orb.regenerating { animation: none; }
      }
    `;
    svg.documentElement.append(style);
  }

  private createAbsorptionMarks(svg: Document, desktop: boolean) {
    svg.querySelector("#sanity-absorption-marks")?.remove();
    const group = svg.createElementNS(SVG_NS, "g");
    group.id = "sanity-absorption-marks";
    group.setAttribute("fill", "#bfe9e4");
    group.setAttribute("stroke", "#d8c386");
    group.setAttribute("stroke-width", desktop ? "1.6" : "1.1");
    group.setAttribute("opacity", "0");
    const centerX = desktop ? 428 : 235;
    const y = desktop ? 17 : 10;
    const spacing = desktop ? 19 : 13;
    const radius = desktop ? 4.2 : 2.9;
    const marks: SVGCircleElement[] = [];
    for (let index = 0; index < 3; index++) {
      const mark = svg.createElementNS(SVG_NS, "circle");
      mark.setAttribute("cx", String(centerX + (index - 1) * spacing));
      mark.setAttribute("cy", String(y));
      mark.setAttribute("r", String(radius));
      mark.setAttribute("pathLength", "1");
      mark.setAttribute("stroke-dasharray", "1");
      group.append(mark);
      marks.push(mark);
    }
    svg.documentElement.append(group);
    return marks;
  }

  private renderAbsorptionMarks(
    marks: SVGCircleElement[],
    snapshot: PlayerStatsSnapshot
  ) {
    const group = marks[0]?.parentElement;
    group?.setAttribute("opacity", snapshot.isAbsorbingLight ? "1" : "0");
    marks.forEach((mark, index) => {
      const completed = index < snapshot.absorptionOrbsConsumed;
      const current = index === snapshot.absorptionOrbsConsumed;
      const progress = current ? snapshot.absorptionProgress : completed ? 1 : 0;
      mark.setAttribute("fill-opacity", completed ? ".9" : ".12");
      mark.setAttribute("stroke-opacity", current || completed ? ".95" : ".3");
      mark.setAttribute("stroke-dashoffset", String(1 - progress));
    });
  }
}
