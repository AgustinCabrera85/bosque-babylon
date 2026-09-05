import type { Material } from "@babylonjs/core/Materials/material";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import {
  EnemyLifecycleState,
  type EnemyAssetInstance,
  type EnemyController,
  type EnemyControllerContext,
  type EnemySpawnOptions,
} from "./EnemyTypes";

export abstract class BaseEnemyController implements EnemyController {
  public readonly id: string;
  public readonly type: string;
  public readonly root: TransformNode;
  public readonly metadata: Readonly<Record<string, unknown>>;

  protected readonly asset: EnemyAssetInstance;
  private readonly requestedInitialEnabled: boolean;
  private readonly ownedMaterials = new Set<Material>();
  private currentLifecycleState = EnemyLifecycleState.Initializing;

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

    for (const node of this.asset.rootNodes) node.parent = this.root;
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

  public setEnabled(enabled: boolean) {
    if (this.currentLifecycleState === EnemyLifecycleState.Disposed) return;
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
}
