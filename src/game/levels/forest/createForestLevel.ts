import { createScene, desktopQuality, mobileQuality } from "../../createScene";
import {
  requestCharacterSelectionReturn,
  requestCheckpointRestart,
} from "../../runtime/CheckpointRestart";
import type { GameLevel, LevelCreateContext } from "../../runtime/LevelTypes";
import { getLevelExitPortalRoute } from "../../runtime/PortalRoutes";

export async function createForestLevel(
  context: LevelCreateContext
): Promise<GameLevel> {
  const quality =
    context.performanceTier === "mobile" ? mobileQuality : desktopQuality;
  let exitTransitionRequested = false;
  const handle = await createScene(
    context.engine,
    context.canvas,
    context.onProgress,
    quality,
    context.selectedCharacter,
    context.musicPlayer,
    context.inventory,
    context.input,
    context.playerStats,
    context.entryPoint === "initial" ||
      context.entryPoint === "libre-de-culpas-portal",
    context.cursorController,
    {
      entryPoint: context.entryPoint,
      onPlayerDeathChoice: (choice, entryPoint) => {
        if (choice === "checkpoint") {
          requestCheckpointRestart({ level: "forest", entryPoint });
          return;
        }
        requestCharacterSelectionReturn();
      },
      onLevelExit: () => {
        if (exitTransitionRequested) return;
        exitTransitionRequested = true;
        // Do not dispose the forest scene from inside its render callback.
        queueMicrotask(() => {
          const route = getLevelExitPortalRoute("forest");
          context.requestLevelTransition(route.to, route.entryPoint);
        });
      },
    }
  );
  let disposed = false;

  return {
    id: "forest",
    scene: handle.scene,
    enter() {
      context.musicPlayer?.configureLevelAudio({
        backgroundTrack: "assets/audio/music/Echoes_in_the_Dark_ingame.mp3",
        ambientTrack: "assets/audio/ambience/Gentle_cricket_chirp.mp3",
        ambientVolumeScale: 0.8,
        ambientReplayDelaySeconds: 8,
      });
    },
    playOpeningSequence: handle.playOpeningSequence,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!handle.scene.isDisposed) handle.scene.dispose();
    },
  };
}
