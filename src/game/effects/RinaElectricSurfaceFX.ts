/**
 * Rina Electric Surface FX — production-oriented port of the approved GPU Wrap Lab v6.2.
 *
 * The effect is drawn on clones of the ACTUAL GLB meshes. Clones keep Babylon's
 * native skeleton and morph-target deformation. No bone ribbons or CPU skinning.
 *
 * The shader takes its procedural coordinates from mesh-local/rest attributes,
 * BEFORE GPU skinning. They are then interpolated over the skinned surface.
 * Thus the electric pattern stays on the character as it moves.
 *
 * Scope: visual only. Does not change health, collision, AI, rig or animation.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Engine } from "@babylonjs/core/Engines/engine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { CustomMaterial } from "@babylonjs/materials/custom/customMaterial";
import { asset } from "../../utils/asset";

const DEFAULT_ATLAS = "assets/textures/rina/electric/rina-electric-gpu-atlas-4x4.png";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type ElectricSurfaceParameters = {
  colorHex: string;
  emission: number;
  density: number;
  thickness: number;
  halo: number;
  propagationRadius: number;
  propagationFront: number;
  verticalBias: number;
  wrapBias: number;
  diagonalBias: number;
  twistStrength: number;
  noiseWarpStrength: number;
  secondaryBlend: number;
  tertiaryBlend: number;
  microDensity: number;
  microScale: number;
  microBlend: number;
  lightIntensity: number;
  lightRange: number;
  /** Only a reference for a scene-owned pipeline; never changes scene bloom globally. */
  suggestedBloom: number;
};

/** Approved October 24, 2026. Matches the captured v6.2 laboratory controls. */
export const RINA_ELECTRIC_THIN_CHAOTIC: Readonly<ElectricSurfaceParameters> = Object.freeze({
  colorHex: "#DB0075", // RGB (219, 0, 117)
  emission: 0.2,
  density: 4.1,
  thickness: 0.06,
  halo: 0.10,
  propagationRadius: 5.5,
  propagationFront: 0.30,
  verticalBias: 0.18,
  wrapBias: 0.86,
  diagonalBias: 1.18,
  twistStrength: 1.15,
  noiseWarpStrength: 0.42,
  secondaryBlend: 0.74,
  tertiaryBlend: 0.20,
  microDensity: 1.95,
  microScale: 2.65,
  microBlend: 0.66,
  lightIntensity: 1.5,
  lightRange: 6.0,
  suggestedBloom: 0.10,
});

export interface RinaElectricSurfaceFXOptions {
  /** Only one owned light should be active in a given level at once. Default: true. */
  createPointLight?: boolean;
  /** Override the atlas public URL if assets are hosted elsewhere. */
  atlasUrl?: string;
  /** Reject transparent or facial meshes as needed without modifying them. */
  includeMesh?: (mesh: Mesh) => boolean;
  parameters?: Partial<ElectricSurfaceParameters>;
}

export interface RinaElectricHitOptions {
  impact?: Vector3;
  growthSeconds?: number;
  holdSeconds?: number;
  fadeSeconds?: number;
}

type Overlay = {
  original: Mesh;
  mesh: Mesh;
  material: CustomMaterial;
  scale: number;
};

type Mode = "off" | "continuous" | "hit" | "fade";

// Deliberately preserved from the approved v6.2 renderer.
const ELECTRIC_FRAGMENT_DEFINITIONS = /* glsl */ `
varying vec3 vElectricRest;
varying vec3 vElectricWorld;
varying vec3 vElectricRestNormal;

float rinaSampleAtlas(vec2 p, float frame) {
  vec2 cell = vec2(mod(floor(frame + 0.5), 4.0), floor((frame + 0.5) / 4.0));
  vec2 uv = mix(vec2(0.004), vec2(0.996), fract(p));
  vec2 atlasUv = (cell + uv) * 0.25;
  return texture2D(uArcAtlas, atlasUv).a;
}
mat2 rinaRot(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}
vec2 rinaWarp(vec3 p) {
  float n1 = sin(dot(p, vec3(2.11, 1.37, 1.83)) + uArcTime * 0.63);
  float n2 = sin(dot(p.zxy, vec3(1.49, 2.63, 1.21)) - uArcTime * 0.49);
  return vec2(n1, n2) * (0.34 * uArcNoiseWarp);
}
float rinaWrappedFilament(vec3 p, vec3 n, float frameA, float frameB) {
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 tangent = cross(up, n);
  if (dot(tangent, tangent) < 0.0005) tangent = cross(vec3(1.0, 0.0, 0.0), n);
  tangent = normalize(tangent);
  vec3 bitangent = normalize(cross(n, tangent));

  float twistAngle = uArcTwist * (p.y * 1.35 + sin(p.x * 1.7 + p.z * 2.1 + uArcTime * 0.55) * 0.65);
  vec2 flow = vec2(dot(p, tangent), dot(p, bitangent));
  flow = rinaRot(twistAngle) * flow;
  vec2 warp = rinaWarp(p);

  vec2 uvWrap = flow * vec2(1.20, 0.92) + vec2(p.y * 0.28, -p.y * 0.11) + warp;
  vec2 diagBasis = vec2(dot(p, normalize(tangent + bitangent * 0.82)), dot(p, normalize(bitangent - tangent * 0.58)));
  vec2 uvDiag = rinaRot(0.82 + twistAngle * 0.45) * diagBasis + vec2(0.31, 0.17) + warp * 1.3;
  vec2 uvVert = vec2(p.y * 1.08 + dot(p, tangent) * 0.28, dot(p, bitangent) * 0.78 - p.y * 0.16);
  uvVert += warp * 0.65 + vec2(0.12, 0.49);

  float wrapLayer = max(
    rinaSampleAtlas(uvWrap, frameA),
    rinaSampleAtlas(uvWrap * 1.17 + vec2(0.18, -0.23), frameB) * uArcLayerSecondary
  );
  float diagLayer = max(
    rinaSampleAtlas(uvDiag, frameB),
    rinaSampleAtlas(uvDiag * 1.11 + vec2(-0.21, 0.27), frameA) * uArcLayerSecondary
  );
  float vertLayer = rinaSampleAtlas(uvVert, frameA) * uArcLayerTertiary;

  float microScale = max(0.001, uArcMicroScale);
  vec2 uvMicroA = uvWrap * microScale + vec2(0.41, -0.18) + warp * 1.8;
  vec2 uvMicroB = uvDiag * (microScale * 1.12) + vec2(-0.36, 0.22) + warp * 1.35;
  vec2 uvMicroC = (flow * vec2(1.72, 1.46) + vec2(-p.y * 0.22, p.y * 0.14)) * (microScale * 0.92) + vec2(0.13, 0.57);
  float microA = rinaSampleAtlas(uvMicroA, frameB);
  float microB = rinaSampleAtlas(uvMicroB, frameA);
  float microC = rinaSampleAtlas(uvMicroC, frameB);
  float microLayer = max(microA, max(microB * 0.96, microC * 0.92)) * uArcMicroBlend;
  microLayer *= mix(0.55, 1.25, clamp(uArcMicroDensity / 2.5, 0.0, 1.0));

  float sumBias = max(0.001, uArcVerticalBias + uArcWrapBias + uArcDiagonalBias);
  float macroFilament = (
    vertLayer * uArcVerticalBias +
    wrapLayer * uArcWrapBias +
    diagLayer * uArcDiagonalBias
  ) / sumBias;

  float filament = max(macroFilament * 0.88, microLayer);
  filament = max(filament, max(wrapLayer * 0.78, diagLayer * 0.76));
  return filament;
}
`;

const ELECTRIC_FRAGMENT_BODY = /* glsl */ `
  if (uArcDebug > 0.5) {
    color = vec4(0.0, 0.98, 0.89, 0.36);
  } else {
    vec3 n = normalize(vElectricRestNormal);
    vec3 p = vElectricRest * uArcScale + uArcOffset;
    float filament = rinaWrappedFilament(p, n, uArcFrameA, uArcFrameB);
    float threshold = mix(0.012, 0.22, 1.0 - uArcThickness);
    float core = smoothstep(threshold + 0.16, threshold + 0.40, filament);
    float edge = smoothstep(threshold - 0.01, threshold + 0.13, filament);
    float halo = smoothstep(0.014, 0.18, filament) * uArcHalo;
    float reveal = smoothstep(-uArcFront, uArcFront,
                         uArcProgress * uArcRadius - distance(vElectricWorld, uArcImpact));
    float flicker = 0.82 + 0.18 * abs(sin(uArcTime * 37.0 + vElectricRest.y * 23.0));
    float strength = clamp(uArcPulse * reveal * flicker, 0.0, 1.0);
    float coverage = clamp((edge * 0.72 + halo * 0.20) * strength, 0.0, 1.0);
    if (coverage < 0.018) discard;
    vec3 energyColor = mix(uArcColor, vec3(1.0, 0.96, 1.0), core * 0.89);
    energyColor *= (0.45 + uArcEmission * 0.65) * (0.55 + core * 1.2);
    color = vec4(energyColor, coverage);
  }
`;

function makeMaterial(
  scene: Scene,
  name: string,
  atlas: Texture,
  meshLocalCenter: Vector3,
  meshLocalDimension: number,
  salt: number,
): { material: CustomMaterial; scale: number } {
  const material = new CustomMaterial(name, scene);
  material.disableLighting = true;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.White();
  material.fogEnabled = false;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.alpha = 0.999;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.alphaMode = Engine.ALPHA_ADD;
  material.zOffset = -2.1;

  // CustomMaterial registers uniforms in shader code; values must be non-falsy
  // at creation. Subsequent updates use its public _newUniformInstances bag.
  material.AddUniform("uArcAtlas", "sampler2D", atlas);
  const defaults: Record<string, number> = {
    uArcTime: 0.0001, uArcFrameA: 0.0001, uArcFrameB: 1.0,
    uArcBlend: 0.0001, uArcScale: 1.0, uArcEmission: 0.2,
    uArcThickness: 0.06, uArcHalo: 0.10, uArcPulse: 1.0,
    uArcDebug: 0.0001, uArcProgress: 1.0, uArcRadius: 5.5,
    uArcFront: 0.30, uArcVerticalBias: 0.18,
    uArcWrapBias: 0.86, uArcDiagonalBias: 1.18, uArcTwist: 1.15,
    uArcNoiseWarp: 0.42, uArcLayerSecondary: 0.74,
    uArcLayerTertiary: 0.20, uArcMicroDensity: 1.95,
    uArcMicroScale: 2.65, uArcMicroBlend: 0.66,
  };
  for (const [key, value] of Object.entries(defaults)) {
    material.AddUniform(key, "float", value);
  }
  material.AddUniform("uArcColor", "vec3", Color3.FromHexString("#DB0075"));
  material.AddUniform("uArcImpact", "vec3", new Vector3(0, 1.5, 0));
  material.AddUniform("uArcOffset", "vec3",
    meshLocalCenter.scale(-0.2).add(new Vector3(salt * 0.09, salt * 0.07, salt * 0.11)));

  material.Vertex_Definitions(
    "varying vec3 vElectricRest; varying vec3 vElectricWorld; varying vec3 vElectricRestNormal;"
  );
  material.Vertex_Before_PositionUpdated(/* glsl */ `
    vElectricRest = position;
    #ifdef NORMAL
      vElectricRestNormal = normal;
    #else
      vElectricRestNormal = vec3(0.0, 1.0, 0.0);
    #endif
  `);
  material.Vertex_After_WorldPosComputed("vElectricWorld = worldPos.xyz;");
  material.Fragment_Definitions(ELECTRIC_FRAGMENT_DEFINITIONS);
  material.Fragment_Before_FragColor(ELECTRIC_FRAGMENT_BODY);
  const scale = 2.5 / Math.max(0.4, meshLocalDimension);
  return { material, scale };
}

function setFloat(m: CustomMaterial, uniform: string, value: number) {
  m._newUniformInstances[`float-${uniform}`] = value;
}
function setVec3(m: CustomMaterial, uniform: string, value: Vector3 | Color3) {
  m._newUniformInstances[`vec3-${uniform}`] = value;
}

const DEFAULT_SKIP_MESH = /(^rinaElectricFX_|eye|iris|pupil|cornea|lash|teeth|tongue)/i;

/** Owns only the overlay meshes, their materials, the atlas and (optionally) one light. */
export class RinaElectricSurfaceFX {
  readonly scene: Scene;
  readonly parameters: ElectricSurfaceParameters;
  private readonly atlas: Texture;
  private readonly light: PointLight | null;
  private readonly includeMesh: (mesh: Mesh) => boolean;
  private readonly overlays: Overlay[] = [];
  private mode: Mode = "off";
  private time = 0;
  private modeElapsed = 0;
  private pulse = 0;
  private fadeFrom = 0;
  private growthSeconds = 0.75;
  private holdSeconds = 0.52;
  private fadeSeconds = 0.53;
  private impact = new Vector3(0, 1.5, 0);
  private impactProvider: (() => Vector3) | null = null;
  private disposed = false;
  private showDiagnostic = false;
  private lastVisible = false;

  constructor(scene: Scene, options: RinaElectricSurfaceFXOptions = {}) {
    this.scene = scene;
    this.parameters = { ...RINA_ELECTRIC_THIN_CHAOTIC, ...options.parameters };
    this.includeMesh = options.includeMesh ?? ((mesh) => !DEFAULT_SKIP_MESH.test(mesh.name));
    this.atlas = new Texture(
      options.atlasUrl ?? asset(DEFAULT_ATLAS),
      scene, true, false, Texture.BILINEAR_SAMPLINGMODE,
    );
    this.atlas.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.atlas.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.atlas.hasAlpha = true;

    if (options.createPointLight !== false) {
      const light = new PointLight("rinaElectricHitLight", Vector3.Zero(), scene);
      light.diffuse = Color3.FromHexString(this.parameters.colorHex);
      light.specular = Color3.Black();
      light.intensity = 0;
      light.range = this.parameters.lightRange;
      light.shadowEnabled = false;
      light.renderPriority = 2;
      light.setEnabled(false);
      this.light = light;
    } else {
      this.light = null;
    }
  }

  /** Attach to actual model meshes, NOT bones or TransformNodes. */
  attach(meshes: readonly AbstractMesh[]): number {
    this.assertUsable();
    this.detach();
    for (const source of meshes) {
      if (!(source instanceof Mesh) || source.getTotalVertices() <= 0 || !this.includeMesh(source)) {
        continue;
      }
      // The source becomes the parent. Identity local transform means exact
      // alignment even if imported GLB meshes have nested transformations.
      const overlay = source.clone(`rinaElectricFX_${source.uniqueId}`, source, true, false);
      if (!overlay) continue;
      let material: CustomMaterial | null = null;
      try {
        overlay.position.setAll(0);
        overlay.rotation.setAll(0);
        overlay.rotationQuaternion = Quaternion.Identity();
        overlay.scaling.setAll(1);
        overlay.skeleton = source.skeleton;
        overlay.computeBonesUsingShaders = source.computeBonesUsingShaders;
        overlay.numBoneInfluencers = source.numBoneInfluencers;
        overlay.morphTargetManager = source.morphTargetManager;
        overlay.renderingGroupId = source.renderingGroupId;
        overlay.isPickable = false;
        overlay.checkCollisions = false;
        overlay.receiveShadows = false;
        overlay.applyFog = false;
        const bounds = source.getBoundingInfo().boundingBox;
        const half = bounds.extendSize;
        const dimension = Math.max(0.01, half.x * 2, half.y * 2, half.z * 2);
        const built = makeMaterial(this.scene,
          `rinaElectricMaterial_${source.uniqueId}`, this.atlas,
          bounds.center, dimension, this.overlays.length + 1);
        material = built.material;
        overlay.material = material;
        overlay.setEnabled(false);
        this.overlays.push({ original: source, mesh: overlay, material, scale: built.scale });
      } catch (error) {
        overlay.dispose(false, false);
        material?.dispose(false, false);
        this.detach();
        throw new Error(`No se pudo aplicar electricidad a ${source.name}: ${String(error)}`);
      }
    }
    if (this.overlays.length === 0) {
      throw new Error("RinaElectricSurfaceFX: no hay mallas visibles compatibles");
    }
    // Initial hit point near the visible model; callers can override it.
    this.impact.copyFrom(this.overlays[0].original.getBoundingInfo().boundingBox.centerWorld);
    return this.overlays.length;
  }

  /** A moving target may supply the impact point in WORLD coordinates. */
  setImpactProvider(provider: (() => Vector3) | null): void {
    this.impactProvider = provider;
  }
  setImpact(worldPoint: Vector3): void {
    this.impact.copyFrom(worldPoint);
    this.impactProvider = null;
  }
  setDiagnostic(enabled: boolean): void { this.showDiagnostic = enabled; }
  setParameters(patch: Partial<ElectricSurfaceParameters>): void {
    Object.assign(this.parameters, patch);
    if (this.light) this.light.range = this.parameters.lightRange;
  }
  startContinuous(): void {
    this.assertUsable();
    this.mode = "continuous";
    this.modeElapsed = 0;
    this.setVisualVisibility(true);
  }
  triggerHit(options: RinaElectricHitOptions = {}): void {
    this.assertUsable();
    this.mode = "hit";
    this.modeElapsed = 0;
    this.growthSeconds = Math.max(0.01, options.growthSeconds ?? 0.75);
    this.holdSeconds = Math.max(0, options.holdSeconds ?? 0.52);
    this.fadeSeconds = Math.max(0.01, options.fadeSeconds ?? 0.53);
    if (options.impact) this.setImpact(options.impact);
    this.setVisualVisibility(true);
  }
  stop(fadeSeconds = 0.15): void {
    if (this.mode === "off") return;
    if (fadeSeconds <= 0) {
      this.mode = "off";
      this.pulse = 0;
      this.setVisualVisibility(false);
    } else {
      this.mode = "fade";
      this.fadeFrom = this.pulse;
      this.fadeSeconds = fadeSeconds;
      this.modeElapsed = 0;
    }
  }

  /** Call from the level's update(dt), once per frame. */
  update(deltaTimeSeconds: number): void {
    if (this.disposed || this.mode === "off" || this.overlays.length === 0) return;
    const dt = clamp(Number.isFinite(deltaTimeSeconds) ? deltaTimeSeconds : 0, 0, 0.05);
    this.time += dt;
    this.modeElapsed += dt;
    if (this.impactProvider) this.impact.copyFrom(this.impactProvider());

    let strength = 0;
    let progress = 1;
    if (this.mode === "continuous") {
      strength = 0.75 + 0.25 * Math.sin(this.time * 11) * Math.sin(this.time * 16);
    } else if (this.mode === "hit") {
      const t = this.modeElapsed;
      if (t < this.growthSeconds) {
        progress = clamp(t / this.growthSeconds, 0, 1);
        strength = Math.min(1, 0.5 + progress * 0.6);
      } else if (t < this.growthSeconds + this.holdSeconds) {
        strength = 0.90 + 0.14 * Math.sin(this.time * 39) * Math.sin(this.time * 23);
      } else if (t < this.growthSeconds + this.holdSeconds + this.fadeSeconds) {
        const fade = (t - this.growthSeconds - this.holdSeconds) / this.fadeSeconds;
        strength = 1 - fade;
      } else {
        this.stop(0);
        return;
      }
    } else { // fade (manually stopped)
      strength = this.fadeFrom * (1 - clamp(this.modeElapsed / this.fadeSeconds, 0, 1));
      if (strength <= 0.001) { this.stop(0); return; }
    }
    this.pulse = clamp(strength, 0, 1);
    this.setVisualVisibility(true);
    const phase = this.time * 7.8;
    const frameA = Math.floor(phase) % 16;
    const frameB = (frameA + 1) % 16;
    const blend = (phase - Math.floor(phase)) * 0.55;
    const p = this.parameters;
    const tint = Color3.FromHexString(p.colorHex);
    for (const entry of this.overlays) {
      // PlayerController hides/fades the original avatar in first person and
      // near walls; the electric clone must follow that presentation state.
      entry.mesh.visibility = entry.original.visibility;
      const m = entry.material;
      setFloat(m, "uArcTime", this.time);
      setFloat(m, "uArcFrameA", frameA);
      setFloat(m, "uArcFrameB", frameB);
      setFloat(m, "uArcBlend", blend);
      setFloat(m, "uArcScale", entry.scale * p.density);
      setFloat(m, "uArcEmission", p.emission);
      setFloat(m, "uArcThickness", clamp(p.thickness, 0, 1));
      setFloat(m, "uArcHalo", p.halo);
      setFloat(m, "uArcPulse", this.pulse);
      setFloat(m, "uArcDebug", this.showDiagnostic ? 1 : 0);
      setFloat(m, "uArcProgress", progress);
      setFloat(m, "uArcRadius", p.propagationRadius);
      setFloat(m, "uArcFront", Math.max(0.02, p.propagationFront));
      setFloat(m, "uArcVerticalBias", p.verticalBias);
      setFloat(m, "uArcWrapBias", p.wrapBias);
      setFloat(m, "uArcDiagonalBias", p.diagonalBias);
      setFloat(m, "uArcTwist", p.twistStrength);
      setFloat(m, "uArcNoiseWarp", p.noiseWarpStrength);
      setFloat(m, "uArcLayerSecondary", p.secondaryBlend);
      setFloat(m, "uArcLayerTertiary", p.tertiaryBlend);
      setFloat(m, "uArcMicroDensity", p.microDensity);
      setFloat(m, "uArcMicroScale", p.microScale);
      setFloat(m, "uArcMicroBlend", p.microBlend);
      setVec3(m, "uArcImpact", this.impact);
      setVec3(m, "uArcColor", tint);
    }
    if (this.light) {
      this.light.position.copyFrom(this.impact);
      this.light.diffuse.copyFrom(tint);
      this.light.intensity = p.lightIntensity * this.pulse;
      this.light.setEnabled(this.light.intensity > 0.001);
    }
  }

  get isActive() { return this.mode !== "off"; }
  get overlayMeshCount() { return this.overlays.length; }

  /** Call on level transition or when the affected character is replaced. */
  detach(): void {
    this.stop(0);
    this.impactProvider = null;
    for (const entry of this.overlays) {
      entry.mesh.dispose(false, false);
      entry.material.dispose(false, false);
    }
    this.overlays.length = 0;
  }
  dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.atlas.dispose();
    this.light?.dispose();
    this.disposed = true;
  }

  private setVisualVisibility(visible: boolean): void {
    if (this.lastVisible !== visible) {
      this.lastVisible = visible;
      for (const entry of this.overlays) entry.mesh.setEnabled(visible);
    }
    if (!visible && this.light) {
      this.light.intensity = 0;
      this.light.setEnabled(false);
    }
  }
  private assertUsable(): void {
    if (this.disposed) throw new Error("RinaElectricSurfaceFX already disposed");
  }
}
