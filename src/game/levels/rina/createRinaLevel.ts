import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PlayerController } from "../../PlayerController";
import { setupPlayerViewControls } from "../../PlayerViewControls";
import { setupMobileControls } from "../../MobileControls";
import { EnemyManager } from "../../enemies/core/EnemyManager";
import {
  RINA_TYPE,
  registerRina,
  spawnRina,
} from "../../enemies/rina";
import type { GameLevel, LevelCreateContext } from "../../runtime/LevelTypes";
import { createRinaCrowdPreview } from "./RinaCrowdPreview";
import { RINA_CONCERT_SONG } from "./RinaConcertConfig";
import { createRinaLiveScreens } from "./RinaLiveScreens";
import { createRinaPerformance } from "./RinaPerformance";
import { RINA_LEVEL_QUALITY, RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";
import { createRinaStadiumGeometry } from "./RinaStadiumGeometry";
import { RinaStadiumWorld } from "./RinaStadiumWorld";
import { createRinaStage } from "./RinaStage";

function createRinaLevelHud() {
  const root = document.createElement("div");
  root.id = "rinaLevelHud";
  root.style.cssText = [
    "position:fixed",
    "bottom:6vh",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:30",
    "pointer-events:none",
    "padding:10px 18px",
    "border:1px solid rgba(80,190,255,.2)",
    "border-radius:10px",
    "background:rgba(5,4,10,.68)",
    "color:#f4eef7",
    "font:14px/1.45 system-ui,sans-serif",
    "letter-spacing:.02em",
    "text-align:center",
    "text-shadow:0 2px 7px #000",
    "backdrop-filter:blur(7px)",
  ].join(";");
  document.body.appendChild(root);
  return {
    setText(text: string) {
      if (root.textContent !== text) root.textContent = text;
    },
    dispose() {
      root.remove();
    },
  };
}

/**
 * Rina level – foundation iteration.
 *
 * This deliberately implements scale, staging, navigation and the real Rina
 * asset first. The rescue director/crowd collisions/Sofía spotlight layer is
 * added on top after the stadium scale is validated in-game.
 */
export async function createRinaLevel(
  context: LevelCreateContext
): Promise<GameLevel> {
  const scene = new Scene(context.engine);
  let disposed = false;
  const cleanup: Array<() => void> = [];

  scene.onDisposeObservable.addOnce(() => {
    while (cleanup.length) {
      try {
        cleanup.pop()?.();
      } catch (error) {
        console.error("Rina level cleanup", error);
      }
    }
  });

  try {
    const quality = RINA_LEVEL_QUALITY[context.performanceTier];
    context.onProgress(0.06, "Entrando al estadio...");

    scene.clearColor = new Color4(0.006, 0.003, 0.012, 1);
    scene.ambientColor = new Color3(0.004, 0.003, 0.008);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.018, 0.006, 0.026);
    scene.fogDensity = quality.fogDensity / RINA_STADIUM_SCALE;

    const ambient = new HemisphericLight(
      "rinaStadiumAmbient",
      new Vector3(0, 1, 0),
      scene
    );
    ambient.intensity = 0.12;
    ambient.diffuse = new Color3(0.18, 0.23, 0.36);
    ambient.groundColor = new Color3(0.006, 0.005, 0.012);

    const stadiumMoon = new DirectionalLight(
      "rinaStadiumMoon",
      new Vector3(-0.2, -1, 0.24),
      scene
    );
    stadiumMoon.position = new Vector3(28, 72, -34);
    stadiumMoon.diffuse = new Color3(0.18, 0.23, 0.34);
    stadiumMoon.intensity = 0.04;
    stadiumMoon.setEnabled(false);

    const glow = new GlowLayer("rinaConcertGlow", scene, {
      blurKernelSize: context.performanceTier === "mobile" ? 24 : 48,
    });
    glow.intensity = context.performanceTier === "mobile" ? 0.38 : 0.62;

    context.onProgress(0.18, "Construyendo el campo...");
    createRinaStadiumGeometry(scene, context.performanceTier);
    const stage = createRinaStage(scene, context.performanceTier);
    const crowdPreview = createRinaCrowdPreview(
      scene,
      context.performanceTier
    );
    const stadiumRoot = new TransformNode("rinaStadiumRoot", scene);
    for (const mesh of scene.meshes) {
      if (!mesh.parent) mesh.parent = stadiumRoot;
    }
    for (const light of scene.lights) {
      if (!light.name.startsWith("rinaMovingSpot_") &&
          light.name !== "rinaStageWash" &&
          light.name !== "rinaAudienceSpill" &&
          light.name !== "rinaPlayerSpotBounce" &&
          light.name !== "rinaRinaKeyLight" &&
          !light.name.startsWith("rinaScreenLight_") &&
          !light.name.startsWith("rinaPyroLight")) continue;
      light.parent = stadiumRoot;
      light.range *= RINA_STADIUM_SCALE;
    }
    stadiumRoot.scaling.setAll(RINA_STADIUM_SCALE);
    const playerWorld = new RinaStadiumWorld();

    context.onProgress(
      0.44,
      `Cargando ${context.selectedCharacter === "sofia" ? "Sofía" : "Lautaro"}...`
    );

    const player = new PlayerController(
      scene,
      context.canvas,
      context.input,
      {
        eyeHeight: RINA_STADIUM.playerEyeHeight,
        walkSpeed: 3.8,
        runSpeed: 8.2,
        jumpSpeed: 5.5,
        gravity: -18,
        runningEnabled: true,
        jumpingEnabled: false,
        horizontalWorldLimit: null,
      },
      context.selectedCharacter
    );
    player.position.set(
      RINA_STADIUM.playerSpawn.x * RINA_STADIUM_SCALE,
      RINA_STADIUM.playerEyeHeight,
      RINA_STADIUM.playerSpawn.z * RINA_STADIUM_SCALE
    );
    await player.loadCharacter();
    stage.setPlayerLightMeshes(
      scene.getTransformNodeByName("playerRoot")?.getChildMeshes(false) ?? []
    );

    // This level intentionally supports only the immersive cameras discussed
    // for the recital. With isometric disabled, V cycles third <-> first.
    player.setIsometricViewAllowed(false);
    player.setViewMode("third");
    cleanup.push(setupPlayerViewControls(player));
    cleanup.push(setupMobileControls(player, context.input));

    context.onProgress(0.68, "Rina sube al escenario...");
    const enemyManager = new EnemyManager(scene);
    cleanup.push(() => enemyManager.dispose());
    registerRina(enemyManager, {}, () => player.position);
    await enemyManager.preload(RINA_TYPE);

    const rina = await spawnRina(enemyManager, {
      id: "rina-stage",
      type: RINA_TYPE,
      position: stage.rinaPosition.scale(RINA_STADIUM_SCALE),
      rotation: new Vector3(0, RINA_STADIUM.stage.rinaYaw, 0),
      enabled: true,
      metadata: {
        bossLike: true,
        invulnerableNarrativeEncounter: true,
      },
    });
    const rinaMeshes = rina.root.getChildMeshes(false).filter(
      (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0
    );
    for (const mesh of rinaMeshes) glow.addExcludedMesh(mesh);
    const rinaFill = new HemisphericLight(
      "rinaPortraitFill",
      new Vector3(0, 1, -0.25),
      scene
    );
    rinaFill.diffuse = new Color3(0.82, 0.78, 0.73);
    rinaFill.groundColor = new Color3(0.16, 0.19, 0.24);
    rinaFill.specular = new Color3(0.09, 0.09, 0.09);
    rinaFill.intensity = 0.8;
    rinaFill.renderPriority = 4;
    rinaFill.includedOnlyMeshes.push(...rinaMeshes);
    stage.singerLight.includedOnlyMeshes.push(...rinaMeshes);
    rina.animations.play("sing", {
      loop: true,
      blendingSpeed: 0.06,
      speedRatio: 0.96,
    });
    const performance = createRinaPerformance(
      rina,
      stage.rinaPosition.scale(RINA_STADIUM_SCALE),
      stage.catwalkSingerPosition.scale(RINA_STADIUM_SCALE)
    );
    const liveScreens = createRinaLiveScreens(scene, rina, context.performanceTier);
    stage.setLiveFeed(liveScreens.feed);
    for (const material of scene.materials) {
      if ("maxSimultaneousLights" in material &&
          typeof material.maxSimultaneousLights === "number") {
        material.maxSimultaneousLights =
          context.performanceTier === "mobile" ? 6 : 8;
      }
    }

    const exitMarkerMaterial = new StandardMaterial(
      "rinaExitMarkerMaterial",
      scene
    );
    exitMarkerMaterial.diffuseColor = new Color3(0.04, 0.12, 0.14);
    exitMarkerMaterial.emissiveColor = new Color3(0.08, 0.58, 0.62);
    exitMarkerMaterial.alpha = 0.55;

    const exitMarker = MeshBuilder.CreateBox(
      "rinaExitMarker",
      { width: 7.5, height: 3.8, depth: 0.25 },
      scene
    );
    exitMarker.position.set(
      0,
      2,
      RINA_STADIUM.exitTunnel.startZ + 1.2
    );
    exitMarker.parent = stadiumRoot;
    exitMarker.material = exitMarkerMaterial;

    const hud = createRinaLevelHud();
    cleanup.push(hud.dispose);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let elapsed = 0;
    let transitionRequested = false;

    scene.metadata ??= {};
    scene.metadata.playerStats = context.playerStats;
    scene.metadata.playerWorld = playerWorld;
    scene.metadata.rinaLevel = {
      version: "foundation-01",
      realRinaAsset: true,
      stadiumScale: RINA_STADIUM_SCALE,
      supportedViews: ["third", "first"],
      crowdSystem: "preview-only",
    };

    const update = (unclampedDt: number) => {
      const dt = Math.min(0.05, Math.max(0, unclampedDt));
      elapsed += dt;

      player.update(dt, playerWorld);
      const music = context.musicPlayer?.getMusicPlaybackState() ?? null;
      performance.update(dt, music);
      liveScreens.update();
      const beatPulse = stage.update(
        dt, music, rina.root.position.z / RINA_STADIUM_SCALE,
        rina.root.rotation.y, player.position
      );
      if (!reducedMotion.matches && music?.playing && beatPulse > 0) {
        const strength = Math.min(1, beatPulse *
          (0.55 + music.bass * 0.3 + music.energy * 0.15));
        const phase = music.currentTime * Math.PI * 26;
        // The player rig has already settled for this frame. These offsets
        // affect only the view and are replaced by the next rig update.
        player.camera.position.x += Math.sin(phase) * 0.012 * strength;
        player.camera.position.y += Math.sin(phase * 1.37 + 0.6) * 0.006 * strength;
        player.camera.rotation.z += Math.sin(phase * 0.73 + 0.5) * 0.0015 * strength;
      }
      crowdPreview.update(elapsed, beatPulse);
      enemyManager.update(dt);
      context.musicPlayer?.updateListenerPosition(player.position);

      const exitPosition = exitMarker.getAbsolutePosition();
      const exitDistance = Math.hypot(
        player.position.x - exitPosition.x,
        player.position.z - exitPosition.z
      );

      if (exitDistance < 5.2 * RINA_STADIUM_SCALE) {
        hud.setText(
          `${context.input.getActionBindingLabel("interact") ?? "E"}: volver al Santuario  ·  ${context.input.getActionBindingLabel("changeCamera") ?? "V"}: tercera / primera persona`
        );
        if (
          !transitionRequested &&
          context.input.wasPressed("interact")
        ) {
          transitionRequested = true;
          context.requestLevelTransition("sanctuary", "rina-return");
        }
      } else {
        hud.setText(`La Sombra de Rina  ·  ${context.input.getActionBindingLabel("changeCamera") ?? "V"}: tercera / primera persona`);
      }

    };

    context.onProgress(1, "Estadio de Rina listo");

    return {
      id: "rina",
      scene,
      enter() {
        const musicPlayer = context.musicPlayer;
        if (!musicPlayer) return;
        scene.onAfterRenderObservable.addOnce(() => {
          const startMusicTimer = window.setTimeout(() => {
            if (scene.isDisposed) return;
            musicPlayer.configureLevelAudio({
              backgroundTrack: RINA_CONCERT_SONG.track,
              ambientTrack: null,
              waterfallArea: null,
            });
          }, 0);
          cleanup.push(() => window.clearTimeout(startMusicTimer));
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
