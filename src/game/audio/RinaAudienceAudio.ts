import { asset } from "../../utils/asset";
import type { MusicPlaybackState } from "../MusicPlayer";
import { RINA_CONCERT_MAP, RINA_CONCERT_SONG } from "../levels/rina/RinaConcertConfig";

const TRACKS = {
  base: "assets/audio/ambience/publico_base_constante.mp3",
  energetic: "assets/audio/ambience/publico_energico.mp3",
  scream: "assets/audio/ambience/publico_grito_rina_female.mp3",
} as const;

// These cues land in the intro, the two quieter breaks, and the final decay.
// Keeping them on the song clock prevents random screams during a chorus.
const SCREAM_CUES = [7.5, 120.5, 184.5, 231] as const;

export type RinaAudienceAudioHandle = {
  start(): void;
  update(music: MusicPlaybackState | null): void;
  triggerPyro(delaySeconds?: number): void;
  setVolume(volume: number): void;
  dispose(): void;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Three small decoded clips, with the audience bed independent of song playback. */
export async function loadRinaAudienceAudio(
  context: AudioContext,
  destination: AudioNode,
): Promise<RinaAudienceAudioHandle> {
  const [baseBuffer, energeticBuffer, screamBuffer] = await Promise.all(
    Object.values(TRACKS).map(async path => {
      const response = await fetch(asset(path));
      if (!response.ok) throw new Error(`Rina audience audio: ${path} returned HTTP ${response.status}`);
      return context.decodeAudioData(await response.arrayBuffer());
    }),
  );

  const output = context.createGain();
  output.gain.value = 0;
  output.connect(destination);

  const baseGain = context.createGain();
  baseGain.gain.value = 0;
  baseGain.connect(output);
  const energeticGain = context.createGain();
  energeticGain.gain.value = 0;
  energeticGain.connect(output);
  const screamGain = context.createGain();
  screamGain.gain.value = 0.95;
  screamGain.connect(output);

  // Low-level, opposite-side reflections widen the short bed without loading
  // extra recordings or creating a spatial source for every spectator.
  const reflections = [
    { delay: 0.17, pan: -0.65, volume: 0.12 },
    { delay: 0.31, pan: 0.65, volume: 0.09 },
  ].map(({ delay, pan, volume }) => {
    const delayNode = context.createDelay(0.5);
    delayNode.delayTime.value = delay;
    const gainNode = context.createGain();
    gainNode.gain.value = volume;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    baseGain.connect(delayNode);
    delayNode.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(output);
    return { delayNode, gainNode, panner };
  });

  const active = new Set<AudioBufferSourceNode>();
  const activeEnvelopes = new Set<GainNode>();
  let started = false;
  let disposed = false;
  let previousSongTime: number | null = null;
  let pyroStartsAt = -Infinity;
  let pyroEndsAt = -Infinity;
  let previousEnergeticTarget = -1;
  let scheduleTimer: number | null = null;
  // Three equal-power grains cover one another; changing the source offset and
  // playback rate avoids a short, recognizable cheer on every repeat.
  const loopFade = Float32Array.from({ length: 65 }, (_, index) =>
    Math.sin(Math.PI * index / 64) / Math.sqrt(1.5));
  const grainOffsets = [0.04, 0.16, 0.10, 0.20, 0.07, 0.13, 0.18];
  const grainRates = [0.95, 1.04, 1, 0.92, 1.07, 0.98, 1.02];
  const loopLayers = [
    { buffer: baseBuffer, gain: baseGain, nextStart: Infinity, grainIndex: 0 },
    { buffer: energeticBuffer, gain: energeticGain, nextStart: Infinity, grainIndex: 3 },
  ];

  function scheduleSustainedLayers(now: number) {
    for (const layer of loopLayers) {
      // Both supplied clips decline markedly in their last half-second.
      // All grains stop before that tail and overlap at a constant power.
      const grainDuration = 0.7;
      const stride = grainDuration / 3;
      if (layer.nextStart < now) layer.nextStart = now;
      while (layer.nextStart < now + 2.5) {
        const offset = grainOffsets[layer.grainIndex % grainOffsets.length];
        const rate = grainRates[layer.grainIndex % grainRates.length];
        const source = context.createBufferSource();
        source.buffer = layer.buffer;
        source.playbackRate.value = rate;
        const envelope = context.createGain();
        envelope.gain.setValueCurveAtTime(loopFade, layer.nextStart, grainDuration);
        source.connect(envelope);
        envelope.connect(layer.gain);
        source.onended = () => {
          active.delete(source);
          activeEnvelopes.delete(envelope);
          source.disconnect();
          envelope.disconnect();
        };
        active.add(source);
        activeEnvelopes.add(envelope);
        source.start(layer.nextStart, offset, grainDuration * rate);
        layer.nextStart += stride;
        layer.grainIndex += 1;
      }
    }
  }

  function makeSource(buffer: AudioBuffer, gain: GainNode, loop: boolean) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(gain);
    source.onended = () => {
      active.delete(source);
      source.disconnect();
    };
    active.add(source);
    return source;
  }

  function playScream() {
    if (disposed || context.state !== "running") return;
    const now = context.currentTime;
    const source = makeSource(screamBuffer, screamGain, false);
    const envelope = context.createGain();
    activeEnvelopes.add(envelope);
    source.disconnect();
    source.connect(envelope);
    envelope.connect(screamGain);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(1, now + 0.22);
    envelope.gain.setValueAtTime(1, now + Math.max(0.22, screamBuffer.duration - 0.6));
    envelope.gain.linearRampToValueAtTime(0, now + screamBuffer.duration);
    source.onended = () => {
      active.delete(source);
      activeEnvelopes.delete(envelope);
      source.disconnect();
      envelope.disconnect();
    };
    source.start(now);
  }

  return {
    start() {
      if (disposed || started) return;
      started = true;
      const now = context.currentTime;
      baseGain.gain.setValueAtTime(0, now);
      // The supplied base recording is about 15 dB quieter than the energetic
      // one, so it needs extra gain to remain audible underneath the song.
      baseGain.gain.linearRampToValueAtTime(1.2, now + 1.8);
      loopLayers[0].nextStart = now;
      loopLayers[1].nextStart = now + 0.08;
      scheduleSustainedLayers(now);
      // Keep the bed alive if the render loop pauses while music continues.
      scheduleTimer = window.setInterval(() => {
        if (!disposed) scheduleSustainedLayers(context.currentTime);
      }, 500);
    },
    update(music) {
      if (disposed || !started) return;
      const now = context.currentTime;
      scheduleSustainedLayers(now);
      const songPlaying = music?.playing && music.track === RINA_CONCERT_SONG.track;
      const songTime = songPlaying ? music.currentTime : null;
      const section = songTime === null ? null : RINA_CONCERT_MAP.sections.find(item =>
        songTime >= item.start && songTime < item.end);
      const sectionLevel = section?.energy === "peak" ? 0.62
        : section?.kind === "chorus" ? 0.52
          : section?.energy === "high" ? 0.34
            : section?.energy === "medium" ? 0.17 : 0.035;
      const liveLift = songPlaying ? 0.1 * clamp01((music.energy + music.bass) * 0.5) : 0;
      const pyroLift = now >= pyroStartsAt && now < pyroEndsAt ? 0.82 : 0;
      const target = Math.max(sectionLevel + liveLift, pyroLift);
      if (Math.abs(target - previousEnergeticTarget) > 0.012) {
        energeticGain.gain.setTargetAtTime(target, now, target > previousEnergeticTarget ? 0.35 : 0.9);
        previousEnergeticTarget = target;
      }

      const fromSongTime = previousSongTime;
      if (songTime !== null && fromSongTime !== null &&
          songTime > fromSongTime && songTime - fromSongTime < 0.5 &&
          SCREAM_CUES.some(cue => fromSongTime < cue && songTime >= cue)) {
        playScream();
      }
      previousSongTime = songTime;
    },
    triggerPyro(delaySeconds = 0) {
      if (disposed || !started) return;
      pyroStartsAt = context.currentTime + Math.max(0, delaySeconds);
      pyroEndsAt = pyroStartsAt + 2.8;
    },
    setVolume(volume) {
      if (disposed) return;
      output.gain.setTargetAtTime(clamp01(volume) * 0.65, context.currentTime, 0.1);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (scheduleTimer !== null) window.clearInterval(scheduleTimer);
      for (const source of active) {
        source.onended = null;
        source.stop();
        source.disconnect();
      }
      active.clear();
      for (const envelope of activeEnvelopes) envelope.disconnect();
      activeEnvelopes.clear();
      baseGain.disconnect();
      energeticGain.disconnect();
      screamGain.disconnect();
      for (const { delayNode, gainNode, panner } of reflections) {
        delayNode.disconnect();
        gainNode.disconnect();
        panner.disconnect();
      }
      output.disconnect();
    },
  };
}
