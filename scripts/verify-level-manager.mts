import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { LevelManager } from "../src/game/runtime/LevelManager";
import { LevelRegistry } from "../src/game/runtime/LevelRegistry";
import type { GameLevel, LevelId } from "../src/game/runtime/LevelTypes";
import {
  HERMANO_MAYOR_FOREST_CROSSING_TUNING,
  HermanoMayorForestCrossingCinematic,
  hasReachedForestCrossingTrigger,
} from "../src/game/levels/HermanoMayorForestCrossingCinematic";

type FakeScene = {
  isDisposed: boolean;
  disposeCount: number;
  dispose(): void;
  render(): void;
};

const createScene = (): FakeScene => ({
  isDisposed: false,
  disposeCount: 0,
  dispose() {
    this.disposeCount += 1;
    this.isDisposed = true;
  },
  render() {},
});

const scenes: FakeScene[] = [];
const disposedByLevel = new Map<LevelId, number>();
const createLevel = (id: LevelId): GameLevel => {
  const scene = createScene();
  scenes.push(scene);
  return {
    id,
    scene: scene as never,
    dispose() {
      disposedByLevel.set(id, (disposedByLevel.get(id) ?? 0) + 1);
      scene.dispose();
    },
  };
};

const registry = new LevelRegistry();
registry.register("forest", async () => async () => createLevel("forest"));
registry.register("theatre", async () => async () => createLevel("theatre"));

let inputResets = 0;
let saves = 0;
let statResets = 0;
let audioTransitions = 0;
const playerStats = {
  save: () => { saves += 1; },
  resetForLevel: () => { statResets += 1; },
};
const manager = new LevelManager({
  registry,
  context: {
    engine: { scenes } as never,
    canvas: {} as never,
    input: { reset: () => { inputResets += 1; } } as never,
    selectedCharacter: "lautaro" as never,
    inventory: {} as never,
    playerStats: playerStats as never,
    musicPlayer: { prepareForLevelTransition: () => { audioTransitions += 1; } } as never,
    performanceTier: "desktop",
    onProgress() {},
  },
  input: { reset: () => { inputResets += 1; } } as never,
  playerStats: playerStats as never,
  musicPlayer: { prepareForLevelTransition: () => { audioTransitions += 1; } } as never,
});

await manager.loadLevel("forest");
await manager.loadLevel("theatre");
await manager.loadLevel("forest");

assert.equal(manager.currentLevelId, "forest");
assert.equal(scenes.filter((scene) => !scene.isDisposed).length, 1);
assert.equal(disposedByLevel.get("forest"), 1);
assert.equal(disposedByLevel.get("theatre"), 1);
assert.equal(saves, 3);
assert.equal(statResets, 3);
assert.equal(audioTransitions, 3);
assert.equal(inputResets, 6);

manager.dispose();
manager.dispose();
assert.equal(disposedByLevel.get("forest"), 2);
assert.equal(scenes.filter((scene) => !scene.isDisposed).length, 0);

let releaseFactory!: () => void;
const pendingFactory = new Promise<void>((resolve) => { releaseFactory = resolve; });
const concurrentRegistry = new LevelRegistry();
concurrentRegistry.register("forest", async () => {
  await pendingFactory;
  return async () => createLevel("forest");
});
concurrentRegistry.register("theatre", async () => async () => createLevel("theatre"));
const concurrentManager = new LevelManager({
  registry: concurrentRegistry,
  context: {
    engine: { scenes } as never,
    canvas: {} as never,
    input: { reset() {} } as never,
    selectedCharacter: "lautaro" as never,
    inventory: {} as never,
    playerStats: { save() {}, resetForLevel() {} } as never,
    musicPlayer: null,
    performanceTier: "desktop",
    onProgress() {},
  },
  input: { reset() {} } as never,
  playerStats: { save() {}, resetForLevel() {} } as never,
  musicPlayer: null,
});
const pendingLoad = concurrentManager.loadLevel("forest");
await assert.rejects(
  concurrentManager.loadLevel("theatre"),
  /transition is already in progress/,
);
releaseFactory();
await pendingLoad;
concurrentManager.dispose();

const failureScenes: FakeScene[] = [];
const failureRegistry = new LevelRegistry();
failureRegistry.register("theatre", async () => async () => {
  failureScenes.push(createScene());
  throw new Error("factory failed");
});
const failureManager = new LevelManager({
  registry: failureRegistry,
  context: {
    engine: { scenes: failureScenes } as never,
    canvas: {} as never,
    input: { reset() {} } as never,
    selectedCharacter: "lautaro" as never,
    inventory: {} as never,
    playerStats: { save() {}, resetForLevel() {} } as never,
    musicPlayer: null,
    performanceTier: "desktop",
    onProgress() {},
  },
  input: { reset() {} } as never,
  playerStats: { save() {}, resetForLevel() {} } as never,
  musicPlayer: null,
});
await assert.rejects(failureManager.loadLevel("theatre"), /factory failed/);
assert.equal(failureScenes.length, 1);
assert.equal(failureScenes[0]?.isDisposed, true);
assert.equal(failureManager.currentLevelId, null);

const crossingTuning = HERMANO_MAYOR_FOREST_CROSSING_TUNING;
const pickupZ = 20;
assert.equal(
  hasReachedForestCrossingTrigger(
    pickupZ,
    pickupZ + crossingTuning.triggerForwardDistance - 0.01
  ),
  false
);
assert.equal(
  hasReachedForestCrossingTrigger(
    pickupZ,
    pickupZ + crossingTuning.triggerForwardDistance
  ),
  true
);
assert.equal(hasReachedForestCrossingTrigger(pickupZ, pickupZ), false);
assert.equal(hasReachedForestCrossingTrigger(pickupZ, pickupZ - 8), false);
assert.ok(crossingTuning.crossingStartX > 0);
assert.ok(crossingTuning.crossingEndX < 0);
assert.ok(crossingTuning.crossingForwardOffset >= 22);

const listeners = new Map<string, Set<(event: { detail?: unknown }) => void>>();
const bodyClasses = new Set<string>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    addEventListener(type: string, listener: (event: { detail?: unknown }) => void) {
      const registered = listeners.get(type) ?? new Set();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removeEventListener(type: string, listener: (event: { detail?: unknown }) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: { type: string; detail?: unknown }) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
  },
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    body: {
      classList: {
        add: (name: string) => bodyClasses.add(name),
        remove: (name: string) => bodyClasses.delete(name),
        contains: (name: string) => bodyClasses.has(name),
      },
    },
  },
});

let cinematicActive = false;
let beginCalls = 0;
let endCalls = 0;
let startCleanupCalls = 0;
const playerPosition = new Vector3(0, 0, 0);
const cameraPosition = new Vector3(0, 1.7, -4);
const lastCinematicCameraPosition = Vector3.Zero();
const lastCinematicCameraTarget = Vector3.Zero();
let lastCinematicFov = 0;
const mockPlayer = {
  position: playerPosition,
  camera: {
    globalPosition: cameraPosition,
    fov: 0.9,
    computeWorldMatrix() {},
  },
  get isOpeningSequenceActive() {
    return false;
  },
  get isCinematicSequenceActive() {
    return cinematicActive;
  },
  get isGameplayControlLocked() {
    return cinematicActive;
  },
  getLookRay: () => ({ direction: new Vector3(0, 0, 1) }),
  beginCinematicSequence() {
    if (cinematicActive) return false;
    cinematicActive = true;
    beginCalls += 1;
    return true;
  },
  setCinematicCamera(
    position: Vector3,
    target: Vector3,
    _roll: number,
    fov: number
  ) {
    lastCinematicCameraPosition.copyFrom(position);
    lastCinematicCameraTarget.copyFrom(target);
    lastCinematicFov = fov;
  },
  endCinematicSequence() {
    cinematicActive = false;
    endCalls += 1;
  },
};

let currentNla: { action: string; options: Record<string, unknown> } | null = {
  action: "idle",
  options: { loop: true },
};
const lookAction = {
  enabled: true,
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  },
};
const animations = {
  getRegisteredActionNames: () => ["look"],
  getProcedural: (action: string) => (action === "look" ? lookAction : null),
  getCurrentNlaPlayback: () =>
    currentNla
      ? { action: currentNla.action, options: { ...currentNla.options } }
      : null,
  stop() {
    currentNla = null;
    lookAction.setEnabled(false);
  },
  play(action: string, options: Record<string, unknown>) {
    currentNla = { action, options: { ...options } };
    return null;
  },
};
const actorHomePosition = new Vector3(100, 2, 200);
const actorRoot = {
  position: actorHomePosition.clone(),
  rotation: new Vector3(0, 0.4, 0),
  rotationQuaternion: null,
  scaling: new Vector3(1.2, 1.2, 1.2),
  computeWorldMatrix() {},
};
const actorMesh = {
  visibility: 1,
  computeWorldMatrix() {},
  getBoundingInfo: () => ({
    boundingBox: { minimumWorld: new Vector3(100, 2, 200) },
  }),
};
const mockActor = {
  root: actorRoot,
  meshes: [actorMesh],
  animations,
  playLocomotion(action: string, options: Record<string, unknown>) {
    currentNla = { action, options: { ...options } };
  },
};
const forestCrossing = new HermanoMayorForestCrossingCinematic({
  player: mockPlayer as never,
  actor: mockActor as never,
  firstNotePosition: new Vector3(-0.95, 0, 20),
  getGroundHeight: () => 0,
  onStart: () => {
    startCleanupCalls += 1;
  },
});

forestCrossing.update(1);
assert.equal(forestCrossing.state, "waiting-note");
(globalThis as never as { window: { dispatchEvent(event: unknown): boolean } }).window.dispatchEvent({
  type: "bosque:inventory:add-item",
  detail: { id: "note-1" },
});
assert.equal(forestCrossing.state, "waiting-progress");
playerPosition.x = 20;
forestCrossing.update(1);
assert.equal(forestCrossing.state, "waiting-progress");
playerPosition.z = -5;
forestCrossing.update(1);
assert.equal(forestCrossing.state, "waiting-progress");
playerPosition.z = crossingTuning.triggerForwardDistance;
forestCrossing.update(1 / 60);
assert.equal(forestCrossing.state, "presenting");
assert.equal(actorRoot.position.x, crossingTuning.crossingStartX);
assert.equal(lookAction.enabled, false);
assert.equal(currentNla?.action, "walk");
assert.equal(startCleanupCalls, 1);

forestCrossing.update(crossingTuning.crossingDurationSeconds * 0.5);
const midpoint = forestCrossing.getDebugSnapshot();
assert.ok(
  midpoint.actorPosition &&
    Math.abs(midpoint.actorPosition.x) <=
      crossingTuning.glitchPositionJitter + 0.001
);
assert.ok(midpoint.cameraDistance > 30);
assert.ok(midpoint.glitchStrength > 0);
assert.deepEqual(lastCinematicCameraPosition.asArray(), cameraPosition.asArray());
assert.notDeepEqual(lastCinematicCameraTarget.asArray(), [0, 1.7, 8]);
assert.equal(lastCinematicFov, 0.9);
assert.notEqual(actorMesh.visibility, 1);

forestCrossing.update(crossingTuning.crossingDurationSeconds * 0.5);
assert.equal(forestCrossing.state, "complete");
assert.deepEqual(actorRoot.position.asArray(), actorHomePosition.asArray());
assert.deepEqual(actorRoot.scaling.asArray(), [1.2, 1.2, 1.2]);
assert.equal(actorMesh.visibility, 1);
assert.equal(lookAction.enabled, true);
assert.equal(currentNla?.action, "idle");
assert.equal(beginCalls, 1);
assert.equal(endCalls, 1);
assert.equal(listeners.get("bosque:inventory:add-item")?.size ?? 0, 0);
forestCrossing.update(10);
forestCrossing.dispose();
forestCrossing.dispose();
assert.equal(beginCalls, 1);
assert.equal(endCalls, 1);

console.log(
  "Level runtime and distant fixed-camera Hermano Mayor forest-crossing invariants OK",
);
