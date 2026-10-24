import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";

export type CloudType = "CLD_01" | "CLD_02";
export interface CloudEmitter {
  id: string;
  type: CloudType;
  mesh: Mesh;
  anchorWorld(): Vector3;
}
type InternalCloud = CloudEmitter & {
  material: StandardMaterial;
  base: Vector3;
  phase: number;
  flash: number;
};

/** Procedural placeholders until the two independent cloud artworks arrive. */
function cloudTexture(scene: Scene, type: CloudType): DynamicTexture {
  const texture = new DynamicTexture(`stormCloudPlaceholder_${type}`, { width: 512, height: 256 }, scene, false);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 512, 256);
  const blobs = type === "CLD_01"
    ? [[95, 154, 91, 58], [172, 110, 106, 77], [281, 130, 122, 68], [391, 148, 100, 59]]
    : [[128, 152, 72, 59], [188, 101, 93, 88], [295, 126, 76, 85], [361, 161, 82, 54]];
  for (const [x, y, rx, ry] of blobs) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const gradient = ctx.createRadialGradient(0, 0, 0.05, 0, 0, 1);
    gradient.addColorStop(0, "rgba(51,53,70,0.78)");
    gradient.addColorStop(0.58, "rgba(36,39,57,0.6)");
    gradient.addColorStop(1, "rgba(25,28,46,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

export class CloudEmitterSystem {
  readonly emitters: readonly CloudEmitter[];
  private readonly clouds: InternalCloud[];
  private readonly textures: DynamicTexture[];
  private disposed = false;
  private count = 3;
  private time = 0;

  constructor(scene: Scene) {
    const shelf = cloudTexture(scene, "CLD_01");
    const ragged = cloudTexture(scene, "CLD_02");
    this.textures = [shelf, ragged];
    const positions = [
      new Vector3(0, 10.8, -2.0), new Vector3(-8.4, 10.1, -5.2),
      new Vector3(8.3, 11.2, -6.5), new Vector3(-14, 9.9, -12),
      new Vector3(13.8, 10.5, -13),
    ];
    this.clouds = positions.map((base, index) => {
      const type: CloudType = index % 2 ? "CLD_02" : "CLD_01";
      const mesh = MeshBuilder.CreatePlane(`stormCloud_${index}`, {
        width: type === "CLD_01" ? 8.8 : 6.6, height: type === "CLD_01" ? 4.3 : 4.6,
      }, scene);
      mesh.position.copyFrom(base);
      mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
      mesh.isPickable = false;
      mesh.renderingGroupId = 1;
      const material = new StandardMaterial(`stormCloudMaterial_${index}`, scene);
      material.diffuseTexture = type === "CLD_01" ? shelf : ragged;
      material.useAlphaFromDiffuseTexture = true;
      material.disableLighting = true;
      material.backFaceCulling = false;
      material.specularColor = Color3.Black();
      material.emissiveColor = new Color3(0.025, 0.024, 0.038);
      material.disableDepthWrite = true;
      mesh.material = material;
      const cloud: InternalCloud = {
        id: `Nube ${index + 1}`, type, mesh, material, base, phase: index * 1.37, flash: 0,
        anchorWorld: () => mesh.position.add(new Vector3(0, -0.68, 0)),
      };
      return cloud;
    });
    this.emitters = this.clouds;
    this.setCount(this.count);
  }

  get activeCount(): number { return this.count; }
  activeEmitters(): readonly CloudEmitter[] { return this.clouds.slice(0, this.count); }
  emitter(id: string): CloudEmitter | undefined { return this.clouds.find(cloud => cloud.id === id); }
  setCount(count: number): void {
    this.count = Math.max(2, Math.min(5, Math.round(count)));
    this.clouds.forEach((cloud, index) => cloud.mesh.setEnabled(index < this.count));
  }
  moveEmitter(id: string, position: Vector3): void {
    const cloud = this.clouds.find(item => item.id === id);
    if (cloud) cloud.base.copyFrom(position);
  }
  flashEmitter(id: string, amount: number): void {
    const cloud = this.clouds.find(item => item.id === id);
    if (cloud) cloud.flash = Math.max(cloud.flash, Math.max(0, Math.min(1, amount)));
  }
  update(dt: number): void {
    this.time += Math.max(0, dt);
    for (const cloud of this.clouds) {
      cloud.mesh.position.set(
        cloud.base.x + 0.37 * Math.sin(this.time * 0.13 + cloud.phase),
        cloud.base.y + 0.13 * Math.sin(this.time * 0.31 + cloud.phase), cloud.base.z,
      );
      cloud.flash *= Math.exp(-Math.max(0, dt) * 7.5);
      cloud.material.emissiveColor.set(
        0.025 + cloud.flash * 0.42,
        0.024 + cloud.flash * 0.25,
        0.038 + cloud.flash * 0.51,
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clouds.forEach(cloud => { cloud.mesh.dispose(); cloud.material.dispose(); });
    this.textures.forEach(texture => texture.dispose());
  }
}
