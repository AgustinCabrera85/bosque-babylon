import { Scene } from "@babylonjs/core/scene";

// The level owns its EXP2 fog. A small additive adjustment retains nearby
// readability while letting distant masonry fade into the procedural sky.
const FOG_DENSITY_BOOST = {
  desktop: 0.000055,
  mobile: 0.000015,
  maximum: 0.00078,
} as const;

/** Local sanctuary haze, without camera-facing smoke sheets or extra passes. */
export function createSanctuaryAtmosphere(scene: Scene, mobile: boolean, intensity = 1) {
  const strength = Math.max(0, Math.min(1, intensity));
  if (scene.fogMode === Scene.FOGMODE_EXP2 && strength > 0) {
    const boost = mobile ? FOG_DENSITY_BOOST.mobile : FOG_DENSITY_BOOST.desktop;
    scene.fogDensity = Math.min(FOG_DENSITY_BOOST.maximum, scene.fogDensity + boost * strength);
  }

  // SanctuaryGeometry still calls update each frame. The sky shader owns the
  // movement; global fog stays stable instead of visibly pulsing in unison.
  return { update(_timeSeconds: number) {} };
}
