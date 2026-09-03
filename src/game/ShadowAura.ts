import { Engine } from "@babylonjs/core/Engines/engine";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { LivingBlackFlameNPE, type LivingBlackFlameMetrics } from "./LivingBlackFlameNPE";
import {
  SurfaceShadowCorruption,
  type SurfaceShadowCorruptionConfig,
} from "./SurfaceShadowCorruption";

export type ShadowAuraQualityLevel = "low" | "medium" | "high";

export type ShadowAuraState = {
  health: number;
  sanity: number;
};

export type ShadowAuraDebugMetrics = LivingBlackFlameMetrics & {
  fps: number;
  frameTimeMs: number;
  surfaceMaterialCount: number;
  surfaceOnly: boolean;
};

export type ShadowAuraTarget = {
  root: TransformNode;
  avatarMeshes: readonly AbstractMesh[];
  /** Returns the world-space height of the walkable surface at a position. */
  getGroundSurfaceHeightAt?: (x: number, z: number) => number;
};

export type ShadowFlameConfig = {
  maxCount: number;
};

export type ShadowGroundConfig = {
  minScale: number;
  maxScale: number;
  minOpacity: number;
  maxOpacity: number;
};

export type ShadowAuraPerformanceConfig = {
  maxDistance?: number;
  allowFlames: boolean;
  qualityLevel: ShadowAuraQualityLevel;
};

export type ShadowAuraConfig = {
  enabled: boolean;
  smoothingSpeed: number;
  surface: SurfaceShadowCorruptionConfig;
  flames: ShadowFlameConfig;
  ground: ShadowGroundConfig;
  performance: ShadowAuraPerformanceConfig;
};

export type ShadowAuraConfigOverrides = Partial<
  Omit<ShadowAuraConfig, "surface" | "flames" | "ground" | "performance">
> & {
  surface?: Partial<SurfaceShadowCorruptionConfig>;
  flames?: Partial<ShadowFlameConfig>;
  ground?: Partial<ShadowGroundConfig>;
  performance?: Partial<ShadowAuraPerformanceConfig>;
};

/**
 * Artistic and performance tuning lives here so the renderer never needs to
 * rebuild meshes or materials when gameplay changes health or sanity.
 */
export const DEFAULT_SHADOW_AURA_CONFIG: ShadowAuraConfig = {
  enabled: true,
  smoothingSpeed: 5.5,
  surface: {
    noiseScale: 1.45,
    flowSpeed: 0.2,
    maxDarkness: 0.9,
  },
  flames: {
    maxCount: 24,
  },
  ground: {
    minScale: 1.05,
    maxScale: 3.1,
    minOpacity: 0,
    maxOpacity: 0.38,
  },
  performance: {
    maxDistance: 45,
    allowFlames: true,
    qualityLevel: "high",
  },
};

const controllersByScene = new WeakMap<Scene, ShadowAuraController>();
const GROUND_STAIN_SURFACE_BIAS = 0.006;
const GROUND_STAIN_SUBDIVISIONS = 8;

/** Returns the scene's live aura so future gameplay stats can drive it directly. */
export function getShadowAuraController(scene: Scene) {
  return controllersByScene.get(scene) ?? null;
}

const GROUND_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 viewProjection;

varying vec2 vUV;

void main(void) {
  vUV = uv;
  gl_Position = viewProjection * world * vec4(position, 1.0);
}
`;

const GROUND_FRAGMENT_SHADER = `
precision highp float;

uniform float time;
uniform float intensity;
uniform float chaos;

varying vec2 vUV;

float poolNoise(vec2 p) {
  float a = sin(dot(p, vec2(1.9, 1.4)));
  float b = sin(dot(p, vec2(-2.2, 1.7)) + a * 0.75);
  float c = sin(dot(p, vec2(3.1, -1.3)) + b * 0.55);
  return a * 0.18 + b * 0.17 + c * 0.15 + 0.5;
}

void main(void) {
  vec2 p = vUV * 2.0 - 1.0;
  float flow = time * (0.055 + chaos * 0.045);
  float coarseNoise = poolNoise(p * 1.45 + vec2(flow, -flow * 0.62));
  float detailNoise = poolNoise(p * 2.75 + vec2(-flow * 0.48, flow * 0.81));
  vec2 warped = p + vec2((coarseNoise - 0.5) * 0.18, (detailNoise - 0.5) * 0.14);
  float poolDistance = length(vec2(warped.x * 0.82, warped.y * 1.14));
  float boundary = 0.79 + (coarseNoise - 0.5) * 0.18 + (detailNoise - 0.5) * 0.08;
  float featheredPool = 1.0 - smoothstep(boundary - 0.25, boundary + 0.18, poolDistance);
  float stainDensity = 0.56 + mix(coarseNoise, detailNoise, 0.34) * 0.28;
  float alpha = featheredPool * intensity * stainDensity;
  vec3 deepestBlack = vec3(0.0118, 0.0118, 0.0196);
  vec3 softBlack = vec3(0.0314, 0.0275, 0.0431);
  vec3 color = mix(deepestBlack, softBlack, detailNoise * 0.24);

  gl_FragColor = vec4(color, alpha);
}
`;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** Accept normalized gameplay values and the 0..100 debug/gameplay convention. */
function normalizeStat(value: number) {
  if (!Number.isFinite(value)) return 1;
  return clamp01(value > 1 ? value / 100 : value);
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

/**
 * A lightweight, self-contained visual layer for a skinned avatar.
 * It leaves source geometry and animation groups untouched.
 */
export class ShadowAuraController {
  private readonly config: ShadowAuraConfig;
  private readonly root: TransformNode;
  private readonly avatarMeshes: readonly AbstractMesh[];
  private readonly getGroundSurfaceHeightAt: ((x: number, z: number) => number) | undefined;
  private readonly surfaceCorruption: SurfaceShadowCorruption;
  private readonly groundMaterial: ShaderMaterial;
  private readonly groundAura: Mesh;
  private readonly updateObserver: Observer<Scene>;
  private readonly disposeObserver: Observer<Scene>;
  private groundBasePositions = new Float32Array();
  private groundPositions = new Float32Array();
  private flameSystem: LivingBlackFlameNPE | null = null;
  private visualHealth = 1;
  private visualSanity = 1;
  private targetHealth = 1;
  private targetSanity = 1;
  private enabled: boolean;
  private visible = true;
  private surfaceOnly = false;
  private intensityMultiplier = 1;
  private elapsed = 0;
  private bodyMinY = -1.7;
  private bodyHeight = 1.7;
  private bodyRadius = 0.55;
  private disposed = false;

  constructor(scene: Scene, target: ShadowAuraTarget, overrides: ShadowAuraConfigOverrides = {}) {
    this.config = {
      ...DEFAULT_SHADOW_AURA_CONFIG,
      ...overrides,
      surface: { ...DEFAULT_SHADOW_AURA_CONFIG.surface, ...overrides.surface },
      flames: { ...DEFAULT_SHADOW_AURA_CONFIG.flames, ...overrides.flames },
      ground: { ...DEFAULT_SHADOW_AURA_CONFIG.ground, ...overrides.ground },
      performance: { ...DEFAULT_SHADOW_AURA_CONFIG.performance, ...overrides.performance },
    };
    this.root = target.root;
    this.avatarMeshes = target.avatarMeshes;
    this.getGroundSurfaceHeightAt = target.getGroundSurfaceHeightAt;
    this.enabled = this.config.enabled;

    this.measureAvatar();
    this.surfaceCorruption = new SurfaceShadowCorruption(
      this.root,
      this.avatarMeshes,
      this.bodyMinY,
      this.bodyHeight,
      this.config.surface
    );
    this.groundMaterial = this.createGroundMaterial(scene);
    this.groundAura = this.createGroundAura(scene);

    if (this.config.performance.allowFlames && this.config.flames.maxCount > 0) {
      this.flameSystem = new LivingBlackFlameNPE(
        scene,
        {
          root: this.root,
          avatarMeshes: this.avatarMeshes,
          bodyMinY: this.bodyMinY,
          bodyHeight: this.bodyHeight,
          bodyRadius: this.bodyRadius,
        },
        this.config.performance.qualityLevel,
        this.config.flames.maxCount
      );
    }

    this.updateObserver = scene.onBeforeRenderObservable.add(() => {
      this.update(scene.getEngine().getDeltaTime() * 0.001);
    });
    this.disposeObserver = scene.onDisposeObservable.add(() => this.dispose());
    controllersByScene.set(scene, this);
    this.hideAllVisuals();
  }

  setHealth(health: number) {
    this.targetHealth = normalizeStat(health);
  }

  setSanity(sanity: number) {
    this.targetSanity = normalizeStat(sanity);
  }

  updateState(state: Partial<ShadowAuraState>) {
    if (state.health !== undefined) this.setHealth(state.health);
    if (state.sanity !== undefined) this.setSanity(state.sanity);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.hideAllVisuals();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) this.hideAllVisuals();
  }

  setIntensityMultiplier(multiplier: number) {
    this.intensityMultiplier = Math.max(0, multiplier);
  }

  /** Temporary art/debug isolation: preserve surface corruption and hide only NPE flames. */
  setSurfaceOnly(surfaceOnly: boolean) {
    this.surfaceOnly = surfaceOnly;
    if (surfaceOnly) this.flameSystem?.hide();
  }

  getDebugMetrics(): ShadowAuraDebugMetrics | null {
    const metrics = this.flameSystem?.getMetrics();
    if (!metrics) return null;
    const engine = this.root.getScene().getEngine();
    return {
      ...metrics,
      fps: engine.getFps(),
      frameTimeMs: engine.getDeltaTime(),
      surfaceMaterialCount: this.surfaceCorruption.materialCount,
      surfaceOnly: this.surfaceOnly,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    const scene = this.root.getScene();
    if (controllersByScene.get(scene) === this) controllersByScene.delete(scene);
    scene.onBeforeRenderObservable.remove(this.updateObserver);
    scene.onDisposeObservable.remove(this.disposeObserver);

    this.groundAura.dispose(false, false);
    this.surfaceCorruption.dispose();
    this.groundMaterial.dispose(false, false);
    this.flameSystem?.dispose();
  }

  private update(dt: number) {
    if (this.disposed) return;

    const safeDt = Math.min(0.1, Math.max(0, dt));
    const smoothing = 1 - Math.exp(-this.config.smoothingSpeed * safeDt);
    this.visualHealth = lerp(this.visualHealth, this.targetHealth, smoothing);
    this.visualSanity = lerp(this.visualSanity, this.targetSanity, smoothing);
    this.elapsed += safeDt;

    if (!this.enabled || !this.visible || !this.isWithinDistance()) {
      this.hideAllVisuals();
      return;
    }

    const healthDamage = 1 - this.visualHealth;
    const sanityDamage = 1 - this.visualSanity;
    const coverage = clamp01(
      Math.max(healthDamage, sanityDamage * 0.65) + healthDamage * sanityDamage * 0.15
    );
    const chaos = Math.pow(sanityDamage, 1.25);
    this.updateSurfaceCorruption(healthDamage, sanityDamage);
    this.updateGround(healthDamage, sanityDamage);
    if (this.surfaceOnly) {
      this.flameSystem?.hide();
    } else {
      this.flameSystem?.update({
        coverage: coverage * this.intensityMultiplier,
        healthDamage,
        sanityDamage,
        chaos,
        deltaTime: safeDt,
      });
    }
  }

  private updateSurfaceCorruption(healthDamage: number, sanityDamage: number) {
    this.surfaceCorruption.update(
      this.elapsed,
      healthDamage,
      sanityDamage,
      this.intensityMultiplier
    );
  }

  private updateGround(healthDamage: number, sanityDamage: number) {
    const intensity = clamp01(
      (this.config.ground.minOpacity +
        (this.config.ground.maxOpacity - this.config.ground.minOpacity) * healthDamage +
        sanityDamage * 0.025) *
        this.intensityMultiplier
    );
    const active = intensity > 0.008 && healthDamage > 0.01;
    this.groundAura.setEnabled(active);
    if (!active) return;

    const scale = lerp(this.config.ground.minScale, this.config.ground.maxScale, healthDamage);
    const sanityExpansion = 1 + sanityDamage * 0.07;
    const finalScale = this.bodyRadius * scale * sanityExpansion;
    this.updateGroundGeometry(finalScale);
    this.groundMaterial.setFloat("time", this.elapsed);
    this.groundMaterial.setFloat("intensity", intensity);
    this.groundMaterial.setFloat("chaos", sanityDamage);
  }

  private createGroundMaterial(scene: Scene) {
    const material = new ShaderMaterial(
      "shadowAuraGroundMaterial",
      scene,
      { vertexSource: GROUND_VERTEX_SHADER, fragmentSource: GROUND_FRAGMENT_SHADER },
      {
        attributes: ["position", "uv"],
        uniforms: ["world", "viewProjection", "time", "intensity", "chaos"],
        needAlphaBlending: true,
      }
    );
    material.alphaMode = Engine.ALPHA_COMBINE;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.needDepthPrePass = false;
    return material;
  }

  private createGroundAura(scene: Scene) {
    const ground = MeshBuilder.CreateGround(
      "shadowAuraGround",
      {
        width: 2,
        height: 2,
        subdivisions: GROUND_STAIN_SUBDIVISIONS,
        updatable: true,
      },
      scene
    );
    const positions = ground.getVerticesData(VertexBuffer.PositionKind);
    if (positions) {
      this.groundBasePositions = Float32Array.from(positions);
      this.groundPositions = Float32Array.from(positions);
    }
    ground.material = this.groundMaterial;
    ground.isPickable = false;
    ground.alwaysSelectAsActiveMesh = true;
    // Rendering group 1 clears the world depth buffer before transparent meshes
    // are drawn. Keeping the stain in the world group lets trees, rocks, and
    // vegetation correctly occlude it in the isometric view.
    ground.renderingGroupId = 0;
    ground.setEnabled(false);
    return ground;
  }

  private updateGroundGeometry(radius: number) {
    if (this.groundBasePositions.length === 0 || this.groundPositions.length === 0) return;

    const rootPosition = this.root.getAbsolutePosition();
    for (let index = 0; index < this.groundBasePositions.length; index += 3) {
      const x = rootPosition.x + this.groundBasePositions[index] * radius;
      const z = rootPosition.z + this.groundBasePositions[index + 2] * radius;
      const sampledSurfaceY = this.getGroundSurfaceHeightAt?.(x, z);
      const y =
        sampledSurfaceY !== undefined && Number.isFinite(sampledSurfaceY)
          ? sampledSurfaceY + GROUND_STAIN_SURFACE_BIAS
          : rootPosition.y + this.bodyMinY + GROUND_STAIN_SURFACE_BIAS;

      this.groundPositions[index] = x;
      this.groundPositions[index + 1] = y;
      this.groundPositions[index + 2] = z;
    }

    // A 9x9 height grid follows the terrain under the whole pool, avoiding the
    // hard road-edge cut of a single flat plane while keeping the VFX cheap.
    this.groundAura.updateVerticesData(VertexBuffer.PositionKind, this.groundPositions, true);
  }

  private measureAvatar() {
    if (this.avatarMeshes.length === 0) return;

    const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    for (const mesh of this.avatarMeshes) {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      min.copyFrom(Vector3.Minimize(min, bounds.minimumWorld));
      max.copyFrom(Vector3.Maximize(max, bounds.maximumWorld));
    }

    if (!Number.isFinite(min.y) || !Number.isFinite(max.y)) return;
    const rootPosition = this.root.getAbsolutePosition();
    this.bodyMinY = min.y - rootPosition.y;
    this.bodyHeight = Math.max(0.8, max.y - min.y);
    this.bodyRadius = Math.max(0.4, (Math.max(max.x - min.x, max.z - min.z) * 0.5) || 0.4);
  }

  private isWithinDistance() {
    const maxDistance = this.config.performance.maxDistance;
    const camera = this.root.getScene().activeCamera;
    if (maxDistance === undefined || !camera) return true;
    return Vector3.DistanceSquared(camera.globalPosition, this.root.getAbsolutePosition()) <= maxDistance * maxDistance;
  }

  private hideAllVisuals() {
    this.surfaceCorruption.hide();
    this.groundAura.setEnabled(false);
    this.flameSystem?.hide();
  }
}
