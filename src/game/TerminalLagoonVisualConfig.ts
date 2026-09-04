export type TerminalLagoonVisualConfig = {
  lagoon: {
    baseWaveAmplitude: number;
    baseWaveSpeed: number;
    rippleAmplitude: number;
    rippleFrequency: number;
    rippleSpeed: number;
    rippleFalloff: number;
    rippleRadius: number;
  };
  waterfall: {
    alpha: number;
    emissive: number;
    widthVariation: number;
    noiseStrength: number;
    scrollSpeed: number;
    secondaryLayerAlpha: number;
  };
  impact: {
    foamAlpha: number;
    splashCapacity: number;
    splashEmitRate: number;
    burstCapacity: number;
    burstMinCount: number;
    burstMaxCount: number;
    burstMinInterval: number;
    burstMaxInterval: number;
    mistCapacity: number;
  };
  underwater: {
    waterLevel: number;
    tintColor: readonly [number, number, number];
    blurAmount: number;
    distortionAmount: number;
    fogStrength: number;
    transitionBandThickness: number;
    contrast: number;
  };
};

/**
 * Central tuning for the terminal lagoon. Values are intentionally conservative:
 * this is a still, dark forest pool rather than an ocean or emissive fantasy lake.
 */
export const TERMINAL_LAGOON_VISUAL_CONFIG: TerminalLagoonVisualConfig = {
  lagoon: {
    baseWaveAmplitude: 0.045,
    baseWaveSpeed: 0.028,
    rippleAmplitude: 0.04,
    rippleFrequency: 0.95,
    rippleSpeed: 1.85,
    rippleFalloff: 0.045,
    rippleRadius: 58,
  },
  waterfall: {
    alpha: 0.86,
    emissive: 0.3,
    widthVariation: 0.17,
    noiseStrength: 0.36,
    scrollSpeed: 0.38,
    secondaryLayerAlpha: 0.72,
  },
  impact: {
    foamAlpha: 0.74,
    splashCapacity: 72,
    splashEmitRate: 31,
    burstCapacity: 72,
    burstMinCount: 12,
    burstMaxCount: 28,
    burstMinInterval: 0.24,
    burstMaxInterval: 0.62,
    mistCapacity: 96,
  },
  underwater: {
    waterLevel: -0.65,
    tintColor: [0.055, 0.23, 0.24],
    blurAmount: 0.85,
    distortionAmount: 0.0018,
    fogStrength: 1.3,
    transitionBandThickness: 0.7,
    contrast: 0.84,
  },
};
