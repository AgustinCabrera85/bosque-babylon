import "@babylonjs/loaders/glTF";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";

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
      const target = new Vector3(0, getStairHeight(z) + 1.3, z + 2);
      const mask = instantiateMask(
        scene,
        containers[modelIndex],
        root,
        `mask_${i}_${side < 0 ? "L" : "R"}`,
        position,
        2.55 * variation,
        target,
        side * (0.025 + (i % 4) * 0.016)
      );
      instances.push({
        root: mask,
        baseY: mask.position.y,
        basePitch: mask.rotation.x,
        phase: i * 0.61 + (side > 0 ? 1.7 : 0),
        homeTarget: target,
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

  for (let i = 0; i < heroPositions.length; i += 1) {
    const position = heroPositions[i];
    const target = new Vector3(0, getStairHeight(position.z) + 1.4, position.z);
    const mask = instantiateMask(
      scene,
      containers[position.model],
      root,
      `heroMask_${i}`,
      new Vector3(position.x, position.y, position.z),
      position.scale,
      target,
      (position.x < 0 ? -1 : 1) * 0.035
    );
    instances.push({
      root: mask,
      baseY: position.y,
      basePitch: mask.rotation.x,
      phase: 4 + i,
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
