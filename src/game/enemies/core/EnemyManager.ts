import "@babylonjs/loaders/glTF";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { EnemyLifecycleState } from "./EnemyTypes";
import type {
  EnemyAssetInstance,
  EnemyController,
  EnemyId,
  EnemySpawnOptions,
  EnemyType,
  EnemyTypeRegistration,
} from "./EnemyTypes";

function splitAssetUrl(assetUrl: string) {
  const separatorIndex = assetUrl.lastIndexOf("/");
  if (separatorIndex < 0 || separatorIndex === assetUrl.length - 1) {
    throw new Error(`Invalid enemy asset URL: ${assetUrl}`);
  }
  return {
    rootUrl: assetUrl.slice(0, separatorIndex + 1),
    fileName: assetUrl.slice(separatorIndex + 1),
  };
}

function collectMaterial(material: Material | null, result: Set<Material>) {
  if (!material || result.has(material)) return;
  result.add(material);
  if (material instanceof MultiMaterial) {
    for (const subMaterial of material.subMaterials) collectMaterial(subMaterial, result);
  }
}

function createAssetInstance(container: AssetContainer, id: EnemyId): EnemyAssetInstance {
  const entries = container.instantiateModelsToScene(
    (sourceName) => `${id}:${sourceName}`,
    true,
    { doNotInstantiate: true }
  );
  const nodeSet = new Set<Node>();
  for (const rootNode of entries.rootNodes) {
    nodeSet.add(rootNode);
    for (const descendant of rootNode.getDescendants(false)) nodeSet.add(descendant);
  }

  const nodes = [...nodeSet];
  const meshes = nodes.filter((node): node is AbstractMesh => node instanceof AbstractMesh);
  const materialSet = new Set<Material>();
  for (const mesh of meshes) collectMaterial(mesh.material, materialSet);

  return {
    rootNodes: entries.rootNodes,
    nodes,
    meshes,
    skeletons: entries.skeletons,
    animationGroups: entries.animationGroups,
    materials: [...materialSet],
  };
}

function disposeAssetInstance(instance: EnemyAssetInstance) {
  for (const animationGroup of instance.animationGroups) {
    animationGroup.stop(true);
    animationGroup.dispose();
  }
  for (const rootNode of instance.rootNodes) rootNode.dispose(false, false);
  for (const skeleton of instance.skeletons) skeleton.dispose();
  for (const material of instance.materials) material.dispose(false, false);
}

export class EnemyManager {
  private readonly registrations = new Map<EnemyType, EnemyTypeRegistration>();
  private readonly enemies = new Map<EnemyId, EnemyController>();
  private readonly pendingIds = new Set<EnemyId>();
  private readonly idCounters = new Map<EnemyType, number>();
  private readonly assetLoads = new Map<string, Promise<AssetContainer>>();
  private readonly assetContainers = new Map<string, AssetContainer>();
  private disposed = false;

  public constructor(private readonly scene: Scene) {}

  public registerType(registration: EnemyTypeRegistration) {
    this.assertActive();
    if (this.registrations.has(registration.type)) {
      throw new Error(`Enemy type already registered: ${registration.type}`);
    }
    this.registrations.set(registration.type, registration);
  }

  public async preload(type: EnemyType) {
    const registration = this.getRegistration(type);
    await this.loadAsset(registration.assetUrl);
  }

  public async spawn(options: EnemySpawnOptions): Promise<EnemyController> {
    this.assertActive();
    const registration = this.getRegistration(options.type);
    const id = options.id ?? this.createId(options.type);
    if (this.enemies.has(id) || this.pendingIds.has(id)) {
      throw new Error(`Enemy ID already exists: ${id}`);
    }

    this.pendingIds.add(id);
    let instance: EnemyAssetInstance | null = null;
    let controller: EnemyController | null = null;
    try {
      const container = await this.loadAsset(registration.assetUrl);
      this.assertActive();
      instance = createAssetInstance(container, id);
      const spawnOptions: EnemySpawnOptions = { ...options, id };
      controller = registration.create(
        { scene: this.scene, asset: instance },
        spawnOptions
      );
      instance = null;

      if (controller.id !== id || controller.type !== options.type || !controller.root) {
        throw new Error(`Enemy ${id}: registered factory returned an invalid controller`);
      }
      await controller.initialize();
      this.assertActive();
      this.enemies.set(id, controller);
      return controller;
    } catch (error) {
      controller?.dispose();
      if (instance) disposeAssetInstance(instance);
      throw error;
    } finally {
      this.pendingIds.delete(id);
    }
  }

  public update(deltaTimeSeconds: number) {
    if (this.disposed) return;
    for (const enemy of this.enemies.values()) {
      if (enemy.lifecycleState === EnemyLifecycleState.Ready && enemy.enabled) {
        enemy.update(deltaTimeSeconds);
      }
    }
  }

  public getById<T extends EnemyController = EnemyController>(id: EnemyId) {
    return this.enemies.get(id) as T | undefined;
  }

  public getByType<T extends EnemyController = EnemyController>(type: EnemyType) {
    return [...this.enemies.values()].filter((enemy) => enemy.type === type) as T[];
  }

  public remove(id: EnemyId) {
    const enemy = this.enemies.get(id);
    if (!enemy) return false;
    this.enemies.delete(id);
    enemy.dispose();
    return true;
  }

  public setEnabled(id: EnemyId, enabled: boolean) {
    const enemy = this.enemies.get(id);
    if (!enemy) return false;
    enemy.setEnabled(enabled);
    return true;
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const enemy of this.enemies.values()) enemy.dispose();
    this.enemies.clear();
    this.pendingIds.clear();
    for (const container of this.assetContainers.values()) container.dispose();
    this.assetContainers.clear();
    this.assetLoads.clear();
    this.registrations.clear();
  }

  private getRegistration(type: EnemyType) {
    this.assertActive();
    const registration = this.registrations.get(type);
    if (!registration) throw new Error(`Enemy type is not registered: ${type}`);
    return registration;
  }

  private createId(type: EnemyType) {
    let sequence = this.idCounters.get(type) ?? 0;
    let id: EnemyId;
    do {
      sequence += 1;
      id = `${type}-${sequence}`;
    } while (this.enemies.has(id) || this.pendingIds.has(id));
    this.idCounters.set(type, sequence);
    return id;
  }

  private loadAsset(assetUrl: string) {
    const cached = this.assetLoads.get(assetUrl);
    if (cached) return cached;

    const { rootUrl, fileName } = splitAssetUrl(assetUrl);
    const load = SceneLoader.LoadAssetContainerAsync(rootUrl, fileName, this.scene)
      .then((container) => {
        if (this.disposed) {
          container.dispose();
          throw new Error(`EnemyManager was disposed while loading ${assetUrl}`);
        }
        this.assetContainers.set(assetUrl, container);
        return container;
      })
      .catch((error: unknown) => {
        this.assetLoads.delete(assetUrl);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not load enemy asset ${assetUrl}: ${message}`, {
          cause: error,
        });
      });
    this.assetLoads.set(assetUrl, load);
    return load;
  }

  private assertActive() {
    if (this.disposed) throw new Error("EnemyManager is disposed");
  }
}
