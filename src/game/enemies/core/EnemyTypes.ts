import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";

export type EnemyId = string;
export type EnemyType = string;

export enum EnemyLifecycleState {
  Initializing = "initializing",
  Ready = "ready",
  Disabled = "disabled",
  Disposed = "disposed",
}

export interface EnemySpawnOptions {
  id?: EnemyId;
  type: EnemyType;
  position: Vector3;
  rotation?: Vector3;
  scaling?: Vector3;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface EnemyAssetInstance {
  rootNodes: Node[];
  nodes: Node[];
  meshes: AbstractMesh[];
  skeletons: Skeleton[];
  animationGroups: AnimationGroup[];
  materials: Material[];
}

export interface EnemyControllerContext {
  scene: Scene;
  asset: EnemyAssetInstance;
}

export interface EnemyController {
  readonly id: EnemyId;
  readonly type: EnemyType;
  readonly root: TransformNode;
  readonly enabled: boolean;
  readonly lifecycleState: EnemyLifecycleState;

  initialize(): Promise<void>;
  update(deltaTimeSeconds: number): void;
  setEnabled(enabled: boolean): void;
  setPosition(position: Vector3): void;
  setRotation(rotation: Vector3): void;
  setScaling(scaling: Vector3): void;
  dispose(): void;
}

export type EnemyControllerFactory = (
  context: EnemyControllerContext,
  options: EnemySpawnOptions
) => EnemyController;

export interface EnemyTypeRegistration {
  type: EnemyType;
  assetUrl: string;
  create: EnemyControllerFactory;
}
