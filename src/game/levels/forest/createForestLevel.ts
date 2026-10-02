import { createScene, desktopQuality, mobileQuality } from "../../createScene";
import type { GameLevel, LevelCreateContext } from "../../runtime/LevelTypes";

export async function createForestLevel(
  context: LevelCreateContext
): Promise<GameLevel> {
  const quality =
    context.performanceTier === "mobile" ? mobileQuality : desktopQuality;
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
    context.entryPoint === "initial",
    context.cursorController
  );
  let disposed = false;

  return {
    id: "forest",
    scene: handle.scene,
    enter() {
      context.musicPlayer?.configureLevelAudio({
        backgroundTrack: "assets/audio/music/Echoes_in_the_Dark_ingame.mp3",
        ambientTrack: "assets/audio/ambience/Gentle_cricket_chirp.mp3",
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
