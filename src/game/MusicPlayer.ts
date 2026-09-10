import { asset } from "../utils/asset";

const MUSIC_VOLUME_KEY = "bosque.musicVolume";
const AMBIENT_VOLUME_KEY = "bosque.ambientVolume";
const SFX_VOLUME_KEY = "bosque.sfxVolume";
const DEFAULT_MUSIC_VOLUME = 0.7;
const DEFAULT_AMBIENT_VOLUME = 0.85;
const DEFAULT_SFX_VOLUME = 0.8;
// The supplied recording peaks around -23.5 dBFS. A dedicated Web Audio gain
// restores useful headroom without changing the other ambience tracks.
const WATERFALL_GAIN_COMPENSATION = 4.5;

type VolumeChannel = "music" | "ambient" | "sfx";

type SliderBinding = {
  slider: HTMLInputElement;
  valueText: HTMLElement;
};

type GameSfxEvent = CustomEvent<{
  name?: "jump" | "walk" | "run";
  active?: boolean;
}>;

type SkyEyeEvent = CustomEvent<{
  state?: "presentation-started" | "watching";
}>;

type WorldPosition = {
  x: number;
  z: number;
};

export type WaterfallAudioArea = {
  position: WorldPosition;
  audibleRadius: number;
  fullVolumeRadius: number;
  volumeScale?: number;
};

export type MusicPlayerHandle = {
  configureWaterfallArea: (area: WaterfallAudioArea) => void;
  updateListenerPosition: (position: WorldPosition) => void;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function readSavedVolume(key: string, fallback: number) {
  const saved = Number.parseFloat(localStorage.getItem(key) ?? "");
  return Number.isFinite(saved) ? clamp01(saved) : fallback;
}

function getSlider(id: string, valueId: string): SliderBinding | null {
  const slider = document.getElementById(id) as HTMLInputElement | null;
  const valueText = document.getElementById(valueId);
  if (!slider || !valueText) return null;
  return { slider, valueText };
}

function renderBinding(binding: SliderBinding | null, volume: number) {
  if (!binding) return;
  const percent = Math.round(volume * 100);
  binding.slider.value = String(percent);
  binding.valueText.textContent = `${percent}%`;
}

export function setupMusicPlayer(): MusicPlayerHandle | null {
  const pauseMenu = document.getElementById("pauseMenu");
  const musicSlider = getSlider("musicVolume", "musicValue");
  const ambientSlider = getSlider("ambientVolume", "ambientValue");
  const sfxSlider = getSlider("sfxVolume", "sfxValue");

  if (!musicSlider || !ambientSlider || !sfxSlider) return null;

  const music = new Audio(asset("assets/audio/music/Echoes_in_the_Dark_ingame.mp3"));
  music.loop = true;
  music.preload = "auto";

  const skyEyeMusic = new Audio(asset("assets/audio/music/The Eye Emerges.mp3"));
  skyEyeMusic.loop = false;
  skyEyeMusic.preload = "auto";

  const ambient = new Audio(asset("assets/audio/ambience/Gentle_cricket_chirp.mp3"));
  ambient.loop = true;
  ambient.preload = "auto";

  const waterfall = new Audio(asset("assets/audio/ambience/waterfall_sound.mp3"));
  waterfall.loop = true;
  waterfall.preload = "auto";
  waterfall.volume = 0;

  const walkSfx = new Audio(asset("assets/audio/sfx/Footsteps_crunching_walking.mp3"));
  const runSfx = new Audio(asset("assets/audio/sfx/Footsteps_crunching_running.mp3"));
  const jumpSfx = new Audio(asset("assets/audio/sfx/jump_on_road.mp3"));
  walkSfx.loop = true;
  runSfx.loop = true;
  walkSfx.preload = "auto";
  runSfx.preload = "auto";
  jumpSfx.preload = "auto";

  let started = false;
  let skyEyeMusicActive = false;
  let ambientStarted = false;
  let waterfallStarted = false;
  let footstepMode: "idle" | "walk" | "run" = "idle";
  let audioContext: AudioContext | null = null;
  let sfxGain: GainNode | null = null;
  let waterfallSource: MediaElementAudioSourceNode | null = null;
  let waterfallGain: GainNode | null = null;
  let waterfallArea: WaterfallAudioArea | null = null;
  let waterfallProximity = 0;

  const volumes: Record<VolumeChannel, number> = {
    music: readSavedVolume(MUSIC_VOLUME_KEY, DEFAULT_MUSIC_VOLUME),
    ambient: readSavedVolume(AMBIENT_VOLUME_KEY, DEFAULT_AMBIENT_VOLUME),
    sfx: readSavedVolume(SFX_VOLUME_KEY, DEFAULT_SFX_VOLUME),
  };

  function renderMusic(volume: number) {
    renderBinding(musicSlider, volume);
  }

  function renderAll() {
    renderMusic(volumes.music);
    renderBinding(ambientSlider, volumes.ambient);
    renderBinding(sfxSlider, volumes.sfx);
  }

  function ensureAudioContext() {
    if (!audioContext) {
      audioContext = new AudioContext();
      sfxGain = audioContext.createGain();
      sfxGain.connect(audioContext.destination);
      sfxGain.gain.value = volumes.sfx;

      waterfallSource = audioContext.createMediaElementSource(waterfall);
      waterfallGain = audioContext.createGain();
      waterfallGain.gain.value = 0;
      waterfallSource.connect(waterfallGain);
      waterfallGain.connect(audioContext.destination);
      // Once routed through Web Audio, proximity and the ambient slider are
      // controlled by waterfallGain rather than HTMLMediaElement.volume.
      waterfall.volume = 1;
      waterfall.muted = false;
      updateWaterfallVolume();
    }

    return audioContext;
  }

  function playUiSfx() {
    const context = ensureAudioContext();
    if (!sfxGain) return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 540;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.08);
    oscillator.connect(gain);
    gain.connect(sfxGain);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.09);
  }

  function setSfxElementVolumes(volume: number) {
    walkSfx.volume = volume * 0.58;
    runSfx.volume = volume * 0.62;
    jumpSfx.volume = volume * 0.7;
    walkSfx.muted = volume <= 0;
    runSfx.muted = volume <= 0;
    jumpSfx.muted = volume <= 0;
  }

  function updateWaterfallVolume() {
    const requestedVolumeScale = waterfallArea?.volumeScale ?? 0.72;
    const volumeScale = Number.isFinite(requestedVolumeScale) ? requestedVolumeScale : 0.72;
    const volume = clamp01(volumes.ambient * volumeScale * waterfallProximity);
    if (audioContext && waterfallGain) {
      waterfallGain.gain.setTargetAtTime(
        volume * WATERFALL_GAIN_COMPENSATION,
        audioContext.currentTime,
        0.08
      );
      return;
    }

    // Safe fallback before the first user gesture creates the AudioContext.
    waterfall.volume = volume;
    waterfall.muted = volume <= 0.001;
  }

  async function playLoop(audio: HTMLAudioElement) {
    try {
      await audio.play();
    } catch (error) {
      console.warn("[MusicPlayer] SFX playback was blocked until the next user gesture.", error);
    }
  }

  function stopLoop(audio: HTMLAudioElement) {
    audio.pause();
    audio.currentTime = 0;
  }

  function setFootstepMode(mode: "idle" | "walk" | "run") {
    if (footstepMode === mode) return;
    footstepMode = mode;

    if (mode !== "walk") stopLoop(walkSfx);
    if (mode !== "run") stopLoop(runSfx);

    if (mode === "walk") void playLoop(walkSfx);
    if (mode === "run") void playLoop(runSfx);
  }

  function playGameSfx(name: "jump" | "walk" | "run") {
    if (volumes.sfx <= 0) return;
    if (name === "walk" || name === "run") {
      setFootstepMode(name);
      return;
    }

    jumpSfx.currentTime = 0;
    void playLoop(jumpSfx);
  }

  async function start() {
    const context = ensureAudioContext();
    const playbackRequests: Promise<void>[] = [];
    if (context.state === "suspended") {
      playbackRequests.push(context.resume());
    }

    if (!started) {
      started = true;
      if (!skyEyeMusicActive) {
        playbackRequests.push(music.play().catch((error) => {
          started = false;
          console.warn("[MusicPlayer] Music playback was blocked until the next user gesture.", error);
        }));
      }
    }

    if (!ambientStarted) {
      ambientStarted = true;
      playbackRequests.push(ambient.play().catch((error) => {
        ambientStarted = false;
        console.warn("[MusicPlayer] Ambient playback was blocked until the next user gesture.", error);
      }));
    }

    if (!waterfallStarted) {
      waterfallStarted = true;
      playbackRequests.push(waterfall.play().catch((error) => {
        waterfallStarted = false;
        console.warn("[MusicPlayer] Waterfall playback was blocked until the next user gesture.", error);
      }));
    }

    await Promise.all(playbackRequests);
  }

  function setVolume(channel: VolumeChannel, volume: number, save = true) {
    const next = clamp01(volume);
    volumes[channel] = next;

    if (channel === "music") {
      music.volume = next;
      music.muted = next <= 0;
      skyEyeMusic.volume = next;
      skyEyeMusic.muted = next <= 0;
      if (save) localStorage.setItem(MUSIC_VOLUME_KEY, String(next));
      renderMusic(next);
    }

    if (channel === "ambient") {
      ambient.volume = next * 0.65;
      ambient.muted = next <= 0;
      updateWaterfallVolume();
      if (save) localStorage.setItem(AMBIENT_VOLUME_KEY, String(next));
      renderBinding(ambientSlider, next);
    }

    if (channel === "sfx") {
      if (sfxGain) sfxGain.gain.value = next;
      setSfxElementVolumes(next);
      if (save) localStorage.setItem(SFX_VOLUME_KEY, String(next));
      renderBinding(sfxSlider, next);
    }
  }

  function bindSlider(binding: SliderBinding | null, channel: VolumeChannel, previewSfx = false) {
    binding?.slider.addEventListener("input", () => {
      setVolume(channel, Number(binding.slider.value) / 100);
      void start();
    });

    binding?.slider.addEventListener("change", () => {
      if (previewSfx) playUiSfx();
    });
  }

  pauseMenu?.addEventListener("pointerdown", (event) => event.stopPropagation());
  pauseMenu?.addEventListener("click", (event) => event.stopPropagation());

  bindSlider(musicSlider, "music");
  bindSlider(ambientSlider, "ambient");
  bindSlider(sfxSlider, "sfx", true);

  pauseMenu?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement | null)?.closest("button")) playUiSfx();
  });

  window.addEventListener("bosque:sfx", (event) => {
    const { name, active } = (event as GameSfxEvent).detail ?? {};
    if (!name) return;
    if ((name === "walk" || name === "run") && active === false) {
      setFootstepMode("idle");
      return;
    }
    playGameSfx(name);
  });

  window.addEventListener("bosque:sky-eye", (event) => {
    const { state } = (event as SkyEyeEvent).detail ?? {};
    if (state === "presentation-started") {
      skyEyeMusicActive = true;
      music.pause();
      skyEyeMusic.currentTime = 0;
      void skyEyeMusic.play().catch((error) => {
        console.warn(
          "[MusicPlayer] Sky-eye music playback was blocked.",
          error
        );
      });
      return;
    }

    if (state !== "watching" || !skyEyeMusicActive) return;
    skyEyeMusicActive = false;
    stopLoop(skyEyeMusic);
    if (started) {
      void music.play().catch((error) => {
        started = false;
        console.warn(
          "[MusicPlayer] Background music could not resume.",
          error
        );
      });
    }
  });

  const startOnGesture = () => void start();
  window.addEventListener("pointerdown", startOnGesture, { passive: true });
  window.addEventListener("keydown", startOnGesture);
  window.addEventListener("touchstart", startOnGesture, { passive: true });

  setVolume("music", volumes.music, false);
  setVolume("ambient", volumes.ambient, false);
  setVolume("sfx", volumes.sfx, false);
  renderAll();

  return {
    configureWaterfallArea(area) {
      const fullVolumeRadius = Number.isFinite(area.fullVolumeRadius)
        ? Math.max(0, area.fullVolumeRadius)
        : 0;
      const audibleRadius = Number.isFinite(area.audibleRadius)
        ? Math.max(fullVolumeRadius + 0.01, area.audibleRadius)
        : fullVolumeRadius + 0.01;
      waterfallArea = {
        ...area,
        // Babylon Vector3 exposes x/z through accessors, so object spread does
        // not reliably preserve those public coordinates.
        position: { x: area.position.x, z: area.position.z },
        fullVolumeRadius,
        audibleRadius,
      };
      updateWaterfallVolume();
    },
    updateListenerPosition(position) {
      if (!waterfallArea) return;
      const distance = Math.hypot(
        position.x - waterfallArea.position.x,
        position.z - waterfallArea.position.z
      );
      if (!Number.isFinite(distance)) {
        waterfallProximity = 0;
        updateWaterfallVolume();
        return;
      }
      waterfallProximity = 1 - smoothstep(
        waterfallArea.fullVolumeRadius,
        waterfallArea.audibleRadius,
        distance
      );
      updateWaterfallVolume();
    },
  };
}
