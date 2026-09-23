import { Engine } from "@babylonjs/core/Engines/engine";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

export type WaterRippleShaderState = {
  progress: number;
  strength: number;
  alpha: number;
  startRadiusRatio: number;
};

// Wave profile adapted from BroMetal's MIT-licensed Ripples example:
// https://github.com/ericdrowell/brometal/blob/main/packages/website/src/shaders/ripple.shader.ts
const RIPPLE_VERTEX_SOURCE = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 viewProjection;
uniform float uProgress;
uniform float uStrength;
uniform float uStartRadiusRatio;
uniform float uSeed;

varying vec2 vUV;
varying float vWaveHeight;
varying vec3 vWorldPosition;

float rippleEaseInOutCubic(float t) {
  return t < 0.5
    ? 4.0 * t * t * t
    : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
}

float rippleEaseOutCubic(float t) {
  float inverse = 1.0 - t;
  return 1.0 - inverse * inverse * inverse;
}

float ripplePulse(float radius, float front, float width) {
  float phase = clamp(0.5 + (front - radius) / max(width * 2.0, 0.0001), 0.0, 1.0);
  // BroMetal's ripple profile: an eased phase minus its linear phase creates
  // a crest followed by a trough without a sine texture.
  return (rippleEaseInOutCubic(phase) - phase) * 2.6;
}

float rippleField(vec2 centeredUV) {
  float angle = atan(centeredUV.y, centeredUV.x);
  float irregularRadius = length(centeredUV);
  irregularRadius += sin(angle * 3.0 + uSeed * 1.7) * 0.006;
  irregularRadius += sin(angle * 7.0 - uSeed * 0.9) * 0.003;

  float easedProgress = rippleEaseOutCubic(clamp(uProgress, 0.0, 1.0));
  float front = mix(uStartRadiusRatio, 0.92, easedProgress);
  float width = mix(0.105, 0.052, easedProgress);
  float primary = ripplePulse(irregularRadius, front, width);

  float secondaryFront = max(uStartRadiusRatio * 0.68, front - mix(0.18, 0.115, easedProgress));
  float secondary = ripplePulse(irregularRadius, secondaryFront, width * 0.82) * 0.42;

  float edgeFalloff = 1.0 - smoothstep(0.84, 1.0, irregularRadius);
  return (primary + secondary) * edgeFalloff;
}

void main(void) {
  vec2 centeredUV = (uv - 0.5) * 2.0;
  float wave = rippleField(centeredUV);
  float life = smoothstep(0.0, 0.055, uProgress) *
    (1.0 - smoothstep(0.62, 1.0, uProgress));

  vec3 displacedPosition = position;
  displacedPosition.y += wave * 0.038 * uStrength * life;
  vec4 worldPosition = world * vec4(displacedPosition, 1.0);

  vUV = uv;
  vWaveHeight = wave;
  vWorldPosition = worldPosition.xyz;
  gl_Position = viewProjection * worldPosition;
}
`;

const RIPPLE_FRAGMENT_SOURCE = `
precision highp float;

uniform float uProgress;
uniform float uStrength;
uniform float uAlpha;
uniform vec3 uCrestColor;
uniform vec3 uBodyColor;
uniform vec3 uTroughColor;

varying vec2 vUV;
varying float vWaveHeight;
varying vec3 vWorldPosition;

void main(void) {
  vec2 centeredUV = (vUV - 0.5) * 2.0;
  float radialDistance = length(centeredUV);
  if (radialDistance > 1.0) discard;

  float crest = max(vWaveHeight, 0.0);
  float trough = max(-vWaveHeight, 0.0);
  float waveMagnitude = abs(vWaveHeight);
  float ringMask = smoothstep(0.025, 0.34, waveMagnitude);
  float life = smoothstep(0.0, 0.055, uProgress) *
    (1.0 - smoothstep(0.62, 1.0, uProgress));

  // A tiny world-space variation prevents every pooled ripple from looking
  // like the same stamped decal while remaining stable as the camera moves.
  float variation = 0.93 + 0.07 * sin(
    vWorldPosition.x * 1.73 + vWorldPosition.z * 1.19
  );
  float crestMix = smoothstep(0.015, 0.42, crest);
  float troughMix = smoothstep(0.02, 0.36, trough);
  vec3 color = mix(uBodyColor, uCrestColor, crestMix);
  color = mix(color, uTroughColor, troughMix * 0.72);

  float opacity = ringMask * uAlpha * life * variation;
  opacity *= mix(0.72, 1.0, clamp(uStrength, 0.0, 1.0));
  if (opacity < 0.004) discard;

  gl_FragColor = vec4(color, opacity);
}
`;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Creates one material for a pooled ripple slot. Babylon reuses the compiled
 * Effect, while independent material instances keep per-ripple uniforms safe.
 */
export function createWaterRippleShaderMaterial(
  scene: Scene,
  slotIndex: number
) {
  const material = new ShaderMaterial(
    "waterContactRippleMaterial",
    scene,
    {
      vertexSource: RIPPLE_VERTEX_SOURCE,
      fragmentSource: RIPPLE_FRAGMENT_SOURCE,
    },
    {
      attributes: ["position", "uv"],
      uniforms: [
        "world",
        "viewProjection",
        "uProgress",
        "uStrength",
        "uAlpha",
        "uStartRadiusRatio",
        "uSeed",
        "uCrestColor",
        "uBodyColor",
        "uTroughColor",
      ],
      needAlphaBlending: true,
      needAlphaTesting: false,
    }
  );

  material.backFaceCulling = false;
  material.alphaMode = Engine.ALPHA_COMBINE;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.disableDepthWrite = true;
  material.needDepthPrePass = false;
  material.zOffset = -1;
  material.setFloat("uProgress", 1);
  material.setFloat("uStrength", 0);
  material.setFloat("uAlpha", 0);
  material.setFloat("uStartRadiusRatio", 0.08);
  material.setFloat("uSeed", slotIndex * 1.61803398875 + 0.37);
  material.setColor3("uCrestColor", new Color3(0.79, 0.94, 0.95));
  material.setColor3("uBodyColor", new Color3(0.42, 0.72, 0.76));
  material.setColor3("uTroughColor", new Color3(0.12, 0.31, 0.36));
  return material;
}

export function setWaterRippleShaderState(
  material: ShaderMaterial,
  state: WaterRippleShaderState
) {
  material.setFloat("uProgress", clamp01(state.progress));
  material.setFloat("uStrength", clamp01(state.strength));
  material.setFloat("uAlpha", Math.max(0, state.alpha));
  material.setFloat(
    "uStartRadiusRatio",
    Math.max(0, Math.min(0.9, state.startRadiusRatio))
  );
}
