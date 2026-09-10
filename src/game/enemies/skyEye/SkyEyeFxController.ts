import { Axis, Space } from "@babylonjs/core/Maths/math.axis";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type {
  BlackSmokeWrapEffect,
  BlackSmokeWrapSystem,
} from "../../BlackSmokeWrapSystem";
import type { SkyEyeConfig } from "./SkyEyeConfig";

const TAU = Math.PI * 2;

type TendrilVisual = {
  mesh: Mesh;
  phase: number;
  speed: number;
};

type RootLocalBounds = {
  center: Vector3;
  size: Vector3;
};

/** Rear smoke disc and animated tendril crown aligned to the eye's local X axis. */
export class SkyEyeFxController {
  private readonly fxRoot: TransformNode;
  private readonly tendrilRoot: TransformNode;
  private readonly smokeDisc: BlackSmokeWrapEffect;
  private readonly tendrils: TendrilVisual[];
  private readonly tendrilMaterial: StandardMaterial;
  private readonly visualMeshes: Mesh[];
  private enabled = false;
  private elapsed = 0;

  public constructor(
    scene: Scene,
    ownerRoot: TransformNode,
    sourceMeshes: readonly AbstractMesh[],
    private readonly config: SkyEyeConfig,
    smokeSystem: BlackSmokeWrapSystem
  ) {
    const bounds = this.measureRootLocalBounds(ownerRoot, sourceMeshes);
    const eyeDiameter = Math.max(bounds.size.y, bounds.size.z);
    const smokeDiameter = eyeDiameter * config.smokeDiscScale;
    const ringRadius = eyeDiameter * config.tendrilRingScale * 0.5;
    const frontDepthOffset = Math.max(
      bounds.size.x * 0.34,
      eyeDiameter * 0.08
    );
    const ownerWorldScale = Vector3.One();
    ownerRoot.computeWorldMatrix(true).decompose(ownerWorldScale);
    const particleWorldScale = Math.max(
      Math.abs(ownerWorldScale.x),
      Math.abs(ownerWorldScale.y),
      Math.abs(ownerWorldScale.z)
    );
    const source = sourceMeshes[0];

    this.fxRoot = new TransformNode(`${ownerRoot.name}:skyEyeFx`, scene);
    this.fxRoot.parent = ownerRoot;
    this.fxRoot.position.copyFrom(bounds.center);
    // The authored visible face lies toward local -X. Keep the tendril crown
    // near that face while the smoke receives its own rearward offset below.
    this.fxRoot.position.x -= frontDepthOffset;

    this.tendrilRoot = new TransformNode(
      `${ownerRoot.name}:skyEyeTendrilRing`,
      scene
    );
    this.tendrilRoot.parent = this.fxRoot;
    this.tendrilRoot.position.x += eyeDiameter * 0.025;

    this.tendrilMaterial = this.createTendrilMaterial(scene);
    this.tendrils = this.createTendrilRing(
      scene,
      ringRadius,
      eyeDiameter,
      source?.renderingGroupId ?? 0,
      source?.layerMask ?? 0x0fffffff
    );
    this.visualMeshes = this.tendrils.map((tendril) => tendril.mesh);

    this.smokeDisc = smokeSystem.attach(this.fxRoot, {
      name: `${ownerRoot.name}:skyEyeSmokeDisc`,
      quality: config.fxQuality === "high" ? "high" : "medium",
      // Cancel the crown's frontal shift, then enter the middle of the +X
      // posterior half. This keeps the translucent cards behind the eyeball.
      offset: new Vector3(
        frontDepthOffset + bounds.size.x * config.smokeDepthOffset,
        0,
        0
      ),
      axis: Vector3.Right(),
      radiusX: smokeDiameter * 0.5,
      radiusZ: smokeDiameter * 0.5,
      innerRadiusRatio: 0.05,
      height: eyeDiameter * 0.1,
      // Particle cards are world-sized even though their orbit is local to the
      // owner, so include the owner's world scale to match the visible eye.
      particleSize:
        eyeDiameter * config.smokeParticleScale * particleWorldScale,
      elongation: 1,
      uniformParticleScale: true,
      orbitSpeed: 0.72,
      upwardDrift: 0,
      density: config.fxQuality === "high" ? 2 : 1.65,
      opacity: config.smokeDiscOpacity,
      color: new Color3(0.016, 0.018, 0.027),
      renderingGroupId: source?.renderingGroupId ?? 0,
      layerMask: source?.layerMask ?? 0x0fffffff,
      applyFog: false,
      enabled: false,
    });
    this.fxRoot.setEnabled(false);
  }

  public get meshes(): readonly AbstractMesh[] {
    return this.visualMeshes;
  }

  public setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.fxRoot.setEnabled(enabled);
    this.smokeDisc.setEnabled(enabled);
  }

  public update(deltaTimeSeconds: number) {
    if (!this.enabled) return;
    const delta = Math.max(0, Math.min(deltaTimeSeconds, 0.1));
    this.elapsed += delta;
    this.tendrilRoot.rotate(
      Axis.X,
      delta * this.config.tendrilOrbitSpeed,
      Space.LOCAL
    );

    for (const tendril of this.tendrils) {
      const frenzy =
        0.92 +
        Math.sin(this.elapsed * 3.7 + tendril.phase) * 0.3 +
        Math.sin(this.elapsed * 8.4 + tendril.phase * 1.9) * 0.13;
      tendril.mesh.rotation.x += delta * tendril.speed * frenzy;
      tendril.mesh.rotation.y =
        Math.sin(this.elapsed * 4.6 + tendril.phase * 1.3) * 0.075;
      tendril.mesh.rotation.z =
        Math.cos(this.elapsed * 6.2 + tendril.phase * 0.7) * 0.055;
      const pulse =
        Math.sin(this.elapsed * 4.25 + tendril.phase) * 0.072 +
        Math.sin(this.elapsed * 9.1 + tendril.phase * 1.7) * 0.024;
      tendril.mesh.scaling.set(1 - pulse * 0.25, 1 + pulse, 1 - pulse * 0.52);
    }
  }

  public dispose() {
    this.smokeDisc.dispose();
    this.fxRoot.dispose(false, false);
    this.tendrilMaterial.dispose(false, false);
    this.visualMeshes.length = 0;
    this.tendrils.length = 0;
  }

  private createTendrilRing(
    scene: Scene,
    ringRadius: number,
    eyeDiameter: number,
    renderingGroupId: number,
    layerMask: number
  ) {
    const highQuality = this.config.fxQuality === "high";
    const count = highQuality ? 17 : 13;
    const pointCount = highQuality ? 18 : 13;
    const tendrils: TendrilVisual[] = [];

    for (let index = 0; index < count; index += 1) {
      const phase = (index / count) * TAU + (index % 3) * 0.08;
      const reverse = index % 2 === 1;
      const span = 0.8 + (index % 4) * 0.085;
      const flare = eyeDiameter * (0.075 + (index % 3) * 0.018);
      const points: Vector3[] = [];

      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const t = pointIndex / (pointCount - 1);
        const directedT = reverse ? 1 - t : t;
        const angle = phase + (t - 0.5) * span;
        const middleBillow = Math.sin(t * Math.PI) * eyeDiameter * 0.038;
        const tipCurl = Math.pow(directedT, 2.4) * flare;
        const radialRipple =
          Math.sin(t * Math.PI * 3 + phase) * eyeDiameter * 0.018;
        const radius = ringRadius + middleBillow + tipCurl + radialRipple;
        const depth =
          Math.sin(t * Math.PI * 2 + phase * 1.7) * eyeDiameter * 0.035 +
          Math.sin(t * Math.PI) * eyeDiameter * 0.025;
        points.push(
          new Vector3(
            depth,
            Math.cos(angle) * radius,
            Math.sin(angle) * radius
          )
        );
      }

      const tendril = MeshBuilder.CreateTube(
        `${this.fxRoot.name}:tendril:${index}`,
        {
          path: points,
          tessellation: highQuality ? 8 : 6,
          cap: Mesh.CAP_ALL,
          radiusFunction: (pathIndex) => {
            const t = pathIndex / (pointCount - 1);
            const taper = Math.pow(Math.sin(Math.PI * t), 0.48);
            return eyeDiameter * (0.003 + taper * (0.019 + (index % 2) * 0.004));
          },
        },
        scene
      );
      tendril.parent = this.tendrilRoot;
      tendril.material = this.tendrilMaterial;
      tendril.isPickable = false;
      tendril.alwaysSelectAsActiveMesh = true;
      tendril.applyFog = false;
      tendril.renderingGroupId = renderingGroupId;
      tendril.layerMask = layerMask;
      tendrils.push({
        mesh: tendril,
        phase,
        speed:
          this.config.tendrilMotionSpeed *
          (0.74 + (index % 4) * 0.08) *
          (reverse ? -1 : 1),
      });
    }

    return tendrils;
  }

  private createTendrilMaterial(scene: Scene) {
    const material = new StandardMaterial(
      `${this.fxRoot?.name ?? "skyEye"}:tendrilMaterial`,
      scene
    );
    material.diffuseColor = new Color3(0.0015, 0.002, 0.0045);
    material.emissiveColor = new Color3(0.008, 0.01, 0.018);
    material.specularColor.setAll(0);
    material.alpha = 1;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.transparencyMode = Material.MATERIAL_OPAQUE;
    return material;
  }

  private measureRootLocalBounds(
    root: TransformNode,
    meshes: readonly AbstractMesh[]
  ): RootLocalBounds {
    root.computeWorldMatrix(true);
    const inverseRoot = Matrix.Invert(root.getWorldMatrix());
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

    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      for (const worldCorner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
        const localCorner = Vector3.TransformCoordinates(worldCorner, inverseRoot);
        minimum.minimizeInPlace(localCorner);
        maximum.maximizeInPlace(localCorner);
      }
    }

    if (!Number.isFinite(minimum.x) || !Number.isFinite(maximum.x)) {
      return { center: Vector3.Zero(), size: Vector3.One() };
    }
    return {
      center: minimum.add(maximum).scale(0.5),
      size: maximum.subtract(minimum),
    };
  }
}
