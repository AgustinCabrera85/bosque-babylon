import type { Scene } from "@babylonjs/core/scene";
import type { MusicPlayerHandle } from "../MusicPlayer";
import type { PlayerStatsSystem } from "../PlayerStatsSystem";
import type { InputManager } from "../input/InputManager";
import type { LevelRegistry } from "./LevelRegistry";
import type {
  GameLevel,
  LevelCreateContext,
  LevelId,
} from "./LevelTypes";

type LevelManagerContext = Omit<
  LevelCreateContext,
  "entryPoint" | "requestLevelTransition"
>;

type LevelManagerOptions = {
  registry: LevelRegistry;
  context: LevelManagerContext;
  input: InputManager;
  playerStats: PlayerStatsSystem;
  musicPlayer: MusicPlayerHandle | null;
  onActiveSceneChanged?: (scene: Scene | null) => void;
  onTransitionError?: (error: unknown) => void;
};

export class LevelManager {
  private activeLevel: GameLevel | null = null;
  private transitioning = false;
  private disposed = false;
  private readonly disposedLevels = new WeakSet<GameLevel>();

  constructor(private readonly options: LevelManagerOptions) {}

  get currentLevel() {
    return this.activeLevel;
  }

  get currentLevelId() {
    return this.activeLevel?.id ?? null;
  }

  get isTransitioning() {
    return this.transitioning;
  }

  async loadLevel(id: LevelId, entryPoint?: string) {
    if (this.disposed) throw new Error("LevelManager is disposed");
    if (this.transitioning) {
      throw new Error(`A level transition is already in progress (requested: ${id})`);
    }

    this.transitioning = true;
    const engine = this.options.context.engine;
    const scenesBeforeCreation = new Set(engine.scenes);

    try {
      this.options.input.reset();
      this.options.musicPlayer?.prepareForLevelTransition();

      const previous = this.activeLevel;
      this.activeLevel = null;
      this.options.onActiveSceneChanged?.(null);
      if (previous) this.disposeLevel(previous);

      this.options.playerStats.resetForLevel();
      this.options.playerStats.save();

      const factory = await this.options.registry.resolve(id);
      const level = await factory({
        ...this.options.context,
        entryPoint,
        requestLevelTransition: (nextLevel, nextEntryPoint) => {
          void this.loadLevel(nextLevel, nextEntryPoint).catch((error) => {
            this.options.onTransitionError?.(error);
          });
        },
      });

      if (level.id !== id) {
        this.disposeLevel(level);
        throw new Error(`Level factory for ${id} returned ${level.id}`);
      }
      if (level.scene.isDisposed) {
        this.disposeLevel(level);
        throw new Error(`Level ${id} returned a disposed Scene`);
      }

      try {
        await level.enter?.();
      } catch (error) {
        this.disposeLevel(level);
        throw error;
      }

      this.activeLevel = level;
      this.options.onActiveSceneChanged?.(level.scene);
      this.options.input.reset();
      return level;
    } catch (error) {
      for (const scene of [...engine.scenes]) {
        if (!scenesBeforeCreation.has(scene) && !scene.isDisposed) scene.dispose();
      }
      throw error;
    } finally {
      this.transitioning = false;
    }
  }

  update(deltaTimeSeconds: number) {
    if (this.disposed || this.transitioning) return;
    this.activeLevel?.update?.(deltaTimeSeconds);
  }

  render() {
    if (this.disposed || this.transitioning) return;
    const scene = this.activeLevel?.scene;
    if (scene && !scene.isDisposed) scene.render();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const active = this.activeLevel;
    this.activeLevel = null;
    this.options.onActiveSceneChanged?.(null);
    if (active) this.disposeLevel(active);
  }

  private disposeLevel(level: GameLevel) {
    if (this.disposedLevels.has(level)) return;
    this.disposedLevels.add(level);
    level.dispose();
  }
}
