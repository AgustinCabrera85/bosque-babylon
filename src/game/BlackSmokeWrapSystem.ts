import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Node } from "@babylonjs/core/node";
import type { Particle } from "@babylonjs/core/Particles/particle";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

const TAU = Math.PI * 2;
const LOCAL_ORBIT_AXIS = new Vector3(0, 1, 0);
// Charcoal rather than absolute black: this remains visibly smoky against the
// near-black night sky while still darkening any asset it passes in front of.
const DEFAULT_COLOR = new Color3(0.085, 0.09, 0.105);
const MIN_AXIS_LENGTH_SQUARED = 0.000001;

export type BlackSmokeQuality = "low" | "medium" | "high";

type QualityPreset = {
  capacity: number;
  emitRate: number;
  preWarmCycles: number;
};

const QUALITY_PRESETS: Record<BlackSmokeQuality, QualityPreset> = {
  low: { capacity: 12, emitRate: 5.5, preWarmCycles: 10 },
  medium: { capacity: 20, emitRate: 8.5, preWarmCycles: 14 },
  high: { capacity: 32, emitRate: 13.5, preWarmCycles: 18 },
};

export type BlackSmokeWrapOptions = {
  name?: string;
  quality?: BlackSmokeQuality;
  /** Local offset from the selected asset. */
  offset?: Vector3;
  /** Euler orientation of the local Y orbit axis. */
  rotation?: Vector3;
  /** Takes priority over `rotation` and `axis` when supplied. */
  rotationQuaternion?: Quaternion;
  /** Convenience orientation: aligns the local Y orbit axis to this vector. */
  axis?: Vector3;
  radiusX?: number;
  radiusZ?: number;
  /** 0 fills the center; values near 1 create a hollow smoke ring. */
  innerRadiusRatio?: number;
  height?: number;
  particleSize?: number;
  /** Stretches each smoke card into a wisp while preserving random rotation. */
  elongation?: number;
  orbitSpeed?: number;
  upwardDrift?: number;
  density?: number;
  opacity?: number;
  color?: Color3;
  renderingGroupId?: number;
  layerMask?: number;
  /** Enable only when the wrapped asset should fade into scene fog. */
  applyFog?: boolean;
  enabled?: boolean;
};

type ResolvedOptions = {
  quality: BlackSmokeQuality;
  radiusX: number;
  radiusZ: number;
  innerRadiusRatio: number;
  height: number;
  particleSize: number;
  elongation: number;
  orbitSpeed: number;
  upwardDrift: number;
  density: number;
  opacity: number;
  color: Color3;
  renderingGroupId: number;
  layerMask: number;
  applyFog: boolean;
};

type SmokeParticleState = {
  phase: number;
  angularVelocity: number;
  radiusScale: number;
  baseHeight: number;
  wobblePhase: number;
  wobbleSpeed: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function positive(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(0.01, value!) : fallback;
}

function resolveOptions(
  target: TransformNode,
  options: BlackSmokeWrapOptions,
  defaultQuality: BlackSmokeQuality
): ResolvedOptions {
  const quality = options.quality ?? defaultQuality;
  return {
    quality,
    radiusX: positive(options.radiusX, 1.05),
    radiusZ: positive(options.radiusZ, 0.82),
    innerRadiusRatio: clamp(options.innerRadiusRatio ?? 0.68, 0, 0.96),
    height: positive(options.height, 2.1),
    particleSize: positive(options.particleSize, 0.86),
    elongation: clamp(options.elongation ?? 1, 0.5, 3),
    orbitSpeed: clamp(options.orbitSpeed ?? 0.72, -4, 4),
    upwardDrift: clamp(options.upwardDrift ?? 0.28, -2, 2),
    density: clamp(options.density ?? 1, 0.2, 2),
    opacity: clamp(options.opacity ?? 0.56, 0.02, 0.9),
    color: options.color?.clone() ?? DEFAULT_COLOR.clone(),
    renderingGroupId: Math.max(0, Math.floor(options.renderingGroupId ?? 0)),
    layerMask:
      options.layerMask ??
      (target instanceof AbstractMesh ? target.layerMask : 0x0fffffff),
    applyFog: options.applyFog === true,
  };
}

/**
 * One low-cost smoke envelope attached to a selected asset.
 *
 * Local Y is the orbit axis. Configure it with `rotation`,
 * `rotationQuaternion`, or `axis`; the quaternion has highest priority.
 */
export class BlackSmokeWrapEffect {
  public readonly anchor: Mesh;
  public readonly particles: ParticleSystem;

  private readonly localPosition = Vector3.Zero();
  private readonly normalizedAxis = Vector3.Up();
  private readonly options: ResolvedOptions;
  private readonly baseEmitRate: number;
  private targetDisposeObserver: Observer<Node> | null = null;
  private disposed = false;
  private enabled: boolean;

  public constructor(
    private readonly scene: Scene,
    public readonly target: TransformNode,
    texture: Texture,
    options: BlackSmokeWrapOptions,
    defaultQuality: BlackSmokeQuality,
    onDispose: (effect: BlackSmokeWrapEffect) => void
  ) {
    this.options = resolveOptions(target, options, defaultQuality);
    const preset = QUALITY_PRESETS[this.options.quality];
    const name = options.name ?? `${target.name}:blackSmoke`;

    this.anchor = new Mesh(`${name}:anchor`, scene);
    this.anchor.parent = target;
    this.anchor.position.copyFrom(options.offset ?? Vector3.ZeroReadOnly);
    this.applyInitialOrientation(options);
    this.anchor.computeWorldMatrix(true);

    this.particles = new ParticleSystem(
      `${name}:particles`,
      preset.capacity,
      scene
    );
    this.particles.emitter = this.anchor;
    this.particles.particleTexture = texture;
    this.particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.particles.billboardMode = ParticleSystem.BILLBOARDMODE_ALL;
    this.particles.isBillboardBased = true;
    this.particles.isLocal = false;
    this.particles.forceDepthWrite = false;
    this.particles.applyFog = this.options.applyFog;
    this.particles.renderingGroupId = this.options.renderingGroupId;
    this.particles.layerMask = this.options.layerMask;
    this.particles.disposeOnStop = false;
    this.particles.minLifeTime = 2.35;
    this.particles.maxLifeTime = 3.75;
    this.particles.minSize = this.options.particleSize * 0.72;
    this.particles.maxSize = this.options.particleSize * 1.32;
    this.particles.minScaleX = 0.5;
    this.particles.maxScaleX = 1.05;
    this.particles.minScaleY = 0.85 * this.options.elongation;
    this.particles.maxScaleY = 1.25 * this.options.elongation;
    this.particles.minAngularSpeed = -0.34;
    this.particles.maxAngularSpeed = 0.34;
    this.baseEmitRate = preset.emitRate * this.options.density;
    this.particles.emitRate = this.baseEmitRate;
    this.particles.updateSpeed = 0.016;
    this.particles.preWarmCycles = preset.preWarmCycles;
    this.particles.preWarmStepOffset = 1;
    this.particles.startDirectionFunction = (_matrix, direction) => {
      direction.setAll(0);
    };
    this.particles.startPositionFunction = (
      worldMatrix,
      position,
      particle
    ) => {
      const state: SmokeParticleState = {
        phase: Math.random() * TAU,
        angularVelocity:
          this.options.orbitSpeed * (0.76 + Math.random() * 0.46),
        radiusScale:
          this.options.innerRadiusRatio +
          Math.random() * (1.1 - this.options.innerRadiusRatio),
        baseHeight: (Math.random() - 0.5) * this.options.height,
        wobblePhase: Math.random() * TAU,
        wobbleSpeed: 0.65 + Math.random() * 0.9,
      };
      particle.metadata = state;
      this.writeParticlePosition(particle, state, worldMatrix);
      position.copyFrom(particle.position);
    };
    this.addAppearanceGradients();
    this.installOrbitUpdate();

    this.enabled = options.enabled !== false;
    if (this.enabled) this.particles.start();
    this.targetDisposeObserver = target.onDisposeObservable.addOnce(() => {
      this.dispose();
    });
    this.onDispose = onDispose;
  }

  private readonly onDispose: (effect: BlackSmokeWrapEffect) => void;

  public get isEnabled() {
    return this.enabled;
  }

  public get activeParticleCount() {
    return this.particles.getActiveCount();
  }

  public get capacity() {
    return this.particles.getCapacity();
  }

  public setEnabled(enabled: boolean) {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.particles.start();
      return;
    }
    this.particles.stop();
    this.particles.reset();
  }

  public setEmissionMultiplier(multiplier: number) {
    if (this.disposed) return;
    this.particles.emitRate = this.baseEmitRate * clamp(multiplier, 0, 3);
  }

  public emitBurst(count: number) {
    if (this.disposed || !this.enabled) return;
    this.particles.manualEmitCount = Math.max(0, Math.floor(count));
  }

  public setOffset(offset: Vector3) {
    if (this.disposed) return;
    this.anchor.position.copyFrom(offset);
  }

  public setOrientationEuler(rotation: Vector3) {
    if (this.disposed) return;
    this.anchor.rotationQuaternion = null;
    this.anchor.rotation.copyFrom(rotation);
  }

  public setOrientationQuaternion(rotation: Quaternion) {
    if (this.disposed) return;
    this.anchor.rotation.setAll(0);
    this.anchor.rotationQuaternion ??= Quaternion.Identity();
    this.anchor.rotationQuaternion.copyFrom(rotation);
  }

  /** Aligns the smoke's local Y orbit axis to an arbitrary local direction. */
  public setAxis(axis: Vector3) {
    if (this.disposed) return;
    this.normalizedAxis.copyFrom(axis);
    if (this.normalizedAxis.lengthSquared() < MIN_AXIS_LENGTH_SQUARED) {
      this.normalizedAxis.copyFrom(LOCAL_ORBIT_AXIS);
    } else {
      this.normalizedAxis.normalize();
    }
    this.anchor.rotation.setAll(0);
    this.anchor.rotationQuaternion ??= Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(
      LOCAL_ORBIT_AXIS,
      this.normalizedAxis,
      this.anchor.rotationQuaternion
    );
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.targetDisposeObserver) {
      this.target.onDisposeObservable.remove(this.targetDisposeObserver);
      this.targetDisposeObserver = null;
    }
    this.particles.stop();
    this.particles.reset();
    // The 64x64 smoke texture is shared and owned by BlackSmokeWrapSystem.
    this.particles.dispose(false);
    this.anchor.dispose(false, false);
    this.onDispose(this);
  }

  private applyInitialOrientation(options: BlackSmokeWrapOptions) {
    if (options.rotationQuaternion) {
      this.setOrientationQuaternion(options.rotationQuaternion);
      return;
    }
    if (options.rotation) {
      this.setOrientationEuler(options.rotation);
      return;
    }
    if (options.axis) this.setAxis(options.axis);
  }

  private addAppearanceGradients() {
    const { color, opacity } = this.options;
    const smokeColor = (alpha: number) =>
      new Color4(color.r, color.g, color.b, opacity * alpha);
    this.particles.addColorGradient(0, smokeColor(0));
    this.particles.addColorGradient(0.12, smokeColor(0.72), smokeColor(0.9));
    this.particles.addColorGradient(0.52, smokeColor(0.9), smokeColor(1));
    this.particles.addColorGradient(0.82, smokeColor(0.58), smokeColor(0.72));
    this.particles.addColorGradient(1, smokeColor(0));
    const size = this.options.particleSize;
    this.particles.addSizeGradient(0, size * 0.62, size * 0.78);
    this.particles.addSizeGradient(0.38, size * 0.94, size * 1.08);
    this.particles.addSizeGradient(0.76, size * 1.12, size * 1.32);
    this.particles.addSizeGradient(1, size * 1.28, size * 1.48);
  }

  private installOrbitUpdate() {
    const defaultUpdate = this.particles.updateFunction.bind(this.particles);
    this.particles.updateFunction = (particles: Particle[]) => {
      defaultUpdate(particles);
      const deltaSeconds = Math.min(
        0.05,
        Math.max(0, this.scene.getEngine().getDeltaTime() / 1000)
      );
      const worldMatrix = this.anchor.computeWorldMatrix(true);
      for (let index = 0; index < particles.length; index++) {
        const particle = particles[index];
        const state = particle.metadata as SmokeParticleState | null;
        if (!state) continue;
        state.phase = (state.phase + state.angularVelocity * deltaSeconds) % TAU;
        this.writeParticlePosition(particle, state, worldMatrix);
      }
    };
  }

  private writeParticlePosition(
    particle: Particle,
    state: SmokeParticleState,
    worldMatrix: Matrix
  ) {
    const ageRatio = particle.lifeTime > 0 ? particle.age / particle.lifeTime : 0;
    const wobble = Math.sin(
      state.wobblePhase + state.phase * state.wobbleSpeed
    );
    const radiusPulse = state.radiusScale * (1 + wobble * 0.11);
    this.localPosition.set(
      Math.cos(state.phase) * this.options.radiusX * radiusPulse,
      state.baseHeight +
        this.options.upwardDrift * ageRatio +
        wobble * this.options.height * 0.055,
      Math.sin(state.phase) * this.options.radiusZ * radiusPulse
    );
    Vector3.TransformCoordinatesToRef(
      this.localPosition,
      worldMatrix,
      particle.position
    );
  }
}

/**
 * Owns a shared procedural texture and creates smoke envelopes for any chosen
 * TransformNode. No resources are allocated until the first effect is attached.
 *
 * @example
 * system.attach(assetRoot, {
 *   axis: new Vector3(0, 1, 0),
 *   radiusX: 1.4,
 *   radiusZ: 1,
 *   height: 2.5,
 *   particleSize: 0.9,
 * });
 */
export class BlackSmokeWrapSystem {
  private readonly effects = new Set<BlackSmokeWrapEffect>();
  private texture: DynamicTexture | null = null;
  private disposed = false;

  public constructor(
    private readonly scene: Scene,
    private readonly defaultQuality: BlackSmokeQuality = "medium"
  ) {}

  public attach(
    target: TransformNode,
    options: BlackSmokeWrapOptions = {}
  ) {
    if (this.disposed) {
      throw new Error("Cannot attach black smoke after the system was disposed.");
    }
    const effect = new BlackSmokeWrapEffect(
      this.scene,
      target,
      this.getTexture(),
      options,
      this.defaultQuality,
      (disposedEffect) => this.effects.delete(disposedEffect)
    );
    this.effects.add(effect);
    return effect;
  }

  public detach(target: TransformNode) {
    for (const effect of [...this.effects]) {
      if (effect.target === target) effect.dispose();
    }
  }

  public setEnabled(enabled: boolean) {
    for (const effect of this.effects) effect.setEnabled(enabled);
  }

  public get activeEffectCount() {
    return this.effects.size;
  }

  public get activeParticleCount() {
    let total = 0;
    for (const effect of this.effects) total += effect.activeParticleCount;
    return total;
  }

  public get particleCapacity() {
    let total = 0;
    for (const effect of this.effects) total += effect.capacity;
    return total;
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const effect of [...this.effects]) effect.dispose();
    this.effects.clear();
    this.texture?.dispose();
    this.texture = null;
  }

  private getTexture() {
    this.texture ??= createSmokeTexture(this.scene);
    return this.texture;
  }
}

function createSmokeTexture(scene: Scene) {
  const size = 64;
  const texture = new DynamicTexture(
    "blackSmokeWrap:sharedTexture",
    { width: size, height: size },
    scene,
    false
  );
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 1;
  const context = texture.getContext();
  context.clearRect(0, 0, size, size);

  const drawLobe = (
    x: number,
    y: number,
    radius: number,
    alpha: number
  ) => {
    const gradient = context.createRadialGradient(x, y, 1, x, y, radius);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    gradient.addColorStop(0.46, `rgba(255, 255, 255, ${alpha * 0.72})`);
    gradient.addColorStop(0.78, `rgba(255, 255, 255, ${alpha * 0.22})`);
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };

  drawLobe(32, 33, 29, 0.72);
  drawLobe(22, 25, 18, 0.34);
  drawLobe(43, 27, 17, 0.3);
  drawLobe(19, 42, 15, 0.24);
  drawLobe(43, 43, 18, 0.3);
  drawLobe(32, 18, 13, 0.22);
  texture.update(false);
  return texture;
}
