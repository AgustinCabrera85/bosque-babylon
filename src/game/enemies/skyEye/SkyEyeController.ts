import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Material } from "@babylonjs/core/Materials/material";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { BlackSmokeWrapSystem } from "../../BlackSmokeWrapSystem";
import { BaseEnemyController } from "../core/EnemyController";
import type {
  EnemyControllerContext,
  EnemySpawnOptions,
} from "../core/EnemyTypes";
import {
  SKY_EYE_TYPE,
  type SkyEyeConfig,
} from "./SkyEyeConfig";
import {
  SkyEyeFxController,
  type SkyEyePresentationProgress,
} from "./SkyEyeFxController";

const SKY_EYE_EMISSIVE_INTENSITY = 3;
const MAX_HEALTH = 18; // Eighteen light orbs at base projectile damage.

type DeathMaterialState = {
  material: PBRMaterial | StandardMaterial;
  curves: ColorCurves;
  saturation: number;
  alpha: number;
  emissiveIntensity: number;
};

function hasSourceName(instanceName: string, sourceName: string) {
  return instanceName === sourceName || instanceName.endsWith(`:${sourceName}`);
}

function moveAngle(current: number, target: number, amount: number) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * amount;
}

export class SkyEyeController extends BaseEnemyController {
  private readonly getTargetPosition: () => Vector3;
  private readonly scene: Scene;
  private readonly smokeSystem: BlackSmokeWrapSystem;
  private readonly eyeModelRoot: TransformNode;
  private readonly blinkAnimations: AnimationGroup[] = [];
  private readonly importedMeshes: AbstractMesh[] = [];
  private readonly deathMaterials: DeathMaterialState[] = [];
  private fxController: SkyEyeFxController | null = null;
  private idleAnimation: AnimationGroup | null = null;
  private blinkTimer = 0;
  private hasQueuedDoubleBlink = false;

  public constructor(
    context: EnemyControllerContext,
    options: EnemySpawnOptions,
    public readonly config: SkyEyeConfig,
    getTargetPosition: () => Vector3,
    smokeSystem: BlackSmokeWrapSystem
  ) {
    super(context, options, MAX_HEALTH);
    if (options.type !== SKY_EYE_TYPE) {
      throw new Error(`SkyEye ${this.id}: invalid enemy type ${options.type}`);
    }
    this.scene = context.scene;
    this.smokeSystem = smokeSystem;
    this.getTargetPosition = getTargetPosition;
    this.eyeModelRoot = new TransformNode(
      `skyEye:${this.id}:modelRoot`,
      context.scene
    );
    this.eyeModelRoot.parent = this.visualRoot;
    for (const node of this.asset.rootNodes) node.parent = this.eyeModelRoot;
    this.blinkTimer = this.randomInitialBlinkDelay();
    if (!options.scaling) this.root.scaling.setAll(config.baseScale);
  }

  public get meshes(): readonly AbstractMesh[] {
    return this.fxController
      ? [...this.importedMeshes, ...this.fxController.meshes]
      : this.importedMeshes;
  }

  public async initialize() {
    this.assertUsable();
    const eyeball = this.requireMesh(this.config.nodeNames.eyeball);
    const upperEyelid = this.requireMesh(this.config.nodeNames.upperEyelid);
    const lowerEyelid = this.requireMesh(this.config.nodeNames.lowerEyelid);
    this.importedMeshes.push(...this.asset.meshes);
    for (const mesh of this.importedMeshes) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      mesh.alwaysSelectAsActiveMesh = true;
      // The eye is a supernatural focal point: distance fog must not blend its
      // textured front into the almost-black background of the terminal area.
      mesh.applyFog = false;
      if (mesh.material instanceof PBRMaterial) {
        // Preserve the requested metallic workflow values while rendering the
        // authored color independently from scene lights and environment IBL.
        mesh.material.metallic = 1;
        mesh.material.roughness = 1;
        mesh.material.unlit = true;
        mesh.material.disableLighting = true;
        mesh.material.directIntensity = 0;
        mesh.material.environmentIntensity = 0;
        mesh.material.fogEnabled = false;
        mesh.material.emissiveTexture = mesh.material.albedoTexture;
        mesh.material.emissiveColor = mesh.material.albedoTexture
          ? Color3.White()
          : mesh.material.albedoColor.clone();
        mesh.material.emissiveIntensity = SKY_EYE_EMISSIVE_INTENSITY;
        mesh.material.maxSimultaneousLights = 0;
      }
    }

    this.idleAnimation = this.requireAnimation(
      this.config.animationGroupNames.idle
    );
    this.blinkAnimations.push(
      this.requireAnimation(this.config.animationGroupNames.upperBlink),
      this.requireAnimation(this.config.animationGroupNames.lowerBlink)
    );
    if (this.config.fxQuality !== "off") {
      this.fxController = new SkyEyeFxController(
        this.scene,
        this.visualRoot,
        this.eyeModelRoot,
        [eyeball, upperEyelid, lowerEyelid],
        this.config,
        this.smokeSystem
      );
    }
    this.completeInitialization();
    this.fxController?.setEnabled(this.enabled);
    if (this.enabled) this.resumeAnimations();
  }

  public update(deltaTimeSeconds: number) {
    if (!this.enabled) return;
    const delta = Math.max(0, Math.min(deltaTimeSeconds, 0.1));
    this.turnToward(this.getTargetPosition(), delta);
    this.fxController?.update(delta);

    this.blinkTimer -= delta;
    if (this.blinkTimer <= 0) {
      this.playBlink();
      if (this.hasQueuedDoubleBlink) {
        this.hasQueuedDoubleBlink = false;
        this.blinkTimer = this.randomBlinkInterval();
      } else if (Math.random() < this.config.doubleBlinkChance) {
        this.hasQueuedDoubleBlink = true;
        this.blinkTimer = this.randomBetween(
          this.config.doubleBlinkMinDelay,
          this.config.doubleBlinkMaxDelay
        );
      } else {
        this.blinkTimer = this.randomBlinkInterval();
      }
    }
  }

  public override setEnabled(enabled: boolean) {
    const wasEnabled = this.enabled;
    super.setEnabled(enabled);
    this.fxController?.setEnabled(this.enabled);
    if (wasEnabled === this.enabled || !this.idleAnimation) return;
    if (this.enabled) {
      this.resumeAnimations();
      return;
    }
    this.idleAnimation.pause();
    this.hasQueuedDoubleBlink = false;
    this.blinkTimer = this.randomInitialBlinkDelay();
    for (const group of this.blinkAnimations) {
      if (group.isStarted) group.stop(true);
      group.reset();
    }
  }

  public snapLookAt(target: Vector3) {
    this.turnToward(target, 1, true);
  }

  public setPresentationProgress(progress: SkyEyePresentationProgress) {
    if (this.fxController) {
      this.fxController.setPresentationProgress(progress);
      return;
    }
    const eye = Math.max(0, Math.min(1, progress.eye));
    this.eyeModelRoot.setEnabled(eye > 0.001);
    this.eyeModelRoot.scaling.setAll(0.56 + eye * 0.44);
  }

  protected override onDispose() {
    this.fxController?.dispose();
    this.fxController = null;
    this.deathMaterials.length = 0;
    this.idleAnimation = null;
    this.blinkAnimations.length = 0;
    this.importedMeshes.length = 0;
  }

  protected override get deathVisualStyle(): "ashenFade" {
    return "ashenFade";
  }

  protected override onDeath() {
    this.fxController?.beginDeath();
    for (const material of this.asset.materials) {
      if (!(material instanceof PBRMaterial || material instanceof StandardMaterial)) continue;
      const processing = material.imageProcessingConfiguration.clone();
      const curves = processing.colorCurves?.clone() ?? new ColorCurves();
      processing.colorCurves = curves;
      processing.colorCurvesEnabled = true;
      material.imageProcessingConfiguration = processing;
      this.deathMaterials.push({
        material,
        curves,
        saturation: curves.globalSaturation,
        alpha: material.alpha,
        emissiveIntensity: material instanceof PBRMaterial ? material.emissiveIntensity : 0,
      });
    }
  }

  protected override onDeathProgress(grayProgress: number, fadeProgress: number) {
    const gray = grayProgress * grayProgress * (3 - 2 * grayProgress);
    for (const state of this.deathMaterials) {
      state.curves.globalSaturation = state.saturation + (-100 - state.saturation) * gray;
      if (state.material instanceof PBRMaterial) {
        state.material.emissiveIntensity = state.emissiveIntensity * (1 - gray * 0.6);
      }
      if (fadeProgress > 0) {
        if (state.material.transparencyMode !== Material.MATERIAL_ALPHABLEND) {
          state.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
        }
        state.material.alpha = state.alpha * (1 - fadeProgress);
      }
    }
    this.fxController?.setDeathAppearance(gray, fadeProgress);
  }

  private turnToward(target: Vector3, deltaTime: number, snap = false) {
    const direction = target.subtract(this.root.position);
    const horizontal = Math.hypot(direction.x, direction.z);
    if (horizontal < 0.0001 && Math.abs(direction.y) < 0.0001) return;

    const desiredYaw =
      Math.atan2(direction.x, direction.z) + this.config.lookYawOffset;
    const desiredPitch = Math.max(
      -this.config.maxLookPitch,
      Math.min(
        this.config.maxLookPitch,
        -Math.atan2(direction.y, horizontal) + this.config.lookPitchOffset
      )
    );
    const amount = snap
      ? 1
      : 1 - Math.exp(-this.config.lookSpeed * Math.max(0, deltaTime));
    this.root.rotationQuaternion = null;
    this.root.rotation.y = moveAngle(this.root.rotation.y, desiredYaw, amount);
    // The authored eye faces along local X. Rotating X therefore rolls the
    // eyelids; vertical tracking belongs on local Z so the eye stays upright.
    this.root.rotation.x = 0;
    this.root.rotation.z += (desiredPitch - this.root.rotation.z) * amount;
  }

  private resumeAnimations() {
    const idle = this.idleAnimation;
    if (!idle) return;
    // This group only animates the eyeball, so it stays alive while the two
    // eyelid groups play independently on top of it.
    idle.loopAnimation = true;
    if (idle.isStarted) idle.play(true);
    else idle.start(true, 1);
  }

  private playBlink() {
    const speedRatio = this.randomBetween(
      this.config.blinkSpeedMin,
      this.config.blinkSpeedMax
    );
    for (const group of this.blinkAnimations) {
      if (group.isStarted) group.stop(true);
      group.start(false, speedRatio);
    }
  }

  private randomBlinkInterval() {
    const firstRoll = Math.random();
    const secondRoll = Math.random();
    const centeredRoll = (firstRoll + secondRoll) * 0.5;
    return this.randomBetween(
      this.config.blinkMinInterval,
      this.config.blinkMaxInterval,
      centeredRoll
    );
  }

  private randomInitialBlinkDelay() {
    return this.randomBetween(1.35, 2.65);
  }

  private randomBetween(minimum: number, maximum: number, roll = Math.random()) {
    const min = Math.min(minimum, maximum);
    const max = Math.max(minimum, maximum);
    return min + (max - min) * Math.max(0, Math.min(1, roll));
  }

  private requireMesh(sourceName: string) {
    const mesh = this.asset.meshes.find((candidate) =>
      hasSourceName(candidate.name, sourceName)
    );
    if (!mesh) throw new Error(`SkyEye ${this.id}: missing mesh ${sourceName}`);
    return mesh;
  }

  private requireAnimation(sourceName: string) {
    const animation = this.asset.animationGroups.find((candidate) =>
      hasSourceName(candidate.name, sourceName)
    );
    if (!animation) {
      throw new Error(`SkyEye ${this.id}: missing animation ${sourceName}`);
    }
    animation.stop();
    return animation;
  }
}
