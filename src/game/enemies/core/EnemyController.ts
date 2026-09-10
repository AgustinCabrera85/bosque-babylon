import type { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import {
  EnemyLifecycleState,
  type EnemyAttackHit,
  type EnemyAssetInstance,
  type EnemyController,
  type EnemyControllerContext,
  type EnemySpawnOptions,
} from "./EnemyTypes";

const HIT_REACTION_SECONDS = 1.5;
const HIT_IRIDESCENCE_MAX_IOR = 2.8;
const HIT_SHAKE_AMPLITUDE = 0.13;
const HIT_EMISSIVE_COLOR = new Color3(0.24, 0.62, 1);

type PbrHitMaterialState = {
  material: PBRMaterial;
  iridescenceEnabled: boolean;
  iridescenceIntensity: number;
  iridescenceIor: number;
  minimumThickness: number;
  maximumThickness: number;
  emissiveColor: Color3;
  emissiveIntensity: number;
};

type StandardHitMaterialState = {
  material: StandardMaterial;
  emissiveColor: Color3;
};

type HitReactionState = {
  elapsed: number;
  direction: Vector3;
  pbrMaterials: PbrHitMaterialState[];
  standardMaterials: StandardHitMaterialState[];
};

export abstract class BaseEnemyController implements EnemyController {
  public readonly id: string;
  public readonly type: string;
  public readonly root: TransformNode;
  public readonly metadata: Readonly<Record<string, unknown>>;

  protected readonly asset: EnemyAssetInstance;
  protected readonly visualRoot: TransformNode;
  private readonly requestedInitialEnabled: boolean;
  private readonly ownedMaterials = new Set<Material>();
  private currentLifecycleState = EnemyLifecycleState.Initializing;
  private hitReaction: HitReactionState | null = null;

  protected constructor(context: EnemyControllerContext, options: EnemySpawnOptions) {
    this.id = options.id ?? options.type;
    this.type = options.type;
    this.asset = context.asset;
    this.metadata = { ...options.metadata };
    this.requestedInitialEnabled = options.enabled ?? true;

    this.root = new TransformNode(`enemy:${this.id}:root`, context.scene);
    this.root.metadata = {
      ...this.metadata,
      enemyId: this.id,
      enemyType: this.type,
    };
    this.root.position.copyFrom(options.position);
    if (options.rotation) this.root.rotation.copyFrom(options.rotation);
    if (options.scaling) this.root.scaling.copyFrom(options.scaling);

    this.visualRoot = new TransformNode(`enemy:${this.id}:visualRoot`, context.scene);
    this.visualRoot.parent = this.root;
    for (const node of this.asset.rootNodes) node.parent = this.visualRoot;
    for (const material of this.asset.materials) this.ownedMaterials.add(material);
    this.root.setEnabled(false);
  }

  public get enabled() {
    return (
      this.currentLifecycleState !== EnemyLifecycleState.Disposed &&
      this.root.isEnabled()
    );
  }

  public get lifecycleState() {
    return this.currentLifecycleState;
  }

  public abstract initialize(): Promise<void>;

  public abstract update(deltaTimeSeconds: number): void;

  public updateCombatEffects(deltaTimeSeconds: number) {
    const reaction = this.hitReaction;
    if (!reaction) return;

    reaction.elapsed = Math.min(
      HIT_REACTION_SECONDS,
      reaction.elapsed + Math.max(0, deltaTimeSeconds)
    );
    const progress = reaction.elapsed / HIT_REACTION_SECONDS;
    const iridescencePulse = Math.sin(progress * Math.PI);
    const shakeFade = 1 - progress;
    const shakeWave = Math.sin(reaction.elapsed * Math.PI * 38);
    const lateralX = Math.abs(reaction.direction.z) + 0.28;
    const lateralZ = -(reaction.direction.x + 0.16);
    this.visualRoot.position.set(
      lateralX * shakeWave * HIT_SHAKE_AMPLITUDE * shakeFade,
      Math.sin(reaction.elapsed * Math.PI * 54) * HIT_SHAKE_AMPLITUDE * 0.42 * shakeFade,
      lateralZ * shakeWave * HIT_SHAKE_AMPLITUDE * shakeFade
    );

    for (const state of reaction.pbrMaterials) {
      const iridescence = state.material.iridescence;
      iridescence.isEnabled = true;
      iridescence.intensity = Math.max(
        state.iridescenceIntensity,
        0.25 + iridescencePulse * 0.75
      );
      iridescence.indexOfRefraction =
        state.iridescenceIor +
        (Math.max(HIT_IRIDESCENCE_MAX_IOR, state.iridescenceIor) - state.iridescenceIor) *
          iridescencePulse;
      iridescence.minimumThickness = Math.min(state.minimumThickness, 120);
      iridescence.maximumThickness = Math.max(state.maximumThickness, 520);
      Color3.LerpToRef(
        state.emissiveColor,
        HIT_EMISSIVE_COLOR,
        iridescencePulse * 0.42,
        state.material.emissiveColor
      );
      state.material.emissiveIntensity =
        state.emissiveIntensity + iridescencePulse * 1.4;
    }

    for (const state of reaction.standardMaterials) {
      Color3.LerpToRef(
        state.emissiveColor,
        HIT_EMISSIVE_COLOR,
        iridescencePulse * 0.58,
        state.material.emissiveColor
      );
    }

    if (reaction.elapsed >= HIT_REACTION_SECONDS) this.finishHitReaction();
  }

  public getAttackHitMeshes() {
    return this.asset.meshes;
  }

  public getAttackTargetPositionToRef(result: Vector3) {
    let found = false;
    const minimum = new Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    const maximum = new Vector3(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY
    );

    for (const mesh of this.asset.meshes) {
      if (!mesh.isEnabled() || mesh.getTotalVertices() <= 0) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      minimum.copyFrom(Vector3.Minimize(minimum, box.minimumWorld));
      maximum.copyFrom(Vector3.Maximize(maximum, box.maximumWorld));
      found = true;
    }

    if (!found) {
      result.copyFrom(this.root.getAbsolutePosition());
      return false;
    }
    minimum.addToRef(maximum, result);
    result.scaleInPlace(0.5);
    return true;
  }

  public receiveAttack(hit: EnemyAttackHit) {
    if (!this.enabled || this.currentLifecycleState === EnemyLifecycleState.Disposed) return;

    if (!this.hitReaction) {
      const pbrMaterials: PbrHitMaterialState[] = [];
      const standardMaterials: StandardHitMaterialState[] = [];
      for (const material of this.asset.materials) {
        if (material instanceof PBRMaterial) {
          pbrMaterials.push({
            material,
            iridescenceEnabled: material.iridescence.isEnabled,
            iridescenceIntensity: material.iridescence.intensity,
            iridescenceIor: material.iridescence.indexOfRefraction,
            minimumThickness: material.iridescence.minimumThickness,
            maximumThickness: material.iridescence.maximumThickness,
            emissiveColor: material.emissiveColor.clone(),
            emissiveIntensity: material.emissiveIntensity,
          });
        } else if (material instanceof StandardMaterial) {
          standardMaterials.push({
            material,
            emissiveColor: material.emissiveColor.clone(),
          });
        }
      }
      this.hitReaction = {
        elapsed: 0,
        direction: hit.direction.clone(),
        pbrMaterials,
        standardMaterials,
      };
    } else {
      this.hitReaction.elapsed = 0;
      this.hitReaction.direction.copyFrom(hit.direction);
    }

    window.dispatchEvent(
      new CustomEvent("bosque:enemy-hit", {
        detail: { id: this.id, type: this.type, damage: hit.damage, point: hit.point.clone() },
      })
    );
  }

  public setEnabled(enabled: boolean) {
    if (this.currentLifecycleState === EnemyLifecycleState.Disposed) return;
    if (!enabled) this.finishHitReaction();
    this.root.setEnabled(enabled);
    if (this.currentLifecycleState !== EnemyLifecycleState.Initializing) {
      this.currentLifecycleState = enabled
        ? EnemyLifecycleState.Ready
        : EnemyLifecycleState.Disabled;
    }
  }

  public setPosition(position: Vector3) {
    if (this.currentLifecycleState === EnemyLifecycleState.Disposed) return;
    this.root.position.copyFrom(position);
  }

  public setRotation(rotation: Vector3) {
    if (this.currentLifecycleState === EnemyLifecycleState.Disposed) return;
    this.root.rotationQuaternion = null;
    this.root.rotation.copyFrom(rotation);
  }

  public setScaling(scaling: Vector3) {
    if (this.currentLifecycleState === EnemyLifecycleState.Disposed) return;
    this.root.scaling.copyFrom(scaling);
  }

  public dispose() {
    if (this.currentLifecycleState === EnemyLifecycleState.Disposed) return;
    this.currentLifecycleState = EnemyLifecycleState.Disposed;
    this.finishHitReaction();
    this.onDispose();

    for (const animationGroup of this.asset.animationGroups) {
      animationGroup.stop(true);
      animationGroup.dispose();
    }
    this.root.dispose(false, false);
    for (const skeleton of this.asset.skeletons) skeleton.dispose();
    for (const material of this.ownedMaterials) material.dispose(false, false);
    this.ownedMaterials.clear();
  }

  protected completeInitialization() {
    if (this.currentLifecycleState !== EnemyLifecycleState.Initializing) {
      throw new Error(`Enemy ${this.id}: initialize called in ${this.currentLifecycleState} state`);
    }
    this.currentLifecycleState = this.requestedInitialEnabled
      ? EnemyLifecycleState.Ready
      : EnemyLifecycleState.Disabled;
    this.root.setEnabled(this.requestedInitialEnabled);
  }

  protected ownMaterial<T extends Material>(material: T) {
    this.ownedMaterials.add(material);
    return material;
  }

  protected assertUsable() {
    if (this.currentLifecycleState === EnemyLifecycleState.Disposed) {
      throw new Error(`Enemy ${this.id}: controller is disposed`);
    }
  }

  protected onDispose() {}

  private finishHitReaction() {
    const reaction = this.hitReaction;
    if (!reaction) return;
    this.visualRoot.position.setAll(0);
    for (const state of reaction.pbrMaterials) {
      const iridescence = state.material.iridescence;
      iridescence.isEnabled = state.iridescenceEnabled;
      iridescence.intensity = state.iridescenceIntensity;
      iridescence.indexOfRefraction = state.iridescenceIor;
      iridescence.minimumThickness = state.minimumThickness;
      iridescence.maximumThickness = state.maximumThickness;
      state.material.emissiveColor.copyFrom(state.emissiveColor);
      state.material.emissiveIntensity = state.emissiveIntensity;
    }
    for (const state of reaction.standardMaterials) {
      state.material.emissiveColor.copyFrom(state.emissiveColor);
    }
    this.hitReaction = null;
  }
}
