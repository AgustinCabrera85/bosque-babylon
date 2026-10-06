import "@babylonjs/loaders/glTF";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { STAIR_CONFIG } from "./Staircase";
import { THEATRE_CURTAIN_LAYOUT } from "./TheatreCurtains";

const MASK_ROOT_URL = "/assets/models/masks/";
const MASK_FILES = [
  "rostro_1_escalera.glb",
  "rostro_2_escalera.glb",
  "rostro_3_escalera.glb",
  "rostro_4_escalera.glb",
  "rostro_5_escalera_evil1.glb",
] as const;

type MaskInstance = {
  root: TransformNode;
  baseY: number;
  basePitch: number;
  phase: number;
  homeTarget: Vector3;
};

type MaskPlacement = {
  name: string;
  modelIndex: number;
  position: Vector3;
  scale: number;
  roll: number;
  phase: number;
  targetYOffset: number;
  targetZOffset: number;
};

const STAGE_VIEW_Z = -10.5;
const CURTAIN_SIGHTLINE_GAP = 0.28;
const STAIR_SIDE_GAP = 0.42;
const MAX_MASK_ABS_X = 18.5;
const MASK_SEPARATION_GAP = 0.38;

function getMaskHorizontalRadius(scale: number) {
  return scale * 0.43 + 0.16;
}

function getStairHalfWidth(z: number) {
  const stairLength = STAIR_CONFIG.stepCount * STAIR_CONFIG.stepDepth;
  const t = Math.max(
    0,
    Math.min(1, (z - STAIR_CONFIG.startZ) / Math.max(0.001, stairLength))
  );
  return (
    (STAIR_CONFIG.baseWidth +
      (STAIR_CONFIG.topWidth - STAIR_CONFIG.baseWidth) * t) *
    0.5
  );
}

function separateFromCurtainSightline(placement: MaskPlacement) {
  const curtainDistance = THEATRE_CURTAIN_LAYOUT.z - STAGE_VIEW_Z;
  const maskDistance = placement.position.z - STAGE_VIEW_Z;
  if (maskDistance <= curtainDistance) return placement;

  const projectionScale = curtainDistance / maskDistance;
  const projectedCenter = Math.abs(placement.position.x) * projectionScale;
  const projectedRadius =
    getMaskHorizontalRadius(placement.scale) * projectionScale;
  const curtainInner =
    THEATRE_CURTAIN_LAYOUT.centerAbsX -
    THEATRE_CURTAIN_LAYOUT.width * 0.5;
  const curtainOuter =
    THEATRE_CURTAIN_LAYOUT.centerAbsX +
    THEATRE_CURTAIN_LAYOUT.width * 0.5;
  const projectedMin = projectedCenter - projectedRadius;
  const projectedMax = projectedCenter + projectedRadius;
  if (
    projectedMax <= curtainInner - CURTAIN_SIGHTLINE_GAP ||
    projectedMin >= curtainOuter + CURTAIN_SIGHTLINE_GAP
  ) {
    return placement;
  }

  const maskRadius = getMaskHorizontalRadius(placement.scale);
  const minimumStairSideX =
    getStairHalfWidth(placement.position.z) + maskRadius + STAIR_SIDE_GAP;
  const inwardX =
    (curtainInner - CURTAIN_SIGHTLINE_GAP - projectedRadius) /
    projectionScale;
  const outwardX =
    (curtainOuter + CURTAIN_SIGHTLINE_GAP + projectedRadius) /
    projectionScale;
  const choices: number[] = [];
  if (inwardX >= minimumStairSideX) choices.push(inwardX);
  if (outwardX <= MAX_MASK_ABS_X) choices.push(outwardX);
  if (choices.length === 0) return null;

  const currentX = Math.abs(placement.position.x);
  const resolvedX = choices.reduce((best, candidate) =>
    Math.abs(candidate - currentX) < Math.abs(best - currentX)
      ? candidate
      : best
  );
  const side = placement.position.x < 0 ? -1 : 1;
  return {
    ...placement,
    position: new Vector3(
      side * resolvedX,
      placement.position.y,
      placement.position.z
    ),
  };
}

function placementsOverlap(a: MaskPlacement, b: MaskPlacement) {
  const deltaX = a.position.x - b.position.x;
  const deltaY =
    a.position.y + a.scale * 0.5 - (b.position.y + b.scale * 0.5);
  const deltaZ = a.position.z - b.position.z;
  const combinedX =
    getMaskHorizontalRadius(a.scale) +
    getMaskHorizontalRadius(b.scale) +
    MASK_SEPARATION_GAP;
  const combinedY =
    (a.scale + b.scale) * 0.55 + MASK_SEPARATION_GAP;
  const combinedZ =
    (a.scale + b.scale) * 0.43 + MASK_SEPARATION_GAP;
  return (
    (deltaX * deltaX) / (combinedX * combinedX) +
      (deltaY * deltaY) / (combinedY * combinedY) +
      (deltaZ * deltaZ) / (combinedZ * combinedZ) <
    1
  );
}

function resolvePlacement(
  placement: MaskPlacement,
  accepted: readonly MaskPlacement[]
) {
  const side = placement.position.x < 0 ? -1 : 1;
  const trials = [
    { outward: 0, y: 0, z: 0 },
    { outward: 0.7, y: 0.65, z: 0 },
    { outward: 1.25, y: 0, z: 0.9 },
    { outward: 0.45, y: 1.25, z: -0.7 },
    { outward: 1.85, y: 0.8, z: 1.25 },
    { outward: 1.1, y: 1.75, z: -1.1 },
  ] as const;

  for (const trial of trials) {
    const candidate = separateFromCurtainSightline({
      ...placement,
      position: new Vector3(
        placement.position.x + side * trial.outward,
        placement.position.y + trial.y,
        placement.position.z + trial.z
      ),
    });
    if (!candidate) continue;
    if (!accepted.some((other) => placementsOverlap(candidate, other))) {
      return candidate;
    }
  }
  return null;
}

export type MaskFieldHandle = {
  root: TransformNode;
  setFollowPlayer(follow: boolean): void;
  setMotionAmount(value: number): void;
  update(dt: number, playerPosition: Vector3): void;
  dispose(): void;
};

async function loadMaskContainers(scene: Scene) {
  const containers: AssetContainer[] = [];
  try {
    for (const fileName of MASK_FILES) {
      containers.push(
        await SceneLoader.LoadAssetContainerAsync(MASK_ROOT_URL, fileName, scene)
      );
    }
    return containers;
  } catch (error) {
    for (const container of containers) container.dispose();
    throw error;
  }
}

function instantiateMask(
  scene: Scene,
  container: AssetContainer,
  parent: TransformNode,
  name: string,
  position: Vector3,
  scale: number,
  target: Vector3,
  roll: number
) {
  const instance = container.instantiateModelsToScene(
    (sourceName: string) => `${name}_${sourceName}`,
    false
  );
  const wrapper = new TransformNode(name, scene);
  wrapper.parent = parent;
  wrapper.position.copyFrom(position);
  wrapper.scaling.setAll(scale);
  for (const node of instance.rootNodes) node.parent = wrapper;
  wrapper.lookAt(target);
  wrapper.rotation.z += roll;
  return wrapper;
}

export async function createMaskField(
  scene: Scene,
  getStairHeight: (z: number) => number
): Promise<MaskFieldHandle> {
  const root = new TransformNode("maskField", scene);
  const containers = await loadMaskContainers(scene);
  const instances: MaskInstance[] = [];
  let followPlayer = false;
  let motionAmount = 1;
  let time = 0;
  let disposed = false;
  const rows = 22;
  const modelPattern = [0, 1, 2, 3, 4, 1, 3, 0, 4, 2] as const;
  const regularPlacements: MaskPlacement[] = [];

  for (let i = 0; i < rows; i += 1) {
    const t = i / Math.max(1, rows - 1);
    const z = 5 + t * 101;
    const y = getStairHeight(z) + 2.3 + (i % 4) * 1.55;
    for (const side of [-1, 1] as const) {
      const modelIndex = modelPattern[(i * 2 + (side > 0 ? 1 : 0)) % modelPattern.length];
      const position = new Vector3(
        side * (8.6 + (i % 3) * 1.7 + t * 1.2),
        y + (side > 0 ? 0.25 : -0.1),
        z + (side > 0 ? 0.7 : -0.4)
      );
      const variation = 0.92 + (i % 5) * 0.1 + (1 - t) * 0.2;
      regularPlacements.push({
        name: `mask_${i}_${side < 0 ? "L" : "R"}`,
        modelIndex,
        position,
        scale: 2.55 * variation,
        roll: side * (0.025 + (i % 4) * 0.016),
        phase: i * 0.61 + (side > 0 ? 1.7 : 0),
        targetYOffset: 1.3,
        targetZOffset: 2,
      });
    }
  }

  const heroPositions = [
    { x: -12.2, y: 5.4, z: 8.5, model: 0, scale: 4.6 },
    { x: 12, y: 5.6, z: 10, model: 1, scale: 4.5 },
    { x: -11.4, y: 11, z: 28, model: 2, scale: 3.8 },
    { x: 11.7, y: 12.4, z: 31, model: 0, scale: 4 },
    { x: -13.4, y: 18.4, z: 51, model: 1, scale: 4.1 },
    { x: 13, y: 20, z: 58, model: 2, scale: 4.3 },
  ] as const;

  const heroPlacements: MaskPlacement[] = heroPositions.map((position, i) => ({
    name: `heroMask_${i}`,
    modelIndex: position.model,
    position: new Vector3(position.x, position.y, position.z),
    scale: position.scale,
    roll: (position.x < 0 ? -1 : 1) * 0.035,
    phase: 4 + i,
    targetYOffset: 1.4,
    targetZOffset: 0,
  }));
  const acceptedPlacements: MaskPlacement[] = [];

  for (const placement of [...heroPlacements, ...regularPlacements]) {
    const resolved = resolvePlacement(placement, acceptedPlacements);
    if (resolved) acceptedPlacements.push(resolved);
  }

  for (const placement of acceptedPlacements) {
    const target = new Vector3(
      0,
      getStairHeight(placement.position.z) + placement.targetYOffset,
      placement.position.z + placement.targetZOffset
    );
    const mask = instantiateMask(
      scene,
      containers[placement.modelIndex],
      root,
      placement.name,
      placement.position,
      placement.scale,
      target,
      placement.roll
    );
    instances.push({
      root: mask,
      baseY: placement.position.y,
      basePitch: mask.rotation.x,
      phase: placement.phase,
      homeTarget: target,
    });
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const container of containers) container.dispose();
    instances.length = 0;
  };
  scene.onDisposeObservable.addOnce(dispose);

  return {
    root,
    setFollowPlayer(value) {
      followPlayer = value;
    },
    setMotionAmount(value) {
      motionAmount = Math.max(0, Math.min(2.5, value));
    },
    update(dt, playerPosition) {
      if (disposed) return;
      time += dt;
      for (const instance of instances) {
        instance.root.position.y =
          instance.baseY + Math.sin(time * 0.58 + instance.phase) * 0.1 * motionAmount;
        const target = followPlayer ? playerPosition : instance.homeTarget;
        const desired = target.subtract(instance.root.position).normalize();
        const desiredYaw = Math.atan2(desired.x, desired.z);
        const difference = Math.atan2(
          Math.sin(desiredYaw - instance.root.rotation.y),
          Math.cos(desiredYaw - instance.root.rotation.y)
        );
        instance.root.rotation.y +=
          difference * Math.min(1, dt * (followPlayer ? 0.72 : 0.22));
        instance.root.rotation.x =
          instance.basePitch +
          Math.sin(time * 0.31 + instance.phase * 0.7) * 0.018 * motionAmount;
      }
    },
    dispose,
  };
}
