import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Bone } from "@babylonjs/core/Bones/bone";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Axis, Space } from "@babylonjs/core/Maths/math.axis";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Node } from "@babylonjs/core/node";
import { BaseEnemyController } from "../core/EnemyController";
import type {
  EnemyControllerContext,
  EnemySpawnOptions,
} from "../core/EnemyTypes";
import {
  SHADOW_GRABBER_STATE_ANIMATION,
  SHADOW_GRABBER_TYPE,
  ShadowGrabberState,
  type ShadowGrabberAnimation,
  type ShadowGrabberConfig,
} from "./ShadowGrabberConfig";

export interface ShadowGrabberAnimationOptions {
  loop?: boolean;
  speedRatio?: number;
  restart?: boolean;
}

function hasSourceName(instanceName: string, sourceName: string) {
  return instanceName === sourceName || instanceName.endsWith(`:${sourceName}`);
}

function applyPbrConfig(
  material: PBRMaterial,
  config: ShadowGrabberConfig["armMaterial"]
) {
  material.albedoColor = Color3.FromArray(config.albedo);
  material.metallic = config.metallic;
  material.roughness = config.roughness;
  material.environmentIntensity = config.environmentIntensity;
  material.emissiveColor.setAll(0);
  material.alpha = 1;
  material.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
}

export class ShadowGrabberController extends BaseEnemyController {
  private readonly animations = new Map<ShadowGrabberAnimation, AnimationGroup>();
  private readonly anchorPosition: Vector3;
  private portalRotationSpeed: number;
  private currentState = ShadowGrabberState.Idle;
  private currentAnimation: ShadowGrabberAnimation | null = null;
  private resolvedArmatureRoot: Node | null = null;
  private resolvedArmMesh: AbstractMesh | null = null;
  private resolvedPortalMesh: AbstractMesh | null = null;
  private resolvedSkeleton: Skeleton | null = null;
  private resolvedAttackPointBone: Bone | null = null;
  private resolvedFxRoot: TransformNode | null = null;
  private portalRootYOffset = 0;

  public constructor(
    context: EnemyControllerContext,
    options: EnemySpawnOptions,
    public readonly config: ShadowGrabberConfig
  ) {
    super(context, options);
    if (options.type !== SHADOW_GRABBER_TYPE) {
      throw new Error(`ShadowGrabber ${this.id}: invalid enemy type ${options.type}`);
    }
    this.anchorPosition = options.position.clone();
    this.portalRotationSpeed = config.portalRotationSpeed;
    if (!options.scaling) this.root.scaling.setAll(config.baseScale);
  }

  public get state() {
    return this.currentState;
  }

  public get portalMesh() {
    return this.resolvedPortalMesh;
  }

  public get armMesh() {
    return this.resolvedArmMesh;
  }

  public get armatureRoot() {
    return this.resolvedArmatureRoot;
  }

  public get skeleton() {
    return this.resolvedSkeleton;
  }

  public get fxRoot() {
    return this.resolvedFxRoot;
  }

  public async initialize() {
    this.assertUsable();
    this.resolvedArmatureRoot = this.requireNode(this.config.nodeNames.armatureRoot);
    this.resolvedArmMesh = this.requireMesh(this.config.nodeNames.armMesh);
    this.resolvedPortalMesh = this.requireMesh(this.config.nodeNames.portalMesh);
    this.resolvedSkeleton = this.requireSkeleton(this.config.nodeNames.skeleton);
    this.resolvedAttackPointBone =
      this.resolvedSkeleton.bones.find((bone) =>
        hasSourceName(bone.name, this.config.nodeNames.attackPointBone)
      ) ?? null;
    if (!this.resolvedAttackPointBone) {
      throw new Error(
        `ShadowGrabber ${this.id}: missing attack point bone ${this.config.nodeNames.attackPointBone}`
      );
    }
    this.resolveAnimations();
    this.configureMaterials();
    this.createFxRoot();
    this.measurePortalRootOffset();
    this.completeInitialization();
    this.setState(ShadowGrabberState.Idle);
  }

  public update(deltaTimeSeconds: number) {
    if (!this.enabled || !this.resolvedPortalMesh) return;
    const delta = Math.max(0, Math.min(deltaTimeSeconds, 0.1));
    this.resolvedPortalMesh.rotate(
      Axis.X,
      this.portalRotationSpeed * delta,
      Space.LOCAL
    );
  }

  public setState(state: ShadowGrabberState) {
    this.ensureInitialized();
    this.currentState = state;
    this.playAnimation(SHADOW_GRABBER_STATE_ANIMATION[state], { restart: true });
  }

  public playAnimation(
    animation: ShadowGrabberAnimation,
    options: ShadowGrabberAnimationOptions = {}
  ) {
    this.ensureInitialized();
    const group = this.animations.get(animation);
    if (!group) {
      throw new Error(`ShadowGrabber ${this.id}: animation ${animation} is unavailable`);
    }

    const loop = options.loop ?? this.config.animationLoop[animation];
    const speedRatio = options.speedRatio ?? this.config.animationSpeed[animation];
    const restart = options.restart ?? false;
    for (const [name, otherGroup] of this.animations) {
      if (name !== animation && otherGroup.isStarted) otherGroup.stop(true);
    }
    this.currentAnimation = animation;
    group.loopAnimation = loop;
    group.speedRatio = speedRatio;
    if (!this.enabled) return;

    if (group.isStarted && !restart) {
      if (!group.isPlaying) group.play(loop);
      return;
    }
    if (group.isStarted) group.stop(true);
    group.start(loop, speedRatio);
  }

  public stopAnimation(animation: ShadowGrabberAnimation) {
    const group = this.animations.get(animation);
    if (!group) return;
    group.stop(true);
    if (this.currentAnimation === animation) this.currentAnimation = null;
  }

  public stopAllAnimations() {
    for (const group of this.animations.values()) group.stop(true);
    this.currentAnimation = null;
  }

  public getCurrentAnimation() {
    return this.currentAnimation;
  }

  public setAnchorPosition(position: Vector3) {
    this.anchorPosition.copyFrom(position);
  }

  public getAnchorPosition() {
    return this.anchorPosition.clone();
  }

  /** Positions the portal center in world space; callers never need asset-local offsets. */
  public setPortalCenterWorldPosition(position: Vector3) {
    this.root.position.set(position.x, position.y - this.portalRootYOffset, position.z);
  }

  public getPortalCenterWorldPositionToRef(result: Vector3) {
    if (!this.resolvedPortalMesh) return false;
    this.root.computeWorldMatrix(true);
    this.resolvedPortalMesh.computeWorldMatrix(true);
    result.copyFrom(this.resolvedPortalMesh.getAbsolutePosition());
    return true;
  }

  /** Returns the animated palm position used by the cheap swept hit test. */
  public getAttackPointWorldPositionToRef(result: Vector3) {
    if (!this.resolvedAttackPointBone || !this.resolvedArmMesh || !this.resolvedSkeleton) {
      return false;
    }
    this.root.computeWorldMatrix(true);
    this.resolvedArmMesh.computeWorldMatrix(true);
    this.resolvedSkeleton.prepare(true);
    this.resolvedAttackPointBone.getAbsolutePositionToRef(this.resolvedArmMesh, result);
    return true;
  }

  /** Turns only the logical root. The authored arm bones remain animation-owned. */
  public turnToward(target: Vector3, maxRadians: number) {
    const dx = target.x - this.root.position.x;
    const dz = target.z - this.root.position.z;
    if (dx * dx + dz * dz <= 0.000001) return;
    const localForwardAngle = Math.atan2(
      this.config.attackForwardAxis[0],
      this.config.attackForwardAxis[1]
    );
    const desiredYaw = Math.atan2(dx, dz) - localForwardAngle;
    const delta = Math.atan2(
      Math.sin(desiredYaw - this.root.rotation.y),
      Math.cos(desiredYaw - this.root.rotation.y)
    );
    this.root.rotationQuaternion = null;
    this.root.rotation.y += Math.max(-maxRadians, Math.min(maxRadians, delta));
  }

  public setPortalRotationSpeed(speedRadiansPerSecond: number) {
    if (!Number.isFinite(speedRadiansPerSecond)) {
      throw new Error(`ShadowGrabber ${this.id}: portal rotation speed must be finite`);
    }
    this.portalRotationSpeed = speedRadiansPerSecond;
  }

  public override setEnabled(enabled: boolean) {
    const wasEnabled = this.enabled;
    super.setEnabled(enabled);
    if (!this.resolvedPortalMesh || wasEnabled === enabled) return;

    if (!enabled) {
      for (const group of this.animations.values()) {
        if (group.isPlaying) group.pause();
      }
      return;
    }

    if (this.currentAnimation) {
      const group = this.animations.get(this.currentAnimation);
      if (!group) return;
      group.speedRatio = this.config.animationSpeed[this.currentAnimation];
      group.play(this.config.animationLoop[this.currentAnimation]);
    }
  }

  public debugLogAnimations() {
    console.info(`ShadowGrabber ${this.id} asset`, {
      meshes: this.asset.meshes.map((mesh) => mesh.name),
      skeletons: this.asset.skeletons.map((skeleton) => skeleton.name),
      animationGroups: this.asset.animationGroups.map((group) => group.name),
    });
  }

  protected override onDispose() {
    this.currentAnimation = null;
    this.animations.clear();
    this.resolvedArmatureRoot = null;
    this.resolvedArmMesh = null;
    this.resolvedPortalMesh = null;
    this.resolvedSkeleton = null;
    this.resolvedAttackPointBone = null;
    this.resolvedFxRoot = null;
  }

  private resolveAnimations() {
    const animationNames = Object.entries(this.config.animationGroupNames) as [
      ShadowGrabberAnimation,
      string,
    ][];
    for (const [animation, sourceName] of animationNames) {
      const group = this.asset.animationGroups.find((candidate) =>
        hasSourceName(candidate.name, sourceName)
      );
      if (!group) {
        throw new Error(
          `ShadowGrabber ${this.id}: missing animation group ${sourceName}`
        );
      }
      this.animations.set(animation, group);
    }
  }

  private configureMaterials() {
    const armMesh = this.resolvedArmMesh;
    const portalMesh = this.resolvedPortalMesh;
    if (!armMesh || !portalMesh) return;
    if (!(armMesh.material instanceof PBRMaterial)) {
      throw new Error(`ShadowGrabber ${this.id}: arm material is not a PBRMaterial`);
    }
    applyPbrConfig(armMesh.material, this.config.armMaterial);

    const portalMaterial = this.ownMaterial(
      new PBRMaterial(`shadowGrabber:${this.id}:portalMaterial`, this.root.getScene())
    );
    applyPbrConfig(portalMaterial, this.config.portalMaterial);
    portalMesh.material = portalMaterial;
  }

  private createFxRoot() {
    const portalMesh = this.resolvedPortalMesh;
    if (!portalMesh) return;
    const fxRoot = new TransformNode(`shadowGrabber:${this.id}:fxRoot`, this.root.getScene());
    fxRoot.parent = this.root;

    this.root.computeWorldMatrix(true);
    portalMesh.computeWorldMatrix(true);
    const inverseRoot = Matrix.Invert(this.root.getWorldMatrix());
    Vector3.TransformCoordinatesToRef(
      portalMesh.getAbsolutePosition(),
      inverseRoot,
      fxRoot.position
    );
    this.resolvedFxRoot = fxRoot;
  }

  private measurePortalRootOffset() {
    const portalMesh = this.resolvedPortalMesh;
    if (!portalMesh) return;
    this.root.computeWorldMatrix(true);
    portalMesh.computeWorldMatrix(true);
    this.portalRootYOffset = portalMesh.getAbsolutePosition().y - this.root.position.y;
  }

  private requireNode(sourceName: string) {
    const node = this.asset.nodes.find((candidate) =>
      hasSourceName(candidate.name, sourceName)
    );
    if (!node) throw new Error(`ShadowGrabber ${this.id}: missing node ${sourceName}`);
    return node;
  }

  private requireMesh(sourceName: string) {
    const mesh = this.asset.meshes.find((candidate) =>
      hasSourceName(candidate.name, sourceName)
    );
    if (!mesh) throw new Error(`ShadowGrabber ${this.id}: missing mesh ${sourceName}`);
    return mesh;
  }

  private requireSkeleton(sourceName: string) {
    const skeleton = this.asset.skeletons.find((candidate) =>
      hasSourceName(candidate.name, sourceName)
    );
    if (!skeleton) {
      throw new Error(`ShadowGrabber ${this.id}: missing skeleton ${sourceName}`);
    }
    return skeleton;
  }

  private ensureInitialized() {
    this.assertUsable();
    if (!this.resolvedPortalMesh) {
      throw new Error(`ShadowGrabber ${this.id}: controller is not initialized`);
    }
  }
}
