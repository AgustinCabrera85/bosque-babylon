import { asset } from "../utils/asset";

const MUSIC_VOLUME_KEY = "bosque.musicVolume";
const MUTED_VOLUME = 0;
const DEFAULT_VOLUME = 0.45;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function readSavedVolume() {
  const saved = Number.parseFloat(localStorage.getItem(MUSIC_VOLUME_KEY) ?? "");
  return Number.isFinite(saved) ? clamp01(saved) : DEFAULT_VOLUME;
}

export function setupMusicPlayer() {
  const controls = document.getElementById("musicControls");
  const toggle = document.getElementById("musicToggle") as HTMLButtonElement | null;
  const slider = document.getElementById("musicVolume") as HTMLInputElement | null;
  const valueText = document.getElementById("musicVolumeValue");

  if (!controls || !toggle || !slider || !valueText) return;

  const musicControls = controls;
  const musicToggle = toggle;
  const volumeSlider = slider;
  const volumeValueText = valueText;

  const music = new Audio(asset("assets/audio/music/Echoes_in_the_Dark_ingame.mp3"));
  music.loop = true;
  music.preload = "auto";

  let started = false;
  let previousVolume = readSavedVolume() || DEFAULT_VOLUME;

  function render(volume: number) {
    const percent = Math.round(volume * 100);
    volumeSlider.value = String(percent);
    volumeValueText.textContent = `${percent}%`;
    musicToggle.textContent = volume > 0 ? "Music" : "Muted";
    musicToggle.setAttribute("aria-pressed", volume > 0 ? "false" : "true");
  }

  async function start() {
    if (started) return;
    started = true;

    try {
      await music.play();
    } catch (error) {
      started = false;
      console.warn("[MusicPlayer] Music playback was blocked until the next user gesture.", error);
    }
  }

  function setVolume(volume: number, save = true) {
    const next = clamp01(volume);
    music.volume = next;
    music.muted = next <= 0;
    if (next > 0) previousVolume = next;
    if (save) localStorage.setItem(MUSIC_VOLUME_KEY, String(next));
    render(next);
  }

  musicControls.addEventListener("pointerdown", (event) => event.stopPropagation());
  musicControls.addEventListener("click", (event) => event.stopPropagation());

  volumeSlider.addEventListener("input", () => {
    setVolume(Number(volumeSlider.value) / 100);
    void start();
  });

  musicToggle.addEventListener("click", () => {
    const muted = music.volume > MUTED_VOLUME;
    setVolume(muted ? MUTED_VOLUME : previousVolume);
    void start();
  });

  const startOnGesture = () => void start();
  window.addEventListener("pointerdown", startOnGesture, { passive: true });
  window.addEventListener("keydown", startOnGesture);
  window.addEventListener("touchstart", startOnGesture, { passive: true });

  setVolume(readSavedVolume(), false);
}
