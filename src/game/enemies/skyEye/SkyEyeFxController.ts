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
import type { BlackSmokeWrapSystem } from "../../BlackSmokeWrapSystem";
import { ShadowGrabberFxController } from "../shadowGrabber/ShadowGrabberFxController";
import type { SkyEyeConfig } from "./SkyEyeConfig";

const TAU = Math.PI * 2;
const TENDRIL_EMISSIVE = new Color3(0.008, 0.01, 0.018);
const ASHEN_TENDRIL_EMISSIVE = new Color3(0.18, 0.18, 0.19);

type TendrilVisual = {
  mesh: Mesh;
  phase: number;
  speed: number;
};

type RootLocalBounds = {
  center: Vector3;
  size: Vector3;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** Uses the gray phase for ignition, then completes the breakup during fading. */
export function getSkyEyePortalDeathProgress(
  grayProgress: number,
  fadeProgress: number
) {
  const gray = clamp01(grayProgress);
  const fade = clamp01(fadeProgress);
  return fade > 0 ? 0.28 + fade * 0.72 : gray * 0.28;
}

export type SkyEyePresentationProgress = {
  disc: number;
  smoke: number;
  tendrils: number;
  eye: number;
};

/** Procedural shadow portal and animated tendril crown aligned to the eye. */
export class SkyEyeFxController {
  private readonly fxRoot: TransformNode;
  private readonly portalRoot: TransformNode;
  private readonly portal: ShadowGrabberFxController;
  private readonly tendrilRoot: TransformNode;
  private readonly tendrils: TendrilVisual[];
  private readonly tendrilMaterial: StandardMaterial;
  private readonly visualMeshes: Mesh[];
  private readonly eyeModelBasePosition: Vector3;
  private readonly eyeModelBaseScaling: Vector3;
  private readonly eyeEmergenceDepth: number;
  private enabled = false;
  private elapsed = 0;

  public constructor(
    scene: Scene,
    ownerRoot: TransformNode,
    private readonly eyeModelRoot: TransformNode,
    sourceMeshes: readonly AbstractMesh[],
    private readonly config: SkyEyeConfig,
    smokeSystem: BlackSmokeWrapSystem
  ) {
    const bounds = this.measureRootLocalBounds(ownerRoot, sourceMeshes);
    const eyeDiameter = Math.max(bounds.size.y, bounds.size.z);
    this.eyeModelBasePosition = eyeModelRoot.position.clone();
    this.eyeModelBaseScaling = eyeModelRoot.scaling.clone();
    this.eyeEmergenceDepth = eyeDiameter * 0.72;
    const ringRadius = eyeDiameter * config.tendrilRingScale * 0.5;
    const frontDepthOffset = Math.max(
      bounds.size.x * 0.34,
      eyeDiameter * 0.08
    );
    const source = sourceMeshes[0];

    this.fxRoot = new TransformNode(`${ownerRoot.name}:skyEyeFx`, scene);
    this.fxRoot.parent = ownerRoot;
    this.fxRoot.position.copyFrom(bounds.center);
    // The authored visible face lies toward local -X, so the preserved
    // tendril crown stays slightly in front of the portal and eyeball.
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

    this.portalRoot = new TransformNode(
      `${ownerRoot.name}:skyEyePortal`,
      scene
    );
    this.portalRoot.parent = ownerRoot;
    this.portalRoot.position.copyFrom(bounds.center);

    // The shared portal controller reads authored bounds once. A short-lived
    // proxy gives it stable eye-sized bounds without coupling the shader to
    // animated eyelid or eyeball transforms.
    const portalDiameter = eyeDiameter * config.portalVisualScale;
    const portalBounds = MeshBuilder.CreateBox(
      `${ownerRoot.name}:skyEyePortalBounds`,
      {
        width: Math.max(0.001, portalDiameter * config.portalDepthScale),
        height: portalDiameter,
        depth: portalDiameter,
      },
      scene
    );
    portalBounds.parent = this.portalRoot;
    portalBounds.isVisible = false;
    portalBounds.visibility = 0;
    portalBounds.isPickable = false;
    portalBounds.renderingGroupId = source?.renderingGroupId ?? 0;
    portalBounds.layerMask = source?.layerMask ?? 0x0fffffff;

    this.portal = new ShadowGrabberFxController(
      scene,
      this.portalRoot,
      portalBounds,
      config.fxQuality === "high" ? "high" : "low",
      smokeSystem,
      config.portalFx
    );
    this.portal.setState("hunt");
    this.portal.setOwnerEnabled(false);
    this.portal.playSpawn();
    portalBounds.dispose(false, false);
    this.fxRoot.setEnabled(false);
  }

  public get meshes(): readonly AbstractMesh[] {
    return this.visualMeshes;
  }

  public setPresentationProgress(progress: SkyEyePresentationProgress) {
    const disc = clamp01(progress.disc);
    const smoke = clamp01(progress.smoke);
    const tendrils = clamp01(progress.tendrils);
    const eye = clamp01(progress.eye);
    this.portal.setFormationProgress(disc, smoke);

    this.tendrilRoot.setEnabled(tendrils > 0.001);
    this.tendrilRoot.scaling.setAll(0.04 + tendrils * 0.96);
    this.tendrilMaterial.alpha = tendrils;
    this.tendrilMaterial.transparencyMode =
      tendrils >= 0.999
        ? Material.MATERIAL_OPAQUE
        : Material.MATERIAL_ALPHABLEND;

    this.eyeModelRoot.setEnabled(eye > 0.001);
    this.eyeModelRoot.position.copyFrom(this.eyeModelBasePosition);
    this.eyeModelRoot.position.x += this.eyeEmergenceDepth * (1 - eye);
    this.eyeModelRoot.scaling.copyFrom(this.eyeModelBaseScaling);
    this.eyeModelRoot.scaling.scaleInPlace(0.56 + eye * 0.44);
  }

  public setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.fxRoot.setEnabled(enabled);
    this.portal.setOwnerEnabled(enabled);
  }

  public beginDeath() {
    this.portal.setState("lightRecoil");
  }

  public setDeathAppearance(grayProgress: number, fadeProgress: number) {
    this.portal.setDeathDissolve(
      getSkyEyePortalDeathProgress(grayProgress, fadeProgress)
    );
    Color3.LerpToRef(
      TENDRIL_EMISSIVE,
      ASHEN_TENDRIL_EMISSIVE,
      grayProgress,
      this.tendrilMaterial.emissiveColor
    );
    if (fadeProgress > 0) {
      if (this.tendrilMaterial.transparencyMode !== Material.MATERIAL_ALPHABLEND) {
        this.tendrilMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
      }
      this.tendrilMaterial.alpha = Math.max(0, 1 - fadeProgress);
    }
    if (fadeProgress >= 1) this.setEnabled(false);
  }

  public update(deltaTimeSeconds: number) {
    if (!this.enabled) return;
    const delta = Math.max(0, Math.min(deltaTimeSeconds, 0.1));
    this.elapsed += delta;
    this.portal.update(delta);
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
    this.portal.dispose();
    this.portalRoot.dispose(false, false);
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
    material.emissiveColor = TENDRIL_EMISSIVE.clone();
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
