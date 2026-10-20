import { MixamoProceduralRig } from "../../animation/MixamoProceduralRig";
import { HermanoMayorLookAction } from "../boss/HermanoMayorLookAction";
import { BaseEnemyController } from "../core/EnemyController";
import type { EnemyControllerContext, EnemySpawnOptions } from "../core/EnemyTypes";
import { RinaAnimationController } from "./RinaAnimations";
import { RINA_SOURCE_HEIGHT, RINA_TYPE, type RinaConfig } from "./RinaConfig";
import { RinaFacialExpressions } from "./RinaFacialExpressions";
import { RinaEyeTracking } from "./RinaEyeTracking";
import { RinaMaterialLighting } from "./RinaMaterialLighting";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

/** Asset and animation handle for Rina's future level encounter. */
export class RinaController extends BaseEnemyController {
  public readonly animations: RinaAnimationController;
  public readonly face: RinaFacialExpressions;
  public readonly rig: MixamoProceduralRig;
  public readonly eyes: RinaEyeTracking;
  private readonly look: HermanoMayorLookAction;
  private readonly lighting: RinaMaterialLighting;
  private readonly scene: Scene;
  private readonly eyeObserver: Observer<Scene>;

  constructor(
    context: EnemyControllerContext,
    options: EnemySpawnOptions,
    public readonly config: RinaConfig,
    private readonly getPlayerPosition?: () => Vector3
  ) {
    super(context, options, config.maxHealth);
    if (options.type !== RINA_TYPE) {
      throw new Error(`Rina ${this.id}: invalid enemy type ${options.type}`);
    }
    this.scene = context.scene;
    this.visualRoot.scaling.setAll(config.height / RINA_SOURCE_HEIGHT);
    this.animations = new RinaAnimationController(this.asset.animationGroups);
    this.face = new RinaFacialExpressions(this.asset.meshes);
    this.rig = new MixamoProceduralRig(
      this.asset.meshes,
      this.asset.animationGroups,
      ["hips", "spine", "neck", "head"]
    );
    this.eyes = new RinaEyeTracking(this.asset.nodes);
    this.look = new HermanoMayorLookAction(
      context.scene, this.root, this.asset.meshes, {}, { allowBodyTurn: false }
    );
    this.look.setTargetProvider(() => this.getPlayerPosition?.() ?? null);
    this.lighting = new RinaMaterialLighting(this.asset.materials, this.root, config.height);
    // Resolve the eyes after the shared head overlay updates the animated pose.
    this.eyeObserver = context.scene.onAfterAnimationsObservable.add(() => {
      if (!this.enabled) return;
      this.eyes.update(
        this.getPlayerPosition?.() ?? null,
        Math.min(context.scene.getEngine().getDeltaTime() * 0.001, 0.05)
      );
    });
  }

  /** Standing height including any spawn-time root scale. */
  get height() { return this.config.height * Math.abs(this.root.scaling.y); }

  public async initialize() {
    this.assertUsable();
    if (!this.rig.available) {
      throw new Error(`Rina ${this.id}: Mixamo skeleton is unavailable`);
    }
    if (!this.face.getAvailableShapeKeys().includes("Blink_L")) {
      throw new Error(`Rina ${this.id}: facial shape keys are unavailable`);
    }
    for (const mesh of this.asset.meshes) {
      if (mesh.getTotalVertices() <= 0) continue;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
    }
    this.completeInitialization();
    this.animations.play("idle", { loop: true });
    if (!this.enabled) this.animations.pause();
    this.look.setEnabled(this.enabled);
  }

  public update(_deltaTimeSeconds: number) {
    this.lighting.update();
  }

  public override setEnabled(enabled: boolean) {
    const wasEnabled = this.enabled;
    super.setEnabled(enabled);
    if (wasEnabled === this.enabled) return;
    if (this.enabled) this.animations.resume();
    else this.animations.pause();
    this.look.setEnabled(this.enabled);
  }

  protected override onDeath() {
    this.animations.stop();
    this.look.setEnabled(false);
  }

  protected override onDispose() {
    this.animations.dispose();
    this.look.dispose();
    this.scene.onAfterAnimationsObservable.remove(this.eyeObserver);
  }
}
