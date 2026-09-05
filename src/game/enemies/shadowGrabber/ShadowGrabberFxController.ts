import { Engine } from "@babylonjs/core/Engines/engine";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGrabberFxQuality } from "./ShadowGrabberConfig";

export type ShadowGrabberFxState =
  | "idle"
  | "hunt"
  | "alert"
  | "extend"
  | "grab"
  | "hold"
  | "retract"
  | "lightRecoil";

/** Low-cost portal dressing. It is advanced by EnemyManager, never by its own observer. */
export class ShadowGrabberFxController {
  private readonly texture: DynamicTexture;
  private readonly innerLayer: Mesh;
  private readonly outerLayer: Mesh;
  private readonly materials: StandardMaterial[];
  private readonly smoke: ParticleSystem;
  private readonly emitterPosition = Vector3.Zero();
  private enabled = true;
  private state: ShadowGrabberFxState = "idle";
  private elapsed = 0;

  public constructor(
    scene: Scene,
    private readonly root: TransformNode,
    quality: Exclude<ShadowGrabberFxQuality, "off">
  ) {
    this.texture = this.createSmokeTexture(scene);
    const innerMaterial = this.createLayerMaterial(scene, "inner", 0.34);
    const outerMaterial = this.createLayerMaterial(scene, "outer", 0.2);
    this.materials = [innerMaterial, outerMaterial];
    this.innerLayer = this.createLayer(scene, "inner", 0.48, innerMaterial);
    this.outerLayer = this.createLayer(scene, "outer", 0.7, outerMaterial);
    this.outerLayer.rotation.z = Math.PI * 0.37;

    const capacity = quality === "high" ? 24 : 12;
    this.smoke = new ParticleSystem(
      `${root.name}:wisps`,
      capacity,
      scene
    );
    this.emitterPosition.copyFrom(root.getAbsolutePosition());
    this.smoke.emitter = this.emitterPosition;
    this.smoke.particleTexture = this.texture;
    this.smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.smoke.billboardMode = ParticleSystem.BILLBOARDMODE_ALL;
    this.smoke.color1 = new Color4(0.004, 0.006, 0.014, 0.22);
    this.smoke.color2 = new Color4(0.016, 0.02, 0.035, 0.14);
    this.smoke.colorDead = new Color4(0, 0, 0.005, 0);
    this.smoke.minSize = quality === "high" ? 0.38 : 0.42;
    this.smoke.maxSize = quality === "high" ? 0.9 : 0.82;
    this.smoke.minLifeTime = 1.05;
    this.smoke.maxLifeTime = 2.15;
    this.smoke.emitRate = quality === "high" ? 9 : 5;
    this.smoke.minEmitBox = new Vector3(-0.16, -0.15, -0.16);
    this.smoke.maxEmitBox = new Vector3(0.16, 0.15, 0.16);
    this.smoke.direction1 = new Vector3(-0.12, 0.08, -0.12);
    this.smoke.direction2 = new Vector3(0.12, 0.3, 0.12);
    this.smoke.minEmitPower = 0.08;
    this.smoke.maxEmitPower = 0.22;
    this.smoke.updateSpeed = 0.018;
    this.smoke.start();
  }

  public setState(state: ShadowGrabberFxState) {
    if (this.state === state) return;
    this.state = state;
    if (state === "extend" && this.enabled) this.smoke.manualEmitCount = 4;
  }

  public setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.innerLayer.setEnabled(enabled);
    this.outerLayer.setEnabled(enabled);
    if (enabled) this.smoke.start();
    else {
      this.smoke.stop();
      this.smoke.reset();
    }
  }

  public update(dt: number) {
    if (!this.enabled) return;
    this.elapsed += Math.max(0, Math.min(0.1, dt));
    this.emitterPosition.copyFrom(this.root.getAbsolutePosition());
    const hunt = this.state === "hunt";
    const alert = this.state === "alert";
    const recoil = this.state === "lightRecoil";
    const retract = this.state === "retract";
    const speedMultiplier = hunt ? 1.2 : recoil ? -0.75 : retract ? -0.55 : 1;
    this.innerLayer.rotation.z += dt * 0.34 * speedMultiplier;
    this.outerLayer.rotation.z -= dt * 0.22 * speedMultiplier;

    const alertPulse = alert ? Math.sin(this.elapsed * Math.PI * 8) * 0.035 : 0;
    const extendCompression = this.state === "extend" ? -0.045 : 0;
    const recoilCompression = recoil ? -0.035 : 0;
    const scale = 1 + alertPulse + extendCompression + recoilCompression;
    this.innerLayer.scaling.setAll(scale);
    this.outerLayer.scaling.setAll(1 + alertPulse * 0.65 - extendCompression * 0.6);

    this.smoke.emitRate = recoil ? 9 : hunt ? 6.5 : alert ? 7 : retract ? 4 : 5;
    this.smoke.direction1.y = recoil ? -0.08 : retract ? 0.03 : 0.08;
    this.smoke.direction2.y = recoil ? 0.42 : retract ? 0.12 : hunt ? 0.34 : 0.3;
  }

  public dispose() {
    this.smoke.dispose();
    this.innerLayer.dispose(false, false);
    this.outerLayer.dispose(false, false);
    for (const material of this.materials) material.dispose(false, false);
    this.texture.dispose();
  }

  private createLayer(
    scene: Scene,
    suffix: string,
    size: number,
    material: StandardMaterial
  ) {
    const layer = MeshBuilder.CreatePlane(
      `${this.root.name}:${suffix}`,
      { size },
      scene
    );
    layer.parent = this.root;
    layer.material = material;
    layer.billboardMode = Mesh.BILLBOARDMODE_ALL;
    layer.isPickable = false;
    layer.renderingGroupId = 0;
    return layer;
  }

  private createLayerMaterial(scene: Scene, suffix: string, alpha: number) {
    const material = new StandardMaterial(`${this.root.name}:${suffix}Material`, scene);
    material.diffuseTexture = this.texture;
    material.opacityTexture = this.texture;
    material.diffuseColor = new Color3(0.006, 0.008, 0.018);
    material.emissiveColor = new Color3(0.001, 0.002, 0.006);
    material.specularColor.setAll(0);
    material.alpha = alpha;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.alphaMode = Engine.ALPHA_COMBINE;
    material.disableDepthWrite = true;
    return material;
  }

  private createSmokeTexture(scene: Scene) {
    const texture = new DynamicTexture(
      `${this.root.name}:smokeTexture`,
      { width: 64, height: 64 },
      scene,
      false
    );
    texture.hasAlpha = true;
    const context = texture.getContext();
    context.clearRect(0, 0, 64, 64);
    const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 31);
    gradient.addColorStop(0, "rgba(2, 3, 8, 0.78)");
    gradient.addColorStop(0.42, "rgba(4, 5, 12, 0.48)");
    gradient.addColorStop(0.76, "rgba(1, 2, 7, 0.18)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    texture.update(false);
    return texture;
  }
}
