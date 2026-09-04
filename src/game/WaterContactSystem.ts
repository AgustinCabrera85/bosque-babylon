import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  WATER_CONTACT_EFFECTS_CONFIG,
  type WaterContactEffectsConfig,
} from "./WaterContactEffectsConfig";
import type { WaterInteractionVFX } from "./WaterInteractionVFX";
import {
  getWaterLevelAt,
  isPointInsideWaterSurface,
  type WaterSurfaceInfo,
  type WaterSurfaceRegistry,
} from "./WaterSurface";

export type WaterContactState =
  | "dry"
  | "enteringWater"
  | "inShallowWater"
  | "movingInWater"
  | "treadingWater"
  | "exitingWater"
  | "swimming";

export type WaterContactMotionMode = "grounded" | "treadingWater" | "swimming";

export type WaterContactEventType = "enter" | "step" | "exit";

export type WaterContactEvent = {
  type: WaterContactEventType;
  surface: WaterSurfaceInfo;
  position: Vector3;
  velocity: Vector3;
  strength: number;
};

export type WaterContactSystemOptions = {
  getContactPosition: (result: Vector3) => Vector3;
  getMotionMode?: () => WaterContactMotionMode;
  config?: WaterContactEffectsConfig;
  onContactEvent?: (event: WaterContactEvent) => void;
};

export type WaterContactDebugSnapshot = {
  state: WaterContactState;
  inWater: boolean;
  surfaceId: string | null;
  waterDepth: number;
  horizontalSpeed: number;
  distanceSinceSplash: number;
  distanceSinceRipple: number;
  activeRipples: number;
  ripplePoolSize: number;
  activeSplashSystems: number;
  splashPoolSize: number;
  totalRipplesSpawned: number;
  totalSplashesSpawned: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

export class WaterContactSystem {
  private readonly config: WaterContactEffectsConfig;
  private readonly contactPosition = Vector3.Zero();
  private readonly previousPosition = Vector3.Zero();
  private readonly velocity = Vector3.Zero();
  private readonly movementDirection = Vector3.Zero();
  private readonly surfaceContactPoint = Vector3.Zero();
  private readonly lastValidSurfacePoint = Vector3.Zero();
  private hasPreviousPosition = false;
  private hasLastValidSurfacePoint = false;
  private activeSurface: WaterSurfaceInfo | null = null;
  private stateValue: WaterContactState = "dry";
  private depthValue = 0;
  private horizontalSpeedValue = 0;
  private distanceSinceSplash = 0;
  private distanceSinceRipple = 0;
  private disposed = false;

  constructor(
    private readonly surfaces: WaterSurfaceRegistry,
    private readonly effects: WaterInteractionVFX,
    private readonly options: WaterContactSystemOptions
  ) {
    this.config = options.config ?? WATER_CONTACT_EFFECTS_CONFIG;
  }

  get state() {
    return this.stateValue;
  }

  get currentWaterDepth() {
    return this.depthValue;
  }

  get currentSurface() {
    return this.activeSurface;
  }

  update(deltaTime: number) {
    if (this.disposed) return;
    const dt = Math.max(0.0001, Math.min(deltaTime, 0.05));
    const position = this.options.getContactPosition(this.contactPosition);

    let horizontalDistance = 0;
    if (this.hasPreviousPosition) {
      const dx = position.x - this.previousPosition.x;
      const dz = position.z - this.previousPosition.z;
      horizontalDistance = Math.hypot(dx, dz);
      this.horizontalSpeedValue = horizontalDistance / dt;
      this.velocity.set(dx / dt, (position.y - this.previousPosition.y) / dt, dz / dt);
      if (horizontalDistance > 0.0001) {
        this.movementDirection.set(dx / horizontalDistance, 0, dz / horizontalDistance);
      } else {
        this.movementDirection.set(0, 0, 0);
      }
    } else {
      this.hasPreviousPosition = true;
      this.horizontalSpeedValue = 0;
      this.velocity.set(0, 0, 0);
      this.movementDirection.set(0, 0, 0);
    }

    if (this.activeSurface) {
      const level = getWaterLevelAt(this.activeSurface, position);
      const remainsInside = isPointInsideWaterSurface(
        this.activeSurface,
        position,
        this.config.detection.exitHorizontalMargin
      );
      const remainsAtSurface =
        position.y <= level + this.config.detection.exitHeightTolerance;
      if (!remainsInside || !remainsAtSurface) {
        this.exitWater(this.activeSurface);
        this.previousPosition.copyFrom(position);
        return;
      }
    } else {
      const surface = this.surfaces.getWaterSurfaceAt(position);
      if (surface) {
        const level = getWaterLevelAt(surface, position);
        if (position.y <= level + this.config.detection.enterHeightTolerance) {
          this.enterWater(surface, position, level);
          this.previousPosition.copyFrom(position);
          return;
        }
      }

      this.stateValue = "dry";
      this.depthValue = 0;
      this.horizontalSpeedValue = this.hasPreviousPosition ? this.horizontalSpeedValue : 0;
      this.previousPosition.copyFrom(position);
      return;
    }

    const surface = this.activeSurface;
    if (!surface) {
      this.previousPosition.copyFrom(position);
      return;
    }

    const waterLevel = getWaterLevelAt(surface, position);
    this.depthValue = Math.max(0, waterLevel - position.y);
    this.surfaceContactPoint.set(position.x, waterLevel, position.z);
    this.lastValidSurfacePoint.copyFrom(this.surfaceContactPoint);
    this.hasLastValidSurfacePoint = true;

    const motionMode = this.options.getMotionMode?.() ?? "grounded";
    if (motionMode === "swimming") {
      this.stateValue = "swimming";
      if (this.horizontalSpeedValue >= this.config.movement.minSpeedForEffects) {
        this.updateMovementEffects(
          horizontalDistance,
          this.config.movement.swimmingStrengthScale
        );
      }
      this.previousPosition.copyFrom(position);
      return;
    }
    if (motionMode === "treadingWater") {
      this.stateValue = "treadingWater";
      if (this.horizontalSpeedValue >= this.config.movement.minSpeedForEffects) {
        this.updateMovementEffects(
          horizontalDistance,
          this.config.movement.treadingStrengthScale
        );
      }
      this.previousPosition.copyFrom(position);
      return;
    }

    const moving = this.horizontalSpeedValue >= this.config.movement.minSpeedForEffects;
    this.stateValue = moving ? "movingInWater" : "inShallowWater";
    if (moving && this.depthValue <= this.config.movement.maxDepthForStepEffects) {
      this.updateMovementEffects(horizontalDistance);
    }

    this.previousPosition.copyFrom(position);
  }

  getDebugSnapshot(): WaterContactDebugSnapshot {
    const vfx = this.effects.getDebugSnapshot();
    return {
      state: this.stateValue,
      inWater: this.activeSurface !== null,
      surfaceId: this.activeSurface?.id ?? null,
      waterDepth: this.depthValue,
      horizontalSpeed: this.horizontalSpeedValue,
      distanceSinceSplash: this.distanceSinceSplash,
      distanceSinceRipple: this.distanceSinceRipple,
      ...vfx,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.activeSurface = null;
    this.stateValue = "dry";
    this.depthValue = 0;
  }

  private enterWater(surface: WaterSurfaceInfo, position: Vector3, waterLevel: number) {
    this.activeSurface = surface;
    this.stateValue = "enteringWater";
    this.depthValue = Math.max(0, waterLevel - position.y);
    this.distanceSinceSplash = 0;
    this.distanceSinceRipple = 0;
    this.surfaceContactPoint.set(position.x, waterLevel, position.z);
    this.lastValidSurfacePoint.copyFrom(this.surfaceContactPoint);
    this.hasLastValidSurfacePoint = true;

    const speedFactor = this.getSpeedFactor();
    const rippleStrength = clamp01(
      this.config.entry.rippleStrength * lerp(0.72, 1.16, speedFactor)
    );
    this.effects.spawnRipple({
      position: this.surfaceContactPoint,
      strength: rippleStrength,
      duration: this.config.ripple.entryDuration,
      startRadius: this.config.ripple.entryStartRadius,
      endRadius: this.config.ripple.entryEndRadius,
      alpha: this.config.ripple.entryAlpha,
    });
    this.effects.spawnRipple({
      position: this.surfaceContactPoint,
      strength: this.config.entry.secondaryRippleStrength,
      duration: this.config.ripple.entryDuration * 0.84,
      startRadius: this.config.ripple.entryStartRadius * 1.75,
      endRadius: this.config.ripple.entryEndRadius * 0.72,
      alpha: this.config.ripple.entryAlpha * 0.58,
    });

    const splashStrength = clamp01(
      this.config.entry.splashStrength * lerp(0.58, 1.18, speedFactor)
    );
    this.effects.spawnEntrySplash({
      position: this.surfaceContactPoint,
      velocity: this.velocity,
      strength: splashStrength,
    });
    this.emitContactEvent("enter", surface, this.surfaceContactPoint, splashStrength);
  }

  private exitWater(surface: WaterSurfaceInfo) {
    this.stateValue = "exitingWater";
    this.depthValue = 0;
    this.distanceSinceSplash = 0;
    this.distanceSinceRipple = 0;
    const position = this.hasLastValidSurfacePoint
      ? this.lastValidSurfacePoint
      : this.surfaceContactPoint;
    this.effects.spawnRipple({
      position,
      strength: this.config.exit.rippleStrength,
      duration: this.config.ripple.exitDuration,
      startRadius: this.config.ripple.exitStartRadius,
      endRadius: this.config.ripple.exitEndRadius,
      alpha: this.config.ripple.exitAlpha,
    });
    this.emitContactEvent("exit", surface, position, this.config.exit.rippleStrength);
    this.activeSurface = null;
  }

  private updateMovementEffects(horizontalDistance: number, strengthScale = 1) {
    this.distanceSinceSplash += horizontalDistance;
    this.distanceSinceRipple += horizontalDistance;
    const speedFactor = this.getSpeedFactor();
    const depthFactor = clamp01(
      this.depthValue / Math.max(0.001, this.config.movement.maxDepthForStepEffects)
    );
    const strength = lerp(
      this.config.movement.minimumStrength,
      this.config.movement.maximumStrength,
      speedFactor
    ) * lerp(0.82, 1, depthFactor) * strengthScale;

    if (this.distanceSinceRipple >= this.config.movement.rippleStepDistance) {
      this.distanceSinceRipple -= this.config.movement.rippleStepDistance;
      this.effects.spawnRipple({
        position: this.surfaceContactPoint,
        strength,
        duration: this.config.ripple.movementDuration,
        startRadius: this.config.ripple.movementStartRadius,
        endRadius: this.config.ripple.movementEndRadius,
        alpha: this.config.ripple.movementAlpha,
      });
    }

    if (this.distanceSinceSplash >= this.config.movement.splashStepDistance) {
      this.distanceSinceSplash -= this.config.movement.splashStepDistance;
      this.effects.spawnStepSplash({
        position: this.surfaceContactPoint,
        direction: this.movementDirection,
        velocity: this.velocity,
        strength,
      });
      if (this.activeSurface) {
        this.emitContactEvent("step", this.activeSurface, this.surfaceContactPoint, strength);
      }
    }
  }

  private getSpeedFactor() {
    const range = Math.max(0.001, this.config.speed.maximum - this.config.speed.minimum);
    return clamp01((this.horizontalSpeedValue - this.config.speed.minimum) / range);
  }

  private emitContactEvent(
    type: WaterContactEventType,
    surface: WaterSurfaceInfo,
    position: Vector3,
    strength: number
  ) {
    this.options.onContactEvent?.({
      type,
      surface,
      position: position.clone(),
      velocity: this.velocity.clone(),
      strength,
    });
  }
}
