import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
import {
  WATER_CONTACT_EFFECTS_CONFIG,
  type WaterContactEffectsConfig,
} from "./WaterContactEffectsConfig";

export interface WaterRippleSpawnOptions {
  position: Vector3;
  strength: number;
  duration?: number;
  startRadius?: number;
  endRadius?: number;
  alpha?: number;
}

export interface WaterSplashOptions {
  position: Vector3;
  direction?: Vector3;
  velocity?: Vector3;
  strength: number;
  particleCount?: number;
}

type RippleSlot = {
  mesh: Mesh;
  active: boolean;
  age: number;
  duration: number;
  startRadius: number;
  endRadius: number;
  alpha: number;
};

type SplashSlot = {
  system: ParticleSystem;
  emitter: Vector3;
  active: boolean;
  age: number;
};

export type WaterInteractionVFXDebugSnapshot = {
  activeRipples: number;
  ripplePoolSize: number;
  activeSplashSystems: number;
  splashPoolSize: number;
  totalRipplesSpawned: number;
  totalSplashesSpawned: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function createRippleTexture(scene: Scene) {
  const texture = new DynamicTexture(
    "waterContactRippleTexture",
    { width: 128, height: 128 },
    scene,
    false
  );
  const context = texture.getContext();
  context.clearRect(0, 0, 128, 128);
  // Two incomplete rings form a wake without the artificial target-like look
  // produced by several perfectly closed concentric circles.
  const drawBrokenRing = (radius: number, phase: number) => {
    const arcs = [
      [phase + 0.08, phase + 2.62],
      [phase + 3.08, phase + 5.72],
    ] as const;
    for (const [start, end] of arcs) {
      context.beginPath();
      context.arc(64, 64, radius, start, end);
      context.strokeStyle = "rgba(146, 207, 211, 0.2)";
      context.lineWidth = 7;
      context.stroke();
      context.beginPath();
      context.arc(64, 64, radius, start + 0.025, end - 0.025);
      context.strokeStyle = "rgba(218, 243, 244, 0.9)";
      context.lineWidth = 2.4;
      context.stroke();
    }
  };
  drawBrokenRing(39, 0.18);
  drawBrokenRing(56, -0.12);
  texture.hasAlpha = true;
  texture.update(false);
  return texture;
}

function createDropletTexture(scene: Scene) {
  const texture = new DynamicTexture(
    "waterContactDropletTexture",
    { width: 32, height: 32 },
    scene,
    false
  );
  const context = texture.getContext();
  const gradient = context.createRadialGradient(16, 14, 1, 16, 16, 15);
  gradient.addColorStop(0, "rgba(220, 236, 237, 0.92)");
  gradient.addColorStop(0.42, "rgba(172, 207, 210, 0.72)");
  gradient.addColorStop(0.78, "rgba(112, 164, 170, 0.26)");
  gradient.addColorStop(1, "rgba(75, 122, 130, 0)");
  context.clearRect(0, 0, 32, 32);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  texture.hasAlpha = true;
  texture.update(false);
  return texture;
}

export class WaterRippleEffectPool {
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  private readonly slots: RippleSlot[];
  private cursor = 0;
  private disposed = false;
  private spawnCount = 0;

  constructor(
    private readonly scene: Scene,
    private readonly config: WaterContactEffectsConfig = WATER_CONTACT_EFFECTS_CONFIG
  ) {
    this.texture = createRippleTexture(scene);
    this.material = new StandardMaterial("waterContactRippleMaterial", scene);
    this.material.diffuseTexture = this.texture;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.emissiveTexture = this.texture;
    this.material.diffuseColor = new Color3(0.7, 0.86, 0.87);
    this.material.emissiveColor = new Color3(0.3, 0.48, 0.5);
    this.material.specularColor = Color3.Black();
    this.material.disableLighting = true;
    this.material.alphaMode = Material.MATERIAL_ALPHABLEND;
    this.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.material.disableDepthWrite = true;
    this.material.backFaceCulling = false;
    this.material.fogEnabled = true;
    this.material.zOffset = -1;

    this.slots = Array.from({ length: config.ripple.poolSize }, (_, index) => {
      const mesh = MeshBuilder.CreateDisc(
        `waterContactRipple_${index}`,
        { radius: 1, tessellation: 40, sideOrientation: Mesh.DOUBLESIDE },
        scene
      );
      mesh.material = this.material;
      mesh.rotation.x = Math.PI * 0.5;
      mesh.isPickable = false;
      // WaterMaterial is transparent; a later rendering group prevents its
      // surface pass from hiding contact rings and droplets.
      mesh.renderingGroupId = 1;
      mesh.alphaIndex = 40 + index;
      mesh.setEnabled(false);
      return {
        mesh,
        active: false,
        age: 0,
        duration: 1,
        startRadius: 0.1,
        endRadius: 1,
        alpha: 0,
      };
    });
  }

  spawn(options: WaterRippleSpawnOptions) {
    if (this.disposed || this.slots.length === 0) return;
    const slot = this.acquireSlot();
    const strength = clamp01(options.strength);
    slot.active = true;
    slot.age = 0;
    slot.duration = Math.max(0.08, options.duration ?? this.config.ripple.movementDuration);
    slot.startRadius = Math.max(0.01, options.startRadius ?? this.config.ripple.movementStartRadius);
    slot.endRadius = Math.max(
      slot.startRadius,
      (options.endRadius ?? this.config.ripple.movementEndRadius) * (0.78 + strength * 0.32)
    );
    slot.alpha = Math.max(0, options.alpha ?? this.config.ripple.movementAlpha) *
      (0.55 + strength * 0.45);
    slot.mesh.position.set(
      options.position.x,
      options.position.y + this.config.ripple.surfaceOffset,
      options.position.z
    );
    slot.mesh.scaling.set(slot.startRadius, slot.startRadius, 1);
    slot.mesh.visibility = slot.alpha;
    slot.mesh.setEnabled(true);
    this.spawnCount += 1;
  }

  update(deltaTime: number) {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(deltaTime, 0.05));
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      const progress = clamp01(slot.age / slot.duration);
      if (progress >= 1) {
        slot.active = false;
        slot.mesh.visibility = 0;
        slot.mesh.setEnabled(false);
        continue;
      }

      const expansion = 1 - Math.pow(1 - progress, 2.2);
      const radius = slot.startRadius + (slot.endRadius - slot.startRadius) * expansion;
      const fadeIn = Math.min(1, progress / 0.08);
      const fadeOut = Math.pow(1 - progress, 1.45);
      slot.mesh.scaling.set(radius, radius, 1);
      slot.mesh.visibility = slot.alpha * fadeIn * fadeOut;
    }
  }

  get activeCount() {
    let count = 0;
    for (const slot of this.slots) if (slot.active) count += 1;
    return count;
  }

  get poolSize() {
    return this.slots.length;
  }

  get totalSpawned() {
    return this.spawnCount;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) slot.mesh.dispose(false, false);
    this.material.dispose(false, false);
    this.texture.dispose();
  }

  private acquireSlot() {
    for (let offset = 0; offset < this.slots.length; offset++) {
      const index = (this.cursor + offset) % this.slots.length;
      const slot = this.slots[index];
      if (!slot.active) {
        this.cursor = (index + 1) % this.slots.length;
        return slot;
      }
    }

    let oldest = this.slots[0];
    for (const slot of this.slots) {
      if (slot.age / slot.duration > oldest.age / oldest.duration) oldest = slot;
    }
    this.cursor = (this.slots.indexOf(oldest) + 1) % this.slots.length;
    return oldest;
  }
}

export class WaterSplashEffectPool {
  private readonly texture: DynamicTexture;
  private readonly slots: SplashSlot[];
  private cursor = 0;
  private disposed = false;
  private spawnCount = 0;

  constructor(
    private readonly scene: Scene,
    private readonly config: WaterContactEffectsConfig = WATER_CONTACT_EFFECTS_CONFIG
  ) {
    this.texture = createDropletTexture(scene);
    this.slots = Array.from({ length: config.droplets.poolSize }, (_, index) => {
      const emitter = new Vector3(0, -10000, 0);
      const system = new ParticleSystem(
        `waterSplashPool_${index}`,
        config.droplets.capacityPerSystem,
        scene
      );
      system.particleTexture = this.texture;
      system.emitter = emitter;
      system.minEmitBox.set(-0.08, 0, -0.08);
      system.maxEmitBox.set(0.08, 0.03, 0.08);
      system.color1 = new Color4(0.82, 0.94, 0.95, 0.94);
      system.color2 = new Color4(0.58, 0.8, 0.83, 0.78);
      system.colorDead = new Color4(0.2, 0.34, 0.36, 0);
      system.minLifeTime = config.droplets.minLifetime;
      system.maxLifeTime = config.droplets.maxLifetime;
      system.minSize = config.droplets.minSize;
      system.maxSize = config.droplets.maxSize;
      system.minScaleX = 0.62;
      system.maxScaleX = 0.92;
      system.minScaleY = 1;
      system.maxScaleY = 2.1;
      system.emitRate = 0;
      system.minEmitPower = 0.92;
      system.maxEmitPower = 1.08;
      system.updateSpeed = 0.012;
      system.gravity.set(0, config.droplets.gravity, 0);
      system.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      system.renderingGroupId = 1;
      system.disposeOnStop = false;
      return { system, emitter, active: false, age: 0 };
    });
  }

  spawn(options: WaterSplashOptions) {
    if (this.disposed || this.slots.length === 0) return;
    const slot = this.acquireSlot();
    const strength = clamp01(options.strength);
    const sourceDirection = options.direction ?? options.velocity;
    let directionX = 0;
    let directionZ = 0;
    if (sourceDirection) {
      const length = Math.hypot(sourceDirection.x, sourceDirection.z);
      if (length > 0.0001) {
        directionX = sourceDirection.x / length;
        directionZ = sourceDirection.z / length;
      }
    }

    const lateralX = -directionZ;
    const lateralZ = directionX;
    const forward = this.config.droplets.forwardInfluence * (0.45 + strength * 0.55);
    const spread = this.config.droplets.lateralSpread * (0.65 + strength * 0.35);
    const minVertical = this.config.droplets.minVerticalSpeed * (0.72 + strength * 0.38);
    const maxVertical = this.config.droplets.maxVerticalSpeed * (0.68 + strength * 0.42);
    slot.system.direction1.set(
      directionX * forward - lateralX * spread,
      minVertical,
      directionZ * forward - lateralZ * spread
    );
    slot.system.direction2.set(
      directionX * forward + lateralX * spread,
      maxVertical,
      directionZ * forward + lateralZ * spread
    );
    slot.system.minSize = this.config.droplets.minSize * (0.78 + strength * 0.35);
    slot.system.maxSize = this.config.droplets.maxSize * (0.72 + strength * 0.48);

    const automaticCount = Math.round(
      this.config.droplets.minCount +
        (this.config.droplets.maxCount - this.config.droplets.minCount) * strength
    );
    const count = Math.max(
      1,
      Math.min(
        this.config.droplets.capacityPerSystem,
        Math.round(options.particleCount ?? automaticCount)
      )
    );

    slot.system.stop();
    slot.system.reset();
    slot.emitter.copyFrom(options.position);
    slot.system.manualEmitCount = count;
    slot.system.start();
    slot.active = true;
    slot.age = 0;
    this.spawnCount += 1;
  }

  update(deltaTime: number) {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(deltaTime, 0.05));
    const recycleAfter = this.config.droplets.maxLifetime + 0.16;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age < recycleAfter) continue;
      slot.system.stop();
      slot.system.reset();
      slot.active = false;
    }
  }

  get activeCount() {
    let count = 0;
    for (const slot of this.slots) if (slot.active) count += 1;
    return count;
  }

  get poolSize() {
    return this.slots.length;
  }

  get totalSpawned() {
    return this.spawnCount;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) slot.system.dispose(false);
    this.texture.dispose();
  }

  private acquireSlot() {
    for (let offset = 0; offset < this.slots.length; offset++) {
      const index = (this.cursor + offset) % this.slots.length;
      const slot = this.slots[index];
      if (!slot.active) {
        this.cursor = (index + 1) % this.slots.length;
        return slot;
      }
    }

    let oldest = this.slots[0];
    for (const slot of this.slots) if (slot.age > oldest.age) oldest = slot;
    this.cursor = (this.slots.indexOf(oldest) + 1) % this.slots.length;
    return oldest;
  }
}

export class WaterInteractionVFX {
  readonly ripples: WaterRippleEffectPool;
  readonly splashes: WaterSplashEffectPool;
  private disposed = false;

  constructor(
    scene: Scene,
    private readonly config: WaterContactEffectsConfig = WATER_CONTACT_EFFECTS_CONFIG
  ) {
    this.ripples = new WaterRippleEffectPool(scene, config);
    this.splashes = new WaterSplashEffectPool(scene, config);
  }

  spawnRipple(options: WaterRippleSpawnOptions) {
    this.ripples.spawn(options);
  }

  spawnEntrySplash(options: WaterSplashOptions) {
    this.splashes.spawn(options);
  }

  spawnStepSplash(options: WaterSplashOptions) {
    const automaticCount = Math.round(
      this.config.droplets.minCount +
        (this.config.droplets.maxCount - this.config.droplets.minCount) *
          clamp01(options.strength) * 0.62
    );
    this.splashes.spawn({ ...options, particleCount: options.particleCount ?? automaticCount });
  }

  spawnWaterDroplets(options: WaterSplashOptions) {
    this.splashes.spawn(options);
  }

  update(deltaTime: number) {
    if (this.disposed) return;
    this.ripples.update(deltaTime);
    this.splashes.update(deltaTime);
  }

  getDebugSnapshot(): WaterInteractionVFXDebugSnapshot {
    return {
      activeRipples: this.ripples.activeCount,
      ripplePoolSize: this.ripples.poolSize,
      activeSplashSystems: this.splashes.activeCount,
      splashPoolSize: this.splashes.poolSize,
      totalRipplesSpawned: this.ripples.totalSpawned,
      totalSplashesSpawned: this.splashes.totalSpawned,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ripples.dispose();
    this.splashes.dispose();
  }
}
