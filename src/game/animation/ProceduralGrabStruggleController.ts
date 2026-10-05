import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import {
  MixamoProceduralRig,
  type MixamoJointName,
} from "./MixamoProceduralRig";
import {
  computeStairLegPose,
  INACTIVE_STAIR_LOCOMOTION,
  shouldUseProceduralStairPose,
  type StairLocomotionState,
} from "./StairLocomotion";
import {
  getPlayerDodgeReactionDuration,
  getPlayerHitReactionDuration,
  samplePlayerDodgeReaction,
  samplePlayerHitReaction,
  type PlayerDodgeReactionEvent,
  type PlayerDodgeStyle,
  type PlayerHitReactionEvent,
  type PlayerHitReactionZone,
  type PlayerImpactType,
} from "./PlayerReaction";

type JointName = MixamoJointName;

export type ProceduralGrabStruggleConfig = {
  enterBlendSeconds: number;
  exitBlendSeconds: number;
  directionResponse: number;
  lookResponse: number;
  intensityResponse: number;
  hipsSwayDegrees: number;
  hipsTwistDegrees: number;
  torsoForwardLeanDegrees: number;
  torsoCurlDegrees: number;
  torsoTwistDegrees: number;
  shoulderEffortDegrees: number;
  armEffortDegrees: number;
  armSpreadDegrees: number;
  armForwardReachDegrees: number;
  forearmLiftDegrees: number;
  shoulderMaxDegrees: number;
  upperArmMaxDegrees: number;
  forearmMaxDegrees: number;
  stanceWidthDegrees: number;
  stanceDropMeters: number;
  kneeBendDegrees: number;
  legKickDegrees: number;
  headCounterDegrees: number;
  lookMaxYawDegrees: number;
  lookMaxPitchDegrees: number;
  hitHipsPitchDegrees: number;
  hitSpinePitchDegrees: number;
  hitSpine1PitchDegrees: number;
  hitSpine2PitchDegrees: number;
  hitTorsoTwistDegrees: number;
  hitTorsoSideBendDegrees: number;
  hitKneeFlexDegrees: number;
  hitNeckPitchDegrees: number;
  hitHeadPitchDegrees: number;
  hitShoulderDegrees: number;
  hitUpperArmDegrees: number;
  hitForearmDegrees: number;
  hitVisualRootMeters: number;
};

/** @deprecated Use the scene-independent types from PlayerReaction instead. */
export type ProceduralHitReactionZone = PlayerHitReactionZone;
/** @deprecated Use PlayerImpactType. */
export type ProceduralHitReactionType = PlayerImpactType;
/** @deprecated Use PlayerHitReactionEvent through PlayerController.playReaction. */
export type ProceduralHitReactionEvent = Omit<PlayerHitReactionEvent, "kind">;

export type ProceduralNeckGrabState = {
  active: boolean;
  attackerPosition?: Vector3;
  lift?: number;
  escapeProgress?: number;
};

export type ProceduralGrabStruggleDebugPoseMask = {
  hips: boolean;
  torso: boolean;
  shoulders: boolean;
  upperArms: boolean;
  forearms: boolean;
  head: boolean;
  legs: boolean;
};

export type ProceduralGrabStruggleDebugSnapshot = {
  available: boolean;
  active: boolean;
  activeGrabberCount: number;
  blend: number;
  intensity: number;
  direction: { x: number; y: number; z: number };
  lookDirection: { x: number; y: number; z: number };
  jerkActive: boolean;
  hitActive: boolean;
  hitStrength: number;
  hitZone: ProceduralHitReactionZone;
  hitType: ProceduralHitReactionType;
  hitDirection: { x: number; y: number; z: number };
  hitDirectionWorld: { x: number; y: number; z: number };
  hitDirectionLocal: { right: number; forward: number };
  hitProgress: number;
  hitDuration: number;
  impactWeight: number;
  recoilWeight: number;
  staggerWeight: number;
  headLagWeight: number;
  recoveryWeight: number;
  dodgeActive: boolean;
  dodgeStyle: PlayerDodgeStyle;
  dodgeProgress: number;
  dodgeDuration: number;
  dodgeDirection: { x: number; y: number; z: number };
  visualRootOffset: { x: number; y: number; z: number };
  neckGrabActive: boolean;
  neckGrabWeight: number;
  neckGrabLift: number;
  neckGrabEscapeProgress: number;
  neckGrabAnchorCaptured: boolean;
  neckGrabLegPoseDegrees: {
    leftThigh: number;
    rightThigh: number;
    leftKnee: number;
    rightKnee: number;
  };
  localAxisMapping: typeof LIMB_LOCAL_AXIS_MAPPING;
  resolvedBones: Record<JointName, string | null>;
  animatedBones: JointName[];
  missingRequiredBones: JointName[];
  poseMask: ProceduralGrabStruggleDebugPoseMask;
};

const DEFAULT_CONFIG: ProceduralGrabStruggleConfig = {
  enterBlendSeconds: 0.16,
  exitBlendSeconds: 0.28,
  directionResponse: 8.5,
  lookResponse: 5.5,
  intensityResponse: 10,
  hipsSwayDegrees: 7,
  hipsTwistDegrees: 9,
  torsoForwardLeanDegrees: 28,
  torsoCurlDegrees: 8,
  torsoTwistDegrees: 18,
  shoulderEffortDegrees: 8,
  armEffortDegrees: 12,
  armSpreadDegrees: 12,
  armForwardReachDegrees: 9,
  forearmLiftDegrees: 18,
  shoulderMaxDegrees: 10,
  upperArmMaxDegrees: 20,
  forearmMaxDegrees: 20,
  stanceWidthDegrees: 17,
  stanceDropMeters: 0.12,
  kneeBendDegrees: 31,
  legKickDegrees: 11,
  headCounterDegrees: 7,
  lookMaxYawDegrees: 52,
  lookMaxPitchDegrees: 20,
  hitHipsPitchDegrees: 12,
  hitSpinePitchDegrees: 11,
  hitSpine1PitchDegrees: 17,
  hitSpine2PitchDegrees: 26,
  hitTorsoTwistDegrees: 10,
  hitTorsoSideBendDegrees: 9,
  hitKneeFlexDegrees: 23,
  hitNeckPitchDegrees: 10,
  hitHeadPitchDegrees: 15,
  hitShoulderDegrees: 12,
  hitUpperArmDegrees: 9,
  hitForearmDegrees: 10,
  hitVisualRootMeters: 0.17,
};

const DEFAULT_DEBUG_POSE_MASK: ProceduralGrabStruggleDebugPoseMask = {
  hips: true,
  torso: true,
  shoulders: true,
  upperArms: true,
  forearms: true,
  head: true,
  legs: true,
};

// Runtime inspection of both playable Mixamo rigs found the same anatomical
// layout: local Y follows the bone (twist), local X raises the upper arm, and
// local Z moves the chain in the sagittal plane. Forward/flexion uses mirrored
// Z signs; elbow motion deliberately stays on that single hinge axis.
const LEFT_FORWARD_FLEX_SIGN = 1;
const RIGHT_FORWARD_FLEX_SIGN = -1;

const LIMB_LOCAL_AXIS_MAPPING = {
  leftShoulder: "local Z: +forward / -retraction; local Y: clavicle twist",
  rightShoulder: "local Z: -forward / +retraction; local Y: clavicle twist",
  leftArm: "local -X: elevation; local +Z: forward; local Y: twist",
  rightArm: "local -X: elevation; local -Z: forward; local Y: twist",
  leftForeArm: "local +Z: elbow flexion; local Y: forearm twist",
  rightForeArm: "local -Z: elbow flexion; local Y: forearm twist",
} as const;

const COMBINED_POSE_LIMITS = {
  hipsPitch: radians(18),
  hipsYaw: radians(18),
  hipsSideBend: radians(18),
  spinePitch: radians(22),
  spine1Pitch: radians(28),
  spine2Pitch: radians(38),
  spineYaw: radians(14),
  spine1Yaw: radians(20),
  spine2Yaw: radians(28),
  spineSideBend: radians(22),
  upperLegPitch: radians(42),
  kneeFlex: radians(58),
  footPitch: radians(28),
  neckPitch: radians(24),
  headPitch: radians(34),
  neckYaw: radians(22),
  headYaw: radians(28),
} as const;

const NECK_GRAB_UPPER_ARM_LIMIT = radians(68);
const NECK_GRAB_FOREARM_LIMIT = radians(78);
const NECK_GRAB_VISUAL_LIFT_METERS = 0.7;
const NECK_GRAB_SHAKE_LATERAL_METERS = 0.075;
const NECK_GRAB_SHAKE_FORWARD_METERS = 0.105;
const NECK_GRAB_SHAKE_VERTICAL_METERS = 0.018;

type HitReactionWeights = {
  impact: number;
  recoil: number;
  stagger: number;
  headLag: number;
  recovery: number;
  overshoot: number;
};

type HitReactionPose = {
  hipsPitch: number;
  hipsYaw: number;
  hipsSideBend: number;
  spinePitch: number;
  spine1Pitch: number;
  spine2Pitch: number;
  torsoYaw: number;
  torsoSideBend: number;
  leftThighPitch: number;
  rightThighPitch: number;
  leftThighOutward: number;
  rightThighOutward: number;
  leftThighYaw: number;
  rightThighYaw: number;
  leftKneeFlex: number;
  rightKneeFlex: number;
  leftFootPitch: number;
  rightFootPitch: number;
  leftFootRoll: number;
  rightFootRoll: number;
  neckPitch: number;
  headPitch: number;
  neckYaw: number;
  headYaw: number;
  leftShoulderRetraction: number;
  rightShoulderRetraction: number;
  leftArmLift: number;
  rightArmLift: number;
  leftArmReach: number;
  rightArmReach: number;
  leftForearmFlex: number;
  rightForearmFlex: number;
  visualRootDrop: number;
  visualRootDisplacement: number;
};

type NeckGrabPose = {
  hipsPitch: number;
  torsoPitch: number;
  torsoYaw: number;
  torsoSideBend: number;
  leftThighPitch: number;
  rightThighPitch: number;
  leftKneeFlex: number;
  rightKneeFlex: number;
  neckPitch: number;
  headPitch: number;
  neckYaw: number;
  headYaw: number;
  shoulderProtraction: number;
  leftArmLift: number;
  rightArmLift: number;
  leftArmReach: number;
  rightArmReach: number;
  leftForearmFlex: number;
  rightForearmFlex: number;
  visualLift: number;
};

type HitZoneProfile = {
  chest: number;
  lowerBody: number;
  head: number;
  shoulders: number;
  arms: number;
  twist: number;
  abdomenCurl: number;
};

const HIT_ZONE_PROFILES: Record<PlayerHitReactionZone, HitZoneProfile> = {
  chest: {
    chest: 1,
    lowerBody: 0.82,
    head: 0.72,
    shoulders: 0.8,
    arms: 0.58,
    twist: 0.72,
    abdomenCurl: 0,
  },
  abdomen: {
    chest: 0.62,
    lowerBody: 1.08,
    head: 0.48,
    shoulders: 0.42,
    arms: 0.4,
    twist: 0.62,
    abdomenCurl: 1,
  },
  head: {
    chest: 0.48,
    lowerBody: 0.3,
    head: 1.18,
    shoulders: 0.4,
    arms: 0.3,
    twist: 0.86,
    abdomenCurl: 0,
  },
  leftShoulder: {
    chest: 0.7,
    lowerBody: 0.58,
    head: 0.62,
    shoulders: 1.15,
    arms: 0.68,
    twist: 1.15,
    abdomenCurl: 0,
  },
  rightShoulder: {
    chest: 0.7,
    lowerBody: 0.58,
    head: 0.62,
    shoulders: 1.15,
    arms: 0.68,
    twist: 1.15,
    abdomenCurl: 0,
  },
};

const REQUIRED_JOINTS: readonly JointName[] = [
  "hips",
  "spine",
  "neck",
  "leftUpLeg",
  "leftLeg",
  "rightUpLeg",
  "rightLeg",
];

/**
 * Post-animation procedural layer shared by every playable Mixamo rig.
 *
 * The previous frame is restored before Babylon evaluates the base clips. The
 * new pose is then composed after animation evaluation, so locomotion and
 * actions remain authoritative and the procedural rotations never accumulate.
 */
export class ProceduralGrabStruggleController {
  private readonly rig: MixamoProceduralRig;
  private readonly rightAxis = Vector3.Right();
  private readonly forwardAxis = Vector3.Forward();
  private readonly desiredGrabDirection = Vector3.Zero();
  private readonly smoothedGrabDirection = Vector3.Zero();
  private readonly desiredLookDirection = Vector3.Zero();
  private readonly smoothedLookDirection = Vector3.Zero();
  private readonly visualRootBasePosition = Vector3.Zero();
  private readonly neckGrabAnchorWorld = Vector3.Zero();
  private readonly neckGrabCurrentWorld = Vector3.Zero();
  private readonly neckGrabDesiredWorld = Vector3.Zero();
  private readonly neckGrabCorrectionWorld = Vector3.Zero();
  private readonly neckGrabCorrectionLocal = Vector3.Zero();
  private readonly neckGrabRootInverse = Matrix.Identity();
  private readonly config: ProceduralGrabStruggleConfig;
  private readonly poseMask: ProceduralGrabStruggleDebugPoseMask = {
    ...DEFAULT_DEBUG_POSE_MASK,
  };
  private beforeAnimationsObserver: Observer<Scene> | null = null;
  private afterAnimationsObserver: Observer<Scene> | null = null;
  private sceneDisposeObserver: Observer<Scene> | null = null;
  private requestedActive = false;
  private activeGrabberCount = 0;
  private requestedIntensity = 0;
  private intensity = 0;
  private blend = 0;
  private elapsed = 0;
  private poseApplied = false;
  private disposed = false;
  private randomState: number;
  private readonly motionPhase: number;
  private nextJerkAt = Number.POSITIVE_INFINITY;
  private jerkStartedAt = 0;
  private jerkDuration = 0;
  private jerkStrength = 0;
  private jerkSide = 1;
  private hitElapsed = Number.POSITIVE_INFINITY;
  private hitDuration = 0;
  private hitStrength = 0;
  private hitZone: PlayerHitReactionZone = "chest";
  private hitType: PlayerImpactType = "blunt";
  private readonly hitDirectionWorld = Vector3.Zero();
  private readonly hitPlanarDirectionWorld = Vector3.Zero();
  private hitDirectionLocalRight = 0;
  private hitDirectionLocalForward = -1;
  private hitTwistVariation = 0;
  private hitShoulderBias = 0;
  private hitStaggerVariation = 1;
  private hitHeadLagVariation = 1;
  private hitStepLead = 1;
  private readonly hitWeights: HitReactionWeights = createEmptyHitReactionWeights();
  private readonly hitPose: HitReactionPose = createEmptyHitReactionPose();
  private readonly visualRootHitOffset = Vector3.Zero();
  private dodgeElapsed = Number.POSITIVE_INFINITY;
  private dodgeDuration = 0;
  private dodgeStrength = 0;
  private dodgeStyle: PlayerDodgeStyle = "sidestep";
  private readonly dodgeDirectionWorld = Vector3.Zero();
  private readonly dodgePlanarDirectionWorld = Vector3.Zero();
  private stairLocomotion: StairLocomotionState = {
    ...INACTIVE_STAIR_LOCOMOTION,
  };
  private stairLocomotionBlend = 0;
  private neckGrabRequested = false;
  private neckGrabWeight = 0;
  private neckGrabTargetLift = 0;
  private neckGrabLift = 0;
  private neckGrabEscapeProgress = 0;
  private neckGrabElapsed = 0;
  private neckGrabAnchorCaptured = false;
  private readonly neckGrabAttackerPosition = Vector3.Zero();
  private readonly neckGrabPose: NeckGrabPose = createEmptyNeckGrabPose();

  public constructor(
    private readonly scene: Scene,
    private readonly root: TransformNode,
    private readonly visualRoot: TransformNode,
    meshes: readonly AbstractMesh[],
    animationGroups: readonly AnimationGroup[],
    seedName: string,
    config: Partial<ProceduralGrabStruggleConfig> = {},
    debug = false
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.randomState = hashString(seedName) || 0x9e3779b9;
    this.motionPhase =
      (((this.randomState >>> 8) & 0xffff) / 0xffff) * Math.PI * 2;
    this.rig = new MixamoProceduralRig(meshes, animationGroups, REQUIRED_JOINTS);

    if (!this.available) {
      console.warn(
        `[PlayerAnimation] Procedural grab struggle disabled; missing Mixamo joints: ${
          this.rig.getMissingRequiredBones().join(", ") || "skeleton"
        }.`
      );
      return;
    }

    this.beforeAnimationsObserver = this.scene.onBeforeAnimationsObservable.add(() => {
      this.restoreBasePose();
    });
    this.afterAnimationsObserver = this.scene.onAfterAnimationsObservable.add(() => {
      this.update(
        Math.max(0, Math.min(this.scene.getEngine().getDeltaTime() * 0.001, 0.05))
      );
    });
    this.sceneDisposeObserver = this.scene.onDisposeObservable.addOnce(() => {
      this.dispose();
    });

    if (debug) {
      console.info("[PlayerAnimation] Procedural Mixamo mapping", {
        seedName,
        resolvedBones: this.rig.getResolvedBones(),
        animatedBones: this.rig.getAnimatedBones(),
      });
    }
  }

  public get available() {
    return this.rig.available;
  }

  public start() {
    if (!this.available || this.disposed) return;
    if (!this.requestedActive) {
      this.nextJerkAt = this.elapsed + 0.3 + this.nextRandom() * 0.45;
    }
    this.requestedActive = true;
  }

  public stop() {
    this.requestedActive = false;
    this.nextJerkAt = Number.POSITIVE_INFINITY;
    this.jerkDuration = 0;
  }

  public setIntensity(value: number) {
    this.requestedIntensity = clamp(value, 0, 1);
  }

  public setGrabDirection(direction: Vector3) {
    this.desiredGrabDirection.copyFrom(direction);
    this.desiredGrabDirection.y = 0;
    if (this.desiredGrabDirection.lengthSquared() > 0.000001) {
      this.desiredGrabDirection.normalize();
    } else {
      this.desiredGrabDirection.setAll(0);
    }
  }

  public setLookDirection(direction: Vector3) {
    this.desiredLookDirection.copyFrom(direction);
    if (this.desiredLookDirection.lengthSquared() > 0.000001) {
      this.desiredLookDirection.normalize();
    } else {
      this.desiredLookDirection.setAll(0);
    }
  }

  public setActiveGrabberCount(count: number) {
    this.activeGrabberCount = Math.max(0, Math.floor(count));
    this.setIntensity(intensityForGrabberCount(this.activeGrabberCount));
    if (this.activeGrabberCount > 0) this.start();
    else this.stop();
  }

  public setDebugPoseMask(mask: Partial<ProceduralGrabStruggleDebugPoseMask>) {
    if (typeof mask.hips === "boolean") this.poseMask.hips = mask.hips;
    if (typeof mask.torso === "boolean") this.poseMask.torso = mask.torso;
    if (typeof mask.shoulders === "boolean") this.poseMask.shoulders = mask.shoulders;
    if (typeof mask.upperArms === "boolean") this.poseMask.upperArms = mask.upperArms;
    if (typeof mask.forearms === "boolean") this.poseMask.forearms = mask.forearms;
    if (typeof mask.head === "boolean") this.poseMask.head = mask.head;
    if (typeof mask.legs === "boolean") this.poseMask.legs = mask.legs;
  }

  public triggerHitReaction(event: PlayerHitReactionEvent) {
    if (!this.available || this.disposed) return false;
    const strength = clamp(event.strength ?? 1, 0, 1);
    if (strength <= 0.0001) return false;

    this.cancelDodgeReaction();
    this.hitStrength = strength;
    this.hitZone = event.hitZone ?? "chest";
    this.hitType = event.impactType ?? "blunt";
    this.hitDuration = getPlayerHitReactionDuration(strength, this.hitType);
    this.hitElapsed = 0;
    this.hitDirectionWorld.copyFrom(event.direction ?? Vector3.Zero());
    if (this.hitDirectionWorld.lengthSquared() <= 0.000001 && event.sourcePosition) {
      this.root.position.subtractToRef(event.sourcePosition, this.hitDirectionWorld);
    }
    if (this.hitDirectionWorld.lengthSquared() <= 0.000001) {
      const yaw = this.root.rotation.y;
      this.hitDirectionWorld.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    } else {
      this.hitDirectionWorld.normalize();
    }
    this.hitPlanarDirectionWorld.set(
      this.hitDirectionWorld.x,
      0,
      this.hitDirectionWorld.z
    );
    if (this.hitPlanarDirectionWorld.lengthSquared() <= 0.000001) {
      const yaw = this.root.rotation.y;
      this.hitPlanarDirectionWorld.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    } else {
      this.hitPlanarDirectionWorld.normalize();
    }
    const yaw = this.root.rotation.y;
    const directionRight =
      this.hitPlanarDirectionWorld.x * Math.cos(yaw) -
      this.hitPlanarDirectionWorld.z * Math.sin(yaw);
    this.hitStepLead =
      Math.abs(directionRight) > 0.18
        ? directionRight > 0
          ? -1
          : 1
        : this.nextRandom() < 0.5
          ? -1
          : 1;

    // Cached once per hit: no per-frame randomness or jitter.
    this.hitTwistVariation = this.nextRandom() * 2 - 1;
    this.hitShoulderBias = (this.nextRandom() * 2 - 1) * 0.18;
    this.hitStaggerVariation = 0.9 + this.nextRandom() * 0.2;
    this.hitHeadLagVariation = 0.9 + this.nextRandom() * 0.2;
    resetHitReactionWeights(this.hitWeights);
    resetHitReactionPose(this.hitPose);
    this.visualRootHitOffset.setAll(0);
    return true;
  }

  public triggerDodgeReaction(event: PlayerDodgeReactionEvent) {
    if (!this.available || this.disposed) return false;
    const strength = clamp(event.strength ?? 1, 0, 1);
    if (strength <= 0.0001) return false;

    this.cancelHitReaction();
    this.dodgeStrength = strength;
    this.dodgeStyle = event.style ?? "sidestep";
    this.dodgeDuration = getPlayerDodgeReactionDuration(strength);
    this.dodgeElapsed = 0;
    this.resolveDodgeDirection(event);
    this.visualRootHitOffset.setAll(0);
    resetHitReactionPose(this.hitPose);
    return true;
  }

  public setNeckGrabState(state: ProceduralNeckGrabState) {
    if (!this.available || this.disposed) return;
    if (state.active && !this.neckGrabRequested) {
      this.neckGrabElapsed = 0;
      this.neckGrabAnchorCaptured = false;
    }
    this.neckGrabRequested = state.active;
    this.neckGrabTargetLift = state.active ? clamp(state.lift ?? 0, 0, 1) : 0;
    this.neckGrabEscapeProgress = clamp(state.escapeProgress ?? 0, 0, 1);
    if (state.attackerPosition) {
      this.neckGrabAttackerPosition.copyFrom(state.attackerPosition);
    }
  }

  public setStairLocomotionState(state: StairLocomotionState) {
    if (this.disposed) return;
    this.stairLocomotion = state.active
      ? {
          ...state,
          // Descending keeps the authored walking clip untouched. Grounding and
          // vertical presentation remain active through PlayerController.
          active: shouldUseProceduralStairPose(state),
        }
      : {
          ...this.stairLocomotion,
          active: false,
          visualOffsetY: state.visualOffsetY,
        };
  }

  public getJointWorldPositionToRef(name: JointName, result: Vector3) {
    return this.rig.getJointWorldPositionToRef(name, result);
  }

  public update(dt: number) {
    if (!this.available || this.disposed || dt <= 0) return;
    this.elapsed += dt;

    const blendTarget = this.requestedActive ? 1 : 0;
    const blendDuration = this.requestedActive
      ? this.config.enterBlendSeconds
      : this.config.exitBlendSeconds;
    this.blend = moveToward(
      this.blend,
      blendTarget,
      dt / Math.max(0.001, blendDuration)
    );
    this.intensity = damp(
      this.intensity,
      this.requestedIntensity,
      this.config.intensityResponse,
      dt
    );
    const directionAmount = 1 - Math.exp(-this.config.directionResponse * dt);
    this.smoothedGrabDirection.x +=
      (this.desiredGrabDirection.x - this.smoothedGrabDirection.x) * directionAmount;
    this.smoothedGrabDirection.z +=
      (this.desiredGrabDirection.z - this.smoothedGrabDirection.z) * directionAmount;
    const lookAmount = 1 - Math.exp(-this.config.lookResponse * dt);
    this.smoothedLookDirection.x +=
      (this.desiredLookDirection.x - this.smoothedLookDirection.x) * lookAmount;
    this.smoothedLookDirection.y +=
      (this.desiredLookDirection.y - this.smoothedLookDirection.y) * lookAmount;
    this.smoothedLookDirection.z +=
      (this.desiredLookDirection.z - this.smoothedLookDirection.z) * lookAmount;

    this.updateJerk();
    this.updateHitReaction(dt);
    this.updateDodgeReaction(dt);
    this.updateNeckGrab(dt);
    this.stairLocomotionBlend = damp(
      this.stairLocomotionBlend,
      this.stairLocomotion.active ? 1 : 0,
      this.stairLocomotion.active ? 13 : 9,
      dt
    );

    const hasGrabOrReactionPose =
      this.blend > 0.0001 ||
      this.isHitActive() ||
      this.isDodgeActive() ||
      this.neckGrabWeight > 0.0001;
    const hasStairPose =
      this.stairLocomotionBlend > 0.0001 ||
      Math.abs(this.stairLocomotion.visualOffsetY) > 0.0001;
    if (
      this.blend <= 0.0001 &&
      !this.isHitActive() &&
      !this.isDodgeActive() &&
      this.neckGrabWeight <= 0.0001 &&
      !hasStairPose
    ) {
      this.visualRootHitOffset.setAll(0);
      return;
    }
    this.captureBasePose();
    this.captureNeckGrabAnchorIfNeeded();
    if (hasGrabOrReactionPose) {
      this.applyPose(smoothStep(this.blend) * this.intensity);
    } else {
      this.visualRootHitOffset.setAll(0);
    }
    this.applyStairLocomotionPose();
    this.visualRoot.position.y += this.stairLocomotion.visualOffsetY;
    this.rig.prepare();
    this.stabilizeNeckGrabAnchor();
    this.poseApplied = true;
  }

  public getDebugSnapshot(): ProceduralGrabStruggleDebugSnapshot {
    return {
      available: this.available,
      active:
        this.requestedActive ||
        this.blend > 0.0001 ||
        this.isHitActive() ||
        this.isDodgeActive() ||
        this.neckGrabRequested ||
        this.neckGrabWeight > 0.0001,
      activeGrabberCount: this.activeGrabberCount,
      blend: this.blend,
      intensity: smoothStep(this.blend) * this.intensity,
      direction: {
        x: this.smoothedGrabDirection.x,
        y: 0,
        z: this.smoothedGrabDirection.z,
      },
      lookDirection: {
        x: this.smoothedLookDirection.x,
        y: this.smoothedLookDirection.y,
        z: this.smoothedLookDirection.z,
      },
      jerkActive: this.getJerkWeight() > 0,
      hitActive: this.isHitActive(),
      hitStrength: this.hitStrength,
      hitZone: this.hitZone,
      hitType: this.hitType,
      hitDirection: vectorSnapshot(this.hitDirectionWorld),
      hitDirectionWorld: vectorSnapshot(this.hitDirectionWorld),
      hitDirectionLocal: {
        right: this.hitDirectionLocalRight,
        forward: this.hitDirectionLocalForward,
      },
      hitProgress:
        this.hitDuration > 0
          ? clamp(this.hitElapsed / this.hitDuration, 0, 1)
          : 0,
      hitDuration: this.hitDuration,
      impactWeight: this.hitWeights.impact,
      recoilWeight: this.hitWeights.recoil,
      staggerWeight: this.hitWeights.stagger,
      headLagWeight: this.hitWeights.headLag,
      recoveryWeight: this.hitWeights.recovery,
      dodgeActive: this.isDodgeActive(),
      dodgeStyle: this.dodgeStyle,
      dodgeProgress:
        this.dodgeDuration > 0
          ? clamp(this.dodgeElapsed / this.dodgeDuration, 0, 1)
          : 0,
      dodgeDuration: this.dodgeDuration,
      dodgeDirection: vectorSnapshot(this.dodgeDirectionWorld),
      visualRootOffset: vectorSnapshot(this.visualRootHitOffset),
      neckGrabActive: this.neckGrabRequested || this.neckGrabWeight > 0.0001,
      neckGrabWeight: this.neckGrabWeight,
      neckGrabLift: this.neckGrabLift,
      neckGrabEscapeProgress: this.neckGrabEscapeProgress,
      neckGrabAnchorCaptured: this.neckGrabAnchorCaptured,
      neckGrabLegPoseDegrees: {
        leftThigh: degrees(this.neckGrabPose.leftThighPitch),
        rightThigh: degrees(this.neckGrabPose.rightThighPitch),
        leftKnee: degrees(this.neckGrabPose.leftKneeFlex),
        rightKnee: degrees(this.neckGrabPose.rightKneeFlex),
      },
      localAxisMapping: LIMB_LOCAL_AXIS_MAPPING,
      resolvedBones: this.rig.getResolvedBones(),
      animatedBones: this.rig.getAnimatedBones(),
      missingRequiredBones: this.rig.getMissingRequiredBones(),
      poseMask: { ...this.poseMask },
    };
  }

  public dispose() {
    if (this.disposed) return;
    this.restoreBasePose();
    this.neckGrabRequested = false;
    this.neckGrabWeight = 0;
    this.neckGrabLift = 0;
    this.neckGrabAnchorCaptured = false;
    this.cancelHitReaction();
    this.cancelDodgeReaction();
    this.disposed = true;
    if (this.beforeAnimationsObserver) {
      this.scene.onBeforeAnimationsObservable.remove(this.beforeAnimationsObserver);
      this.beforeAnimationsObserver = null;
    }
    if (this.afterAnimationsObserver) {
      this.scene.onAfterAnimationsObservable.remove(this.afterAnimationsObserver);
      this.afterAnimationsObserver = null;
    }
    if (this.sceneDisposeObserver) {
      this.scene.onDisposeObservable.remove(this.sceneDisposeObserver);
      this.sceneDisposeObserver = null;
    }
  }

  private captureBasePose() {
    this.visualRootBasePosition.copyFrom(this.visualRoot.position);
    this.rig.captureBasePose();
  }

  private captureNeckGrabAnchorIfNeeded() {
    if (!this.neckGrabRequested || this.neckGrabAnchorCaptured) return;
    if (
      this.rig.getJointWorldPositionToRef("neck", this.neckGrabAnchorWorld)
    ) {
      this.neckGrabAnchorCaptured = true;
    }
  }

  private stabilizeNeckGrabAnchor() {
    if (!this.neckGrabAnchorCaptured || this.neckGrabWeight <= 0.0001) return;
    if (
      !this.rig.getJointWorldPositionToRef("neck", this.neckGrabCurrentWorld)
    ) {
      return;
    }

    const weight = smoothStep(this.neckGrabWeight);
    const effort = 0.55 + this.neckGrabEscapeProgress * 0.45;
    const shakeEnvelope =
      smoothStep(this.neckGrabLift) *
      (0.72 + this.neckGrabEscapeProgress * 0.28);
    const shakePulse = Math.tanh(
      Math.sin(this.neckGrabElapsed * Math.PI * 2 * 2.45) * 2.2
    );
    const shakeCounter = Math.sin(
      this.neckGrabElapsed * Math.PI * 2 * 4.9 + 0.8
    );
    const lateralSway =
      shakeCounter * NECK_GRAB_SHAKE_LATERAL_METERS * shakeEnvelope;
    const forwardSway =
      shakePulse *
      NECK_GRAB_SHAKE_FORWARD_METERS *
      effort *
      shakeEnvelope;
    const verticalSway =
      shakeCounter *
      NECK_GRAB_SHAKE_VERTICAL_METERS *
      shakeEnvelope;
    const attackerOffsetX =
      this.neckGrabAttackerPosition.x - this.root.position.x;
    const attackerOffsetZ =
      this.neckGrabAttackerPosition.z - this.root.position.z;
    const attackerDistance = Math.hypot(attackerOffsetX, attackerOffsetZ);
    const pullX = attackerDistance > 0.001
      ? attackerOffsetX / attackerDistance
      : this.forwardAxis.x;
    const pullZ = attackerDistance > 0.001
      ? attackerOffsetZ / attackerDistance
      : this.forwardAxis.z;
    const sideX = pullZ;
    const sideZ = -pullX;
    this.neckGrabDesiredWorld.copyFrom(this.neckGrabAnchorWorld);
    this.neckGrabDesiredWorld.x +=
      sideX * lateralSway + pullX * forwardSway;
    this.neckGrabDesiredWorld.y +=
      this.neckGrabPose.visualLift + verticalSway;
    this.neckGrabDesiredWorld.z +=
      sideZ * lateralSway + pullZ * forwardSway;
    this.neckGrabDesiredWorld.subtractToRef(
      this.neckGrabCurrentWorld,
      this.neckGrabCorrectionWorld
    );
    this.root.computeWorldMatrix(true).invertToRef(this.neckGrabRootInverse);
    Vector3.TransformNormalToRef(
      this.neckGrabCorrectionWorld,
      this.neckGrabRootInverse,
      this.neckGrabCorrectionLocal
    );
    this.neckGrabCorrectionLocal.scaleInPlace(weight);
    this.visualRoot.position.addInPlace(this.neckGrabCorrectionLocal);
    this.visualRoot.computeWorldMatrix(true);
    this.rig.prepare();
  }

  private restoreBasePose() {
    if (!this.poseApplied) return;
    this.visualRoot.position.copyFrom(this.visualRootBasePosition);
    this.rig.restoreBasePose();
    this.poseApplied = false;
  }

  private applyPose(struggleWeight: number) {
    const yaw = this.root.rotation.y;
    this.rightAxis.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.forwardAxis.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.computePlayerReactionPose();
    this.computeNeckGrabPose();

    const directionRight = Vector3.Dot(this.smoothedGrabDirection, this.rightAxis);
    const directionForward = Vector3.Dot(
      this.smoothedGrabDirection,
      this.forwardAxis
    );
    const lookRight = Vector3.Dot(this.smoothedLookDirection, this.rightAxis);
    const lookForward = Vector3.Dot(
      this.smoothedLookDirection,
      this.forwardAxis
    );
    const lookLength = this.smoothedLookDirection.length();
    const lookWeight = clamp(lookLength / 0.35, 0, 1) * struggleWeight;
    const lookYaw =
      clamp(
        Math.atan2(lookRight, lookForward),
        -radians(this.config.lookMaxYawDegrees),
        radians(this.config.lookMaxYawDegrees)
      ) * lookWeight;
    const lookPitch =
      clamp(
        Math.atan2(
          -this.smoothedLookDirection.y,
          Math.max(0.0001, Math.hypot(lookRight, lookForward))
        ),
        -radians(this.config.lookMaxPitchDegrees),
        radians(this.config.lookMaxPitchDegrees)
      ) * lookWeight;
    const slowSway = smoothNoise(this.elapsed * 0.82, 17);
    const torsoNoise = smoothNoise(this.elapsed * 1.31, 53);
    const armNoise = smoothNoise(this.elapsed * 2.17, 101);
    const legNoise = smoothNoise(this.elapsed * 1.67, 211);
    const primaryWave = Math.sin(
      this.elapsed * Math.PI * 2 * 1.12 +
        this.motionPhase +
        torsoNoise * 0.2
    );
    const counterWave = Math.sin(
      this.elapsed * Math.PI * 2 * 0.67 +
        this.motionPhase * 0.61 +
        slowSway * 0.24
    );
    const bracePulse =
      0.5 +
      Math.sin(this.elapsed * Math.PI * 2 * 1.86 + this.motionPhase * 0.37) *
        0.5;
    const tremor =
      Math.sin(this.elapsed * 15.7 + 0.8) * 0.22 +
      Math.sin(this.elapsed * 23.3 + 2.1) * 0.11;
    const jerk = this.getJerkWeight() * this.jerkStrength * this.jerkSide;

    const hipSway =
      radians(this.config.hipsSwayDegrees) *
      struggleWeight *
      (primaryWave * 0.52 +
        slowSway * 0.22 -
        directionRight * 0.55 +
        jerk * 0.72);
    const hipTwist =
      radians(this.config.hipsTwistDegrees) *
      struggleWeight *
      (primaryWave * 0.46 +
        torsoNoise * 0.3 +
        directionRight * 0.38 +
        jerk * 0.66);
    const forwardLean =
      radians(this.config.torsoForwardLeanDegrees) *
      struggleWeight *
      (0.94 + bracePulse * 0.06);
    const torsoCurl =
      radians(this.config.torsoCurlDegrees) *
      struggleWeight *
      clamp(
        0.34 +
          bracePulse * 0.16 +
          Math.abs(primaryWave) * 0.12 +
          Math.max(0, directionForward) * 0.08 +
          Math.abs(jerk) * 0.12,
        0.28,
        0.75
      );
    const torsoTwist =
      radians(this.config.torsoTwistDegrees) *
      struggleWeight *
      (primaryWave * 0.68 +
        torsoNoise * 0.32 -
        directionRight * 0.34 +
        jerk * 0.72);
    const leftEffort = clamp(
      primaryWave * 0.88 + armNoise * 0.22 + jerk * 0.74,
      -1.25,
      1.25
    );
    const rightEffort = clamp(
      -primaryWave * 0.82 + counterWave * 0.28 - jerk * 0.68,
      -1.25,
      1.25
    );
    const kneeBase =
      radians(this.config.kneeBendDegrees) *
      struggleWeight *
      (0.72 + bracePulse * 0.28);
    const legKick =
      radians(this.config.legKickDegrees) *
      struggleWeight *
      (counterWave * 0.58 + legNoise * 0.24 + jerk * 0.62);
    const stanceWidth =
      radians(this.config.stanceWidthDegrees) *
      struggleWeight *
      (0.88 + bracePulse * 0.12);
    const stanceDrop =
      this.config.stanceDropMeters *
      struggleWeight *
      (0.84 + bracePulse * 0.16 + Math.abs(jerk) * 0.08);
    // Lower only the rendered avatar. Gameplay collision, camera and water
    // state remain attached to `root` and therefore keep their normal height.
    this.visualRoot.position.y -= stanceDrop;
    this.visualRoot.position.y -= this.hitPose.visualRootDrop;
    this.visualRoot.position.y += this.neckGrabPose.visualLift;
    this.visualRootHitOffset.set(
      this.hitDirectionLocalRight * this.hitPose.visualRootDisplacement,
      0,
      this.hitDirectionLocalForward * this.hitPose.visualRootDisplacement
    );
    this.visualRoot.position.addInPlace(this.visualRootHitOffset);

    if (this.poseMask.hips) {
      this.rotate(
        "hips",
        this.forwardAxis,
        clamp(
          hipSway * 0.82 +
            this.hitPose.hipsSideBend +
            this.neckGrabPose.torsoSideBend * 0.18,
          -COMBINED_POSE_LIMITS.hipsSideBend,
          COMBINED_POSE_LIMITS.hipsSideBend
        )
      );
      this.rotate(
        "hips",
        Axis.Y,
        clamp(
          hipTwist * 0.76 +
            this.hitPose.hipsYaw +
            this.neckGrabPose.torsoYaw * 0.22,
          -COMBINED_POSE_LIMITS.hipsYaw,
          COMBINED_POSE_LIMITS.hipsYaw
        )
      );
      this.rotate(
        "hips",
        this.rightAxis,
        clamp(
          forwardLean * 0.1 +
            torsoCurl * 0.16 +
            this.hitPose.hipsPitch +
            this.neckGrabPose.hipsPitch,
          -COMBINED_POSE_LIMITS.hipsPitch,
          COMBINED_POSE_LIMITS.hipsPitch
        )
      );
    }

    if (this.poseMask.legs) {
      this.rotate(
        "leftUpLeg",
        this.rightAxis,
        clamp(
          kneeBase * 0.46 + legKick,
          -COMBINED_POSE_LIMITS.upperLegPitch,
          COMBINED_POSE_LIMITS.upperLegPitch
        )
      );
      this.rotate(
        "rightUpLeg",
        this.rightAxis,
        clamp(
          kneeBase * 0.46 - legKick * 0.82,
          -COMBINED_POSE_LIMITS.upperLegPitch,
          COMBINED_POSE_LIMITS.upperLegPitch
        )
      );
      this.rotate(
        "leftUpLeg",
        this.forwardAxis,
        -stanceWidth - hipSway * 0.34 + this.hitPose.leftThighOutward
      );
      this.rotate(
        "rightUpLeg",
        this.forwardAxis,
        stanceWidth - hipSway * 0.3 + this.hitPose.rightThighOutward
      );
      this.rotate(
        "leftUpLeg",
        Axis.Y,
        legKick * 0.32 + this.hitPose.leftThighYaw
      );
      this.rotate(
        "rightUpLeg",
        Axis.Y,
        -legKick * 0.28 + this.hitPose.rightThighYaw
      );
      this.rotate(
        "leftLeg",
        this.rightAxis,
        clamp(
          -kneeBase * (0.94 + legNoise * 0.1),
          -COMBINED_POSE_LIMITS.kneeFlex,
          COMBINED_POSE_LIMITS.kneeFlex
        )
      );
      this.rotate(
        "rightLeg",
        this.rightAxis,
        clamp(
          -kneeBase * (0.9 - legNoise * 0.08),
          -COMBINED_POSE_LIMITS.kneeFlex,
          COMBINED_POSE_LIMITS.kneeFlex
        )
      );
      this.rotate("leftLeg", this.forwardAxis, stanceWidth * 0.2);
      this.rotate("rightLeg", this.forwardAxis, -stanceWidth * 0.2);
      this.rotate(
        "leftFoot",
        this.rightAxis,
        clamp(
          kneeBase * 0.34 - legKick * 0.34,
          -COMBINED_POSE_LIMITS.footPitch,
          COMBINED_POSE_LIMITS.footPitch
        )
      );
      this.rotate(
        "rightFoot",
        this.rightAxis,
        clamp(
          kneeBase * 0.32 + legKick * 0.28,
          -COMBINED_POSE_LIMITS.footPitch,
          COMBINED_POSE_LIMITS.footPitch
        )
      );
      this.rotate(
        "leftFoot",
        this.forwardAxis,
        stanceWidth * 0.16 + this.hitPose.leftFootRoll
      );
      this.rotate(
        "rightFoot",
        this.forwardAxis,
        -stanceWidth * 0.16 + this.hitPose.rightFootRoll
      );

      // Both player GLBs expose the sagittal leg hinge as local X even though
      // their bind-pose longitudinal axes differ. Appending in joint space
      // preserves the authored pose and avoids Sofia's former sideways knees.
      this.appendLocalOffset("leftUpLeg", Axis.X, this.hitPose.leftThighPitch);
      this.appendLocalOffset("rightUpLeg", Axis.X, this.hitPose.rightThighPitch);
      this.appendLocalOffset("leftLeg", Axis.X, -this.hitPose.leftKneeFlex);
      this.appendLocalOffset("rightLeg", Axis.X, -this.hitPose.rightKneeFlex);
      this.appendLocalOffset("leftFoot", Axis.X, this.hitPose.leftFootPitch);
      this.appendLocalOffset("rightFoot", Axis.X, this.hitPose.rightFootPitch);
      this.appendLocalOffset(
        "leftUpLeg",
        Axis.X,
        this.neckGrabPose.leftThighPitch
      );
      this.appendLocalOffset(
        "rightUpLeg",
        Axis.X,
        this.neckGrabPose.rightThighPitch
      );
      this.appendLocalOffset(
        "leftLeg",
        Axis.X,
        -this.neckGrabPose.leftKneeFlex
      );
      this.appendLocalOffset(
        "rightLeg",
        Axis.X,
        -this.neckGrabPose.rightKneeFlex
      );
    }

    if (this.poseMask.torso) {
      this.rotate(
        "spine",
        this.rightAxis,
        clamp(
          forwardLean * 0.22 +
            torsoCurl * 0.24 +
            this.hitPose.spinePitch +
            this.neckGrabPose.torsoPitch * 0.2,
          -COMBINED_POSE_LIMITS.spinePitch,
          COMBINED_POSE_LIMITS.spinePitch
        )
      );
      this.rotate(
        "spine1",
        this.rightAxis,
        clamp(
          forwardLean * 0.3 +
            torsoCurl * 0.32 +
            this.hitPose.spine1Pitch +
            this.neckGrabPose.torsoPitch * 0.34,
          -COMBINED_POSE_LIMITS.spine1Pitch,
          COMBINED_POSE_LIMITS.spine1Pitch
        )
      );
      this.rotate(
        "spine2",
        this.rightAxis,
        clamp(
          forwardLean * 0.38 +
            torsoCurl * 0.42 +
            this.hitPose.spine2Pitch +
            this.neckGrabPose.torsoPitch * 0.46,
          -COMBINED_POSE_LIMITS.spine2Pitch,
          COMBINED_POSE_LIMITS.spine2Pitch
        )
      );
      this.rotate(
        "spine",
        Axis.Y,
        clamp(
          torsoTwist * 0.28 +
            this.hitPose.torsoYaw * 0.34 +
            this.neckGrabPose.torsoYaw * 0.24,
          -COMBINED_POSE_LIMITS.spineYaw,
          COMBINED_POSE_LIMITS.spineYaw
        )
      );
      this.rotate(
        "spine1",
        Axis.Y,
        clamp(
          torsoTwist * 0.42 +
            this.hitPose.torsoYaw * 0.68 +
            this.neckGrabPose.torsoYaw * 0.36,
          -COMBINED_POSE_LIMITS.spine1Yaw,
          COMBINED_POSE_LIMITS.spine1Yaw
        )
      );
      this.rotate(
        "spine2",
        Axis.Y,
        clamp(
          torsoTwist * 0.56 +
            this.hitPose.torsoYaw +
            lookYaw * 0.12 +
            this.neckGrabPose.torsoYaw * 0.4,
          -COMBINED_POSE_LIMITS.spine2Yaw,
          COMBINED_POSE_LIMITS.spine2Yaw
        )
      );
      this.rotate(
        "spine",
        this.forwardAxis,
        clamp(
          hipSway * 0.26 +
            this.hitPose.torsoSideBend * 0.35 +
            this.neckGrabPose.torsoSideBend * 0.2,
          -COMBINED_POSE_LIMITS.spineSideBend,
          COMBINED_POSE_LIMITS.spineSideBend
        )
      );
      this.rotate(
        "spine1",
        this.forwardAxis,
        clamp(
          hipSway * 0.48 +
            this.hitPose.torsoSideBend * 0.68 +
            this.neckGrabPose.torsoSideBend * 0.34,
          -COMBINED_POSE_LIMITS.spineSideBend,
          COMBINED_POSE_LIMITS.spineSideBend
        )
      );
      this.rotate(
        "spine2",
        this.forwardAxis,
        clamp(
          hipSway * 0.72 +
            this.hitPose.torsoSideBend +
            this.neckGrabPose.torsoSideBend * 0.46,
          -COMBINED_POSE_LIMITS.spineSideBend,
          COMBINED_POSE_LIMITS.spineSideBend
        )
      );
    }

    const shoulderEffort =
      radians(this.config.shoulderEffortDegrees) * struggleWeight;
    const armEffort = radians(this.config.armEffortDegrees) * struggleWeight;
    const armSpread = radians(this.config.armSpreadDegrees) * struggleWeight;
    const armForwardReach =
      radians(this.config.armForwardReachDegrees) * struggleWeight;
    const forearmLift = radians(this.config.forearmLiftDegrees) * struggleWeight;
    const neckGrabLimitWeight = smoothStep(this.neckGrabWeight);
    const hitLimitWeight = this.isHitActive()
      ? clamp(
          this.hitStrength * (this.hitType === "heavy" ? 1 : 0.72),
          0,
          1
        )
      : 0;
    const shoulderMax = lerp(
      radians(this.config.shoulderMaxDegrees),
      radians(25),
      hitLimitWeight
    );
    const upperArmMax = lerp(
      radians(this.config.upperArmMaxDegrees),
      Math.max(NECK_GRAB_UPPER_ARM_LIMIT, radians(64)),
      Math.max(neckGrabLimitWeight, hitLimitWeight)
    );
    const forearmMax = lerp(
      radians(this.config.forearmMaxDegrees),
      Math.max(NECK_GRAB_FOREARM_LIMIT, radians(76)),
      Math.max(neckGrabLimitWeight, hitLimitWeight)
    );

    if (this.poseMask.shoulders) {
      const leftRetraction = clamp(
        shoulderEffort *
          (0.3 + leftEffort * 0.2 + Math.max(0, jerk) * 0.34) +
          this.hitPose.leftShoulderRetraction -
          this.neckGrabPose.shoulderProtraction,
        -shoulderMax,
        shoulderMax
      );
      const rightRetraction = clamp(
        shoulderEffort *
          (0.3 + rightEffort * 0.2 + Math.max(0, -jerk) * 0.34) +
          this.hitPose.rightShoulderRetraction -
          this.neckGrabPose.shoulderProtraction,
        -shoulderMax,
        shoulderMax
      );
      this.applyLocalOffset(
        "leftShoulder",
        Axis.Z,
        -leftRetraction * LEFT_FORWARD_FLEX_SIGN
      );
      this.applyLocalOffset(
        "rightShoulder",
        Axis.Z,
        -rightRetraction * RIGHT_FORWARD_FLEX_SIGN
      );
    }

    if (this.poseMask.upperArms) {
      let leftLift = -(
        armSpread * (0.82 + bracePulse * 0.16) +
        armEffort * clamp(0.18 + leftEffort * 0.15, 0.02, 0.36)
      ) +
        this.hitPose.leftArmLift +
        this.neckGrabPose.leftArmLift;
      let rightLift = -(
        armSpread * (0.82 + (1 - bracePulse) * 0.16) +
        armEffort * clamp(0.18 + rightEffort * 0.15, 0.02, 0.36)
      ) +
        this.hitPose.rightArmLift +
        this.neckGrabPose.rightArmLift;
      let leftReach =
        LEFT_FORWARD_FLEX_SIGN *
          armForwardReach *
          clamp(0.78 + leftEffort * 0.12, 0.62, 0.94) +
        this.hitPose.leftArmReach +
        this.neckGrabPose.leftArmReach;
      let rightReach =
        RIGHT_FORWARD_FLEX_SIGN *
          armForwardReach *
          clamp(0.78 + rightEffort * 0.12, 0.62, 0.94) +
        this.hitPose.rightArmReach +
        this.neckGrabPose.rightArmReach;
      const leftLength = Math.hypot(leftLift, leftReach);
      const rightLength = Math.hypot(rightLift, rightReach);
      const leftScale = leftLength > upperArmMax ? upperArmMax / leftLength : 1;
      const rightScale = rightLength > upperArmMax ? upperArmMax / rightLength : 1;
      leftLift *= leftScale;
      leftReach *= leftScale;
      rightLift *= rightScale;
      rightReach *= rightScale;
      this.applyLocalOffset("leftArm", Axis.X, leftLift, Axis.Z, leftReach);
      this.applyLocalOffset("rightArm", Axis.X, rightLift, Axis.Z, rightReach);
    }

    if (this.poseMask.forearms) {
      const leftFlex = clamp(
        forearmLift *
          (0.82 + leftEffort * 0.14 + bracePulse * 0.1 + tremor * 0.035) +
          armEffort * Math.max(0, jerk) * 0.14 +
          this.hitPose.leftForearmFlex +
          this.neckGrabPose.leftForearmFlex,
        0,
        forearmMax
      );
      const rightFlex = clamp(
        forearmLift *
          (0.82 + rightEffort * 0.14 + (1 - bracePulse) * 0.1 - tremor * 0.035) +
          armEffort * Math.max(0, -jerk) * 0.14 +
          this.hitPose.rightForearmFlex +
          this.neckGrabPose.rightForearmFlex,
        0,
        forearmMax
      );
      this.applyLocalOffset(
        "leftForeArm",
        Axis.Z,
        leftFlex * LEFT_FORWARD_FLEX_SIGN
      );
      this.applyLocalOffset(
        "rightForeArm",
        Axis.Z,
        rightFlex * RIGHT_FORWARD_FLEX_SIGN
      );
    }

    const headCounter = radians(this.config.headCounterDegrees) * struggleWeight;
    const upperBodyLean = forwardLean + torsoCurl;
    if (this.poseMask.head) {
      this.rotate(
        "neck",
        Axis.Y,
        clamp(
          -torsoTwist * 0.3 +
            lookYaw * 0.38 +
            this.hitPose.neckYaw +
            this.neckGrabPose.neckYaw,
          -COMBINED_POSE_LIMITS.neckYaw,
          COMBINED_POSE_LIMITS.neckYaw
        )
      );
      this.rotate(
        "head",
        Axis.Y,
        clamp(
          -torsoTwist * 0.24 +
            lookYaw * 0.5 +
            this.hitPose.headYaw +
            this.neckGrabPose.headYaw,
          -COMBINED_POSE_LIMITS.headYaw,
          COMBINED_POSE_LIMITS.headYaw
        )
      );
      this.rotate("neck", this.forwardAxis, -hipSway * 0.3);
      this.rotate(
        "neck",
        this.rightAxis,
        clamp(
          -upperBodyLean * 0.34 +
            lookPitch * 0.36 +
            this.hitPose.neckPitch +
            this.neckGrabPose.neckPitch,
          -COMBINED_POSE_LIMITS.neckPitch,
          COMBINED_POSE_LIMITS.neckPitch
        )
      );
      this.rotate(
        "head",
        this.rightAxis,
        clamp(
          -upperBodyLean * 0.46 +
            lookPitch * 0.64 +
            headCounter * (counterWave * 0.58 + slowSway * 0.22) +
            this.hitPose.headPitch +
            this.neckGrabPose.headPitch,
          -COMBINED_POSE_LIMITS.headPitch,
          COMBINED_POSE_LIMITS.headPitch
        )
      );
    }
  }

  private applyStairLocomotionPose() {
    const pose = computeStairLegPose(
      this.stairLocomotion,
      this.stairLocomotionBlend
    );
    if (this.poseMask.torso && pose.torsoForwardLean > 0.0001) {
      // Spread the slight uphill lean across the torso so it reads as a
      // balanced weight shift rather than a sharp bend at one vertebra.
      this.rotate("spine", this.rightAxis, pose.torsoForwardLean * 0.3);
      this.rotate("spine1", this.rightAxis, pose.torsoForwardLean * 0.35);
      this.rotate("spine2", this.rightAxis, pose.torsoForwardLean * 0.35);
    }
    this.appendLocalOffset("leftUpLeg", Axis.X, pose.leftThighPitch);
    this.appendLocalOffset("rightUpLeg", Axis.X, pose.rightThighPitch);
    this.appendLocalOffset("leftLeg", Axis.X, -pose.leftKneeFlex);
    this.appendLocalOffset("rightLeg", Axis.X, -pose.rightKneeFlex);
    this.appendLocalOffset("leftFoot", Axis.X, pose.leftFootPitch);
    this.appendLocalOffset("rightFoot", Axis.X, pose.rightFootPitch);
  }

  private updateNeckGrab(dt: number) {
    const targetWeight = this.neckGrabRequested ? 1 : 0;
    this.neckGrabWeight = damp(
      this.neckGrabWeight,
      targetWeight,
      this.neckGrabRequested ? 11 : 7.5,
      dt
    );
    this.neckGrabLift = damp(
      this.neckGrabLift,
      this.neckGrabRequested ? this.neckGrabTargetLift : 0,
      this.neckGrabRequested ? 8.5 : 7,
      dt
    );
    if (this.neckGrabRequested || this.neckGrabWeight > 0.001) {
      this.neckGrabElapsed += dt;
    }
    if (!this.neckGrabRequested && this.neckGrabWeight < 0.0001) {
      this.neckGrabWeight = 0;
      this.neckGrabLift = 0;
      this.neckGrabAnchorCaptured = false;
      resetNeckGrabPose(this.neckGrabPose);
    }
  }

  private computeNeckGrabPose() {
    resetNeckGrabPose(this.neckGrabPose);
    const weight = smoothStep(this.neckGrabWeight);
    if (weight <= 0.0001) return;

    const escapeEffort = 0.48 + this.neckGrabEscapeProgress * 0.52;
    const primary = Math.sin(this.neckGrabElapsed * Math.PI * 2 * 2.05);
    const counter = Math.sin(
      this.neckGrabElapsed * Math.PI * 2 * 1.37 + this.motionPhase * 0.41
    );
    const tremor =
      Math.sin(this.neckGrabElapsed * 17.3 + this.motionPhase) * 0.55 +
      Math.sin(this.neckGrabElapsed * 25.1 + 1.4) * 0.25;
    const effortWave = (primary * 0.72 + counter * 0.28) * escapeEffort;

    let attackerRight = 0;
    let attackerForward = 1;
    const offsetX = this.neckGrabAttackerPosition.x - this.root.position.x;
    const offsetZ = this.neckGrabAttackerPosition.z - this.root.position.z;
    const offsetLength = Math.hypot(offsetX, offsetZ);
    if (offsetLength > 0.001) {
      attackerRight =
        (offsetX * this.rightAxis.x + offsetZ * this.rightAxis.z) / offsetLength;
      attackerForward =
        (offsetX * this.forwardAxis.x + offsetZ * this.forwardAxis.z) /
        offsetLength;
    }
    const lookYaw = clamp(
      Math.atan2(attackerRight, attackerForward),
      -radians(16),
      radians(16)
    );

    this.neckGrabPose.hipsPitch = radians(-4) * weight;
    this.neckGrabPose.torsoPitch =
      radians(-7.5) * weight + radians(0.65) * effortWave * weight;
    this.neckGrabPose.torsoYaw =
      (lookYaw * 0.22 + radians(1.4) * effortWave) * weight;
    this.neckGrabPose.torsoSideBend =
      radians(1.6) * counter * escapeEffort * weight;
    this.neckGrabPose.neckPitch =
      (radians(-7) + radians(0.7) * Math.max(0, primary)) * weight;
    this.neckGrabPose.headPitch =
      (radians(-9) + radians(0.9) * tremor * escapeEffort) * weight;
    this.neckGrabPose.neckYaw = lookYaw * 0.2 * weight;
    this.neckGrabPose.headYaw =
      (lookYaw * 0.34 - radians(1) * effortWave) * weight;

    // A reciprocal run cadence sells the suspended kicking motion. Two faster,
    // mismatched waves keep it from looking like a clean locomotion loop.
    const runCycle = Math.sin(
      this.neckGrabElapsed * Math.PI * 2 * 2.35 + this.motionPhase * 0.17
    );
    const leftChaos = Math.sin(
      this.neckGrabElapsed * Math.PI * 2 * 3.61 + this.motionPhase * 0.73
    );
    const rightChaos = Math.sin(
      this.neckGrabElapsed * Math.PI * 2 * 3.17 + 1.2 + this.motionPhase * 0.39
    );
    const legEffort = (0.58 + this.neckGrabEscapeProgress * 0.42) * weight;
    this.neckGrabPose.leftThighPitch =
      radians(24) * (runCycle * 0.82 + leftChaos * 0.18) * legEffort;
    this.neckGrabPose.rightThighPitch =
      radians(24) * (-runCycle * 0.78 + rightChaos * 0.22) * legEffort;
    this.neckGrabPose.leftKneeFlex =
      radians(8 + Math.max(0, -runCycle) * 32 + Math.max(0, leftChaos) * 5) *
      legEffort;
    this.neckGrabPose.rightKneeFlex =
      radians(8 + Math.max(0, runCycle) * 32 + Math.max(0, rightChaos) * 5) *
      legEffort;

    this.neckGrabPose.shoulderProtraction = radians(5.5) * weight;
    const armStruggle = radians(7) * effortWave * weight;
    this.neckGrabPose.leftArmLift = radians(-49) * weight - armStruggle;
    this.neckGrabPose.rightArmLift = radians(-49) * weight + armStruggle * 0.86;
    this.neckGrabPose.leftArmReach =
      radians(22) * LEFT_FORWARD_FLEX_SIGN * weight;
    this.neckGrabPose.rightArmReach =
      radians(22) * RIGHT_FORWARD_FLEX_SIGN * weight;
    this.neckGrabPose.leftForearmFlex =
      (radians(61) + radians(8) * Math.max(0, -primary) * escapeEffort) * weight;
    this.neckGrabPose.rightForearmFlex =
      (radians(61) + radians(8) * Math.max(0, primary) * escapeEffort) * weight;
    this.neckGrabPose.visualLift =
      NECK_GRAB_VISUAL_LIFT_METERS * this.neckGrabLift * weight;
  }

  private updateHitReaction(dt: number) {
    if (!Number.isFinite(this.hitElapsed) || this.hitDuration <= 0) {
      resetHitReactionWeights(this.hitWeights);
      return;
    }

    this.hitElapsed = Math.min(this.hitDuration, this.hitElapsed + dt);
    const progress = clamp(this.hitElapsed / this.hitDuration, 0, 1);
    this.hitWeights.impact = asymmetricPulse(progress, 0, 0.14, 0.38);
    this.hitWeights.recoil = asymmetricPulse(progress, 0.04, 0.38, 0.9);
    this.hitWeights.stagger = asymmetricPulse(progress, 0.16, 0.56, 0.96);
    this.hitWeights.headLag = asymmetricPulse(progress, 0.18, 0.6, 0.98);
    this.hitWeights.recovery = smoothStep((progress - 0.55) / 0.45);
    this.hitWeights.overshoot = asymmetricPulse(progress, 0.68, 0.84, 1);
  }

  private updateDodgeReaction(dt: number) {
    if (!Number.isFinite(this.dodgeElapsed) || this.dodgeDuration <= 0) return;
    this.dodgeElapsed = Math.min(
      this.dodgeDuration,
      this.dodgeElapsed + dt
    );
  }

  private isHitActive() {
    return (
      this.hitDuration > 0 &&
      Number.isFinite(this.hitElapsed) &&
      this.hitElapsed < this.hitDuration
    );
  }

  private isDodgeActive() {
    return (
      this.dodgeDuration > 0 &&
      Number.isFinite(this.dodgeElapsed) &&
      this.dodgeElapsed < this.dodgeDuration
    );
  }

  private cancelHitReaction() {
    this.hitElapsed = Number.POSITIVE_INFINITY;
    this.hitDuration = 0;
    resetHitReactionWeights(this.hitWeights);
  }

  private cancelDodgeReaction() {
    this.dodgeElapsed = Number.POSITIVE_INFINITY;
    this.dodgeDuration = 0;
    this.dodgeDirectionWorld.setAll(0);
    this.dodgePlanarDirectionWorld.setAll(0);
  }

  private resolveDodgeDirection(event: PlayerDodgeReactionEvent) {
    this.dodgeDirectionWorld.copyFrom(event.direction ?? Vector3.Zero());
    this.dodgeDirectionWorld.y = 0;
    if (this.dodgeDirectionWorld.lengthSquared() > 0.000001) {
      this.dodgeDirectionWorld.normalize();
      this.dodgePlanarDirectionWorld.copyFrom(this.dodgeDirectionWorld);
      return;
    }

    const yaw = this.root.rotation.y;
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    if (this.dodgeStyle === "backstep") {
      if (event.sourcePosition) {
        this.dodgeDirectionWorld.set(
          this.root.position.x - event.sourcePosition.x,
          0,
          this.root.position.z - event.sourcePosition.z
        );
      }
      if (this.dodgeDirectionWorld.lengthSquared() <= 0.000001) {
        this.dodgeDirectionWorld.set(-forwardX, 0, -forwardZ);
      } else {
        this.dodgeDirectionWorld.normalize();
      }
      this.dodgePlanarDirectionWorld.copyFrom(this.dodgeDirectionWorld);
      return;
    }

    let side = event.side === "left" ? -1 : event.side === "right" ? 1 : 0;
    if (side === 0 && event.sourcePosition) {
      const sourceX = event.sourcePosition.x - this.root.position.x;
      const sourceZ = event.sourcePosition.z - this.root.position.z;
      const sourceRight = sourceX * rightX + sourceZ * rightZ;
      if (Math.abs(sourceRight) > 0.12) side = -Math.sign(sourceRight);
    }
    if (side === 0) side = this.nextRandom() < 0.5 ? -1 : 1;
    this.dodgeDirectionWorld.set(rightX * side, 0, rightZ * side);
    this.dodgePlanarDirectionWorld.copyFrom(this.dodgeDirectionWorld);
  }

  private computePlayerReactionPose() {
    resetHitReactionPose(this.hitPose);
    if (this.isHitActive()) this.computeHitReactionPose();
    if (this.isDodgeActive()) this.computeDodgeReactionPose();
  }

  private computeHitReactionPose() {
    this.hitDirectionLocalRight = Vector3.Dot(
      this.hitPlanarDirectionWorld,
      this.rightAxis
    );
    this.hitDirectionLocalForward = Vector3.Dot(
      this.hitPlanarDirectionWorld,
      this.forwardAxis
    );
    if (this.hitDuration <= 0 || !Number.isFinite(this.hitElapsed)) return;

    const weights = this.hitWeights;
    const profile = HIT_ZONE_PROFILES[this.hitZone];
    const typeScale = this.hitType === "heavy" ? 1.32 : this.hitType === "projectile" ? 0.78 : 1;
    const strength = clamp(this.hitStrength * typeScale, 0, 1.35);
    const forward = clamp(this.hitDirectionLocalForward, -1, 1);
    const right = clamp(this.hitDirectionLocalRight, -1, 1);
    const chestResponse = clamp(
      weights.impact * 0.82 + weights.recoil * 0.72 - weights.overshoot * 0.06,
      -0.06,
      1
    );
    const middleResponse = clamp(
      weights.impact * 0.28 + weights.recoil * 0.9 - weights.overshoot * 0.06,
      -0.06,
      1
    );
    const lowerResponse = clamp(
      weights.recoil * 0.2 + weights.stagger * this.hitStaggerVariation - weights.overshoot * 0.05,
      -0.05,
      1
    );
    const shoulderResponse = clamp(
      weights.impact * 0.48 + weights.recoil * 0.52,
      0,
      1
    );
    const armResponse = clamp(
      weights.impact * 0.14 + weights.recoil * 0.36 + weights.stagger * 0.28,
      0,
      1
    );
    const delayedHeadResponse = clamp(
      weights.headLag * this.hitHeadLagVariation - weights.impact * 0.18,
      -0.22,
      1
    );
    const shoulderZoneBias =
      this.hitZone === "leftShoulder"
        ? -1
        : this.hitZone === "rightShoulder"
          ? 1
          : 0;
    const twistDirection = clamp(
      right * 0.78 + this.hitTwistVariation * 0.22 + shoulderZoneBias * 0.42,
      -1,
      1
    );
    const abdomenCurl =
      radians(7) *
      strength *
      profile.abdomenCurl *
      -forward *
      weights.stagger;

    this.hitPose.spine2Pitch =
      radians(this.config.hitSpine2PitchDegrees) *
      strength *
      profile.chest *
      forward *
      chestResponse;
    this.hitPose.spine1Pitch =
      radians(this.config.hitSpine1PitchDegrees) *
        strength *
        profile.chest *
        forward *
        middleResponse +
      abdomenCurl * 0.72;
    this.hitPose.spinePitch =
      radians(this.config.hitSpinePitchDegrees) *
        strength *
        profile.chest *
        forward *
        (middleResponse * 0.72 + lowerResponse * 0.18) +
      abdomenCurl;
    this.hitPose.hipsPitch =
      radians(this.config.hitHipsPitchDegrees) *
      strength *
      profile.lowerBody *
      forward *
      lowerResponse;
    this.hitPose.torsoYaw =
      radians(this.config.hitTorsoTwistDegrees) *
      strength *
      profile.twist *
      twistDirection *
      (middleResponse * 0.72 + lowerResponse * 0.28);
    this.hitPose.hipsYaw = this.hitPose.torsoYaw * 0.34 * lowerResponse;
    this.hitPose.torsoSideBend =
      radians(this.config.hitTorsoSideBendDegrees) *
      strength *
      right *
      (middleResponse * 0.76 + lowerResponse * 0.24);
    this.hitPose.hipsSideBend = this.hitPose.torsoSideBend * 0.3 * lowerResponse;

    const kneeFlex =
      radians(this.config.hitKneeFlexDegrees) *
      strength *
      profile.lowerBody *
      clamp(lowerResponse, 0, 1);
    const balanceBias = right * 0.12 + this.hitShoulderBias * 0.35;
    this.hitPose.leftKneeFlex = kneeFlex * clamp(1 + balanceBias, 0.78, 1.2);
    this.hitPose.rightKneeFlex = kneeFlex * clamp(1 - balanceBias, 0.78, 1.2);
    this.hitPose.leftThighPitch = this.hitPose.leftKneeFlex * 0.06;
    this.hitPose.rightThighPitch = this.hitPose.rightKneeFlex * 0.06;

    this.hitPose.neckPitch =
      radians(this.config.hitNeckPitchDegrees) *
      strength *
      profile.head *
      forward *
      delayedHeadResponse;
    this.hitPose.headPitch =
      radians(this.config.hitHeadPitchDegrees) *
      strength *
      profile.head *
      forward *
      delayedHeadResponse;
    this.hitPose.neckYaw = this.hitPose.torsoYaw * 0.18 * weights.headLag;
    this.hitPose.headYaw = this.hitPose.torsoYaw * 0.3 * weights.headLag;

    const shoulderAmount =
      radians(this.config.hitShoulderDegrees) *
      strength *
      profile.shoulders *
      shoulderResponse;
    let leftShoulder = shoulderAmount * (0.68 + this.hitShoulderBias);
    let rightShoulder = shoulderAmount * (0.68 - this.hitShoulderBias);
    if (this.hitZone === "leftShoulder") {
      leftShoulder += shoulderAmount * 0.32;
      rightShoulder *= 0.62;
    } else if (this.hitZone === "rightShoulder") {
      rightShoulder += shoulderAmount * 0.32;
      leftShoulder *= 0.62;
    }
    const shoulderLimit = radians(this.config.hitShoulderDegrees);
    this.hitPose.leftShoulderRetraction = clamp(
      leftShoulder,
      -shoulderLimit,
      shoulderLimit
    );
    this.hitPose.rightShoulderRetraction = clamp(
      rightShoulder,
      -shoulderLimit,
      shoulderLimit
    );

    const armAmount =
      radians(this.config.hitUpperArmDegrees) *
      strength *
      profile.arms *
      armResponse;
    const armBias = clamp(this.hitShoulderBias, -0.12, 0.12);
    this.hitPose.leftArmLift = -armAmount * (0.72 + armBias);
    this.hitPose.rightArmLift = -armAmount * (0.72 - armBias);
    this.hitPose.leftArmReach = armAmount * 0.56 * LEFT_FORWARD_FLEX_SIGN;
    this.hitPose.rightArmReach = armAmount * 0.56 * RIGHT_FORWARD_FLEX_SIGN;

    const forearmAmount =
      radians(this.config.hitForearmDegrees) *
      strength *
      profile.arms *
      clamp(weights.recoil * 0.35 + weights.stagger * 0.46, 0, 1);
    this.hitPose.leftForearmFlex = forearmAmount * (0.9 + armBias);
    this.hitPose.rightForearmFlex = forearmAmount * (0.9 - armBias);

    const progress = clamp(this.hitElapsed / this.hitDuration, 0, 1);
    const motion = samplePlayerHitReaction(
      progress,
      this.hitStrength,
      this.hitType
    );
    const motionScale = this.hitType === "heavy" ? 1 : this.hitType === "projectile" ? 0.5 : 0.76;
    const lead = this.hitStepLead;
    const stepWave =
      motion.firstStep -
      motion.secondStep +
      motion.thirdStep -
      motion.fourthStep +
      motion.settleStep * 0.3;

    // A backward stumble alternates roles: one leg reaches behind the moving
    // root while the other compresses under the body to keep it upright.
    // Local-X hip extension (negative pitch) prevents the old forward kick.
    const leftLeads = lead > 0;
    const oddSteps = motion.firstStep + motion.thirdStep;
    const evenSteps = motion.secondStep + motion.fourthStep;
    const leftBackStep = leftLeads ? oddSteps : evenSteps;
    const rightBackStep = leftLeads ? evenSteps : oddSteps;
    const leftSupport = rightBackStep;
    const rightSupport = leftBackStep;
    const backReach = radians(18) * motionScale;
    const supportFold = radians(5) * motionScale;
    this.hitPose.leftThighPitch +=
      -backReach * leftBackStep +
      supportFold * (leftSupport + motion.settleStep * 0.7);
    this.hitPose.rightThighPitch +=
      -backReach * rightBackStep +
      supportFold * (rightSupport + motion.settleStep * 0.7);

    const backStepKneeFlex = radians(28) * motionScale;
    const supportKneeFlex = radians(39) * motionScale;
    this.hitPose.leftKneeFlex +=
      backStepKneeFlex * leftBackStep +
      supportKneeFlex * leftSupport +
      supportKneeFlex * 0.78 * motion.settleStep;
    this.hitPose.rightKneeFlex +=
      backStepKneeFlex * rightBackStep +
      supportKneeFlex * rightSupport +
      supportKneeFlex * 0.78 * motion.settleStep;
    this.hitPose.leftKneeFlex = clamp(
      this.hitPose.leftKneeFlex,
      0,
      COMBINED_POSE_LIMITS.kneeFlex
    );
    this.hitPose.rightKneeFlex = clamp(
      this.hitPose.rightKneeFlex,
      0,
      COMBINED_POSE_LIMITS.kneeFlex
    );
    this.hitPose.leftFootPitch = clamp(
      this.hitPose.leftKneeFlex * 0.38 + radians(4) * leftBackStep,
      -COMBINED_POSE_LIMITS.footPitch,
      COMBINED_POSE_LIMITS.footPitch
    );
    this.hitPose.rightFootPitch = clamp(
      this.hitPose.rightKneeFlex * 0.38 + radians(4) * rightBackStep,
      -COMBINED_POSE_LIMITS.footPitch,
      COMBINED_POSE_LIMITS.footPitch
    );
    this.hitPose.visualRootDrop = 0.12 * motion.supportBrace * motionScale;

    // Widen the support base while each foot searches for balance. The small
    // opposing yaw and foot roll keep the retreat from reading as two straight
    // hinge rotations, while remaining independent of a specific attacker.
    const legOpen = radians(10) * motion.stanceOpen;
    const openingAsymmetry = clamp(stepWave * lead * 0.12, -0.12, 0.12);
    this.hitPose.leftThighOutward -= legOpen * (1 + openingAsymmetry);
    this.hitPose.rightThighOutward += legOpen * (1 - openingAsymmetry);
    const legArc = radians(4) * motion.stanceOpen * stepWave * lead;
    this.hitPose.leftThighYaw += legArc;
    this.hitPose.rightThighYaw -= legArc;
    this.hitPose.leftFootRoll -= radians(4) * motion.stanceOpen;
    this.hitPose.rightFootRoll += radians(4) * motion.stanceOpen;

    // Let the rib cage continue in the actual push direction while the hips
    // counterbalance. Distributing this across the spine avoids tilting the
    // complete character as one rigid block.
    this.hitPose.spinePitch += radians(3.5) * forward * motion.pushFollow;
    this.hitPose.spine1Pitch += radians(5) * forward * motion.pushFollow;
    this.hitPose.spine2Pitch += radians(8.5) * forward * motion.pushFollow;
    this.hitPose.torsoSideBend += radians(8) * right * motion.pushFollow;
    this.hitPose.torsoYaw += radians(4) * right * motion.pushFollow;
    this.hitPose.hipsSideBend -= radians(2.8) * right * motion.pushFollow;

    const balanceWobble = motion.imbalance * lead;
    this.hitPose.torsoSideBend += radians(12) * balanceWobble;
    this.hitPose.hipsSideBend -= radians(5) * balanceWobble;
    this.hitPose.torsoYaw += radians(9) * balanceWobble;
    this.hitPose.hipsYaw -= radians(4) * balanceWobble;
    this.hitPose.neckYaw -= radians(5) * balanceWobble;
    this.hitPose.headYaw -= radians(8) * balanceWobble;

    const armSpread = radians(27) * motion.armSpread;
    const armSwing = radians(36) * motion.armSwing;
    this.hitPose.leftShoulderRetraction +=
      radians(9) * (motion.armSwing + motion.armSpread * 0.35);
    this.hitPose.rightShoulderRetraction +=
      radians(9) * (-motion.armSwing + motion.armSpread * 0.35);
    this.hitPose.leftArmLift -=
      armSpread * (0.92 + Math.max(0, motion.armSwing) * 0.24);
    this.hitPose.rightArmLift -=
      armSpread * (0.92 + Math.max(0, -motion.armSwing) * 0.24);
    this.hitPose.leftArmReach +=
      (armSwing + radians(11) * balanceWobble) * LEFT_FORWARD_FLEX_SIGN;
    this.hitPose.rightArmReach +=
      (-armSwing + radians(11) * balanceWobble) * RIGHT_FORWARD_FLEX_SIGN;
    this.hitPose.leftForearmFlex +=
      radians(24) *
      clamp(motion.armSpread * 0.74 + Math.max(0, -motion.armSwing) * 0.48, 0, 1);
    this.hitPose.rightForearmFlex +=
      radians(24) *
      clamp(motion.armSpread * 0.74 + Math.max(0, motion.armSwing) * 0.48, 0, 1);

    this.hitPose.spinePitch += radians(7) * motion.recoveryStrain;
    this.hitPose.spine1Pitch += radians(6) * motion.recoveryStrain;
    this.hitPose.leftKneeFlex += radians(9) * motion.recoveryStrain;
    this.hitPose.rightKneeFlex += radians(9) * motion.recoveryStrain;
    this.hitPose.headPitch -= radians(4) * motion.recoveryStrain;

    this.hitPose.visualRootDisplacement =
      this.config.hitVisualRootMeters *
      strength *
      this.hitStaggerVariation *
      clamp(
        weights.impact * 0.16 + weights.stagger * 0.84 - weights.overshoot * 0.04,
        -0.04,
        1
      );
  }

  private computeDodgeReactionPose() {
    const progress = clamp(this.dodgeElapsed / this.dodgeDuration, 0, 1);
    const right = clamp(
      Vector3.Dot(this.dodgePlanarDirectionWorld, this.rightAxis),
      -1,
      1
    );
    const forward = clamp(
      Vector3.Dot(this.dodgePlanarDirectionWorld, this.forwardAxis),
      -1,
      1
    );
    const sample = samplePlayerDodgeReaction(
      progress,
      this.dodgeStrength,
      this.dodgeStyle,
      right
    );
    const { weight, crouch, lateral, turn } = sample;
    if (weight <= 0.0001) return;

    const isDuck = this.dodgeStyle === "duck";

    this.hitDirectionLocalRight = right;
    this.hitDirectionLocalForward = forward;
    this.hitPose.hipsPitch = radians(5.5) * crouch;
    this.hitPose.spinePitch = radians(3.5) * crouch;
    this.hitPose.spine1Pitch = radians(5.5) * crouch;
    this.hitPose.spine2Pitch = radians(7) * crouch;
    this.hitPose.hipsSideBend = radians(-3.5) * lateral;
    this.hitPose.torsoSideBend = radians(-11.5) * lateral;
    this.hitPose.hipsYaw = radians(-4) * turn;
    this.hitPose.torsoYaw = radians(-10) * turn;

    const kneeFlex = radians(isDuck ? 31 : 20) * crouch;
    const outsideBias = 0.18 * lateral;
    this.hitPose.leftKneeFlex = kneeFlex * clamp(1 + outsideBias, 0.78, 1.22);
    this.hitPose.rightKneeFlex = kneeFlex * clamp(1 - outsideBias, 0.78, 1.22);
    this.hitPose.leftThighPitch = radians(7) * crouch + radians(4) * lateral;
    this.hitPose.rightThighPitch = radians(7) * crouch - radians(4) * lateral;

    this.hitPose.leftShoulderRetraction = radians(5) * weight;
    this.hitPose.rightShoulderRetraction = radians(5) * weight;
    this.hitPose.leftArmLift = radians(-8 - Math.max(0, lateral) * 5) * weight;
    this.hitPose.rightArmLift = radians(-8 - Math.max(0, -lateral) * 5) * weight;
    this.hitPose.leftArmReach =
      radians(8) * LEFT_FORWARD_FLEX_SIGN * weight;
    this.hitPose.rightArmReach =
      radians(8) * RIGHT_FORWARD_FLEX_SIGN * weight;
    this.hitPose.leftForearmFlex = radians(12) * weight;
    this.hitPose.rightForearmFlex = radians(12) * weight;

    this.hitPose.neckPitch = radians(-3.5) * crouch;
    this.hitPose.headPitch = radians(-5) * crouch;
    this.hitPose.neckYaw = radians(3.5) * turn;
    this.hitPose.headYaw = radians(5.5) * turn;
    this.hitPose.visualRootDisplacement = sample.visualDisplacement;
  }

  private rotate(name: JointName, axis: Vector3, amount: number) {
    this.rig.rotateWorld(name, axis, amount);
  }

  private applyLocalOffset(
    name: JointName,
    firstAxis: Vector3,
    firstAmount: number,
    secondAxis?: Vector3,
    secondAmount = 0
  ) {
    this.rig.applyLocalOffset(
      name,
      firstAxis,
      firstAmount,
      secondAxis,
      secondAmount
    );
  }

  private appendLocalOffset(
    name: JointName,
    firstAxis: Vector3,
    firstAmount: number,
    secondAxis?: Vector3,
    secondAmount = 0
  ) {
    this.rig.appendLocalOffset(
      name,
      firstAxis,
      firstAmount,
      secondAxis,
      secondAmount
    );
  }

  private updateJerk() {
    if (!this.requestedActive) return;
    if (this.elapsed < this.nextJerkAt) return;
    this.jerkStartedAt = this.elapsed;
    this.jerkDuration = 0.22 + this.nextRandom() * 0.16;
    this.jerkStrength = 0.85 + this.nextRandom() * 0.4;
    this.jerkSide = this.nextRandom() < 0.5 ? -1 : 1;
    this.nextJerkAt =
      this.elapsed + this.jerkDuration + 0.42 + this.nextRandom() * 0.72;
  }

  private getJerkWeight() {
    if (this.jerkDuration <= 0) return 0;
    const progress = (this.elapsed - this.jerkStartedAt) / this.jerkDuration;
    if (progress < 0 || progress >= 1) return 0;
    const pulse = Math.sin(progress * Math.PI);
    return pulse * pulse;
  }

  private nextRandom() {
    let value = this.randomState | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value >>> 0;
    return this.randomState / 0xffffffff;
  }
}

function createEmptyHitReactionWeights(): HitReactionWeights {
  return {
    impact: 0,
    recoil: 0,
    stagger: 0,
    headLag: 0,
    recovery: 0,
    overshoot: 0,
  };
}

function resetHitReactionWeights(weights: HitReactionWeights) {
  weights.impact = 0;
  weights.recoil = 0;
  weights.stagger = 0;
  weights.headLag = 0;
  weights.recovery = 0;
  weights.overshoot = 0;
}

function createEmptyHitReactionPose(): HitReactionPose {
  return {
    hipsPitch: 0,
    hipsYaw: 0,
    hipsSideBend: 0,
    spinePitch: 0,
    spine1Pitch: 0,
    spine2Pitch: 0,
    torsoYaw: 0,
    torsoSideBend: 0,
    leftThighPitch: 0,
    rightThighPitch: 0,
    leftThighOutward: 0,
    rightThighOutward: 0,
    leftThighYaw: 0,
    rightThighYaw: 0,
    leftKneeFlex: 0,
    rightKneeFlex: 0,
    leftFootPitch: 0,
    rightFootPitch: 0,
    leftFootRoll: 0,
    rightFootRoll: 0,
    neckPitch: 0,
    headPitch: 0,
    neckYaw: 0,
    headYaw: 0,
    leftShoulderRetraction: 0,
    rightShoulderRetraction: 0,
    leftArmLift: 0,
    rightArmLift: 0,
    leftArmReach: 0,
    rightArmReach: 0,
    leftForearmFlex: 0,
    rightForearmFlex: 0,
    visualRootDrop: 0,
    visualRootDisplacement: 0,
  };
}

function resetHitReactionPose(pose: HitReactionPose) {
  pose.hipsPitch = 0;
  pose.hipsYaw = 0;
  pose.hipsSideBend = 0;
  pose.spinePitch = 0;
  pose.spine1Pitch = 0;
  pose.spine2Pitch = 0;
  pose.torsoYaw = 0;
  pose.torsoSideBend = 0;
  pose.leftThighPitch = 0;
  pose.rightThighPitch = 0;
  pose.leftThighOutward = 0;
  pose.rightThighOutward = 0;
  pose.leftThighYaw = 0;
  pose.rightThighYaw = 0;
  pose.leftKneeFlex = 0;
  pose.rightKneeFlex = 0;
  pose.leftFootPitch = 0;
  pose.rightFootPitch = 0;
  pose.leftFootRoll = 0;
  pose.rightFootRoll = 0;
  pose.neckPitch = 0;
  pose.headPitch = 0;
  pose.neckYaw = 0;
  pose.headYaw = 0;
  pose.leftShoulderRetraction = 0;
  pose.rightShoulderRetraction = 0;
  pose.leftArmLift = 0;
  pose.rightArmLift = 0;
  pose.leftArmReach = 0;
  pose.rightArmReach = 0;
  pose.leftForearmFlex = 0;
  pose.rightForearmFlex = 0;
  pose.visualRootDrop = 0;
  pose.visualRootDisplacement = 0;
}

function createEmptyNeckGrabPose(): NeckGrabPose {
  return {
    hipsPitch: 0,
    torsoPitch: 0,
    torsoYaw: 0,
    torsoSideBend: 0,
    leftThighPitch: 0,
    rightThighPitch: 0,
    leftKneeFlex: 0,
    rightKneeFlex: 0,
    neckPitch: 0,
    headPitch: 0,
    neckYaw: 0,
    headYaw: 0,
    shoulderProtraction: 0,
    leftArmLift: 0,
    rightArmLift: 0,
    leftArmReach: 0,
    rightArmReach: 0,
    leftForearmFlex: 0,
    rightForearmFlex: 0,
    visualLift: 0,
  };
}

function resetNeckGrabPose(pose: NeckGrabPose) {
  pose.hipsPitch = 0;
  pose.torsoPitch = 0;
  pose.torsoYaw = 0;
  pose.torsoSideBend = 0;
  pose.leftThighPitch = 0;
  pose.rightThighPitch = 0;
  pose.leftKneeFlex = 0;
  pose.rightKneeFlex = 0;
  pose.neckPitch = 0;
  pose.headPitch = 0;
  pose.neckYaw = 0;
  pose.headYaw = 0;
  pose.shoulderProtraction = 0;
  pose.leftArmLift = 0;
  pose.rightArmLift = 0;
  pose.leftArmReach = 0;
  pose.rightArmReach = 0;
  pose.leftForearmFlex = 0;
  pose.rightForearmFlex = 0;
  pose.visualLift = 0;
}

function asymmetricPulse(
  progress: number,
  start: number,
  peak: number,
  end: number
) {
  if (progress <= start || progress >= end) return 0;
  if (progress < peak) {
    return smoothStep((progress - start) / Math.max(0.0001, peak - start));
  }
  return 1 - smoothStep((progress - peak) / Math.max(0.0001, end - peak));
}

function vectorSnapshot(value: Vector3) {
  return { x: value.x, y: value.y, z: value.z };
}

function intensityForGrabberCount(count: number) {
  if (count <= 0) return 0;
  if (count === 1) return 0.82;
  if (count === 2) return 0.93;
  if (count === 3) return 1;
  return 1;
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function degrees(radiansValue: number) {
  return (radiansValue * 180) / Math.PI;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * clamp(amount, 0, 1);
}

function moveToward(current: number, target: number, maxDelta: number) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function damp(current: number, target: number, response: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-response * dt));
}

function smoothStep(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function smoothNoise(time: number, seed: number) {
  const integer = Math.floor(time);
  const fraction = smoothStep(time - integer);
  const first = hashNoise(integer, seed);
  const second = hashNoise(integer + 1, seed);
  return first + (second - first) * fraction;
}

function hashNoise(index: number, seed: number) {
  let value = Math.imul(index + seed * 374761393, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0x7fffffff - 1;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
