import { Engine } from "@babylonjs/core/Engines/engine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { BlackSmokeWrapSystem } from "../BlackSmokeWrapSystem";
import type { PlayerController } from "../PlayerController";
import {
  MixamoProceduralRig,
  type MixamoJointName,
} from "../animation/MixamoProceduralRig";
import type { HermanoMayorHandle } from "../enemies/boss/HermanoMayor";
import type { EnemyManager } from "../enemies/core/EnemyManager";
import {
  DEFAULT_SHADOW_GRABBER_CONFIG,
  SHADOW_GRABBER_TYPE,
  ShadowGrabberFxController,
  spawnShadowGrabber,
  type ShadowGrabberController,
} from "../enemies/shadowGrabber";
import { SkyEyeDefeatPortalVortex } from "./SkyEyeDefeatPortalVortex";

const PORTAL_DIAMETER = 9.6;
const PORTAL_DISTANCE_BEHIND_ACTOR = 4.25;
const ARM_COUNT = 13;
const ACTOR_FALL_ANGLE = Math.PI * 0.39;

const ABDUCTION_POSE_JOINTS = [
  "hips",
  "spine",
  "spine1",
  "spine2",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftArm",
  "rightArm",
  "leftForeArm",
  "rightForeArm",
  "leftHand",
  "rightHand",
  "leftUpLeg",
  "rightUpLeg",
  "leftLeg",
  "rightLeg",
  "leftFoot",
  "rightFoot",
] as const satisfies readonly MixamoJointName[];

export const SKY_EYE_DEFEAT_CINEMATIC_TIMING = {
  eyeDissolveFocusSeconds: 1.5,
  actorWalkStartSeconds: 0.35,
  actorWalkEndSeconds: 5.25,
  portalOpenStartSeconds: 2.05,
  portalOpenDurationSeconds: 1.85,
  handsStartSeconds: 3.65,
  gripStartSeconds: 5.15,
  fallStartSeconds: 6.85,
  fallDurationSeconds: 1.55,
  dragStartSeconds: 8.2,
  dragDurationSeconds: 3.9,
  handsRetractStartSeconds: 12.25,
  handsRetractDurationSeconds: 1.35,
  portalCloseStartSeconds: 13.9,
  portalCloseDurationSeconds: 2.05,
  completeSeconds: 16.65,
} as const;

export type SkyEyeDefeatCinematicState =
  | "waiting"
  | "presenting"
  | "complete";

export type SkyEyeDefeatCinematicFrame = {
  walkProgress: number;
  portalProgress: number;
  handsProgress: number;
  gripProgress: number;
  struggleProgress: number;
  fallProgress: number;
  dragProgress: number;
  liftProgress: number;
  handsRetractionProgress: number;
  closeProgress: number;
  complete: boolean;
};

export type CreateSkyEyeDefeatCinematicOptions = {
  player: PlayerController;
  actor: HermanoMayorHandle;
  enemyManager: EnemyManager;
  smokeSystem: BlackSmokeWrapSystem;
  portalQuality: "low" | "high";
  eyePosition: () => Vector3;
  stagePosition: Vector3;
  stageForward: Vector3;
  getGroundHeight: (x: number, z: number) => number;
  onStart?: () => void;
  onComplete?: () => void;
};

type SkyEyeDefeatCinematicOptions = Omit<
  CreateSkyEyeDefeatCinematicOptions,
  "enemyManager"
> & {
  arms: ShadowGrabberController[];
};

type HandLayout = {
  portalRight: number;
  portalUp: number;
  targetRight: number;
  targetHeight: number;
  targetJoint: MixamoJointName;
  targetOutset: number;
  targetDepth: number;
  delay: number;
  scale: number;
  finalCaptor?: boolean;
};

type CinematicHand = {
  controller: ShadowGrabberController;
  layout: HandLayout;
  origin: Vector3;
  activated: boolean;
  stretch: number;
  contactError: number;
  phaseStartedAt: number;
  phase: "hidden" | "extend" | "grab" | "hold" | "retract";
};

const HAND_LAYOUTS: readonly HandLayout[] = [
  {
    portalRight: -3.15,
    portalUp: 1.35,
    targetRight: -0.55,
    targetHeight: 0.76,
    targetJoint: "leftForeArm",
    targetOutset: -0.07,
    targetDepth: 0.02,
    delay: 0,
    scale: 0.72,
  },
  {
    portalRight: 3.05,
    portalUp: 1.55,
    targetRight: 0.56,
    targetHeight: 0.73,
    targetJoint: "rightForeArm",
    targetOutset: 0.07,
    targetDepth: 0.02,
    delay: 0.1,
    scale: 1.05,
  },
  {
    portalRight: -1.65,
    portalUp: 3.3,
    targetRight: -0.22,
    targetHeight: 0.94,
    targetJoint: "leftShoulder",
    targetOutset: -0.04,
    targetDepth: 0.04,
    delay: 0.2,
    scale: 0.88,
  },
  {
    portalRight: 1.45,
    portalUp: 3.45,
    targetRight: 0.23,
    targetHeight: 0.91,
    targetJoint: "rightShoulder",
    targetOutset: 0.04,
    targetDepth: 0.04,
    delay: 0.3,
    scale: 1.18,
  },
  {
    portalRight: -3.35,
    portalUp: -0.4,
    targetRight: -0.38,
    targetHeight: 0.51,
    targetJoint: "leftUpLeg",
    targetOutset: -0.05,
    targetDepth: 0.025,
    delay: 0.4,
    scale: 0.8,
  },
  {
    portalRight: 3.3,
    portalUp: -0.25,
    targetRight: 0.39,
    targetHeight: 0.49,
    targetJoint: "rightUpLeg",
    targetOutset: 0.05,
    targetDepth: 0.025,
    delay: 0.5,
    scale: 1.12,
  },
  {
    portalRight: -2.25,
    portalUp: -2.55,
    targetRight: -0.29,
    targetHeight: 0.3,
    targetJoint: "leftLeg",
    targetOutset: -0.045,
    targetDepth: 0.015,
    delay: 0.6,
    scale: 0.7,
  },
  {
    portalRight: 2.15,
    portalUp: -2.7,
    targetRight: 0.3,
    targetHeight: 0.29,
    targetJoint: "rightLeg",
    targetOutset: 0.045,
    targetDepth: 0.015,
    delay: 0.7,
    scale: 1,
  },
  {
    portalRight: -0.55,
    portalUp: 3.65,
    targetRight: -0.08,
    targetHeight: 1.01,
    targetJoint: "head",
    targetOutset: -0.025,
    targetDepth: 0.055,
    delay: 0.82,
    scale: 0.78,
  },
  {
    portalRight: 0.5,
    portalUp: -3.55,
    targetRight: 0.1,
    targetHeight: 0.12,
    targetJoint: "hips",
    targetOutset: 0.08,
    targetDepth: 0.05,
    delay: 0.92,
    scale: 0.92,
  },
  {
    portalRight: -3.65,
    portalUp: 0.45,
    targetRight: -0.62,
    targetHeight: 0.62,
    targetJoint: "leftHand",
    targetOutset: -0.035,
    targetDepth: 0.01,
    delay: 1.02,
    scale: 1.22,
  },
  {
    portalRight: 3.6,
    portalUp: 0.65,
    targetRight: 0.63,
    targetHeight: 0.59,
    targetJoint: "rightHand",
    targetOutset: 0.035,
    targetDepth: 0.01,
    delay: 1.12,
    scale: 0.84,
  },
  {
    portalRight: 0,
    portalUp: 0.15,
    targetRight: 0,
    targetHeight: 0.66,
    targetJoint: "spine1",
    targetOutset: 0,
    targetDepth: 0.16,
    delay: 3.8,
    scale: 1.72,
    finalCaptor: true,
  },
] as const;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
}

function progressBetween(elapsed: number, start: number, duration: number) {
  return smoothstep01((elapsed - start) / Math.max(0.0001, duration));
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function dampedShock(
  elapsed: number,
  start: number,
  duration: number,
  oscillations: number
) {
  const normalized = (elapsed - start) / Math.max(0.0001, duration);
  if (normalized <= 0 || normalized >= 1) return 0;
  return (
    Math.sin(normalized * Math.PI * oscillations) *
    Math.sin(normalized * Math.PI) *
    Math.exp(-normalized * 2.65)
  );
}

export function sampleSkyEyeDefeatCinematic(
  elapsedSeconds: number
): SkyEyeDefeatCinematicFrame {
  const elapsed = Math.max(0, elapsedSeconds);
  const timing = SKY_EYE_DEFEAT_CINEMATIC_TIMING;
  const openProgress = progressBetween(
    elapsed,
    timing.portalOpenStartSeconds,
    timing.portalOpenDurationSeconds
  );
  const closeProgress = progressBetween(
    elapsed,
    timing.portalCloseStartSeconds,
    timing.portalCloseDurationSeconds
  );
  return {
    walkProgress: progressBetween(
      elapsed,
      timing.actorWalkStartSeconds,
      timing.actorWalkEndSeconds - timing.actorWalkStartSeconds
    ),
    portalProgress: openProgress * (1 - closeProgress),
    handsProgress: progressBetween(
      elapsed,
      timing.handsStartSeconds,
      timing.gripStartSeconds - timing.handsStartSeconds
    ),
    gripProgress: progressBetween(
      elapsed,
      timing.gripStartSeconds,
      timing.fallStartSeconds - timing.gripStartSeconds
    ),
    struggleProgress: progressBetween(
      elapsed,
      timing.gripStartSeconds,
      timing.fallStartSeconds - timing.gripStartSeconds
    ),
    fallProgress: progressBetween(
      elapsed,
      timing.fallStartSeconds,
      timing.fallDurationSeconds
    ),
    dragProgress: progressBetween(
      elapsed,
      timing.dragStartSeconds,
      timing.dragDurationSeconds
    ),
    liftProgress: progressBetween(
      progressBetween(elapsed, timing.dragStartSeconds, timing.dragDurationSeconds),
      0.5,
      0.38
    ),
    handsRetractionProgress: progressBetween(
      elapsed,
      timing.handsRetractStartSeconds,
      timing.handsRetractDurationSeconds
    ),
    closeProgress,
    complete: elapsed >= timing.completeSeconds,
  };
}

/**
 * Final lake vignette: the defeated eye fades, a large shared void opens and
 * several real Shadow Grabber rigs pull the Hermano Mayor through it.
 */
export class SkyEyeDefeatCinematic {
  private readonly player: PlayerController;
  private readonly actor: HermanoMayorHandle;
  private readonly arms: ShadowGrabberController[];
  private readonly eyePosition: () => Vector3;
  private readonly getGroundHeight: (x: number, z: number) => number;
  private readonly onStart?: () => void;
  private readonly onComplete?: () => void;
  private readonly stagePosition: Vector3;
  private readonly stageForward: Vector3;
  private readonly stageRight = Vector3.Zero();
  private readonly portalRoot: TransformNode;
  private readonly portalFx: ShadowGrabberFxController;
  private readonly portalGlow: Mesh;
  private readonly portalGlowMaterial: StandardMaterial;
  private readonly portalVortex: SkyEyeDefeatPortalVortex;
  private readonly portalLight: PointLight;
  private readonly actorFrontLight: PointLight;
  private readonly portalCenter = Vector3.Zero();
  private readonly entryCameraPosition = Vector3.Zero();
  private readonly entryCameraTarget = Vector3.Zero();
  private readonly stagedCameraPosition = Vector3.Zero();
  private readonly stagedCameraTarget = Vector3.Zero();
  private readonly cameraPosition = Vector3.Zero();
  private readonly cameraTarget = Vector3.Zero();
  private readonly actorWalkStartPosition = Vector3.Zero();
  private readonly actorWalkPosition = Vector3.Zero();
  private readonly actorStartPosition = Vector3.Zero();
  private readonly actorStartRotation = Vector3.Zero();
  private readonly actorStartScaling = Vector3.One();
  private readonly actorDestination = Vector3.Zero();
  private readonly handTarget = Vector3.Zero();
  private readonly handApproachTarget = Vector3.Zero();
  private readonly handDirection = Vector3.Zero();
  private readonly handPalm = Vector3.Zero();
  private readonly handCorrection = Vector3.Zero();
  private readonly actorBodyUp = Vector3.Up();
  private readonly hands: CinematicHand[] = [];
  private actorRig: MixamoProceduralRig | null = null;
  private actorPoseApplied = false;
  private actorMotionPhase: "walk" | "idle" | "resist" | "fallen" = "idle";
  private beforeAnimationsObserver: Observer<Scene> | null = null;
  private currentState: SkyEyeDefeatCinematicState = "waiting";
  private elapsed = 0;
  private portalOpeningAnnounced = false;
  private actorHeight = 3;
  private actorWidth = 1.2;
  private actorGroundOffset = 0;
  private disposed = false;
  private handsDisposed = false;

  public constructor(scene: Scene, options: SkyEyeDefeatCinematicOptions) {
    this.player = options.player;
    this.actor = options.actor;
    this.arms = options.arms;
    this.eyePosition = options.eyePosition;
    this.getGroundHeight = options.getGroundHeight;
    this.onStart = options.onStart;
    this.onComplete = options.onComplete;
    this.stagePosition = options.stagePosition.clone();
    this.stageForward = options.stageForward.clone();
    this.stageForward.y = 0;
    if (this.stageForward.lengthSquared() <= 0.0001) {
      this.stageForward.set(0, 0, -1);
    } else {
      this.stageForward.normalize();
    }
    this.stageRight.set(
      this.stageForward.z,
      0,
      -this.stageForward.x
    ).normalize();

    this.portalRoot = new TransformNode("skyEyeDefeatPortalRoot", scene);
    this.portalRoot.setEnabled(false);
    const portalBounds = MeshBuilder.CreateBox(
      "skyEyeDefeatPortalBounds",
      {
        width: PORTAL_DIAMETER * 0.1,
        height: PORTAL_DIAMETER,
        depth: PORTAL_DIAMETER,
      },
      scene
    );
    portalBounds.parent = this.portalRoot;
    portalBounds.isVisible = false;
    portalBounds.visibility = 0;
    portalBounds.isPickable = false;
    this.portalFx = new ShadowGrabberFxController(
      scene,
      this.portalRoot,
      portalBounds,
      options.portalQuality,
      options.smokeSystem,
      {
        ...DEFAULT_SHADOW_GRABBER_CONFIG.portalFx,
        spectralTint: [1, 0.018, 0.006],
        spectralTintStrength: 0.92,
        lightIntensity: 0.42,
        lightRange: 13,
      }
    );
    this.portalFx.setState("hunt");
    this.portalFx.setOwnerEnabled(false);
    this.portalFx.setFormationProgress(0, 0);
    portalBounds.dispose(false, false);

    this.portalGlowMaterial = new StandardMaterial(
      "skyEyeDefeatPortalRedGlowMaterial",
      scene
    );
    this.portalGlowMaterial.diffuseColor = Color3.Black();
    this.portalGlowMaterial.specularColor = Color3.Black();
    this.portalGlowMaterial.emissiveColor = new Color3(1, 0.018, 0.006);
    this.portalGlowMaterial.disableLighting = true;
    this.portalGlowMaterial.backFaceCulling = false;
    this.portalGlowMaterial.disableDepthWrite = true;
    this.portalGlowMaterial.alpha = 0;
    this.portalGlowMaterial.alphaMode = Engine.ALPHA_ADD;
    this.portalGlowMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.portalGlow = MeshBuilder.CreateDisc(
      "skyEyeDefeatPortalRedGlow",
      { radius: PORTAL_DIAMETER * 0.35, tessellation: 64 },
      scene
    );
    this.portalGlow.parent = this.portalRoot;
    this.portalGlow.rotation.y = Math.PI * 0.5;
    this.portalGlow.position.x = -0.08;
    this.portalGlow.material = this.portalGlowMaterial;
    this.portalGlow.isPickable = false;
    this.portalGlow.renderingGroupId = 1;

    this.portalVortex = new SkyEyeDefeatPortalVortex(
      scene,
      this.portalRoot,
      options.smokeSystem,
      PORTAL_DIAMETER,
      options.portalQuality
    );

    this.portalLight = new PointLight(
      "skyEyeDefeatPortalRedLight",
      Vector3.Zero(),
      scene
    );
    this.portalLight.parent = this.portalRoot;
    this.portalLight.diffuse = new Color3(1, 0.035, 0.012);
    this.portalLight.specular = new Color3(0.52, 0.012, 0.006);
    this.portalLight.range = 18;
    this.portalLight.intensity = 0;

    this.actorFrontLight = new PointLight(
      "skyEyeDefeatActorFrontLight",
      Vector3.Zero(),
      scene
    );
    this.actorFrontLight.diffuse = new Color3(1, 0.82, 0.7);
    this.actorFrontLight.specular = new Color3(0.42, 0.3, 0.22);
    this.actorFrontLight.range = 16;
    this.actorFrontLight.radius = 1.1;
    this.actorFrontLight.renderPriority = 32;
    this.actorFrontLight.intensity = 0;
    this.actorFrontLight.setEnabled(false);
    // Clear the previous procedural offsets before Babylon evaluates the next
    // NLA frame. Applying the new pose later in updateActor then layers over,
    // rather than freezing, the underlying struggle locomotion.
    this.beforeAnimationsObserver = scene.onBeforeAnimationsObservable.add(
      () => this.restoreActorPose()
    );
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  public get state() {
    return this.currentState;
  }

  public get isActive() {
    return this.currentState === "presenting";
  }

  public start() {
    if (this.disposed || this.currentState !== "waiting") return false;
    // Release any attack/grab cinematic first so this sequence can acquire the
    // single PlayerController cinematic lock without competing camera owners.
    this.onStart?.();
    if (!this.player.beginCinematicSequence()) return false;

    this.currentState = "presenting";
    this.elapsed = 0;
    this.portalOpeningAnnounced = false;
    this.captureEntryCamera();
    this.prepareActorStage();
    this.preparePortal();
    this.prepareHands();
    document.body.classList.add("sky-eye-defeat-cinematic-active");
    this.player.setCinematicCamera(
      this.entryCameraPosition,
      this.eyePosition(),
      0,
      0.8
    );
    window.dispatchEvent(
      new CustomEvent("bosque:sky-eye-defeat-cinematic", {
        detail: { state: "started" },
      })
    );
    return true;
  }

  public update(deltaTimeSeconds: number) {
    if (!this.isActive || this.disposed) return;
    const delta = Math.max(0, Math.min(0.1, deltaTimeSeconds));
    this.elapsed = Math.min(
      SKY_EYE_DEFEAT_CINEMATIC_TIMING.completeSeconds,
      this.elapsed + delta
    );
    if (
      !this.portalOpeningAnnounced &&
      this.elapsed >= SKY_EYE_DEFEAT_CINEMATIC_TIMING.portalOpenStartSeconds
    ) {
      this.portalOpeningAnnounced = true;
      window.dispatchEvent(
        new CustomEvent("bosque:sky-eye-defeat-cinematic", {
          detail: { state: "portal-opening" },
        })
      );
    }
    const frame = sampleSkyEyeDefeatCinematic(this.elapsed);
    this.updatePortal(delta, frame);
    this.updateActor(frame);
    this.updateHands(delta, frame);
    this.updateCamera(frame);
    if (frame.complete) this.finish();
  }

  public getDebugSnapshot() {
    return {
      state: this.currentState,
      elapsed: this.elapsed,
      frame: sampleSkyEyeDefeatCinematic(this.elapsed),
      actorPosition: this.actor.root.position.clone(),
      portalPosition: this.portalCenter.clone(),
      activeHands: this.hands.filter((hand) => hand.activated).length,
      grippingHands: this.hands.filter(
        (hand) => hand.phase === "grab" || hand.phase === "hold"
      ).length,
      finalCaptorActive: this.hands.some(
        (hand) => hand.layout.finalCaptor && hand.activated
      ),
      maximumGripContactError: Math.max(
        0,
        ...this.hands
          .filter((hand) => hand.phase === "grab" || hand.phase === "hold")
          .map((hand) => hand.contactError)
      ),
    };
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    document.body.classList.remove("sky-eye-defeat-cinematic-active");
    if (this.currentState === "presenting") {
      this.player.endCinematicSequence(0.08);
    }
    this.restoreActorPose();
    if (this.beforeAnimationsObserver) {
      this.portalRoot
        .getScene()
        .onBeforeAnimationsObservable.remove(this.beforeAnimationsObserver);
      this.beforeAnimationsObserver = null;
    }
    this.disposeHands(false);
    this.portalFx.dispose();
    this.portalVortex.dispose();
    this.portalLight.dispose();
    this.actorFrontLight.dispose();
    this.portalGlowMaterial.dispose(false, false);
    if (!this.portalRoot.isDisposed()) this.portalRoot.dispose(false, true);
  }

  private captureEntryCamera() {
    this.player.root.computeWorldMatrix(true);
    this.player.camera.getViewMatrix(true);
    this.entryCameraPosition.copyFrom(this.player.camera.globalPosition);
    const ray = this.player.camera.getForwardRay(20);
    this.entryCameraTarget
      .copyFrom(this.entryCameraPosition)
      .addInPlace(ray.direction.scale(20));
  }

  private prepareActorStage() {
    this.actorGroundOffset = this.resolveActorGroundOffset();
    this.stagePosition.y =
      this.getGroundHeight(this.stagePosition.x, this.stagePosition.z) +
      this.actorGroundOffset;

    this.actor.animations.stop();
    this.actor.setNeckGrabPose(null, true);
    this.actor.setLookTargetProvider(null);
    this.actor.root.setEnabled(true);
    this.actor.root.position.copyFrom(this.stagePosition);
    this.actor.root.rotationQuaternion = null;
    const towardCamera = this.stageForward.scale(-1);
    this.actor.root.rotation.set(
      0,
      Math.atan2(towardCamera.x, towardCamera.z),
      0
    );
    this.actorStartRotation.copyFrom(this.actor.root.rotation);
    this.actorStartScaling.copyFrom(this.actor.root.scaling);
    this.actor.playLocomotion("walk", {
      loop: true,
      speedRatio: 0.72,
      blendingSpeed: 0.08,
    });
    this.actorMotionPhase = "walk";
    this.prepareActorRig();
    this.actorFrontLight.includedOnlyMeshes.length = 0;
    this.actorFrontLight.includedOnlyMeshes.push(...this.actor.meshes);
    this.actorFrontLight.setEnabled(true);
    this.actor.root.computeWorldMatrix(true);

    const bounds = this.resolveActorBounds();
    this.actorHeight = Math.max(2.2, bounds.max.y - bounds.min.y);
    this.actorWidth = Math.max(0.8, bounds.max.x - bounds.min.x);
    this.actorStartPosition.copyFrom(this.actor.root.position);
    this.actorWalkStartPosition
      .copyFrom(this.actorStartPosition)
      .addInPlace(this.stageForward.scale(2.85));
    this.actorWalkStartPosition.y =
      this.getGroundHeight(
        this.actorWalkStartPosition.x,
        this.actorWalkStartPosition.z
      ) + this.actorGroundOffset;
    this.actor.root.position.copyFrom(this.actorWalkStartPosition);
    this.actorDestination
      .copyFrom(this.actorStartPosition)
      .addInPlace(this.stageForward.scale(PORTAL_DISTANCE_BEHIND_ACTOR));
    this.actorDestination.y += this.actorHeight * 0.08;

    this.portalCenter
      .copyFrom(this.actorStartPosition)
      .addInPlace(this.stageForward.scale(PORTAL_DISTANCE_BEHIND_ACTOR));
    this.portalCenter.y = bounds.min.y + this.actorHeight * 0.54;

    this.stagedCameraPosition
      .copyFrom(this.actorStartPosition)
      .addInPlace(this.stageForward.scale(-9.5))
      .addInPlace(this.stageRight.scale(3.8));
    this.stagedCameraPosition.y = bounds.min.y + this.actorHeight * 0.73;
    this.stagedCameraTarget.copyFrom(this.actorStartPosition);
    this.stagedCameraTarget.y = bounds.min.y + this.actorHeight * 0.53;
  }

  private preparePortal() {
    this.portalRoot.position.copyFrom(this.portalCenter);
    const towardActor = this.stageForward.scale(-1);
    this.portalRoot.rotationQuaternion = null;
    this.portalRoot.rotation.set(
      0,
      Math.atan2(towardActor.x, towardActor.z) - Math.PI * 0.5,
      0
    );
    this.portalRoot.setEnabled(false);
    this.portalFx.setOwnerEnabled(false);
    this.portalFx.setFormationProgress(0, 0);
    this.portalVortex.reset();
    this.portalGlowMaterial.alpha = 0;
    this.portalLight.intensity = 0;
  }

  private prepareHands() {
    this.hands.length = 0;
    for (let index = 0; index < this.arms.length; index++) {
      const controller = this.arms[index];
      const layout = HAND_LAYOUTS[index % HAND_LAYOUTS.length];
      controller.stopAllAnimations();
      controller.setEnabled(false);
      controller.root.scaling.setAll(
        DEFAULT_SHADOW_GRABBER_CONFIG.baseScale * layout.scale
      );
      const origin = this.portalCenter
        .add(this.stageRight.scale(layout.portalRight))
        .add(new Vector3(0, layout.portalUp, 0))
        .add(this.stageForward.scale(-0.12));
      const target = this.actorStartPosition
        .add(this.stageRight.scale(layout.targetRight * this.actorWidth))
        .add(new Vector3(0, layout.targetHeight * this.actorHeight, 0));
      controller.setPosition(origin);
      controller.turnToward(target, Math.PI);
      this.applyArmElevation(controller, target);
      this.hands.push({
        controller,
        layout,
        origin,
        activated: false,
        stretch: 1,
        contactError: 0,
        phaseStartedAt: 0,
        phase: "hidden",
      });
    }
  }

  private updatePortal(
    deltaTimeSeconds: number,
    frame: SkyEyeDefeatCinematicFrame
  ) {
    const visible = frame.portalProgress > 0.001;
    this.portalRoot.setEnabled(visible);
    this.portalFx.setOwnerEnabled(visible);
    this.portalFx.setFormationProgress(
      frame.portalProgress,
      frame.portalProgress
    );
    this.portalFx.setState(
      frame.closeProgress > 0.001
        ? "retract"
        : frame.dragProgress > 0.001
          ? "hold"
          : frame.gripProgress > 0.001
            ? "grab"
            : frame.handsProgress > 0.001
              ? "extend"
              : "alert"
    );
    this.portalFx.update(deltaTimeSeconds);
    this.portalVortex.update(this.elapsed, frame.portalProgress);
    const pulse = 0.5 + Math.sin(this.elapsed * 5.8) * 0.5;
    this.portalGlowMaterial.alpha =
      frame.portalProgress * (0.035 + pulse * 0.035);
    this.portalGlow.scaling.setAll(
      0.92 + frame.portalProgress * 0.08 + pulse * 0.035
    );
    this.portalLight.intensity =
      frame.portalProgress * (3.4 + pulse * 1.35);
  }

  private updateActor(frame: SkyEyeDefeatCinematicFrame) {
    const root = this.actor.root;
    if (!root.isEnabled() && frame.dragProgress < 0.995) root.setEnabled(true);

    const struggle =
      frame.gripProgress * (1 - frame.fallProgress) * (1 - frame.dragProgress);
    const fall = frame.fallProgress;
    const drag = frame.dragProgress;
    const lift = frame.liftProgress;
    const dragEnvelope = Math.sin(drag * Math.PI);
    const pullRecoil =
      Math.sin(drag * Math.PI * 6) *
      dragEnvelope *
      0.018 *
      (1 - lift * 0.5);
    const dragEase = clamp01(drag * drag * (3 - 2 * drag) + pullRecoil);
    const fallImpact = progressBetween(fall, 0.68, 0.32);
    const impactWave =
      Math.sin(fallImpact * Math.PI * 3) * Math.exp(-fallImpact * 2.8);
    const groundBounce =
      Math.abs(Math.sin(this.elapsed * 8.4 + 0.7)) *
      dragEnvelope *
      (1 - lift) *
      0.022;
    const liftBounce =
      Math.sin(lift * Math.PI * 3) * Math.exp(-lift * 2.2) * 0.09;
    const liftedAmount = clamp01(lift + liftBounce);
    Vector3.LerpToRef(
      this.actorWalkStartPosition,
      this.actorStartPosition,
      frame.walkProgress,
      this.actorWalkPosition
    );
    Vector3.LerpToRef(
      this.actorWalkPosition,
      this.actorDestination,
      dragEase,
      root.position
    );
    const walkingEnvelope =
      Math.sin(frame.walkProgress * Math.PI) * (1 - frame.gripProgress);
    root.position.addInPlace(
      this.stageRight.scale(
        Math.sin(this.elapsed * 6.6) * 0.035 * walkingEnvelope +
        Math.sin(this.elapsed * 9.8) * 0.12 * struggle * (1 - drag) +
          Math.sin(this.elapsed * 4.35 + 0.6) *
            0.065 *
            dragEnvelope *
            (1 - lift)
      )
    );
    root.position.y +=
      Math.abs(Math.sin(this.elapsed * 6.6)) * 0.018 * walkingEnvelope +
      Math.sin(this.elapsed * 12.4) * 0.045 * struggle +
      this.actorHeight *
        (fall * 0.015 +
          liftedAmount * 0.42 +
          Math.abs(impactWave) * 0.032 +
          groundBounce);

    root.rotation.copyFrom(this.actorStartRotation);
    root.rotation.x +=
      ACTOR_FALL_ANGLE * fall * (1 - lift * 0.16) +
      Math.sin(this.elapsed * 7.2) * 0.045 * struggle +
      impactWave * 0.085 +
      liftBounce * 0.12;
    root.rotation.z +=
      Math.sin(this.elapsed * 8.6) * 0.09 * struggle +
      dragEnvelope * 0.075 +
      Math.sin(this.elapsed * 4.35) * dragEnvelope * (1 - lift) * 0.045;

    const shrink = progressBetween(drag, 0.9, 0.1);
    const scale = Math.max(0.04, 1 - shrink * 0.96);
    root.scaling.copyFrom(this.actorStartScaling).scaleInPlace(scale);
    root.computeWorldMatrix(true);

    if (
      frame.gripProgress >= 0.02 &&
      frame.fallProgress < 0.22 &&
      this.actorMotionPhase !== "resist"
    ) {
      this.actorMotionPhase = "resist";
      this.actor.animations.play("walkBackward", {
        loop: true,
        speedRatio: 0.58,
        blendingSpeed: 0.12,
      });
    } else if (
      frame.walkProgress >= 0.995 &&
      frame.gripProgress < 0.02 &&
      this.actorMotionPhase !== "idle"
    ) {
      this.actorMotionPhase = "idle";
      this.actor.animations.play("idle", {
        loop: true,
        blendingSpeed: 0.1,
      });
    } else if (
      frame.fallProgress >= 0.22 &&
      this.actorMotionPhase !== "fallen"
    ) {
      this.actorMotionPhase = "fallen";
      this.actor.animations.play("idle", {
        loop: true,
        speedRatio: 0.45,
        blendingSpeed: 0.14,
      });
    }

    this.applyActorAbductionPose(frame);
    this.updateActorFrontLight(frame, shrink);
    if (drag >= 0.995) root.setEnabled(false);
  }

  private updateActorFrontLight(
    frame: SkyEyeDefeatCinematicFrame,
    disappearanceProgress: number
  ) {
    const visibility =
      (1 - disappearanceProgress) *
      (1 - progressBetween(frame.dragProgress, 0.985, 0.015));
    if (visibility <= 0.001 || !this.actor.root.isEnabled()) {
      this.actorFrontLight.intensity = 0;
      return;
    }
    this.actorFrontLight.position
      .copyFrom(this.actor.root.position)
      .addInPlace(this.stageForward.scale(-2.35))
      .addInPlace(this.stageRight.scale(0.35));
    this.actorFrontLight.position.y += this.actorHeight * 0.66;
    const livingPulse =
      0.96 +
      Math.sin(this.elapsed * 2.1) * 0.025 +
      Math.sin(this.elapsed * 5.7 + 0.8) * 0.015;
    this.actorFrontLight.intensity = 1.55 * visibility * livingPulse;
  }

  private prepareActorRig() {
    const animationGroups = this.actor.animations
      .getRegisteredActionNames()
      .flatMap((name) => {
        const group = this.actor.animations.get(name);
        return group ? [group] : [];
      });
    const rig = new MixamoProceduralRig(
      this.actor.meshes,
      animationGroups,
      ABDUCTION_POSE_JOINTS
    );
    if (!rig.available) {
      console.warn(
        `[SkyEyeDefeatCinematic] Pose de abduccion reducida; faltan huesos: ${
          rig.getMissingRequiredBones().join(", ") || "skeleton"
        }.`
      );
      this.actorRig = null;
      return;
    }
    this.actorRig = rig;
  }

  private applyActorAbductionPose(frame: SkyEyeDefeatCinematicFrame) {
    const rig = this.actorRig;
    if (!rig || !this.actor.root.isEnabled()) return;

    const fall = frame.fallProgress;
    const drag = frame.dragProgress;
    const lift = frame.liftProgress;
    const struggle =
      frame.gripProgress * (1 - fall) * (1 - drag * 0.7);
    const poseWeight = Math.max(struggle, fall, drag);
    if (poseWeight <= 0.001) return;

    rig.captureBasePose();
    const effortWave = Math.sin(this.elapsed * 7.6);
    const counterWave = Math.sin(this.elapsed * 10.9 + 1.7);
    const jerk = Math.tanh(Math.sin(this.elapsed * 4.8) * 2.3);
    const fallImpact = progressBetween(fall, 0.68, 0.32);
    const impactWave =
      Math.sin(fallImpact * Math.PI * 3) * Math.exp(-fallImpact * 2.8);
    const dragBounce =
      Math.sin(this.elapsed * 8.4 + 0.7) *
      Math.sin(drag * Math.PI) *
      (1 - lift);
    const forwardReach = Math.max(fall, drag * (1 - lift * 0.48));
    const torsoPitch =
      radians(14) * struggle +
      radians(24) * fall -
      radians(8) * lift +
      radians(5.5) * impactWave +
      radians(2.2) * dragBounce;

    rig.rotateWorld("hips", this.stageRight, torsoPitch * 0.18);
    rig.rotateWorld("spine", this.stageRight, torsoPitch * 0.24);
    rig.rotateWorld("spine1", this.stageRight, torsoPitch * 0.31);
    rig.rotateWorld("spine2", this.stageRight, torsoPitch * 0.4);
    rig.rotateWorld(
      "spine1",
      Axis.Y,
      radians(7) * effortWave * struggle + radians(3) * jerk * (1 - lift) * fall
    );
    rig.rotateWorld(
      "spine2",
      Axis.Y,
      radians(11) * counterWave * struggle + radians(4) * jerk * fall
    );
    rig.rotateWorld(
      "neck",
      this.stageRight,
      -torsoPitch * 0.22 +
        radians(5) * counterWave * struggle -
        radians(4) * impactWave
    );
    rig.rotateWorld(
      "head",
      Axis.Y,
      radians(5.5) * effortWave * struggle + radians(2.8) * dragBounce
    );

    const shoulderReach =
      radians(7) * forwardReach +
      radians(5) * struggle * (0.5 + 0.5 * jerk);
    rig.applyLocalOffset("leftShoulder", Axis.Z, shoulderReach);
    rig.applyLocalOffset("rightShoulder", Axis.Z, -shoulderReach);

    const armLift =
      -radians(69) * forwardReach -
      radians(19) * struggle +
      radians(9) * lift +
      radians(7) * impactWave;
    const armFlail = radians(15) * effortWave * struggle;
    const armSpread = radians(18 + 13 * struggle) * Math.max(0.25, forwardReach);
    rig.applyLocalOffset(
      "leftArm",
      Axis.X,
      armLift + armFlail,
      Axis.Z,
      armSpread
    );
    rig.applyLocalOffset(
      "rightArm",
      Axis.X,
      armLift - armFlail,
      Axis.Z,
      -armSpread
    );
    const elbowFlex =
      radians(24) * forwardReach +
      radians(19) * struggle * (0.5 + 0.5 * counterWave) -
      radians(8) * impactWave +
      radians(4) * dragBounce;
    rig.applyLocalOffset("leftForeArm", Axis.Z, elbowFlex);
    rig.applyLocalOffset("rightForeArm", Axis.Z, -elbowFlex);
    rig.applyLocalOffset(
      "leftHand",
      Axis.X,
      -radians(14) * forwardReach + radians(8) * effortWave * struggle
    );
    rig.applyLocalOffset(
      "rightHand",
      Axis.X,
      radians(14) * forwardReach - radians(8) * counterWave * struggle
    );

    const brace = struggle * (1 - fall);
    const legDrag = Math.max(fall, drag) * (1 - lift * 0.35);
    rig.applyLocalOffset(
      "leftUpLeg",
      Axis.X,
      radians(13) * brace +
        radians(8) * effortWave * brace +
        radians(5) * legDrag +
        radians(3.5) * dragBounce
    );
    rig.applyLocalOffset(
      "rightUpLeg",
      Axis.X,
      radians(13) * brace -
        radians(8) * effortWave * brace -
        radians(3) * legDrag -
        radians(2.8) * dragBounce
    );
    rig.applyLocalOffset(
      "leftLeg",
      Axis.X,
      -radians(28) * brace - radians(9) * legDrag - radians(5) * impactWave
    );
    rig.applyLocalOffset(
      "rightLeg",
      Axis.X,
      -radians(25) * brace - radians(6) * legDrag + radians(3.5) * impactWave
    );
    rig.applyLocalOffset("leftFoot", Axis.X, radians(10) * brace);
    rig.applyLocalOffset("rightFoot", Axis.X, radians(8) * brace);
    rig.prepare();
    this.actorPoseApplied = true;
  }

  private restoreActorPose() {
    if (!this.actorPoseApplied || !this.actorRig) return;
    this.actorRig.restoreBasePose();
    this.actorPoseApplied = false;
  }

  private updateHands(
    deltaTimeSeconds: number,
    frame: SkyEyeDefeatCinematicFrame
  ) {
    const timing = SKY_EYE_DEFEAT_CINEMATIC_TIMING;
    for (const hand of this.hands) {
      const activationTime = timing.handsStartSeconds + hand.layout.delay;
      if (!hand.activated && this.elapsed >= activationTime) {
        hand.activated = true;
        hand.phase = "extend";
        hand.phaseStartedAt = this.elapsed;
        hand.controller.setEnabled(true);
        hand.controller.playAnimation("extend", {
          restart: true,
          speedRatio: 1.08,
        });
      }
      if (!hand.activated) continue;

      const individualGripTime = Math.max(
        timing.gripStartSeconds + hand.layout.delay * 0.12,
        activationTime + (hand.layout.finalCaptor ? 0.95 : 0.72)
      );
      const individualHoldTime =
        individualGripTime + (hand.layout.finalCaptor ? 0.78 : 0.52);
      if (hand.phase === "extend" && this.elapsed >= individualGripTime) {
        hand.phase = "grab";
        hand.phaseStartedAt = this.elapsed;
        hand.controller.playAnimation("grab", {
          restart: true,
          speedRatio: hand.layout.finalCaptor ? 0.78 : 1.08,
        });
      }
      if (hand.phase === "grab" && this.elapsed >= individualHoldTime) {
        hand.phase = "hold";
        hand.phaseStartedAt = this.elapsed;
        hand.controller.playAnimation("hold", {
          restart: true,
          loop: true,
          speedRatio: hand.layout.finalCaptor ? 0.64 : 0.82,
        });
      }
      const individualRetractTime =
        timing.handsRetractStartSeconds +
        (hand.layout.finalCaptor ? 0.18 : hand.layout.delay * 0.025);
      if (hand.phase === "hold" && this.elapsed >= individualRetractTime) {
        hand.phase = "retract";
        hand.phaseStartedAt = this.elapsed;
        hand.controller.playAnimation("retract", {
          restart: true,
          speedRatio: 0.92,
        });
      }

      const reachProgress = progressBetween(
        this.elapsed,
        activationTime,
        individualGripTime - activationTime
      );
      const retractDuration = hand.layout.finalCaptor ? 1.15 : 0.92;
      const retractProgress =
        hand.phase === "retract"
          ? progressBetween(
              this.elapsed,
              hand.phaseStartedAt,
              retractDuration
            )
          : 0;
      this.alignHandToActor(
        hand,
        deltaTimeSeconds,
        frame,
        reachProgress * (1 - retractProgress)
      );
      const armMesh = hand.controller.armMesh;
      if (armMesh) {
        armMesh.visibility = Math.max(
          0,
          (1 - retractProgress) *
            (0.9 + Math.sin(this.elapsed * 8 + hand.layout.delay * 9) * 0.1)
        );
      }
      if (retractProgress >= 0.995) hand.controller.setEnabled(false);
    }
  }

  private alignHandToActor(
    hand: CinematicHand,
    deltaTimeSeconds: number,
    frame: SkyEyeDefeatCinematicFrame,
    reachProgress: number
  ) {
    const scaleRatio =
      this.actor.root.scaling.y /
      Math.max(0.0001, this.actorStartScaling.y);
    const hasJointTarget =
      this.actorRig?.getJointWorldPositionToRef(
        hand.layout.targetJoint,
        this.handTarget
      ) ?? false;
    if (hasJointTarget) {
      this.handTarget
        .addInPlace(
          this.stageRight.scale(
            hand.layout.targetOutset * this.actorWidth * scaleRatio
          )
        )
        .addInPlace(
          this.stageForward.scale(
            hand.layout.targetDepth * this.actorWidth * scaleRatio
          )
        );
    } else {
      const fallAngle =
        ACTOR_FALL_ANGLE *
        frame.fallProgress *
        (1 - frame.liftProgress * 0.16);
      this.actorBodyUp
        .copyFrom(Vector3.Up())
        .scaleInPlace(Math.cos(fallAngle))
        .addInPlace(this.stageForward.scale(-Math.sin(fallAngle)));
      this.handTarget
        .copyFrom(this.actor.root.position)
        .addInPlace(
          this.stageRight.scale(
            hand.layout.targetRight * this.actorWidth * scaleRatio
          )
        )
        .addInPlace(
          this.actorBodyUp.scale(
            hand.layout.targetHeight * this.actorHeight * scaleRatio
          )
        );
    }

    const baseScale =
      DEFAULT_SHADOW_GRABBER_CONFIG.baseScale * hand.layout.scale;
    hand.controller.root.position.copyFrom(hand.origin);
    hand.controller.root.scaling.setAll(baseScale);
    hand.controller.turnToward(this.handTarget, Math.PI);
    this.applyArmElevation(hand.controller, this.handTarget);
    if (!hand.controller.getAttackPointWorldPositionToRef(this.handPalm)) return;

    const naturalReach = Math.max(
      0.05,
      Vector3.Distance(hand.origin, this.handPalm)
    );
    const targetReach = Vector3.Distance(hand.origin, this.handTarget);
    this.handTarget.subtractToRef(hand.origin, this.handDirection);
    if (this.handDirection.lengthSquared() > 0.000001) {
      this.handDirection.normalize();
    } else {
      this.handDirection.copyFrom(this.stageForward).scaleInPlace(-1);
    }
    const approachReach = lerp(
      naturalReach,
      targetReach,
      smoothstep01(reachProgress)
    );
    this.handApproachTarget
      .copyFrom(hand.origin)
      .addInPlace(this.handDirection.scale(approachReach));
    const desiredStretch = Math.max(
      0.78,
      Math.min(2.35, approachReach / naturalReach)
    );
    hand.stretch =
      reachProgress >= 0.995
        ? desiredStretch
        : lerp(
            hand.stretch,
            desiredStretch,
            1 - Math.exp(-7.5 * deltaTimeSeconds)
          );
    const elasticPulse =
      1 +
      Math.sin(this.elapsed * 5.2 + hand.layout.delay * 8.3) *
        0.035 *
        Math.max(frame.gripProgress, frame.dragProgress);
    const crossSection = Math.max(
      hand.layout.finalCaptor ? 0.82 : 0.72,
      1 / Math.sqrt(hand.stretch)
    );
    hand.controller.root.scaling.set(
      baseScale * hand.stretch * elasticPulse,
      baseScale * crossSection,
      baseScale * crossSection
    );
    hand.controller.root.computeWorldMatrix(true);
    if (!hand.controller.getAttackPointWorldPositionToRef(this.handPalm)) return;

    this.handCorrection
      .copyFrom(this.handApproachTarget)
      .subtractInPlace(this.handPalm);
    const correctionLength = this.handCorrection.length();
    if (correctionLength <= 0.001) {
      hand.contactError = correctionLength;
      return;
    }
    // Translation preserves the animated finger pose and makes the palm land
    // exactly on the tracked joint. Scaling performed above keeps this final
    // correction small enough that the arm still visibly originates in the portal.
    hand.controller.root.position.addInPlace(this.handCorrection);
    hand.controller.root.computeWorldMatrix(true);
    if (hand.controller.getAttackPointWorldPositionToRef(this.handPalm)) {
      hand.contactError = Vector3.Distance(
        this.handPalm,
        this.handApproachTarget
      );
    }
  }

  private updateCamera(frame: SkyEyeDefeatCinematicFrame) {
    const timing = SKY_EYE_DEFEAT_CINEMATIC_TIMING;
    const cameraBlend = progressBetween(
      this.elapsed,
      timing.eyeDissolveFocusSeconds,
      1.45
    );
    const chaosEnvelope =
      progressBetween(this.elapsed, timing.gripStartSeconds + 0.2, 1.05) *
      (1 -
        progressBetween(
          this.elapsed,
          timing.handsRetractStartSeconds,
          timing.handsRetractDurationSeconds
        ));
    const portalShock = dampedShock(
      this.elapsed,
      timing.portalOpenStartSeconds,
      0.82,
      3.25
    );
    const grabShock = dampedShock(
      this.elapsed,
      timing.gripStartSeconds,
      0.68,
      4.5
    );
    const shockStrength = Math.abs(portalShock) + Math.abs(grabShock) * 1.35;
    const walkingCameraEnvelope =
      Math.sin(frame.walkProgress * Math.PI) * (1 - frame.gripProgress);
    const eyeTarget = this.eyePosition();
    this.stagedCameraTarget.copyFrom(this.actor.root.position);
    this.stagedCameraTarget.y += this.actorHeight * 0.53;
    Vector3.LerpToRef(
      eyeTarget,
      this.stagedCameraTarget,
      cameraBlend,
      this.cameraTarget
    );
    this.cameraTarget.addInPlace(
      this.portalCenter.subtract(this.cameraTarget).scale(frame.dragProgress * 0.32)
    );
    this.cameraTarget
      .addInPlace(
        this.stageRight.scale(
          (Math.sin(this.elapsed * 3.15) * 0.075 +
            Math.sin(this.elapsed * 7.9 + 0.4) * 0.025) *
            chaosEnvelope
        )
      )
      .addInPlace(
        Vector3.Up().scale(
          Math.sin(this.elapsed * 4.6 + 1.1) * 0.045 * chaosEnvelope
        )
      );
    this.cameraTarget
      .addInPlace(this.stageRight.scale(grabShock * 0.12))
      .addInPlace(Vector3.Up().scale(portalShock * 0.075));

    const erraticPush =
      (Math.sin(this.elapsed * 3.7) * 0.28 +
        Math.sin(this.elapsed * 8.3 + 0.8) * 0.11) *
      chaosEnvelope;
    const movingCamera = this.stagedCameraPosition
      .add(
        this.stageForward.scale(
          frame.gripProgress * 0.32 +
            frame.fallProgress * 0.72 +
            frame.dragProgress * 1.08 +
            erraticPush
        )
      )
      .add(
        this.stageRight.scale(
          Math.sin(this.elapsed * 1.9 + 0.35) *
            0.09 *
            walkingCameraEnvelope +
          -frame.fallProgress * 0.38 +
            frame.liftProgress * 0.22 +
            (Math.sin(this.elapsed * 2.65 + 0.3) * 0.24 +
              Math.sin(this.elapsed * 6.9) * 0.075) *
              chaosEnvelope
        )
      );
    movingCamera.addInPlace(
      this.stageForward.scale(portalShock * 0.11 + grabShock * 0.26)
    );
    movingCamera.addInPlace(
      this.stageRight.scale(portalShock * -0.13 + grabShock * 0.24)
    );
    movingCamera.y -= frame.fallProgress * 0.24;
    movingCamera.y += frame.liftProgress * 0.16;
    movingCamera.y +=
      Math.sin(this.elapsed * 3.8) * 0.035 * walkingCameraEnvelope +
      portalShock * 0.055 +
      grabShock * 0.1;
    movingCamera.y +=
      Math.sin(this.elapsed * 3.9 + 0.45) * 0.09 * chaosEnvelope;
    Vector3.LerpToRef(
      this.entryCameraPosition,
      movingCamera,
      cameraBlend,
      this.cameraPosition
    );
    const shakeStrength =
      Math.sin(frame.gripProgress * Math.PI) * 0.045 +
      Math.sin(frame.fallProgress * Math.PI) * 0.065 +
      Math.sin(frame.dragProgress * Math.PI) * 0.04 +
      chaosEnvelope * 0.018 +
      shockStrength * 0.07;
    this.cameraPosition.x +=
      Math.sin(this.elapsed * 17) * shakeStrength +
      Math.sin(this.elapsed * 31.5) * shockStrength * 0.045;
    this.cameraPosition.y +=
      Math.sin(this.elapsed * 13.5) * shakeStrength * 0.45 +
      Math.sin(this.elapsed * 27.0 + 0.8) * shockStrength * 0.028;
    const zoomProgress = clamp01(
      frame.fallProgress * 0.48 + frame.dragProgress * 0.52
    );
    const cinematicFov =
      lerp(0.78, 0.64, zoomProgress * (1 - frame.closeProgress * 0.68)) +
      frame.closeProgress * 0.035 +
      Math.sin(this.elapsed * 5.1) * 0.012 * chaosEnvelope +
      portalShock * 0.018 -
      Math.abs(grabShock) * 0.038;
    this.player.setCinematicCamera(
      this.cameraPosition,
      this.cameraTarget,
      Math.sin(this.elapsed * 2.4) * shakeStrength * 0.12 +
        Math.sin(this.elapsed * 3.35 + 0.7) * 0.012 * chaosEnvelope +
        grabShock * 0.032,
      cinematicFov
    );
  }

  private finish() {
    if (this.currentState !== "presenting") return;
    this.currentState = "complete";
    this.restoreActorPose();
    this.actor.root.setEnabled(false);
    this.disposeHands(true);
    this.portalFx.setFormationProgress(0, 0);
    this.portalFx.setOwnerEnabled(false);
    this.portalVortex.reset();
    this.portalRoot.setEnabled(false);
    this.portalLight.intensity = 0;
    this.actorFrontLight.intensity = 0;
    this.actorFrontLight.setEnabled(false);
    document.body.classList.remove("sky-eye-defeat-cinematic-active");
    this.player.endCinematicSequence(0.85);
    this.onComplete?.();
    window.dispatchEvent(
      new CustomEvent("bosque:sky-eye-defeat-cinematic", {
        detail: { state: "complete" },
      })
    );
  }

  private disposeHands(deferResourceDisposal: boolean) {
    if (this.handsDisposed) return;
    this.handsDisposed = true;
    for (const arm of this.arms) arm.dispose(deferResourceDisposal);
    this.arms.length = 0;
    this.hands.length = 0;
  }

  private resolveActorGroundOffset() {
    this.actor.root.computeWorldMatrix(true);
    let minimumY = Number.POSITIVE_INFINITY;
    for (const mesh of this.actor.meshes) {
      mesh.computeWorldMatrix(true);
      minimumY = Math.min(
        minimumY,
        mesh.getBoundingInfo().boundingBox.minimumWorld.y
      );
    }
    return Number.isFinite(minimumY)
      ? this.actor.root.position.y - minimumY
      : 0;
  }

  private resolveActorBounds() {
    const min = new Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    const max = new Vector3(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY
    );
    for (const mesh of this.actor.meshes) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      min.minimizeInPlace(box.minimumWorld);
      max.maximizeInPlace(box.maximumWorld);
    }
    if (!Number.isFinite(min.y)) {
      min.copyFrom(this.actor.root.position);
      max.copyFrom(min).addInPlace(new Vector3(1, 3, 1));
    }
    return { min, max };
  }

  private applyArmElevation(
    controller: ShadowGrabberController,
    target: Vector3
  ) {
    const dx = target.x - controller.root.position.x;
    const dz = target.z - controller.root.position.z;
    const planarDistance = Math.max(0.001, Math.hypot(dx, dz));
    const elevation = Math.atan2(
      target.y - controller.root.position.y,
      planarDistance
    );
    controller.root.rotation.z = -elevation;
    controller.root.computeWorldMatrix(true);
  }
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export async function createSkyEyeDefeatCinematic(
  scene: Scene,
  options: CreateSkyEyeDefeatCinematicOptions
) {
  const armResults = await Promise.allSettled(
    Array.from({ length: ARM_COUNT }, (_, index) =>
      spawnShadowGrabber(options.enemyManager, {
        id: `sky-eye-defeat-hand-${index + 1}`,
        type: SHADOW_GRABBER_TYPE,
        groupId: "sky-eye-defeat-cinematic",
        position: Vector3.Zero(),
        enabled: false,
        configOverrides: {
          fxQuality: "off",
        },
      })
    )
  );
  const arms = armResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  const failures = armResults.length - arms.length;
  if (failures > 0) {
    console.warn(
      `[SkyEyeDefeatCinematic] No se pudieron preparar ${failures} de ${ARM_COUNT} manos.`,
      armResults
        .filter((result) => result.status === "rejected")
        .map((result) => (result as PromiseRejectedResult).reason)
    );
  }
  return new SkyEyeDefeatCinematic(scene, { ...options, arms });
}
