import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Bone } from "@babylonjs/core/Bones/bone";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { PlayerWorldQuery } from "./PlayerWorldQuery";
import {
  dampStairPresentation,
  INACTIVE_STAIR_LOCOMOTION,
  resolveStairLocomotion,
  shouldKeepStairGrounded,
} from "./animation/StairLocomotion";
import {
  getWaterLevelAt,
  type WaterSurfaceInfo,
  type WaterSurfaceRegistry,
} from "./WaterSurface";
import { LAUTARO_VISUAL_SCALE } from "./CharacterPresentation";
import type { InputManager } from "./input/InputManager";
import { ITEM_INSPECTOR_OPENED_EVENT } from "./ItemInspector";
import {
  ProceduralGrabStruggleController,
  type ProceduralGrabStruggleDebugPoseMask,
  type ProceduralGrabStruggleDebugSnapshot,
  type ProceduralNeckGrabState,
} from "./animation/ProceduralGrabStruggleController";
import {
  getPlayerHitReactionDuration,
  samplePlayerHitReaction,
  type PlayerDodgeReactionEvent,
  type PlayerHitReactionEvent,
  type PlayerImpactType,
  type PlayerReactionEvent,
} from "./animation/PlayerReaction";

type Settings = {
  eyeHeight: number;
  walkSpeed: number;
  runSpeed: number;
  jumpSpeed: number;
  gravity: number;
  runningEnabled?: boolean;
  jumpingEnabled?: boolean;
};

export function resolveRunningRequest(
  runRequested: boolean,
  runningEnabled = true
) {
  return runningEnabled && runRequested;
}

export function resolveJumpRequest(
  jumpRequested: boolean,
  jumpingEnabled = true
) {
  return jumpingEnabled && jumpRequested;
}

export type ViewMode = "first" | "third" | "front" | "iso";
export type IsometricCameraAnchor = {
  cameraPosition: Vector3;
  targetPosition: Vector3;
  orthographicHeight: number;
  cameraFollowFactorX?: number;
  maxCameraOffsetX?: number;
  targetFollowFactor?: number;
  maxTargetOffsetX?: number;
  maxTargetOffsetZ?: number;
};
export type LookRay = {
  origin: Vector3;
  direction: Vector3;
  proximityOrigin?: Vector3;
  proximityRadius?: number;
};
export type CharacterId = "lautaro" | "sofia";
export type PlayerWaterLocomotionState = "grounded" | "treadingWater" | "swimming";
type AnimationKey =
  | "idle"
  | "dying"
  | "jump"
  | "strafeLeftRun"
  | "strafeLeftWalk"
  | "openDoor"
  | "pickUpItem"
  | "strafeRightRun"
  | "strafeRightWalk"
  | "run"
  | "standingUp"
  | "walkBackward"
  | "walk"
  | "throwObject"
  | "treadingWater"
  | "swimming";

const CHARACTER_ROOT_URL = "/assets/models/character/";
const CHARACTER_FILES: Record<CharacterId, string> = {
  lautaro: "Lautaro_Animated.glb",
  sofia: "Sofia_Animated.glb",
};
const CHARACTER_VISUAL_SCALE: Record<CharacterId, number> = {
  lautaro: LAUTARO_VISUAL_SCALE,
  sofia: LAUTARO_VISUAL_SCALE * 0.95,
};
const CHARACTER_ANIMATIONS: Record<AnimationKey, string> = {
  idle: "Idle",
  dying: "Dying",
  jump: "Jump_InPlace",
  strafeLeftRun: "Left_Strafe_Run_InPlace",
  strafeLeftWalk: "Left_Strafe_Walk_InPlace",
  openDoor: "OpenDoor",
  pickUpItem: "PickUpItem",
  strafeRightRun: "Right_Strafe_Run_InPlace",
  strafeRightWalk: "Right_Strafe_Walk_InPlace",
  run: "Run_InPlace",
  standingUp: "Standing Up",
  walkBackward: "Walk_Backwards_InPlace",
  walk: "Walk_InPlace",
  throwObject: "Throw Object",
  treadingWater: "Treading Water",
  swimming: "Swimming",
};
const REGISTERED_CHARACTER_ANIMATIONS = new Set(Object.values(CHARACTER_ANIMATIONS));
const CHARACTER_YAW_OFFSET = 0;
const CHARACTER_FOOT_CLEARANCE = 0.03;
const THIRD_PERSON_CAMERA_DISTANCE = 5.2;
const THIRD_PERSON_CAMERA_HEIGHT = 1.25;
const THIRD_PERSON_CAMERA_TARGET_HEIGHT = -0.35;
const THIRD_PERSON_CAMERA_RECOVERY_SPEED = 7.5;
const THIRD_PERSON_CRAMPED_CAMERA_LIFT = 0.38;
const THIRD_PERSON_AVATAR_FADE_NEAR = 0.72;
const THIRD_PERSON_AVATAR_FADE_FAR = 1.72;
const THIRD_PERSON_AVATAR_FADE_OUT_SPEED = 18;
const THIRD_PERSON_AVATAR_FADE_IN_SPEED = 8;
const THIRD_PERSON_PITCH_MIN = -1.18;
const THIRD_PERSON_PITCH_MAX = 0.82;
const MAX_SIMULATION_DELTA_SECONDS = 0.05;
const ANIMATION_BLEND_TIME = 0.16;
const ACTION_BLEND_TIME = 0.08;
const STANDING_UP_BLEND_TIME = 0.18;
const GRAB_LOOK_HALF_FOV_COSINE = Math.cos((65 * Math.PI) / 180);
const GRAB_LOOK_TARGET_HYSTERESIS = 0.12;
const THROW_ACTION_MOVEMENT_LOCK_SECONDS = 1.15;
const THROW_UPPER_BODY_BLEND_TIME = 0.12;
const THROW_CHARGE_REFERENCE_FRAMES: Record<
  CharacterId,
  {
    holdFrame: number;
    releaseFrame: number;
    endFrame: number;
    totalFrames: number;
  }
> = {
  lautaro: { holdFrame: 38, releaseFrame: 63, endFrame: 86, totalFrames: 194 },
  sofia: { holdFrame: 13, releaseFrame: 17, endFrame: 25, totalFrames: 65 },
};
const CENTER_AIM_VIEWPORT_POSITION = { x: 0.5, y: 0.5 } as const;
const THIRD_PERSON_AIM_VIEWPORT_POSITION = { x: 0.43, y: 0.46 } as const;
const AIM_UNPROJECT_WORLD = Matrix.Identity();
const PICKUP_ACTION_SPEED_RATIO = 1.5;
const PICKUP_TO_LOCOMOTION_BLEND_TIME = 0.3;
const DOOR_OPEN_MOVEMENT_LOCK_SECONDS = 1.7;
const THIRD_PERSON_FLASHLIGHT_PITCH_MIN = -0.58;
const THIRD_PERSON_FLASHLIGHT_PITCH_MAX = 0.68;
const FIRST_PERSON_CAMERA_HEIGHT_MULTIPLIER = 2;

function isThrowUpperBodyTarget(targetName: string) {
  const normalized = targetName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized.endsWith("spine1") ||
    normalized.endsWith("spine2") ||
    /right(shoulder|arm|forearm|hand)/.test(normalized)
  );
}
const PLAYER_CAMERA_FOV = 0.9;
const NECK_GRAB_CAMERA_DISTANCE = 3.45;
const NECK_GRAB_CAMERA_HEIGHT = 0.38;
const NECK_GRAB_CAMERA_TARGET_HEIGHT_OFFSET = 0.12;
const NECK_GRAB_CAMERA_LIFT_METERS = 1.1;
const NECK_GRAB_CAMERA_FOV = 0.66;
const NECK_GRAB_CAMERA_ENTER_SECONDS = 0.48;
const NECK_GRAB_CAMERA_EXIT_SECONDS = 0.72;
const PRIMARY_VIEW_MODE_SEQUENCE: ViewMode[] = ["third", "first", "iso"];
const ISOMETRIC_CAMERA_SIDE_OFFSET = 6.8;
const ISOMETRIC_CAMERA_DISTANCE = 8.8;
const ISOMETRIC_CAMERA_HEIGHT = 8.9;
const ISOMETRIC_CAMERA_TARGET_HEIGHT = -0.2;
const ISOMETRIC_ORTHO_HEIGHT = 11.5;
const ISOMETRIC_INTERACTION_HEIGHT = 0.65;
const ISOMETRIC_INTERACTION_RADIUS = 2.15;
const ISOMETRIC_MOUSE_AIM_SPEED = 44;
const ISOMETRIC_AIM_DEADZONE = 0.08;
const ISOMETRIC_ANCHOR_BLEND_SPEED = 1.65;
const TREADING_WATER_ENTER_DEPTH = 1.34;
const TREADING_WATER_EXIT_DEPTH = 1.18;
// The treading clip keeps its animated torso higher than the locomotion root.
// Submerge the root enough for the authored shoulder line to meet the surface.
const TREADING_WATER_BODY_DEPTH = 2.08;
const TREADING_WATER_SPEED = 1.45;
const SWIMMING_SPEED = 3.15;
const SWIMMING_SURFACE_CEILING = 0.1;
const SWIMMING_SURFACE_TOGGLE_RANGE = 0.3;
const SWIMMING_SURFACE_ENTRY_SECONDS = 0.5;
const SWIMMING_IDLE_BUOYANCY_SPEED = 0.08;
// The animated swimming bounds extend roughly one metre below and more than a
// metre along the root. These margins protect the actual pose, not only its pivot.
const SWIMMING_BOTTOM_BODY_CLEARANCE = 1.4;
const SWIMMING_BODY_HALF_LENGTH = 1.3;
const SWIMMING_BODY_HALF_WIDTH = 0.65;
const WATER_VERTICAL_SETTLE_SPEED = 3.2;
const SHALLOW_WATER_TREADING_TRANSITION_SECONDS = 0.28;
// A camera above WaterMaterial sees mostly its reflection. While diving, keep
// the camera on the underwater side of the surface and blend the move so the
// transition does not pop.
const SWIMMING_CAMERA_DEPTH = 0.58;
const SWIMMING_CAMERA_BLEND_SPEED = 4.5;
const CAMERA_TERRAIN_CLEARANCE = 0.4;
const CAMERA_TERRAIN_SAMPLE_SPACING = 0.45;
const CAMERA_TERRAIN_MAX_SAMPLES = 24;
const SOFIA_MATERIAL_ROUGHNESS = 0.92;
const SOFIA_SPECULAR_INTENSITY = 0.24;
const SOFIA_ENVIRONMENT_INTENSITY = 0.14;
const SOFIA_DIELECTRIC_F0_FACTOR = 0.65;
const OPENING_CAMERA_LOCAL_POSITION = new Vector3(0, 8.2, -8.4);
const OPENING_CAMERA_MIN_DESCENT_SECONDS = 2.8;
const OPENING_CAMERA_MAX_DESCENT_SECONDS = 12;
const charactersWithPlayedOpeningAnimation = new Set<CharacterId>();

export function getNextPrimaryViewMode(
  mode: ViewMode,
  isometricAllowed = true
): ViewMode {
  const sequence = isometricAllowed
    ? PRIMARY_VIEW_MODE_SEQUENCE
    : PRIMARY_VIEW_MODE_SEQUENCE.filter((candidate) => candidate !== "iso");
  const index = sequence.indexOf(mode);
  if (index === -1) return "third";
  return sequence[(index + 1) % sequence.length];
}

export class PlayerController {
  public readonly root: TransformNode;
  public readonly camera: UniversalCamera;
  private readonly deathPresentationRoot: TransformNode;

  private velY = 0;
  private grounded = false;
  private jumpQueued = false;
  private waterActionQueued = false;
  private pitch = 0;
  private yaw = 0;
  private isometricAimX = 0;
  private isometricAimY = -1;
  private viewMode: ViewMode = "third";
  private isometricViewAllowed = true;
  private viewModeListeners = new Set<(mode: ViewMode) => void>();
  private thirdPersonCameraArmLength: number | null = null;
  private avatarCameraVisibility = 1;
  private isometricCameraAnchor: IsometricCameraAnchor | null = null;
  private isometricCameraAnchorEnabled = false;
  private isometricCameraAnchorBlend = 0;
  private cameraViewTransition: {
    fromWorldPosition: Vector3;
    elapsed: number;
    duration: number;
  } | null = null;
  private avatarRoot: TransformNode | null = null;
  private avatarMeshes: AbstractMesh[] = [];
  private deathBodyAnchorMesh: Mesh | null = null;
  private deathBodyAnchorBone: Bone | null = null;
  private throwHandMesh: Mesh | null = null;
  private throwHandBone: Bone | null = null;
  private throwHandMiddleBone: Bone | null = null;
  private readonly throwHandMiddlePosition = Vector3.Zero();
  private animations = new Map<string, AnimationGroup>();
  private throwUpperBodyAnimation: AnimationGroup | null = null;
  private currentAnimation: string | null = null;
  private fadeFromAnimation: AnimationGroup | null = null;
  private fadeToAnimation: AnimationGroup | null = null;
  private fadeElapsed = 0;
  private fadeDuration = ANIMATION_BLEND_TIME;
  private grabStruggleController: ProceduralGrabStruggleController | null = null;
  private readonly enemyGrabSources = new Map<string, Vector3 | null>();
  private readonly enemyGrabDirection = Vector3.Zero();
  private readonly enemyGrabLookDirection = Vector3.Zero();
  private enemyGrabLookTargetId: string | null = null;
  private neckGrabRestrained = false;
  private neckGrabCameraActive = false;
  private neckGrabCameraSideResolved = false;
  private neckGrabCameraElapsed = 0;
  private neckGrabCameraLift = 0;
  private neckGrabCameraEntryFov = PLAYER_CAMERA_FOV;
  private readonly neckGrabCameraAttackerPosition = Vector3.Zero();
  private readonly neckGrabCameraSide = Vector3.Right();
  private readonly neckGrabCameraEntryPosition = Vector3.Zero();
  private readonly neckGrabCameraEntryTarget = Vector3.Zero();
  private readonly neckGrabCameraTarget = Vector3.Zero();
  private readonly neckGrabCameraDesiredPosition = Vector3.Zero();
  private readonly neckGrabCameraResolvedPosition = Vector3.Zero();
  private readonly neckGrabCameraAlternativePosition = Vector3.Zero();
  private readonly neckGrabCameraBlendedPosition = Vector3.Zero();
  private readonly neckGrabCameraBlendedTarget = Vector3.Zero();
  private actionPlaying = false;
  private pickupActionGroup: AnimationGroup | null = null;
  private locomotionBlendTimeOverride: number | null = null;
  private chargedThrowAction: {
    group: AnimationGroup;
    holdFrame: number;
    releaseFrame: number;
    endFrame: number;
    released: boolean;
    launched: boolean;
    launch: (() => void) | null;
    blendWeight: number;
    finishing: boolean;
  } | null = null;
  private openingAnimationPending = false;
  private openingSequenceActive = false;
  private openingCameraState: {
    fromWorldPosition: Vector3;
    phase: "holding" | "descending";
    elapsed: number;
    duration: number;
  } | null = null;
  private cinematicSequenceActive = false;
  private deathSequenceActive = false;
  private cinematicCameraState: {
    worldPosition: Vector3;
    worldTarget: Vector3;
    roll: number;
    fieldOfView: number;
  } | null = null;
  private cinematicReturnState: {
    viewMode: ViewMode;
    yaw: number;
    pitch: number;
  } | null = null;
  private movementLockTimer = 0;
  private hitReactionMovement: {
    direction: Vector3;
    elapsed: number;
    duration: number;
    previousTravel: number;
    strength: number;
    impactType: PlayerImpactType;
  } | null = null;
  private enemyGrabPressureTimer = 0;
  private enemyGrabMovementMultiplier = 1;
  private enemyGrabPullSpeed = 0;
  private readonly enemyGrabSource = Vector3.Zero();
  private sfxMovementState: "idle" | "walk" | "run" = "idle";
  private waterSurfaces: WaterSurfaceRegistry | null = null;
  private activeWaterSurface: WaterSurfaceInfo | null = null;
  private waterLevel = Number.NEGATIVE_INFINITY;
  private waterDepthAtGround = 0;
  private diving = false;
  private swimmingSurfaceEntryTimer = 0;
  private swimmingCameraBlend = 0;
  private shallowWaterTransitionTimer = 0;
  private waterLocomotionStateValue: PlayerWaterLocomotionState = "grounded";
  private stairBodyPresentationY: number | null = null;
  private stairCameraPresentationY: number | null = null;
  private stairBodyOffsetY = 0;
  private stairCameraOffsetY = 0;

  constructor(
    private scene: Scene,
    private canvas: HTMLCanvasElement,
    private input: InputManager,
    private settings: Settings,
    private character: CharacterId = "lautaro"
  ) {
    this.root = new TransformNode("playerRoot", scene);
    this.root.position = new Vector3(0, settings.eyeHeight, 5);
    this.deathPresentationRoot = new TransformNode(
      "playerDeathPresentationRoot",
      scene
    );
    this.deathPresentationRoot.parent = this.root;

    this.camera = new UniversalCamera("playerCam", new Vector3(0, 0, 0), scene);
    this.camera.parent = this.root;
    this.camera.minZ = 0.1;
    this.camera.fov = PLAYER_CAMERA_FOV;
    this.camera.angularSensibility = 8000;

    this.yaw = this.root.rotation.y;
    this.pitch = this.camera.rotation.x;
    this.applyCameraRig();

    const onPause = () => {
      this.updateMovementSfx("idle");
    };
    const onItemInspectorOpened = () => this.settlePickupActionBehindInspector();
    window.addEventListener("bosque:pause", onPause);
    window.addEventListener(ITEM_INSPECTOR_OPENED_EVENT, onItemInspectorOpened);
    scene.onDisposeObservable.addOnce(() => {
      window.removeEventListener("bosque:pause", onPause);
      window.removeEventListener(ITEM_INSPECTOR_OPENED_EVENT, onItemInspectorOpened);
    });
  }

  get position() {
    return this.root.position;
  }

  /** Writes the character's ground/feet contact point without allocating. */
  getGroundContactPositionToRef(result: Vector3) {
    result.copyFrom(this.root.position);
    result.y -= this.settings.eyeHeight;
    return result;
  }

  /** Writes the animated torso center used to align death follow-up effects. */
  getAnimatedBodyCenterPositionToRef(result: Vector3) {
    if (this.deathBodyAnchorMesh && this.deathBodyAnchorBone) {
      this.deathBodyAnchorMesh.computeWorldMatrix(true);
      this.deathBodyAnchorBone.getAbsolutePositionToRef(
        this.deathBodyAnchorMesh,
        result
      );
      return result;
    }

    const bounds = this.getAvatarBounds();
    if (bounds) {
      result.copyFrom(bounds.min).addInPlace(bounds.max).scaleInPlace(0.5);
      return result;
    }
    result.copyFrom(this.root.position);
    result.y -= this.settings.eyeHeight * 0.5;
    return result;
  }

  /** Writes the animated Mixamo neck position used by external grab IK. */
  getNeckWorldPositionToRef(result: Vector3) {
    if (this.grabStruggleController?.getJointWorldPositionToRef("neck", result)) {
      return result;
    }
    result.copyFrom(this.root.position);
    result.y -= 0.2;
    return result;
  }

  getCollisionHeight() {
    return this.settings.eyeHeight;
  }

  get currentViewMode() {
    return this.viewMode;
  }

  get isIsometricViewAllowed() {
    return this.isometricViewAllowed;
  }

  get waterLocomotionState() {
    return this.waterLocomotionStateValue;
  }

  get currentAnimationName() {
    return this.currentAnimation;
  }

  get isOpeningSequenceActive() {
    return this.openingSequenceActive;
  }

  get isCinematicSequenceActive() {
    return this.cinematicSequenceActive;
  }

  get isGameplayControlLocked() {
    return this.controlsLocked;
  }

  get isNeckGrabbed() {
    return this.neckGrabRestrained;
  }

  get isRunning() {
    const movement = this.input.getMovement();
    return (
      Math.hypot(movement.x, movement.y) > 0.12 &&
      resolveRunningRequest(
        this.input.isDown("run"),
        this.settings.runningEnabled
      )
    );
  }

  get isUnderEnemyGrabPressure() {
    return this.enemyGrabPressureTimer > 0;
  }

  get isDiving() {
    return this.diving;
  }

  private get controlsLocked() {
    return (
      this.openingSequenceActive ||
      this.cinematicSequenceActive ||
      this.deathSequenceActive
    );
  }

  setWaterSurfaceRegistry(registry: WaterSurfaceRegistry) {
    this.waterSurfaces = registry;
  }

  getAvatarMeshes(): readonly AbstractMesh[] {
    return this.avatarMeshes;
  }

  getRegisteredAnimationNames() {
    return [...this.animations.keys()];
  }

  onViewModeChange(listener: (mode: ViewMode) => void) {
    this.viewModeListeners.add(listener);
    listener(this.viewMode);
    return () => this.viewModeListeners.delete(listener);
  }

  setViewMode(mode: ViewMode, transitionSeconds = 0) {
    if (this.controlsLocked) return;
    if (mode === "iso" && !this.isometricViewAllowed) return;
    if (this.viewMode === mode) return;
    let transitionOrigin: Vector3 | null = null;
    if (transitionSeconds > 0) {
      this.root.computeWorldMatrix(true);
      this.camera.computeWorldMatrix();
      transitionOrigin = this.camera.globalPosition.clone();
    }

    const previousMode = this.viewMode;
    this.viewMode = mode;
    if (mode === "iso" && previousMode !== "iso") this.syncIsometricAimFromYaw();
    this.clampPitchForView();
    this.applyCameraRig();
    this.cameraViewTransition = transitionOrigin
      ? {
          fromWorldPosition: transitionOrigin,
          elapsed: 0,
          duration: Math.max(0.08, transitionSeconds),
        }
      : null;
    for (const listener of this.viewModeListeners) listener(mode);
  }

  setIsometricViewAllowed(allowed: boolean, transitionSeconds = 0) {
    if (this.isometricViewAllowed === allowed) return;
    this.isometricViewAllowed = allowed;
    if (!allowed && this.viewMode === "iso") {
      this.setViewMode("third", transitionSeconds);
      return;
    }
    // Availability changes the camera-cycle label even when the active mode
    // remains the same, so refresh the existing view listeners.
    for (const listener of this.viewModeListeners) listener(this.viewMode);
  }

  setIsometricCameraAnchor(anchor: IsometricCameraAnchor | null) {
    if (anchor) {
      this.isometricCameraAnchor = anchor;
      this.isometricCameraAnchorEnabled = true;
      return;
    }
    this.isometricCameraAnchorEnabled = false;
  }

  get isUsingIsometricCameraAnchor() {
    return (
      this.viewMode === "iso" &&
      this.isometricCameraAnchor !== null &&
      this.isometricCameraAnchorBlend > 0.001
    );
  }

  toggleViewMode() {
    this.setViewMode(
      getNextPrimaryViewMode(this.viewMode, this.isometricViewAllowed)
    );
  }

  async loadCharacter(rootUrl = CHARACTER_ROOT_URL, fileName = CHARACTER_FILES[this.character]) {
    if (this.avatarRoot) return;

    const res = await SceneLoader.ImportMeshAsync(null, rootUrl, fileName, this.scene);
    const avatarRoot = new TransformNode("playerAvatarRoot", this.scene);
    avatarRoot.parent = this.deathPresentationRoot;
    avatarRoot.position.set(0, -this.settings.eyeHeight, 0);

    const importedNodes = [...res.meshes, ...res.transformNodes];
    for (const node of importedNodes) {
      if (!node.parent) node.parent = avatarRoot;
    }

    this.avatarRoot = avatarRoot;
    this.avatarMeshes = res.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    this.resolveDeathBodyAnchor(res.meshes);
    this.resolveThrowHandBones(res.meshes);
    for (const mesh of this.avatarMeshes) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.visibility = 1;
      (mesh as any).hasVertexAlpha = false;
      (mesh as any).alphaIndex = 0;
      this.patchAvatarMaterial(mesh.material);
    }

    this.animations.clear();
    for (const group of res.animationGroups) {
      group.stop();
      if (!REGISTERED_CHARACTER_ANIMATIONS.has(group.name)) continue;
      this.animations.set(group.name, group);
    }
    this.throwUpperBodyAnimation = this.createThrowUpperBodyAnimation();
    this.grabStruggleController?.dispose();
    this.grabStruggleController = new ProceduralGrabStruggleController(
      this.scene,
      this.root,
      avatarRoot,
      this.avatarMeshes,
      res.animationGroups,
      this.character,
      {},
      import.meta.env.DEV
    );

    this.normalizeAvatar();
    this.setAvatarVisible(this.viewMode !== "first");
    if (
      !charactersWithPlayedOpeningAnimation.has(this.character) &&
      this.animations.has(CHARACTER_ANIMATIONS.standingUp)
    ) {
      this.openingAnimationPending = true;
      this.playAnimation("idle", true);
    } else {
      this.playAnimation("idle", true);
    }
  }

  prepareOpeningSequence() {
    if (this.viewMode !== "third") this.setViewMode("third");
    this.openingSequenceActive = true;
    this.cameraViewTransition = null;
    this.resetInputState();
    this.applyCameraRig();
    this.root.computeWorldMatrix(true);
    this.openingCameraState = {
      fromWorldPosition: Vector3.TransformCoordinates(
        OPENING_CAMERA_LOCAL_POSITION,
        this.root.getWorldMatrix()
      ),
      phase: "holding",
      elapsed: 0,
      duration: OPENING_CAMERA_MIN_DESCENT_SECONDS,
    };
  }

  async playOpeningSequence() {
    if (!this.openingSequenceActive) return;

    let group: AnimationGroup | null = null;
    if (this.openingAnimationPending) {
      this.openingAnimationPending = false;
      charactersWithPlayedOpeningAnimation.add(this.character);
      group = this.playAction("standingUp", 1, STANDING_UP_BLEND_TIME);
    }

    const animationDuration = group ? this.getAnimationDurationSeconds(group) : 3.2;
    if (this.openingCameraState) {
      this.openingCameraState.phase = "descending";
      this.openingCameraState.elapsed = 0;
      this.openingCameraState.duration = Math.max(
        OPENING_CAMERA_MIN_DESCENT_SECONDS,
        Math.min(OPENING_CAMERA_MAX_DESCENT_SECONDS, animationDuration * 0.92)
      );
    }

    try {
      if (group) {
        await new Promise<void>((resolve) => {
          group?.onAnimationGroupEndObservable.addOnce(() => resolve());
        });
      } else {
        await this.waitForSceneSeconds(animationDuration);
      }
    } finally {
      this.openingCameraState = null;
      this.openingSequenceActive = false;
      this.resetInputState();
    }
  }

  /** Locks gameplay input and hands camera framing to an in-world cinematic. */
  beginCinematicSequence() {
    if (this.controlsLocked) return false;
    this.cinematicReturnState = {
      viewMode: this.viewMode,
      yaw: this.yaw,
      pitch: this.pitch,
    };
    if (this.viewMode !== "third") this.setViewMode("third");
    this.cinematicSequenceActive = true;
    this.cameraViewTransition = null;
    this.resetInputState();
    return true;
  }

  setCinematicCamera(
    worldPosition: Vector3,
    worldTarget: Vector3,
    roll = 0,
    fieldOfView = PLAYER_CAMERA_FOV
  ) {
    if (!this.cinematicSequenceActive) return;
    if (!this.cinematicCameraState) {
      this.cinematicCameraState = {
        worldPosition: worldPosition.clone(),
        worldTarget: worldTarget.clone(),
        roll,
        fieldOfView,
      };
      return;
    }
    this.cinematicCameraState.worldPosition.copyFrom(worldPosition);
    this.cinematicCameraState.worldTarget.copyFrom(worldTarget);
    this.cinematicCameraState.roll = roll;
    this.cinematicCameraState.fieldOfView = fieldOfView;
  }

  /** Restores gameplay and blends from the last cinematic frame to the player rig. */
  endCinematicSequence(transitionSeconds = 0.85) {
    if (!this.cinematicSequenceActive) return;
    this.root.computeWorldMatrix(true);
    this.camera.computeWorldMatrix();
    const transitionOrigin = this.camera.globalPosition.clone();
    const returnState = this.cinematicReturnState;
    this.cinematicReturnState = null;
    this.cinematicCameraState = null;
    this.cinematicSequenceActive = false;
    if (returnState) {
      this.yaw = returnState.yaw;
      this.pitch = returnState.pitch;
      if (this.viewMode !== returnState.viewMode) {
        this.setViewMode(returnState.viewMode);
      } else {
        this.applyCameraRig();
      }
    }
    // Never let cinematic roll or a widened lens leak into gameplay.
    this.camera.rotation.z = 0;
    this.camera.fov = PLAYER_CAMERA_FOV;
    this.resetInputState();
    this.cameraViewTransition = {
      fromWorldPosition: transitionOrigin,
      elapsed: 0,
      duration: Math.max(0.08, transitionSeconds),
    };
  }

  playInteractionAction(type?: string, movementLockSeconds?: number) {
    if (type === "door") {
      this.lockMovement(movementLockSeconds ?? DOOR_OPEN_MOVEMENT_LOCK_SECONDS);
      this.playAction("openDoor");
      return;
    }

    if (type === "throw" || type === "throwObject") {
      this.playThrowObject(movementLockSeconds ?? THROW_ACTION_MOVEMENT_LOCK_SECONDS);
      return;
    }

    this.playAction("pickUpItem", PICKUP_ACTION_SPEED_RATIO);
  }

  playThrowObject(movementLockSeconds = THROW_ACTION_MOVEMENT_LOCK_SECONDS) {
    this.lockMovement(movementLockSeconds);
    this.playAction("throwObject");
  }

  /** Starts the authored throw and holds it immediately before the forward cast. */
  beginChargedThrow() {
    if (
      this.controlsLocked ||
      this.neckGrabRestrained ||
      this.actionPlaying ||
      this.chargedThrowAction ||
      this.waterLocomotionStateValue !== "grounded"
    ) {
      return false;
    }

    const group = this.throwUpperBodyAnimation;
    if (!group) return false;
    group.stop(true);
    this.setAnimationWeight(group, 0);
    group.start(false);
    const frameSpan = group.to - group.from;
    const chargeReference = THROW_CHARGE_REFERENCE_FRAMES[this.character];
    const holdNormalizedFrame =
      chargeReference.holdFrame / chargeReference.totalFrames;
    const releaseNormalizedFrame =
      chargeReference.releaseFrame / chargeReference.totalFrames;
    const endNormalizedFrame =
      chargeReference.endFrame / chargeReference.totalFrames;
    this.chargedThrowAction = {
      group,
      holdFrame: group.from + frameSpan * holdNormalizedFrame,
      releaseFrame: group.from + frameSpan * releaseNormalizedFrame,
      endFrame: group.from + frameSpan * endNormalizedFrame,
      released: false,
      launched: false,
      launch: null,
      blendWeight: 0,
      finishing: false,
    };
    return true;
  }

  /** Resumes the held clip and emits the projectile at the authored release phase. */
  releaseChargedThrow(launch: () => void) {
    const state = this.chargedThrowAction;
    if (!state || state.released) return false;
    state.released = true;
    state.launch = launch;
    if (state.group.getCurrentFrame() >= state.releaseFrame) {
      this.launchChargedThrowProjectile(state);
    }
    if (!state.group.isPlaying) state.group.restart();
    return true;
  }

  cancelChargedThrow() {
    const state = this.chargedThrowAction;
    if (!state) return;
    this.chargedThrowAction = null;
    state.group.stop(true);
    this.setAnimationWeight(state.group, 0);
    this.updateThrowBaseAnimationWeights(0);
  }

  /** Keeps input responsive while a grab briefly slows and tugs the character. */
  applyEnemyGrabPressure(
    sourceId: string,
    source: Vector3,
    duration: number,
    movementMultiplier: number,
    pullSpeed: number
  ) {
    this.enemyGrabSource.copyFrom(source);
    this.enemyGrabPressureTimer = Math.max(this.enemyGrabPressureTimer, duration);
    this.enemyGrabMovementMultiplier = Math.min(
      this.enemyGrabMovementMultiplier,
      Math.max(0.35, Math.min(1, movementMultiplier))
    );
    this.enemyGrabPullSpeed = Math.max(this.enemyGrabPullSpeed, Math.max(0, pullSpeed));
    const id = sourceId.trim();
    if (id && this.enemyGrabSources.has(id)) {
      const storedSource = this.enemyGrabSources.get(id);
      if (storedSource) storedSource.copyFrom(source);
      else this.enemyGrabSources.set(id, source.clone());
      this.updateEnemyGrabDirection();
    }
  }

  /** Plays a scene-independent procedural reaction requested by any combat source. */
  playReaction(event: PlayerReactionEvent) {
    if (this.controlsLocked) return false;
    let played = false;
    if (event.kind === "hit") {
      const direction = this.resolveHitReactionDirection(event);
      const resolvedEvent: PlayerHitReactionEvent = { ...event, direction };
      played =
        this.grabStruggleController?.triggerHitReaction(resolvedEvent) ?? false;
      if (
        played &&
        (event.direction !== undefined ||
          event.sourcePosition !== undefined ||
          (event.movementLockSeconds ?? 0) > 0)
      ) {
        this.hitReactionMovement = {
          direction,
          elapsed: 0,
          duration: getPlayerHitReactionDuration(
            event.strength ?? 1,
            event.impactType
          ),
          previousTravel: 0,
          strength: event.strength ?? 1,
          impactType: event.impactType ?? "blunt",
        };
      }
    } else {
      this.hitReactionMovement = null;
      played =
        this.grabStruggleController?.triggerDodgeReaction(event) ?? false;
    }
    if (played && (event.movementLockSeconds ?? 0) > 0) {
      this.lockMovement(event.movementLockSeconds ?? 0);
    }
    return played;
  }

  /**
   * Gives every lethal damage source the same authored death reaction. The
   * final frame remains held so a level-owned sequence can present a portal,
   * burial, respawn, or any other follow-up without the idle clip returning.
   */
  playDeathAnimation() {
    if (this.deathSequenceActive) return 0;
    this.deathSequenceActive = true;
    this.cancelChargedThrow();
    this.setNeckGrabState({ active: false });
    this.clearEnemyGrabStruggles();
    this.hitReactionMovement = null;
    this.movementLockTimer = 0;
    this.grabStruggleController?.dispose();
    this.grabStruggleController = null;
    this.resetInputState();

    this.actionPlaying = true;
    const group = this.playAnimation("dying", false, ACTION_BLEND_TIME);
    if (!group) return 1.8;

    const duration = this.getAnimationDurationSeconds(group);
    group.onAnimationGroupEndObservable.addOnce(() => {
      if (!this.deathSequenceActive || this.currentAnimation !== group.name) return;
      group.goToFrame(group.to, true);
      group.pause();
      this.actionPlaying = true;
    });
    return duration;
  }

  /** Sinks only the avatar presentation; collision and the cinematic camera stay fixed. */
  setDeathSinkProgress(progress: number) {
    const amount = Math.max(0, Math.min(1, progress));
    const eased = amount * amount * (3 - 2 * amount);
    this.deathPresentationRoot.position.y = -2.35 * eased;
    const scale = 1 - eased * 0.12;
    this.deathPresentationRoot.scaling.setAll(scale);
  }

  /** Convenience wrapper retained for damage systems that only need an impact. */
  playHitReaction(event: Omit<PlayerHitReactionEvent, "kind"> = {}) {
    return this.playReaction({ ...event, kind: "hit" });
  }

  /** Convenience wrapper for traps, enemies and other timed-avoidance systems. */
  playDodgeReaction(event: Omit<PlayerDodgeReactionEvent, "kind"> = {}) {
    return this.playReaction({ ...event, kind: "dodge" });
  }

  setNeckGrabState(state: ProceduralNeckGrabState) {
    this.neckGrabCameraLift = state.active
      ? Math.max(0, Math.min(1, state.lift ?? 0))
      : 0;
    if (state.active && !this.neckGrabRestrained) {
      this.cancelChargedThrow();
      this.jumpQueued = false;
      this.waterActionQueued = false;
    } else if (!state.active && this.neckGrabRestrained) {
      this.endNeckGrabSideCamera();
    }
    this.neckGrabRestrained = state.active;
    if (state.active && state.attackerPosition) {
      if (this.neckGrabCameraActive) {
        this.neckGrabCameraAttackerPosition.copyFrom(state.attackerPosition);
      } else {
        this.beginNeckGrabSideCamera(state.attackerPosition);
      }
    }
    this.grabStruggleController?.setNeckGrabState(state);
  }

  getNeckGrabCameraDebugSnapshot() {
    this.camera.computeWorldMatrix();
    return {
      active: this.neckGrabCameraActive,
      elapsed: this.neckGrabCameraElapsed,
      lift: this.neckGrabCameraLift,
      viewMode: this.viewMode,
      avatarVisible: this.avatarMeshes.some((mesh) => mesh.visibility > 0.01),
      side: vectorSnapshot(this.neckGrabCameraSide),
      playerPosition: vectorSnapshot(this.root.position),
      attackerPosition: vectorSnapshot(this.neckGrabCameraAttackerPosition),
      target: vectorSnapshot(this.neckGrabCameraTarget),
      worldPosition: vectorSnapshot(this.camera.globalPosition),
      mode: this.camera.mode,
      fieldOfView: this.camera.fov,
    };
  }

  /** Starts the procedural struggle for one grabber without duplicating ownership. */
  beginEnemyGrabStruggle(sourceId: string) {
    const id = sourceId.trim();
    if (!id || this.enemyGrabSources.has(id)) return;
    this.enemyGrabSources.set(id, null);
    this.grabStruggleController?.setActiveGrabberCount(this.enemyGrabSources.size);
  }

  /** Releases one grabber without cancelling a struggle owned by another. */
  endEnemyGrabStruggle(sourceId: string) {
    if (!this.enemyGrabSources.delete(sourceId.trim())) return;
    this.grabStruggleController?.setActiveGrabberCount(this.enemyGrabSources.size);
    this.updateEnemyGrabDirection();
  }

  /** Clears visual grab ownership on death, respawn, or scene teardown. */
  clearEnemyGrabStruggles() {
    if (this.enemyGrabSources.size === 0) return;
    this.enemyGrabSources.clear();
    this.enemyGrabDirection.setAll(0);
    this.enemyGrabLookDirection.setAll(0);
    this.enemyGrabLookTargetId = null;
    this.grabStruggleController?.setGrabDirection(this.enemyGrabDirection);
    this.grabStruggleController?.setLookDirection(this.enemyGrabLookDirection);
    this.grabStruggleController?.setActiveGrabberCount(0);
  }

  getGrabStruggleDebugSnapshot(): ProceduralGrabStruggleDebugSnapshot | null {
    return this.grabStruggleController?.getDebugSnapshot() ?? null;
  }

  setGrabStruggleDebugPoseMask(
    mask: Partial<ProceduralGrabStruggleDebugPoseMask>
  ) {
    this.grabStruggleController?.setDebugPoseMask(mask);
    return this.getGrabStruggleDebugSnapshot();
  }

  private resolveHitReactionDirection(event: PlayerHitReactionEvent) {
    const direction = event.direction?.clone() ?? Vector3.Zero();
    direction.y = 0;
    if (direction.lengthSquared() <= 0.000001 && event.sourcePosition) {
      direction.set(
        this.root.position.x - event.sourcePosition.x,
        0,
        this.root.position.z - event.sourcePosition.z
      );
    }
    if (direction.lengthSquared() <= 0.000001) {
      direction.set(
        -Math.sin(this.root.rotation.y),
        0,
        -Math.cos(this.root.rotation.y)
      );
    } else {
      direction.normalize();
    }
    return direction;
  }

  private updateHitReactionMovement(dt: number, world: PlayerWorldQuery) {
    const movement = this.hitReactionMovement;
    if (!movement || movement.duration <= 0) return;
    movement.elapsed = Math.min(movement.duration, movement.elapsed + dt);
    const progress = movement.elapsed / movement.duration;
    const sample = samplePlayerHitReaction(
      progress,
      movement.strength,
      movement.impactType
    );
    const travel = Math.max(movement.previousTravel, sample.travel);
    const step = travel - movement.previousTravel;
    movement.previousTravel = travel;

    if (
      step > 0.00001 &&
      this.waterLocomotionStateValue === "grounded"
    ) {
      const feetY = this.root.position.y - this.settings.eyeHeight;
      const headY = this.root.position.y + 0.25;
      const targetX = this.root.position.x + movement.direction.x * step;
      if (!world.isColliding(targetX, this.root.position.z, 0, feetY, headY)) {
        this.root.position.x = targetX;
      }
      const targetZ = this.root.position.z + movement.direction.z * step;
      if (!world.isColliding(this.root.position.x, targetZ, 0, feetY, headY)) {
        this.root.position.z = targetZ;
      }
    }

    if (movement.elapsed >= movement.duration) {
      this.hitReactionMovement = null;
    }
  }

  private lockMovement(seconds: number) {
    this.movementLockTimer = Math.max(this.movementLockTimer, seconds);
  }

  getLookRay(): LookRay {
    if (this.viewMode === "iso") {
      const direction = this.getPlanarForward();
      const proximityOrigin = this.root
        .getAbsolutePosition()
        .add(new Vector3(0, -this.settings.eyeHeight + ISOMETRIC_INTERACTION_HEIGHT, 0));
      return {
        origin: proximityOrigin.add(direction.scale(0.35)),
        direction,
        proximityOrigin,
        proximityRadius: ISOMETRIC_INTERACTION_RADIUS,
      };
    }

    const direction = this.camera.getDirection(Vector3.Forward());
    if (direction.lengthSquared() > 0) direction.normalize();

    if (this.viewMode !== "first") {
      return {
        origin: this.root.getAbsolutePosition().add(direction.scale(0.45)),
        direction,
      };
    }

    return {
      origin: this.camera.globalPosition.clone(),
      direction,
    };
  }

  getAttackAimViewportPosition() {
    return this.viewMode === "third"
      ? THIRD_PERSON_AIM_VIEWPORT_POSITION
      : CENTER_AIM_VIEWPORT_POSITION;
  }

  /** Ray passing through the visible combat reticle, including its 3P offset. */
  getAttackAimRay(): LookRay {
    if (this.viewMode !== "third") return this.getLookRay();

    const engine = this.scene.getEngine();
    const width = Math.max(1, engine.getRenderWidth());
    const height = Math.max(1, engine.getRenderHeight());
    const viewportPosition = this.getAttackAimViewportPosition();
    this.camera.computeWorldMatrix();
    const farPoint = Vector3.Unproject(
      new Vector3(width * viewportPosition.x, height * viewportPosition.y, 1),
      width,
      height,
      AIM_UNPROJECT_WORLD,
      this.camera.getViewMatrix(true),
      this.camera.getProjectionMatrix(true)
    );
    const origin = this.camera.globalPosition.clone();
    const direction = farPoint.subtract(origin);
    if (direction.lengthSquared() > 0) direction.normalize();
    return { origin, direction };
  }

  /** Animated palm position used by the held orb and projectile release. */
  getThrowHandWorldPositionToRef(result: Vector3) {
    const mesh = this.throwHandMesh;
    const hand = this.throwHandBone;
    if (!mesh || !hand || !mesh.skeleton) return false;

    this.root.computeWorldMatrix(true);
    mesh.computeWorldMatrix(true);
    mesh.skeleton.prepare(true);
    hand.getAbsolutePositionToRef(mesh, result);
    if (this.throwHandMiddleBone) {
      this.throwHandMiddleBone.getAbsolutePositionToRef(
        mesh,
        this.throwHandMiddlePosition
      );
      Vector3.LerpToRef(result, this.throwHandMiddlePosition, 0.58, result);
    }
    return true;
  }

  getFlashlightRay(): LookRay {
    if (this.viewMode === "first") {
      const look = this.getLookRay();
      return {
        origin: look.origin.add(look.direction.scale(0.45)).add(new Vector3(0, -0.08, 0)),
        direction: look.direction,
      };
    }

    this.root.computeWorldMatrix(true);
    const world = this.root.getWorldMatrix();
    const forward = Vector3.TransformNormal(Vector3.Forward(), world);
    const right = Vector3.TransformNormal(new Vector3(1, 0, 0), world);
    if (forward.lengthSquared() > 0) forward.normalize();
    if (right.lengthSquared() > 0) right.normalize();

    return {
      origin: this.root
        .getAbsolutePosition()
        .add(forward.scale(1.35))
        .add(right.scale(0.35))
        .add(new Vector3(0, -0.18, 0)),
      direction: this.getThirdPersonFlashlightDirection(forward),
    };
  }

  private getThirdPersonFlashlightDirection(forward: Vector3) {
    const flashlightPitch = Math.max(
      THIRD_PERSON_FLASHLIGHT_PITCH_MIN,
      Math.min(THIRD_PERSON_FLASHLIGHT_PITCH_MAX, this.pitch)
    );
    const direction = forward
      .scale(Math.cos(flashlightPitch))
      .add(Vector3.Up().scale(-Math.sin(flashlightPitch)));

    if (direction.lengthSquared() > 0) direction.normalize();
    return direction;
  }

  applyLookDelta(deltaYaw: number, deltaPitch: number) {
    if (this.controlsLocked) return;
    this.applyLook(deltaYaw, deltaPitch);
  }

  private getIsometricScreenMovementDirection(moveX: number, moveY: number) {
    return this.getIsometricWorldDirectionFromScreenAim(moveX, -moveY);
  }

  private faceScreenMovement(direction: Vector3) {
    if (direction.lengthSquared() <= 0) return;

    this.yaw = Math.atan2(direction.x, direction.z);
    if (this.viewMode === "iso") {
      this.syncIsometricAimFromYaw();
      this.applyCameraRig();
      return;
    }

    this.root.rotation.y = this.yaw;
  }

  private applyLook(deltaYaw: number, deltaPitch: number) {
    if (this.viewMode === "iso") {
      this.applyIsometricLook(deltaYaw, deltaPitch);
      return;
    }

    this.yaw += deltaYaw;
    this.pitch += deltaPitch;

    this.clampPitchForView();

    this.applyCameraRig();
  }

  private applyIsometricLook(deltaX: number, deltaY: number) {
    this.isometricAimX += deltaX * ISOMETRIC_MOUSE_AIM_SPEED;
    this.isometricAimY += deltaY * ISOMETRIC_MOUSE_AIM_SPEED;

    const length = Math.hypot(this.isometricAimX, this.isometricAimY);
    if (length > ISOMETRIC_AIM_DEADZONE) {
      this.isometricAimX /= length;
      this.isometricAimY /= length;
      const direction = this.getIsometricWorldDirectionFromScreenAim(this.isometricAimX, this.isometricAimY);
      this.yaw = Math.atan2(direction.x, direction.z);
    }

    this.pitch = 0;
    this.applyCameraRig();
  }

  private applyCameraRig() {
    this.configureCameraProjection();
    this.root.rotation.y = this.yaw;
    if (this.viewMode === "first") {
      this.positionFirstPersonCamera();
    } else if (this.viewMode === "iso") {
      this.positionIsometricCamera();
    } else {
      this.positionThirdPersonCamera();
    }
    this.setAvatarVisible(this.viewMode !== "first");
  }

  private clampPitchForView() {
    if (this.viewMode === "iso") {
      this.pitch = 0;
      return;
    }

    const minPitch = this.viewMode === "first" ? -1.45 : THIRD_PERSON_PITCH_MIN;
    const maxPitch = this.viewMode === "first" ? 1.45 : THIRD_PERSON_PITCH_MAX;
    if (this.pitch < minPitch) this.pitch = minPitch;
    if (this.pitch > maxPitch) this.pitch = maxPitch;
  }

  update(dt: number, world: PlayerWorldQuery) {
    // Streaming and shader compilation can occasionally stall a frame. Never
    // convert that wall-clock pause into several metres of player movement.
    dt = Math.max(0, Math.min(dt, MAX_SIMULATION_DELTA_SECONDS));
    const previousX = this.root.position.x;
    const previousZ = this.root.position.z;
    const wasGrounded = this.grounded;
    const inputActive = this.input.isGameplayInputEnabled();
    if (!this.controlsLocked && !this.neckGrabRestrained) {
      if (inputActive) {
        const look = this.input.getLook();
        if (look.x !== 0 || look.y !== 0) this.applyLook(look.x, look.y);
      }
      if (this.input.wasPressed("changeCamera")) this.toggleViewMode();
      if (
        resolveJumpRequest(
          inputActive && this.input.wasPressed("jump"),
          this.settings.jumpingEnabled
        )
      ) {
        this.jumpQueued = true;
        this.waterActionQueued = true;
      }
      if (inputActive && this.input.wasPressed("waterAction")) this.waterActionQueued = true;
    }
    this.updateChargedThrowAction(dt);
    this.updatePickupActionTransition();
    this.updateIsometricCameraAnchorBlend(dt);

    if (this.enemyGrabPressureTimer > 0) {
      this.enemyGrabPressureTimer = Math.max(0, this.enemyGrabPressureTimer - dt);
      if (this.enemyGrabPressureTimer === 0) {
        this.enemyGrabMovementMultiplier = 1;
        this.enemyGrabPullSpeed = 0;
      }
    }

    if (this.movementLockTimer > 0) {
      this.movementLockTimer = Math.max(0, this.movementLockTimer - dt);
    }
    if (this.shallowWaterTransitionTimer > 0) {
      this.shallowWaterTransitionTimer = Math.max(
        0,
        this.shallowWaterTransitionTimer - dt
      );
    }

    this.updateHitReactionMovement(dt, world);

    this.refreshWaterEnvironment(world);
    this.refreshWaterLocomotionState();
    const movementLocked =
      this.controlsLocked ||
      this.neckGrabRestrained ||
      this.movementLockTimer > 0 ||
      this.actionPlaying;
    this.consumeWaterAction(movementLocked);
    this.updateSwimmingCameraBlend(dt);

    if (!inputActive) {
      if (!this.actionPlaying) this.resumeIdleOrWaterAnimation();
      this.jumpQueued = false;
      this.updateMovementSfx("idle");
      this.updateAnimationFade(dt);
      this.updateStairPresentation(dt, world, previousX, previousZ, false);
      this.updateThirdPersonCameraCollision(dt, world);
      return;
    }

    this.root.computeWorldMatrix(true);
    const forward = Vector3.TransformNormal(Vector3.Forward(), this.root.getWorldMatrix());
    forward.y = 0;
    if (forward.lengthSquared() > 0) forward.normalize();

    const right = Vector3.Cross(Vector3.Up(), forward);
    if (right.lengthSquared() > 0) right.normalize();
    const movementForward =
      this.waterLocomotionStateValue === "swimming" && this.viewMode !== "iso"
        ? forward
            .scale(Math.cos(this.pitch))
            .add(Vector3.Up().scale(-Math.sin(this.pitch)))
        : forward;

    const move = new Vector3(0, 0, 0);
    const movement = this.input.getMovement();
    let moveX = Math.max(-1, Math.min(1, movement.x));
    let moveY = Math.max(-1, Math.min(1, movement.y));
    const inputStrength = Math.min(1, Math.hypot(moveX, moveY));
    if (this.viewMode === "iso" && movement.reference === "screen" && inputStrength > 0.12) {
      const screenDirection = this.getIsometricScreenMovementDirection(moveX, moveY);
      this.faceScreenMovement(screenDirection);
      move.addInPlace(screenDirection.scale(inputStrength));
      moveX = 0;
      moveY = inputStrength;
    } else {
      move.addInPlace(movementForward.scale(moveY));
      move.addInPlace(right.scale(moveX));
    }

    const running = resolveRunningRequest(
      this.input.isDown("run"),
      this.settings.runningEnabled
    );
    const baseSpeed =
      this.waterLocomotionStateValue === "swimming"
        ? SWIMMING_SPEED
        : this.waterLocomotionStateValue === "treadingWater"
          ? TREADING_WATER_SPEED
          : running
            ? this.settings.runSpeed
            : this.settings.walkSpeed;
    const speed =
      baseSpeed *
      (this.enemyGrabPressureTimer > 0 ? this.enemyGrabMovementMultiplier : 1);

    if (movementLocked) {
      moveX = 0;
      moveY = 0;
      move.set(0, 0, 0);
    }

    const collisionFeetY = this.root.position.y - this.settings.eyeHeight;
    const collisionHeadY = this.root.position.y + 0.25;
    const isMovementBlocked = (x: number, z: number) =>
      world.isColliding(x, z, 0, collisionFeetY, collisionHeadY);

    if (move.lengthSquared() > 0) {
      move.normalize().scaleInPlace(speed * dt * inputStrength);

      const px = this.root.position.x;
      const pz = this.root.position.z;

      const tryX = px + move.x;
      if (!isMovementBlocked(tryX, pz)) this.root.position.x = tryX;

      const tryZ = pz + move.z;
      if (!isMovementBlocked(this.root.position.x, tryZ)) this.root.position.z = tryZ;
    }

    if (this.enemyGrabPressureTimer > 0 && this.enemyGrabPullSpeed > 0) {
      let pullX = this.enemyGrabSource.x - this.root.position.x;
      let pullZ = this.enemyGrabSource.z - this.root.position.z;
      const pullDistance = Math.hypot(pullX, pullZ);
      if (pullDistance > 0.05) {
        const pullStep = Math.min(pullDistance, this.enemyGrabPullSpeed * dt);
        pullX = (pullX / pullDistance) * pullStep;
        pullZ = (pullZ / pullDistance) * pullStep;
        const pullTargetX = this.root.position.x + pullX;
        if (!isMovementBlocked(pullTargetX, this.root.position.z)) {
          this.root.position.x = pullTargetX;
        }
        const pullTargetZ = this.root.position.z + pullZ;
        if (!isMovementBlocked(this.root.position.x, pullTargetZ)) {
          this.root.position.z = pullTargetZ;
        }
      }
    }

    const maxX = 60;
    const margin = 0.25;
    if (this.root.position.x > maxX - margin) this.root.position.x = maxX - margin;
    if (this.root.position.x < -maxX + margin) this.root.position.x = -maxX + margin;

    this.refreshWaterEnvironment(world);
    this.refreshWaterLocomotionState();
    const currentFeetY = this.root.position.y - this.settings.eyeHeight;
    const maximumWalkableSurfaceY =
      currentFeetY + (this.velY > 0.01 ? -0.01 : 0.1);
    const groundY = world.getWalkableSurfaceHeight(
      this.root.position.x,
      this.root.position.z,
      currentFeetY,
      maximumWalkableSurfaceY
    );
    const targetY = groundY + this.settings.eyeHeight;
    const horizontalTravel = Math.hypot(
      this.root.position.x - previousX,
      this.root.position.z - previousZ
    );
    const hasStairSurface = Boolean(
      world.getStairSurfaceInfo?.(this.root.position.x, this.root.position.z) ??
      world.getStairSurfaceInfo?.(previousX, previousZ)
    );
    const keepGroundedOnStepDown = shouldKeepStairGrounded(
      wasGrounded,
      this.velY,
      this.root.position.y - targetY,
      horizontalTravel,
      hasStairSurface
    );

    if (this.waterLocomotionStateValue === "swimming" && this.activeWaterSurface) {
      this.updateSwimmingVerticalMotion(
        dt,
        move.y,
        this.getSwimmingFloorHeight(world)
      );
      this.jumpQueued = false;
    } else if (
      this.waterLocomotionStateValue === "treadingWater" &&
      this.activeWaterSurface
    ) {
      this.updateTreadingWaterVerticalMotion(dt, groundY);
      this.jumpQueued = false;
    } else {
      if (this.root.position.y <= targetY + 0.02) {
        this.root.position.y = targetY;
        this.velY = 0;
        this.grounded = true;
      } else if (keepGroundedOnStepDown) {
        // Theatre stairs remain physically discrete, but descending one riser
        // is still supported locomotion. The visual root and camera perform
        // the downward interpolation; gameplay must not enter the jump state.
        this.root.position.y = targetY;
        this.velY = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }

      if (
        this.settings.jumpingEnabled !== false &&
        !movementLocked &&
        this.jumpQueued &&
        this.grounded
      ) {
        this.velY = this.settings.jumpSpeed;
        this.grounded = false;
        this.playSfx("jump");
      }

      this.velY += this.settings.gravity * dt;
      this.root.position.y += this.velY * dt;

      if (this.root.position.y < targetY) {
        this.root.position.y = targetY;
        this.velY = 0;
        this.grounded = true;
      }
    }
    this.jumpQueued = false;

    this.updateStairPresentation(
      dt,
      world,
      previousX,
      previousZ,
      !movementLocked && this.grounded
    );
    this.updateThirdPersonCameraCollision(dt, world);
    this.updateAvatarAnimation(moveX, moveY, running);
    const moving = Math.abs(moveX) > 0.12 || Math.abs(moveY) > 0.12;
    this.updateMovementSfx(
      moving && this.grounded && this.waterLocomotionStateValue === "grounded"
        ? running
          ? "run"
          : "walk"
        : "idle"
    );
    this.updateAnimationFade(dt);
  }

  private updateStairPresentation(
    dt: number,
    world: PlayerWorldQuery,
    previousX: number,
    previousZ: number,
    movementAllowed: boolean
  ) {
    if (!world.getStairSurfaceInfo) {
      this.stairBodyPresentationY = null;
      this.stairCameraPresentationY = null;
      this.stairBodyOffsetY = 0;
      this.stairCameraOffsetY = 0;
      return;
    }

    const previousSurface = world.getStairSurfaceInfo(previousX, previousZ);
    const currentSurface = world.getStairSurfaceInfo(
      this.root.position.x,
      this.root.position.z
    );
    const surface = currentSurface ?? previousSurface;
    const physicalRootY = this.root.position.y;
    const canUseStairs =
      this.grounded &&
      this.waterLocomotionStateValue === "grounded" &&
      !this.neckGrabRestrained &&
      !this.controlsLocked;

    if (!canUseStairs) {
      this.stairBodyPresentationY = physicalRootY;
      this.stairCameraPresentationY = physicalRootY;
      this.stairBodyOffsetY = 0;
      this.stairCameraOffsetY = 0;
      this.grabStruggleController?.setStairLocomotionState(
        INACTIVE_STAIR_LOCOMOTION
      );
      return;
    }

    this.stairBodyPresentationY ??= physicalRootY;
    this.stairCameraPresentationY ??= physicalRootY;
    const deltaX = this.root.position.x - previousX;
    const deltaZ = this.root.position.z - previousZ;
    const ascentTravel = surface
      ? deltaX * surface.ascentDirectionX + deltaZ * surface.ascentDirectionZ
      : 0;
    const traversalActive =
      movementAllowed && surface !== null && Math.abs(ascentTravel) > 0.00001;
    const targetPresentationY = traversalActive
      ? physicalRootY + surface.presentationHeight - surface.surfaceHeight
      : physicalRootY;

    this.stairBodyPresentationY = dampStairPresentation(
      this.stairBodyPresentationY,
      targetPresentationY,
      14,
      dt
    );
    this.stairCameraPresentationY = dampStairPresentation(
      this.stairCameraPresentationY,
      targetPresentationY,
      6.5,
      dt
    );
    this.stairBodyOffsetY = Math.max(
      -0.6,
      Math.min(0.6, this.stairBodyPresentationY - physicalRootY)
    );
    this.stairCameraOffsetY = Math.max(
      -0.9,
      Math.min(0.9, this.stairCameraPresentationY - physicalRootY)
    );
    this.stairBodyPresentationY = physicalRootY + this.stairBodyOffsetY;
    this.stairCameraPresentationY = physicalRootY + this.stairCameraOffsetY;

    this.grabStruggleController?.setStairLocomotionState(
      resolveStairLocomotion(
        surface,
        traversalActive ? ascentTravel : 0,
        dt,
        this.stairBodyOffsetY
      )
    );
  }

  private refreshWaterEnvironment(world: PlayerWorldQuery) {
    this.activeWaterSurface = this.waterSurfaces?.getWaterSurfaceAt(this.root.position) ?? null;
    if (!this.activeWaterSurface) {
      this.waterLevel = Number.NEGATIVE_INFINITY;
      this.waterDepthAtGround = 0;
      return;
    }

    this.waterLevel = getWaterLevelAt(this.activeWaterSurface, this.root.position);
    const groundY = this.getWalkableSurfaceHeight(world);
    this.waterDepthAtGround = Math.max(0, this.waterLevel - groundY);
  }

  private refreshWaterLocomotionState() {
    if (!this.activeWaterSurface) {
      this.diving = false;
      this.swimmingSurfaceEntryTimer = 0;
      this.shallowWaterTransitionTimer = 0;
      this.waterLocomotionStateValue = "grounded";
      return;
    }

    if (this.diving) {
      if (this.waterDepthAtGround <= TREADING_WATER_EXIT_DEPTH) {
        this.diving = false;
        this.swimmingSurfaceEntryTimer = 0;
        this.shallowWaterTransitionTimer = Math.max(
          this.shallowWaterTransitionTimer,
          SHALLOW_WATER_TREADING_TRANSITION_SECONDS
        );
      } else {
        this.waterLocomotionStateValue = "swimming";
        return;
      }
    }

    if (this.shallowWaterTransitionTimer > 0) {
      this.waterLocomotionStateValue = "treadingWater";
      return;
    }

    const feetAtOrBelowSurface =
      this.root.position.y - this.settings.eyeHeight <= this.waterLevel + 0.08;
    const depthThreshold =
      this.waterLocomotionStateValue === "treadingWater"
        ? TREADING_WATER_EXIT_DEPTH
        : TREADING_WATER_ENTER_DEPTH;
    this.waterLocomotionStateValue =
      feetAtOrBelowSurface && this.waterDepthAtGround >= depthThreshold
        ? "treadingWater"
        : "grounded";
  }

  private consumeWaterAction(movementLocked: boolean) {
    if (!this.waterActionQueued) return;
    this.waterActionQueued = false;
    if (movementLocked || !this.activeWaterSurface) return;

    if (
      this.waterLocomotionStateValue === "treadingWater" &&
      this.waterDepthAtGround >= TREADING_WATER_ENTER_DEPTH
    ) {
      this.diving = true;
      this.swimmingSurfaceEntryTimer = SWIMMING_SURFACE_ENTRY_SECONDS;
      this.shallowWaterTransitionTimer = 0;
      this.waterLocomotionStateValue = "swimming";
      this.velY = 0;
      this.jumpQueued = false;
      return;
    }

    if (this.waterLocomotionStateValue === "swimming") {
      if (this.root.position.y >= this.waterLevel - SWIMMING_SURFACE_TOGGLE_RANGE) {
        this.diving = false;
        this.swimmingSurfaceEntryTimer = 0;
        this.shallowWaterTransitionTimer = SHALLOW_WATER_TREADING_TRANSITION_SECONDS;
        this.waterLocomotionStateValue = "treadingWater";
      }
      this.jumpQueued = false;
    }
  }

  private updateSwimmingVerticalMotion(
    dt: number,
    inputVerticalMovement: number,
    groundY: number
  ) {
    const maximumRootY = this.waterLevel - SWIMMING_SURFACE_CEILING;
    if (this.swimmingSurfaceEntryTimer > 0) {
      this.swimmingSurfaceEntryTimer = Math.max(0, this.swimmingSurfaceEntryTimer - dt);
      const distance = maximumRootY - this.root.position.y;
      const step = WATER_VERTICAL_SETTLE_SPEED * dt;
      this.root.position.y += Math.max(-step, Math.min(step, distance));
    } else {
      let verticalMovement = inputVerticalMovement;
      if (Math.abs(verticalMovement) < 0.0001) {
        verticalMovement += SWIMMING_IDLE_BUOYANCY_SPEED * dt;
      }
      this.root.position.y += verticalMovement;
    }

    this.root.position.y = Math.min(this.root.position.y, maximumRootY);
    this.root.position.y = Math.max(
      this.root.position.y,
      groundY + SWIMMING_BOTTOM_BODY_CLEARANCE
    );
    this.velY = 0;
    this.grounded = false;
  }

  private updateTreadingWaterVerticalMotion(dt: number, groundY: number) {
    const standingRootY = groundY + this.settings.eyeHeight;
    const floatingRootY =
      this.waterLevel + this.settings.eyeHeight - TREADING_WATER_BODY_DEPTH;
    const targetRootY = Math.max(standingRootY, floatingRootY);
    const distance = targetRootY - this.root.position.y;
    const step = WATER_VERTICAL_SETTLE_SPEED * dt;
    this.root.position.y += Math.max(-step, Math.min(step, distance));
    this.velY = 0;
    this.grounded = false;
  }

  private getSwimmingFloorHeight(world: PlayerWorldQuery) {
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const x = this.root.position.x;
    const z = this.root.position.z;

    return Math.max(
      world.getTerrainHeight(x, z),
      world.getTerrainHeight(
        x + forwardX * SWIMMING_BODY_HALF_LENGTH,
        z + forwardZ * SWIMMING_BODY_HALF_LENGTH
      ),
      world.getTerrainHeight(
        x - forwardX * SWIMMING_BODY_HALF_LENGTH,
        z - forwardZ * SWIMMING_BODY_HALF_LENGTH
      ),
      world.getTerrainHeight(
        x + rightX * SWIMMING_BODY_HALF_WIDTH,
        z + rightZ * SWIMMING_BODY_HALF_WIDTH
      ),
      world.getTerrainHeight(
        x - rightX * SWIMMING_BODY_HALF_WIDTH,
        z - rightZ * SWIMMING_BODY_HALF_WIDTH
      )
    );
  }

  private updateSwimmingCameraBlend(dt: number) {
    const target = this.waterLocomotionStateValue === "swimming" ? 1 : 0;
    const step = SWIMMING_CAMERA_BLEND_SPEED * dt;
    if (this.swimmingCameraBlend < target) {
      this.swimmingCameraBlend = Math.min(target, this.swimmingCameraBlend + step);
    } else if (this.swimmingCameraBlend > target) {
      this.swimmingCameraBlend = Math.max(target, this.swimmingCameraBlend - step);
    }
  }

  private playSfx(name: "jump" | "walk" | "run") {
    window.dispatchEvent(new CustomEvent("bosque:sfx", { detail: { name } }));
  }

  private updateMovementSfx(state: "idle" | "walk" | "run") {
    if (this.sfxMovementState === state) return;
    if (this.sfxMovementState !== "idle") {
      window.dispatchEvent(
        new CustomEvent("bosque:sfx", {
          detail: { name: this.sfxMovementState, active: false },
        })
      );
    }

    this.sfxMovementState = state;
    if (state !== "idle") this.playSfx(state);
  }

  private updateThirdPersonCameraCollision(
    deltaTime: number,
    world: PlayerWorldQuery
  ) {
    this.configureCameraProjection();
    if (this.cinematicCameraState) {
      this.resetThirdPersonCameraCollisionState();
      this.root.computeWorldMatrix(true);
      const inverse = this.root.getWorldMatrix().clone().invert();
      this.camera.position.copyFrom(
        Vector3.TransformCoordinates(
          this.cinematicCameraState.worldPosition,
          inverse
        )
      );
      const localTarget = Vector3.TransformCoordinates(
        this.cinematicCameraState.worldTarget,
        inverse
      );
      this.lookAtLocal(localTarget);
      this.camera.rotation.z = this.cinematicCameraState.roll;
      this.camera.fov = this.cinematicCameraState.fieldOfView;
      return;
    }
    if (this.neckGrabCameraActive) {
      this.updateNeckGrabSideCamera(deltaTime, world);
      return;
    }
    if (this.viewMode === "first") {
      this.resetThirdPersonCameraCollisionState();
      this.positionFirstPersonCamera();
      this.applySwimmingCameraDepth();
      this.keepFirstPersonCameraAboveTerrain(world);
      return;
    }

    const target = this.getCameraTargetLocal();
    this.positionCameraForView();
    this.applySwimmingCameraDepth();
    this.root.computeWorldMatrix(true);
    this.camera.computeWorldMatrix();
    const origin = Vector3.TransformCoordinates(target, this.root.getWorldMatrix());
    const desired = this.applyOpeningCameraTransition(
      this.applyCameraViewTransition(this.camera.globalPosition.clone(), deltaTime),
      deltaTime
    );
    const adjusted = this.isUsingIsometricCameraAnchor
      ? desired
      : this.openingCameraState
        ? this.resolveCameraTerrainPosition(origin, desired, world)
      : this.resolveCameraTerrainPosition(
          origin,
          world.resolveCameraPosition(origin, desired),
          world
        );
    let terrainSafePosition = this.clampCameraAboveTerrain(adjusted, world);
    if (this.viewMode === "third" || this.viewMode === "front") {
      terrainSafePosition = this.smoothThirdPersonCameraArm(
        origin,
        terrainSafePosition,
        deltaTime,
        world
      );
      terrainSafePosition = this.liftCrampedThirdPersonCamera(
        origin,
        terrainSafePosition,
        world
      );
      this.updateThirdPersonAvatarVisibility(
        Vector3.Distance(origin, terrainSafePosition),
        deltaTime
      );
    } else {
      this.resetThirdPersonCameraCollisionState();
    }
    const inverse = this.root.getWorldMatrix().clone().invert();
    this.camera.position.copyFrom(
      Vector3.TransformCoordinates(terrainSafePosition, inverse)
    );
    this.orientCameraForView(target);
  }

  private beginNeckGrabSideCamera(attackerPosition: Vector3) {
    this.neckGrabCameraAttackerPosition.copyFrom(attackerPosition);
    this.root.computeWorldMatrix(true);
    this.camera.computeWorldMatrix();
    this.neckGrabCameraEntryPosition.copyFrom(this.camera.globalPosition);
    this.neckGrabCameraEntryFov = this.camera.fov;
    this.updateNeckGrabCameraTarget();

    const encounterX = this.root.position.x - attackerPosition.x;
    const encounterZ = this.root.position.z - attackerPosition.z;
    const encounterLength = Math.hypot(encounterX, encounterZ);
    if (encounterLength > 0.001) {
      this.neckGrabCameraSide.set(
        encounterZ / encounterLength,
        0,
        -encounterX / encounterLength
      );
    } else {
      this.neckGrabCameraSide.set(
        Math.cos(this.root.rotation.y),
        0,
        -Math.sin(this.root.rotation.y)
      );
    }

    const currentOffsetX =
      this.neckGrabCameraEntryPosition.x - this.neckGrabCameraTarget.x;
    const currentOffsetZ =
      this.neckGrabCameraEntryPosition.z - this.neckGrabCameraTarget.z;
    if (
      currentOffsetX * this.neckGrabCameraSide.x +
        currentOffsetZ * this.neckGrabCameraSide.z <
      0
    ) {
      this.neckGrabCameraSide.scaleInPlace(-1);
    }

    const currentForward = this.camera.getDirection(Vector3.Forward());
    const targetDistance = Math.max(
      2,
      Vector3.Distance(
        this.neckGrabCameraEntryPosition,
        this.neckGrabCameraTarget
      )
    );
    this.neckGrabCameraEntryTarget
      .copyFrom(this.neckGrabCameraEntryPosition)
      .addInPlace(currentForward.scale(targetDistance));

    this.neckGrabCameraElapsed = 0;
    this.neckGrabCameraSideResolved = false;
    this.neckGrabCameraActive = true;
    this.cameraViewTransition = null;
    this.thirdPersonCameraArmLength = null;
    this.avatarCameraVisibility = 1;
    this.setAvatarVisible(true);
  }

  private endNeckGrabSideCamera() {
    if (!this.neckGrabCameraActive) return;
    this.root.computeWorldMatrix(true);
    this.camera.computeWorldMatrix();
    const transitionOrigin = this.camera.globalPosition.clone();
    this.neckGrabCameraActive = false;
    this.neckGrabCameraElapsed = 0;
    this.camera.rotation.z = 0;
    this.camera.fov = PLAYER_CAMERA_FOV;
    this.cameraViewTransition = {
      fromWorldPosition: transitionOrigin,
      elapsed: 0,
      duration: NECK_GRAB_CAMERA_EXIT_SECONDS,
    };
    this.setAvatarVisible(this.viewMode !== "first");
  }

  private updateNeckGrabSideCamera(
    deltaTime: number,
    world: PlayerWorldQuery
  ) {
    this.camera.mode = Camera.PERSPECTIVE_CAMERA;
    this.resetThirdPersonCameraCollisionState();
    this.avatarCameraVisibility = 1;
    this.setAvatarVisible(true);
    this.updateNeckGrabCameraTarget();

    this.resolveNeckGrabCameraPosition(
      this.neckGrabCameraSide.x,
      this.neckGrabCameraSide.z,
      world,
      this.neckGrabCameraResolvedPosition
    );
    if (!this.neckGrabCameraSideResolved) {
      this.resolveNeckGrabCameraPosition(
        -this.neckGrabCameraSide.x,
        -this.neckGrabCameraSide.z,
        world,
        this.neckGrabCameraAlternativePosition
      );
      const preferredDistance = Vector3.Distance(
        this.neckGrabCameraTarget,
        this.neckGrabCameraResolvedPosition
      );
      const alternativeDistance = Vector3.Distance(
        this.neckGrabCameraTarget,
        this.neckGrabCameraAlternativePosition
      );
      if (alternativeDistance > preferredDistance + 0.35) {
        this.neckGrabCameraSide.scaleInPlace(-1);
        this.neckGrabCameraResolvedPosition.copyFrom(
          this.neckGrabCameraAlternativePosition
        );
      }
      this.neckGrabCameraSideResolved = true;
    }
    this.neckGrabCameraElapsed = Math.min(
      NECK_GRAB_CAMERA_ENTER_SECONDS,
      this.neckGrabCameraElapsed + Math.max(0, deltaTime)
    );
    const progress =
      this.neckGrabCameraElapsed / NECK_GRAB_CAMERA_ENTER_SECONDS;
    const smooth = progress * progress * (3 - 2 * progress);
    Vector3.LerpToRef(
      this.neckGrabCameraEntryPosition,
      this.neckGrabCameraResolvedPosition,
      smooth,
      this.neckGrabCameraBlendedPosition
    );
    Vector3.LerpToRef(
      this.neckGrabCameraEntryTarget,
      this.neckGrabCameraTarget,
      smooth,
      this.neckGrabCameraBlendedTarget
    );

    this.root.computeWorldMatrix(true);
    const inverse = this.root.getWorldMatrix().clone().invert();
    this.camera.position.copyFrom(
      Vector3.TransformCoordinates(this.neckGrabCameraBlendedPosition, inverse)
    );
    const localTarget = Vector3.TransformCoordinates(
      this.neckGrabCameraBlendedTarget,
      inverse
    );
    this.lookAtLocal(localTarget);
    this.camera.fov =
      this.neckGrabCameraEntryFov +
      (NECK_GRAB_CAMERA_FOV - this.neckGrabCameraEntryFov) * smooth;
  }

  private updateNeckGrabCameraTarget() {
    this.neckGrabCameraTarget.set(
      (this.root.position.x + this.neckGrabCameraAttackerPosition.x) * 0.5,
      this.root.position.y +
        NECK_GRAB_CAMERA_TARGET_HEIGHT_OFFSET +
        this.neckGrabCameraLift * NECK_GRAB_CAMERA_LIFT_METERS,
      (this.root.position.z + this.neckGrabCameraAttackerPosition.z) * 0.5
    );
  }

  private resolveNeckGrabCameraPosition(
    sideX: number,
    sideZ: number,
    world: PlayerWorldQuery,
    result: Vector3
  ) {
    this.neckGrabCameraDesiredPosition.copyFrom(this.neckGrabCameraTarget);
    this.neckGrabCameraDesiredPosition.x += sideX * NECK_GRAB_CAMERA_DISTANCE;
    this.neckGrabCameraDesiredPosition.y += NECK_GRAB_CAMERA_HEIGHT;
    this.neckGrabCameraDesiredPosition.z += sideZ * NECK_GRAB_CAMERA_DISTANCE;
    result.copyFrom(
      this.clampCameraAboveTerrain(
        this.resolveCameraTerrainPosition(
          this.neckGrabCameraTarget,
          world.resolveCameraPosition(
            this.neckGrabCameraTarget,
            this.neckGrabCameraDesiredPosition
          ),
          world
        ),
        world
      )
    );
  }

  private smoothThirdPersonCameraArm(
    origin: Vector3,
    safePosition: Vector3,
    deltaTime: number,
    world: PlayerWorldQuery
  ) {
    const safeOffset = safePosition.subtract(origin);
    const safeLength = safeOffset.length();
    if (safeLength <= 0.001) {
      this.thirdPersonCameraArmLength = 0;
      return safePosition;
    }

    const previousLength = this.thirdPersonCameraArmLength;
    let armLength = safeLength;
    if (previousLength !== null && safeLength > previousLength) {
      const recovery = 1 - Math.exp(-THIRD_PERSON_CAMERA_RECOVERY_SPEED * deltaTime);
      armLength = previousLength + (safeLength - previousLength) * recovery;
    }

    // Retraction is immediate, while extension is damped. Rechecking the
    // shortened arm keeps quick turns from sweeping the camera through a
    // nearby corner before it has recovered its normal distance.
    const candidate = origin.add(safeOffset.scale(armLength / safeLength));
    const collisionSafe = world.resolveCameraPosition(origin, candidate);
    const terrainSafe = this.clampCameraAboveTerrain(
      this.resolveCameraTerrainPosition(origin, collisionSafe, world),
      world
    );
    this.thirdPersonCameraArmLength = Vector3.Distance(origin, terrainSafe);
    return terrainSafe;
  }

  private liftCrampedThirdPersonCamera(
    origin: Vector3,
    cameraPosition: Vector3,
    world: PlayerWorldQuery
  ) {
    const cameraDistance = Vector3.Distance(origin, cameraPosition);
    const amount = Math.max(
      0,
      Math.min(
        1,
        (THIRD_PERSON_AVATAR_FADE_FAR - cameraDistance) /
          (THIRD_PERSON_AVATAR_FADE_FAR - THIRD_PERSON_AVATAR_FADE_NEAR)
      )
    );
    if (amount <= 0) return cameraPosition;

    const smoothAmount = amount * amount * (3 - 2 * amount);
    const lifted = cameraPosition.add(
      Vector3.Up().scale(THIRD_PERSON_CRAMPED_CAMERA_LIFT * smoothAmount)
    );
    const collisionSafe = world.resolveCameraPosition(origin, lifted);
    return this.clampCameraAboveTerrain(
      this.resolveCameraTerrainPosition(origin, collisionSafe, world),
      world
    );
  }

  private updateThirdPersonAvatarVisibility(cameraDistance: number, deltaTime: number) {
    if (cameraDistance <= THIRD_PERSON_AVATAR_FADE_NEAR) {
      this.avatarCameraVisibility = 0;
      this.setAvatarVisible(true);
      return;
    }

    const amount = Math.max(
      0,
      Math.min(
        1,
        (cameraDistance - THIRD_PERSON_AVATAR_FADE_NEAR) /
          (THIRD_PERSON_AVATAR_FADE_FAR - THIRD_PERSON_AVATAR_FADE_NEAR)
      )
    );
    const targetVisibility = amount * amount * (3 - 2 * amount);
    const speed =
      targetVisibility < this.avatarCameraVisibility
        ? THIRD_PERSON_AVATAR_FADE_OUT_SPEED
        : THIRD_PERSON_AVATAR_FADE_IN_SPEED;
    const blend = 1 - Math.exp(-speed * deltaTime);
    this.avatarCameraVisibility +=
      (targetVisibility - this.avatarCameraVisibility) * blend;
    if (this.avatarCameraVisibility < 0.01) this.avatarCameraVisibility = 0;
    if (this.avatarCameraVisibility > 0.99) this.avatarCameraVisibility = 1;
    this.setAvatarVisible(true);
  }

  private resetThirdPersonCameraCollisionState() {
    this.thirdPersonCameraArmLength = null;
    if (this.avatarCameraVisibility === 1) return;
    this.avatarCameraVisibility = 1;
    this.setAvatarVisible(this.viewMode !== "first");
  }

  private positionFirstPersonCamera() {
    this.camera.position.set(
      0,
      this.settings.eyeHeight * (FIRST_PERSON_CAMERA_HEIGHT_MULTIPLIER - 1) +
        this.stairCameraOffsetY,
      0
    );
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.y = 0;
    this.camera.rotation.z = 0;
  }

  private applySwimmingCameraDepth() {
    // An isometric camera must stay above WaterMaterial. Submerging the remote
    // map camera exposes the back side of the water and terrain at the lagoon.
    if (
      this.viewMode === "iso" ||
      !this.activeWaterSurface ||
      this.swimmingCameraBlend <= 0
    ) return;

    // The controller only rotates around Y, therefore local and world vertical
    // deltas are identical. Constrain all camera modes below the WaterMaterial
    // while preserving their authored horizontal framing.
    const currentWorldY = this.root.position.y + this.camera.position.y;
    const underwaterWorldY = Math.min(currentWorldY, this.waterLevel - SWIMMING_CAMERA_DEPTH);
    this.camera.position.y +=
      (underwaterWorldY - currentWorldY) * this.swimmingCameraBlend;
  }

  private keepFirstPersonCameraAboveTerrain(world: PlayerWorldQuery) {
    this.root.computeWorldMatrix(true);
    this.camera.computeWorldMatrix();
    const cameraWorld = this.camera.globalPosition;
    const minimumWorldY =
      world.getTerrainHeight(cameraWorld.x, cameraWorld.z) + CAMERA_TERRAIN_CLEARANCE;
    if (cameraWorld.y < minimumWorldY) {
      this.camera.position.y += minimumWorldY - cameraWorld.y;
    }
  }

  private clampCameraAboveTerrain(position: Vector3, world: PlayerWorldQuery) {
    const minimumY =
      world.getTerrainHeight(position.x, position.z) + CAMERA_TERRAIN_CLEARANCE;
    if (position.y >= minimumY) return position;
    return new Vector3(position.x, minimumY, position.z);
  }

  private resolveCameraTerrainPosition(
    origin: Vector3,
    desired: Vector3,
    world: PlayerWorldQuery
  ) {
    const dx = desired.x - origin.x;
    const dy = desired.y - origin.y;
    const dz = desired.z - origin.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= 0.001) return desired.clone();

    const sampleCount = Math.max(
      4,
      Math.min(
        CAMERA_TERRAIN_MAX_SAMPLES,
        Math.ceil(distance / CAMERA_TERRAIN_SAMPLE_SPACING)
      )
    );
    let previousSafeT = 0;

    for (let index = 1; index <= sampleCount; index++) {
      const t = index / sampleCount;
      const x = origin.x + dx * t;
      const y = origin.y + dy * t;
      const z = origin.z + dz * t;
      const minimumY = world.getTerrainHeight(x, z) + CAMERA_TERRAIN_CLEARANCE;
      if (y >= minimumY) {
        previousSafeT = t;
        continue;
      }

      // Refine the last safe interval so the camera stops close to the bank
      // instead of visibly stepping between coarse terrain samples.
      let low = previousSafeT;
      let high = t;
      for (let iteration = 0; iteration < 5; iteration++) {
        const middle = (low + high) * 0.5;
        const middleX = origin.x + dx * middle;
        const middleY = origin.y + dy * middle;
        const middleZ = origin.z + dz * middle;
        const middleMinimumY =
          world.getTerrainHeight(middleX, middleZ) + CAMERA_TERRAIN_CLEARANCE;
        if (middleY >= middleMinimumY) low = middle;
        else high = middle;
      }

      return new Vector3(
        origin.x + dx * low,
        origin.y + dy * low,
        origin.z + dz * low
      );
    }

    return desired.clone();
  }

  private configureCameraProjection() {
    if (this.viewMode !== "iso") {
      this.camera.mode = Camera.PERSPECTIVE_CAMERA;
      this.camera.fov = PLAYER_CAMERA_FOV;
      return;
    }

    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const anchorBlend = this.getSmoothedIsometricAnchorBlend();
    const anchorHeight = this.isometricCameraAnchor?.orthographicHeight ?? ISOMETRIC_ORTHO_HEIGHT;
    const orthoHeight =
      ISOMETRIC_ORTHO_HEIGHT +
      (anchorHeight - ISOMETRIC_ORTHO_HEIGHT) * anchorBlend;
    const halfHeight = orthoHeight * 0.5;
    const halfWidth = halfHeight * Math.max(0.1, aspect);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.orthoLeft = -halfWidth;
    this.camera.orthoRight = halfWidth;
    this.camera.orthoTop = halfHeight;
    this.camera.orthoBottom = -halfHeight;
  }

  private positionCameraForView() {
    if (this.viewMode === "iso") {
      this.positionIsometricCamera();
      return;
    }

    this.positionThirdPersonCamera();
  }

  private positionThirdPersonCamera() {
    const target = this.getThirdPersonTargetLocal();
    const viewSign = this.viewMode === "front" ? 1 : -1;
    const orbitPitch = Math.max(THIRD_PERSON_PITCH_MIN, Math.min(THIRD_PERSON_PITCH_MAX, this.pitch));
    // Looking upward used to lower the orbit into the terrain, where collision
    // shortened the camera arm and effectively cancelled the available pitch.
    // Keep the normal shoulder height for upward aim; downward aim may still
    // raise the camera as before.
    const positionPitch = this.viewMode === "third" ? Math.max(0, orbitPitch) : orbitPitch;
    const distance = THIRD_PERSON_CAMERA_DISTANCE;
    const y = target.y + THIRD_PERSON_CAMERA_HEIGHT + Math.sin(positionPitch) * 2.2;
    const z = viewSign * distance * Math.cos(positionPitch * 0.45);

    this.camera.position.set(0, y, z);
    this.orientCameraForView(target);
  }

  private positionIsometricCamera() {
    const target = this.getCameraTargetLocal();
    this.root.computeWorldMatrix(true);
    const rootWorld = this.root.getWorldMatrix();
    const targetWorld = Vector3.TransformCoordinates(target, rootWorld);
    let desiredWorld = targetWorld.add(
      new Vector3(ISOMETRIC_CAMERA_SIDE_OFFSET, ISOMETRIC_CAMERA_HEIGHT, -ISOMETRIC_CAMERA_DISTANCE)
    );
    if (this.isometricCameraAnchor) {
      const anchor = this.isometricCameraAnchor;
      const cameraFollowFactorX = Math.max(
        0,
        Math.min(1, anchor.cameraFollowFactorX ?? 0)
      );
      const maxCameraOffsetX = Math.max(0, anchor.maxCameraOffsetX ?? 0);
      const cameraOffsetX = Math.max(
        -maxCameraOffsetX,
        Math.min(
          maxCameraOffsetX,
          (this.root.position.x - anchor.targetPosition.x) * cameraFollowFactorX
        )
      );
      const anchoredCameraPosition = anchor.cameraPosition.add(
        new Vector3(cameraOffsetX, 0, 0)
      );
      desiredWorld = Vector3.Lerp(
        desiredWorld,
        anchoredCameraPosition,
        this.getSmoothedIsometricAnchorBlend()
      );
    }
    const inverseRootWorld = rootWorld.clone().invert();
    this.camera.position.copyFrom(Vector3.TransformCoordinates(desiredWorld, inverseRootWorld));
    this.lookAtLocal(target);
  }

  private getCameraTargetLocal() {
    if (this.viewMode === "iso") {
      const localTarget = new Vector3(
        0,
        ISOMETRIC_CAMERA_TARGET_HEIGHT + this.stairCameraOffsetY,
        0
      );
      const anchor = this.isometricCameraAnchor;
      if (!anchor || this.isometricCameraAnchorBlend <= 0) return localTarget;

      this.root.computeWorldMatrix(true);
      const rootWorld = this.root.getWorldMatrix();
      const targetWorld = Vector3.TransformCoordinates(localTarget, rootWorld);
      const anchoredTarget = this.getIsometricAnchorTargetWorld(anchor);
      const blendedTarget = Vector3.Lerp(
        targetWorld,
        anchoredTarget,
        this.getSmoothedIsometricAnchorBlend()
      );
      return Vector3.TransformCoordinates(blendedTarget, rootWorld.clone().invert());
    }
    return this.getThirdPersonTargetLocal();
  }

  private getIsometricAnchorTargetWorld(anchor: IsometricCameraAnchor) {
    const followFactor = Math.max(0, Math.min(1, anchor.targetFollowFactor ?? 0));
    const maxX = Math.max(0, anchor.maxTargetOffsetX ?? 0);
    const maxZ = Math.max(0, anchor.maxTargetOffsetZ ?? 0);
    const offsetX = Math.max(
      -maxX,
      Math.min(maxX, (this.root.position.x - anchor.targetPosition.x) * followFactor)
    );
    const offsetZ = Math.max(
      -maxZ,
      Math.min(maxZ, (this.root.position.z - anchor.targetPosition.z) * followFactor)
    );
    return anchor.targetPosition.add(new Vector3(offsetX, 0, offsetZ));
  }

  private updateIsometricCameraAnchorBlend(deltaTime: number) {
    const target = this.isometricCameraAnchorEnabled ? 1 : 0;
    const step = Math.max(0, deltaTime) * ISOMETRIC_ANCHOR_BLEND_SPEED;
    if (this.isometricCameraAnchorBlend < target) {
      this.isometricCameraAnchorBlend = Math.min(
        target,
        this.isometricCameraAnchorBlend + step
      );
    } else if (this.isometricCameraAnchorBlend > target) {
      this.isometricCameraAnchorBlend = Math.max(
        target,
        this.isometricCameraAnchorBlend - step
      );
    }

    if (!this.isometricCameraAnchorEnabled && this.isometricCameraAnchorBlend <= 0) {
      this.isometricCameraAnchor = null;
    }
  }

  private getSmoothedIsometricAnchorBlend() {
    const amount = Math.max(0, Math.min(1, this.isometricCameraAnchorBlend));
    return amount * amount * (3 - 2 * amount);
  }

  private applyCameraViewTransition(desiredWorld: Vector3, deltaTime: number) {
    const transition = this.cameraViewTransition;
    if (!transition) return desiredWorld;

    transition.elapsed = Math.min(
      transition.duration,
      transition.elapsed + Math.max(0, deltaTime)
    );
    const amount = transition.elapsed / transition.duration;
    const smooth = amount * amount * (3 - 2 * amount);
    const position = Vector3.Lerp(transition.fromWorldPosition, desiredWorld, smooth);
    if (amount >= 1) this.cameraViewTransition = null;
    return position;
  }

  private applyOpeningCameraTransition(desiredWorld: Vector3, deltaTime: number) {
    const state = this.openingCameraState;
    if (!state) return desiredWorld;
    if (state.phase === "holding") return state.fromWorldPosition.clone();

    state.elapsed = Math.min(state.duration, state.elapsed + Math.max(0, deltaTime));
    const amount = state.elapsed / state.duration;
    const smooth = amount * amount * (3 - 2 * amount);
    const position = Vector3.Lerp(state.fromWorldPosition, desiredWorld, smooth);
    if (amount >= 1) this.openingCameraState = null;
    return position;
  }

  private getAnimationDurationSeconds(group: AnimationGroup) {
    const firstAnimation = group.targetedAnimations[0]?.animation;
    const frameRate = Math.max(1, firstAnimation?.framePerSecond ?? 30);
    return Math.max(0.1, (group.to - group.from) / frameRate / Math.max(0.01, group.speedRatio));
  }

  private waitForSceneSeconds(duration: number) {
    return new Promise<void>((resolve) => {
      let elapsed = 0;
      const observer = this.scene.onBeforeRenderObservable.add(() => {
        elapsed += Math.max(0, Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.05));
        if (elapsed < duration) return;
        this.scene.onBeforeRenderObservable.remove(observer);
        resolve();
      });
    });
  }

  private resetInputState() {
    this.input.reset();
    this.jumpQueued = false;
    this.waterActionQueued = false;
    this.updateMovementSfx("idle");
  }

  private getThirdPersonTargetLocal() {
    return new Vector3(
      0,
      THIRD_PERSON_CAMERA_TARGET_HEIGHT + this.stairCameraOffsetY,
      0
    );
  }

  private getPlanarForward() {
    this.root.computeWorldMatrix(true);
    const forward = Vector3.TransformNormal(Vector3.Forward(), this.root.getWorldMatrix());
    forward.y = 0;
    if (forward.lengthSquared() > 0) {
      forward.normalize();
      return forward;
    }

    return Vector3.Forward();
  }

  private syncIsometricAimFromYaw() {
    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const screenRight = this.getIsometricScreenRight();
    const screenUp = this.getIsometricScreenUp();

    this.isometricAimX = Vector3.Dot(forward, screenRight);
    this.isometricAimY = -Vector3.Dot(forward, screenUp);

    const length = Math.hypot(this.isometricAimX, this.isometricAimY);
    if (length <= ISOMETRIC_AIM_DEADZONE) {
      this.isometricAimX = 0;
      this.isometricAimY = -1;
      return;
    }

    this.isometricAimX /= length;
    this.isometricAimY /= length;
  }

  private getIsometricWorldDirectionFromScreenAim(screenX: number, screenY: number) {
    const direction = this.getIsometricScreenRight()
      .scale(screenX)
      .add(this.getIsometricScreenUp().scale(-screenY));

    if (direction.lengthSquared() > 0) direction.normalize();
    return direction;
  }

  private getIsometricScreenRight() {
    return new Vector3(ISOMETRIC_CAMERA_DISTANCE, 0, ISOMETRIC_CAMERA_SIDE_OFFSET).normalize();
  }

  private getIsometricScreenUp() {
    return new Vector3(-ISOMETRIC_CAMERA_SIDE_OFFSET, 0, ISOMETRIC_CAMERA_DISTANCE).normalize();
  }

  private lookAtLocal(target: Vector3) {
    const direction = target.subtract(this.camera.position);
    const flatLength = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
    this.camera.rotation.x = Math.atan2(-direction.y, flatLength);
    this.camera.rotation.y = Math.atan2(direction.x, direction.z);
    this.camera.rotation.z = 0;
  }

  private orientCameraForView(target: Vector3) {
    this.lookAtLocal(target);
    if (this.viewMode !== "third") return;

    const neutralPitch = Math.atan2(
      THIRD_PERSON_CAMERA_HEIGHT,
      THIRD_PERSON_CAMERA_DISTANCE
    );
    this.camera.rotation.x = Math.max(
      -1.42,
      Math.min(1.42, neutralPitch + this.pitch)
    );
  }

  private normalizeAvatar() {
    if (!this.avatarRoot) return;
    this.avatarRoot.rotation.y = CHARACTER_YAW_OFFSET;
    this.avatarRoot.scaling.setAll(CHARACTER_VISUAL_SCALE[this.character]);

    if (this.character === "sofia") {
      // The corrected Sofia asset is already centered with its origin at foot level.
      this.avatarRoot.position.set(0, -this.settings.eyeHeight + CHARACTER_FOOT_CLEARANCE, 0);
      return;
    }

    const scaledBounds = this.getAvatarBounds();
    if (!scaledBounds) return;

    const rootWorld = this.root.getAbsolutePosition();
    const groundY = rootWorld.y - this.settings.eyeHeight;
    const centerX = (scaledBounds.min.x + scaledBounds.max.x) * 0.5;
    const centerZ = (scaledBounds.min.z + scaledBounds.max.z) * 0.5;

    this.avatarRoot.position.x -= centerX - rootWorld.x;
    this.avatarRoot.position.y -= scaledBounds.min.y - groundY - CHARACTER_FOOT_CLEARANCE;
    this.avatarRoot.position.z -= centerZ - rootWorld.z;
  }

  private resolveDeathBodyAnchor(meshes: readonly AbstractMesh[]) {
    this.deathBodyAnchorMesh = null;
    this.deathBodyAnchorBone = null;

    for (const candidate of meshes) {
      if (!(candidate instanceof Mesh) || !candidate.skeleton) continue;
      const normalizedBones = candidate.skeleton.bones.map((bone) => ({
        bone,
        name: bone.name.toLowerCase().replace(/[^a-z0-9]/g, ""),
      }));
      const anchor =
        normalizedBones.find(({ name }) => name.endsWith("spine1")) ??
        normalizedBones.find(({ name }) => name.endsWith("spine")) ??
        normalizedBones.find(({ name }) => name.endsWith("hips"));
      if (!anchor) continue;
      this.deathBodyAnchorMesh = candidate;
      this.deathBodyAnchorBone = anchor.bone;
      return;
    }
  }

  private resolveThrowHandBones(meshes: readonly AbstractMesh[]) {
    this.throwHandMesh = null;
    this.throwHandBone = null;
    this.throwHandMiddleBone = null;

    for (const candidate of meshes) {
      if (!(candidate instanceof Mesh) || !candidate.skeleton) continue;
      const normalizedBones = candidate.skeleton.bones.map((bone) => ({
        bone,
        name: bone.name.toLowerCase().replace(/[^a-z0-9]/g, ""),
      }));
      const hand = normalizedBones.find(({ name }) => name.endsWith("righthand"));
      if (!hand) continue;

      this.throwHandMesh = candidate;
      this.throwHandBone = hand.bone;
      this.throwHandMiddleBone =
        normalizedBones.find(({ name }) => name.endsWith("righthandmiddle1"))
          ?.bone ?? null;
      return;
    }
  }

  getWalkableSurfaceHeight(
    world: PlayerWorldQuery,
    x = this.root.position.x,
    z = this.root.position.z
  ) {
    return world.getWalkableSurfaceHeight(x, z);
  }

  private patchAvatarMaterial(material: BabylonMaterial | null) {
    if (!material) return;

    const materials: BabylonMaterial[] = (material as any).subMaterials?.length
      ? (material as any).subMaterials
      : [material];

    for (const mat of materials) {
      if (!mat) continue;
      mat.alpha = 1;
      mat.alphaMode = BabylonMaterial.MATERIAL_OPAQUE;
      mat.transparencyMode = BabylonMaterial.MATERIAL_OPAQUE;
      mat.backFaceCulling = false;
      (mat as any).forceDepthWrite = true;
      (mat as any).needDepthPrePass = false;

      if (mat instanceof PBRMaterial) {
        mat.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
        mat.useAlphaFromAlbedoTexture = false;
        if (this.character === "sofia") {
          // Sofia's GLB exports a metallic-only image in the combined
          // metallic/roughness slot and its roughness image as KHR specular.
          // Used as-is, the almost-black green channel makes the whole avatar
          // glossy. Prefer a stable dielectric response while retaining the
          // authored albedo and normal detail.
          mat.metallicTexture = null;
          mat.metallicReflectanceTexture = null;
          mat.reflectanceTexture = null;
          mat.microSurfaceTexture = null;
          mat.metallic = 0;
          mat.roughness = SOFIA_MATERIAL_ROUGHNESS;
          mat.specularIntensity = SOFIA_SPECULAR_INTENSITY;
          mat.environmentIntensity = SOFIA_ENVIRONMENT_INTENSITY;
          mat.metallicF0Factor = SOFIA_DIELECTRIC_F0_FACTOR;
        } else {
          mat.metallic = Math.min(mat.metallic ?? 0, 0.15);
          mat.roughness = Math.max(mat.roughness ?? 0.65, 0.55);
          mat.environmentIntensity = Math.min(mat.environmentIntensity ?? 0.35, 0.35);
        }
      } else if (mat instanceof StandardMaterial) {
        mat.useAlphaFromDiffuseTexture = false;
      }
    }
  }

  private getAvatarBounds() {
    if (!this.avatarMeshes.length) return null;

    this.avatarRoot?.computeWorldMatrix(true);
    const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (const mesh of this.avatarMeshes) {
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo({});
      const box = mesh.getBoundingInfo().boundingBox;
      min.copyFrom(Vector3.Minimize(min, box.minimumWorld));
      max.copyFrom(Vector3.Maximize(max, box.maximumWorld));
    }

    return { min, max };
  }

  private setAvatarVisible(visible: boolean) {
    for (const mesh of this.avatarMeshes) {
      mesh.visibility = visible ? this.avatarCameraVisibility : 0;
    }
  }

  private updateEnemyGrabDirection() {
    let directionX = 0;
    let directionZ = 0;
    let positionedSources = 0;
    let bestLookTargetId: string | null = null;
    let bestLookScore = Number.NEGATIVE_INFINITY;
    let currentLookScore = Number.NEGATIVE_INFINITY;
    const forwardX = Math.sin(this.root.rotation.y);
    const forwardZ = Math.cos(this.root.rotation.y);
    for (const [id, source] of this.enemyGrabSources) {
      if (!source) continue;
      const offsetX = source.x - this.root.position.x;
      const offsetZ = source.z - this.root.position.z;
      const length = Math.hypot(offsetX, offsetZ);
      if (length <= 0.001) continue;
      const normalizedX = offsetX / length;
      const normalizedZ = offsetZ / length;
      directionX += normalizedX;
      directionZ += normalizedZ;
      positionedSources++;
      const lookScore = normalizedX * forwardX + normalizedZ * forwardZ;
      if (lookScore < GRAB_LOOK_HALF_FOV_COSINE) continue;
      if (id === this.enemyGrabLookTargetId) currentLookScore = lookScore;
      if (lookScore > bestLookScore) {
        bestLookScore = lookScore;
        bestLookTargetId = id;
      }
    }
    if (positionedSources > 0) {
      this.enemyGrabDirection.set(
        directionX / positionedSources,
        0,
        directionZ / positionedSources
      );
      if (this.enemyGrabDirection.lengthSquared() > 0.000001) {
        this.enemyGrabDirection.normalize();
      }
    } else {
      this.enemyGrabDirection.setAll(0);
    }
    if (
      this.enemyGrabLookTargetId &&
      currentLookScore >= bestLookScore - GRAB_LOOK_TARGET_HYSTERESIS
    ) {
      bestLookTargetId = this.enemyGrabLookTargetId;
    }
    this.enemyGrabLookTargetId = bestLookTargetId;
    const lookSource = bestLookTargetId
      ? this.enemyGrabSources.get(bestLookTargetId)
      : null;
    if (lookSource) {
      this.enemyGrabLookDirection.copyFrom(lookSource).subtractInPlace(this.root.position);
      if (this.enemyGrabLookDirection.lengthSquared() > 0.000001) {
        this.enemyGrabLookDirection.normalize();
      }
    } else {
      this.enemyGrabLookDirection.setAll(0);
    }
    this.grabStruggleController?.setGrabDirection(this.enemyGrabDirection);
    this.grabStruggleController?.setLookDirection(this.enemyGrabLookDirection);
  }

  private updateAvatarAnimation(moveX: number, moveY: number, running: boolean) {
    if (!this.animations.size || this.actionPlaying) return;
    const blendTime = this.takeLocomotionBlendTime();

    if (this.waterLocomotionStateValue === "swimming") {
      this.playAnimation("swimming", true, blendTime);
      return;
    }

    if (this.waterLocomotionStateValue === "treadingWater") {
      this.playAnimation("treadingWater", true, blendTime);
      return;
    }

    if (!this.grounded) {
      this.playAnimation("jump", false, blendTime);
      return;
    }

    const absX = Math.abs(moveX);
    const absY = Math.abs(moveY);
    const moving = absX > 0.12 || absY > 0.12;

    if (moving) {
      if (moveY < -0.12 && absY >= absX) {
        this.playAnimation("walkBackward", true, blendTime);
        return;
      }

      if (absX > 0.12) {
        if (moveX < 0) {
          this.playAnimation(
            running ? "strafeLeftRun" : "strafeLeftWalk",
            true,
            blendTime
          );
        } else {
          this.playAnimation(
            running ? "strafeRightRun" : "strafeRightWalk",
            true,
            blendTime
          );
        }
        return;
      }

      this.playAnimation(running ? "run" : "walk", true, blendTime);
      return;
    }

    this.playAnimation("idle", true, blendTime);
  }

  private createThrowUpperBodyAnimation() {
    const source = this.animations.get(CHARACTER_ANIMATIONS.throwObject);
    if (!source) return null;

    const overlay = source.clone(
      `${source.name} Upper Body`,
      undefined,
      true,
      true
    );
    for (const targeted of [...overlay.targetedAnimations]) {
      const targetName = targeted.target?.name;
      const targetProperty = targeted.animation.targetProperty;
      const isRotation =
        targetProperty === "rotationQuaternion" || targetProperty === "rotation";
      if (
        typeof targetName !== "string" ||
        !isThrowUpperBodyTarget(targetName) ||
        !isRotation
      ) {
        overlay.removeTargetedAnimation(targeted.animation);
      }
    }
    if (!overlay.targetedAnimations.length) {
      overlay.dispose();
      return null;
    }

    return overlay;
  }

  private playAction(
    name: AnimationKey,
    speedRatio = 1,
    blendTime = ACTION_BLEND_TIME
  ) {
    if (!this.animations.has(CHARACTER_ANIMATIONS[name])) return null;

    this.actionPlaying = true;
    const group = this.playAnimation(name, false, blendTime, speedRatio);
    if (!group) {
      this.actionPlaying = false;
      return null;
    }
    if (name === "pickUpItem") this.pickupActionGroup = group;

    group.onAnimationGroupEndObservable.addOnce(() => {
      const chargedThrow = this.chargedThrowAction;
      if (chargedThrow?.group === group) {
        if (chargedThrow.released) this.launchChargedThrowProjectile(chargedThrow);
        this.chargedThrowAction = null;
      }
      if (this.currentAnimation !== group.name) return;
      if (name === "pickUpItem") {
        this.pickupActionGroup = null;
        this.actionPlaying = false;
        this.currentAnimation = null;
        this.resumeIdleOrWaterAnimation();
        return;
      }
      this.actionPlaying = false;
      this.currentAnimation = null;
      this.resumeIdleOrWaterAnimation();
    });
    return group;
  }

  private updatePickupActionTransition() {
    const group = this.pickupActionGroup;
    if (
      !group ||
      this.currentAnimation !== group.name ||
      !group.isPlaying
    ) {
      return;
    }

    const frameSpan = Math.max(0, group.to - group.from);
    const durationSeconds = this.getAnimationDurationSeconds(group);
    if (frameSpan <= 0 || durationSeconds <= 0) return;

    const blendLeadTime = Math.min(
      PICKUP_TO_LOCOMOTION_BLEND_TIME + MAX_SIMULATION_DELTA_SECONDS,
      durationSeconds * 0.45
    );
    const blendTime = Math.min(
      PICKUP_TO_LOCOMOTION_BLEND_TIME,
      blendLeadTime
    );
    const blendStartFrame =
      group.to - frameSpan * (blendLeadTime / durationSeconds);
    if (group.getCurrentFrame() < blendStartFrame) return;

    // Release locomotion while the pickup clip is still alive so Babylon can
    // actually crossfade its final pose into idle, walk, or run.
    this.pickupActionGroup = null;
    this.actionPlaying = false;
    this.locomotionBlendTimeOverride = blendTime;
  }

  private settlePickupActionBehindInspector() {
    const pickupGroup = this.animations.get(CHARACTER_ANIMATIONS.pickUpItem);
    if (
      !pickupGroup ||
      (this.currentAnimation !== pickupGroup.name &&
        this.fadeFromAnimation !== pickupGroup &&
        this.pickupActionGroup !== pickupGroup)
    ) {
      return;
    }

    this.pickupActionGroup = null;
    this.actionPlaying = false;
    this.locomotionBlendTimeOverride = null;
    // The inspector covers this hard settle. On close the avatar is already
    // fully idle, with no pickup fade left to resume.
    this.fadeFromAnimation?.stop();
    if (this.fadeToAnimation !== this.fadeFromAnimation) {
      this.fadeToAnimation?.stop();
    }
    this.fadeFromAnimation = null;
    this.fadeToAnimation = null;
    this.fadeElapsed = 0;
    pickupGroup.stop();
    this.currentAnimation = null;
    this.playAnimation("idle", true);
    this.updateMovementSfx("idle");
  }

  private updateChargedThrowAction(dt: number) {
    const state = this.chargedThrowAction;
    if (!state) return;

    const blendStep = dt / THROW_UPPER_BODY_BLEND_TIME;
    state.blendWeight = state.finishing
      ? Math.max(0, state.blendWeight - blendStep)
      : Math.min(1, state.blendWeight + blendStep);
    this.setAnimationWeight(state.group, state.blendWeight);
    this.updateThrowBaseAnimationWeights(state.blendWeight);
    if (state.finishing) {
      if (state.blendWeight > 0) return;
      state.group.stop(true);
      if (this.chargedThrowAction === state) this.chargedThrowAction = null;
      return;
    }

    const currentFrame = state.group.getCurrentFrame();

    if (!state.released && state.group.isPlaying && currentFrame >= state.holdFrame) {
      state.group.goToFrame(state.holdFrame, true);
      state.group.pause();
      return;
    }

    if (state.released && currentFrame >= state.releaseFrame) {
      this.launchChargedThrowProjectile(state);
    }

    if (state.released && currentFrame >= state.endFrame) {
      this.finishChargedThrowAction(state);
    }
  }

  private launchChargedThrowProjectile(
    state: NonNullable<PlayerController["chargedThrowAction"]>
  ) {
    if (state.launched) return;
    state.launched = true;
    const launch = state.launch;
    state.launch = null;
    launch?.();
  }

  private finishChargedThrowAction(
    state: NonNullable<PlayerController["chargedThrowAction"]>
  ) {
    if (this.chargedThrowAction !== state) return;
    this.launchChargedThrowProjectile(state);
    state.group.goToFrame(state.endFrame, true);
    state.group.pause();
    // The additive torso layer fades away while the locomotion group keeps
    // running, so the arms recover into the current idle/walk/run pose.
    state.finishing = true;
  }

  private resumeIdleOrWaterAnimation() {
    if (this.waterLocomotionStateValue === "grounded") {
      this.playAnimation("idle", true, this.takeLocomotionBlendTime());
      return;
    }
    this.updateAvatarAnimation(0, 0, false);
  }

  private takeLocomotionBlendTime() {
    const blendTime =
      this.locomotionBlendTimeOverride ?? ANIMATION_BLEND_TIME;
    this.locomotionBlendTimeOverride = null;
    return blendTime;
  }

  private playAnimation(
    name: AnimationKey,
    loop: boolean,
    blendTime = ANIMATION_BLEND_TIME,
    speedRatio = 1
  ) {
    const animationName = CHARACTER_ANIMATIONS[name];
    const idleName = CHARACTER_ANIMATIONS.idle;
    const next = this.animations.get(animationName) ?? this.animations.get(idleName);
    if (!next) return null;
    if (this.currentAnimation === next.name && next.isPlaying) return next;

    const previous = this.currentAnimation ? this.animations.get(this.currentAnimation) : null;
    if (this.fadeFromAnimation && this.fadeFromAnimation !== previous) {
      this.fadeFromAnimation.stop();
      this.fadeFromAnimation = null;
    }

    next.reset();
    next.start(loop, speedRatio);
    this.setAnimationWeight(next, previous && previous !== next ? 0 : 1);

    if (previous && previous !== next && previous.isStarted) {
      this.fadeFromAnimation = previous;
      this.fadeToAnimation = next;
      this.fadeElapsed = 0;
      this.fadeDuration = Math.max(0.01, blendTime);
      this.setAnimationWeight(previous, 1);
    } else {
      this.fadeFromAnimation = null;
      this.fadeToAnimation = null;
      this.setAnimationWeight(next, 1);
    }

    this.currentAnimation = next.name;
    return next;
  }

  private updateAnimationFade(dt: number) {
    if (!this.fadeFromAnimation || !this.fadeToAnimation) return;

    this.fadeElapsed += dt;
    const rawT = Math.min(1, this.fadeElapsed / this.fadeDuration);
    const t = rawT * rawT * (3 - 2 * rawT);

    this.setAnimationWeight(this.fadeFromAnimation, 1 - t);
    this.setAnimationWeight(this.fadeToAnimation, t);

    if (rawT >= 1) {
      this.fadeFromAnimation.stop();
      this.setAnimationWeight(this.fadeToAnimation, 1);
      this.fadeFromAnimation = null;
      this.fadeToAnimation = null;
    }
  }

  private setAnimationWeight(group: AnimationGroup, weight: number) {
    group.weight = weight;
    group.setWeightForAllAnimatables(weight);
    if (group !== this.throwUpperBodyAnimation) {
      const throwBlendWeight = this.chargedThrowAction?.blendWeight ?? 0;
      this.setThrowTargetWeights(group, weight * (1 - throwBlendWeight));
    }
  }

  private updateThrowBaseAnimationWeights(throwBlendWeight: number) {
    const baseWeightScale = 1 - throwBlendWeight;
    for (const group of this.animations.values()) {
      if (!group.isStarted) continue;
      this.setThrowTargetWeights(group, group.weight * baseWeightScale);
    }
  }

  private setThrowTargetWeights(group: AnimationGroup, weight: number) {
    for (const animatable of group.animatables) {
      const targetName = animatable.target?.name;
      if (
        typeof targetName === "string" &&
        isThrowUpperBodyTarget(targetName)
      ) {
        animatable.weight = weight;
      }
    }
  }
}

function vectorSnapshot(vector: Vector3) {
  return { x: vector.x, y: vector.y, z: vector.z };
}
