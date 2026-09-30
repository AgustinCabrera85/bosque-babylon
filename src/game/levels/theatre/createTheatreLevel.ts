import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { PlayerController } from "../../PlayerController";
import { setupPlayerViewControls } from "../../PlayerViewControls";
import { setupMobileControls } from "../../MobileControls";
import { createThoughtMessages } from "../../ThoughtMessages";
import type { GameLevel, LevelCreateContext } from "../../runtime/LevelTypes";
import { createTheatreShell } from "./TheatreShell";
import { createExpressionistStaircase, STAIR_CONFIG } from "./Staircase";
import { createMaskField } from "./MaskField";
import { TheatrePlayerWorld } from "./TheatrePlayerWorld";
import { TheatreDirector } from "./TheatreDirector";
import { createExpressionistPostProcess } from "./ExpressionistPostProcess";
import { createPortalSideFog } from "./PortalSideFog";
import { THEATRE_LOCOMOTION } from "./TheatreLocomotion";

type TheatreQualityProfile = {
  maskMotion: number;
  fogDensity: number;
  postIntensity: number;
};

const THEATRE_QUALITY: Record<"desktop" | "mobile", TheatreQualityProfile> = {
  desktop: { maskMotion: 1, fogDensity: 0.014, postIntensity: 0.72 },
  mobile: { maskMotion: 0.55, fogDensity: 0.011, postIntensity: 0.55 },
};

export async function createTheatreLevel(
  context: LevelCreateContext
): Promise<GameLevel> {
  const scene = new Scene(context.engine);
  const resourceDisposers: Array<() => void> = [];
  let disposed = false;
  scene.onDisposeObservable.addOnce(() => {
    for (let index = resourceDisposers.length - 1; index >= 0; index -= 1) {
      try {
        resourceDisposers[index]?.();
      } catch (error) {
        console.error("No se pudo liberar un recurso del teatro", error);
      }
    }
    resourceDisposers.length = 0;
  });

  try {
    const quality = THEATRE_QUALITY[context.performanceTier];
    context.onProgress(0.08, "Abriendo el teatro...");
    scene.clearColor = new Color4(0.0015, 0.0015, 0.002, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.003, 0.003, 0.004);
    scene.fogDensity = quality.fogDensity;
    scene.ambientColor = new Color3(0.006, 0.006, 0.008);

    const hemi = new HemisphericLight("voidHemi", new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.09;
    hemi.diffuse = new Color3(0.35, 0.37, 0.4);
    hemi.groundColor = new Color3(0.005, 0.005, 0.006);
    const moon = new DirectionalLight("topLight", new Vector3(0.05, -0.78, -0.62), scene);
    moon.position = new Vector3(0, 52, 124);
    moon.diffuse = new Color3(0.68, 0.7, 0.74);
    moon.intensity = 0.68;
    const theatreGlow = new PointLight("theatreGlow", new Vector3(0, 3, -11), scene);
    theatreGlow.diffuse = new Color3(0.48, 0.16, 0.1);
    theatreGlow.intensity = 8.5;
    theatreGlow.range = 18;
    const portalSpot = new SpotLight(
      "portalSpot",
      new Vector3(0, 38, 113),
      new Vector3(0, -0.38, -0.925),
      Math.PI / 2.8,
      1.15,
      scene
    );
    portalSpot.diffuse = new Color3(0.68, 0.67, 0.62);
    portalSpot.intensity = 16;
    portalSpot.range = 105;

    createTheatreShell(scene);
    const staircase = createExpressionistStaircase(scene);
    const playerWorld = new TheatrePlayerWorld(staircase);
    const portalFog = createPortalSideFog(
      scene,
      STAIR_CONFIG.startZ,
      staircase.endZ,
      staircase.topY,
      STAIR_CONFIG.baseWidth,
      STAIR_CONFIG.topWidth,
      context.performanceTier === "mobile"
    );
    resourceDisposers.push(portalFog.dispose);

    context.onProgress(0.36, "Cargando rostros...");
    const masks = await createMaskField(scene, staircase.getHeightAt);
    resourceDisposers.push(masks.dispose);
    masks.setMotionAmount(quality.maskMotion);

    context.onProgress(0.72, `Cargando ${context.selectedCharacter === "sofia" ? "Sofía" : "Lautaro"}...`);
    const player = new PlayerController(
      scene,
      context.canvas,
      context.input,
      {
        eyeHeight: 1.7,
        walkSpeed: 2.8,
        runSpeed: 6.8,
        jumpSpeed: 6.2,
        gravity: -18,
        runningEnabled: THEATRE_LOCOMOTION.runningEnabled,
        jumpingEnabled: THEATRE_LOCOMOTION.jumpingEnabled,
      },
      context.selectedCharacter
    );
    player.position.set(0, 1.7, -10.5);
    await player.loadCharacter();
    const disposeViewControls = setupPlayerViewControls(player);
    resourceDisposers.push(disposeViewControls);
    const disposeMobileControls = setupMobileControls(player, context.input);
    resourceDisposers.push(disposeMobileControls);
    const messages = createThoughtMessages();
    resourceDisposers.push(messages.dispose);
    const director = new TheatreDirector(
      masks,
      messages,
      STAIR_CONFIG.startZ,
      staircase.endZ
    );
    const post = createExpressionistPostProcess(scene, player.camera);
    resourceDisposers.push(post.dispose);
    post.setIntensity(quality.postIntensity);
    const playerFill = new PointLight("playerFill", new Vector3(0, 1.5, -10.5), scene);
    playerFill.diffuse = new Color3(0.34, 0.36, 0.42);
    playerFill.intensity = 0.52;
    playerFill.range = 5.2;
    let lastHealth = context.playerStats.snapshot.health;
    const unsubscribeStats = context.playerStats.onChange((event) => {
      if (event.snapshot.health < lastHealth) player.playHitReaction();
      lastHealth = event.snapshot.health;
      if (event.snapshot.isDead) player.clearEnemyGrabStruggles();
    });
    resourceDisposers.push(unsubscribeStats);
    scene.metadata ??= {};
    scene.metadata.playerStats = context.playerStats;
    scene.metadata.playerWorld = playerWorld;

    let topPulse = 0;
    const update = (dt: number) => {
      player.update(dt, playerWorld);
      playerFill.position.copyFrom(player.position).addInPlaceFromFloats(0, 1.55, 0);
      portalFog.update(dt);
      masks.update(dt, player.position);
      director.update(player.position);
      context.musicPlayer?.updateListenerPosition(player.position);
      topPulse += dt;
      const progress = Math.max(
        0,
        Math.min(
          1,
          (player.position.z - STAIR_CONFIG.startZ) /
            Math.max(0.001, staircase.endZ - STAIR_CONFIG.startZ)
        )
      );
      post.setAscentProgress(progress);
      portalSpot.intensity = 16 + Math.sin(topPulse * 1.1) * 0.8;
      theatreGlow.intensity = Math.max(0.8, 8.5 * (1 - progress * 0.95));
    };

    context.onProgress(1, "Teatro listo");

    return {
      id: "theatre",
      scene,
      enter() {
        context.musicPlayer?.configureLevelAudio({
          backgroundTrack: "assets/audio/music/BGM_escalera_teatro.mp3",
          ambientTrack: null,
          waterfallArea: null,
          walkFootstepTrack: THEATRE_LOCOMOTION.walkFootstepTrack,
        });
      },
      update,
      dispose() {
        if (disposed) return;
        disposed = true;
        if (!scene.isDisposed) scene.dispose();
      },
    };
  } catch (error) {
    if (!scene.isDisposed) scene.dispose();
    throw error;
  }
}
