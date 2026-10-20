import {
  Color3, Constants, Mesh, MeshBuilder, Scene, ShaderMaterial, Texture,
  TransformNode, Vector2, Vector3, Vector4,
} from "@babylonjs/core";
import { asset } from "../../../utils/asset";
import { FOREST_PORTAL_PANEL } from "./SanctuaryForestPortal";
import { createSanctuaryRinaPortal } from "./SanctuaryRinaPortal";

const V2_SHEET = "assets/textures/sanctuary/rina_portal_v2/rina_portal_v2_asset_sheet.png";
const V1_ATLAS = "assets/textures/sanctuary/rina_portal/rina_concert_atlas.webp";
const KATY_MATTE = "assets/textures/sanctuary/rina_portal_v2/katy_matte.png";
const SHEET_SIZE = { width: 1448, height: 1086 } as const;
const V1_SIZE = { width: 2048, height: 2048 } as const;
const MATTE_SIZE = { width: 540, height: 1148 } as const;
const CYCLE = 12;
const BEAT = 1.42;
// The parent is scaled 18x: a small local offset becomes a visible gap in world
// space. Keep every transparent layer on one depth and sort them by alphaIndex.
const MIRROR_BASE_Z = -0.01;
const MIRROR_LAYER_Z = -0.009;
const RINA_CONTENT_SHIFT_X = -0.02;

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform mat4 uRootInverse;
varying vec2 vUnitUV;
varying vec2 vRootXY;
void main(void) {
  vUnitUV = uv;
  vRootXY = (uRootInverse * world * vec4(position, 1.0)).xy;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const BACKDROP_FRAGMENT = `
precision highp float;
varying vec2 vUnitUV;
varying vec2 vRootXY;
uniform sampler2D uAtlas;
uniform vec4 uRect;
uniform float uTime;
uniform float uHush;
uniform float uContentShift;
void main(void) {
  vec2 uv = mix(uRect.xy, uRect.zw,
    clamp(vUnitUV - vec2(uContentShift, 0.0), vec2(0.001), vec2(0.999)));
  vec4 stage = texture2D(uAtlas, uv);
  vec3 color = mix(vec3(0.009, 0.003, 0.019), stage.rgb, stage.a);
  float beat = pow(0.5 + 0.5 * sin(6.2831853 * uTime / 1.42), 4.0);
  color += vec3(0.015, 0.002, 0.019) * beat;
  color *= 1.0 - uHush * 0.42;
  float cornerBlend = smoothstep(0.155, 0.22, -vRootXY.x)
    * smoothstep(0.745, 0.82, vRootXY.y);
  color = mix(color, vec3(0.16, 0.10, 0.18), cornerBlend * 0.85);
  gl_FragColor = vec4(color, 1.0);
}
`;

const LAYER_FRAGMENT = `
precision highp float;
varying vec2 vUnitUV;
varying vec2 vRootXY;
uniform sampler2D uAtlas;
uniform vec4 uRect;
uniform vec2 uFeather;
uniform vec3 uGlowTint;
uniform float uOpacity;
uniform float uGlow;
uniform float uMatte;
uniform float uCleanKaty;
uniform float uRinaHand;
uniform float uFootMist;
uniform float uKatyCutout;
uniform float uKatyDissolve;
uniform float uEnergyMask;
float katyHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float katyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(katyHash(i), katyHash(i + vec2(1.0, 0.0)), f.x),
    mix(katyHash(i + vec2(0.0, 1.0)),
      katyHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main(void) {
  float edge = min(min(vRootXY.x + 0.22, 0.27 - vRootXY.x),
                   min(vRootXY.y + 0.02, 0.82 - vRootXY.y));
  float clipping = smoothstep(-0.002, 0.003, edge);
  if (clipping < 0.003) discard;
  float cornerBlend = smoothstep(0.155, 0.22, -vRootXY.x)
    * smoothstep(0.745, 0.82, vRootXY.y);
  vec2 atlasUV = mix(uRect.xy, uRect.zw,
    clamp(vUnitUV, vec2(0.001), vec2(0.999)));
  vec4 sprite = texture2D(uAtlas, atlasUV);
  // The supplied cutout runs into the next atlas tile. Recover the fingertips
  // from its transparent margin while rejecting the neighboring stage tile.
  float sourceX = vUnitUV.x * 390.0;
  float sourceY = (1.0 - vUnitUV.y) * 640.0;
  float originalCutout = 1.0 - smoothstep(353.0, 355.0, sourceX);
  float handExtension = smoothstep(233.0, 243.0, sourceY)
    * (1.0 - smoothstep(277.0, 290.0, sourceY))
    * (1.0 - smoothstep(378.0, 390.0, sourceX));
  // Katy's phone intrudes into the bottom of Rina's tile. The boots occupy
  // the sides, so remove only the small center overlap.
  float intrudingPhone = smoothstep(204.0, 214.0, sourceX)
    * (1.0 - smoothstep(264.0, 275.0, sourceX))
    * smoothstep(590.0, 600.0, sourceY);
  sprite.a *= mix(1.0,
    max(originalCutout, handExtension) * (1.0 - intrudingPhone), uRinaHand);
  // Katy's tile touches Rina's boot at the top right of the supplied sheet.
  // Keep Katy's complete phone (near x=230) and reject the unrelated boot.
  float katyX = vUnitUV.x * 324.0;
  float katyY = 600.0 + (1.0 - vUnitUV.y) * 486.0;
  float foreignBoot = smoothstep(272.0, 284.0, katyX)
    * (1.0 - smoothstep(637.0, 650.0, katyY));
  sprite.a *= 1.0 - uKatyCutout * foreignBoot;
  float leftFade = uFeather.x > 0.0
    ? smoothstep(0.0, uFeather.x, vUnitUV.x) : 1.0;
  float rightFade = uFeather.y > 0.0
    ? 1.0 - smoothstep(1.0 - uFeather.y, 1.0, vUnitUV.x) : 1.0;
  float katyBreakup = katyNoise(vUnitUV * vec2(9.0, 13.0)) * 0.65
    + katyNoise(vUnitUV * vec2(23.0, 29.0) + 3.1) * 0.35;
  float crowdMask = smoothstep(0.27, 0.64,
    vUnitUV.y + (katyBreakup - 0.5) * 0.28);
  float sourceAlpha = mix(sprite.a, sprite.a * crowdMask, uCleanKaty);
  float alpha = mix(sourceAlpha, sprite.r, uMatte) *
    uOpacity * leftFade * rightFade * clipping;
  float breakupThreshold = 0.14 + 0.50 * vUnitUV.y
    + 0.22 * katyBreakup;
  float katyKeep = 1.0 - smoothstep(breakupThreshold - 0.13,
    breakupThreshold + 0.13, uKatyDissolve);
  alpha *= mix(1.0, katyKeep, uKatyCutout);
  float energyWarp = (katyNoise(vUnitUV * vec2(11.0, 17.0) + 7.3) - 0.5) * 0.055;
  vec2 energyUV = vUnitUV + vec2(energyWarp, -energyWarp * 0.6);
  float energyFade = smoothstep(0.0, 0.24, energyUV.x)
    * (1.0 - smoothstep(0.76, 1.0, energyUV.x))
    * smoothstep(0.0, 0.22, energyUV.y)
    * (1.0 - smoothstep(0.84, 1.0, energyUV.y));
  float energyGuard = min(min(vUnitUV.x, 1.0 - vUnitUV.x),
    min(vUnitUV.y, 1.0 - vUnitUV.y));
  alpha *= mix(1.0, energyFade * smoothstep(0.0, 0.025, energyGuard),
    uEnergyMask) * (1.0 - cornerBlend * 0.92);
  // The source smoke tile has a hard dark patch in its center. Build only the
  // small illuminated wisps here so the atlas patch cannot float by her feet.
  vec2 mistP = vUnitUV * 2.0 - 1.0;
  vec2 mistLeft = mistP + vec2(0.42, 0.08);
  vec2 mistRight = mistP - vec2(0.42, -0.06);
  float mist = 0.50 * exp(-8.0 * mistLeft.x * mistLeft.x
    - 10.0 * mistLeft.y * mistLeft.y);
  mist += 0.65 * exp(-6.0 * mistP.x * mistP.x
    - 13.0 * (mistP.y - 0.12) * (mistP.y - 0.12));
  mist += 0.50 * exp(-8.0 * mistRight.x * mistRight.x
    - 10.0 * mistRight.y * mistRight.y);
  float wisps = 0.82 + 0.18 * sin(vUnitUV.x * 28.0
    + sin(vUnitUV.y * 12.0) * 2.0) * sin(vUnitUV.y * 17.0);
  alpha = mix(alpha, min(mist * wisps * 0.70, 0.72) *
    uOpacity * clipping, uFootMist);
  if (alpha < 0.003) discard;
  vec3 color = mix(sprite.rgb + uGlowTint * uGlow * sprite.a * 0.18,
    vec3(0.065, 0.018, 0.09) + uGlowTint * 0.065, uMatte);
  color = mix(color, vec3(0.78, 0.52, 1.0), uFootMist);
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
}
`;

type AtlasKey = "v2" | "v1" | "matte";
type PixelRect = readonly [number, number, number, number];
interface LayerSpec {
  id: string;
  atlas: AtlasKey;
  rect: PixelRect;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  feather?: readonly [number, number];
  additive?: boolean;
}
interface Layer { spec: LayerSpec; mesh: Mesh; material: ShaderMaterial }

// Pixel rectangles are on the supplied v2 sheet. The stage is split into
// separate planes; the old atlas supplies only the camera flash effect.
const LAYERS: readonly LayerSpec[] = [
  { id: "stage_left", atlas: "v2", rect: [355, 15, 220, 585],
    x: -0.175, y: 0.535, width: 0.20, height: 0.53, z: MIRROR_LAYER_Z,
    feather: [0, 0.33] },
  { id: "stage_right", atlas: "v2", rect: [990, 15, 220, 585],
    x: 0.225, y: 0.535, width: 0.20, height: 0.53, z: MIRROR_LAYER_Z,
    feather: [0.33, 0] },
  { id: "stage_aura", atlas: "v2", rect: [324, 606, 346, 370],
    x: 0.025, y: 0.57, width: 0.32, height: 0.32, z: MIRROR_LAYER_Z,
    additive: true },
  { id: "beam_pink", atlas: "v2", rect: [1240, 0, 204, 254],
    x: -0.135, y: 0.615, width: 0.17, height: 0.35, z: MIRROR_LAYER_Z,
    additive: true },
  { id: "beam_blue", atlas: "v2", rect: [1240, 218, 204, 243],
    x: 0.165, y: 0.605, width: 0.17, height: 0.35, z: MIRROR_LAYER_Z,
    additive: true },
  { id: "rina_cutout", atlas: "v2", rect: [0, 0, 390, 640],
    x: -0.0085, y: 0.393, width: 0.134, height: 0.22, z: MIRROR_LAYER_Z },
  { id: "rina_foot_mist", atlas: "v2", rect: [1040, 795, 408, 291],
    x: -0.0085, y: 0.283, width: 0.09, height: 0.033, z: MIRROR_LAYER_Z,
    additive: true },
  { id: "energy_pink", atlas: "v2", rect: [665, 615, 220, 471],
    x: -0.035, y: 0.29, width: 0.17, height: 0.45, z: MIRROR_LAYER_Z,
    additive: true },
  { id: "energy_blue", atlas: "v2", rect: [875, 615, 220, 471],
    x: 0.065, y: 0.29, width: 0.17, height: 0.45, z: MIRROR_LAYER_Z,
    additive: true },
  { id: "katy_silhouette", atlas: "matte", rect: [0, 0, 335, 1148],
    x: -0.11, y: 0.19, width: 0.25, height: 0.42, z: MIRROR_LAYER_Z,
    feather: [0.06, 0.22] },
  { id: "katy_visible", atlas: "v2", rect: [0, 600, 324, 486],
    x: -0.11, y: 0.19, width: 0.25, height: 0.42, z: MIRROR_LAYER_Z,
    feather: [0.06, 0.22] },
  { id: "katy_dissolve", atlas: "v2", rect: [0, 600, 324, 486],
    x: -0.11, y: 0.19, width: 0.25, height: 0.42, z: MIRROR_LAYER_Z,
    feather: [0.06, 0.22],
    additive: true },
  { id: "mist_left", atlas: "v2", rect: [1085, 625, 359, 285],
    x: -0.135, y: 0.13, width: 0.29, height: 0.20, z: MIRROR_LAYER_Z },
  { id: "mist_right", atlas: "v2", rect: [1040, 795, 408, 291],
    x: 0.16, y: 0.10, width: 0.30, height: 0.21, z: MIRROR_LAYER_Z },
  { id: "phone_flash", atlas: "v1", rect: [8, 873, 256, 256],
    x: -0.025, y: 0.345, width: 0.115, height: 0.115, z: MIRROR_LAYER_Z,
    additive: true },
];

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
const smoothstep = (a: number, b: number, value: number) => {
  const x = clamp((value - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
const query = () => typeof window === "undefined"
  ? new URLSearchParams() : new URLSearchParams(window.location.search);
function numberParam(params: URLSearchParams, name: string, fallback: number, max: number) {
  const raw = params.get(name);
  if (raw === null || !raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? clamp(value, 0, max) : fallback;
}
function atlasRect(rect: PixelRect, atlas: AtlasKey) {
  const size = atlas === "v2" ? SHEET_SIZE
    : atlas === "v1" ? V1_SIZE : MATTE_SIZE;
  const [x, y, width, height] = rect;
  return new Vector4(x / size.width, 1 - (y + height) / size.height,
    (x + width) / size.width, 1 - y / size.height);
}
function loadTexture(scene: Scene, path: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    let texture: Texture | null = null;
    let ready = false;
    let earlyError: string | null = null;
    const onLoad = () => { if (texture) resolve(texture); else ready = true; };
    const onError = (message?: string) => {
      const reason = message ?? `No se pudo cargar ${path}`;
      if (texture) { texture.dispose(); reject(new Error(reason)); }
      else earlyError = reason;
    };
    texture = new Texture(asset(path), scene, false, true,
      Texture.TRILINEAR_SAMPLINGMODE, onLoad, onError);
    texture.hasAlpha = true;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    if (earlyError) { texture.dispose(); reject(new Error(earlyError)); }
    else if (ready) resolve(texture);
  });
}

export function createSanctuaryRinaPortalV2(
  scene: Scene, root: TransformNode, vortex: Mesh, fallbackMaterial: ShaderMaterial,
): { dispose(): void } {
  const params = query();
  if (params.get("sanctuaryRinaPortal") === "off") return { dispose() {} };
  if (params.get("sanctuaryRinaVersion") === "1") {
    return createSanctuaryRinaPortal(scene, root, vortex, fallbackMaterial);
  }

  const speed = numberParam(params, "sanctuaryRinaSpeed", 1, 3);
  const neon = numberParam(params, "sanctuaryRinaNeon", 1, 2.2);
  const parallax = numberParam(params, "sanctuaryRinaParallax", 1, 3);
  const lights = numberParam(params, "sanctuaryRinaLights", 1, 2);
  const quality = params.get("sanctuaryRinaQuality") === "low" ? 0.4 : 1;
  const frozen = params.has("sanctuaryRinaFreeze")
    ? numberParam(params, "sanctuaryRinaFreeze", 0, CYCLE) : null;
  const inverseRoot = root.computeWorldMatrix(true).clone().invert();
  const localCamera = Vector3.Zero();
  const originalVortexVisible = vortex.isVisible;
  const textures: Texture[] = [];
  const materials: ShaderMaterial[] = [];
  const meshes: Mesh[] = [];
  const layers: Layer[] = [];
  let backdrop: Mesh | null = null;
  let backdropMaterial: ShaderMaterial | null = null;
  let active = false;
  let disposed = false;
  let elapsed = 0;

  const observer = scene.onBeforeRenderObservable.add(() => {
    if (disposed || !backdrop || !backdropMaterial) return;
    if (!active) {
      if (!backdropMaterial.isReady(backdrop) ||
        layers.some(({ mesh, material }) => !material.isReady(mesh))) return;
      for (const mesh of meshes) mesh.isVisible = true;
      vortex.isVisible = false;
      active = true;
    }
    elapsed += Math.min(0.08, scene.getEngine().getDeltaTime() / 1000) * speed;
    const time = frozen ?? elapsed;
    const phase = time % CYCLE;
    const beat = 0.65 + 0.35 * Math.pow(0.5 + 0.5 * Math.sin(
      2 * Math.PI * time / BEAT), 4);
    const flash = Math.exp(-Math.pow((phase - 2.94) / 0.13, 2));
    const dissolve = smoothstep(3.1, 7.55, phase);
    const restore = smoothstep(9.65, 12, phase);
    const katyDissolve = phase < 9.65 ? dissolve : 1 - restore;
    const katyVisible = clamp(1 - dissolve + restore, 0, 1);
    const katyClean = 1 - smoothstep(2.86, 3.65, phase);
    const breaking = smoothstep(3.1, 4.1, phase) *
      (1 - smoothstep(6.8, 8.0, phase));
    const transfer = smoothstep(3.06, 4.02, phase) *
      (1 - smoothstep(7.25, 8.65, phase));
    const hush = smoothstep(7.55, 8.4, phase) *
      (1 - smoothstep(9.55, 10.3, phase));
    const camera = scene.activeCamera;
    if (camera) Vector3.TransformCoordinatesToRef(
      camera.globalPosition, inverseRoot, localCamera);
    const sideways = camera ? clamp(localCamera.x / 0.24, -1, 1) * parallax : 0;

    backdropMaterial.setFloat("uTime", time);
    backdropMaterial.setFloat("uHush", hush);
    for (const layer of layers) {
      const { id } = layer.spec;
      let opacity = 1;
      let glow = 0;
      let shift = 0;
      let vertical = 0;
      if (id === "stage_left") {
        opacity = 0.92;
        shift = -sideways * 0.002 + Math.sin(time * 0.31) * 0.0005;
      } else if (id === "stage_right") {
        opacity = 0.92;
        shift = -sideways * 0.003 - Math.sin(time * 0.27) * 0.0006;
      } else if (id === "stage_aura") {
        opacity = neon * (0.16 * beat + 0.18 * transfer);
        glow = neon * 0.15;
      } else if (id === "beam_pink" || id === "beam_blue") {
        const offset = id === "beam_pink" ? 0 : 1.8;
        opacity = lights * neon * (0.12 + 0.11 * beat +
          0.04 * Math.sin(time * 2.7 + offset));
        shift = Math.sin(time * 0.62 + offset) * 0.006 - sideways * 0.001;
        glow = neon * 0.25;
      } else if (id === "rina_cutout") {
        opacity = 0.98;
        shift = -sideways * 0.0005 + Math.sin(time * 0.53) * 0.0008;
        vertical = Math.sin(time * 0.48) * 0.0018;
        glow = neon * (0.28 * beat + 0.35 * transfer);
      } else if (id === "rina_foot_mist") {
        opacity = quality * neon * (0.5 + 0.06 * beat);
        shift = Math.sin(time * 0.28) * 0.002;
        vertical = Math.sin(time * 0.36) * 0.001;
        glow = neon * 0.2;
      } else if (id === "energy_pink" || id === "energy_blue") {
        const offset = id === "energy_pink" ? 0 : 2.1;
        opacity = neon * transfer * (0.18 + 0.1 * Math.sin(time * 3.2 + offset));
        shift = Math.sin(time * 0.95 + offset) * 0.008 - sideways * 0.002;
        vertical = transfer * 0.035;
        glow = neon * 0.2;
      } else if (id === "katy_silhouette") {
        opacity = katyVisible * katyClean * 0.88;
        shift = -sideways * 0.003;
      } else if (id === "katy_visible") {
        opacity = 1;
        shift = -sideways * 0.003;
      } else if (id === "katy_dissolve") {
        opacity = breaking * neon * 0.62;
        shift = -sideways * 0.0025;
        vertical = breaking * 0.015;
      } else if (id === "mist_left" || id === "mist_right") {
        const offset = id === "mist_left" ? 0 : 1.9;
        opacity = quality * (0.07 + 0.08 * transfer) * (1 - hush * 0.4);
        shift = Math.sin(time * 0.22 + offset) * 0.005 - sideways * 0.0025;
      } else if (id === "phone_flash") {
        opacity = flash * 0.75 * neon;
        shift = -sideways * 0.003;
        glow = neon * 0.35;
      }
      layer.mesh.position.x = layer.spec.x + RINA_CONTENT_SHIFT_X + shift;
      layer.mesh.position.y = layer.spec.y + vertical;
      layer.material.setFloat("uOpacity", clamp(opacity, 0, 1));
      layer.material.setFloat("uGlow", glow);
      layer.material.setFloat("uCleanKaty",
        id === "katy_visible" || id === "katy_dissolve" ? 1 : 0);
      layer.material.setFloat("uKatyDissolve", katyDissolve);
    }
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    scene.onBeforeRenderObservable.remove(observer);
    if (!scene.isDisposed && !vortex.isDisposed()) {
      vortex.material = fallbackMaterial;
      vortex.isVisible = originalVortexVisible;
    }
    for (const mesh of meshes) mesh.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    meshes.length = materials.length = textures.length = layers.length = 0;
  };
  scene.onDisposeObservable.addOnce(dispose);

  void (async () => {
    try {
      for (const filename of [V2_SHEET, V1_ATLAS, KATY_MATTE]) {
        const texture = await loadTexture(scene, filename);
        if (disposed || scene.isDisposed) { texture.dispose(); return; }
        textures.push(texture);
      }
      const panel = FOREST_PORTAL_PANEL;
      const width = panel.right - panel.left;
      const height = panel.top - panel.bottom;
      const centerX = (panel.left + panel.right) * 0.5;
      const centerY = (panel.bottom + panel.top) * 0.5;
      const background = MeshBuilder.CreatePlane("rina_concertPanel",
        { width, height }, scene);
      background.parent = root;
      background.position.set(centerX, centerY, MIRROR_BASE_Z);
      background.isPickable = false;
      background.checkCollisions = false;
      background.receiveShadows = false;
      background.renderingGroupId = vortex.renderingGroupId;
      background.isVisible = false;
      meshes.push(background);
      const base = new ShaderMaterial("sanctuaryRinaV2Backdrop", scene,
        { vertexSource: VERTEX, fragmentSource: BACKDROP_FRAGMENT },
        { attributes: ["position", "uv"],
          uniforms: ["world", "worldViewProjection", "uRootInverse", "uRect",
            "uTime", "uHush", "uContentShift"], samplers: ["uAtlas"] });
      base.backFaceCulling = false;
      base.fogEnabled = false;
      base.setMatrix("uRootInverse", inverseRoot);
      base.setTexture("uAtlas", textures[0]);
      base.setVector4("uRect", atlasRect([620, 80, 315, 522], "v2"));
      base.setFloat("uTime", 0);
      base.setFloat("uHush", 0);
      base.setFloat("uContentShift", RINA_CONTENT_SHIFT_X / width);
      background.material = base;
      materials.push(base);
      backdrop = background;
      backdropMaterial = base;

      for (const [index, spec] of LAYERS.entries()) {
        const mesh = MeshBuilder.CreatePlane(`rina_v2_${spec.id}`,
          { width: spec.width, height: spec.height }, scene);
        mesh.parent = root;
        mesh.position.set(spec.x + RINA_CONTENT_SHIFT_X, spec.y, spec.z);
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.receiveShadows = false;
        mesh.renderingGroupId = vortex.renderingGroupId;
        mesh.alphaIndex = 100 + index;
        mesh.isVisible = false;
        meshes.push(mesh);
        const material = new ShaderMaterial(`rinaV2_${spec.id}Material`, scene,
          { vertexSource: VERTEX, fragmentSource: LAYER_FRAGMENT },
          { attributes: ["position", "uv"],
            uniforms: ["world", "worldViewProjection", "uRootInverse", "uRect",
              "uFeather", "uGlowTint", "uOpacity", "uGlow",
              "uMatte", "uCleanKaty", "uRinaHand", "uFootMist", "uKatyCutout",
              "uKatyDissolve", "uEnergyMask"],
            samplers: ["uAtlas"], needAlphaBlending: true });
        material.backFaceCulling = false;
        material.fogEnabled = false;
        material.disableDepthWrite = true;
        material.alphaMode = spec.additive ? Constants.ALPHA_ADD : Constants.ALPHA_COMBINE;
        material.setMatrix("uRootInverse", inverseRoot);
        material.setTexture("uAtlas", textures[spec.atlas === "v2" ? 0
          : spec.atlas === "v1" ? 1 : 2]);
        material.setVector4("uRect", atlasRect(spec.rect, spec.atlas));
        material.setVector2("uFeather", new Vector2(...(spec.feather ?? [0, 0])));
        material.setColor3("uGlowTint", new Color3(0.42, 0.06, 0.58));
        material.setFloat("uOpacity", 0);
        material.setFloat("uGlow", 0);
        material.setFloat("uMatte", spec.atlas === "matte" ? 1 : 0);
        material.setFloat("uCleanKaty", 0);
        material.setFloat("uRinaHand", spec.id === "rina_cutout" ? 1 : 0);
        material.setFloat("uFootMist", spec.id === "rina_foot_mist" ? 1 : 0);
        material.setFloat("uKatyCutout",
          spec.id === "katy_visible" || spec.id === "katy_dissolve" ? 1 : 0);
        material.setFloat("uKatyDissolve", 0);
        material.setFloat("uEnergyMask",
          spec.id === "energy_pink" || spec.id === "energy_blue" ? 1 : 0);
        mesh.material = material;
        materials.push(material);
        layers.push({ spec, mesh, material });
      }
      if (disposed || scene.isDisposed) dispose();
    } catch (error) {
      if (disposed || scene.isDisposed) return;
      console.warn("[RinaPortalV2] Se conserva el vórtice rojo:", error);
      dispose();
    }
  })();
  return { dispose };
}
