import { asset } from "../utils/asset";

const MUSIC_VOLUME_KEY = "bosque.musicVolume";
const AMBIENT_VOLUME_KEY = "bosque.ambientVolume";
const SFX_VOLUME_KEY = "bosque.sfxVolume";
const DEFAULT_MUSIC_VOLUME = 0.7;
const DEFAULT_AMBIENT_VOLUME = 0.85;
const DEFAULT_SFX_VOLUME = 0.8;

type VolumeChannel = "music" | "ambient" | "sfx";

type SliderBinding = {
  slider: HTMLInputElement;
  valueText: HTMLElement;
};

type GameSfxEvent = CustomEvent<{
  name?: "jump" | "walk" | "run";
  active?: boolean;
}>;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
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

export function setupMusicPlayer() {
  const pauseMenu = document.getElementById("pauseMenu");
  const musicSlider = getSlider("musicVolume", "musicValue");
  const ambientSlider = getSlider("ambientVolume", "ambientValue");
  const sfxSlider = getSlider("sfxVolume", "sfxValue");

  if (!musicSlider || !ambientSlider || !sfxSlider) return;

  const music = new Audio(asset("assets/audio/music/Echoes_in_the_Dark_ingame.mp3"));
  music.loop = true;
  music.preload = "auto";

  const ambient = new Audio(asset("assets/audio/ambience/Gentle_cricket_chirp.mp3"));
  ambient.loop = true;
  ambient.preload = "auto";

  const walkSfx = new Audio(asset("assets/audio/sfx/Footsteps_crunching_walking.mp3"));
  const runSfx = new Audio(asset("assets/audio/sfx/Footsteps_crunching_running.mp3"));
  const jumpSfx = new Audio(asset("assets/audio/sfx/jump_on_road.mp3"));
  walkSfx.loop = true;
  runSfx.loop = true;
  walkSfx.preload = "auto";
  runSfx.preload = "auto";
  jumpSfx.preload = "auto";

  let started = false;
  let ambientStarted = false;
  let footstepMode: "idle" | "walk" | "run" = "idle";
  let audioContext: AudioContext | null = null;
  let sfxGain: GainNode | null = null;

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
    ensureAudioContext();
    if (audioContext?.state === "suspended") await audioContext.resume();

    if (!started) {
      started = true;
      try {
        await music.play();
      } catch (error) {
        started = false;
        console.warn("[MusicPlayer] Music playback was blocked until the next user gesture.", error);
      }
    }

    if (!ambientStarted) {
      ambientStarted = true;
      try {
        await ambient.play();
      } catch (error) {
        ambientStarted = false;
        console.warn("[MusicPlayer] Ambient playback was blocked until the next user gesture.", error);
      }
    }
  }

  function setVolume(channel: VolumeChannel, volume: number, save = true) {
    const next = clamp01(volume);
    volumes[channel] = next;

    if (channel === "music") {
      music.volume = next;
      music.muted = next <= 0;
      if (save) localStorage.setItem(MUSIC_VOLUME_KEY, String(next));
      renderMusic(next);
    }

    if (channel === "ambient") {
      ambient.volume = next * 0.65;
      ambient.muted = next <= 0;
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

  const startOnGesture = () => void start();
  window.addEventListener("pointerdown", startOnGesture, { passive: true });
  window.addEventListener("keydown", startOnGesture);
  window.addEventListener("touchstart", startOnGesture, { passive: true });

  setVolume("music", volumes.music, false);
  setVolume("ambient", volumes.ambient, false);
  setVolume("sfx", volumes.sfx, false);
  renderAll();
}
