import { Engine } from "@babylonjs/core/Engines/engine";
import { Axis, Space } from "@babylonjs/core/Maths/math.axis";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type {
  BlackSmokeWrapEffect,
  BlackSmokeWrapSystem,
} from "../../BlackSmokeWrapSystem";
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

type TendrilVisual = {
  mesh: Mesh;
  phase: number;
  speed: number;
};

/** Low-cost portal dressing. It is advanced by EnemyManager, never by its own observer. */
export class ShadowGrabberFxController {
  private readonly texture: DynamicTexture;
  private readonly innerLayer: Mesh;
  private readonly outerLayer: Mesh;
  private readonly portalCore: Mesh;
  private readonly portalRim: Mesh;
  private readonly orbitalSmokeRing: Mesh;
  private readonly tendrils: TendrilVisual[];
  private readonly materials: StandardMaterial[];
  private readonly smoke: BlackSmokeWrapEffect;
  private requestedEnabled = true;
  private ownerEnabled = true;
  private active = true;
  private state: ShadowGrabberFxState = "idle";
  private elapsed = 0;

  public constructor(
    scene: Scene,
    private readonly root: TransformNode,
    portalMesh: AbstractMesh,
    portalMaterial: PBRMaterial,
    quality: Exclude<ShadowGrabberFxQuality, "off">,
    smokeSystem: BlackSmokeWrapSystem
  ) {
    this.texture = this.createSmokeTexture(scene);
    const bounds = portalMesh.getBoundingInfo().boundingBox;
    const rawSize = bounds.maximum.subtract(bounds.minimum);
    const rawCenter = bounds.maximum.add(bounds.minimum).scale(0.5);
    const portalSize = new Vector3(
      rawSize.x * Math.abs(portalMesh.scaling.x),
      rawSize.y * Math.abs(portalMesh.scaling.y),
      rawSize.z * Math.abs(portalMesh.scaling.z)
    );
    const portalCenter = new Vector3(
      rawCenter.x * portalMesh.scaling.x,
      rawCenter.y * portalMesh.scaling.y,
      rawCenter.z * portalMesh.scaling.z
    );
    const portalDiameter = Math.max(portalSize.y, portalSize.z);
    const portalRadius = portalDiameter * 0.5;

    const coreMaterial = this.createVoidMaterial(scene);
    const innerMaterial = this.createLayerMaterial(scene, "inner", 0.52);
    const outerMaterial = this.createLayerMaterial(scene, "outer", 0.24);
    const smokeRingMaterial = this.createSmokeRingMaterial(scene);
    const tendrilMaterial = this.createTendrilMaterial(scene);
    this.materials = [
      coreMaterial,
      innerMaterial,
      outerMaterial,
      smokeRingMaterial,
      tendrilMaterial,
    ];
    this.portalCore = this.createPortalCore(
      scene,
      portalMesh,
      coreMaterial,
      portalDiameter,
      portalSize.x,
      portalCenter
    );
    this.portalRim = this.createPortalRim(
      scene,
      portalMesh,
      portalMaterial,
      portalDiameter,
      portalSize.x,
      portalCenter,
      quality
    );
    this.orbitalSmokeRing = this.createOrbitalSmokeRing(
      scene,
      portalMesh,
      smokeRingMaterial,
      portalDiameter,
      portalSize.x,
      portalCenter,
      quality
    );
    this.innerLayer = this.createLayer(
      scene,
      "inner",
      portalDiameter * 1.12,
      portalCenter,
      portalSize.x,
      innerMaterial
    );
    this.outerLayer = this.createLayer(
      scene,
      "outer",
      portalDiameter * 1.52,
      portalCenter,
      portalSize.x,
      outerMaterial
    );
    this.outerLayer.rotate(Axis.Z, Math.PI * 0.37, Space.LOCAL);
    this.tendrils = this.createTendrils(
      scene,
      tendrilMaterial,
      portalSize,
      portalCenter,
      quality
    );

    // ShadowOrb_Core already owns the authored -X offset. The FX root is placed
    // at that pivot, so another -X offset would move the cloud onto the hand.
    // Aligning the smoke axis to X wraps the flattened orb in the YZ plane.
    this.smoke = smokeSystem.attach(root, {
      name: `${root.name}:portalSmoke`,
      // Desktop uses the system's medium preset; explicit high quality remains
      // available while mobile keeps the system's low preset.
      quality: quality === "high" ? "high" : undefined,
      axis: Vector3.Right(),
      radiusX: portalRadius * 1.08,
      radiusZ: portalRadius * 1.02,
      innerRadiusRatio: 0.78,
      height: portalRadius * 0.42,
      particleSize: quality === "high" ? 0.28 : 0.32,
      elongation: 1.42,
      orbitSpeed: 1.18,
      upwardDrift: -0.02,
      density: 1.05,
      opacity: 1,
      color: new Color3(0.012, 0.014, 0.022),
      applyFog: false,
    });
  }

  public setState(state: ShadowGrabberFxState) {
    if (this.state === state) return;
    this.state = state;
    if (state === "extend" && this.active) {
      this.smoke.emitBurst(4);
    }
  }

  public setEnabled(enabled: boolean) {
    if (this.requestedEnabled === enabled) return;
    this.requestedEnabled = enabled;
    this.syncEnabled();
  }

  public setOwnerEnabled(enabled: boolean) {
    if (this.ownerEnabled === enabled) return;
    this.ownerEnabled = enabled;
    this.syncEnabled();
  }

  public update(dt: number) {
    if (!this.active) return;
    this.elapsed += Math.max(0, Math.min(0.1, dt));
    const hunt = this.state === "hunt";
    const alert = this.state === "alert";
    const recoil = this.state === "lightRecoil";
    const retract = this.state === "retract";
    const speedMultiplier = hunt ? 1.35 : recoil ? -0.9 : retract ? -0.72 : 1;
    this.innerLayer.rotate(Axis.Z, dt * 0.62 * speedMultiplier, Space.LOCAL);
    this.outerLayer.rotate(Axis.Z, -dt * 0.4 * speedMultiplier, Space.LOCAL);
    this.orbitalSmokeRing.rotate(
      Axis.X,
      dt * 0.92 * speedMultiplier,
      Space.LOCAL
    );

    for (const tendril of this.tendrils) {
      tendril.mesh.rotation.x += dt * tendril.speed * speedMultiplier;
      const pulse = Math.sin(this.elapsed * 2.15 + tendril.phase) * 0.055;
      tendril.mesh.scaling.set(1, 1 + pulse, 1 - pulse * 0.55);
    }

    const alertPulse = alert ? Math.sin(this.elapsed * Math.PI * 8) * 0.035 : 0;
    const extendCompression = this.state === "extend" ? -0.045 : 0;
    const recoilCompression = recoil ? -0.035 : 0;
    const scale = 1 + alertPulse + extendCompression + recoilCompression;
    this.innerLayer.scaling.setAll(scale);
    this.outerLayer.scaling.setAll(1 + alertPulse * 0.65 - extendCompression * 0.6);

    this.smoke.setEmissionMultiplier(
      recoil
        ? 1.35
        : hunt
          ? 1.15
          : alert
            ? 1.25
            : retract
              ? 0.68
              : 1
    );
  }

  public dispose() {
    this.smoke.dispose();
    this.innerLayer.dispose(false, false);
    this.outerLayer.dispose(false, false);
    this.orbitalSmokeRing.dispose(false, false);
    for (const tendril of this.tendrils) tendril.mesh.dispose(false, false);
    this.portalCore.dispose(false, false);
    this.portalRim.dispose(false, false);
    for (const material of this.materials) material.dispose(false, false);
    this.texture.dispose();
  }

  private syncEnabled() {
    const active = this.requestedEnabled && this.ownerEnabled;
    if (this.active === active) return;
    this.active = active;
    this.innerLayer.setEnabled(active);
    this.outerLayer.setEnabled(active);
    this.orbitalSmokeRing.setEnabled(active);
    for (const tendril of this.tendrils) tendril.mesh.setEnabled(active);
    this.smoke.setEnabled(active);
  }

  private createPortalCore(
    scene: Scene,
    source: AbstractMesh,
    material: StandardMaterial,
    diameter: number,
    depth: number,
    center: Vector3
  ) {
    const core = MeshBuilder.CreateDisc(
      `${this.root.name}:portalCore`,
      {
        radius: diameter * 0.46,
        tessellation: 48,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene
    );
    core.parent = this.root;
    core.position.copyFrom(center);
    core.position.x += Math.max(depth * 0.65, diameter * 0.065);
    core.rotation.y = Math.PI * 0.5;
    core.material = material;
    core.layerMask = source.layerMask;
    core.renderingGroupId = source.renderingGroupId;
    core.isPickable = false;
    return core;
  }

  private createPortalRim(
    scene: Scene,
    source: AbstractMesh,
    material: PBRMaterial,
    diameter: number,
    depth: number,
    center: Vector3,
    quality: Exclude<ShadowGrabberFxQuality, "off">
  ) {
    const rim = MeshBuilder.CreateTorus(
      `${this.root.name}:portalRim`,
      {
        diameter: diameter * 0.91,
        thickness: diameter * 0.03,
        tessellation: quality === "high" ? 40 : 28,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene
    );
    rim.parent = this.root;
    rim.position.copyFrom(center);
    rim.position.x += Math.max(depth * 0.62, diameter * 0.062);
    rim.rotation.z = Math.PI * 0.5;
    rim.material = material;
    rim.layerMask = source.layerMask;
    rim.renderingGroupId = source.renderingGroupId;
    rim.isPickable = false;
    return rim;
  }

  private createOrbitalSmokeRing(
    scene: Scene,
    source: AbstractMesh,
    material: StandardMaterial,
    diameter: number,
    depth: number,
    center: Vector3,
    quality: Exclude<ShadowGrabberFxQuality, "off">
  ) {
    const segmentCount = quality === "high" ? 56 : 40;
    const ringRadius = diameter * 0.485;
    const path: Vector3[] = [];

    // A closed, uneven tube reads as dense smoke while remaining fully opaque.
    // Its asymmetry makes the orbital rotation visible even in a dark scene.
    for (let index = 0; index <= segmentCount; index += 1) {
      const angle = (index / segmentCount) * Math.PI * 2;
      const radialWobble =
        Math.sin(angle * 3 + 0.35) * diameter * 0.018 +
        Math.sin(angle * 7 + 1.1) * diameter * 0.011;
      const axialWobble =
        Math.sin(angle * 5 + 0.6) * diameter * 0.018 +
        Math.sin(angle * 9) * diameter * 0.007;
      const radius = ringRadius + radialWobble;
      path.push(
        new Vector3(
          axialWobble,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius
        )
      );
    }

    const ring = MeshBuilder.CreateTube(
      `${this.root.name}:opaqueSmokeRing`,
      {
        path,
        tessellation: quality === "high" ? 9 : 7,
        cap: Mesh.NO_CAP,
        radiusFunction: (pathIndex) => {
          const angle = (pathIndex / segmentCount) * Math.PI * 2;
          const billow =
            Math.sin(angle * 4 + 0.8) * 0.014 +
            Math.sin(angle * 9 + 1.7) * 0.007;
          return diameter * (0.066 + billow);
        },
      },
      scene
    );
    ring.parent = this.root;
    ring.position.copyFrom(center);
    ring.position.x += Math.max(depth * 0.76, diameter * 0.078);
    ring.material = material;
    ring.layerMask = source.layerMask;
    ring.renderingGroupId = source.renderingGroupId;
    ring.isPickable = false;
    return ring;
  }

  private createTendrils(
    scene: Scene,
    material: StandardMaterial,
    size: Vector3,
    center: Vector3,
    quality: Exclude<ShadowGrabberFxQuality, "off">
  ) {
    const count = quality === "high" ? 7 : 5;
    const pointCount = quality === "high" ? 15 : 12;
    const baseRadius = Math.max(size.y, size.z) * 0.535;
    const tendrils: TendrilVisual[] = [];

    for (let index = 0; index < count; index += 1) {
      const phase = (index / count) * Math.PI * 2 + (index % 2) * 0.21;
      const span = 1.18 + (index % 3) * 0.24;
      const reverse = index % 2 === 1;
      const flare = baseRadius * (0.3 + (index % 3) * 0.09);
      const points: Vector3[] = [];

      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const t = pointIndex / (pointCount - 1);
        const directedT = reverse ? 1 - t : t;
        const angle = phase + (t - 0.5) * span;
        const radialWobble =
          Math.sin(t * Math.PI * 3 + phase) * baseRadius * 0.055;
        const radius =
          baseRadius + radialWobble + Math.pow(directedT, 2.35) * flare;
        const depth =
          Math.sin(angle * 1.7 + index * 0.83) *
            (baseRadius * 0.06 + Math.sin(t * Math.PI) * baseRadius * 0.09) +
          (t - 0.5) * baseRadius * 0.07;
        points.push(
          new Vector3(
            center.x + depth,
            center.y + Math.cos(angle) * radius,
            center.z + Math.sin(angle) * radius
          )
        );
      }

      const tube = MeshBuilder.CreateTube(
        `${this.root.name}:tendril:${index}`,
        {
          path: points,
          tessellation: quality === "high" ? 7 : 5,
          cap: Mesh.NO_CAP,
          radiusFunction: (pathIndex) => {
            const t = pathIndex / (pointCount - 1);
            return 0.0018 + Math.pow(Math.sin(Math.PI * t), 0.52) *
              (0.008 + (index % 2) * 0.0025);
          },
        },
        scene
      );
      tube.parent = this.root;
      tube.material = material;
      tube.isPickable = false;
      tube.renderingGroupId = 0;
      tube.visibility = 0.72 + (index % 3) * 0.08;
      tendrils.push({
        mesh: tube,
        phase,
        speed: (0.19 + (index % 3) * 0.045) * (reverse ? -1 : 1),
      });
    }

    return tendrils;
  }

  private createLayer(
    scene: Scene,
    suffix: string,
    size: number,
    center: Vector3,
    depth: number,
    material: StandardMaterial
  ) {
    const layer = MeshBuilder.CreateDisc(
      `${this.root.name}:${suffix}`,
      {
        radius: size * 0.5,
        tessellation: 48,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene
    );
    layer.parent = this.root;
    layer.position.copyFrom(center);
    layer.position.x +=
      Math.max(depth * 0.72, size * 0.045) +
      (suffix === "inner" ? size * 0.012 : 0);
    layer.rotation.y = Math.PI * 0.5;
    layer.material = material;
    layer.isPickable = false;
    layer.renderingGroupId = 0;
    return layer;
  }

  private createLayerMaterial(scene: Scene, suffix: string, alpha: number) {
    const material = new StandardMaterial(`${this.root.name}:${suffix}Material`, scene);
    material.diffuseTexture = this.texture;
    material.opacityTexture = this.texture;
    material.diffuseColor = new Color3(0.012, 0.014, 0.022);
    material.emissiveColor = new Color3(0.006, 0.008, 0.014);
    material.specularColor.setAll(0);
    material.alpha = alpha;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.alphaMode = Engine.ALPHA_COMBINE;
    material.disableDepthWrite = true;
    return material;
  }

  private createSmokeRingMaterial(scene: Scene) {
    const material = new StandardMaterial(
      `${this.root.name}:opaqueSmokeRingMaterial`,
      scene
    );
    material.diffuseColor = new Color3(0.0015, 0.002, 0.004);
    material.emissiveColor = new Color3(0.0035, 0.0045, 0.007);
    material.specularColor.setAll(0);
    material.alpha = 1;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.transparencyMode = Material.MATERIAL_OPAQUE;
    return material;
  }

  private createVoidMaterial(scene: Scene) {
    const material = new StandardMaterial(`${this.root.name}:voidMaterial`, scene);
    material.diffuseColor = new Color3(0.0002, 0.00025, 0.0005);
    material.emissiveColor = new Color3(0.0001, 0.00015, 0.00035);
    material.specularColor.setAll(0);
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.transparencyMode = Material.MATERIAL_OPAQUE;
    return material;
  }

  private createTendrilMaterial(scene: Scene) {
    const material = new StandardMaterial(`${this.root.name}:tendrilMaterial`, scene);
    material.diffuseColor = new Color3(0.006, 0.008, 0.015);
    material.emissiveColor = new Color3(0.025, 0.03, 0.045);
    material.specularColor.setAll(0);
    material.alpha = 0.8;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.alphaMode = Engine.ALPHA_COMBINE;
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
    const canvasContext = context as CanvasRenderingContext2D;
    context.clearRect(0, 0, 64, 64);
    const drawLobe = (x: number, y: number, radius: number, alpha: number) => {
      const gradient = context.createRadialGradient(x, y, 1, x, y, radius);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      gradient.addColorStop(0.48, `rgba(255, 255, 255, ${alpha * 0.56})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };

    drawLobe(17, 23, 18, 0.78);
    drawLobe(31, 14, 16, 0.58);
    drawLobe(47, 21, 18, 0.72);
    drawLobe(51, 39, 17, 0.62);
    drawLobe(36, 51, 17, 0.7);
    drawLobe(18, 46, 19, 0.68);

    // Uneven curved strokes give the two counter-rotating layers a slow
    // vortex motion without a shader or another particle system.
    canvasContext.save();
    canvasContext.lineCap = "round";
    canvasContext.shadowColor = "rgba(255, 255, 255, 0.22)";
    canvasContext.shadowBlur = 3;
    canvasContext.strokeStyle = "rgba(255, 255, 255, 0.34)";
    canvasContext.lineWidth = 3.2;
    canvasContext.beginPath();
    canvasContext.moveTo(11, 36);
    canvasContext.bezierCurveTo(14, 17, 39, 8, 54, 25);
    canvasContext.stroke();
    canvasContext.strokeStyle = "rgba(255, 255, 255, 0.24)";
    canvasContext.lineWidth = 4.4;
    canvasContext.beginPath();
    canvasContext.moveTo(49, 47);
    canvasContext.bezierCurveTo(35, 58, 14, 49, 15, 31);
    canvasContext.stroke();
    canvasContext.restore();

    // Keep the center open so the iridescent core remains legible instead of
    // being flattened by one uniform gray billboard.
    canvasContext.globalCompositeOperation = "destination-out";
    const opening = context.createRadialGradient(32, 32, 2, 32, 32, 22);
    opening.addColorStop(0, "rgba(0, 0, 0, 0.86)");
    opening.addColorStop(0.55, "rgba(0, 0, 0, 0.42)");
    opening.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = opening;
    context.fillRect(0, 0, 64, 64);
    canvasContext.globalCompositeOperation = "source-over";
    texture.update(false);
    return texture;
  }
}
