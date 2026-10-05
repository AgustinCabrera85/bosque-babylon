export type PlayerHitBloodVFXOptions = {
  assetUrl?: string;
  durationMs?: number;
};

const DEFAULT_ASSET_URL =
  "/assets/vfx/blood_splashes/blood_splash_right_bottom.png";
const DEFAULT_DURATION_MS = 1050;

/** Reusable screen-space blood response for heavy physical impacts. */
export class PlayerHitBloodVFX {
  private readonly root: HTMLDivElement | null;
  private readonly assetUrl: string;
  private readonly durationMs: number;
  private hideTimer: number | null = null;

  public constructor(options: PlayerHitBloodVFXOptions = {}) {
    this.assetUrl = options.assetUrl ?? DEFAULT_ASSET_URL;
    this.durationMs = Math.max(0, options.durationMs ?? DEFAULT_DURATION_MS);
    if (typeof document === "undefined") {
      this.root = null;
      return;
    }

    this.root = document.createElement("div");
    this.root.className = "player-hit-blood-vfx";
    this.root.setAttribute("aria-hidden", "true");
    (document.getElementById("hud") ?? document.body).append(this.root);
  }

  public play() {
    if (!this.root || typeof window === "undefined") return;
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);

    const image = document.createElement("img");
    image.src = this.assetUrl;
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    image.fetchPriority = "high";
    this.root.replaceChildren(image);
    this.root.classList.remove("active");
    void this.root.offsetWidth;
    this.root.classList.add("active");
    this.hideTimer = window.setTimeout(() => this.clear(), this.durationMs);
  }

  public dispose() {
    if (this.hideTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.hideTimer);
    }
    this.hideTimer = null;
    this.root?.remove();
  }

  private clear() {
    this.hideTimer = null;
    this.root?.classList.remove("active");
    this.root?.replaceChildren();
  }
}
