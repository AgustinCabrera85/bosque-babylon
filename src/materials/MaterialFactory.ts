import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Scene } from "@babylonjs/core/scene";
import { MaterialRegistry } from "./MaterialRegistry";
import type { GameMaterialDefinition } from "./types/GameMaterialDefinition";

/** Converts logical material definitions into cacheable Babylon PBR materials. */
export class MaterialFactory {
  private static readonly cacheByScene = new WeakMap<Scene, Map<string, PBRMaterial>>();
  private static readonly observedScenes = new WeakSet<Scene>();

  static getOrCreate(id: string, scene: Scene): PBRMaterial | undefined {
    const definition = MaterialRegistry.get(id);
    if (!definition) return undefined;

    let cache = this.cacheByScene.get(scene);
    if (!cache) {
      cache = new Map<string, PBRMaterial>();
      this.cacheByScene.set(scene, cache);
    }

    const cached = cache.get(id);
    if (cached) return cached;

    const material = this.createFromDefinition(definition, scene);
    cache.set(id, material);
    this.observeScene(scene);
    return material;
  }

  static create(id: string, scene: Scene): PBRMaterial | undefined {
    const definition = MaterialRegistry.get(id);
    return definition ? this.createFromDefinition(definition, scene) : undefined;
  }

  private static createFromDefinition(definition: GameMaterialDefinition, scene: Scene): PBRMaterial {
    const material = new PBRMaterial(`gameMaterial:${definition.id}`, scene);
    const { visual } = definition;

    material.albedoColor = visual.color ? Color3.FromHexString(visual.color) : Color3.White();
    material.metallic = visual.metallic ?? 0;
    material.roughness = visual.roughness ?? 0.8;
    material.maxSimultaneousLights = 8;
    material.fogEnabled = true;

    if (visual.emissiveColor) {
      material.emissiveColor = Color3.FromHexString(visual.emissiveColor);
    }

    if (visual.albedoTexture) {
      material.albedoTexture = this.createTexture(visual.albedoTexture, scene);
    }

    if (visual.normalTexture) {
      material.bumpTexture = this.createTexture(visual.normalTexture, scene);
    }

    return material;
  }

  private static createTexture(url: string, scene: Scene): Texture {
    const texture = new Texture(url, scene);
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;
    return texture;
  }

  private static observeScene(scene: Scene) {
    if (this.observedScenes.has(scene)) return;

    this.observedScenes.add(scene);
    scene.onDisposeObservable.add(() => {
      this.cacheByScene.delete(scene);
      this.observedScenes.delete(scene);
    });
  }
}
