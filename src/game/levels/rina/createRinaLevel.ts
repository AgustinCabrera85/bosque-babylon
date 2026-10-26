import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { Engine } from "@babylonjs/core/Engines/engine";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StagePyroShow } from "../../effects/StagePyro";
import { RinaElectricSurfaceFX } from "../../effects/RinaElectricSurfaceFX";
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
import { createRinaFieldCrowdMazeLayout } from "./RinaFieldCrowdMazeLayout";
import { createRinaFieldCrowdMazeRenderer } from "./RinaFieldCrowdMazeRenderer";
import { createRinaFieldCollisionDebug } from "./RinaFieldCollisionDebug";
import { createRinaCornerTowerSpotlights } from "./RinaCornerTowerSpotlights";
import { createRinaGuitarist } from "./RinaGuitarist";
import { createRinaDrummer } from "./RinaDrummer";
import { RINA_CONCERT_SONG, RINA_PYRO_TIMING } from "./RinaConcertConfig";
import { createRinaLiveScreens } from "./RinaLiveScreens";
import { createRinaAudiencePhoneIntegration } from "./RinaAudiencePhoneIntegration";
import { attachRinaMicrophone } from "./RinaMicrophone";
import { createRinaPerformance } from "./RinaPerformance";
import { RinaSingingPointAction } from "./RinaSingingPointAction";
import { RinaPhotoAbsorption } from "./RinaPhotoAbsorption";
import { RINA_LEVEL_QUALITY, RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";
import { createRinaStadiumGeometry } from "./RinaStadiumGeometry";
import { RinaStadiumWorld } from "./RinaStadiumWorld";
import { createRinaStage } from "./RinaStage";
import { createRinaStageArchitecture } from "./RinaStageArchitecture";
import { createRinaStageSecurityBarriers } from "./RinaStageSecurityBarriers";
import { createRinaStandsLedDetails } from "./RinaStandsLedDetails";
import { createRinaStandsSpriteCrowd } from "./RinaStandsSpriteCrowd";
import { createRinaStrobePostProcess } from "./RinaStrobePostProcess";
import { createRinaStormSkybox } from "./RinaStormSkybox";
import { createRinaDesktopSkyStorm } from "./RinaDesktopSkyStorm";

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
    const stageArchitecture = createRinaStageArchitecture(
      scene, context.performanceTier
    );
    const ENABLE_FIELD_CROWD_MAZE = true;
    const fieldCrowdMazeLayout = ENABLE_FIELD_CROWD_MAZE
      ? createRinaFieldCrowdMazeLayout()
      : null;
    const crowdPreview = fieldCrowdMazeLayout
      ? createRinaFieldCrowdMazeRenderer(
          scene, context.performanceTier, fieldCrowdMazeLayout, stage.actorLights
        )
      : createRinaCrowdPreview(scene, context.performanceTier, stage.actorLights);
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
    crowdPreview.root.parent = stadiumRoot;
    cleanup.push(() => crowdPreview.dispose());
    if (fieldCrowdMazeLayout && "ready" in crowdPreview) {
      await crowdPreview.ready;
    }
    const standsCrowd = await createRinaStandsSpriteCrowd(scene, context.performanceTier);
    standsCrowd.root.parent = stadiumRoot;
    cleanup.push(() => standsCrowd.dispose());
    const standsLedDetails = createRinaStandsLedDetails(scene, context.performanceTier);
    standsLedDetails.root.parent = stadiumRoot;
    cleanup.push(() => standsLedDetails.dispose());
    const cornerSpotlights = createRinaCornerTowerSpotlights(
      scene, context.performanceTier
    );
    cornerSpotlights.root.parent = stadiumRoot;
    cleanup.push(() => cornerSpotlights.dispose());
    stageArchitecture.root.parent = stadiumRoot;
    cleanup.push(() => stageArchitecture.dispose());
    const securityBarriers = await createRinaStageSecurityBarriers(
      scene, context.performanceTier
    );
    securityBarriers.root.parent = stadiumRoot;
    cleanup.push(() => securityBarriers.dispose());
    // The pyro is created after the scenery root is scaled. Its billboard
    // meshes and particle emitters both use world coordinates.
    const pyroScale = RINA_STADIUM_SCALE;
    const pyro = new StagePyroShow(
      scene,
      Array.from({ length: quality.pyroJets }, (_, index) => {
        const x = -24 + index / Math.max(1, quality.pyroJets - 1) * 48;
        return new Vector3(
          x * pyroScale,
          (RINA_STADIUM.stage.height + 0.18) * pyroScale,
          (RINA_STADIUM.stage.frontZ + 1.2) * pyroScale
        );
      }),
      {
        jetHeight: 7 * pyroScale,
        jetBaseWidth: 0.85 * pyroScale,
        headDiameter: 3.6 * pyroScale,
        ...RINA_PYRO_TIMING,
        cloudCount: context.performanceTier === "mobile" ? 3 : 5,
        particles: context.performanceTier === "desktop",
        smoke: true,
        lighting: false,
      }
    );
    cleanup.push(() => pyro.dispose());
    const pyroAudio = context.musicPlayer
      ? await context.musicPlayer.createRinaPyroAudio().catch(error => {
          console.warn("Rina stage fireworks audio unavailable", error);
          return null;
        })
      : null;
    if (pyroAudio) cleanup.push(() => pyroAudio.dispose());
    const audienceAudio = context.musicPlayer
      ? await context.musicPlayer.createRinaAudienceAudio().catch(error => {
          console.warn("Rina audience audio unavailable", error);
          return null;
        })
      : null;
    if (audienceAudio) cleanup.push(() => audienceAudio.dispose());
    const playPyroBurst = () => {
      const delay = RINA_PYRO_TIMING.jetTravelTime + RINA_PYRO_TIMING.headExpandTime * 0.5;
      pyroAudio?.trigger(delay);
      audienceAudio?.triggerPyro(delay);
    };
    const playerWorld = new RinaStadiumWorld(
      securityBarriers.collisionSpans,
      fieldCrowdMazeLayout,
      context.performanceTier,
    );

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
    const collisionDebug = import.meta.env.DEV && fieldCrowdMazeLayout
      ? createRinaFieldCollisionDebug(scene, stadiumRoot, fieldCrowdMazeLayout, playerWorld)
      : null;
    if (collisionDebug) cleanup.push(() => collisionDebug.dispose());
    stage.setPlayerLightMeshes(
      scene.getTransformNodeByName("playerRoot")?.getChildMeshes(false) ?? []
    );
    const rinaElectricFX = new RinaElectricSurfaceFX(scene, {
      createPointLight: false,
    });
    cleanup.push(() => rinaElectricFX.dispose());
    rinaElectricFX.attach(player.getAvatarMeshes());
    // The stadium glow blows out the thin filaments into a white silhouette.
    for (const mesh of scene.meshes) {
      if (mesh instanceof Mesh && mesh.name.startsWith("rinaElectricFX_")) {
        glow.addExcludedMesh(mesh);
      }
    }
    // Temporary visual check until Rina has a confirmed electric-hit event.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("rinaElectricDebug")) {
      rinaElectricFX.setImpactProvider(() => player.position);
      rinaElectricFX.startContinuous();
    }

    // This level intentionally supports only the immersive cameras discussed
    // for the recital. With isometric disabled, V cycles third <-> first.
    player.setIsometricViewAllowed(false);
    player.setViewMode("third");
    // Keep the camera-following dome outside the scaled stadium hierarchy.
    player.camera.maxZ = Math.max(player.camera.maxZ, 600);
    const stormSky = createRinaStormSkybox(scene, {
      performanceTier: context.performanceTier,
      exposure: context.performanceTier === "desktop" ? 0.48 : 0.62,
      yawDegrees: 0,
      horizonBlend: 0.48,
    });
    glow.addExcludedMesh(stormSky.mesh);
    stormSky.update(player.camera.globalPosition, 0);
    cleanup.push(() => stormSky.dispose());
    const desktopSkyStorm = context.performanceTier === "desktop"
      ? await createRinaDesktopSkyStorm(scene, stormSky)
      : null;
    if (desktopSkyStorm) {
      for (const mesh of desktopSkyStorm.meshes) glow.addExcludedMesh(mesh);
      cleanup.push(() => desktopSkyStorm.dispose());
    }
    const strobePostProcess = createRinaStrobePostProcess(scene, player.camera);
    cleanup.push(() => strobePostProcess.dispose());
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
    await attachRinaMicrophone(scene, rina);
    const guitarist = await createRinaGuitarist(scene, stage.actorLights);
    if (guitarist) {
      cleanup.push(() => guitarist.dispose());
    }
    const drummer = await createRinaDrummer(scene, stage.actorLights);
    if (drummer) {
      cleanup.push(() => drummer.dispose());
    }
    const rinaMeshes = rina.root.getChildMeshes(false).filter(
      (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0
    );
    const leftHand = rina.rig.getJointNode("leftHand");
    if (!leftHand) throw new Error("Rina's left hand is required for her electric attack");
    const rinaHandElectricFX = new RinaElectricSurfaceFX(scene, {
      regionRadius: 0.42,
      parameters: {
        colorHex: "#9637F2", emission: 0.78, halo: 0.2,
        lightIntensity: 1.2, lightRange: 0.95,
      },
    });
    cleanup.push(() => rinaHandElectricFX.dispose());
    rinaHandElectricFX.attach(rinaMeshes);
    // GlowLayer reads emissive colour without the shader's world-space hand
    // mask. Exclude the skinned clones so it cannot light Rina's whole body.
    for (const mesh of scene.meshes) {
      if (mesh instanceof Mesh && mesh.name.startsWith("rinaElectricFX_")) {
        glow.addExcludedMesh(mesh);
      }
    }
    rinaHandElectricFX.setImpactProvider(() => {
      leftHand.computeWorldMatrix(true);
      return leftHand.getAbsolutePosition();
    });
    const handHaloTexture = new DynamicTexture(
      "rinaElectricHandHaloTexture", { width: 64, height: 64 }, scene, false
    );
    const haloContext = handHaloTexture.getContext();
    const haloGradient = haloContext.createRadialGradient(32, 32, 1, 32, 32, 32);
    haloGradient.addColorStop(0, "rgba(226,167,255,0.96)");
    haloGradient.addColorStop(0.25, "rgba(158,64,246,0.66)");
    haloGradient.addColorStop(0.6, "rgba(112,28,194,0.22)");
    haloGradient.addColorStop(1, "rgba(112,28,194,0)");
    haloContext.fillStyle = haloGradient;
    haloContext.fillRect(0, 0, 64, 64);
    handHaloTexture.hasAlpha = true;
    handHaloTexture.update(false);
    const handHaloMaterial = new StandardMaterial("rinaElectricHandHaloMaterial", scene);
    handHaloMaterial.disableLighting = true;
    handHaloMaterial.diffuseTexture = handHaloTexture;
    handHaloMaterial.useAlphaFromDiffuseTexture = true;
    handHaloMaterial.emissiveColor = Color3.FromHexString("#9637F2");
    handHaloMaterial.disableDepthWrite = true;
    handHaloMaterial.backFaceCulling = false;
    handHaloMaterial.alphaMode = Engine.ALPHA_ADD;
    handHaloMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    const handHalo = MeshBuilder.CreatePlane(
      "rinaElectricHandHalo", { size: 0.78 }, scene
    );
    handHalo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    handHalo.material = handHaloMaterial;
    handHalo.isPickable = false;
    handHalo.setEnabled(false);
    glow.addExcludedMesh(handHalo);
    cleanup.push(() => {
      handHalo.dispose(false, false);
      handHaloMaterial.dispose(false, false);
      handHaloTexture.dispose();
    });
    // The performers must write their silhouettes into the glow layer's depth
    // buffer, or LEDs and light shafts behind them bleed across their bodies.
    // Their imported materials have no emissive contribution of their own.
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
    const singingPoint = new RinaSingingPointAction(scene, rina);
    cleanup.push(() => singingPoint.dispose());
    let handEffectRunning = false;
    const performance = createRinaPerformance(
      rina,
      stage.rinaPosition.scale(RINA_STADIUM_SCALE),
      stage.catwalkSingerPosition.scale(RINA_STADIUM_SCALE),
      singingPoint
    );
    // The phone shutter passes its NPC's world foot position here.
    scene.metadata ??= {};
    const photoAttack = {
      lastShutterFanId: null as string | null,
      lastReactedFanId: null as string | null,
      trigger: (photographerWorldPosition: Vector3, force = false) =>
        performance.pointAtPhotographer(photographerWorldPosition, force),
      get active() { return singingPoint.active; },
      get pointing() { return singingPoint.pointing; },
      get weight() { return singingPoint.blendWeight; },
      get elapsed() { return singingPoint.attackElapsed; },
    };
    scene.metadata.rinaPhotoAttack = photoAttack;
    if (import.meta.env.DEV) {
      const previewPoint = (event: KeyboardEvent) => {
        if (event.code === "F10" && !event.repeat) {
          performance.pointAtPhotographer(player.position, true);
        }
      };
      window.addEventListener("keydown", previewPoint);
      cleanup.push(() => window.removeEventListener("keydown", previewPoint));
    }
    const liveScreens = createRinaLiveScreens(scene, rina, context.performanceTier);
    stage.setLiveFeed(liveScreens.feed);
    const phoneStageMeshes = [
      ...rinaMeshes,
      scene.getMeshByName("rinaMainStage"),
      scene.getMeshByName("rinaStageCatwalk"),
      scene.getMeshByName("rinaStageCenterTower"),
      ...scene.meshes.filter(mesh => mesh.name.startsWith("rinaStageCenterLed_")),
    ].filter((mesh): mesh is Mesh => mesh instanceof Mesh);
    let absorption: RinaPhotoAbsorption | null = null;
    const audiencePhones = await createRinaAudiencePhoneIntegration(
      scene, context.performanceTier,
      "phoneRigs" in crowdPreview ? crowdPreview.phoneRigs : [],
      phoneStageMeshes, rina.root.position,
      (photographerWorldPosition, candidate) => {
        photoAttack.lastShutterFanId = candidate.id;
        if (photoAttack.trigger(photographerWorldPosition)) {
          photoAttack.lastReactedFanId = candidate.id;
          absorption?.start(candidate);
        }
      },
    );
    absorption = new RinaPhotoAbsorption(scene, rina, singingPoint, glow,
      id => audiencePhones.phones.retire(id), rinaMeshes);
    const photoAbsorption = absorption;
    cleanup.push(() => photoAbsorption.dispose());
    scene.metadata.rinaAbsorption = {
      get phase() { return photoAbsorption.phase; },
      get victimId() { return photoAbsorption.activeVictimId; },
      get color() { return photoAbsorption.activeColor; },
      get chargeElapsed() { return photoAbsorption.chargeElapsed; },
      get arcVisible() { return photoAbsorption.arcVisible; },
      get arcEndpoints() { return photoAbsorption.arcEndpoints?.map(point => point.asArray()) ?? null; },
      get arcMidpoint() { return photoAbsorption.arcMidpoint?.asArray() ?? null; },
      get victimTarget() { return photoAbsorption.victimTarget?.asArray() ?? null; },
      get lastTransformationAt() { return photoAbsorption.lastTransformationAt; },
      get orbPosition() { return photoAbsorption.orbPosition?.asArray() ?? null; },
      get lastAbsorbedId() { return photoAbsorption.lastAbsorbedId; },
      get lastAbsorbedColor() { return photoAbsorption.lastAbsorbedColor; },
      triggerFan(id: string) {
        const candidate = "phoneRigs" in crowdPreview
          ? crowdPreview.phoneRigs.find(rig => rig.id === id) : null;
        if (!candidate || !photoAbsorption.canStart(candidate)) return false;
        const position = Vector3.Zero();
        candidate.getWorldFootPositionToRef(position);
        if (!photoAttack.trigger(position, true)) return false;
        if (!photoAbsorption.start(candidate)) return false;
        photoAttack.lastReactedFanId = candidate.id;
        return true;
      },
    };
    if ("setPhoneScreenTexture" in crowdPreview) {
      crowdPreview.setPhoneScreenTexture(audiencePhones.phones.feed);
    }
    cleanup.push(() => audiencePhones.dispose());
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
      crowdSystem: fieldCrowdMazeLayout ? "field-maze" : "preview-only",
    };

    const update = (unclampedDt: number) => {
      const dt = Math.min(0.05, Math.max(0, unclampedDt));
      elapsed += dt;

      player.update(dt, playerWorld);
      collisionDebug?.update(player.position);
      rinaElectricFX.update(dt);
      const music = context.musicPlayer?.getMusicPlaybackState() ?? null;
      audienceAudio?.update(music);
      performance.update(dt, music);
      const handEnergy = singingPoint.blendWeight;
      rinaHandElectricFX.setStrength(handEnergy);
      if (handEnergy > 0.02 && !handEffectRunning) {
        rinaHandElectricFX.startContinuous();
        handEffectRunning = true;
      } else if (!singingPoint.active && handEffectRunning) {
        rinaHandElectricFX.stop(0.3);
        handEffectRunning = false;
      }
      rinaHandElectricFX.update(dt);
      photoAbsorption.update(dt);
      handHalo.setEnabled(handEnergy > 0.01);
      if (handEnergy > 0.01) {
        leftHand.computeWorldMatrix(true);
        handHalo.position.copyFrom(leftHand.getAbsolutePosition());
        const pulse = 0.78 + 0.22 * Math.sin(elapsed * 15) +
          0.1 * Math.sin(elapsed * 31);
        handHalo.visibility = Math.min(1, handEnergy * Math.max(0.4, pulse) * 1.25);
        handHalo.scaling.setAll(0.96 + 0.12 * Math.sin(elapsed * 15 + 0.3));
      }
      liveScreens.update();
      const { beatPulse, strobe } = stage.update(
        dt, music, rina.root.position.z / RINA_STADIUM_SCALE,
        rina.root.rotation.y, player.position,
        Vector3.TransformCoordinates(player.camera.position, player.root.computeWorldMatrix(true)),
        pyro, playPyroBurst
      );
      strobePostProcess.update(strobe);
      stageArchitecture.update(dt, music, beatPulse);
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
      stormSky.update(player.camera.globalPosition, dt);
      desktopSkyStorm?.update(player.camera.globalPosition, dt);
      crowdPreview.update(elapsed, beatPulse, music);
      audiencePhones.update(dt, rina.root.position);
      standsCrowd.update(dt, beatPulse, music);
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
            audienceAudio?.start();
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
