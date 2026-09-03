import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Particle } from "@babylonjs/core/Particles/particle";
import type { ParticleSystemSet } from "@babylonjs/core/Particles/particleSystemSet";
import { ParticleInputBlock } from "@babylonjs/core/Particles/Node/Blocks/particleInputBlock.pure";
import { RegisterParticleConverterBlock } from "@babylonjs/core/Particles/Node/Blocks/particleConverterBlock.pure";
import { RegisterParticleGradientBlock } from "@babylonjs/core/Particles/Node/Blocks/particleGradientBlock.pure";
import { RegisterParticleGradientValueBlock } from "@babylonjs/core/Particles/Node/Blocks/particleGradientValueBlock.pure";
import { RegisterParticleInputBlock } from "@babylonjs/core/Particles/Node/Blocks/particleInputBlock.pure";
import { RegisterParticleMathBlock } from "@babylonjs/core/Particles/Node/Blocks/particleMathBlock.pure";
import { RegisterParticleRandomBlock } from "@babylonjs/core/Particles/Node/Blocks/particleRandomBlock.pure";
import { RegisterParticleSourceTextureBlock } from "@babylonjs/core/Particles/Node/Blocks/particleSourceTextureBlock.pure";
import { RegisterSystemBlock } from "@babylonjs/core/Particles/Node/Blocks/systemBlock.pure";
import { RegisterBoxShapeBlock } from "@babylonjs/core/Particles/Node/Blocks/Emitters/boxShapeBlock.pure";
import { RegisterCreateParticleBlock } from "@babylonjs/core/Particles/Node/Blocks/Emitters/createParticleBlock.pure";
import { RegisterSetupSpriteSheetBlock } from "@babylonjs/core/Particles/Node/Blocks/Emitters/setupSpriteSheetBlock.pure";
import { RegisterBasicSpriteUpdateBlock } from "@babylonjs/core/Particles/Node/Blocks/Update/basicSpriteUpdateBlock.pure";
import { RegisterUpdateAngleBlock } from "@babylonjs/core/Particles/Node/Blocks/Update/updateAngleBlock.pure";
import { RegisterUpdateColorBlock } from "@babylonjs/core/Particles/Node/Blocks/Update/updateColorBlock.pure";
import { RegisterUpdatePositionBlock } from "@babylonjs/core/Particles/Node/Blocks/Update/updatePositionBlock.pure";
import { RegisterUpdateSizeBlock } from "@babylonjs/core/Particles/Node/Blocks/Update/updateSizeBlock.pure";
import { NodeParticleSystemSet } from "@babylonjs/core/Particles/Node/nodeParticleSystemSet";
import { Scene } from "@babylonjs/core/scene";
import detachedShadowGraph from "../vfx/shadow/DetachedShadowFragments.npe.json";
import livingBlackFlamesGraph from "../vfx/shadow/LivingBlackFlames.npe.json";

RegisterSystemBlock();
RegisterCreateParticleBlock();
RegisterBoxShapeBlock();
RegisterSetupSpriteSheetBlock();
RegisterBasicSpriteUpdateBlock();
RegisterUpdateAngleBlock();
RegisterUpdateColorBlock();
RegisterUpdatePositionBlock();
RegisterUpdateSizeBlock();
RegisterParticleConverterBlock();
RegisterParticleGradientBlock();
RegisterParticleGradientValueBlock();
RegisterParticleInputBlock();
RegisterParticleMathBlock();
RegisterParticleRandomBlock();
RegisterParticleSourceTextureBlock();

export type LivingBlackFlameQuality = "low" | "medium" | "high";

export type LivingBlackFlameInput = {
  coverage: number;
  healthDamage: number;
  sanityDamage: number;
  chaos: number;
  deltaTime: number;
};

export type LivingBlackFlameTarget = {
  root: TransformNode;
  avatarMeshes: readonly AbstractMesh[];
  bodyMinY: number;
  bodyHeight: number;
  bodyRadius: number;
};

export type LivingBlackFlameMetrics = {
  ready: boolean;
  systemCount: number;
  coverage: number;
  chaos: number;
  emitRate: number;
  aliveFlames: number;
  aliveFragments: number;
  activeSystems: number;
  lod: FlameLod;
};

export const LIVING_BLACK_FLAME_NPE_TUNING = {
  flameCapacity: 24,
  fragmentCapacity: 6,
  minLifeTime: 0.45,
  maxLifeTime: 1.15,
  minEmitRate: 0,
  maxEmitRate: 22,
  nearDistance: 15,
  mediumDistance: 30,
  farDistance: 45,
  parameterDamping: 7,
} as const;

type FlameLod = "near" | "medium" | "far" | "off";

type FlameAnchorDefinition = {
  id: string;
  boneTokens: readonly string[];
  activationAt: number;
  fallbackX: number;
  fallbackHeight: number;
  fallbackZ: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
};

type RuntimeInputs = {
  minLifetime: ParticleInputBlock | null;
  maxLifetime: ParticleInputBlock | null;
  minScale: ParticleInputBlock | null;
  maxScale: ParticleInputBlock | null;
  minRotation: ParticleInputBlock | null;
  maxRotation: ParticleInputBlock | null;
  minAngularSpeed: ParticleInputBlock | null;
  maxAngularSpeed: ParticleInputBlock | null;
};

const FLAME_ANCHORS: readonly FlameAnchorDefinition[] = [
  {
    id: "leftFoot",
    boneTokens: ["leftfoot"],
    activationAt: 0.06,
    fallbackX: -0.42,
    fallbackHeight: 0.02,
    fallbackZ: -0.16,
    offsetX: -0.03,
    offsetY: 0.01,
    offsetZ: -0.1,
  },
  {
    id: "rightFoot",
    boneTokens: ["rightfoot"],
    activationAt: 0.1,
    fallbackX: 0.42,
    fallbackHeight: 0.02,
    fallbackZ: -0.16,
    offsetX: 0.03,
    offsetY: 0.01,
    offsetZ: -0.1,
  },
  {
    id: "leftCalf",
    boneTokens: ["leftleg"],
    activationAt: 0.34,
    fallbackX: -0.34,
    fallbackHeight: 0.27,
    fallbackZ: -0.16,
    offsetX: -0.025,
    offsetY: 0,
    offsetZ: -0.1,
  },
  {
    id: "rightCalf",
    boneTokens: ["rightleg"],
    activationAt: 0.4,
    fallbackX: 0.34,
    fallbackHeight: 0.27,
    fallbackZ: -0.16,
    offsetX: 0.025,
    offsetY: 0,
    offsetZ: -0.1,
  },
  {
    id: "hips",
    boneTokens: ["hips"],
    activationAt: 0.57,
    fallbackX: -0.08,
    fallbackHeight: 0.5,
    fallbackZ: -0.2,
    offsetX: -0.04,
    offsetY: 0,
    offsetZ: -0.12,
  },
  {
    id: "lowerSpine",
    boneTokens: ["spine"],
    activationAt: 0.66,
    fallbackX: 0.08,
    fallbackHeight: 0.62,
    fallbackZ: -0.2,
    offsetX: 0.035,
    offsetY: 0,
    offsetZ: -0.12,
  },
  {
    id: "upperSpine",
    boneTokens: ["spine2", "spine1"],
    activationAt: 0.76,
    fallbackX: 0,
    fallbackHeight: 0.76,
    fallbackZ: -0.18,
    offsetX: 0,
    offsetY: 0,
    offsetZ: -0.1,
  },
  {
    id: "leftArm",
    boneTokens: ["leftarm"],
    activationAt: 0.78,
    fallbackX: -0.55,
    fallbackHeight: 0.7,
    fallbackZ: -0.12,
    offsetX: -0.03,
    offsetY: 0,
    offsetZ: -0.08,
  },
  {
    id: "rightArm",
    boneTokens: ["rightarm"],
    activationAt: 0.8,
    fallbackX: 0.55,
    fallbackHeight: 0.7,
    fallbackZ: -0.12,
    offsetX: 0.03,
    offsetY: 0,
    offsetZ: -0.08,
  },
  {
    id: "leftShoulder",
    boneTokens: ["leftshoulder"],
    activationAt: 0.84,
    fallbackX: -0.48,
    fallbackHeight: 0.84,
    fallbackZ: -0.12,
    offsetX: -0.02,
    offsetY: 0,
    offsetZ: -0.07,
  },
  {
    id: "rightShoulder",
    boneTokens: ["rightshoulder"],
    activationAt: 0.88,
    fallbackX: 0.48,
    fallbackHeight: 0.84,
    fallbackZ: -0.12,
    offsetX: 0.02,
    offsetY: 0,
    offsetZ: -0.07,
  },
];

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function damp(current: number, target: number, lambda: number, deltaTime: number) {
  return target + (current - target) * Math.exp(-lambda * deltaTime);
}

function emitRateForCoverage(coverage: number) {
  if (coverage <= 0.02) return 0;
  if (coverage <= 0.25) return lerp(0, 5, coverage / 0.25);
  if (coverage <= 0.5) return lerp(5, 11, (coverage - 0.25) / 0.25);
  if (coverage <= 0.75) return lerp(11, 16, (coverage - 0.5) / 0.25);
  return lerp(16, LIVING_BLACK_FLAME_NPE_TUNING.maxEmitRate, (coverage - 0.75) / 0.25);
}

/**
 * Runtime bridge around two local Node Particle Editor graphs. NPE owns
 * creation/update/color/size/sprite behavior; this class supplies live body
 * anchors, stat-driven inputs, LOD, and deterministic resource cleanup.
 */
export class LivingBlackFlameNPE {
  private readonly root: TransformNode;
  private readonly avatarMeshes: readonly AbstractMesh[];
  private readonly bodyMinY: number;
  private readonly bodyHeight: number;
  private readonly bodyRadius: number;
  private readonly quality: LivingBlackFlameQuality;
  private readonly capacityScale: number;
  private readonly anchors: TransformNode[] = [];
  private readonly anchorWorldPositions: Vector3[] = [];
  private readonly minScaleValue = new Vector2();
  private readonly maxScaleValue = new Vector2();

  private flameNodeSet: NodeParticleSystemSet | null = null;
  private fragmentNodeSet: NodeParticleSystemSet | null = null;
  private flameSet: ParticleSystemSet | null = null;
  private fragmentSet: ParticleSystemSet | null = null;
  private flameSystem: ParticleSystem | null = null;
  private fragmentSystem: ParticleSystem | null = null;
  private flameInputs: RuntimeInputs | null = null;
  private fragmentInputs: RuntimeInputs | null = null;
  private activeAnchorCount = 2;
  private visualCoverage = 0;
  private visualChaos = 0;
  private visualHealthDamage = 0;
  private flameEmitRate = 0;
  private fragmentEmitRate = 0;
  private elapsed = 0;
  private lastDeltaTime = 1 / 60;
  private lod: FlameLod = "near";
  private ready = false;
  private disposed = false;

  constructor(
    scene: Scene,
    target: LivingBlackFlameTarget,
    quality: LivingBlackFlameQuality,
    maxFlames: number = LIVING_BLACK_FLAME_NPE_TUNING.flameCapacity
  ) {
    this.root = target.root;
    this.avatarMeshes = target.avatarMeshes;
    this.bodyMinY = target.bodyMinY;
    this.bodyHeight = target.bodyHeight;
    this.bodyRadius = target.bodyRadius;
    this.quality = quality;
    this.capacityScale = clamp01(maxFlames / LIVING_BLACK_FLAME_NPE_TUNING.flameCapacity);
    this.createAnchors(scene);
    void this.initialize(scene);
  }

  update(input: LivingBlackFlameInput) {
    if (this.disposed) return;

    const dt = Math.min(0.1, Math.max(0, input.deltaTime));
    const damping = LIVING_BLACK_FLAME_NPE_TUNING.parameterDamping;
    this.lastDeltaTime = dt;
    this.elapsed += dt;
    this.visualCoverage = damp(this.visualCoverage, clamp01(input.coverage), damping, dt);
    this.visualChaos = damp(this.visualChaos, clamp01(input.chaos), damping, dt);
    this.visualHealthDamage = damp(this.visualHealthDamage, clamp01(input.healthDamage), damping, dt);
    this.lod = this.getLod();
    if (this.lod === "near" || this.lod === "medium") this.updateAnchorPositions();
    this.updateActiveAnchorCount();

    if (!this.ready) return;
    this.updateFlameParameters();
    this.updateFragmentParameters(clamp01(input.sanityDamage));
  }

  hide() {
    this.flameEmitRate = 0;
    this.fragmentEmitRate = 0;
    this.stopAndClear(this.flameSystem);
    this.stopAndClear(this.fragmentSystem);
  }

  getMetrics(): LivingBlackFlameMetrics {
    return {
      ready: this.ready,
      systemCount: Number(!!this.flameSystem) + Number(!!this.fragmentSystem),
      coverage: this.visualCoverage,
      chaos: this.visualChaos,
      emitRate: this.flameEmitRate,
      aliveFlames: this.flameSystem?.getActiveCount() ?? 0,
      aliveFragments: this.fragmentSystem?.getActiveCount() ?? 0,
      activeSystems:
        Number(this.flameSystem?.isStarted() ?? false) + Number(this.fragmentSystem?.isStarted() ?? false),
      lod: this.lod,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    // SystemBlock owns the ParticleSystem it built and releases it from the
    // node-set disposal observable. Only fall back to disposing the built set
    // when initialization stopped before the owning node set was retained.
    if (this.flameNodeSet) this.flameNodeSet.dispose();
    else this.flameSet?.dispose();
    if (this.fragmentNodeSet) this.fragmentNodeSet.dispose();
    else this.fragmentSet?.dispose();
    this.flameNodeSet = null;
    this.fragmentNodeSet = null;
    this.flameSet = null;
    this.fragmentSet = null;
    this.flameSystem = null;
    this.fragmentSystem = null;
    for (const anchor of this.anchors) anchor.dispose(false, false);
    this.anchors.length = 0;
    this.anchorWorldPositions.length = 0;
  }

  private async initialize(scene: Scene) {
    try {
      const flameNodeSet = NodeParticleSystemSet.Parse(livingBlackFlamesGraph);
      const fragmentNodeSet = NodeParticleSystemSet.Parse(detachedShadowGraph);
      const [flameSet, fragmentSet] = await Promise.all([
        flameNodeSet.buildAsync(scene),
        fragmentNodeSet.buildAsync(scene),
      ]);

      if (this.disposed) {
        flameNodeSet.dispose();
        fragmentNodeSet.dispose();
        return;
      }

      const flameSystem = flameSet.systems[0];
      const fragmentSystem = fragmentSet.systems[0];
      this.flameNodeSet = flameNodeSet;
      this.fragmentNodeSet = fragmentNodeSet;
      this.flameSet = flameSet;
      this.fragmentSet = fragmentSet;
      if (!(flameSystem instanceof ParticleSystem) || !(fragmentSystem instanceof ParticleSystem)) {
        throw new Error("Living shadow NPE graphs did not build CPU ParticleSystem instances.");
      }

      this.flameSystem = flameSystem;
      this.fragmentSystem = fragmentSystem;
      this.flameInputs = this.captureInputs(flameNodeSet);
      this.fragmentInputs = this.captureInputs(fragmentNodeSet);
      this.configureSystem(flameSystem);
      this.configureSystem(fragmentSystem);
      this.configureFlameSpawn(flameSystem);
      this.configureFragmentSpawn(fragmentSystem);
      this.addTurbulence(flameSystem, 1);
      this.addTurbulence(fragmentSystem, 1.65);
      this.setEmitRate(flameNodeSet, flameSystem, 0);
      this.setEmitRate(fragmentNodeSet, fragmentSystem, 0);
      this.ready = true;
    } catch (error) {
      console.error("Could not initialize local Living Black Flame NPE graphs", error);
      this.dispose();
    }
  }

  private configureSystem(system: ParticleSystem) {
    system.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    system.forceDepthWrite = false;
    system.isLocal = false;
    system.isBillboardBased = true;
    system.billboardMode = ParticleSystem.BILLBOARDMODE_ALL;
    system.renderingGroupId = 0;
    system.disposeOnStop = false;
    system.emitter = Vector3.Zero();
    if (system.particleTexture) {
      system.particleTexture.hasAlpha = true;
      system.particleTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
      system.particleTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    }
  }

  private configureFlameSpawn(system: ParticleSystem) {
    system.startPositionFunction = (_worldMatrix, positionToUpdate) => {
      const count = Math.max(1, Math.min(this.activeAnchorCount, this.anchorWorldPositions.length));
      let index = Math.floor(Math.random() * count);
      if (this.visualChaos > 0.45 && Math.random() < this.visualChaos * 0.3) {
        const asymmetricSide = Math.sin(this.elapsed * 0.73) < 0 ? 0 : 1;
        index = Math.min(count - 1, asymmetricSide + Math.floor(Math.random() * Math.ceil(count / 2)) * 2);
      }
      const anchorPosition = this.anchorWorldPositions[index];
      const jitter = this.bodyRadius * (0.05 + this.visualChaos * 0.09);
      positionToUpdate.set(
        anchorPosition.x + (Math.random() - 0.5) * jitter,
        anchorPosition.y + Math.random() * this.bodyHeight * 0.025,
        anchorPosition.z + (Math.random() - 0.5) * jitter
      );
    };
    system.startDirectionFunction = (_worldMatrix, directionToUpdate) => {
      const lateral = 0.045 + this.visualChaos * 0.24;
      directionToUpdate.set(
        (Math.random() - 0.5) * lateral,
        0.15 + Math.random() * (0.18 + this.visualCoverage * 0.12),
        (Math.random() - 0.5) * lateral
      );
    };
  }

  private configureFragmentSpawn(system: ParticleSystem) {
    system.startPositionFunction = (_worldMatrix, positionToUpdate) => {
      // Sanity fragments are independent of health coverage and always detach
      // from upper-spine, arm, or shoulder anchors rather than from the feet.
      const firstUpperAnchor = 6;
      const count = this.anchorWorldPositions.length - firstUpperAnchor;
      const index = firstUpperAnchor + Math.floor(Math.random() * count);
      const anchorPosition = this.anchorWorldPositions[Math.min(index, this.anchorWorldPositions.length - 1)];
      positionToUpdate.set(
        anchorPosition.x + (Math.random() - 0.5) * this.bodyRadius * 0.18,
        anchorPosition.y,
        anchorPosition.z + (Math.random() - 0.5) * this.bodyRadius * 0.14
      );
    };
    system.startDirectionFunction = (_worldMatrix, directionToUpdate) => {
      const side = Math.random() < 0.5 ? -1 : 1;
      directionToUpdate.set(
        side * (0.28 + Math.random() * 0.35),
        0.18 + Math.random() * 0.28,
        (Math.random() - 0.5) * 0.32
      );
    };
  }

  private addTurbulence(system: ParticleSystem, strengthMultiplier: number) {
    const npeUpdate = system.updateFunction.bind(system);
    system.updateFunction = (particles: Particle[]) => {
      const chaos = this.visualChaos;
      if (chaos > 0.01) {
        const strength = chaos * chaos * this.lastDeltaTime * 0.34 * strengthMultiplier;
        for (let index = 0; index < particles.length; index++) {
          const particle = particles[index];
          const phase = particle.id * 1.618 + this.elapsed * (2.1 + chaos * 2.7);
          particle.direction.x += Math.sin(phase) * strength;
          particle.direction.z += Math.cos(phase * 0.73) * strength * 0.78;
        }
      }
      npeUpdate(particles);
    };
  }

  private updateFlameParameters() {
    if (!this.flameNodeSet || !this.flameSystem || !this.flameInputs) return;

    const lodMultiplier = this.lod === "near" ? 1 : this.lod === "medium" ? 0.32 : 0;
    const qualityMultiplier = this.quality === "low" ? 0.66 : this.quality === "medium" ? 0.84 : 1;
    const targetEmitRate = emitRateForCoverage(this.visualCoverage) * lodMultiplier * qualityMultiplier * this.capacityScale;
    this.flameEmitRate = damp(
      this.flameEmitRate,
      targetEmitRate,
      LIVING_BLACK_FLAME_NPE_TUNING.parameterDamping,
      this.lastDeltaTime
    );
    this.setEmitRate(this.flameNodeSet, this.flameSystem, this.flameEmitRate);

    const chaos = this.visualChaos;
    const coverage = this.visualCoverage;
    this.setNumberInput(this.flameInputs.minLifetime, 0.62 - chaos * 0.17);
    this.setNumberInput(this.flameInputs.maxLifetime, 0.85 + chaos * 0.3);
    const sizeMultiplier = 0.72 + coverage * 0.28;
    this.setVector2Input(
      this.flameInputs.minScale,
      this.minScaleValue.set((0.64 - chaos * 0.08) * sizeMultiplier, (1.12 + coverage * 0.16) * sizeMultiplier)
    );
    this.setVector2Input(
      this.flameInputs.maxScale,
      this.maxScaleValue.set(
        (0.78 + coverage * 0.14 + chaos * 0.07) * sizeMultiplier,
        (1.35 + coverage * 0.43 + chaos * 0.16) * sizeMultiplier
      )
    );
    const rotation = Math.PI * lerp(8 / 180, 18 / 180, chaos);
    const angularSpeed = lerp(0.045, 0.32, chaos);
    this.setNumberInput(this.flameInputs.minRotation, -rotation);
    this.setNumberInput(this.flameInputs.maxRotation, rotation);
    this.setNumberInput(this.flameInputs.minAngularSpeed, -angularSpeed);
    this.setNumberInput(this.flameInputs.maxAngularSpeed, angularSpeed);

    this.updateRunState(this.flameSystem, this.flameEmitRate);
  }

  private updateFragmentParameters(sanityDamage: number) {
    if (!this.fragmentNodeSet || !this.fragmentSystem || !this.fragmentInputs) return;

    const active = this.lod === "near" && sanityDamage > 0.56 && this.visualCoverage > 0.18;
    const targetRate = active ? clamp01((sanityDamage - 0.56) / 0.44) * 4.8 : 0;
    this.fragmentEmitRate = damp(
      this.fragmentEmitRate,
      targetRate,
      LIVING_BLACK_FLAME_NPE_TUNING.parameterDamping,
      this.lastDeltaTime
    );
    this.setEmitRate(this.fragmentNodeSet, this.fragmentSystem, this.fragmentEmitRate);
    this.setNumberInput(this.fragmentInputs.minLifetime, 0.72 - this.visualChaos * 0.07);
    this.setNumberInput(this.fragmentInputs.maxLifetime, 0.88 + this.visualChaos * 0.27);
    const rotation = Math.PI * lerp(10 / 180, 24 / 180, this.visualChaos);
    this.setNumberInput(this.fragmentInputs.minRotation, -rotation);
    this.setNumberInput(this.fragmentInputs.maxRotation, rotation);
    this.setNumberInput(this.fragmentInputs.minAngularSpeed, -0.18 - this.visualChaos * 0.22);
    this.setNumberInput(this.fragmentInputs.maxAngularSpeed, 0.18 + this.visualChaos * 0.22);
    this.updateRunState(this.fragmentSystem, this.fragmentEmitRate);
  }

  private setEmitRate(nodeSet: NodeParticleSystemSet, system: ParticleSystem, rate: number) {
    const systemBlock = nodeSet.systemBlocks[0];
    systemBlock.emitRate.value = Math.max(0, Math.min(LIVING_BLACK_FLAME_NPE_TUNING.maxEmitRate, rate));
    system.emitRate = systemBlock.emitRate.value;
  }

  private captureInputs(nodeSet: NodeParticleSystemSet): RuntimeInputs {
    const find = (name: string) =>
      nodeSet.getInputBlockByPredicate((block) => block.name === name) ?? null;
    return {
      minLifetime: find("Min Lifetime"),
      maxLifetime: find("Max Lifetime"),
      minScale: find("Min Scale"),
      maxScale: find("Max Scale"),
      minRotation: find("Min Rotation"),
      maxRotation: find("Max Rotation"),
      minAngularSpeed: find("Min Angular Speed"),
      maxAngularSpeed: find("Max Angular Speed"),
    };
  }

  private setNumberInput(block: ParticleInputBlock | null, value: number) {
    if (block) block.value = value;
  }

  private setVector2Input(block: ParticleInputBlock | null, value: Vector2) {
    if (!block) return;
    const stored = block.value;
    if (stored instanceof Vector2) stored.copyFrom(value);
    else block.value = value.clone();
  }

  private updateActiveAnchorCount() {
    let count = 2;
    for (let index = 2; index < FLAME_ANCHORS.length; index++) {
      if (this.visualHealthDamage >= FLAME_ANCHORS[index].activationAt) count = index + 1;
    }
    this.activeAnchorCount = count;
  }

  private updateAnchorPositions() {
    for (let index = 0; index < this.anchors.length; index++) {
      this.anchors[index].computeWorldMatrix(true).getTranslationToRef(this.anchorWorldPositions[index]);
    }
  }

  private createAnchors(scene: Scene) {
    const skeletalMesh = this.getSkeletalMesh();
    for (const definition of FLAME_ANCHORS) {
      const anchor = new TransformNode(`livingBlackFlameNpeAnchor_${definition.id}`, scene);
      const bone = skeletalMesh?.skeleton?.bones.find((candidate) => {
        const normalizedName = candidate.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return definition.boneTokens.some((token) => normalizedName.endsWith(token));
      });

      if (bone && skeletalMesh) {
        anchor.attachToBone(bone, skeletalMesh);
        anchor.position.set(
          definition.offsetX * this.bodyRadius,
          definition.offsetY * this.bodyHeight,
          definition.offsetZ * this.bodyRadius
        );
      } else {
        anchor.parent = this.root;
        anchor.position.set(
          definition.fallbackX * this.bodyRadius,
          this.bodyMinY + this.bodyHeight * definition.fallbackHeight,
          definition.fallbackZ * this.bodyRadius
        );
      }
      this.anchors.push(anchor);
      this.anchorWorldPositions.push(new Vector3());
    }
    this.updateAnchorPositions();
  }

  private getSkeletalMesh() {
    return this.avatarMeshes.find((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.skeleton !== null) ?? null;
  }

  private getLod(): FlameLod {
    const camera = this.root.getScene().activeCamera;
    if (!camera) return "near";
    const cameraPosition = camera.globalPosition;
    const rootPosition = this.root.getAbsolutePosition();
    const dx = cameraPosition.x - rootPosition.x;
    const dy = cameraPosition.y - rootPosition.y;
    const dz = cameraPosition.z - rootPosition.z;
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    if (distanceSquared <= LIVING_BLACK_FLAME_NPE_TUNING.nearDistance ** 2) return "near";
    if (distanceSquared <= LIVING_BLACK_FLAME_NPE_TUNING.mediumDistance ** 2) return "medium";
    if (distanceSquared <= LIVING_BLACK_FLAME_NPE_TUNING.farDistance ** 2) return "far";
    return "off";
  }

  private stopAndClear(system: ParticleSystem | null) {
    if (!system) return;
    system.stop();
    system.reset();
  }

  private updateRunState(system: ParticleSystem, emitRate: number) {
    if (emitRate > 0.02) {
      if (!system.isStarted()) system.start();
      return;
    }
    if (emitRate < 0.005 && system.getActiveCount() === 0 && system.isStarted()) system.stop();
  }
}
