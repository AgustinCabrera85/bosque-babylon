/** Cue points for the current concert recording, in seconds of song playback. */
export const RINA_CONCERT_SONG = {
  track: "assets/audio/music/Rina - Si Me Miras.mp3",
  approachSeconds: 6.5,
  returnSeconds: 6.5,
  // The first chorus begins near 0:55. Later loud refrains were measured in
  // this recording; keep the cues with the track when more songs are added.
  choruses: [
    { start: 55, end: 76 },
    { start: 89, end: 115 },
    { start: 130, end: 179 },
    { start: 204, end: 230 },
  ],
} as const;

/**
 * First pass over the exact MP3 above (234.24 s, SHA-256 prefix 0F0E8E61).
 * Sections follow changes in half-second loudness and low/high-band energy.
 * Apart from the existing chorus cues, musical labels and moment times are
 * approximate; refine them by listening before timing precise gameplay beats.
 */
export const RINA_CONCERT_MAP = {
  track: RINA_CONCERT_SONG.track,
  durationSeconds: 234.24,
  extendedChorus: {
    start: RINA_CONCERT_SONG.choruses[2].start,
    end: RINA_CONCERT_SONG.choruses[2].end,
    // Same 140 BPM grid as the finale; two short flashes per beat.
    beatOriginSeconds: 130.06,
    bpm: 140,
    breakStart: 150,
    breakEnd: 152,
  },
  finale: {
    start: 202, // 3:22: lighting builds before the final chorus.
    chorusStart: RINA_CONCERT_SONG.choruses[3].start,
    end: RINA_CONCERT_SONG.choruses[3].end,
    // Low-band transients in this recording align at ~202.92, 203.36, 203.78 s.
    beatOriginSeconds: 202.92,
    bpm: 140,
  },
  sections: [
    { id: "opening", kind: "intro", start: 0, end: 10, energy: "low" },
    { id: "opening-rise", kind: "build", start: 10, end: 28, energy: "medium" },
    { id: "first-groove", kind: "groove", start: 28,
      end: RINA_CONCERT_SONG.choruses[0].start, energy: "high" },
    { id: "first-chorus", kind: "chorus",
      ...RINA_CONCERT_SONG.choruses[0], energy: "high" },
    { id: "return-groove", kind: "groove",
      start: RINA_CONCERT_SONG.choruses[0].end,
      end: RINA_CONCERT_SONG.choruses[1].start, energy: "high" },
    { id: "second-chorus", kind: "chorus",
      ...RINA_CONCERT_SONG.choruses[1], energy: "high" },
    { id: "mid-song-dip", kind: "breakdown",
      start: RINA_CONCERT_SONG.choruses[1].end,
      end: RINA_CONCERT_SONG.choruses[2].start, energy: "medium" },
    { id: "extended-chorus", kind: "chorus",
      ...RINA_CONCERT_SONG.choruses[2], energy: "peak" },
    { id: "deep-break", kind: "breakdown",
      start: RINA_CONCERT_SONG.choruses[2].end, end: 196, energy: "low" },
    { id: "final-rise", kind: "build", start: 196,
      end: 202, energy: "medium" },
    { id: "finale-entrance", kind: "build", start: 202,
      end: RINA_CONCERT_SONG.choruses[3].start, energy: "high" },
    { id: "final-chorus", kind: "chorus",
      ...RINA_CONCERT_SONG.choruses[3], energy: "peak" },
    { id: "tail", kind: "outro",
      start: RINA_CONCERT_SONG.choruses[3].end,
      end: 234.24, energy: "low" },
  ],
  // Approximate transition anchors, not individual beat or lyric timestamps.
  moments: [
    { id: "opening-lift", time: 10, kind: "rise" },
    { id: "bass-entry", time: 28, kind: "rise" },
    { id: "first-pre-chorus-dip", time: 54, kind: "dip" },
    { id: "first-chorus-entry", time: RINA_CONCERT_SONG.choruses[0].start, kind: "rise" },
    { id: "first-chorus-dip", time: 74, kind: "dip" },
    { id: "second-chorus-entry", time: RINA_CONCERT_SONG.choruses[1].start, kind: "rise" },
    { id: "mid-song-drop", time: 118, kind: "dip" },
    { id: "extended-chorus-entry", time: RINA_CONCERT_SONG.choruses[2].start, kind: "rise" },
    { id: "brief-cut", time: 150, kind: "dip" },
    { id: "strong-return", time: 152, kind: "rise" },
    { id: "deep-break-entry", time: 180, kind: "dip" },
    { id: "final-build-entry", time: 196, kind: "rise" },
    { id: "finale-lighting-entry", time: 202, kind: "rise" },
    { id: "final-chorus-entry", time: RINA_CONCERT_SONG.choruses[3].start, kind: "rise" },
    { id: "music-falls-away", time: 230, kind: "dip" },
  ],
} as const;

/** Shared timing for the flame shader, stage lighting, and retrigger interval. */
export const RINA_PYRO_TIMING = {
  jetTravelTime: 0.17,
  headExpandTime: 0.13,
  // The crown finishes expanding at 0.30 s and then stays full for 2 s.
  sustainTime: 2.13,
  blowoutTime: 0.22,
  emberTime: 0.65,
  smokeTime: 1.2,
} as const;
