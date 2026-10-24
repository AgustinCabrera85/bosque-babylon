import type { MusicPlaybackState } from "../../MusicPlayer";
import { RINA_CONCERT_MAP, RINA_CONCERT_SONG } from "./RinaConcertConfig";

export type RinaFieldCrowdCue = Readonly<{
  songTime: number;
  activity: number;
  chorus: number;
  playing: boolean;
}>;

export const RINA_FIELD_CROWD_BEAT_PERIOD = 60 / RINA_CONCERT_MAP.extendedChorus.bpm;
export const RINA_FIELD_CROWD_BEAT_ORIGIN = RINA_CONCERT_MAP.extendedChorus.beatOriginSeconds;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
function smoothstep(start: number, end: number, value: number): number {
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

/** The authored song map leads the crowd; live beats only add accents. */
export function getRinaFieldCrowdCue(music: MusicPlaybackState | null): RinaFieldCrowdCue {
  if (!music?.playing || music.track !== RINA_CONCERT_SONG.track ||
      !Number.isFinite(music.currentTime)) {
    return { songTime: 0, activity: 0.12, chorus: 0, playing: false };
  }

  const songTime = music.currentTime;
  const section = RINA_CONCERT_MAP.sections.find(item =>
    songTime >= item.start && songTime < item.end);
  const baseActivity = section?.kind === "groove" ? 0.43
    : section?.kind === "build" ? 0.30
    : section?.kind === "breakdown" ? 0.14
    : section?.kind === "chorus" ? 0.43 : 0.16;
  let chorus = section?.kind === "chorus"
    ? smoothstep(section.start, section.start + 0.55, songTime) *
      (1 - smoothstep(section.end - 0.55, section.end, songTime))
    : 0;

  // The extended refrain cuts out for two seconds; the crowd drops with it.
  const cut = RINA_CONCERT_MAP.extendedChorus;
  if (songTime >= cut.breakStart && songTime < cut.breakEnd + 0.3) {
    const silence = smoothstep(cut.breakStart, cut.breakStart + 0.16, songTime) *
      (1 - smoothstep(cut.breakEnd, cut.breakEnd + 0.3, songTime));
    chorus *= 1 - silence;
  }

  return {
    songTime,
    activity: baseActivity + (1 - baseActivity) * chorus,
    chorus,
    playing: true,
  };
}

/** Clip lists are disjoint where the asset provides both quiet and lively poses. */
export function getRinaFieldCrowdClipPools(names: readonly string[]) {
  const all = names.map((_, index) => index);
  const calm = all.filter(index => /idle|clap/i.test(names[index]));
  const chorus = all.filter(index => /danc|cheer|excited|rally/i.test(names[index]));
  chorus.sort((a, b) => {
    const rank = (index: number) => /danc/i.test(names[index]) ? 0
      : /excited/i.test(names[index]) ? 1 : 2;
    return rank(a) - rank(b);
  });
  return { calm: calm.length ? calm : all, chorus: chorus.length ? chorus : all };
}
