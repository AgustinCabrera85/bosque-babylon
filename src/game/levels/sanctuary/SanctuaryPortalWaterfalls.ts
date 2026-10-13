import { Engine } from "@babylonjs/core/Engines/engine";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Waterfalls for the Sanctuary gateway. Standalone Babylon 9 / WebGL module.
 *
 * Each fall is a closed-cross-section ribbon volume (NOT a camera-facing quad).
 * The upper centerline is a cubic Bezier emerging from a stone placeholder:
 * it turns outwards above the wall, then becomes a mostly vertical stream.
 *
 * The placeholder is intentionally removable: mount the future gargoyle GLB
 * under the exported gargoyleMount, then call setPlaceholderVisible(false).
 *
 * The local impact effect uses two surface patches and bounded spray pools.
 */
export type SanctuaryFallsQuality = "low" | "high";
export type SanctuaryFallSide = "left" | "right";

export interface SanctuaryPortalWaterfallsOptions {
  /** SANCTUARY_ASCENT.wallFrontZ */
  wallFrontZ: number;
  /** The river-facing edge of the solid plinth; the impact is in front of this. */
  baseFrontZ: number;
  /** SANCTUARY_ASCENT.upperY + SANCTUARY_ASCENT.portalHeight */
  portalTopY: number;
  /** SANCTUARY_CONFIG.riverY */
  riverY: number;
  /** Shared stone material already created by SanctuaryStone.ts. */
  placeholderStone: StandardMaterial;
  /** Symmetric reserved positions ±560 in SanctuaryGeometry.ts. */
  lateralOffset?: number;
  /** Visible waterfall width in Babylon world units. */
  width?: number;
  /** How far above the portal top the outlet is situated. */
  sourceRise?: number;
  /** How far toward the river the impact is from the plinth edge. */
  impactClearance?: number;
  /** Perforated stone socket is replaced later by a gargoyle GLB. */
  showPlaceholders?: boolean;
  quality?: SanctuaryFallsQuality;
  /** Legacy single speed override; prefer lipFlowSpeed/fallFlowSpeed. */
  flowSpeed?: number;
  lipFlowSpeed?: number;
  fallFlowSpeed?: number;
  splashOpacity?: number;
  splashRadius?: number;
  splashHeight?: number;
  sprayParticleSize?: number;
  splashLifetime?: number;
  impactVerticalOffset?: number;
  sprayParticleRate?: number;
  mistDriftSpeed?: number;
  impactPulseStrength?: number;
  /** Returns displacement above riverY at a world position. */
  sampleWaterHeight?: (x: number, z: number, elapsedSeconds: number) => number;
  /** Horizontal drift of the stream; 1 is restrained. */
  meander?: number;
  /** Narrow the top of the stream, e.g. 0.28. */
  topNarrowing?: number;
  /** Widen the bottom before the water impact, e.g. 0.22. */
  bottomSpread?: number;
  /** Vertical distance occupied by the bent exit section. */
  bendDrop?: number;
  /** How far the stream travels forward over its first Bezier control. */
  bendLip?: number;
  /** Controls irregularities in width and lateral meander. */
  shapeChaos?: number;
  /** Controls edge turbulence (0..1 recommended). */
  edgeRaggedness?: number;
  /** Controls opacity (0..1). */
  opacity?: number;
  /** Optional red tint; contrast is still built by the shader. */
  color?: Color3;
  /** Brighter liquid and pale flecks at the impact, independently of the fall. */
  splashColor?: Color3;
  enabled?: boolean;
}

export interface SanctuaryFallSource {
  id: SanctuaryFallSide;
  /** Local origin / socket. Attach gargoyle GLBs here in the future. */
  gargoyleMount: TransformNode;
  /** World-space location where the falling liquid visibly exits the socket. */
  mouthPosition: Vector3;
  /** World-space impact position shared by the stream and local splash. */
  impactPosition: Vector3;
  /** Removes the placeholder only; the water flow remains. */
  setPlaceholderVisible(visible: boolean): void;
}

export interface SanctuaryPortalWaterfallsHandle {
  readonly sources: readonly SanctuaryFallSource[];
  update(elapsedSeconds: number, cameraWorldPosition: Vector3): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const SAT = (x: number) => Math.max(0, Math.min(1, x));
const SMOOTH = (a: number, b: number, x: number) => {
  const t = SAT((x - a) / Math.max(0.00001, b - a));
  return t * t * (3 - 2 * t);
};

// World-space scale and animation controls for both impacts.
const FALLS_TUNING = {
  lipFlowSpeed: 5.5,
  fallFlowSpeed: 16.0,
  splashOpacity: 0.94,
  splashRadius: 26,
  splashHeight: 34,
  sprayParticleRate: 82,
  sprayParticleSize: 2.0,
  splashLifetime: 1.65,
  impactVerticalOffset: 0.46,
  mistDriftSpeed: 0.4,
  impactPulseStrength: 0.31,
} as const;

// The integral of smoothstep keeps phase and its velocity continuous across
// the curved lip (ending at t=0.19) and the vertical fall.
const FLOW_PHASE = `
uniform float uLipFlowSpeed;
uniform float uFallFlowSpeed;
float flowPhase(float t) {
  float start = 0.10;
  float finish = 0.28;
  float width = finish - start;
  float s = clamp((t - start) / width, 0.0, 1.0);
  float transitionIntegral = width * (s*s*s - 0.5*s*s*s*s);
  float integral = t <= start ? 0.0 :
    (t < finish ? transitionIntegral : 0.5*width + t - finish);
  float ratio = uLipFlowSpeed / max(uFallFlowSpeed, 0.001);
  return 76.0 * (t - (1.0 - ratio) * integral) - uTime * uLipFlowSpeed;
}
`;

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float uTime;
uniform float uRipple;
${FLOW_PHASE}
varying vec2 vUV;
varying vec3 vWorld;
varying vec3 vNormal;
void main(void) {
  vec3 p = position;
  // A little surface motion in 3D; the base mesh already contains the full bend.
  float body = smoothstep(0.015, 0.12, uv.y) * (1.0 - smoothstep(0.97, 1.0, uv.y));
  float angle = uv.x * 6.2831853;
  float flow = flowPhase(uv.y);
  float waveA = sin(flow * (84.0 / 76.0) + 2.7 * sin(angle));
  float waveB = sin(flow * (141.0 / 76.0) - 3.1 * cos(angle * 2.0));
  float turbulence = 1.0 + 0.18 * smoothstep(0.19, 0.42, uv.y);
  p.x += (waveA * 0.72 + waveB * 0.28) * body * uRipple * turbulence;
  p.z += (waveB * 0.70 + waveA * 0.30) * body * uRipple * 0.6 * turbulence;
  vWorld = (world * vec4(p, 1.0)).xyz;
  vNormal = normalize((world * vec4(normal, 0.0)).xyz);
  vUV = uv;
  gl_Position = worldViewProjection * vec4(p, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorld;
varying vec3 vNormal;
uniform float uTime;
${FLOW_PHASE}
uniform float uEdgeRaggedness;
uniform float uOpacity;
uniform float uTopY;
uniform float uFogDensity;
uniform vec3 uCameraPosition;
uniform vec3 uTint;
uniform vec3 uFogColor;
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), f.x),
             mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), f.x), f.y);
}
void main(void) {
  // Positive UV.y points DOWN. Subtracting time carries the pattern downwards.
  float flow = flowPhase(vUV.y);
  float angle = vUV.x * 6.2831853;
  vec2 circumference = vec2(cos(angle), sin(angle));
  vec2 p = vec2(circumference.x * 7.5 + flow * 0.03,
    circumference.y * 7.5 + flow * 0.22);
  float low = noise2(p * vec2(0.38, 0.47));
  float high = noise2(p * vec2(1.15, 1.70) + 4.3);
  float streak = pow(0.5 + 0.5 * sin(angle * 16.0 + low * 4.0 + flow * 0.46), 5.0);
  float bands = 0.5 + 0.5 * sin(angle * 6.0 + flow * 0.85 + high * 2.5);
  float variation = clamp(low * 0.62 + high * 0.24 + bands * 0.14, 0.0, 1.0);

  float side = abs(cos(angle));
  float core = 1.0 - smoothstep(0.34, 0.92, side);
  float brightDetail = pow(variation, 1.45);
  vec3 dark = uTint * 0.16;
  vec3 mid = uTint * (0.60 + brightDetail * 0.85);
  vec3 col = mix(dark, mid, 0.20 + brightDetail * 0.48 + core * 0.22);
  vec3 viewDir = normalize(uCameraPosition - vWorld);
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.0);
  col += uTint * (0.10 * fresnel + 0.16 * streak);

  // Smooth, ragged silhouette. The volume stays genuinely 3D.
  float jagged = (high - 0.5) * uEdgeRaggedness * 0.21;
  float edge = 1.0 - smoothstep(0.77 + jagged, 1.0 + jagged, side);
  float entry = smoothstep(0.005, 0.060, vUV.y);
  float end = 1.0 - smoothstep(0.972, 1.0, vUV.y);
  float hazeAtTop = 1.0 - 0.32 * smoothstep(uTopY - 150.0, uTopY + 10.0, vWorld.y);
  float dist = length(uCameraPosition - vWorld);
  float fog = clamp(1.0 - exp(-dist * uFogDensity * 0.5), 0.0, 0.52);
  col = mix(col, uFogColor, fog);
  float alpha = uOpacity * edge * entry * end * hazeAtTop;
  alpha *= (0.86 + 0.14 * variation) * (1.0 - 0.30 * fog);
  if (alpha < 0.015) discard;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
}
`;

const IMPACT_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec2 vLocal;
varying vec3 vWorld;
void main(void) {
  vLocal = position.xz;
  vWorld = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const IMPACT_FRAGMENT = `
precision highp float;
varying vec2 vLocal;
varying vec3 vWorld;
uniform float uTime;
uniform float uRadius;
uniform float uOpacity;
uniform float uDriftSpeed;
uniform float uPulseStrength;
uniform float uFogDensity;
uniform vec3 uCameraPosition;
uniform vec3 uFogColor;
uniform vec3 uTint;
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), f.x),
             mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), f.x), f.y);
}
void main(void) {
  float radius = length(vLocal);
  float angle = atan(vLocal.y, vLocal.x);
  float drift = uTime * uDriftSpeed;
  float noise = noise2(vLocal * 0.32 + vec2(drift, -drift*0.63));
  float center = 1.0 - smoothstep(uRadius*0.10, uRadius*0.70,
    radius + (noise-0.5)*uRadius*0.22);
  float churning = 0.66 + 0.34 * noise2(vLocal*0.75 - vec2(drift*1.9, drift));
  float waves = 0.0;
  for (int i = 0; i < 2; i++) {
    float age = fract(uTime*0.45 + float(i)*0.5);
    float irregular = uRadius * (0.038*sin(angle*7.0 + drift*2.3 + float(i)*2.1)
      + 0.021*sin(angle*11.0 - drift*1.5));
    float ringRadius = uRadius * (0.14 + 0.78*age) + irregular;
    float difference = (radius - ringRadius) / (uRadius * 0.105);
    waves += exp(-difference*difference*2.0) * (1.0-age) * (0.72 + 0.28*noise);
  }
  float pulse = 1.0 + uPulseStrength * sin(uTime*5.2 + radius*0.7);
  float alpha = uOpacity * (0.82*center*churning*pulse + 0.78*waves);
  alpha *= 1.0 - smoothstep(uRadius*0.90, uRadius*1.22, radius);
  if (alpha < 0.012) discard;
  vec3 color = mix(uTint*0.48, uTint*1.12,
    clamp(0.25 + 0.50*churning + 0.35*waves, 0.0, 1.0));
  float paleFlecks = smoothstep(0.73, 0.93,
    noise2(vLocal*0.88 + vec2(-drift*2.1, drift*1.4)));
  color = mix(color, vec3(0.90, 0.79, 0.76),
    paleFlecks * clamp(center*0.12 + waves*0.38, 0.0, 0.38));
  float fog = clamp(1.0-exp(-length(uCameraPosition-vWorld)*uFogDensity*0.09), 0.0, 0.16);
  color = mix(color, uFogColor, fog);
  gl_FragColor = vec4(color, min(alpha*(1.0-0.10*fog), 0.86));
}
`;

const SPRAY_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec2 vUV;
varying vec4 vColor;
varying vec3 vWorld;
void main(void) {
  vUV = uv;
  vColor = color;
  vWorld = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const SPRAY_FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying vec4 vColor;
varying vec3 vWorld;
uniform float uFogDensity;
uniform vec3 uCameraPosition;
uniform vec3 uFogColor;
void main(void) {
  float side = 1.0 - smoothstep(0.22, 0.51, abs(vUV.x-0.5));
  float lengthFade = smoothstep(0.02, 0.32, vUV.y) *
    (1.0-smoothstep(0.70, 1.0, vUV.y));
  float alpha = vColor.a * side * lengthFade;
  if (alpha < 0.012) discard;
  float fog = clamp(1.0-exp(-length(uCameraPosition-vWorld)*uFogDensity*0.09), 0.0, 0.16);
  float paleTip = smoothstep(0.66, 0.88, vUV.y) *
    (1.0-smoothstep(0.93, 1.0, vUV.y));
  vec3 color = mix(vColor.rgb, vec3(0.88, 0.77, 0.73), paleTip*vColor.a*0.38);
  color = mix(color, uFogColor, fog);
  gl_FragColor = vec4(color, alpha*(1.0-0.10*fog));
}
`;

const CROWN_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float uTime;
varying vec2 vUV;
varying vec3 vWorld;
void main(void) {
  vec3 p = position;
  float angle = atan(p.z, p.x);
  vec2 tangent = vec2(-sin(angle), cos(angle));
  p.xz += tangent * sin(uTime*3.2 + uv.y*11.0 + angle*6.0)
    * (0.18 + 0.88*uv.y*uv.y);
  vUV = uv;
  vWorld = (world * vec4(p, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(p, 1.0);
}
`;

const CROWN_FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorld;
uniform float uTime;
uniform float uOpacity;
uniform float uFogDensity;
uniform vec3 uTint;
uniform vec3 uCameraPosition;
uniform vec3 uFogColor;
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), f.x),
             mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), f.x), f.y);
}
void main(void) {
  float across = abs(vUV.x*2.0-1.0);
  float movement = uTime*1.8;
  float breakup = noise2(vec2(vUV.x*5.0+vWorld.x*0.065,
    vUV.y*7.0-movement+vWorld.z*0.045));
  float threads = 0.5 + 0.5*sin(vUV.x*25.0 + vUV.y*19.0 - uTime*7.0 + breakup*3.0);
  float body = smoothstep(0.0, 0.12, vUV.y) *
    (1.0-smoothstep(0.78, 1.0, vUV.y));
  float edge = 1.0-smoothstep(0.58, 1.0, across + (breakup-0.5)*0.23);
  float alpha = uOpacity * 0.85 * body * edge *
    smoothstep(0.14, 0.49, breakup + threads*0.18);
  if (alpha < 0.016) discard;
  float foamTip = smoothstep(0.57, 0.84, vUV.y) *
    (1.0-smoothstep(0.89, 1.0, vUV.y)) * smoothstep(0.59, 0.79, breakup);
  float foamEdge = smoothstep(0.52, 0.86, across) *
    smoothstep(0.46, 0.76, threads) * (1.0-vUV.y*0.45);
  float pale = clamp(foamTip*0.77 + foamEdge*0.30, 0.0, 0.76);
  vec3 color = mix(uTint*(0.49+0.47*breakup), vec3(0.91, 0.82, 0.78), pale);
  float fog = clamp(1.0-exp(-length(uCameraPosition-vWorld)*uFogDensity*0.09), 0.0, 0.16);
  color = mix(color, uFogColor, fog);
  gl_FragColor = vec4(color, alpha*(1.0-0.10*fog));
}
`;

function bezier3(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number) {
  const q = 1 - t;
  return a.scale(q*q*q)
    .add(b.scale(3*q*q*t))
    .add(c.scale(3*q*t*t))
    .add(d.scale(t*t*t));
}

function makeFallMesh(scene: Scene, id: SanctuaryFallSide, settings: {
  x: number; outletZ: number; impactZ: number; topY: number; riverY: number;
  width: number; chaos: number; quality: SanctuaryFallsQuality;
  bendDrop: number; bendLip: number; meander: number;
  topNarrowing: number; bottomSpread: number;
}): Mesh {
  const { x, outletZ, impactZ, topY, riverY, width, chaos, quality,
    bendDrop, bendLip, meander, topNarrowing, bottomSpread } = settings;
  const bendEnd = 0.19;
  const phase = id === "left" ? 0.7 : 2.6;
  const p0 = new Vector3(x, topY, outletZ + 10); // hidden inside the stone placeholder
  const p1 = new Vector3(x, topY, outletZ - bendLip); // visible lip, horizontal motion
  const p2 = new Vector3(x, topY - bendDrop * 0.29, impactZ); // rounds down above the wall
  const p3 = new Vector3(x, topY - bendDrop, impactZ); // tangent becomes vertical
  const impactY = riverY + 0.05;

  const centerAt = (t: number) => {
    const clamped = SAT(t);
    const center = clamped <= bendEnd
      ? bezier3(p0, p1, p2, p3, clamped / bendEnd)
      : new Vector3(x,
        topY - bendDrop + (impactY - (topY - bendDrop)) * ((clamped - bendEnd) / (1 - bendEnd)),
        impactZ);
    const sway = SMOOTH(0.05, 0.18, clamped);
    center.x += meander * chaos * sway * (1.1 * Math.sin(clamped * 11 + phase)
      + 0.35 * Math.sin(clamped * 29 + phase * 1.7));
    return center;
  };

  const rows = quality === "high" ? 144 : 74;
  const sides = quality === "high" ? 24 : 14;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ring = sides + 1;
  const xAxis = new Vector3(1, 0, 0);
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const center = centerAt(t);
    const ahead = centerAt(Math.min(1, t + 0.0007));
    const behind = centerAt(Math.max(0, t - 0.0007));
    const tangent = ahead.subtract(behind).normalize();
    const depthAxis = Vector3.Cross(xAxis, tangent).normalize();
    const taper = 1 - topNarrowing * (1 - SMOOTH(0.0, 0.13, t));
    const spread = 1 + bottomSpread * SMOOTH(0.68, 0.97, t);
    const widthNoise = 1 + chaos * (0.055*Math.sin(t*23+phase)
      + 0.027*Math.sin(t*71-phase));
    const halfWidth = width * 0.5 * taper * spread * widthNoise;
    const halfThickness = Math.max(1.3, width * 0.115) * (1 + 0.10 * SMOOTH(0.4, 1, t));
    for (let j = 0; j <= sides; j++) {
      const u = j / sides;
      const angle = u * TAU;
      const co = Math.cos(angle);
      const si = Math.sin(angle);
      const p = center.add(xAxis.scale(co * halfWidth)).add(depthAxis.scale(si * halfThickness));
      const n = xAxis.scale(co / Math.max(0.001, halfWidth))
        .add(depthAxis.scale(si / Math.max(0.001, halfThickness))).normalize();
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      uvs.push(u, t);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i*ring + j;
      const b = a + 1;
      const c = a + ring;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const mesh = new Mesh(`sanctuaryPortalFall_${id}`, scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  // Keep scene depth from the wall and river when the transparent fall renders.
  mesh.renderingGroupId = 0;
  return mesh;
}

const FLOW_SHADER_KEY = "sanctuaryPortalFalls3dV2";
const IMPACT_SHADER_KEY = "sanctuaryPortalFallsImpactV2";
const SPRAY_SHADER_KEY = "sanctuaryPortalFallsSprayV2";
const CROWN_SHADER_KEY = "sanctuaryPortalFallsCrownV1";

function createImpactPatch(scene: Scene, id: SanctuaryFallSide, position: Vector3,
  radius: number, riverY: number, quality: SanctuaryFallsQuality,
  sampleWaterHeight: (x: number, z: number, t: number) => number,
  verticalOffset: number, material: ShaderMaterial) {
  const mesh = MeshBuilder.CreateGround(`sanctuaryFallImpact_${id}`, {
    width: radius * 2.5, height: radius * 2.5,
    subdivisions: quality === "high" ? 14 : 7,
    updatable: true,
  }, scene);
  mesh.position.set(position.x, 0, position.z);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.renderingGroupId = 0;
  const vertices = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const update = (time: number) => {
    // The lightweight river is visually flat; its sampleHeight only bobs the boat.
    position.y = riverY + (quality === "high" ? sampleWaterHeight(position.x, position.z, time) : 0);
    for (let i = 0; i < vertices.length; i += 3) {
      const waterHeight = quality === "high" ? sampleWaterHeight(
        position.x + vertices[i], position.z + vertices[i + 2], time) : 0;
      vertices[i + 1] = riverY + waterHeight + verticalOffset;
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, vertices);
  };
  update(0);
  return { mesh, update };
}

function createImpactCrown(scene: Scene, id: SanctuaryFallSide, position: Vector3,
  radius: number, height: number, verticalOffset: number,
  quality: SanctuaryFallsQuality, material: ShaderMaterial) {
  const mesh = new Mesh(`sanctuaryFallCrown_${id}`, scene);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const tongues = quality === "high" ? 16 : 10;
  const rows = quality === "high" ? 6 : 4;
  const phase = id === "left" ? 0.6 : 2.4;
  for (let tongue = 0; tongue < tongues; tongue++) {
    const angle = TAU * (tongue + 0.14*Math.sin(tongue*2.7+phase)) / tongues;
    const radialX = Math.cos(angle);
    const radialZ = Math.sin(angle);
    const tangentX = -radialZ;
    const tangentZ = radialX;
    const reach = radius * (0.62 + 0.20*Math.sin(tongue*4.3+phase));
    const rise = height * (0.76 + 0.24*Math.sin(tongue*5.1-phase));
    const start = positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      const v = row / rows;
      const spread = 2.5 + reach * (0.28*v + 0.72*v*v);
      const y = verticalOffset + rise * (1.28*v - 0.38*v*v);
      const halfWidth = (1.5 + 4.0*v) *
        (0.82 + 0.18*Math.sin(tongue*3.7 + row*1.9 + phase));
      for (let column = 0; column < 3; column++) {
        const across = column - 1;
        const skew = across * halfWidth + 0.7*v*v*Math.sin(row*2.3+tongue*1.7);
        positions.push(radialX*spread + tangentX*skew, y,
          radialZ*spread + tangentZ*skew);
        uvs.push(column / 2, v);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < 2; column++) {
        const a = start + row*3 + column;
        const b = a + 1;
        const c = a + 3;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const data = new VertexData();
  data.positions = positions;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.position.set(position.x, position.y, position.z);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.renderingGroupId = 0;
  return { mesh, update: () => { mesh.position.y = position.y; } };
}

type SprayParticle = {
  active: boolean;
  age: number;
  life: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  vy: number;
  size: number;
  shade: number;
};

function createSprayPool(scene: Scene, id: SanctuaryFallSide, position: Vector3,
  quality: SanctuaryFallsQuality, radius: number, height: number, rate: number,
  opacity: number, sizeScale: number, lifetime: number, verticalOffset: number,
  tint: Color3, material: ShaderMaterial) {
  const capacity = quality === "high" ? 112 : 48;
  const mesh = new Mesh(`sanctuaryFallSpray_${id}`, scene);
  const positions = new Array<number>(capacity * 12).fill(0);
  const colors = new Array<number>(capacity * 16).fill(0);
  const uvs: number[] = [];
  const indices: number[] = [];
  const particles: SprayParticle[] = [];
  for (let i = 0; i < capacity; i++) {
    const vertex = i * 4;
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
    particles.push({ active: false, age: 0, life: 0, x: 0, z: 0,
      vx: 0, vz: 0, vy: 0, size: 0, shade: 0 });
  }
  const data = new VertexData();
  data.positions = positions;
  data.colors = colors;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh, true);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.renderingGroupId = 0;
  let randomState = id === "left" ? 0x54a72b13 : 0x6c39e285;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  let birthAccumulator = 0;
  let nextSlot = 0;
  const update = (dt: number, camera: Vector3) => {
    const dx = camera.x - position.x;
    const dz = camera.z - position.z;
    const distance = Math.hypot(dx, dz);
    const rightX = distance > 0.001 ? dz / distance : 1;
    const rightZ = distance > 0.001 ? -dx / distance : 0;
    const detail = quality === "high" ? 1 : 0.65;
    const distanceDetail = distance > 850 ? 0.70 : distance > 450 ? 0.85 : 1;
    birthAccumulator = Math.min(4, birthAccumulator + dt * rate * detail * distanceDetail);
    let births = Math.min(4, Math.floor(birthAccumulator));
    birthAccumulator -= births;
    while (births-- > 0) {
      const p = particles[nextSlot];
      nextSlot = (nextSlot + 1) % capacity;
      const angle = random() * TAU;
      const lateral = 1.8 + random() * (radius * 0.48);
      p.active = true;
      p.age = 0;
      p.vy = 12 + random() * Math.sqrt(60 * height) * 0.85;
      p.life = Math.min(lifetime, p.vy / 60 * (1.60 + random() * 0.30));
      p.x = (random() - 0.5) * 2.2;
      p.z = (random() - 0.5) * 2.2;
      p.vx = Math.cos(angle) * lateral;
      p.vz = Math.sin(angle) * lateral;
      p.size = (0.34 + random() * 0.62) * sizeScale;
      p.shade = 0.65 + random() * 0.35;
    }
    for (let i = 0; i < capacity; i++) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) p.active = false;
      const age = p.age;
      const y = position.y + verticalOffset + 0.06 + p.vy*age - 30*age*age;
      const x = position.x + p.x + p.vx*age;
      const z = position.z + p.z + p.vz*age;
      const halfWidth = p.size * 0.5;
      const halfHeight = p.size * (0.65 + 0.28 * Math.max(0, p.vy - 60*age) / 25);
      const base = i * 12;
      for (let corner = 0; corner < 4; corner++) {
        const side = corner % 2 === 0 ? -1 : 1;
        const top = corner >= 2 ? 1 : -1;
        const index = base + corner * 3;
        positions[index] = x + side * rightX * halfWidth;
        positions[index + 1] = y + top * halfHeight;
        positions[index + 2] = z + side * rightZ * halfWidth;
        const ci = i * 16 + corner * 4;
        const brightness = 0.72 + p.shade * 0.5;
        colors[ci] = tint.r * brightness;
        colors[ci + 1] = tint.g * brightness;
        colors[ci + 2] = tint.b * brightness;
        colors[ci + 3] = p.active ? opacity * 0.95 *
          SMOOTH(0, 0.10, age) * (1 - SMOOTH(0.68, 1, age / p.life)) : 0;
      }
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    mesh.updateVerticesData(VertexBuffer.ColorKind, colors);
  };
  return { mesh, update, capacity };
}

export function createSanctuaryPortalWaterfalls(
  scene: Scene,
  options: SanctuaryPortalWaterfallsOptions
): SanctuaryPortalWaterfallsHandle {
  const width = Math.max(3, options.width ?? 22);
  const rise = Math.max(40, options.sourceRise ?? 225);
  const topY = options.portalTopY + rise;
  const xOffset = options.lateralOffset ?? 560;
  const riverY = options.riverY;
  const outletZ = options.wallFrontZ - 32;
  // The impact must be in front of the continuous stone plinth, on open river.
  const impactZ = options.baseFrontZ - Math.max(8, options.impactClearance ?? 32);
  const quality = options.quality ?? "high";
  const opacity = SAT(options.opacity ?? 0.91);
  const chaos = SAT(options.shapeChaos ?? 0.65);
  const meander = Math.max(0, Math.min(3, options.meander ?? 1));
  const topNarrowing = SAT(options.topNarrowing ?? 0.28);
  const bottomSpread = SAT(options.bottomSpread ?? 0.22);
  const bendDrop = Math.max(35, Math.min(160, options.bendDrop ?? 96));
  const bendLip = Math.max(12, Math.min(55, options.bendLip ?? 27));
  const edge = SAT(options.edgeRaggedness ?? 0.44);
  const tint = options.color ?? new Color3(0.38, 0.009, 0.017);
  const splashTint = options.splashColor ?? new Color3(0.72, 0.105, 0.115);
  const lipFlowSpeed = Math.max(0.1, options.lipFlowSpeed ?? options.flowSpeed ?? FALLS_TUNING.lipFlowSpeed);
  const fallFlowSpeed = Math.max(lipFlowSpeed, options.fallFlowSpeed ??
    (options.flowSpeed === undefined ? FALLS_TUNING.fallFlowSpeed : options.flowSpeed * 2.9));
  const splashOpacity = SAT(options.splashOpacity ?? FALLS_TUNING.splashOpacity);
  const splashRadius = Math.max(2, options.splashRadius ?? FALLS_TUNING.splashRadius);
  const splashHeight = Math.max(0.5, options.splashHeight ?? FALLS_TUNING.splashHeight);
  const sprayParticleRate = Math.max(0, options.sprayParticleRate ?? FALLS_TUNING.sprayParticleRate);
  const sprayParticleSize = Math.max(0.1, options.sprayParticleSize ?? FALLS_TUNING.sprayParticleSize);
  const splashLifetime = Math.max(0.1, options.splashLifetime ?? FALLS_TUNING.splashLifetime);
  const impactVerticalOffset = Math.max(0.05, options.impactVerticalOffset ?? FALLS_TUNING.impactVerticalOffset);
  const visualOffset = quality === "high" ? impactVerticalOffset : Math.min(impactVerticalOffset, 0.32);
  const mistDriftSpeed = Math.max(0, options.mistDriftSpeed ?? FALLS_TUNING.mistDriftSpeed);
  const impactPulseStrength = SAT(options.impactPulseStrength ?? FALLS_TUNING.impactPulseStrength);
  const sampleWaterHeight = options.sampleWaterHeight ?? (() => 0);

  Effect.ShadersStore[`${FLOW_SHADER_KEY}VertexShader`] = VERTEX;
  Effect.ShadersStore[`${FLOW_SHADER_KEY}FragmentShader`] = FRAGMENT;
  Effect.ShadersStore[`${IMPACT_SHADER_KEY}VertexShader`] = IMPACT_VERTEX;
  Effect.ShadersStore[`${IMPACT_SHADER_KEY}FragmentShader`] = IMPACT_FRAGMENT;
  Effect.ShadersStore[`${SPRAY_SHADER_KEY}VertexShader`] = SPRAY_VERTEX;
  Effect.ShadersStore[`${SPRAY_SHADER_KEY}FragmentShader`] = SPRAY_FRAGMENT;
  Effect.ShadersStore[`${CROWN_SHADER_KEY}VertexShader`] = CROWN_VERTEX;
  Effect.ShadersStore[`${CROWN_SHADER_KEY}FragmentShader`] = CROWN_FRAGMENT;

  const mouthDark = new StandardMaterial("sanctuaryFallSocketDark", scene);
  mouthDark.diffuseColor = new Color3(0.007, 0.004, 0.010);
  mouthDark.specularColor = Color3.Black();
  const shaderMaterials: ShaderMaterial[] = [];
  const meshes: Mesh[] = [];
  const impactPatches: ReturnType<typeof createImpactPatch>[] = [];
  const impactCrowns: ReturnType<typeof createImpactCrown>[] = [];
  const sprayPools: ReturnType<typeof createSprayPool>[] = [];
  const mounts: TransformNode[] = [];
  const sources: SanctuaryFallSource[] = [];
  let enabled = options.enabled !== false;
  let disposed = false;
  let previousTime: number | undefined;

  const impactMaterial = new ShaderMaterial("sanctuaryFallImpact", scene, IMPACT_SHADER_KEY, {
    attributes: ["position"],
    uniforms: ["world", "worldViewProjection", "uTime", "uRadius", "uOpacity",
      "uDriftSpeed", "uPulseStrength", "uFogDensity", "uCameraPosition", "uFogColor", "uTint"],
    needAlphaBlending: true,
  });
  impactMaterial.backFaceCulling = false;
  impactMaterial.disableDepthWrite = true;
  impactMaterial.alphaMode = Engine.ALPHA_COMBINE;
  impactMaterial.setFloat("uTime", 0);
  impactMaterial.setFloat("uRadius", splashRadius);
  impactMaterial.setFloat("uOpacity", splashOpacity);
  impactMaterial.setFloat("uDriftSpeed", mistDriftSpeed);
  impactMaterial.setFloat("uPulseStrength", impactPulseStrength);
  impactMaterial.setFloat("uFogDensity", scene.fogDensity);
  impactMaterial.setVector3("uCameraPosition", Vector3.Zero());
  impactMaterial.setColor3("uFogColor", scene.fogColor);
  impactMaterial.setColor3("uTint", splashTint);

  const crownMaterial = new ShaderMaterial("sanctuaryFallCrown", scene, CROWN_SHADER_KEY, {
    attributes: ["position", "uv"],
    uniforms: ["world", "worldViewProjection", "uTime", "uOpacity", "uFogDensity",
      "uTint", "uCameraPosition", "uFogColor"],
    needAlphaBlending: true,
  });
  crownMaterial.backFaceCulling = false;
  crownMaterial.disableDepthWrite = true;
  crownMaterial.alphaMode = Engine.ALPHA_COMBINE;
  crownMaterial.setFloat("uTime", 0);
  crownMaterial.setFloat("uOpacity", splashOpacity);
  crownMaterial.setFloat("uFogDensity", scene.fogDensity);
  crownMaterial.setColor3("uTint", splashTint);
  crownMaterial.setVector3("uCameraPosition", Vector3.Zero());
  crownMaterial.setColor3("uFogColor", scene.fogColor);

  const sprayMaterial = new ShaderMaterial("sanctuaryFallSpray", scene, SPRAY_SHADER_KEY, {
    attributes: ["position", "uv", "color"],
    uniforms: ["world", "worldViewProjection", "uFogDensity", "uCameraPosition", "uFogColor"],
    needAlphaBlending: true,
  });
  sprayMaterial.backFaceCulling = false;
  sprayMaterial.disableDepthWrite = true;
  sprayMaterial.alphaMode = Engine.ALPHA_COMBINE;
  sprayMaterial.setFloat("uFogDensity", scene.fogDensity);
  sprayMaterial.setVector3("uCameraPosition", Vector3.Zero());
  sprayMaterial.setColor3("uFogColor", scene.fogColor);

  for (const id of ["left", "right"] as const) {
    const x = id === "left" ? -xOffset : xOffset;
    const mount = new TransformNode(`sanctuaryGargoyleMount_${id}`, scene);
    mount.position.set(x, topY, outletZ);
    mount.rotation.y = Math.PI; // Local forward points out toward the river (-Z).
    mounts.push(mount);

    // Replaceable stone block: one mount for a gargoyle, with a dark mouth.
    // Meshes are parented to the same mount, NOT baked into the waterfall.
    const socket = MeshBuilder.CreateBox(`sanctuaryGargoylePlaceholder_${id}`, {
      width: width + 10, height: 18, depth: 50,
    }, scene);
    socket.parent = mount;
    socket.position.set(0, 0, -16); // Mount faces -Z; wall penetrates its rear.
    socket.material = options.placeholderStone;
    socket.isPickable = false;
    const mouth = MeshBuilder.CreateBox(`sanctuaryGargoyleMouth_${id}`, {
      width: width * 0.74, height: 8, depth: 0.8,
    }, scene);
    mouth.parent = mount;
    mouth.position.set(0, 0, 9.6); // The dark opening at the river-facing tip.
    mouth.material = mouthDark;
    mouth.isPickable = false;

    const mesh = makeFallMesh(scene, id, {
      x, outletZ, impactZ, topY, riverY,
      width, chaos, quality,
      bendDrop, bendLip, meander, topNarrowing, bottomSpread,
    });
    meshes.push(mesh);
    const key = new ShaderMaterial(`sanctuaryFallFlow_${id}`, scene, FLOW_SHADER_KEY, {
      attributes: ["position", "normal", "uv"],
      uniforms: ["world", "worldViewProjection", "uTime", "uRipple", "uLipFlowSpeed", "uFallFlowSpeed",
        "uEdgeRaggedness", "uOpacity", "uTopY", "uFogDensity", "uCameraPosition",
        "uTint", "uFogColor"],
      needAlphaBlending: true,
    });
    key.backFaceCulling = true;
    key.disableDepthWrite = true;
    key.alphaMode = Engine.ALPHA_COMBINE;
    key.setFloat("uRipple", quality === "high" ? 0.32 : 0.16);
    const speedVariation = id === "left" ? 0.96 : 1.04;
    key.setFloat("uLipFlowSpeed", lipFlowSpeed * speedVariation);
    key.setFloat("uFallFlowSpeed", fallFlowSpeed * speedVariation);
    key.setFloat("uEdgeRaggedness", edge);
    key.setFloat("uOpacity", opacity);
    key.setFloat("uTopY", topY);
    key.setFloat("uFogDensity", scene.fogDensity);
    key.setColor3("uTint", tint);
    key.setColor3("uFogColor", scene.fogColor);
    key.setVector3("uCameraPosition", Vector3.Zero());
    key.setFloat("uTime", 0);
    mesh.material = key;
    shaderMaterials.push(key);

    const source: SanctuaryFallSource = {
      id,
      gargoyleMount: mount,
      mouthPosition: new Vector3(x, topY, outletZ - 13),
      impactPosition: new Vector3(x, riverY, impactZ),
      setPlaceholderVisible(visible: boolean) {
        socket.setEnabled(visible);
        mouth.setEnabled(visible);
      },
    };
    source.setPlaceholderVisible(options.showPlaceholders !== false);
    sources.push(source);
    impactPatches.push(createImpactPatch(scene, id, source.impactPosition,
      splashRadius, riverY, quality, sampleWaterHeight, visualOffset, impactMaterial));
    impactCrowns.push(createImpactCrown(scene, id, source.impactPosition,
      splashRadius, splashHeight, visualOffset, quality, crownMaterial));
    sprayPools.push(createSprayPool(scene, id, source.impactPosition,
      quality, splashRadius, splashHeight, sprayParticleRate, splashOpacity,
      sprayParticleSize, splashLifetime, visualOffset, splashTint, sprayMaterial));
  }

  const handle: SanctuaryPortalWaterfallsHandle = {
    sources,
    update(elapsedSeconds, cameraWorldPosition) {
      if (disposed || !enabled) return;
      const dt = previousTime === undefined ? 0 : Math.max(0, Math.min(0.1, elapsedSeconds - previousTime));
      previousTime = elapsedSeconds;
      for (const mat of shaderMaterials) {
        mat.setFloat("uTime", elapsedSeconds);
        mat.setVector3("uCameraPosition", cameraWorldPosition);
      }
      impactMaterial.setFloat("uTime", elapsedSeconds);
      impactMaterial.setVector3("uCameraPosition", cameraWorldPosition);
      crownMaterial.setFloat("uTime", elapsedSeconds);
      crownMaterial.setVector3("uCameraPosition", cameraWorldPosition);
      sprayMaterial.setVector3("uCameraPosition", cameraWorldPosition);
      for (let i = 0; i < impactPatches.length; i++) {
        impactPatches[i].update(elapsedSeconds);
        impactCrowns[i].update();
        sprayPools[i].update(dt, cameraWorldPosition);
      }
    },
    setEnabled(value) {
      if (disposed) return;
      enabled = value;
      for (const mesh of meshes) mesh.setEnabled(value);
      for (const patch of impactPatches) patch.mesh.setEnabled(value);
      for (const crown of impactCrowns) crown.mesh.setEnabled(value);
      for (const spray of sprayPools) spray.mesh.setEnabled(value);
      for (const mount of mounts) mount.setEnabled(value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) if (!mesh.isDisposed()) mesh.dispose();
      for (const patch of impactPatches) if (!patch.mesh.isDisposed()) patch.mesh.dispose();
      for (const crown of impactCrowns) if (!crown.mesh.isDisposed()) crown.mesh.dispose();
      for (const spray of sprayPools) if (!spray.mesh.isDisposed()) spray.mesh.dispose();
      for (const mount of mounts) if (!mount.isDisposed()) mount.dispose(false, false);
      for (const mat of shaderMaterials) mat.dispose();
      impactMaterial.dispose();
      crownMaterial.dispose();
      sprayMaterial.dispose();
      mouthDark.dispose();
    },
  };
  handle.setEnabled(enabled);
  scene.onDisposeObservable.addOnce(() => handle.dispose());
  return handle;
}
