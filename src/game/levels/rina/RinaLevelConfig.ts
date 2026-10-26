/** World scale of stadium scenery; actors keep their own measured heights. */
export const RINA_STADIUM_SCALE = 1.5;

export const RINA_STADIUM = {
  pitchWidth: 80,
  pitchLength: 105,
  fieldY: 0,
  playerEyeHeight: 1.7,
  playerSpawn: { x: 0, z: -34 },
  stage: {
    width: 58,
    depth: 18,
    height: 2.5,
    centerZ: 41.5,
    frontZ: 32.5,
    rinaX: 0,
    rinaZ: 36.5,
    rinaYaw: Math.PI,
    catwalk: {
      width: 5.4,
      depth: 18,
      height: 0.85,
      centerZ: 25.8,
      singerZ: 19,
    },
  },
  exitTunnel: {
    halfWidth: 5.5,
    startZ: -59,
    endZ: -49,
  },
} as const;

/** Shared dimensions for the visible stairs, fence openings, and player surface. */
export const RINA_STAGE_STAIRS = {
  centerX: 9,
  width: 4.3,
  stepDepth: 0.8,
  steps: { desktop: 8, mobile: 6 },
} as const;

export const RINA_STAGE_SECURITY = {
  frontZ: RINA_STADIUM.stage.frontZ - 7.75,
  catwalkFenceHalfWidth: RINA_STADIUM.stage.catwalk.width * 0.5 + 1.15,
  catwalkFenceTipZ:
    RINA_STADIUM.stage.catwalk.centerZ - RINA_STADIUM.stage.catwalk.depth * 0.5 - 1.15,
  spectatorClearance: 0.75,
} as const;

export const RINA_LEVEL_QUALITY = {
  desktop: {
    fogDensity: 0.0011,
    standTiers: 9,
    movingSpotlights: 4,
    pyroJets: 8,
    crowdPreviewCount: 420,
  },
  mobile: {
    fogDensity: 0.00072,
    standTiers: 6,
    movingSpotlights: 2,
    pyroJets: 4,
    crowdPreviewCount: 180,
  },
} as const;

export const RINA_GRASS_TEXTURES = {
  desktop: {
    albedo: "/assets/textures/rina/stadium/grass/lawn_grass_albedo_night_2k.webp",
    normal: "/assets/textures/rina/stadium/grass/lawn_grass_normal_2k.png",
    orm: "/assets/textures/rina/stadium/grass/lawn_grass_orm_2k.png",
  },
  mobile: {
    albedo: "/assets/textures/rina/stadium/grass/lawn_grass_albedo_night_1k.webp",
    normal: "/assets/textures/rina/stadium/grass/lawn_grass_normal_1k.png",
    orm: "/assets/textures/rina/stadium/grass/lawn_grass_orm_1k.png",
  },
} as const;
