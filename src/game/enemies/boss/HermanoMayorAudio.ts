import { asset } from "../../../utils/asset";

export type HermanoMayorBreathingMode = "silent" | "idle" | "chase";

type HermanoMayorAudioKind = "idle" | "chase" | "nearbyUnseen";

export type HermanoMayorAudioOptions = {
  getSfxVolume?: () => number;
};

const TRACK_PATHS: Record<HermanoMayorAudioKind, string> = {
  idle: "assets/audio/sfx/enemies/HermanoMayor_respiración_Idle.mp3",
  chase: "assets/audio/sfx/enemies/HermanoMayor_respiración_persecucion.mp3",
  nearbyUnseen: "assets/audio/sfx/enemies/HermanoMayor_cercano_no_visible.mp3",
};

const TRACK_VOLUME: Record<HermanoMayorAudioKind, number> = {
  idle: 0.52,
  chase: 0.68,
  nearbyUnseen: 0.82,
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Single, exclusive audio channel for the Hermano Mayor.
 *
 * Breathing clips are deliberately replayed through the scheduler instead of
 * using HTMLAudioElement.loop: this lets the nearby/off-camera cue wait for the
 * current clip to finish, so none of the character sounds overlap or cut each
 * other off.
 */
export class HermanoMayorAudio {
  private readonly tracks = new Map<HermanoMayorAudioKind, HTMLAudioElement>();
  private readonly getSfxVolume: () => number;
  private desiredBreathing: HermanoMayorBreathingMode = "silent";
  private currentKind: HermanoMayorAudioKind | null = null;
  private nearbyUnseenPending = false;
  private audibility = 0;
  private retryDelay = 0;
  private paused = false;
  private disposed = false;

  private readonly onPause = (event: Event) => {
    const detail = (event as CustomEvent<{ paused?: boolean }>).detail;
    this.setPaused(detail?.paused === true);
  };

  public constructor(options: HermanoMayorAudioOptions = {}) {
    this.getSfxVolume = options.getSfxVolume ?? (() => 0.8);

    for (const [kind, path] of Object.entries(TRACK_PATHS) as Array<
      [HermanoMayorAudioKind, string]
    >) {
      const audio = new Audio(asset(path));
      audio.loop = false;
      audio.preload = "auto";
      audio.addEventListener("ended", () => this.onTrackEnded(kind));
      this.tracks.set(kind, audio);
    }

    window.addEventListener("bosque:pause", this.onPause);
  }

  public setBreathing(mode: HermanoMayorBreathingMode) {
    this.desiredBreathing = mode;
  }

  public setAudibility(value: number) {
    this.audibility = clamp01(value);
    this.updateCurrentVolume();
  }

  public requestNearbyUnseen() {
    if (this.currentKind === "nearbyUnseen" || this.nearbyUnseenPending) return;
    this.nearbyUnseenPending = true;
  }

  public update(deltaSeconds: number) {
    if (this.disposed) return;
    this.retryDelay = Math.max(0, this.retryDelay - Math.max(0, deltaSeconds));
    this.updateCurrentVolume();
    if (!this.paused && this.audibility > 0.001 && this.retryDelay <= 0) {
      this.startNextTrack();
    }
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("bosque:pause", this.onPause);
    for (const audio of this.tracks.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
    this.tracks.clear();
    this.currentKind = null;
  }

  private setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    const current = this.currentKind ? this.tracks.get(this.currentKind) : null;
    if (paused) {
      current?.pause();
      return;
    }
    if (current && this.audibility > 0.001) {
      const currentKind = this.currentKind;
      void current.play().catch(() => {
        if (this.currentKind === currentKind) this.currentKind = null;
        if (currentKind === "nearbyUnseen") this.nearbyUnseenPending = true;
        this.retryDelay = 0.75;
      });
    }
  }

  private startNextTrack() {
    if (this.currentKind || this.paused || this.audibility <= 0.001) return;

    let next: HermanoMayorAudioKind | null = null;
    if (this.nearbyUnseenPending) {
      next = "nearbyUnseen";
      this.nearbyUnseenPending = false;
    } else if (this.desiredBreathing !== "silent") {
      next = this.desiredBreathing;
    }
    if (!next) return;

    const audio = this.tracks.get(next);
    if (!audio) return;
    this.currentKind = next;
    audio.currentTime = 0;
    this.updateCurrentVolume();
    void audio.play().catch((error) => {
      if (this.currentKind === next) this.currentKind = null;
      if (next === "nearbyUnseen") this.nearbyUnseenPending = true;
      this.retryDelay = 0.75;
      console.warn("[HermanoMayorAudio] La reproducción quedó a la espera de interacción.", error);
    });
  }

  private onTrackEnded(kind: HermanoMayorAudioKind) {
    if (this.currentKind !== kind) return;
    this.currentKind = null;
    this.startNextTrack();
  }

  private updateCurrentVolume() {
    if (!this.currentKind) return;
    const audio = this.tracks.get(this.currentKind);
    if (!audio) return;
    const volume = clamp01(
      this.getSfxVolume() * this.audibility * TRACK_VOLUME[this.currentKind]
    );
    audio.volume = volume;
    audio.muted = volume <= 0.001;
  }
}
