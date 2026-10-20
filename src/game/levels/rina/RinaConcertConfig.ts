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

/** Shared timing for the flame shader, stage lighting, and retrigger interval. */
export const RINA_PYRO_TIMING = {
  jetTravelTime: 0.17,
  headExpandTime: 0.13,
  // The crown finishes expanding at 0.30 s and then stays full for 2 s.
  sustainTime: 2.13,
  blowoutTime: 0.22,
  emberTime: 0.65,
  smokeTime: 3.2,
} as const;
