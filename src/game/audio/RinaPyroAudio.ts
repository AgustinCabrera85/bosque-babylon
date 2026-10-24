import { asset } from "../../utils/asset";

const TRACKS = [
  "assets/audio/sfx/rina/fuegos_escenario_1.mp3",
  "assets/audio/sfx/rina/fuegos_escenario_2.mp3",
] as const;

export type RinaPyroAudioHandle = {
  trigger(delaySeconds?: number): void;
  dispose(): void;
};

/** Both recordings share one clock and the game's SFX volume bus. */
export async function loadRinaPyroAudio(
  context: AudioContext,
  sfxDestination: AudioNode
): Promise<RinaPyroAudioHandle> {
  const buffers = await Promise.all(TRACKS.map(async path => {
    const response = await fetch(asset(path));
    if (!response.ok) throw new Error(`Rina pyro audio: ${path} returned HTTP ${response.status}`);
    return context.decodeAudioData(await response.arrayBuffer());
  }));

  const input = context.createGain();
  input.gain.value = 0.88;
  const dry = context.createGain();
  dry.gain.value = 0.82;
  input.connect(dry);
  dry.connect(sfxDestination);

  // Filtered, alternating reflections give the open stadium a short audible tail.
  const reflections = [
    { seconds: 0.19, volume: 0.27, cutoff: 3000, pan: -0.35 },
    { seconds: 0.43, volume: 0.17, cutoff: 2000, pan: 0.4 },
    { seconds: 0.78, volume: 0.09, cutoff: 1300, pan: -0.18 },
  ].map(({ seconds, volume, cutoff, pan }) => {
    const delay = context.createDelay(1);
    delay.delayTime.value = seconds;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const gain = context.createGain();
    gain.gain.value = volume;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    input.connect(delay);
    delay.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(sfxDestination);
    return { delay, filter, gain, panner };
  });

  const active = new Set<AudioBufferSourceNode>();
  let disposed = false;
  return {
    trigger(delaySeconds = 0) {
      if (disposed || context.state !== "running") return;
      const startAt = context.currentTime + Math.max(0, delaySeconds);
      for (const buffer of buffers) {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(input);
        source.onended = () => {
          active.delete(source);
          source.disconnect();
        };
        active.add(source);
        source.start(startAt);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of active) {
        source.onended = null;
        source.stop();
        source.disconnect();
      }
      active.clear();
      input.disconnect();
      dry.disconnect();
      for (const { delay, filter, gain, panner } of reflections) {
        delay.disconnect();
        filter.disconnect();
        gain.disconnect();
        panner.disconnect();
      }
    },
  };
}
