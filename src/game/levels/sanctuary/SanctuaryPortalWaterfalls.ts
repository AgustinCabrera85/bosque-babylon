import { Engine } from "@babylonjs/core/Engines/engine";
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
 * No mist, spray, splash, audio, water RTT additions or global postprocess.
 * Inspiration: flowing distorted waterfall meshes (#3RXC7T#2); original code.
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
  /** Visual flow speed, not physical simulation speed. */
  flowSpeed?: number;
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
  enabled?: boolean;
}

export interface SanctuaryFallSource {
  id: SanctuaryFallSide;
  /** Local origin / socket. Attach gargoyle GLBs here in the future. */
  gargoyleMount: TransformNode;
  /** World-space location where the falling liquid visibly exits the socket. */
  mouthPosition: Vector3;
  /** World-space impact position reserved for later splash / ripple integration. */
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

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float uTime;
uniform float uRipple;
varying vec2 vUV;
varying vec3 vWorld;
varying vec3 vNormal;
void main(void) {
  vec3 p = position;
  // A little surface motion in 3D; the base mesh already contains the full bend.
  float body = smoothstep(0.015, 0.12, uv.y) * (1.0 - smoothstep(0.97, 1.0, uv.y));
  float angle = uv.x * 6.2831853;
  float waveA = sin(uv.y * 84.0 - uTime * 1.75 + 2.7 * sin(angle));
  float waveB = sin(uv.y * 141.0 - uTime * 2.24 - 3.1 * cos(angle * 2.0));
  p.x += (waveA * 0.72 + waveB * 0.28) * body * uRipple;
  p.z += (waveB * 0.70 + waveA * 0.30) * body * uRipple * 0.6;
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
uniform float uFlowSpeed;
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
  float flow = vUV.y * 76.0 - uTime * uFlowSpeed;
  float angle = vUV.x * 6.2831853;
  vec2 circumference = vec2(cos(angle), sin(angle));
  vec2 p = vec2(circumference.x * 7.5 + flow * 0.03,
    circumference.y * 7.5 + flow * 0.22);
  float low = noise2(p * vec2(0.38, 0.47));
  float high = noise2(p * vec2(1.15, 1.70) + 4.3);
  float streak = pow(0.5 + 0.5 * sin(angle * 16.0 + low * 4.0 + flow * 0.46), 5.0);
  float bands = 0.5 + 0.5 * sin(angle * 6.0 + flow * 0.85 + high * 2.5);
  float variation = clamp(low * 0.62 + high * 0.24 + bands * 0.14, 0.0, 1.0);

  vec3 dark = uTint * 0.30;
  vec3 mid = uTint * (0.75 + variation * 0.48);
  vec3 col = mix(dark, mid, 0.34 + variation * 0.56);
  vec3 viewDir = normalize(uCameraPosition - vWorld);
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.0);
  col += uTint * (0.13 * fresnel + 0.16 * streak);

  // Smooth, ragged silhouette. The volume stays genuinely 3D.
  float side = abs(cos(vUV.x * 6.2831853));
  float jagged = (high - 0.5) * uEdgeRaggedness * 0.21;
  float edge = 1.0 - smoothstep(0.77 + jagged, 1.0 + jagged, side);
  float entry = smoothstep(0.005, 0.060, vUV.y);
  float end = 1.0 - smoothstep(0.972, 1.0, vUV.y);
  float hazeAtTop = 1.0 - 0.32 * smoothstep(uTopY - 150.0, uTopY + 10.0, vWorld.y);
  float dist = length(uCameraPosition - vWorld);
  float fog = clamp(1.0 - exp(-dist * uFogDensity * 0.6), 0.0, 0.58);
  col = mix(col, uFogColor, fog);
  float alpha = uOpacity * edge * entry * end * hazeAtTop;
  alpha *= (0.75 + 0.25 * variation) * (1.0 - 0.42 * fog);
  if (alpha < 0.015) discard;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
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

const FLOW_SHADER_KEY = "sanctuaryPortalFalls3dV1";

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
  const tint = options.color ?? new Color3(0.42, 0.068, 0.079);

  Effect.ShadersStore[`${FLOW_SHADER_KEY}VertexShader`] = VERTEX;
  Effect.ShadersStore[`${FLOW_SHADER_KEY}FragmentShader`] = FRAGMENT;

  const mouthDark = new StandardMaterial("sanctuaryFallSocketDark", scene);
  mouthDark.diffuseColor = new Color3(0.007, 0.004, 0.010);
  mouthDark.specularColor = Color3.Black();
  const shaderMaterials: ShaderMaterial[] = [];
  const meshes: Mesh[] = [];
  const mounts: TransformNode[] = [];
  const sources: SanctuaryFallSource[] = [];
  let enabled = options.enabled !== false;
  let disposed = false;

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
      uniforms: ["world", "worldViewProjection", "uTime", "uRipple", "uFlowSpeed",
        "uEdgeRaggedness", "uOpacity", "uTopY", "uFogDensity", "uCameraPosition",
        "uTint", "uFogColor"],
      needAlphaBlending: true,
    });
    key.backFaceCulling = true;
    key.disableDepthWrite = true;
    key.alphaMode = Engine.ALPHA_COMBINE;
    key.setFloat("uRipple", quality === "high" ? 0.32 : 0.16);
    key.setFloat("uFlowSpeed", (options.flowSpeed ?? 3.4) * (id === "left" ? 0.96 : 1.04));
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
  }

  const handle: SanctuaryPortalWaterfallsHandle = {
    sources,
    update(elapsedSeconds, cameraWorldPosition) {
      if (disposed || !enabled) return;
      for (const mat of shaderMaterials) {
        mat.setFloat("uTime", elapsedSeconds);
        mat.setVector3("uCameraPosition", cameraWorldPosition);
      }
    },
    setEnabled(value) {
      if (disposed) return;
      enabled = value;
      for (const mesh of meshes) mesh.setEnabled(value);
      for (const mount of mounts) mount.setEnabled(value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) if (!mesh.isDisposed()) mesh.dispose();
      for (const mount of mounts) if (!mount.isDisposed()) mount.dispose(false, false);
      for (const mat of shaderMaterials) mat.dispose();
      mouthDark.dispose();
    },
  };
  handle.setEnabled(enabled);
  scene.onDisposeObservable.addOnce(() => handle.dispose());
  return handle;
}
