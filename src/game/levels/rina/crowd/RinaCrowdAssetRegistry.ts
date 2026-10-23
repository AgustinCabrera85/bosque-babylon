import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Light } from "@babylonjs/core/Lights/light";
import type { Scene } from "@babylonjs/core/scene";
import { patchCharacterMaterial } from "../../../CharacterPresentation";
import { asset } from "../../../../utils/asset";
import type { RinaCrowdFanAsset, RinaCrowdQuality } from "./RinaCrowdAssetManifest";

export interface AnimatedRinaCrowdGroup {
  readonly mesh: Mesh;
  readonly roots: InstantiatedEntries["rootNodes"];
  readonly clips: readonly AnimationGroup[];
}

function lightFanMesh(mesh: Mesh): void {
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  mesh.alwaysSelectAsActiveMesh = true;
  // Share Lautaro's PBR response. The stage lights supply illumination;
  // the albedo must not emit light on its own between light cues.
  patchCharacterMaterial(mesh.material, "lautaro");
  if (mesh.material instanceof PBRMaterial) {
    mesh.material.emissiveTexture = null;
    mesh.material.emissiveColor = Color3.Black();
    mesh.material.directIntensity = 1;
    mesh.material.maxSimultaneousLights = 6;
  }
}

/** One registry per scene. Concurrent callers share the same in-flight load. */
export class RinaCrowdAssetRegistry {
  private readonly loads = new Map<string, Promise<Mesh | null>>();
  private readonly animatedLoads = new Map<string, Promise<readonly AnimatedRinaCrowdGroup[] | null>>();
  private readonly containers = new Map<string, AssetContainer>();
  private readonly animatedEntries: InstantiatedEntries[] = [];
  private disposed = false;

  constructor(private readonly scene: Scene, private readonly actorLights: readonly Light[] = []) {}

  loadPosed(fan: RinaCrowdFanAsset, quality: RinaCrowdQuality): Promise<Mesh | null> {
    const key = `${fan.id}:${quality}`;
    const existing = this.loads.get(key);
    if (existing) return existing;
    const path = fan.variants[quality].posedPath;
    if (!path) throw new Error(`Rina crowd ${key}: missing posed asset`);
    const slash = path.lastIndexOf("/");
    const load = SceneLoader.LoadAssetContainerAsync(asset(path.slice(0, slash + 1)),
      path.slice(slash + 1), this.scene)
      .then(container => {
        if (this.disposed) {
          container.dispose();
          return null;
        }
        const meshes = container.meshes.filter(mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0) as Mesh[];
        if (meshes.length !== 1 || container.skeletons.length !== 0) {
          container.dispose();
          throw new Error(`Rina crowd ${key}: expected one baked mesh and no skeleton`);
        }
        container.addAllToScene();
        this.containers.set(key, container);
        const mesh = meshes[0];
        mesh.name = `rinaCrowd_${key}`;
        lightFanMesh(mesh);
        for (const light of this.actorLights) light.includedOnlyMeshes.push(mesh);
        return mesh;
      })
      .catch(error => {
        console.warn(`Rina crowd asset ${key} unavailable; keeping procedural spectators`, error);
        return null;
      });
    this.loads.set(key, load);
    return load;
  }

  loadAnimated(fan: RinaCrowdFanAsset, quality: RinaCrowdQuality,
    groupCount = 3): Promise<readonly AnimatedRinaCrowdGroup[] | null> {
    const key = `${fan.id}:${quality}`;
    const existing = this.animatedLoads.get(key);
    if (existing) return existing;
    const path = fan.variants[quality].riggedPath;
    const slash = path.lastIndexOf("/");
    const load = SceneLoader.LoadAssetContainerAsync(asset(path.slice(0, slash + 1)),
      path.slice(slash + 1), this.scene)
      .then(container => {
        if (this.disposed) {
          container.dispose();
          return null;
        }
        const source = container.meshes.filter(mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0) as Mesh[];
        const names = fan.animationNames ?? [];
        if (source.length !== 1 || container.skeletons.length !== 1 || names.length === 0 ||
            names.some(name => !container.animationGroups.some(group => group.name === name))) {
          container.dispose();
          throw new Error(`Rina crowd ${key}: expected one skinned mesh and all registered clips`);
        }
        // The glTF loader starts its first clip by default, including for an
        // asset container that has not been added to the scene. Those source
        // bones are invisible but keep animating alongside the visible clones.
        for (const clip of container.animationGroups) clip.stop();
        lightFanMesh(source[0]);
        const entries: InstantiatedEntries[] = [];
        try {
          for (let i = 0; i < groupCount; i++) {
            const instance = container.instantiateModelsToScene(
              sourceName => `rinaCrowd_${key}:group_${i}:${sourceName}`, false, { doNotInstantiate: true });
            entries.push(instance);
          }
          const groups = entries.map((instance, i) => {
            const mesh = instance.rootNodes.flatMap(root => [root, ...root.getDescendants(false)])
              .find(node => node instanceof Mesh && node.getTotalVertices() > 0) as Mesh | undefined;
            if (!mesh || !mesh.skeleton) throw new Error(`Rina crowd ${key}: missing cloned rig`);
            mesh.name = `rinaCrowd_${key}:group_${i}`;
            lightFanMesh(mesh);
            for (const light of this.actorLights) light.includedOnlyMeshes.push(mesh);
            const clips = names.map(name => instance.animationGroups.find(group => group.name.endsWith(`:${name}`)));
            if (clips.some(clip => !clip)) throw new Error(`Rina crowd ${key}: missing cloned animation`);
            return { mesh, roots: instance.rootNodes,
              clips: clips as AnimationGroup[] };
          });
          this.containers.set(key, container);
          this.animatedEntries.push(...entries);
          return groups;
        } catch (error) {
          for (const instance of entries) this.disposeEntry(instance);
          container.dispose();
          throw error;
        }
      })
      .catch(error => {
        console.warn(`Rina crowd asset ${key} unavailable; keeping procedural spectators`, error);
        return null;
      });
    this.animatedLoads.set(key, load);
    return load;
  }

  private disposeEntry(entry: InstantiatedEntries): void {
    for (const clip of entry.animationGroups) {
      clip.stop(true);
      clip.dispose();
    }
    for (const root of entry.rootNodes) root.dispose(false, false);
    for (const skeleton of entry.skeletons) skeleton.dispose();
  }

  get loadedVariants(): number { return this.containers.size; }
  get activeRigs(): number { return this.animatedEntries.reduce((n, entry) => n + entry.skeletons.length, 0); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.animatedEntries) this.disposeEntry(entry);
    this.animatedEntries.length = 0;
    for (const container of this.containers.values()) container.dispose();
    this.containers.clear();
    this.loads.clear();
    this.animatedLoads.clear();
  }
}
