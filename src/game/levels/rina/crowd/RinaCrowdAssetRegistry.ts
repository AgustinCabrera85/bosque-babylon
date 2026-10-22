import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../../utils/asset";
import type { RinaCrowdFanAsset, RinaCrowdQuality } from "./RinaCrowdAssetManifest";

/** Match the procedural crowd's dim baseline while lights drive the fan. */
export const RINA_CROWD_FAN_AMBIENT = 0.038;
export const RINA_CROWD_FAN_DIRECT_LIGHT = 4;

/** One registry per scene. Concurrent callers share the same in-flight load. */
export class RinaCrowdAssetRegistry {
  private readonly loads = new Map<string, Promise<Mesh | null>>();
  private readonly containers = new Map<string, AssetContainer>();
  private disposed = false;

  constructor(private readonly scene: Scene) {}

  loadPosed(fan: RinaCrowdFanAsset, quality: RinaCrowdQuality): Promise<Mesh | null> {
    const key = `${fan.id}:${quality}`;
    const existing = this.loads.get(key);
    if (existing) return existing;
    const path = fan.variants[quality].posedPath;
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
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.receiveShadows = false;
        mesh.alwaysSelectAsActiveMesh = true;
        // The bowl is intentionally dark. Keep the GLB's albedo visible like
        // the existing crowd without replacing its original PBR material.
        if (mesh.material instanceof PBRMaterial && mesh.material.albedoTexture) {
          mesh.material.emissiveTexture = mesh.material.albedoTexture;
          mesh.material.emissiveColor = new Color3(
            RINA_CROWD_FAN_AMBIENT, RINA_CROWD_FAN_AMBIENT, RINA_CROWD_FAN_AMBIENT);
          mesh.material.directIntensity = RINA_CROWD_FAN_DIRECT_LIGHT;
        }
        return mesh;
      })
      .catch(error => {
        console.warn(`Rina crowd asset ${key} unavailable; keeping procedural spectators`, error);
        return null;
      });
    this.loads.set(key, load);
    return load;
  }

  get loadedVariants(): number { return this.containers.size; }
  get activeRigs(): number { return 0; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const container of this.containers.values()) container.dispose();
    this.containers.clear();
    this.loads.clear();
  }
}
