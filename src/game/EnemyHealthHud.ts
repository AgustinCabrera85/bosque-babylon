type EnemyHitDetail = {
  id: string;
  health: number;
  maxHealth: number;
};

const MINOR_BAR_SECONDS = 2.4;
const BOSS_DEFEAT_SECONDS = 1.1;
const barCoordinate = (value: number) => String(Math.round(value * 100) / 100);

type BossArtwork = {
  root: SVGGElement | null;
  fill: SVGRectElement;
  flash: SVGRectElement;
  flashAnimation: SVGAnimationElement | null;
  barX: number;
  barWidth: number;
  lastFlashSequence: number;
};

/** Screen-space enemy health: never projects a target's world position. */
export class EnemyHealthHud {
  private readonly minorRoot = EnemyHealthHud.requireElement("minorEnemyHealthHud");
  private readonly minorTrack = EnemyHealthHud.requireElement("minorEnemyHealthTrack");
  private readonly minorFill = EnemyHealthHud.requireElement("minorEnemyHealthFill");
  private readonly bossRoot = EnemyHealthHud.requireElement("bossEnemyHealthHud");
  private readonly bossArts = [
    "bossEnemyHealthArt",
    "bossEnemyHealthArtPortrait",
    "bossEnemyHealthArtLandscape",
  ].map((id) => EnemyHealthHud.requireElement(id) as HTMLObjectElement);
  private minorId: string | null = null;
  private minorTimeRemaining = 0;
  private bossVisible = false;
  private bossFraction = 1;
  private readonly bossArtworks = new Map<HTMLObjectElement, BossArtwork>();
  private readonly bossArtworkLoadListeners = new Map<HTMLObjectElement, () => void>();
  private pendingBossFlash: { previous: number; current: number } | null = null;
  private bossFlashSequence = 0;
  private bossDefeatRemaining = 0;

  public constructor(private readonly bossId: string) {
    this.setVisible(this.minorRoot, false);
    this.setVisible(this.bossRoot, false);
    for (const art of this.bossArts) {
      const onLoad = () => this.bindBossArtwork(art);
      this.bossArtworkLoadListeners.set(art, onLoad);
      art.addEventListener("load", onLoad);
      this.bindBossArtwork(art);
    }
    window.addEventListener("bosque:enemy-hit", this.onEnemyHit);
    window.addEventListener("bosque:enemy-death", this.onEnemyDeath);
  }

  public update(deltaSeconds: number, bossActive: boolean, bossHealth: number, bossMaxHealth: number) {
    const elapsed = Math.max(0, deltaSeconds);
    if (this.minorTimeRemaining > 0) {
      this.minorTimeRemaining = Math.max(0, this.minorTimeRemaining - elapsed);
      if (this.minorTimeRemaining === 0) this.hideMinor();
    }
    this.bossDefeatRemaining = Math.max(0, this.bossDefeatRemaining - elapsed);
    this.setBossFraction(bossMaxHealth > 0 ? bossHealth / bossMaxHealth : 0);

    const showBoss = (bossActive && bossHealth > 0) || this.bossDefeatRemaining > 0;
    if (showBoss && this.minorId) this.hideMinor();
    if (showBoss !== this.bossVisible) {
      this.bossVisible = showBoss;
      this.setVisible(this.bossRoot, showBoss);
    }
  }

  public dispose() {
    for (const [art, onLoad] of this.bossArtworkLoadListeners) art.removeEventListener("load", onLoad);
    this.bossArtworkLoadListeners.clear();
    window.removeEventListener("bosque:enemy-hit", this.onEnemyHit);
    window.removeEventListener("bosque:enemy-death", this.onEnemyDeath);
    this.hideMinor();
    this.setVisible(this.bossRoot, false);
    this.bossVisible = false;
    this.bossArtworks.clear();
    this.pendingBossFlash = null;
  }

  private readonly onEnemyHit = (event: Event) => {
    const hit = (event as CustomEvent<EnemyHitDetail>).detail;
    if (
      !hit ||
      typeof hit.id !== "string" ||
      !Number.isFinite(hit.health) ||
      !Number.isFinite(hit.maxHealth) ||
      hit.maxHealth <= 0
    ) return;
    if (hit.id === this.bossId) {
      this.setBossFraction(hit.health / hit.maxHealth);
      if (hit.health <= 0) this.bossDefeatRemaining = BOSS_DEFEAT_SECONDS;
      return;
    }
    if (this.bossVisible) return;
    if (hit.health <= 0) {
      if (this.minorId === hit.id) this.hideMinor();
      return;
    }
    this.minorId = hit.id;
    this.minorTimeRemaining = MINOR_BAR_SECONDS;
    this.setFraction(this.minorTrack, this.minorFill, hit.health / hit.maxHealth);
    this.setVisible(this.minorRoot, true);
  };

  private readonly onEnemyDeath = (event: Event) => {
    const death = (event as CustomEvent<{ id: string }>).detail;
    if (death?.id === this.bossId) {
      this.setBossFraction(0);
      this.bossDefeatRemaining = BOSS_DEFEAT_SECONDS;
    }
    if (death?.id === this.minorId) this.hideMinor();
  };

  private bindBossArtwork(art: HTMLObjectElement) {
    const svg = art.contentDocument;
    const fill = svg?.querySelector<SVGRectElement>("#boss-health-fill");
    const flash = svg?.querySelector<SVGRectElement>("#boss-damage-flash");
    const fullBar = svg?.querySelector<SVGRectElement>("#boss-health-red");
    const barX = Number(fill?.getAttribute("x"));
    const barWidth = Number(fullBar?.getAttribute("width"));
    if (!fill || !flash || !fullBar || !Number.isFinite(barX) || !Number.isFinite(barWidth) || barWidth <= 0) return;
    if (this.bossArtworks.get(art)?.fill === fill) return;
    this.bossArtworks.set(art, {
      root: svg?.querySelector<SVGGElement>("#boss-hud") ?? null,
      fill,
      flash,
      flashAnimation: svg?.querySelector<SVGAnimationElement>("#boss-damage-flash-animation") ?? null,
      barX,
      barWidth,
      lastFlashSequence: 0,
    });
    fill.style.transition = "width 420ms ease-out";
    this.renderBossFraction();
    flash.setAttribute("width", "0");
    this.playPendingBossFlash();
  }

  private setBossFraction(value: number) {
    const fraction = Math.max(0, Math.min(1, value));
    if (fraction === this.bossFraction) return;
    const previous = this.bossFraction;
    this.bossFraction = fraction;
    this.renderBossFraction();
    if (fraction < previous) {
      this.pendingBossFlash = { previous, current: fraction };
      this.bossFlashSequence += 1;
      this.playPendingBossFlash();
    } else {
      this.pendingBossFlash = null;
    }
  }

  private renderBossFraction() {
    this.bossRoot.setAttribute("aria-valuenow", String(Math.round(this.bossFraction * 100)));
    for (const artwork of this.bossArtworks.values()) {
      artwork.fill.setAttribute("width", barCoordinate(artwork.barWidth * this.bossFraction));
      artwork.root?.classList.toggle("critical", this.bossFraction > 0 && this.bossFraction <= 0.25);
      artwork.root?.classList.toggle("defeated", this.bossFraction === 0);
    }
  }

  private playPendingBossFlash() {
    const damage = this.pendingBossFlash;
    if (!damage) return;
    for (const artwork of this.bossArtworks.values()) {
      if (artwork.lastFlashSequence === this.bossFlashSequence) continue;
      artwork.flash.setAttribute("x", barCoordinate(artwork.barX + artwork.barWidth * damage.current));
      artwork.flash.setAttribute("width", barCoordinate(artwork.barWidth * (damage.previous - damage.current)));
      artwork.root?.classList.remove("taking-damage");
      // Restart the SVG's CSS animation even when several hits arrive quickly.
      artwork.root?.getBoundingClientRect();
      artwork.root?.classList.add("taking-damage");
      artwork.flashAnimation?.beginElement();
      artwork.lastFlashSequence = this.bossFlashSequence;
    }
  }

  private hideMinor() {
    this.minorId = null;
    this.minorTimeRemaining = 0;
    this.setVisible(this.minorRoot, false);
  }

  private setFraction(track: HTMLElement, fill: HTMLElement, value: number) {
    const fraction = Math.max(0, Math.min(1, value));
    fill.style.transform = `scaleX(${fraction})`;
    track.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
  }

  private setVisible(element: HTMLElement, visible: boolean) {
    element.classList.toggle("visible", visible);
    element.setAttribute("aria-hidden", String(!visible));
  }

  private static requireElement(id: string) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing enemy health HUD element: ${id}`);
    return element;
  }
}
