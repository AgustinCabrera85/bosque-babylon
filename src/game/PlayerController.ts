import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Bone } from "@babylonjs/core/Bones/bone";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { TerrainHandle } from "./Terrain";
import type { Segments } from "./Segments";
import {
  getWaterLevelAt,
  type WaterSurfaceInfo,
  type WaterSurfaceRegistry,
} from "./WaterSurface";

type Settings = {
  eyeHeight: number;
  walkSpeed: number;
  runSpeed: number;
  jumpSpeed: number;
  gravity: number;
};

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
const LAUTARO_VISUAL_SCALE = 2.7;
const CHARACTER_VISUAL_SCALE: Record<CharacterId, number> = {
  lautaro: LAUTARO_VISUAL_SCALE,
  sofia: LAUTARO_VISUAL_SCALE * 0.95,
};
const CHARACTER_ANIMATIONS: Record<AnimationKey, string> = {
  idle: "Idle",
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
const THIRD_PERSON_PITCH_MIN = -1.18;
const THIRD_PERSON_PITCH_MAX = 0.82;
const PATH_HALF_WIDTH = 4.5;
const PATH_START_Z = -800;
const PATH_END_Z = 70 * 8 - 8;
const PATH_SURFACE_OFFSET = 0.1;
const MAX_SIMULATION_DELTA_SECONDS = 0.05;
const ANIMATION_BLEND_TIME = 0.16;
const ACTION_BLEND_TIME = 0.08;
const STANDING_UP_BLEND_TIME = 0.18;
const THROW_ACTION_MOVEMENT_LOCK_SECONDS = 1.15;
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
const PICKUP_ACTION_SPEED_RATIO = 1.35;
const DOOR_OPEN_MOVEMENT_LOCK_SECONDS = 1.7;
const THIRD_PERSON_FLASHLIGHT_PITCH_MIN = -0.58;
const THIRD_PERSON_FLASHLIGHT_PITCH_MAX = 0.68;
const FIRST_PERSON_CAMERA_HEIGHT_MULTIPLIER = 2;
const PLAYER_CAMERA_FOV = 0.9;
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

  private keys = new Set<string>();
  private velY = 0;
  private grounded = false;
  private mobileEnabled = false;
  private mobileMoveX = 0;
  private mobileMoveY = 0;
  private mobileRun = false;
  private jumpQueued = false;
  private waterActionQueued = false;
  private pitch = 0;
  private yaw = 0;
  private isometricAimX = 0;
  private isometricAimY = -1;
  private viewMode: ViewMode = "third";
  private isometricViewAllowed = true;
  private viewModeListeners = new Set<(mode: ViewMode) => void>();
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
  private throwHandMesh: Mesh | null = null;
  private throwHandBone: Bone | null = null;
  private throwHandMiddleBone: Bone | null = null;
  private readonly throwHandMiddlePosition = Vector3.Zero();
  private animations = new Map<string, AnimationGroup>();
  private currentAnimation: string | null = null;
  private fadeFromAnimation: AnimationGroup | null = null;
  private fadeToAnimation: AnimationGroup | null = null;
  private fadeElapsed = 0;
  private fadeDuration = ANIMATION_BLEND_TIME;
  private actionPlaying = false;
  private chargedThrowAction: {
    group: AnimationGroup;
    holdFrame: number;
    releaseFrame: number;
    endFrame: number;
    released: boolean;
    launched: boolean;
    launch: (() => void) | null;
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

  constructor(
    private scene: Scene,
    private canvas: HTMLCanvasElement,
    private settings: Settings,
    private character: CharacterId = "lautaro"
  ) {
    this.root = new TransformNode("playerRoot", scene);
    this.root.position = new Vector3(0, settings.eyeHeight, 5);

    this.camera = new UniversalCamera("playerCam", new Vector3(0, 0, 0), scene);
    this.camera.parent = this.root;
    this.camera.minZ = 0.1;
    this.camera.fov = PLAYER_CAMERA_FOV;
    this.camera.angularSensibility = 8000;

    this.yaw = this.root.rotation.y;
    this.pitch = this.camera.rotation.x;
    this.applyCameraRig();

    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("#mobileControls")) return;
      if (target?.closest("#musicControls")) return;
      if (target?.closest("#viewControls")) return;
      if (target?.closest("#pauseMenu")) return;
      if (target?.closest("#itemInspector")) return;
      if (target?.closest("#inventoryOverlay")) return;
      if (target?.closest("#inventoryButton")) return;
      if (target?.closest("#shadowAuraDebug")) return;
      if (target?.closest("#openingSequence")) return;
      if (this.controlsLocked) return;
      if (this.mobileEnabled) return;
      canvas.requestPointerLock?.();
    });

    window.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement !== this.canvas) return;
      if (this.controlsLocked) return;
      this.applyLook(event.movementX * 0.0012, event.movementY * 0.001);
    });

    const updatePointerLockHelp = () => {
      const help = document.getElementById("help");
      const locked = document.pointerLockElement === canvas;
      if (help) help.style.display = locked || this.mobileEnabled ? "none" : "block";
    };
    document.addEventListener("pointerlockchange", updatePointerLockHelp);
    updatePointerLockHelp();

    scene.onKeyboardObservable.add((kb) => {
      if (kb.type === KeyboardEventTypes.KEYDOWN) {
        if (this.controlsLocked) return;
        const event = kb.event as KeyboardEvent;
        if (event.code === "KeyV" && !event.repeat) this.toggleViewMode();
        if (event.code === "Space" && !event.repeat) {
          this.jumpQueued = true;
          this.waterActionQueued = true;
        }
        this.keys.add(kb.event.code);
      }
      if (kb.type === KeyboardEventTypes.KEYUP) this.keys.delete(kb.event.code);
    });

    window.addEventListener("bosque:pause", () => {
      this.updateMovementSfx("idle");
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

  private get controlsLocked() {
    return this.openingSequenceActive || this.cinematicSequenceActive;
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
    avatarRoot.parent = this.root;
    avatarRoot.position.set(0, -this.settings.eyeHeight, 0);

    const importedNodes = [...res.meshes, ...res.transformNodes];
    for (const node of importedNodes) {
      if (!node.parent) node.parent = avatarRoot;
    }

    this.avatarRoot = avatarRoot;
    this.avatarMeshes = res.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
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
      this.actionPlaying ||
      this.waterLocomotionStateValue !== "grounded"
    ) {
      return false;
    }

    const group = this.playAction("throwObject");
    if (!group) return false;
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
    const wasCurrentAction = this.currentAnimation === state.group.name;
    state.group.stop(true);
    if (wasCurrentAction) {
      this.actionPlaying = false;
      this.currentAnimation = null;
      this.resumeIdleOrWaterAnimation();
    }
  }

  /** Keeps input responsive while a grab briefly slows and tugs the character. */
  applyEnemyGrabPressure(
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

  setMobileEnabled(enabled: boolean) {
    this.mobileEnabled = enabled;
    const help = document.getElementById("help");
    if (help) help.style.display = enabled ? "none" : "block";
  }

  setMobileMove(x: number, y: number) {
    if (this.controlsLocked) return;
    this.mobileMoveX = Math.max(-1, Math.min(1, x));
    this.mobileMoveY = Math.max(-1, Math.min(1, y));
  }

  setMobileRun(running: boolean) {
    if (this.controlsLocked) {
      this.mobileRun = false;
      return;
    }
    if (running && !this.mobileRun) this.waterActionQueued = true;
    this.mobileRun = running;
  }

  queueJump() {
    if (this.controlsLocked) return;
    this.jumpQueued = true;
  }

  addMobileLook(deltaX: number, deltaY: number) {
    if (this.controlsLocked) return;
    this.applyLook(deltaX * 0.0032, deltaY * 0.0027);
  }

  private getIsometricMobileMovementDirection(moveX: number, moveY: number) {
    return this.getIsometricWorldDirectionFromScreenAim(moveX, -moveY);
  }

  private faceMobileMovement(direction: Vector3) {
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
      this.camera.position.set(0, this.settings.eyeHeight * (FIRST_PERSON_CAMERA_HEIGHT_MULTIPLIER - 1), 0);
      this.camera.rotation.x = this.pitch;
      this.camera.rotation.y = 0;
      this.camera.rotation.z = 0;
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

  update(dt: number, terrain: TerrainHandle, segments: Segments) {
    // Streaming and shader compilation can occasionally stall a frame. Never
    // convert that wall-clock pause into several metres of player movement.
    dt = Math.max(0, Math.min(dt, MAX_SIMULATION_DELTA_SECONDS));
    this.updateChargedThrowAction();
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

    this.refreshWaterEnvironment(terrain);
    this.refreshWaterLocomotionState();
    const movementLocked =
      this.controlsLocked || this.movementLockTimer > 0 || this.actionPlaying;
    this.consumeWaterAction(movementLocked);
    this.updateSwimmingCameraBlend(dt);

    const active = this.mobileEnabled || document.pointerLockElement === this.canvas;
    if (!active) {
      if (!this.actionPlaying) this.resumeIdleOrWaterAnimation();
      this.jumpQueued = false;
      this.updateMovementSfx("idle");
      this.updateAnimationFade(dt);
      this.updateThirdPersonCameraCollision(dt, segments, terrain);
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
    let moveX = 0;
    let moveY = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) moveY += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) moveY -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) moveX += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) moveX -= 1;

    if (this.mobileEnabled && this.viewMode !== "iso") {
      moveY += this.mobileMoveY;
      moveX += this.mobileMoveX;
    }

    moveX = Math.max(-1, Math.min(1, moveX));
    moveY = Math.max(-1, Math.min(1, moveY));
    move.addInPlace(movementForward.scale(moveY));
    move.addInPlace(right.scale(moveX));

    const mobileInputStrength = Math.min(1, Math.hypot(this.mobileMoveX, this.mobileMoveY));
    if (this.mobileEnabled && this.viewMode === "iso" && mobileInputStrength > 0.12) {
      const mobileDirection = this.getIsometricMobileMovementDirection(this.mobileMoveX, this.mobileMoveY);
      this.faceMobileMovement(mobileDirection);
      move.addInPlace(mobileDirection.scale(mobileInputStrength));
      moveX = 0;
      moveY = mobileInputStrength;
    }

    const running = this.mobileRun || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
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

    if (move.lengthSquared() > 0) {
      move.normalize().scaleInPlace(speed * dt);

      const px = this.root.position.x;
      const pz = this.root.position.z;

      const tryX = px + move.x;
      if (!segments.isColliding(tryX, pz)) this.root.position.x = tryX;

      const tryZ = pz + move.z;
      if (!segments.isColliding(this.root.position.x, tryZ)) this.root.position.z = tryZ;
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
        if (!segments.isColliding(pullTargetX, this.root.position.z)) {
          this.root.position.x = pullTargetX;
        }
        const pullTargetZ = this.root.position.z + pullZ;
        if (!segments.isColliding(this.root.position.x, pullTargetZ)) {
          this.root.position.z = pullTargetZ;
        }
      }
    }

    const maxX = 60;
    const margin = 0.25;
    if (this.root.position.x > maxX - margin) this.root.position.x = maxX - margin;
    if (this.root.position.x < -maxX + margin) this.root.position.x = -maxX + margin;

    this.refreshWaterEnvironment(terrain);
    this.refreshWaterLocomotionState();
    const groundY = this.getWalkableSurfaceHeight(terrain);
    const targetY = groundY + this.settings.eyeHeight;

    if (this.waterLocomotionStateValue === "swimming" && this.activeWaterSurface) {
      this.updateSwimmingVerticalMotion(
        dt,
        move.y,
        this.getSwimmingFloorHeight(terrain)
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
      } else {
        this.grounded = false;
      }

      if (!movementLocked && this.jumpQueued && this.grounded) {
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

    this.updateThirdPersonCameraCollision(dt, segments, terrain);
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

  private refreshWaterEnvironment(terrain: TerrainHandle) {
    this.activeWaterSurface = this.waterSurfaces?.getWaterSurfaceAt(this.root.position) ?? null;
    if (!this.activeWaterSurface) {
      this.waterLevel = Number.NEGATIVE_INFINITY;
      this.waterDepthAtGround = 0;
      return;
    }

    this.waterLevel = getWaterLevelAt(this.activeWaterSurface, this.root.position);
    const groundY = this.getWalkableSurfaceHeight(terrain);
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

  private getSwimmingFloorHeight(terrain: TerrainHandle) {
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const x = this.root.position.x;
    const z = this.root.position.z;

    return Math.max(
      terrain.getHeightAt(x, z),
      terrain.getHeightAt(
        x + forwardX * SWIMMING_BODY_HALF_LENGTH,
        z + forwardZ * SWIMMING_BODY_HALF_LENGTH
      ),
      terrain.getHeightAt(
        x - forwardX * SWIMMING_BODY_HALF_LENGTH,
        z - forwardZ * SWIMMING_BODY_HALF_LENGTH
      ),
      terrain.getHeightAt(
        x + rightX * SWIMMING_BODY_HALF_WIDTH,
        z + rightZ * SWIMMING_BODY_HALF_WIDTH
      ),
      terrain.getHeightAt(
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
    segments: Segments,
    terrain: TerrainHandle
  ) {
    this.configureCameraProjection();
    if (this.cinematicCameraState) {
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
    if (this.viewMode === "first") {
      this.positionFirstPersonCamera();
      this.applySwimmingCameraDepth();
      this.keepFirstPersonCameraAboveTerrain(terrain);
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
        ? this.resolveCameraTerrainPosition(origin, desired, terrain)
      : this.resolveCameraTerrainPosition(
          origin,
          segments.resolveCameraPosition(origin, desired),
          terrain
        );
    const terrainSafePosition = this.clampCameraAboveTerrain(adjusted, terrain);
    const inverse = this.root.getWorldMatrix().clone().invert();
    this.camera.position.copyFrom(
      Vector3.TransformCoordinates(terrainSafePosition, inverse)
    );
    this.orientCameraForView(target);
  }

  private positionFirstPersonCamera() {
    this.camera.position.set(0, this.settings.eyeHeight * (FIRST_PERSON_CAMERA_HEIGHT_MULTIPLIER - 1), 0);
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

  private keepFirstPersonCameraAboveTerrain(terrain: TerrainHandle) {
    this.root.computeWorldMatrix(true);
    this.camera.computeWorldMatrix();
    const cameraWorld = this.camera.globalPosition;
    const minimumWorldY =
      terrain.getHeightAt(cameraWorld.x, cameraWorld.z) + CAMERA_TERRAIN_CLEARANCE;
    if (cameraWorld.y < minimumWorldY) {
      this.camera.position.y += minimumWorldY - cameraWorld.y;
    }
  }

  private clampCameraAboveTerrain(position: Vector3, terrain: TerrainHandle) {
    const minimumY =
      terrain.getHeightAt(position.x, position.z) + CAMERA_TERRAIN_CLEARANCE;
    if (position.y >= minimumY) return position;
    return new Vector3(position.x, minimumY, position.z);
  }

  private resolveCameraTerrainPosition(
    origin: Vector3,
    desired: Vector3,
    terrain: TerrainHandle
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
      const minimumY = terrain.getHeightAt(x, z) + CAMERA_TERRAIN_CLEARANCE;
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
          terrain.getHeightAt(middleX, middleZ) + CAMERA_TERRAIN_CLEARANCE;
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
      const localTarget = new Vector3(0, ISOMETRIC_CAMERA_TARGET_HEIGHT, 0);
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
    this.keys.clear();
    this.mobileMoveX = 0;
    this.mobileMoveY = 0;
    this.mobileRun = false;
    this.jumpQueued = false;
    this.waterActionQueued = false;
    this.updateMovementSfx("idle");
  }

  private getThirdPersonTargetLocal() {
    return new Vector3(0, THIRD_PERSON_CAMERA_TARGET_HEIGHT, 0);
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
    terrain: TerrainHandle,
    x = this.root.position.x,
    z = this.root.position.z
  ) {
    const baseHeight = terrain.getHeightAt(x, z);
    const onPath =
      Math.abs(x) <= PATH_HALF_WIDTH && z >= PATH_START_Z && z <= PATH_END_Z;

    return baseHeight + (onPath ? PATH_SURFACE_OFFSET : 0);
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
      mesh.visibility = visible ? 1 : 0;
    }
  }

  private updateAvatarAnimation(moveX: number, moveY: number, running: boolean) {
    if (!this.animations.size || this.actionPlaying) return;

    if (this.waterLocomotionStateValue === "swimming") {
      this.playAnimation("swimming", true);
      return;
    }

    if (this.waterLocomotionStateValue === "treadingWater") {
      this.playAnimation("treadingWater", true);
      return;
    }

    if (!this.grounded) {
      this.playAnimation("jump", false);
      return;
    }

    const absX = Math.abs(moveX);
    const absY = Math.abs(moveY);
    const moving = absX > 0.12 || absY > 0.12;

    if (moving) {
      if (moveY < -0.12 && absY >= absX) {
        this.playAnimation("walkBackward", true);
        return;
      }

      if (absX > 0.12) {
        if (moveX < 0) {
          this.playAnimation(running ? "strafeLeftRun" : "strafeLeftWalk", true);
        } else {
          this.playAnimation(running ? "strafeRightRun" : "strafeRightWalk", true);
        }
        return;
      }

      this.playAnimation(running ? "run" : "walk", true);
      return;
    }

    this.playAnimation("idle", true);
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

    group.onAnimationGroupEndObservable.addOnce(() => {
      const chargedThrow = this.chargedThrowAction;
      if (chargedThrow?.group === group) {
        if (chargedThrow.released) this.launchChargedThrowProjectile(chargedThrow);
        this.chargedThrowAction = null;
      }
      if (this.currentAnimation !== group.name) return;
      this.actionPlaying = false;
      this.currentAnimation = null;
      this.resumeIdleOrWaterAnimation();
    });
    return group;
  }

  private updateChargedThrowAction() {
    const state = this.chargedThrowAction;
    if (!state) return;
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
    this.chargedThrowAction = null;
    if (this.currentAnimation !== state.group.name) return;

    // Blend out at the authored recovery pose instead of waiting for the long
    // remainder of the source clip. This also releases movement immediately.
    this.actionPlaying = false;
    this.resumeIdleOrWaterAnimation();
  }

  private resumeIdleOrWaterAnimation() {
    if (this.waterLocomotionStateValue === "grounded") {
      this.playAnimation("idle", true);
      return;
    }
    this.updateAvatarAnimation(0, 0, false);
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
    next.speedRatio = speedRatio;
    next.start(loop);
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
  }
}
