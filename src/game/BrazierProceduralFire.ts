import { Engine } from "@babylonjs/core/Engines/engine";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

export type BrazierFireQuality = "low" | "high";

export type BrazierProceduralFireOptions = {
  scene: Scene;
  parent: TransformNode;
  width: number;
  height: number;
  quality: BrazierFireQuality;
  phase?: number;
  intensity?: number;
};

export type BrazierProceduralFireHandle = {
  meshes: readonly Mesh[];
  setEnabled(enabled: boolean): void;
  setIntensity(intensity: number): void;
  dispose(): void;
};

const CORE_COLOR = new Color3(1.0, 0.92, 0.58);
const BODY_COLOR = new Color3(1.0, 0.34, 0.035);
const EDGE_COLOR = new Color3(0.48, 0.025, 0.008);
const SMOKE_COLOR = new Color3(0.055, 0.025, 0.02);
const MAX_DELTA_SECONDS = 0.05;

const BRAZIER_FIRE_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 worldViewProjection;

varying vec2 vUV;
varying vec3 vWorldPosition;
varying float vPlaneSeed;

void main(void) {
  vUV = uv;
  vec4 worldPosition = world * vec4(position, 1.0);
  vec3 worldNormal = normalize(mat3(world) * normal);
  vWorldPosition = worldPosition.xyz;
  // A stable orientation seed prevents the crossed cards from showing the
  // same silhouette in mirror without requiring a material per card.
  vPlaneSeed = dot(worldNormal.xz, vec2(3.17, 7.23));
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// Fire field adapted from BroMetal's MIT-licensed Fire example:
// https://github.com/ericdrowell/brometal/blob/main/packages/brometal/src/shaders/fire.shader.ts
const BRAZIER_FIRE_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUV;
varying vec3 vWorldPosition;
varying float vPlaneSeed;

uniform float uTime;
uniform float uAspect;
uniform float uIntensity;
uniform float uLayerOpacity;
uniform float uPhase;
uniform vec3 uCoreColor;
uniform vec3 uBodyColor;
uniform vec3 uEdgeColor;
uniform vec3 uSmokeColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise2D(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

float fireFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 octaveRotation = mat2(0.82, -0.57, 0.57, 0.82);
#ifdef BRAZIER_FIRE_LOW
  for (int octave = 0; octave < 3; octave++) {
#else
  for (int octave = 0; octave < 5; octave++) {
#endif
    value += valueNoise2D(p) * amplitude;
    p = octaveRotation * p * 2.03 + vec2(17.13, 9.27);
    amplitude *= 0.5;
  }
  return value;
}

void main(void) {
  float y = clamp(vUV.y, 0.0, 1.0);
  float centeredX = vUV.x - 0.5;
  float riseTime = uTime * 1.28;
  float orientationVariation = vPlaneSeed * 0.173;
  float worldVariation = dot(vWorldPosition.xz, vec2(0.29, -0.21));

  vec2 flow = vec2(
    vUV.x * max(uAspect, 0.28) * 2.42 +
      uPhase * 0.31 +
      orientationVariation +
      worldVariation * 0.045,
    y * 2.02 - riseTime
  );
  float primaryNoise = fireFbm(flow * 2.18);
  float detailNoise = fireFbm(
    flow * 3.61 +
      vec2(7.3 + orientationVariation * 2.7, -uTime * 0.37)
  );
  float breakupNoise = fireFbm(
    vec2(
      centeredX * 4.35 + uPhase + orientationVariation * 1.9,
      y * 3.52 - uTime * 1.47
    )
  );

  // The first ten percent is a fixed origin. Turbulence and lateral drift
  // grow above it instead of swinging the complete flame card.
  float motionInfluence = smoothstep(0.10, 0.62, y);
  float contourNoise = mix(0.5, primaryNoise, smoothstep(0.055, 0.28, y));
  float lateralOffset =
    ((primaryNoise - 0.5) * mix(0.025, 0.205, y) +
      (detailNoise - 0.5) * 0.075 +
      sin(y * 8.2 - uTime * 1.16 + orientationVariation) * 0.028) *
    motionInfluence;

  float taper = mix(0.465, 0.052, pow(y, 1.16));
  float lowerShoulder =
    smoothstep(0.035, 0.18, y) * (1.0 - smoothstep(0.28, 0.48, y));
  taper += lowerShoulder * 0.034;
  taper += (contourNoise - 0.5) * mix(0.018, 0.105, y) * motionInfluence;

  float lateralDistance = abs(centeredX + lateralOffset);
  float lateralMask = 1.0 - smoothstep(
    max(0.012, taper * 0.69),
    max(0.026, taper),
    lateralDistance
  );

  float verticalShape = clamp(
    1.27 -
      y * 1.58 +
      (contourNoise - 0.5) * mix(0.22, 1.14, motionInfluence) +
      (detailNoise - 0.5) * 0.24 * motionInfluence,
    0.0,
    1.0
  );
  float baseFade = smoothstep(0.0, 0.048, y);
  float topFade = 1.0 - smoothstep(0.91, 1.0, y);
  float tipRegion = smoothstep(0.43, 0.93, y);
  float tipBreakup = mix(
    1.0,
    smoothstep(0.26, 0.67, primaryNoise + detailNoise * 0.25),
    tipRegion * 0.88
  );
  float sideBreakup = mix(
    1.0,
    smoothstep(0.24, 0.70, breakupNoise + primaryNoise * 0.17),
    smoothstep(0.30, 0.86, y) *
      smoothstep(taper * 0.40, taper * 0.94, lateralDistance) *
      0.72
  );
  float flameField = clamp(
    verticalShape * lateralMask * baseFade * topFade * tipBreakup * sideBreakup,
    0.0,
    1.0
  );

  float normalizedDistance = lateralDistance / max(taper, 0.035);
  float centralHeat = 1.0 - smoothstep(0.10, 0.86, normalizedDistance);
  float lowerHeat = 1.0 - smoothstep(0.42, 0.88, y);
  float heat = clamp(
    pow(flameField, 1.34) *
      (0.46 + centralHeat * 0.54) *
      (0.72 + lowerHeat * 0.28) *
      (0.86 + primaryNoise * 0.24),
    0.0,
    1.0
  );

  float bodyAmount = smoothstep(0.055, 0.52, heat);
  float coreAmount =
    smoothstep(0.34, 0.83, heat) *
    (1.0 - smoothstep(0.55, 0.80, y)) *
    (1.0 - smoothstep(0.18, 0.97, normalizedDistance));
  vec3 color = mix(uEdgeColor, uBodyColor, bodyAmount);
  color = mix(color, uCoreColor, coreAmount * 0.88);

  float coolingEdge =
    flameField *
    smoothstep(0.70, 0.98, y) *
    (1.0 - smoothstep(0.18, 0.54, heat));
  color = mix(color, uSmokeColor, coolingEdge * 0.16);

  float alpha =
    smoothstep(0.045, 0.40, flameField) *
    (0.82 + primaryNoise * 0.18) *
    uLayerOpacity *
    clamp(uIntensity, 0.0, 2.0);
  alpha *= 1.0 - smoothstep(0.94, 1.0, y);

  if (alpha < 0.012) discard;
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.72));
}
`;

/** Creates a lightweight crossed-plane flame while leaving light gameplay external. */
export function createBrazierProceduralFire(
  options: BrazierProceduralFireOptions
): BrazierProceduralFireHandle {
  const { scene, parent, quality } = options;
  const width = Math.max(0.01, options.width);
  const height = Math.max(0.01, options.height);
  const phase = Number.isFinite(options.phase) ? (options.phase as number) : 0;
  const planeCount = quality === "low" ? 2 : 3;

  const material = new ShaderMaterial(
    "endHouseBrazierProceduralFireMaterial",
    scene,
    {
      vertexSource: BRAZIER_FIRE_VERTEX_SHADER,
      fragmentSource: BRAZIER_FIRE_FRAGMENT_SHADER,
    },
    {
      attributes: ["position", "normal", "uv"],
      uniforms: [
        "world",
        "worldViewProjection",
        "uTime",
        "uAspect",
        "uIntensity",
        "uLayerOpacity",
        "uPhase",
        "uCoreColor",
        "uBodyColor",
        "uEdgeColor",
        "uSmokeColor",
      ],
      defines: [
        quality === "low"
          ? "#define BRAZIER_FIRE_LOW"
          : "#define BRAZIER_FIRE_HIGH",
      ],
      needAlphaBlending: true,
    }
  );
  material.alphaMode = Engine.ALPHA_COMBINE;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.needDepthPrePass = false;
  material.setFloat("uTime", 0);
  material.setFloat("uAspect", width / height);
  material.setFloat("uLayerOpacity", quality === "low" ? 0.7 : 0.58);
  material.setFloat("uPhase", phase);
  material.setColor3("uCoreColor", CORE_COLOR);
  material.setColor3("uBodyColor", BODY_COLOR);
  material.setColor3("uEdgeColor", EDGE_COLOR);
  material.setColor3("uSmokeColor", SMOKE_COLOR);

  let intensity = Math.max(0, options.intensity ?? 1);
  material.setFloat("uIntensity", intensity);

  const meshes = Array.from({ length: planeCount }, (_, planeIndex) => {
    const mesh = MeshBuilder.CreatePlane(
      `endHouseBrazierProceduralFirePlane_${planeIndex}`,
      { width, height },
      scene
    );
    mesh.parent = parent;
    mesh.position.y = height * 0.5;
    mesh.rotation.y = (Math.PI * planeIndex) / planeCount;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.applyFog = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = 1;
    mesh.alphaIndex = 20 + planeIndex;
    return mesh;
  });

  let elapsed = 0;
  let enabled = true;
  let disposed = false;
  const timeObserver = scene.onBeforeRenderObservable.add(() => {
    if (!enabled || disposed) return;
    const deltaSeconds = Math.max(
      0,
      Math.min(scene.getEngine().getDeltaTime() * 0.001, MAX_DELTA_SECONDS)
    );
    elapsed += deltaSeconds;
    material.setFloat("uTime", elapsed);
  });

  let sceneDisposeObserver: ReturnType<
    typeof scene.onDisposeObservable.addOnce
  > | null = null;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    scene.onBeforeRenderObservable.remove(timeObserver);
    if (sceneDisposeObserver) {
      scene.onDisposeObservable.remove(sceneDisposeObserver);
      sceneDisposeObserver = null;
    }
    for (const mesh of meshes) mesh.dispose(false, false);
    material.dispose(true, false);
  };

  sceneDisposeObserver = scene.onDisposeObservable.addOnce(dispose);

  return {
    meshes,
    setEnabled(nextEnabled: boolean) {
      if (disposed || enabled === nextEnabled) return;
      enabled = nextEnabled;
      for (const mesh of meshes) mesh.setEnabled(nextEnabled);
    },
    setIntensity(nextIntensity: number) {
      if (disposed) return;
      intensity = Math.max(0, nextIntensity);
      material.setFloat("uIntensity", intensity);
    },
    dispose,
  };
}
