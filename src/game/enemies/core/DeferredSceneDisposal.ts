import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

const DISPOSAL_BUDGET_MS = 0.5;

export type DeferredDisposalTask = () => void;

type SceneDisposalQueue = {
  tasks: DeferredDisposalTask[];
  cursor: number;
  afterRenderObserver: Observer<Scene> | null;
  sceneDisposeObserver: Observer<Scene> | null;
  disposed: boolean;
};

const sceneDisposalQueues = new WeakMap<Scene, SceneDisposalQueue>();

function getSceneDisposalQueue(scene: Scene) {
  const existing = sceneDisposalQueues.get(scene);
  if (existing) return existing;

  const queue: SceneDisposalQueue = {
    tasks: [],
    cursor: 0,
    afterRenderObserver: null,
    sceneDisposeObserver: null,
    disposed: false,
  };
  queue.sceneDisposeObserver = scene.onDisposeObservable.addOnce(() => {
    queue.disposed = true;
    queue.tasks.length = 0;
    queue.cursor = 0;
    if (queue.afterRenderObserver) {
      scene.onAfterRenderObservable.remove(queue.afterRenderObserver);
      queue.afterRenderObserver = null;
    }
    queue.sceneDisposeObserver = null;
    sceneDisposalQueues.delete(scene);
  });
  sceneDisposalQueues.set(scene, queue);
  return queue;
}

function ensureDrainObserver(scene: Scene, queue: SceneDisposalQueue) {
  if (queue.afterRenderObserver || queue.disposed) return;
  queue.afterRenderObserver = scene.onAfterRenderObservable.add(() => {
    const started = performance.now();
    do {
      queue.tasks[queue.cursor++]();
    } while (
      queue.cursor < queue.tasks.length &&
      performance.now() - started < DISPOSAL_BUDGET_MS
    );

    if (queue.cursor < queue.tasks.length) return;
    queue.tasks.length = 0;
    queue.cursor = 0;
    if (queue.afterRenderObserver) {
      scene.onAfterRenderObservable.remove(queue.afterRenderObserver);
      queue.afterRenderObserver = null;
    }
  });
}

/** One scene-wide queue prevents several defeated enemies consuming a budget each frame. */
export function deferSceneDisposal(
  scene: Scene,
  tasks: readonly DeferredDisposalTask[]
) {
  if (tasks.length === 0 || scene.isDisposed) return;
  const queue = getSceneDisposalQueue(scene);
  if (queue.disposed) return;
  queue.tasks.push(...tasks);
  ensureDrainObserver(scene, queue);
}

export function getDeferredSceneDisposalStats(scene: Scene) {
  const queue = sceneDisposalQueues.get(scene);
  return {
    pendingTasks: queue ? Math.max(0, queue.tasks.length - queue.cursor) : 0,
    observerActive: Boolean(queue?.afterRenderObserver),
  };
}
