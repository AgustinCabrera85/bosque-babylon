import type { InventoryHandle } from "../Inventory";
import type { MusicPlayerHandle } from "../MusicPlayer";
import type { CharacterId } from "../PlayerController";
import { PlayerStatsSystem } from "../PlayerStatsSystem";
import { PlayerStatusHud } from "../PlayerStatusHud";

type GameSessionOptions = {
  selectedCharacter: CharacterId;
  inventory: InventoryHandle;
  musicPlayer: MusicPlayerHandle | null;
  debugPlayerStats?: boolean;
};

export class GameSession {
  readonly selectedCharacter: CharacterId;
  readonly inventory: InventoryHandle;
  readonly musicPlayer: MusicPlayerHandle | null;
  readonly playerStats: PlayerStatsSystem;

  private readonly playerStatusHud: PlayerStatusHud;
  private readonly abortController = new AbortController();
  private disposed = false;

  constructor(options: GameSessionOptions) {
    this.selectedCharacter = options.selectedCharacter;
    this.inventory = options.inventory;
    this.musicPlayer = options.musicPlayer;
    this.playerStats = new PlayerStatsSystem({
      inventory: options.inventory,
      debug: options.debugPlayerStats ?? false,
    });
    this.playerStatusHud = new PlayerStatusHud(this.playerStats);

    window.addEventListener("bosque:save", this.onSaveRequested, {
      signal: this.abortController.signal,
    });
  }

  save() {
    return this.playerStats.save();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.save();
    this.abortController.abort();
    this.playerStatusHud.dispose();
    this.playerStats.dispose();
  }

  private readonly onSaveRequested = () => {
    this.save();
  };
}
