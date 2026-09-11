import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import {
  ShadowGrabberBehavior,
  type ShadowGrabberBehaviorDebug,
  type ShadowGrabberGameplayEvent,
  type ShadowGrabberNavigation,
  type ShadowGrabberTargetSnapshot,
} from "./ShadowGrabberBehavior";
import { ShadowGrabberCoordinator } from "./ShadowGrabberCoordinator";
import type { ShadowGrabberController } from "./ShadowGrabberController";
import { ShadowGrabberLightQuery } from "./ShadowGrabberLightQuery";
import type { FlashlightGameplayState } from "./ShadowGrabberLightQuery";
import { ShadowGrabberDebugView } from "./ShadowGrabberDebugView";

export type ShadowGrabberPlayerSource = {
  getPosition: () => Vector3;
  getGroundPositionToRef: (result: Vector3) => Vector3;
  getCollisionHeight: () => number;
  getSanity: () => number;
  applySanityDrain: (amount: number, sourceId: string) => void;
  applyGrabPressure?: (
    source: Vector3,
    duration: number,
    movementMultiplier: number,
    pullSpeed: number
  ) => void;
  onSanityHit?: (intensity: number) => void;
};

export type ShadowGrabberBehaviorSystemOptions = {
  player: ShadowGrabberPlayerSource;
  navigation: ShadowGrabberNavigation;
  fixedSafeLightPositions: readonly Vector3[];
  getFlashlight: () => FlashlightGameplayState;
  onEvent?: (id: string, event: ShadowGrabberGameplayEvent) => void;
  debug?: {
    enabled: boolean;
    scene: Scene;
  };
};

/** Central update point: one player velocity sample and one shared gameplay light query. */
export class ShadowGrabberBehaviorSystem {
  private readonly coordinator: ShadowGrabberCoordinator;
  private readonly lightQuery: ShadowGrabberLightQuery;
  private readonly behaviors = new Map<string, ShadowGrabberBehavior>();
  private readonly debugViews = new Map<string, ShadowGrabberDebugView>();
  private readonly previousPlayerPosition = Vector3.Zero();
  private readonly groundPosition = Vector3.Zero();
  private readonly horizontalVelocity = Vector3.Zero();
  private readonly targetSnapshot: ShadowGrabberTargetSnapshot = {
    position: Vector3.Zero(),
    groundPosition: Vector3.Zero(),
    horizontalVelocity: Vector3.Zero(),
    collisionHeight: 1.7,
    sanity: 1,
  };
  private playerSampleInitialized = false;
  private debugElapsed = 0;
  private disposed = false;

  public constructor(private readonly options: ShadowGrabberBehaviorSystemOptions) {
    this.coordinator = new ShadowGrabberCoordinator();
    this.lightQuery = new ShadowGrabberLightQuery(
      options.fixedSafeLightPositions,
      options.getFlashlight
    );
  }

  public add(
    controller: ShadowGrabberController,
    groupId: string,
    anchorPosition?: Vector3
  ) {
    if (this.disposed) throw new Error("ShadowGrabberBehaviorSystem is disposed");
    if (this.behaviors.has(controller.id)) {
      throw new Error(`Shadow Grabber behavior already exists: ${controller.id}`);
    }
    const behavior = new ShadowGrabberBehavior(controller, {
      groupId,
      anchorPosition,
      coordinator: this.coordinator,
      lightQuery: this.lightQuery,
      navigation: this.options.navigation,
      applySanityDrain: (amount) =>
        this.options.player.applySanityDrain(amount, controller.id),
      applyGrabPressure: this.options.player.applyGrabPressure,
      onSanityHit: this.options.player.onSanityHit,
      onEvent: this.options.onEvent,
    });
    this.behaviors.set(controller.id, behavior);
    if (this.options.debug?.enabled) {
      this.debugViews.set(
        controller.id,
        new ShadowGrabberDebugView(this.options.debug.scene, controller)
      );
    }
    return behavior;
  }

  public update(deltaTimeSeconds: number) {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(deltaTimeSeconds, 0.1));
    if (dt <= 0) return;
    this.updatePlayerSnapshot(dt);
    this.lightQuery.updateFlashlightState();
    this.coordinator.update(dt);
    for (const behavior of this.behaviors.values()) {
      behavior.update(dt, this.targetSnapshot);
    }
    if (this.debugViews.size > 0) {
      this.debugElapsed += dt;
      if (this.debugElapsed >= 0.1) {
        this.debugElapsed %= 0.1;
        for (const [id, behavior] of this.behaviors) {
          this.debugViews.get(id)?.update(behavior.getDebugSnapshot());
        }
      }
    }
  }

  public getDebugSnapshots(): ShadowGrabberBehaviorDebug[] {
    return [...this.behaviors.values()].map((behavior) => behavior.getDebugSnapshot());
  }

  public setFxEnabled(enabled: boolean) {
    for (const behavior of this.behaviors.values()) {
      behavior.controller.setFxEnabled(enabled);
    }
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const behavior of this.behaviors.values()) behavior.dispose();
    this.behaviors.clear();
    for (const debugView of this.debugViews.values()) debugView.dispose();
    this.debugViews.clear();
  }

  private updatePlayerSnapshot(dt: number) {
    const playerPosition = this.options.player.getPosition();
    this.options.player.getGroundPositionToRef(this.groundPosition);
    if (!this.playerSampleInitialized) {
      this.previousPlayerPosition.copyFrom(playerPosition);
      this.horizontalVelocity.setAll(0);
      this.playerSampleInitialized = true;
    } else {
      const rawX = (playerPosition.x - this.previousPlayerPosition.x) / dt;
      const rawZ = (playerPosition.z - this.previousPlayerPosition.z) / dt;
      const rawLength = Math.hypot(rawX, rawZ);
      const maxTrackedSpeed = 9;
      const scale = rawLength > maxTrackedSpeed ? maxTrackedSpeed / rawLength : 1;
      this.horizontalVelocity.x += (rawX * scale - this.horizontalVelocity.x) * 0.35;
      this.horizontalVelocity.z += (rawZ * scale - this.horizontalVelocity.z) * 0.35;
      this.previousPlayerPosition.copyFrom(playerPosition);
    }
    this.targetSnapshot.position.copyFrom(playerPosition);
    this.targetSnapshot.groundPosition.copyFrom(this.groundPosition);
    this.targetSnapshot.horizontalVelocity.copyFrom(this.horizontalVelocity);
    this.targetSnapshot.collisionHeight = Math.max(0.1, this.options.player.getCollisionHeight());
    this.targetSnapshot.sanity = Math.max(0, Math.min(1, this.options.player.getSanity()));
  }
}
