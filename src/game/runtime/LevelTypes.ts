import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import type { InventoryHandle } from "../Inventory";
import type { MusicPlayerHandle } from "../MusicPlayer";
import type { CharacterId } from "../PlayerController";
import type { PlayerStatsSystem } from "../PlayerStatsSystem";
import type { InputManager } from "../input/InputManager";

export type LevelId = "forest" | "theatre";

export type PerformanceTier = "desktop" | "mobile";

export interface GameLevel {
  readonly id: LevelId;
  readonly scene: Scene;

  update?(deltaTimeSeconds: number): void;
  enter?(): Promise<void> | void;
  playOpeningSequence?(): Promise<void>;
  dispose(): void;
}

export interface LevelCreateContext {
  engine: Engine;
  canvas: HTMLCanvasElement;
  input: InputManager;
  selectedCharacter: CharacterId;
  inventory: InventoryHandle;
  playerStats: PlayerStatsSystem;
  musicPlayer: MusicPlayerHandle | null;
  performanceTier: PerformanceTier;
  entryPoint?: string;
  onProgress(value: number, text: string): void;
  requestLevelTransition(level: LevelId, entryPoint?: string): void;
}

export type LevelFactory = (
  context: LevelCreateContext
) => Promise<GameLevel> | GameLevel;

export type LevelFactoryLoader = () => Promise<LevelFactory>;
