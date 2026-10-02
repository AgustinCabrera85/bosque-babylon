import assert from "node:assert/strict";
import { LevelManager } from "../src/game/runtime/LevelManager";
import { LevelRegistry } from "../src/game/runtime/LevelRegistry";
import type { GameLevel, LevelId } from "../src/game/runtime/LevelTypes";

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

console.log(
  "Level runtime: forest -> theatre -> forest, serialized transitions, idempotent disposal and partial-scene cleanup OK",
);
