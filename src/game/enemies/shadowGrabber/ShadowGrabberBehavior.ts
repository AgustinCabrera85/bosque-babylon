import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGrabberState } from "./ShadowGrabberConfig";
import type { ShadowGrabberController } from "./ShadowGrabberController";
import {
  ShadowGrabberCoordinator,
  ShadowGrabberRole,
} from "./ShadowGrabberCoordinator";
import type { ShadowGrabberLightQuery } from "./ShadowGrabberLightQuery";

export enum ShadowGrabberBehaviorState {
  Idle = "idle",
  Stalking = "stalking",
  Encircling = "encircling",
  Telegraphing = "telegraphing",
  Attacking = "attacking",
  Grabbing = "grabbing",
  Holding = "holding",
  Retracting = "retracting",
  LightRepelled = "light-repelled",
  ReturningToAnchor = "returning-to-anchor",
}

export type ShadowGrabberTargetSnapshot = {
  position: Vector3;
  groundPosition: Vector3;
  horizontalVelocity: Vector3;
  collisionHeight: number;
  sanity: number;
};

export type ShadowGrabberNavigation = {
  getGroundHeight: (x: number, z: number) => number;
  isBlocked: (x: number, z: number) => boolean;
};

export type ShadowGrabberBehaviorDebug = {
  id: string;
  groupId: string;
  active: boolean;
  role: ShadowGrabberRole;
  state: ShadowGrabberBehaviorState;
  stateElapsed: number;
  anchor: Vector3;
  tacticalTarget: Vector3;
  grabTarget: Vector3;
  portalPosition: Vector3;
  attackPoint: Vector3 | null;
  rootRotationY: number;
  rootScale: number;
  currentSpeed: number;
  targetSpeed: number;
  attackCooldownRemaining: number;
  groupAttackCooldownRemaining: number;
  darknessPressure: number;
  playerInHardLight: boolean;
  currentAnimation: string | null;
  playerDistance: number;
  anchorDistance: number;
  lightExposure: number;
  fixedLightDistance: number;
  nearestFixedLight: Vector3 | null;
  attackSlotOwner: string | null;
  lastAttackResult: "none" | "hit" | "miss" | "repelled";
};

export type ShadowGrabberGameplayEvent =
  | "detect"
  | "alert"
  | "extend"
  | "grab"
  | "hold"
  | "retract"
  | "lightRecoil";

export type ShadowGrabberBehaviorOptions = {
  groupId: string;
  anchorPosition?: Vector3;
  coordinator: ShadowGrabberCoordinator;
  lightQuery: ShadowGrabberLightQuery;
  navigation: ShadowGrabberNavigation;
  applySanityDrain: (amount: number) => void;
  applyGrabPressure?: (
    source: Vector3,
    duration: number,
    movementMultiplier: number,
    pullSpeed: number
  ) => void;
  onSanityHit?: (intensity: number) => void;
  onEvent?: (id: string, event: ShadowGrabberGameplayEvent) => void;
};

function planarDistance(a: Vector3, b: Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function moveScalarToward(current: number, target: number, maxDelta: number) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function distancePointToSegment(point: Vector3, start: Vector3, end: Vector3) {
  const segment = end.subtractToRef(start, scratchSegment);
  const lengthSquared = segment.lengthSquared();
  if (lengthSquared <= 0.000001) return Vector3.Distance(point, end);
  const fromStart = point.subtractToRef(start, scratchFromStart);
  const t = clamp(Vector3.Dot(fromStart, segment) / lengthSquared, 0, 1);
  start.addToRef(segment.scaleToRef(t, scratchScaled), scratchClosest);
  return Vector3.Distance(point, scratchClosest);
}

const scratchSegment = Vector3.Zero();
const scratchFromStart = Vector3.Zero();
const scratchScaled = Vector3.Zero();
const scratchClosest = Vector3.Zero();
const RUNNING_AWARENESS_START_SPEED = 3.2;
const RUNNING_AWARENESS_FULL_SPEED = 6.8;

/** Autonomous state machine for one instance. It commands, but never inspects, asset nodes. */
export class ShadowGrabberBehavior {
  private readonly anchor: Vector3;
  private readonly tacticalTarget = Vector3.Zero();
  private readonly grabTarget = Vector3.Zero();
  private readonly velocity = Vector3.Zero();
  private readonly previousAttackPoint = Vector3.Zero();
  private readonly currentAttackPoint = Vector3.Zero();
  private readonly portalPosition = Vector3.Zero();
  private readonly firstCandidate = Vector3.Zero();
  private readonly secondCandidate = Vector3.Zero();
  private readonly bobPhase: number;
  private readonly flankSide: -1 | 1;
  private readonly hoverHeight: number;
  private readonly stableTacticalAngle: number;
  private readonly stableCooldownT: number;
  private stateValue = ShadowGrabberBehaviorState.Idle;
  private active = false;
  private stateElapsed = 0;
  private tacticalElapsed = 0;
  private attackCooldownRemaining = 0;
  private recoilCooldownRemaining = 0;
  private lightExposure = 0;
  private darknessExposureTime = 0;
  private playerInHardLight = false;
  private outOfTerritoryElapsed = 0;
  private attackReserved = false;
  private hitRegistered = false;
  private attackPointValid = false;
  private elapsed = 0;
  private targetSpeed = 0;
  private lastPlayerDistance = Number.POSITIVE_INFINITY;
  private lastFixedLightDistance = Number.POSITIVE_INFINITY;
  private readonly lastFixedLightPosition = Vector3.Zero();
  private hasFixedLightPosition = false;
  private lastAttackResult: ShadowGrabberBehaviorDebug["lastAttackResult"] = "none";

  public constructor(
    public readonly controller: ShadowGrabberController,
    private readonly options: ShadowGrabberBehaviorOptions
  ) {
    this.anchor = (options.anchorPosition ?? controller.getAnchorPosition()).clone();
    this.anchor.y = options.navigation.getGroundHeight(this.anchor.x, this.anchor.z);
    controller.setAnchorPosition(this.anchor);
    const hash = hashString(controller.id);
    this.bobPhase = ((hash & 0xffff) / 0xffff) * Math.PI * 2;
    this.flankSide = (hash & 1) === 0 ? -1 : 1;
    this.stableTacticalAngle = (((hash >>> 3) & 0xffff) / 0xffff) * Math.PI * 2;
    this.stableCooldownT = ((hash >>> 8) & 0xffff) / 0xffff;
    const hoverT = ((hash >>> 16) & 0xffff) / 0xffff;
    this.hoverHeight =
      controller.config.hoverHeightMin +
      (controller.config.hoverHeightMax - controller.config.hoverHeightMin) * hoverT;
    this.tacticalTarget.copyFrom(this.anchor);
    this.grabTarget.copyFrom(this.anchor);
    this.setPortalHeightAndPosition(this.anchor.x, this.anchor.z);
    options.coordinator.register(options.groupId, controller, {
      reassignmentIntervalIdle: controller.config.roleReassignmentIntervalIdle,
      reassignmentIntervalActive: controller.config.roleReassignmentIntervalActive,
      activityHysteresisSeconds: controller.config.roleActivityHysteresisSeconds,
      maxConcurrentAttacks: controller.config.maxConcurrentAttacks,
    });
  }

  public get state() {
    return this.stateValue;
  }

  public update(deltaTimeSeconds: number, target: ShadowGrabberTargetSnapshot) {
    const dt = clamp(deltaTimeSeconds, 0, 0.1);
    if (dt <= 0 || !this.controller.enabled) return;
    const config = this.controller.config;
    this.elapsed += dt;
    this.stateElapsed += dt;
    this.tacticalElapsed += dt;
    this.attackCooldownRemaining = Math.max(0, this.attackCooldownRemaining - dt);
    this.recoilCooldownRemaining = Math.max(0, this.recoilCooldownRemaining - dt);
    this.lastPlayerDistance = planarDistance(this.controller.root.position, target.position);

    this.updateDarknessPressure(dt, target);
    this.updateActivation(dt, target);
    this.updateLightResponse(dt, target);

    switch (this.stateValue) {
      case ShadowGrabberBehaviorState.Idle:
        this.updateIdleDrift(dt, target.sanity);
        if (this.active) this.transitionToRoleMovement();
        else if (planarDistance(this.controller.root.position, this.anchor) > config.anchorArrivalRadius) {
          this.transition(ShadowGrabberBehaviorState.ReturningToAnchor);
        }
        break;
      case ShadowGrabberBehaviorState.Stalking:
      case ShadowGrabberBehaviorState.Encircling:
        this.updateTacticalMovement(dt, target);
        this.controller.turnToward(target.groundPosition, config.turnSpeed * dt);
        this.tryBeginAttack(target);
        break;
      case ShadowGrabberBehaviorState.Telegraphing:
        this.decelerate(dt);
        if (this.stateElapsed <= config.telegraphDuration - config.aimLockLeadTime) {
          this.computeGrabTarget(target, this.grabTarget);
        }
        this.controller.turnToward(this.grabTarget, config.turnSpeed * dt);
        if (this.stateElapsed >= config.telegraphDuration) {
          this.computeGrabTarget(target, this.grabTarget);
          this.controller.turnToward(this.grabTarget, Math.PI);
          this.transition(ShadowGrabberBehaviorState.Attacking);
          this.attackPointValid = this.controller.getAttackPointWorldPositionToRef(
            this.previousAttackPoint
          );
        }
        break;
      case ShadowGrabberBehaviorState.Attacking:
        this.updateAttack(target);
        if (this.stateElapsed >= config.extendDuration && !this.hitRegistered) {
          this.lastAttackResult = "miss";
          this.transition(ShadowGrabberBehaviorState.Retracting);
        }
        break;
      case ShadowGrabberBehaviorState.Grabbing:
        this.options.applyGrabPressure?.(
          this.portalPosition,
          0.12,
          config.grabMovementMultiplier,
          config.grabPullSpeed
        );
        if (this.stateElapsed >= config.grabDuration) {
          this.transition(ShadowGrabberBehaviorState.Holding);
        }
        break;
      case ShadowGrabberBehaviorState.Holding:
        this.decelerate(dt);
        this.computeGrabTarget(target, this.grabTarget);
        this.options.applyGrabPressure?.(
          this.portalPosition,
          0.12,
          config.grabMovementMultiplier,
          config.grabPullSpeed
        );
        this.options.applySanityDrain(config.grabSanityDrainPerSecond * dt);
        if (
          this.playerInHardLight ||
          planarDistance(this.portalPosition, target.groundPosition) > config.grabBreakDistance ||
          this.stateElapsed >= config.maxHoldDuration
        ) {
          this.transition(ShadowGrabberBehaviorState.Retracting);
        }
        break;
      case ShadowGrabberBehaviorState.Retracting:
        if (this.stateElapsed >= config.retractDuration) {
          this.releaseAttackReservation(config.groupAttackCooldown);
          this.attackCooldownRemaining = this.computeNextAttackCooldown();
          if (this.active) this.transitionToRoleMovement();
          else this.transition(ShadowGrabberBehaviorState.ReturningToAnchor);
        }
        break;
      case ShadowGrabberBehaviorState.LightRepelled:
        this.moveAwayFrom(target.position, config.lightRetreatSpeed, dt);
        this.controller.turnToward(target.groundPosition, config.turnSpeed * dt);
        if (this.stateElapsed >= config.lightRecoilDuration) {
          if (this.active) this.transitionToRoleMovement();
          else this.transition(ShadowGrabberBehaviorState.ReturningToAnchor);
        }
        break;
      case ShadowGrabberBehaviorState.ReturningToAnchor:
        this.moveToward(this.anchor, config.idleSpeed, dt, target.sanity);
        this.controller.turnToward(this.anchor, config.turnSpeed * dt);
        if (planarDistance(this.controller.root.position, this.anchor) <= config.anchorArrivalRadius) {
          if (this.active) this.transitionToRoleMovement();
          else this.transition(ShadowGrabberBehaviorState.Idle);
        }
        break;
    }

    this.setPortalHeightAndPosition(this.controller.root.position.x, this.controller.root.position.z);
  }

  public getDebugSnapshot(): ShadowGrabberBehaviorDebug {
    return {
      id: this.controller.id,
      groupId: this.options.groupId,
      active: this.active,
      role: this.options.coordinator.getRole(this.options.groupId, this.controller.id),
      state: this.stateValue,
      stateElapsed: this.stateElapsed,
      anchor: this.anchor.clone(),
      tacticalTarget: this.tacticalTarget.clone(),
      grabTarget: this.grabTarget.clone(),
      portalPosition: this.portalPosition.clone(),
      attackPoint: this.attackPointValid ? this.currentAttackPoint.clone() : null,
      rootRotationY: this.controller.root.rotation.y,
      rootScale: this.controller.root.scaling.x,
      currentSpeed: Math.hypot(this.velocity.x, this.velocity.z),
      targetSpeed: this.targetSpeed,
      attackCooldownRemaining: this.attackCooldownRemaining,
      groupAttackCooldownRemaining: this.options.coordinator.getGroupAttackCooldown(
        this.options.groupId
      ),
      darknessPressure: this.getDarknessPressure(),
      playerInHardLight: this.playerInHardLight,
      currentAnimation: this.controller.getCurrentAnimation(),
      playerDistance: this.lastPlayerDistance,
      anchorDistance: planarDistance(this.controller.root.position, this.anchor),
      lightExposure: this.lightExposure,
      fixedLightDistance: this.lastFixedLightDistance,
      nearestFixedLight: this.hasFixedLightPosition
        ? this.lastFixedLightPosition.clone()
        : null,
      attackSlotOwner: this.options.coordinator.getAttackOwner(this.options.groupId),
      lastAttackResult: this.lastAttackResult,
    };
  }

  public dispose() {
    this.releaseAttackReservation();
    this.options.coordinator.unregister(this.options.groupId, this.controller.id);
  }

  private updateActivation(dt: number, target: ShadowGrabberTargetSnapshot) {
    const config = this.controller.config;
    const playerSpeed = Math.hypot(
      target.horizontalVelocity.x,
      target.horizontalVelocity.z
    );
    const runningAwareness = clamp(
      (playerSpeed - RUNNING_AWARENESS_START_SPEED) /
        (RUNNING_AWARENESS_FULL_SPEED - RUNNING_AWARENESS_START_SPEED),
      0,
      1
    );
    const activationRange =
      config.activationRange + config.runningDetectionBonus * runningAwareness;
    if (!this.active && this.lastPlayerDistance <= activationRange) {
      this.active = true;
      this.options.coordinator.setMemberActive(
        this.options.groupId,
        this.controller.id,
        true
      );
      this.options.onEvent?.(this.controller.id, "detect");
      // Hearing the player is a reflex: immediately present the hand instead
      // of spending the first approach seconds turning the orb toward them.
      this.controller.turnToward(target.groundPosition, Math.PI);
      if (this.stateValue === ShadowGrabberBehaviorState.Idle) this.transitionToRoleMovement();
    } else if (
      this.active &&
      this.lastPlayerDistance >=
        config.deactivationRange + (this.playerInHardLight ? config.softLightAvoidanceRadius : 0)
    ) {
      this.active = false;
      this.options.coordinator.setMemberActive(
        this.options.groupId,
        this.controller.id,
        false
      );
      if (!this.isCommittedToAttack()) {
        this.transition(ShadowGrabberBehaviorState.ReturningToAnchor);
      }
    }

    const anchorDistance = planarDistance(this.controller.root.position, this.anchor);
    if (anchorDistance > config.maxDistanceFromAnchor + 0.5) {
      this.outOfTerritoryElapsed += dt;
      if (
        this.outOfTerritoryElapsed >= config.returnToAnchorDelay &&
        !this.isCommittedToAttack()
      ) {
        this.transition(ShadowGrabberBehaviorState.ReturningToAnchor);
      }
    } else {
      this.outOfTerritoryElapsed = 0;
    }

    this.options.coordinator.setTarget(this.options.groupId, target.position);
  }

  private updateLightResponse(dt: number, target: ShadowGrabberTargetSnapshot) {
    if (!this.controller.getPortalCenterWorldPositionToRef(this.portalPosition)) {
      this.portalPosition.copyFrom(this.controller.root.position);
    }
    const config = this.controller.config;
    const flashlight = this.options.lightQuery.sampleFlashlight(
      this.portalPosition,
      config.flashlightRange,
      config.flashlightOuterAngle,
      target.sanity
    );
    if (flashlight > 0) this.lightExposure += flashlight * dt;
    else this.lightExposure = Math.max(0, this.lightExposure - config.flashlightExposureDecay * dt);

    if (
      this.active &&
      flashlight > 0.08 &&
      this.lightExposure >= config.flashlightExposureThreshold &&
      this.recoilCooldownRemaining <= 0 &&
      this.stateValue !== ShadowGrabberBehaviorState.LightRepelled
    ) {
      this.lightExposure = 0;
      this.recoilCooldownRemaining = config.lightRecoilCooldown;
      this.lastAttackResult = "repelled";
      this.releaseAttackReservation(config.groupAttackCooldown);
      this.attackCooldownRemaining = Math.max(
        this.attackCooldownRemaining,
        config.attackCooldownMin * 0.5
      );
      this.transition(ShadowGrabberBehaviorState.LightRepelled);
    }
  }

  private updateTacticalMovement(
    dt: number,
    target: ShadowGrabberTargetSnapshot
  ) {
    const config = this.controller.config;
    if (this.tacticalElapsed >= 1 / config.tacticalUpdateHz) {
      this.tacticalElapsed %= 1 / config.tacticalUpdateHz;
      this.computeTacticalTarget(target);
    }
    const role = this.options.coordinator.getRole(this.options.groupId, this.controller.id);
    const playerSpeed = Math.hypot(
      target.horizontalVelocity.x,
      target.horizontalVelocity.z
    );
    const pursuitSpeed =
      role === ShadowGrabberRole.Pressure || role === ShadowGrabberRole.Interceptor
        ? config.huntSpeed
        : config.encircleSpeed;
    const speed =
      role === ShadowGrabberRole.Pressure || role === ShadowGrabberRole.Interceptor
        ? Math.max(pursuitSpeed, Math.min(config.maxMoveSpeed, playerSpeed + 0.7))
        : pursuitSpeed;
    this.moveToward(
      this.tacticalTarget,
      speed * (1 + this.getDarknessPressure() * 0.03),
      dt,
      target.sanity
    );
  }

  private updateIdleDrift(dt: number, sanity: number) {
    const config = this.controller.config;
    const angle = this.bobPhase + this.elapsed * config.idlePatrolAngularSpeed;
    this.tacticalTarget.set(
      this.anchor.x + Math.cos(angle) * config.idlePatrolRadius,
      this.anchor.y,
      this.anchor.z + Math.sin(angle) * config.idlePatrolRadius
    );
    this.resolveBlockedTarget(this.tacticalTarget);
    this.moveToward(this.tacticalTarget, config.idleSpeed, dt, sanity, false);
    this.controller.turnToward(this.tacticalTarget, config.turnSpeed * 0.35 * dt);
  }

  private updateDarknessPressure(dt: number, target: ShadowGrabberTargetSnapshot) {
    const config = this.controller.config;
    const light = this.options.lightQuery.sampleFixed(
      target.groundPosition,
      config.hardLightAvoidanceRadius,
      config.softLightAvoidanceRadius
    );
    this.playerInHardLight = light.hardAvoidance;
    if (this.playerInHardLight) {
      const decayPerSecond =
        config.darknessPressureRampSeconds /
        Math.max(0.1, config.darknessPressureDecaySeconds);
      this.darknessExposureTime = Math.max(
        0,
        this.darknessExposureTime - decayPerSecond * dt
      );
    } else {
      this.darknessExposureTime = Math.min(
        config.darknessPressureRampSeconds,
        this.darknessExposureTime + dt
      );
    }
  }

  private getDarknessPressure() {
    return clamp(
      this.darknessExposureTime /
        Math.max(0.1, this.controller.config.darknessPressureRampSeconds),
      0,
      1
    );
  }

  private computeTacticalTarget(target: ShadowGrabberTargetSnapshot) {
    const config = this.controller.config;
    const role = this.options.coordinator.getRole(this.options.groupId, this.controller.id);
    const player = target.groundPosition;
    if (this.playerInHardLight) {
      this.chooseSafeLightPerimeterTarget(target, role);
    } else if (role === ShadowGrabberRole.Pressure) {
      let dx = player.x - this.controller.root.position.x;
      let dz = player.z - this.controller.root.position.z;
      const length = Math.hypot(dx, dz);
      if (length <= 0.001) {
        dx = Math.cos(this.stableTacticalAngle);
        dz = Math.sin(this.stableTacticalAngle);
      } else {
        dx /= length;
        dz /= length;
      }
      this.tacticalTarget.set(
        player.x - dx * config.pressureStandoffDistance,
        player.y,
        player.z - dz * config.pressureStandoffDistance
      );
    } else if (role === ShadowGrabberRole.Interceptor) {
      const playerSpeed = Math.hypot(
        target.horizontalVelocity.x,
        target.horizontalVelocity.z
      );
      const predictionT = clamp(playerSpeed / 2.8 + this.getDarknessPressure() * 0.2, 0, 1);
      const predictionSeconds =
        config.predictionTimeMin +
        (config.predictionTimeMax - config.predictionTimeMin) * predictionT;
      let leadX = target.horizontalVelocity.x * predictionSeconds;
      let leadZ = target.horizontalVelocity.z * predictionSeconds;
      const leadLength = Math.hypot(leadX, leadZ);
      if (leadLength > config.predictionMaxDistance) {
        const scale = config.predictionMaxDistance / leadLength;
        leadX *= scale;
        leadZ *= scale;
      }
      this.tacticalTarget.set(player.x + leadX, player.y, player.z + leadZ);
    } else if (role === ShadowGrabberRole.Flanker) {
      this.chooseFlankTarget(target);
    } else {
      this.chooseGatekeeperTarget(target);
    }
    if (!this.playerInHardLight) this.applyStableRoleOffset(role);
    this.tacticalTarget.y = this.options.navigation.getGroundHeight(
      this.tacticalTarget.x,
      this.tacticalTarget.z
    );
    this.clampToTerritory(this.tacticalTarget);
    this.avoidFixedLight(this.tacticalTarget);
    this.resolveBlockedTarget(this.tacticalTarget);
    this.avoidFixedLight(this.tacticalTarget);
  }

  private chooseFlankTarget(target: ShadowGrabberTargetSnapshot) {
    const velocity = target.horizontalVelocity;
    let forwardX = velocity.x;
    let forwardZ = velocity.z;
    const speed = Math.hypot(forwardX, forwardZ);
    if (speed < 0.08) {
      forwardX = target.position.x - this.controller.root.position.x;
      forwardZ = target.position.z - this.controller.root.position.z;
    }
    const length = Math.max(0.001, Math.hypot(forwardX, forwardZ));
    forwardX /= length;
    forwardZ /= length;
    const sideX = forwardZ * this.flankSide;
    const sideZ = -forwardX * this.flankSide;
    const config = this.controller.config;
    const pressure = this.getDarknessPressure();
    const lateralDistance = config.flankerLateralDistance * (1 + pressure * 0.14);
    const forwardDistance = config.flankerForwardDistance * (1 + pressure * 0.18);
    const first = this.firstCandidate.set(
      target.groundPosition.x + sideX * lateralDistance + forwardX * forwardDistance,
      target.groundPosition.y,
      target.groundPosition.z + sideZ * lateralDistance + forwardZ * forwardDistance
    );
    const second = this.secondCandidate.set(
      target.groundPosition.x - sideX * lateralDistance + forwardX * forwardDistance,
      target.groundPosition.y,
      target.groundPosition.z - sideZ * lateralDistance + forwardZ * forwardDistance
    );
    this.tacticalTarget.copyFrom(
      this.tacticalPenalty(first) <= this.tacticalPenalty(second) ? first : second
    );
  }

  private applyStableRoleOffset(role: ShadowGrabberRole) {
    const rolePhase =
      role === ShadowGrabberRole.Pressure
        ? 0
        : role === ShadowGrabberRole.Interceptor
          ? 1.7
          : role === ShadowGrabberRole.Flanker
            ? 3.4
            : 5.1;
    const radius = role === ShadowGrabberRole.Pressure ? 0.35 : 0.65;
    const angle = this.stableTacticalAngle + rolePhase;
    this.tacticalTarget.x += Math.cos(angle) * radius;
    this.tacticalTarget.z += Math.sin(angle) * radius;
  }

  private chooseSafeLightPerimeterTarget(
    target: ShadowGrabberTargetSnapshot,
    role: ShadowGrabberRole
  ) {
    const config = this.controller.config;
    const safeLight = this.options.lightQuery.getNearestSafeLight(target.groundPosition);
    if (!safeLight) {
      this.tacticalTarget.copyFrom(target.groundPosition);
      return;
    }
    let baseAngle = Math.atan2(
      this.anchor.z - safeLight.z,
      this.anchor.x - safeLight.x
    );
    const roleOffset =
      role === ShadowGrabberRole.Pressure
        ? 0
        : role === ShadowGrabberRole.Interceptor
          ? 0.58
          : role === ShadowGrabberRole.Flanker
            ? -0.58
            : 1.08 * this.flankSide;
    baseAngle += roleOffset + Math.sin(this.stableTacticalAngle) * 0.12;
    const radius = config.hardLightAvoidanceRadius + 0.9;
    this.tacticalTarget.set(
      safeLight.x + Math.cos(baseAngle) * radius,
      target.groundPosition.y,
      safeLight.z + Math.sin(baseAngle) * radius
    );
  }

  private chooseGatekeeperTarget(target: ShadowGrabberTargetSnapshot) {
    const safeLight = this.options.lightQuery.getNearestSafeLight(target.groundPosition);
    if (!safeLight) {
      this.tacticalTarget.copyFrom(target.groundPosition);
      return;
    }
    const dx = safeLight.x - target.position.x;
    const dz = safeLight.z - target.position.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const distanceTowardSafety = Math.min(6, Math.max(2.5, length * 0.35));
    this.tacticalTarget.set(
      target.position.x + (dx / length) * distanceTowardSafety,
      target.groundPosition.y,
      target.position.z + (dz / length) * distanceTowardSafety
    );
  }

  private tacticalPenalty(position: Vector3) {
    const config = this.controller.config;
    let penalty = this.options.navigation.isBlocked(position.x, position.z) ? 1000 : 0;
    const light = this.options.lightQuery.sampleFixed(
      position,
      config.hardLightAvoidanceRadius,
      config.softLightAvoidanceRadius
    );
    penalty += light.hardAvoidance ? 500 : light.softInfluence * 20;
    for (const neighbor of this.options.coordinator.getNeighbors(
      this.options.groupId,
      this.controller.id
    )) {
      penalty += Math.max(0, config.separationRadius - planarDistance(position, neighbor.root.position));
    }
    return penalty;
  }

  private avoidFixedLight(position: Vector3) {
    const config = this.controller.config;
    for (let attempt = 0; attempt < 4; attempt++) {
      const sample = this.options.lightQuery.sampleFixed(
        position,
        config.hardLightAvoidanceRadius,
        config.softLightAvoidanceRadius
      );
      this.lastFixedLightDistance = sample.distance;
      this.rememberFixedLight(sample.nearestPosition);
      if (!sample.hardAvoidance || !sample.nearestPosition) return;
      let dx = position.x - sample.nearestPosition.x;
      let dz = position.z - sample.nearestPosition.z;
      const length = Math.hypot(dx, dz);
      if (length <= 0.001) {
        dx = this.flankSide;
        dz = 0;
      }
      const scale =
        (config.hardLightAvoidanceRadius + 0.65) / Math.max(0.001, length);
      position.x = sample.nearestPosition.x + dx * scale;
      position.z = sample.nearestPosition.z + dz * scale;
      this.clampToTerritory(position);
    }
  }

  private resolveBlockedTarget(position: Vector3) {
    if (!this.options.navigation.isBlocked(position.x, position.z)) return;
    const origin = this.controller.root.position;
    const dx = position.x - origin.x;
    const dz = position.z - origin.z;
    for (const turn of [Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2]) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const x = origin.x + dx * c - dz * s;
      const z = origin.z + dx * s + dz * c;
      if (!this.options.navigation.isBlocked(x, z)) {
        position.x = x;
        position.z = z;
        return;
      }
    }
    position.copyFrom(origin);
  }

  private clampToTerritory(position: Vector3) {
    const maxDistance = this.controller.config.maxDistanceFromAnchor;
    const dx = position.x - this.anchor.x;
    const dz = position.z - this.anchor.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= maxDistance) return;
    position.x = this.anchor.x + (dx / distance) * maxDistance;
    position.z = this.anchor.z + (dz / distance) * maxDistance;
  }

  private tryBeginAttack(target: ShadowGrabberTargetSnapshot) {
    const config = this.controller.config;
    if (
      this.lastPlayerDistance > config.attackRange ||
      this.attackCooldownRemaining > 0 ||
      this.stateValue === ShadowGrabberBehaviorState.Telegraphing
    ) {
      return;
    }
    const fixedLight = this.options.lightQuery.sampleFixed(
      target.groundPosition,
      config.hardLightAvoidanceRadius,
      config.softLightAvoidanceRadius
    );
    if (fixedLight.hardAvoidance) return;
    if (!this.options.coordinator.tryReserveAttack(this.options.groupId, this.controller.id)) {
      return;
    }
    this.attackReserved = true;
    this.hitRegistered = false;
    this.attackPointValid = false;
    this.computeGrabTarget(target, this.grabTarget);
    this.transition(ShadowGrabberBehaviorState.Telegraphing);
  }

  private updateAttack(target: ShadowGrabberTargetSnapshot) {
    const config = this.controller.config;
    const normalizedTime = this.stateElapsed / Math.max(0.001, config.extendDuration);
    const inWindow =
      normalizedTime >= config.grabActiveWindowStart &&
      normalizedTime <= config.grabActiveWindowEnd;
    const hasPoint = this.controller.getAttackPointWorldPositionToRef(this.currentAttackPoint);
    if (inWindow && hasPoint && this.attackPointValid) {
      this.computeGrabTarget(target, this.grabTarget);
      if (
        distancePointToSegment(
          this.grabTarget,
          this.previousAttackPoint,
          this.currentAttackPoint
        ) <= config.grabHitRadius
      ) {
        this.hitRegistered = true;
        this.lastAttackResult = "hit";
        this.transition(ShadowGrabberBehaviorState.Grabbing);
        return;
      }
    }
    if (hasPoint) {
      this.previousAttackPoint.copyFrom(this.currentAttackPoint);
      this.attackPointValid = true;
    }
  }

  private computeGrabTarget(target: ShadowGrabberTargetSnapshot, result: Vector3) {
    result.copyFrom(target.groundPosition);
    result.y += target.collisionHeight * clamp(this.controller.config.legTargetHeightFactor, 0.2, 0.35);
    result.x += target.horizontalVelocity.x * this.controller.config.legTargetLeadTime;
    result.z += target.horizontalVelocity.z * this.controller.config.legTargetLeadTime;
    return result;
  }

  private computeNextAttackCooldown() {
    const config = this.controller.config;
    const base =
      config.attackCooldownMin +
      (config.attackCooldownMax - config.attackCooldownMin) * this.stableCooldownT;
    return Math.max(0.25, base * (1 - this.getDarknessPressure() * 0.28));
  }

  private moveAwayFrom(target: Vector3, speed: number, dt: number) {
    let dx = this.controller.root.position.x - target.x;
    let dz = this.controller.root.position.z - target.z;
    const length = Math.hypot(dx, dz);
    if (length <= 0.001) {
      dx = this.flankSide;
      dz = 0;
    }
    this.tacticalTarget.set(
      this.controller.root.position.x + (dx / Math.max(0.001, length)) * 5,
      0,
      this.controller.root.position.z + (dz / Math.max(0.001, length)) * 5
    );
    this.clampToTerritory(this.tacticalTarget);
    this.moveToward(this.tacticalTarget, speed, dt, 1, false);
  }

  private moveToward(
    target: Vector3,
    speed: number,
    dt: number,
    sanity: number,
    applyFlashlightSlow = true
  ) {
    const config = this.controller.config;
    let dx = target.x - this.controller.root.position.x;
    let dz = target.z - this.controller.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.025) {
      this.decelerate(dt);
      return;
    }
    dx /= distance;
    dz /= distance;

    let speedFactor = 1;
    const fixedLight = this.options.lightQuery.sampleFixed(
      this.controller.root.position,
      config.hardLightAvoidanceRadius,
      config.softLightAvoidanceRadius
    );
    this.lastFixedLightDistance = fixedLight.distance;
    this.rememberFixedLight(fixedLight.nearestPosition);
    speedFactor *= 1 - fixedLight.softInfluence * 0.42;
    if (applyFlashlightSlow) {
      const flashlight = this.options.lightQuery.sampleFlashlight(
        this.controller.root.position,
        config.flashlightRange,
        config.flashlightOuterAngle,
        sanity
      );
      speedFactor *= 1 - flashlight * (1 - config.flashlightSlowFactor);
    }

    let separationX = 0;
    let separationZ = 0;
    for (const neighbor of this.options.coordinator.getNeighbors(
      this.options.groupId,
      this.controller.id
    )) {
      const nx = this.controller.root.position.x - neighbor.root.position.x;
      const nz = this.controller.root.position.z - neighbor.root.position.z;
      const neighborDistance = Math.hypot(nx, nz);
      if (neighborDistance <= 0.001 || neighborDistance >= config.separationRadius) continue;
      const strength = (1 - neighborDistance / config.separationRadius) * config.separationStrength;
      separationX += (nx / neighborDistance) * strength;
      separationZ += (nz / neighborDistance) * strength;
    }
    dx += separationX;
    dz += separationZ;
    const combinedLength = Math.max(0.001, Math.hypot(dx, dz));
    dx /= combinedLength;
    dz /= combinedLength;

    const desiredSpeed = Math.min(config.maxMoveSpeed, speed) * speedFactor;
    this.targetSpeed = desiredSpeed;
    const acceleration = desiredSpeed > Math.hypot(this.velocity.x, this.velocity.z)
      ? config.acceleration
      : config.deceleration;
    this.velocity.x = moveScalarToward(this.velocity.x, dx * desiredSpeed, acceleration * dt);
    this.velocity.z = moveScalarToward(this.velocity.z, dz * desiredSpeed, acceleration * dt);
    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (currentSpeed > config.maxMoveSpeed) {
      this.velocity.x = (this.velocity.x / currentSpeed) * config.maxMoveSpeed;
      this.velocity.z = (this.velocity.z / currentSpeed) * config.maxMoveSpeed;
    }

    const movementSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const nextX = this.controller.root.position.x + this.velocity.x * dt;
    const nextZ = this.controller.root.position.z + this.velocity.z * dt;
    let resolvedX = nextX;
    let resolvedZ = nextZ;
    if (this.options.navigation.isBlocked(nextX, nextZ)) {
      const avoidance = this.findObstacleAvoidanceStep(dx, dz, movementSpeed * dt);
      if (avoidance) {
        resolvedX = avoidance.x;
        resolvedZ = avoidance.z;
      } else {
        resolvedX = this.controller.root.position.x;
        resolvedZ = this.controller.root.position.z;
        this.velocity.setAll(0);
      }
    }

    const nextLight = this.options.lightQuery.sampleFixed(
      this.firstCandidate.set(resolvedX, this.controller.root.position.y, resolvedZ),
      config.hardLightAvoidanceRadius,
      config.softLightAvoidanceRadius
    );
    if (nextLight.hardAvoidance && nextLight.nearestPosition) {
      const light = nextLight.nearestPosition;
      let normalX = this.controller.root.position.x - light.x;
      let normalZ = this.controller.root.position.z - light.z;
      const normalLength = Math.max(0.001, Math.hypot(normalX, normalZ));
      normalX /= normalLength;
      normalZ /= normalLength;
      let tangentX = -normalZ;
      let tangentZ = normalX;
      if (tangentX * dx + tangentZ * dz < 0) {
        tangentX = -tangentX;
        tangentZ = -tangentZ;
      }
      const step = movementSpeed * dt;
      const safeX = this.controller.root.position.x + (tangentX + normalX * 0.12) * step;
      const safeZ = this.controller.root.position.z + (tangentZ + normalZ * 0.12) * step;
      if (!this.options.navigation.isBlocked(safeX, safeZ)) {
        resolvedX = safeX;
        resolvedZ = safeZ;
        this.velocity.x = tangentX * movementSpeed;
        this.velocity.z = tangentZ * movementSpeed;
      } else {
        resolvedX = this.controller.root.position.x;
        resolvedZ = this.controller.root.position.z;
        this.velocity.setAll(0);
      }
    }
    this.controller.root.position.x = resolvedX;
    this.controller.root.position.z = resolvedZ;
  }

  private findObstacleAvoidanceStep(
    directionX: number,
    directionZ: number,
    movementStep: number
  ) {
    const config = this.controller.config;
    const baseProbeDistance = Math.max(config.obstacleProbeDistance, movementStep);
    for (let probeScale = 1; probeScale <= 3; probeScale++) {
      const probeDistance = baseProbeDistance * probeScale;
      for (let index = 1; index <= 3; index++) {
        const angleMagnitude = config.obstacleAvoidanceAngle * index;
        for (const side of [this.flankSide, -this.flankSide] as const) {
          const angle = angleMagnitude * side;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          const steeredX = directionX * cosine - directionZ * sine;
          const steeredZ = directionX * sine + directionZ * cosine;
          const probeX = this.controller.root.position.x + steeredX * probeDistance;
          const probeZ = this.controller.root.position.z + steeredZ * probeDistance;
          if (this.options.navigation.isBlocked(probeX, probeZ)) continue;
          const speed = Math.hypot(this.velocity.x, this.velocity.z);
          this.velocity.x = steeredX * speed;
          this.velocity.z = steeredZ * speed;
          return this.secondCandidate.set(
            this.controller.root.position.x + steeredX * movementStep,
            this.controller.root.position.y,
            this.controller.root.position.z + steeredZ * movementStep
          );
        }
      }
    }
    return null;
  }

  private decelerate(dt: number) {
    this.targetSpeed = 0;
    const deceleration = this.controller.config.deceleration * dt;
    this.velocity.x = moveScalarToward(this.velocity.x, 0, deceleration);
    this.velocity.z = moveScalarToward(this.velocity.z, 0, deceleration);
  }

  private setPortalHeightAndPosition(x: number, z: number) {
    const config = this.controller.config;
    const bob =
      Math.sin(this.elapsed * Math.PI * 2 * config.hoverBobFrequency + this.bobPhase) *
      config.hoverBobAmplitude;
    this.portalPosition.set(
      x,
      this.options.navigation.getGroundHeight(x, z) + this.hoverHeight + bob,
      z
    );
    this.controller.setPortalCenterWorldPosition(this.portalPosition);
  }

  private transitionToRoleMovement() {
    const role = this.options.coordinator.getRole(this.options.groupId, this.controller.id);
    this.transition(
      role === ShadowGrabberRole.Pressure || role === ShadowGrabberRole.Interceptor
        ? ShadowGrabberBehaviorState.Stalking
        : ShadowGrabberBehaviorState.Encircling
    );
  }

  private transition(next: ShadowGrabberBehaviorState) {
    if (this.stateValue === next) return;
    this.stateValue = next;
    this.stateElapsed = 0;
    switch (next) {
      case ShadowGrabberBehaviorState.Telegraphing:
        this.controller.setState(ShadowGrabberState.Alert);
        this.controller.setFxState("alert");
        this.options.onEvent?.(this.controller.id, "alert");
        break;
      case ShadowGrabberBehaviorState.Attacking:
        this.controller.setState(ShadowGrabberState.Extending);
        this.controller.setFxState("extend");
        this.options.onEvent?.(this.controller.id, "extend");
        break;
      case ShadowGrabberBehaviorState.Grabbing:
        this.controller.setState(ShadowGrabberState.Grabbing);
        this.controller.setFxState("grab");
        this.options.onSanityHit?.(1);
        this.options.onEvent?.(this.controller.id, "grab");
        break;
      case ShadowGrabberBehaviorState.Holding:
        this.controller.setState(ShadowGrabberState.Holding);
        this.controller.setFxState("hold");
        this.options.onEvent?.(this.controller.id, "hold");
        break;
      case ShadowGrabberBehaviorState.Retracting:
        this.controller.setState(ShadowGrabberState.Retracting);
        this.controller.setFxState("retract");
        this.options.onEvent?.(this.controller.id, "retract");
        break;
      case ShadowGrabberBehaviorState.LightRepelled:
        this.controller.setState(ShadowGrabberState.LightRecoil);
        this.controller.setFxState("lightRecoil");
        this.options.onEvent?.(this.controller.id, "lightRecoil");
        break;
      default:
        this.controller.setState(ShadowGrabberState.Idle);
        this.controller.setFxState(
          next === ShadowGrabberBehaviorState.Stalking ||
            next === ShadowGrabberBehaviorState.Encircling
            ? "hunt"
            : "idle"
        );
        break;
    }
  }

  private isCommittedToAttack() {
    return (
      this.stateValue === ShadowGrabberBehaviorState.Telegraphing ||
      this.stateValue === ShadowGrabberBehaviorState.Attacking ||
      this.stateValue === ShadowGrabberBehaviorState.Grabbing ||
      this.stateValue === ShadowGrabberBehaviorState.Holding ||
      this.stateValue === ShadowGrabberBehaviorState.Retracting
    );
  }

  private releaseAttackReservation(groupCooldownSeconds = 0) {
    if (!this.attackReserved) return;
    this.options.coordinator.releaseAttack(
      this.options.groupId,
      this.controller.id,
      groupCooldownSeconds
    );
    this.attackReserved = false;
  }

  private rememberFixedLight(position: Vector3 | null) {
    this.hasFixedLightPosition = position !== null;
    if (position) this.lastFixedLightPosition.copyFrom(position);
  }
}
