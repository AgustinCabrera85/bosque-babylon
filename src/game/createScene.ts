import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { RockLibrary } from "./RockLibrary";
import { createTerrain } from "./Terrain";
import {
  PlayerController,
  type CharacterId,
  type ViewMode,
} from "./PlayerController";
import { setupPlayerViewControls } from "./PlayerViewControls";
import { Segments } from "./Segments";
import { TreeLibrary } from "./TreeLibrary";
import { GrassLibrary } from "./GrassLibrary";
import { PlantLibrary } from "./PlantLibrary";
import { InteractSystem } from "./InteractSystem";
import { setupMobileControls } from "./MobileControls";
import { createDirectionIndicator } from "./DirectionIndicator";
import { createRainSystem } from "./Rain";
import { createFireflies } from "./Fireflies";
import { createEndTorches } from "./Torches";
import { createVintageFilmPostProcess, fridayThe13thVintagePreset } from "./VintageFilmPostProcess";
import { createLagoonUnderwaterEffect } from "./LagoonUnderwaterEffect";
import { isFluidWaterfallPreset } from "./FluidWaterfallController";
import { TERMINAL_LAGOON_VISUAL_CONFIG } from "./TerminalLagoonVisualConfig";
import { WaterContactSystem } from "./WaterContactSystem";
import { WaterInteractionVFX } from "./WaterInteractionVFX";
import { WaterSurfaceRegistry } from "./WaterSurface";
import type { MusicPlayerHandle } from "./MusicPlayer";
import type { InventoryHandle } from "./Inventory";
import {
  PlayerAttackSystem,
  type LightProjectileAttackTarget,
} from "./PlayerAttackSystem";
import { PlayerLightAbsorptionVFX } from "./PlayerLightAbsorptionVFX";
import { PlayerHitBloodVFX } from "./PlayerHitBloodVFX";
import {
  PlayerDeathSequence,
  type PlayerDeathChoice,
} from "./PlayerDeathSequence";
import { PlayerStatsSystem } from "./PlayerStatsSystem";
import type { PlayerHitReactionZone } from "./animation/PlayerReaction";
import {
  PlayerSurvivalSystem,
  isPlayerPhysicallySurrounded,
} from "./PlayerSurvivalSystem";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { PhotoDome } from "@babylonjs/core/Helpers/photoDome";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator"; 
import { Light } from "@babylonjs/core/Lights/light";
import { ShadowAuraController } from "./ShadowAura";
import { createShadowAuraDebugControls } from "./ShadowAuraDebug";
import { CharacterContactShadow } from "./CharacterContactShadow";
import {
  DEFAULT_END_HOUSE_SEGMENT,
  DEFAULT_WORLD_SEGMENT_LENGTH,
  TerminalLandmarkGenerator,
  createTerminalLandmarkConfig,
  createTerminalTerrainModifier,
} from "./TerminalLandmark";
import {
  enforceSceneMaterialLightBudget,
  installSceneMaterialLightBudgetGuard,
  synchronizeSceneLightPriorities,
} from "../materials";
import {
  EnemyManager,
  SKY_EYE_TYPE,
  SHADOW_GRABBER_TYPE,
  ShadowGrabberBehaviorSystem,
  registerSkyEye,
  registerShadowGrabber,
  spawnSkyEye,
} from "./enemies";
import { loadInitialForestEnemies } from "./levels/ForestEnemySpawns";
import { HouseArrivalCinematic } from "./levels/HouseArrivalCinematic";
import { TerminalSkyEyeEncounter } from "./levels/TerminalSkyEyeEncounter";
import { BlackSmokeWrapSystem } from "./BlackSmokeWrapSystem";
import type { CursorController } from "./input/CursorController";
import type { InputManager } from "./input/InputManager";
import { EnemyHealthHud } from "./EnemyHealthHud";
import { createThoughtMessages } from "./ThoughtMessages";
import {
  HERMANO_MAYOR_VISION_SEGMENT_MULTIPLIER,
  HermanoMayorBehavior,
} from "./enemies/boss";
import { HermanoMayorGrabHud } from "./enemies/boss/HermanoMayorGrabHud";
import { HermanoMayorAxeDodgeHud } from "./enemies/boss/HermanoMayorAxeDodgeHud";
import { HermanoMayorAxePickupCinematic } from "./enemies/boss/HermanoMayorAxePickupCinematic";
import { HermanoMayorForestCrossingCinematic } from "./levels/HermanoMayorForestCrossingCinematic";
import { renderActionPrompt } from "./input/InputPrompts";
import type { GameAction } from "./input/InputActions";
import { setHermanoMayorGrabHapticsActive } from "./input/GamepadFeedback";
import { ForestPlayerWorld } from "./levels/forest/ForestPlayerWorld";



// ✅ Vite url imports (desde src/assets)
const pathUrl = "/assets/models/textures/terrain/ground_camino/ground.jpg";
const SKY_DESKTOP_URL = "/assets/hdr/forest_night_4k.jpg";
const SKY_MOBILE_URL = "/assets/hdr/hdr_high.png";
const BASE_FOG_DENSITY = 0.021;
const ISO_FOG_DENSITY = 0.011;
const BASE_HEMI_INTENSITY = 0.015;
const ISO_HEMI_INTENSITY = 0.12;
const BASE_MOON_INTENSITY = 0.045;
const ISO_MOON_INTENSITY = 0.12;
const BASE_HEMI_GROUND_COLOR = new Color3(0.01, 0.01, 0.01);
const ISO_HEMI_GROUND_COLOR = new Color3(0.035, 0.043, 0.037);
const ISO_VINTAGE_PRESET = {
  ...fridayThe13thVintagePreset,
  grainIntensity: 0.08,
  vignetteIntensity: 0.16,
  edgeBlur: 0.62,
  scanlineIntensity: 0.1,
  contrast: 1.02,
  saturation: 0.82,
  exposure: 1.34,
};
type LoadingProgress = (value: number, text: string) => void;
export const FOREST_KEY_CHECKPOINT_ENTRY_POINT = "checkpoint:forest-key";
export const FOREST_START_CHECKPOINT_ENTRY_POINT = "checkpoint:forest-start";
export type ForestSceneRuntimeOptions = {
  entryPoint?: string;
  onPlayerDeathChoice?: (choice: PlayerDeathChoice, entryPoint: string) => void;
};
export type QualityProfile = {
  name: "desktop" | "mobile";
  terrainSegments: number;
  pathRows: number;
  photoDomeResolution: number;
  shadowMapSize: number;
  shadowBlurKernel: number;
  rainDrops: number;
  segmentBehind: number;
  segmentAhead: number;
  objectSegmentBehind: number;
  objectSegmentAhead: number;
  plantSegmentBehind: number;
  plantSegmentAhead: number;
  treeCount: number;
  rockCount: number;
  grassBuildCount: number;
  grassRingCounts: [number, number, number];
  plantBuildCount: number;
  plantRingCounts: [number, number, number];
  plantFarCount: number;
  grassWindInterval: number;
  treeTemplateLimit: number;
  rockTemplateLimit: number;
  grassTemplateLimit: number;
  plantTemplateLimit: number;
  fireflyCount: number;
};

export const desktopQuality: QualityProfile = {
  name: "desktop",
  terrainSegments: 180,
  pathRows: 160,
  photoDomeResolution: 96,
  shadowMapSize: 512,
  shadowBlurKernel: 8,
  rainDrops: 500,
  segmentBehind: 1,
  segmentAhead: 2,
  objectSegmentBehind: 1,
  objectSegmentAhead: 4,
  plantSegmentBehind: 1,
  plantSegmentAhead: 5,
  treeCount: 60,
  rockCount: 14,
  grassBuildCount: 4200,
  grassRingCounts: [4200, 1400, 180],
  plantBuildCount: 220,
  plantRingCounts: [220, 80, 25],
  plantFarCount: 12,
  grassWindInterval: 0,
  treeTemplateLimit: Number.POSITIVE_INFINITY,
  rockTemplateLimit: Number.POSITIVE_INFINITY,
  grassTemplateLimit: Number.POSITIVE_INFINITY,
  plantTemplateLimit: Number.POSITIVE_INFINITY,
  fireflyCount: 8,
};

export const mobileQuality: QualityProfile = {
  name: "mobile",
  terrainSegments: 110,
  pathRows: 72,
  photoDomeResolution: 48,
  shadowMapSize: 0,
  shadowBlurKernel: 0,
  rainDrops: 120,
  segmentBehind: 0,
  segmentAhead: 1,
  objectSegmentBehind: 0,
  objectSegmentAhead: 3,
  plantSegmentBehind: 0,
  plantSegmentAhead: 5,
  treeCount: 58,
  rockCount: 7,
  grassBuildCount: 1200,
  grassRingCounts: [1200, 320, 0],
  plantBuildCount: 80,
  plantRingCounts: [80, 25, 0],
  plantFarCount: 6,
  grassWindInterval: 0.08,
  treeTemplateLimit: 3,
  rockTemplateLimit: 3,
  grassTemplateLimit: 2,
  plantTemplateLimit: 2,
  fireflyCount: 5,
};

function createPathMesh(
  scene: Scene,
  terrain: ReturnType<typeof createTerrain>,
  rows: number,
  startZ = -terrain.size / 2,
  endZ = terrain.size / 2
) {
  const width = 9;
  const halfWidth = width / 2;
  const length = endZ - startZ;
  const cols = 4;

  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (let iz = 0; iz <= rows; iz++) {
    const z = startZ + (iz / rows) * length;

    for (let ix = 0; ix <= cols; ix++) {
      const x = -halfWidth + (ix / cols) * width;
      const y = terrain.getHeightAt(x, z) + 0.08;

      positions.push(x, y, z);
      uvs.push(ix / cols, (z - startZ) / length);
    }
  }

  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const a = iz * (cols + 1) + ix;
      const b = a + 1;
      const c = a + (cols + 1);
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  VertexData.ComputeNormals(positions, indices, normals);

  const path = new Mesh("path", scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(path);

  path.isPickable = false;
  path.receiveShadows = true;
  path.alwaysSelectAsActiveMesh = true;

  return path;
}

export async function createScene(
  engine: Engine,
  canvas: HTMLCanvasElement,
  onProgress: LoadingProgress = () => {},
  quality: QualityProfile = desktopQuality,
  selectedCharacter: CharacterId = "lautaro",
  musicPlayer: MusicPlayerHandle | null = null,
  inventory: InventoryHandle | undefined,
  input: InputManager,
  sharedPlayerStats?: PlayerStatsSystem,
  prepareOpeningSequence = true,
  cursorController?: CursorController,
  runtimeOptions: ForestSceneRuntimeOptions = {}
) {
  onProgress(0.08, "Creando escena...");
  const useAxePickupDebugLighting =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("debugAxePickup") === "1";
  const scene = new Scene(engine);
  scene.onDisposeObservable.addOnce(() => {
    cursorController?.setCursorRequest("interaction", null);
  });
  installSceneMaterialLightBudgetGuard(scene);
  const blackSmokeWrapSystem = new BlackSmokeWrapSystem(
    scene,
    quality.name === "mobile" ? "low" : "medium"
  );
  const enemyManager = new EnemyManager(scene);
  registerShadowGrabber(enemyManager, blackSmokeWrapSystem);
  registerSkyEye(enemyManager, blackSmokeWrapSystem);
  scene.metadata ??= {};
  scene.metadata.blackSmokeWrapSystem = blackSmokeWrapSystem;
  scene.metadata.enemyManager = enemyManager;
  scene.onDisposeObservable.addOnce(() => blackSmokeWrapSystem.dispose());
  scene.onDisposeObservable.addOnce(() => enemyManager.dispose());
  // Water-contact and waterfall alpha effects render after WaterMaterial, but
  // must keep the opaque world's depth or they appear through the whole map.
  scene.setRenderingAutoClearDepthStencil(1, false, false, false);

  // =========================
  // Fog lúgubre (NOCHE)
  // =========================
  // EXP2: densa y natural PERO con densidad baja (0.05 era demasiado)
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = new Color3(0.014, 0.017, 0.022); // casi negro azulado
  scene.fogDensity = BASE_FOG_DENSITY; // probá 0.010..0.018
  if (useAxePickupDebugLighting) {
    scene.fogMode = Scene.FOGMODE_NONE;
    scene.fogColor.set(0.58, 0.72, 0.88);
    scene.fogDensity = 0;
  }

  // Para que el "horizonte" no se vea raro detrás de todo
  scene.clearColor = new Color4(
    scene.fogColor.r,
    scene.fogColor.g,
    scene.fogColor.b,
    1
  );

// =========================
// LUCES (NOCHE)
// =========================
const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
hemi.intensity = BASE_HEMI_INTENSITY; // MUY bajo
hemi.groundColor = BASE_HEMI_GROUND_COLOR.clone();
if (useAxePickupDebugLighting) {
  hemi.intensity = 1.15;
  hemi.diffuse = new Color3(1, 0.97, 0.9);
  hemi.groundColor.set(0.34, 0.38, 0.42);
}

const moon = new DirectionalLight("moon", new Vector3(-0.35, -1, 0.25), scene);
moon.position = new Vector3(60, 120, 40);
moon.intensity = BASE_MOON_INTENSITY; // suave
moon.diffuse = new Color3(0.6, 0.65, 0.9);
moon.specular = new Color3(0, 0, 0);
if (useAxePickupDebugLighting) {
  moon.intensity = 0.78;
  moon.diffuse.set(1, 0.92, 0.78);
}


  // =========================
  // Terreno
  // =========================
onProgress(0.18, "Generando terreno...");
const mapLayout = {
  segmentLength: DEFAULT_WORLD_SEGMENT_LENGTH,
  endHouseSegment: DEFAULT_END_HOUSE_SEGMENT,
};
const terminalConfig = createTerminalLandmarkConfig(mapLayout);
const terrain = createTerrain(scene, {
  size: 1600,
  segments: quality.terrainSegments,
  pathHalfWidth: 4,
  flatAreas: [
    {
      x: 0,
      z: mapLayout.segmentLength * mapLayout.endHouseSegment + 18,
      width: 118,
      depth: 146,
      height: 0,
      fade: 32,
    },
  ],

  mountainStart: 55,    // antes 26
  mountainEnd: 95,      // antes 48
  mountainHeight: 34,   // un poco más alto
  playableHalfWidth: 52, // antes de montaña
  heightModifiers: [createTerminalTerrainModifier(terminalConfig)],
});
const playerWorld = new ForestPlayerWorld(terrain, {
  pathHalfWidth: 4.5,
  pathStartZ: -terrain.size / 2,
  pathEndZ: mapLayout.segmentLength * mapLayout.endHouseSegment - 8,
  pathSurfaceOffset: 0.1,
});


  // =========================
  // Sendero plano (opcional)
  // =========================
  const path = createPathMesh(
    scene,
    terrain,
    quality.pathRows,
    undefined,
    mapLayout.segmentLength * mapLayout.endHouseSegment - 8
  );

  const pathMat = new StandardMaterial("pathMat", scene);
  const pathTex = new Texture(pathUrl, scene);
  pathTex.wrapU = Texture.WRAP_ADDRESSMODE;
  pathTex.wrapV = Texture.WRAP_ADDRESSMODE;
  pathTex.anisotropicFilteringLevel = 4;
  pathTex.uScale = 1;
  pathTex.vScale = 70;

  pathMat.diffuseTexture = pathTex;
  pathMat.specularColor = new Color3(0, 0, 0);
  // Oscurecer un toque el camino para que no “brille”
  pathMat.diffuseColor = new Color3(0.75, 0.75, 0.75);
  pathMat.maxSimultaneousLights = 8;
  path.material = pathMat;

  // =========================
  // SKY (PhotoDome PNG 360)
  // =========================
  onProgress(0.3, "Cargando cielo...");
  const skyUrl = quality.name === "desktop" ? SKY_DESKTOP_URL : SKY_MOBILE_URL;
  const photoDome = new PhotoDome(
    "skyDome",
    skyUrl,
    {
      resolution: quality.photoDomeResolution,
      size: 3000,
      faceForward: false,
    },
    scene
  );

  // Keep the detailed horizon away from the zenith and expose more of the
  // panorama so stars and mountains retain their natural scale.
  photoDome.fovMultiplier = 1.28;
  photoDome.rotation.y = Math.PI * 0.32;
  photoDome.mesh.infiniteDistance = true;
  photoDome.mesh.isPickable = false;
  photoDome.mesh.renderingGroupId = 0;
  photoDome.mesh.setEnabled(!useAxePickupDebugLighting);
  photoDome.photoTexture.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
  photoDome.photoTexture.anisotropicFilteringLevel = quality.name === "desktop" ? 4 : 2;

  // ✅ el cielo NO debe recibir fog
  // (PhotoDome.material no siempre tipa fogEnabled, por eso el cast)
  (photoDome.material as any).fogEnabled = false;

  // ✅ “bajar” la potencia visual del cielo (si está muy brillante)
  // (depende del material que use internamente)
  photoDome.material.primaryColor.set(0.72, 0.82, 1);

  photoDome.onLoadObservable.add(() => {
    console.log("✔ PhotoDome loaded:", skyUrl);
  });

  // =========================
  // Player
  // =========================
  const player = new PlayerController(scene, canvas, input, {
    eyeHeight: 1.7,
    walkSpeed: 2.8,
    runSpeed: 6.8,
    jumpSpeed: 6.2,
    gravity: -18.0,
  }, selectedCharacter);
  const thoughtMessages = createThoughtMessages();
  scene.onDisposeObservable.addOnce(() => thoughtMessages.dispose());
  const disposeViewModeControls = setupPlayerViewControls(player);
  scene.onDisposeObservable.addOnce(disposeViewModeControls);
  const vintageFilm = createVintageFilmPostProcess(scene, player.camera, {
    enabled: true,
    intensity: 0,
  });

  player.onViewModeChange((mode) => {
    const isIso = mode === "iso";
    scene.fogDensity = isIso ? ISO_FOG_DENSITY : BASE_FOG_DENSITY;
    hemi.intensity = isIso ? ISO_HEMI_INTENSITY : BASE_HEMI_INTENSITY;
    moon.intensity = isIso ? ISO_MOON_INTENSITY : BASE_MOON_INTENSITY;
    hemi.groundColor.copyFrom(isIso ? ISO_HEMI_GROUND_COLOR : BASE_HEMI_GROUND_COLOR);
    vintageFilm.update(isIso ? ISO_VINTAGE_PRESET : fridayThe13thVintagePreset);
  });

  onProgress(0.36, "Cargando personaje...");
  await player.loadCharacter();
  const playerContactShadow = new CharacterContactShadow(
    scene,
    {
      root: player.root,
      getGroundHeight: (x, z) => player.getWalkableSurfaceHeight(playerWorld, x, z),
      getFootPositionToRef: (result) => player.getGroundContactPositionToRef(result),
    },
    {
      name: "player",
      radiusX: 0.52,
      radiusZ: 0.36,
      opacity: 0.34,
    }
  );
  const shadowAura = new ShadowAuraController(
    scene,
    {
      root: player.root,
      avatarMeshes: player.getAvatarMeshes(),
      getGroundSurfaceHeightAt: (x, z) => player.getWalkableSurfaceHeight(playerWorld, x, z),
    },
    {
      performance: {
        allowFlames: true,
        qualityLevel: quality.name === "desktop" ? "high" : "low",
      },
    }
  );
  const ownsPlayerStats = !sharedPlayerStats;
  const playerStats = sharedPlayerStats ?? new PlayerStatsSystem({
      inventory,
      debug:
        import.meta.env.DEV &&
        new URLSearchParams(window.location.search).get("debugSurvival") === "1",
    });
  const playerLightAbsorptionVfx = new PlayerLightAbsorptionVFX(scene, {
    getGroundPositionToRef: (result) => player.getGroundContactPositionToRef(result),
  });
  let auraHealth = Number.NaN;
  let auraSanity = Number.NaN;
  let animatedHealth = playerStats.snapshot.health;
  let playerDeathSequence: PlayerDeathSequence | null = null;
  const unsubscribePlayerStatsAura = playerStats.onChange((event) => {
    if (event.type === "light-orb-absorbed") playerLightAbsorptionVfx.play();
    const tookDamage = event.snapshot.health < animatedHealth;
    const wasAlive = animatedHealth > 0;
    if (tookDamage && event.snapshot.health <= 0 && wasAlive) {
      player.clearEnemyGrabStruggles();
      playerDeathSequence?.start();
    } else if (tookDamage) {
      player.playHitReaction();
    }
    animatedHealth = event.snapshot.health;
    const health = event.snapshot.health / event.snapshot.maxHealth;
    const sanity = event.snapshot.sanity / event.snapshot.maxSanity;
    if (health !== auraHealth) {
      auraHealth = health;
      shadowAura.setHealth(health);
    }
    if (sanity !== auraSanity) {
      auraSanity = sanity;
      shadowAura.setSanity(sanity);
      // At full Cordura the shader is an exact pass-through. Its VHS treatment
      // then grows linearly until reaching the authored preset at zero Cordura.
      vintageFilm.setIntensity(1 - sanity);
    }
    if (event.type === "low-sanity-perception") {
      window.dispatchEvent(
        new CustomEvent("bosque:low-sanity-perception", {
          detail: { sanity: event.snapshot.sanity },
        })
      );
    }
  });
  const shadowAuraDebug = createShadowAuraDebugControls(shadowAura);
  player.onViewModeChange((mode) => {
    const avatarVisible = mode !== "first";
    shadowAura.setVisible(avatarVisible);
    playerContactShadow.setVisible(avatarVisible);
  });
  const requestedShadowView = new URLSearchParams(window.location.search).get("shadowView");
  if (
    requestedShadowView === "first" ||
    requestedShadowView === "third" ||
    requestedShadowView === "front" ||
    requestedShadowView === "iso"
  ) {
    player.setViewMode(requestedShadowView);
  }
  scene.onDisposeObservable.add(() => {
    player.clearEnemyGrabStruggles();
    unsubscribePlayerStatsAura();
    playerLightAbsorptionVfx.dispose();
    if (ownsPlayerStats) playerStats.dispose();
    else playerStats.resetTransientLevelState();
    shadowAuraDebug.dispose();
  });

// =========================
// 🔦 FLASHLIGHT (SpotLight)
// =========================
const FLASHLIGHT_BASE_INTENSITY = 4.4;
const FLASHLIGHT_FILL_BASE_INTENSITY = 0.68;
const FLASHLIGHT_REACH_BASE_INTENSITY = 0.78;
const FLASHLIGHT_PRIMARY_RENDER_PRIORITY = 30;
const FLASHLIGHT_FILL_RENDER_PRIORITY = 29;
const initialLook = player.getFlashlightRay();
const flashlight = new SpotLight(
  "flashlight",
  initialLook.origin.clone(),
  initialLook.direction.clone(),
  Math.PI / 4.6,
  1,
  scene
);

// Falloff más “físico”
flashlight.falloffType = Light.FALLOFF_GLTF;
flashlight.innerAngle = Math.PI / 13;

flashlight.intensity = FLASHLIGHT_BASE_INTENSITY;
flashlight.range = 52;
flashlight.renderPriority = FLASHLIGHT_PRIMARY_RENDER_PRIORITY;

flashlight.diffuse = new Color3(1.0, 0.96, 0.88); // cálida
flashlight.specular = new Color3(0, 0, 0);

const flashlightFill = new SpotLight(
  "flashlightFill",
  initialLook.origin.clone(),
  initialLook.direction.clone(),
  Math.PI / 2.45,
  1,
  scene
);

flashlightFill.falloffType = Light.FALLOFF_GLTF;
flashlightFill.innerAngle = Math.PI / 9.5;
flashlightFill.intensity = FLASHLIGHT_FILL_BASE_INTENSITY;
flashlightFill.range = 42;
flashlightFill.renderPriority = FLASHLIGHT_FILL_RENDER_PRIORITY;
flashlightFill.diffuse = new Color3(0.82, 0.74, 0.58);
flashlightFill.specular = new Color3(0, 0, 0);

const flashlightReach = new SpotLight(
  "flashlightReach",
  initialLook.origin.clone(),
  initialLook.direction.clone(),
  Math.PI / 2.2,
  1,
  scene
);

flashlightReach.falloffType = Light.FALLOFF_STANDARD;
flashlightReach.intensity = FLASHLIGHT_REACH_BASE_INTENSITY;
flashlightReach.range = 125;
flashlightReach.diffuse = new Color3(0.72, 0.70, 0.62);
flashlightReach.specular = new Color3(0, 0, 0);

const frontViewFill = new SpotLight(
  "frontViewFill",
  player.camera.globalPosition.clone(),
  player.getLookRay().direction.clone(),
  Math.PI / 2.2,
  1.4,
  scene
);
frontViewFill.falloffType = Light.FALLOFF_GLTF;
frontViewFill.intensity = 0;
frontViewFill.range = 9;
frontViewFill.diffuse = new Color3(0.72, 0.76, 0.68);
frontViewFill.specular = new Color3(0, 0, 0);

const flashlightLights = [flashlight, flashlightFill, flashlightReach];
let flashlightEnabled = true;
let flashlightShadowMap: RenderTargetTexture | null = null;
const flashlightButton = document.getElementById("flashlightButton") as HTMLButtonElement | null;
const setFlashlightEnabled = (enabled: boolean) => {
  flashlightEnabled = enabled;
  flashlight.intensity = enabled ? FLASHLIGHT_BASE_INTENSITY : 0;
  flashlightFill.intensity = enabled ? FLASHLIGHT_FILL_BASE_INTENSITY : 0;
  flashlightReach.intensity = enabled ? FLASHLIGHT_REACH_BASE_INTENSITY : 0;
  // Keep the lights in every material's stable light list. Calling setEnabled
  // here invalidates shader variants across the visible forest on the first
  // toggle; zero intensity produces the same image without that runtime spike.
  if (flashlightShadowMap) {
    flashlightShadowMap.refreshRate = enabled
      ? RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME
      : RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    flashlightShadowMap.resetRefreshCounter();
  }
  flashlightButton?.classList.toggle("active", enabled);
  flashlightButton?.setAttribute("aria-pressed", String(enabled));
};

const onFlashlightButtonClick = (event: Event) => {
  event.stopPropagation();
  setFlashlightEnabled(!flashlightEnabled);
};
flashlightButton?.addEventListener("click", onFlashlightButtonClick);
scene.onDisposeObservable.addOnce(() => {
  flashlightButton?.removeEventListener("click", onFlashlightButtonClick);
});

// Sombras (opcional pero suma MUCHO)
if (quality.shadowMapSize > 0) {
const shadows = new ShadowGenerator(quality.shadowMapSize, flashlight);
shadows.useBlurExponentialShadowMap = true;
shadows.blurKernel = quality.shadowBlurKernel;
shadows.darkness = 0.65;
flashlightShadowMap = shadows.getShadowMap();

// Si tenés meshes importantes:
scene.meshes.forEach(m => {
  if (m.name === "terrain") shadows.addShadowCaster(m, true);
  // y tus árboles/rocas si querés:
  // shadows.addShadowCaster(m, true);
});
}

// Update por frame + flicker muy leve
let t = 0;
scene.onBeforeRenderObservable.add(() => {
  const look = player.getFlashlightRay();
  const pos = look.origin;
  const dir = look.direction;

  flashlight.position.copyFrom(pos);
  flashlight.direction.copyFrom(dir);
  flashlightFill.position.copyFrom(pos);
  flashlightFill.direction.copyFrom(dir);
  flashlightReach.position.copyFrom(pos);
  flashlightReach.direction.copyFrom(dir);

  const frontFillTarget = player.position.add(new Vector3(0, -0.35, 0));
  const frontFillDirection = frontFillTarget.subtract(player.camera.globalPosition);
  if (frontFillDirection.lengthSquared() > 0) frontFillDirection.normalize();
  frontViewFill.position.copyFrom(player.camera.globalPosition);
  frontViewFill.direction.copyFrom(frontFillDirection);
  frontViewFill.intensity = player.currentViewMode === "front" ? 0.55 : 0;

  if (!flashlightEnabled) {
    flashlightLights.forEach((light) => (light.intensity = 0));
    return;
  }

  // micro flicker (casi imperceptible)
  t += scene.getEngine().getDeltaTime() * 0.001;
  const flicker = Math.sin(t * 17.0) * 0.05 + Math.sin(t * 7.0) * 0.035;
  flashlight.intensity = FLASHLIGHT_BASE_INTENSITY + flicker;
  flashlightFill.intensity = FLASHLIGHT_FILL_BASE_INTENSITY + flicker * 0.25;
  flashlightReach.intensity = FLASHLIGHT_REACH_BASE_INTENSITY + flicker * 0.12;
});


  // =========================
  // Libraries
  // =========================
  const treeLibrary = new TreeLibrary();
  const grassLibrary = new GrassLibrary();
  const plantLibrary = new PlantLibrary();
  const rockLibrary = new RockLibrary();

  onProgress(0.45, "Cargando arboles y rocas...");
  await Promise.all([
    treeLibrary.load(scene, quality.treeTemplateLimit),
    rockLibrary.load(scene, quality.rockTemplateLimit),
  ]);
  onProgress(0.72, "Cargando vegetacion...");
  await Promise.all([
    grassLibrary.load(scene, quality.grassTemplateLimit),
    plantLibrary.load(scene, quality.plantTemplateLimit),
  ]);

  // =========================
  // Segmentos
  // =========================
  const segments = new Segments(scene, terrain, treeLibrary, grassLibrary, plantLibrary, rockLibrary, {
    segmentLength: mapLayout.segmentLength,
    endHouseSegment: mapLayout.endHouseSegment,
    maxGeneratedSegment: mapLayout.endHouseSegment,
    behind: quality.segmentBehind,
    ahead: quality.segmentAhead,
    objectBehind: quality.objectSegmentBehind,
    objectAhead: quality.objectSegmentAhead,
    plantBehind: quality.plantSegmentBehind,
    plantAhead: quality.plantSegmentAhead,
    treeCount: quality.treeCount,
    rockCount: quality.rockCount,
    grassBuildCount: quality.grassBuildCount,
    grassRingCounts: quality.grassRingCounts,
    plantBuildCount: quality.plantBuildCount,
    plantRingCounts: quality.plantRingCounts,
    plantFarCount: quality.plantFarCount,
    brazierFireQuality: quality.name === "mobile" ? "low" : "high",
  }, inventory);
  playerWorld.setSegments(segments);

  onProgress(0.86, "Cargando casa...");
  await segments.loadCandles();
  await Promise.all([
    segments.loadStartBlocker(),
    segments.loadForestKey(),
    segments.loadEndHouse(
      terminalConfig.lagoonCenterZ - terminalConfig.lagoonRadiusZ
    ),
    enemyManager.preload(SHADOW_GRABBER_TYPE),
    enemyManager.preload(SKY_EYE_TYPE),
  ]);
  const forestKeyCheckpoint = segments.getForestKeyCheckpoint();
  let forestKeyCheckpointReached =
    runtimeOptions.entryPoint === FOREST_KEY_CHECKPOINT_ENTRY_POINT;
  if (forestKeyCheckpointReached) {
    player.position.set(
      forestKeyCheckpoint.x,
      forestKeyCheckpoint.y + player.getCollisionHeight(),
      forestKeyCheckpoint.z
    );
  }
  onProgress(0.89, "Preparando tramo final...");
  const waterfallQuery = new URLSearchParams(window.location.search);
  const fluidWaterfallEnabled = waterfallQuery.get("fluidWaterfall") === "1";
  const fluidWaterfallDebug =
    import.meta.env.DEV &&
    fluidWaterfallEnabled &&
    waterfallQuery.get("fluidWaterfallDebug") === "1";
  const requestedFluidPreset = waterfallQuery.get("fluidWaterfallPreset");
  const fluidWaterfallPreset = isFluidWaterfallPreset(requestedFluidPreset)
    ? requestedFluidPreset
    : "medium";
  const terminalLandmark = new TerminalLandmarkGenerator(
    scene,
    terrain,
    treeLibrary,
    rockLibrary,
    plantLibrary,
    {
      waterRenderTargetSize: quality.name === "mobile" ? 128 : 256,
      environmentReflectionMeshes: [photoDome.mesh],
      refractionOnlyMeshes: player.getAvatarMeshes(),
      visualConfig: TERMINAL_LAGOON_VISUAL_CONFIG,
      fluidWaterfall: {
        enabled: fluidWaterfallEnabled,
        debug: fluidWaterfallDebug,
        preset: fluidWaterfallPreset,
      },
      instantiateCandleAsset: (name, scale) =>
        segments.instantiateCandleAsset(name, scale),
    }
  ).generateWaterfallLagoonEnd(terminalConfig);
  terminalLandmark.waterfall.computeWorldMatrix(true);
  const waterfallTopY =
    terminalLandmark.waterfall.getBoundingInfo().boundingBox.maximumWorld.y;
  // The scaled eye extends about five units below its pivot. One extra unit
  // keeps the final pose fully above the water curtain from the shore view.
  const skyEyeHoverClearance = 6;
  const skyEyeHoverPosition = new Vector3(
    terminalConfig.lagoonCenterX,
    waterfallTopY + skyEyeHoverClearance,
    terminalLandmark.caveCandleFocusPoint.z + 0.45
  );
  const skyEye = await spawnSkyEye(enemyManager, {
    id: "terminal-sky-eye",
    type: SKY_EYE_TYPE,
    position: skyEyeHoverPosition,
    enabled: false,
    getTargetPosition: () => player.position,
  });
  for (const mesh of skyEye.meshes) {
    terminalLandmark.lagoonWaterMaterial.addToRenderList(mesh);
  }
  const skyEyeEncounter = new TerminalSkyEyeEncounter({
    player,
    eye: skyEye,
    waterSurface: terminalLandmark.waterSurface,
    hoverPosition: skyEyeHoverPosition,
  });
  const enemyHealthHud = new EnemyHealthHud(skyEye.id);
  scene.metadata.skyEyeEncounter = skyEyeEncounter;
  scene.onDisposeObservable.addOnce(() => skyEyeEncounter.dispose());
  scene.onDisposeObservable.addOnce(() => enemyHealthHud.dispose());
  if (import.meta.env.DEV) {
    const skyEyeDebug = {
      getSnapshot: () => skyEyeEncounter.getDebugSnapshot(),
      startPresentation: () => skyEyeEncounter.startPresentation(),
      finishPresentation: () => skyEyeEncounter.finishPresentation(),
    };
    const debugGlobal = globalThis as typeof globalThis & {
      __bosqueSkyEyeDebug?: typeof skyEyeDebug;
    };
    debugGlobal.__bosqueSkyEyeDebug = skyEyeDebug;
    scene.onDisposeObservable.addOnce(() => {
      if (debugGlobal.__bosqueSkyEyeDebug === skyEyeDebug) {
        delete debugGlobal.__bosqueSkyEyeDebug;
      }
    });
  }
  if (import.meta.env.DEV && terminalLandmark.fluidWaterfall) {
    const fluidWaterfallDiagnostics = {
      getSnapshot: () => terminalLandmark.fluidWaterfall!.getDebugSnapshot(),
    };
    scene.metadata ??= {};
    scene.metadata.fluidWaterfall = fluidWaterfallDiagnostics;
    const debugGlobal = globalThis as typeof globalThis & {
      __bosqueFluidWaterfallDebug?: typeof fluidWaterfallDiagnostics;
    };
    debugGlobal.__bosqueFluidWaterfallDebug = fluidWaterfallDiagnostics;
    scene.onDisposeObservable.addOnce(() => {
      if (debugGlobal.__bosqueFluidWaterfallDebug === fluidWaterfallDiagnostics) {
        delete debugGlobal.__bosqueFluidWaterfallDebug;
      }
    });
  }
  // The lagoon lights use explicit mesh lists to protect the global light
  // budget. Include the loaded avatar so a submerged third-person view keeps
  // the swimmer readable without adding another dynamic light.
  terminalLandmark.underwaterLight.includedOnlyMeshes.push(...player.getAvatarMeshes());
  terminalLandmark.waterfallImpactLight.includedOnlyMeshes.push(...player.getAvatarMeshes());
  const waterSurfaces = new WaterSurfaceRegistry();
  waterSurfaces.register(terminalLandmark.waterSurface);
  player.setWaterSurfaceRegistry(waterSurfaces);
  const waterInteractionVfx = new WaterInteractionVFX(scene);
  const waterContactSystem = new WaterContactSystem(waterSurfaces, waterInteractionVfx, {
    getContactPosition: (result) => player.getGroundContactPositionToRef(result),
    getMotionMode: () => player.waterLocomotionState,
  });
  if (import.meta.env.DEV) {
    const waterContactDebug = {
      getSnapshot: () => waterContactSystem.getDebugSnapshot(),
      getResourceCounts: () => ({
        rippleMeshes: scene.meshes.filter((mesh) =>
          mesh.name.startsWith("waterContactRipple_")
        ).length,
        splashSystems: scene.particleSystems.filter((system) =>
          system.name.startsWith("waterSplashPool_")
        ).length,
        rippleMaterials: scene.materials.filter(
          (material) => material.name === "waterContactRippleMaterial"
        ).length,
      }),
      getPlayerState: () => ({
        waterLocomotion: player.waterLocomotionState,
        viewMode: player.currentViewMode,
        isometricCameraAnchored: player.isUsingIsometricCameraAnchor,
        animation: player.currentAnimationName,
        openingSequenceActive: player.isOpeningSequenceActive,
        registeredAnimations: player.getRegisteredAnimationNames(),
      }),
      getSpatialState: () => {
        player.camera.getViewMatrix(true);
        const cameraPosition = player.camera.globalPosition;
        return {
          player: {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
            groundY: terrain.getHeightAt(player.position.x, player.position.z),
          },
          camera: {
            x: cameraPosition.x,
            y: cameraPosition.y,
            z: cameraPosition.z,
            groundY: terrain.getHeightAt(cameraPosition.x, cameraPosition.z),
          },
          waterLevel: terminalLandmark.waterSurface.waterLevel,
        };
      },
      pressDiveControl: () => {
        input.pulseTouchAction("waterAction");
      },
      setMovement: (x: number, y: number) => input.setTouchMovement(x, y),
      setViewMode: (mode: ViewMode) => player.setViewMode(mode),
      playThrowObject: () => player.playThrowObject(0),
      setSimulationActive: (active: boolean) => input.setTouchEnabled(active),
      playerRoot: player.root,
    };
    scene.metadata ??= {};
    scene.metadata.waterContact = waterContactDebug;
    const debugGlobal = globalThis as typeof globalThis & {
      __bosqueWaterContactDebug?: typeof waterContactDebug;
    };
    debugGlobal.__bosqueWaterContactDebug = waterContactDebug;
    scene.onDisposeObservable.addOnce(() => {
      if (debugGlobal.__bosqueWaterContactDebug === waterContactDebug) {
        delete debugGlobal.__bosqueWaterContactDebug;
      }
    });
  }
  scene.onDisposeObservable.addOnce(() => {
    waterContactSystem.dispose();
    waterInteractionVfx.dispose();
    waterSurfaces.clear();
  });
  musicPlayer?.configureWaterfallArea({
    position: terminalLandmark.waterfallImpactPoint,
    // On the center line this reaches silence where the authored forest path
    // ends, then rises smoothly through the terminal trail toward the lagoon.
    audibleRadius: terminalLandmark.waterfallImpactPoint.z - (terminalConfig.houseFrontZ - 8),
    fullVolumeRadius: 26,
    volumeScale: 0.72,
  });
  const lagoonUnderwaterEffect = createLagoonUnderwaterEffect(scene, player.camera, {
    surface: terminalLandmark.waterSurface,
    tuning: TERMINAL_LAGOON_VISUAL_CONFIG.underwater,
    getBaseFogDensity: () =>
      player.currentViewMode === "iso" ? ISO_FOG_DENSITY : BASE_FOG_DENSITY,
  });
  segments.reserveNoSpawnZone(terminalLandmark.generationExclusion);
  terminalLandmark.blockers.forEach((blocker) => segments.addStaticWorldBlocker(blocker));
  const endTorches = await createEndTorches(scene, terrain, {
    includedOnlyMeshes: [
      path,
      ...segments.getEndHouseMeshes(),
      ...terminalLandmark.root.getChildMeshes(false),
      ...player.getAvatarMeshes(),
    ],
  });
  createDirectionIndicator(scene, terrain, {
    camera: player.camera,
    canvas,
    getPlayerPosition: () => player.position,
    getCheckpoint: () => segments.getEndHouseCheckpoint(),
    getViewMode: () => player.currentViewMode,
  });

  // =========================
  // UI hints + interacción contextual
  // =========================
  const hints = {
    set(text: string | null, action?: GameAction) {
      const el = document.getElementById("hint");
      if (!el) return;
      if (!text) {
        el.classList.add("hidden");
        el.replaceChildren();
        return;
      }
      if (action) renderActionPrompt(el, input, action, text);
      else el.textContent = text;
      el.classList.remove("hidden");
    },
  };
  const interactSystem = new InteractSystem(
    scene,
    input,
    () => player.getLookRay(),
    hints,
    (type, movementLockSeconds) => player.playInteractionAction(type, movementLockSeconds),
    () => !player.isNeckGrabbed && !playerStats.isDead
  );
  const attackLightSources = [
    ...endTorches.safeLightPositions.map((position) => position.clone()),
    terminalLandmark.caveCandleFocusPoint.clone(),
  ];
  const getAttackLightSources = () => [
    ...attackLightSources,
    ...segments.getLitSafeLightPositions(),
  ];
  let hermanoMayorLightTarget: LightProjectileAttackTarget | null = null;
  const attackSystem = new PlayerAttackSystem(scene, player, enemyManager, {
    input,
    stats: playerStats,
    getLightSourcePositions: getAttackLightSources,
    getAdditionalAttackTargets: () =>
      hermanoMayorLightTarget ? [hermanoMayorLightTarget] : [],
    findUnlitCandleSegmentHit: (from, to, projectileRadius) =>
      segments.findUnlitCandleSegmentHit(from, to, projectileRadius),
    relightCandle: (id) => segments.relightCandle(id),
    getGroundHeight: (x, z) => player.getWalkableSurfaceHeight(playerWorld, x, z),
    isBlocked: (position, radius) =>
      segments.isColliding(
        position.x,
        position.z,
        0,
        position.y - radius,
        position.y + radius
      ),
  });
  let worldObjectInspectionActive = false;
  segments.setWorldObjectInspectionHandler((request) => {
    if (worldObjectInspectionActive || player.isGameplayControlLocked) return false;
    if (!player.beginCinematicSequence()) return false;

    worldObjectInspectionActive = true;
    attackSystem.cancelCharge();
    interactSystem.clearMessage();

    const inspectionTarget = request.target.clone();
    const inspectionCameraPosition = player.position.clone();
    inspectionCameraPosition.y = Math.max(
      player.position.y + 0.08,
      inspectionTarget.y + (request.cameraHeightAboveTarget ?? 0)
    );
    const planarDirection = inspectionTarget.subtract(inspectionCameraPosition);
    planarDirection.y = 0;
    if (planarDirection.lengthSquared() > 0.0001) {
      planarDirection.normalize();
      inspectionCameraPosition.addInPlace(planarDirection.scale(0.48));
    }
    player.setCinematicCamera(
      inspectionCameraPosition,
      inspectionTarget,
      0,
      0.76
    );

    void thoughtMessages
      .showSequence(request.messages)
      .finally(() => {
        player.endCinematicSequence(0.62);
        worldObjectInspectionActive = false;
      });
    return true;
  });
  const houseArrivalCinematic = new HouseArrivalCinematic({
    player,
    housePosition: segments.getEndHouseCheckpoint(),
    triggerZ: terminalConfig.houseFrontZ - DEFAULT_WORLD_SEGMENT_LENGTH,
    segmentBoundaryZ: terminalConfig.houseFrontZ,
    getGroundHeight: (x, z) => player.getWalkableSurfaceHeight(playerWorld, x, z),
    compactFraming: quality.name === "mobile",
    onStart: () => {
      attackSystem.cancelCharge();
      playerStats.cancelLightAbsorption("controls-locked");
    },
  });
  scene.metadata ??= {};
  scene.metadata.houseArrivalCinematic = houseArrivalCinematic;
  scene.onDisposeObservable.addOnce(() => houseArrivalCinematic.dispose());

  // =========================
  // Lluvia
  // =========================
  createRainSystem(scene, terrain, quality.rainDrops);
  createFireflies(scene, terrain, () => player.position, quality.fireflyCount);

  onProgress(0.91, "Precargando segmentos...");
  await segments.prewarmAll(player.position, (completed, total) => {
    const ratio = total > 0 ? completed / total : 1;
    onProgress(0.91 + ratio * 0.05, `Precargando bosque (${completed}/${total})...`);
  });
  const shadowGrabberBehaviorSystem = new ShadowGrabberBehaviorSystem({
    player: {
      getPosition: () => player.position,
      getGroundPositionToRef: (result) => player.getGroundContactPositionToRef(result),
      getCollisionHeight: () => player.getCollisionHeight(),
      getSanity: () => playerStats.normalizedSanity,
      applySanityDrain: (amount, sourceId) =>
        playerStats.queueContinuousSanityDrain(
          `shadow-grabber:${sourceId}:hold`,
          amount
        ),
      applyGrabPressure: (
        sourceId,
        source,
        duration,
        movementMultiplier,
        pullSpeed
      ) =>
        player.applyEnemyGrabPressure(
          sourceId,
          source,
          duration,
          movementMultiplier,
          pullSpeed
        ),
      onSanityHit: (intensity) => shadowAura.pulseSanityHit(intensity),
    },
    navigation: {
      getGroundHeight: (x, z) => player.getWalkableSurfaceHeight(playerWorld, x, z),
      isBlocked: (x, z) => segments.isColliding(x, z),
    },
    fixedSafeLightPositions: endTorches.safeLightPositions,
    getCandleLights: () => segments.getActiveCandleGameplayLights(),
    extinguishCandle: (id) => segments.extinguishCandle(id),
    getFlashlight: () => {
      const ray = player.getFlashlightRay();
      return {
        enabled: flashlightEnabled,
        origin: ray.origin,
        direction: ray.direction,
      };
    },
    onEvent: (id, event) => {
      if (event === "detect") playerStats.noteEnemyAwareness("detected");
      if (event === "alert") playerStats.noteEnemyAwareness("chase-started");
      if (event === "grab") {
        const captureAccepted = playerStats.beginShadowGrabberCapture(id);
        if (captureAccepted && !playerStats.isDead) player.beginEnemyGrabStruggle(id);
      }
      if (event === "retract" || event === "lightRecoil") {
        playerStats.endShadowGrabberCapture(id);
        player.endEnemyGrabStruggle(id);
      }
      window.dispatchEvent(
        new CustomEvent("bosque:shadow-grabber", {
          detail: { id, event },
        })
      );
    },
    debug: {
      enabled:
        import.meta.env.DEV &&
        new URLSearchParams(window.location.search).get("debugShadowGrabbers") === "1",
      scene,
    },
  });
  await loadInitialForestEnemies(enemyManager, shadowGrabberBehaviorSystem, {
    getGroundHeight: (x, z) => player.getWalkableSurfaceHeight(playerWorld, x, z),
  });
  scene.metadata.shadowGrabberBehaviorSystem = shadowGrabberBehaviorSystem;
  if (import.meta.env.DEV) {
    const debugGrabIds = new Set<string>();
    const shadowGrabberDebug = {
      getSnapshots: () => shadowGrabberBehaviorSystem.getDebugSnapshots(),
      getPlayerGrabStruggle: () => player.getGrabStruggleDebugSnapshot(),
      setPlayerGrabPoseMask: (
        mask: Parameters<typeof player.setGrabStruggleDebugPoseMask>[0]
      ) => player.setGrabStruggleDebugPoseMask(mask),
      triggerPlayerHitReaction: (
        strength = 1,
        hitZone: PlayerHitReactionZone = "chest",
        localRight = 0,
        localForward = -1
      ) => {
        const yaw = player.root.rotation.y;
        const direction = new Vector3(
          localRight * Math.cos(yaw) + localForward * Math.sin(yaw),
          0,
          -localRight * Math.sin(yaw) + localForward * Math.cos(yaw)
        );
        player.playHitReaction({ direction, strength, hitZone });
        return player.getGrabStruggleDebugSnapshot();
      },
      triggerPlayerDodgeReaction: (
        side: "left" | "right" = "right",
        strength = 1
      ) => {
        player.playDodgeReaction({
          side,
          strength,
          style: "sidestep",
          movementLockSeconds: 0.34,
        });
        return player.getGrabStruggleDebugSnapshot();
      },
      getPlayerPosition: () => player.position.clone(),
      getSanity: () => playerStats.normalizedSanity,
      getPerformance: () => ({
        fps: engine.getFps(),
        frameTimeMs: engine.getDeltaTime(),
        portalSmokeEffects: blackSmokeWrapSystem.activeEffectCount,
        portalSmokeParticles: blackSmokeWrapSystem.activeParticleCount,
        portalSmokeCapacity: blackSmokeWrapSystem.particleCapacity,
      }),
      setFxEnabled: (enabled: boolean) =>
        shadowGrabberBehaviorSystem.setFxEnabled(enabled),
      simulatePlayerGrabStruggle: (requestedCount: number) => {
        for (const id of debugGrabIds) player.endEnemyGrabStruggle(id);
        debugGrabIds.clear();
        const count = Math.max(0, Math.min(4, Math.floor(requestedCount)));
        for (let index = 0; index < count; index++) {
          const id = `debug-player-grab-${index + 1}`;
          const angle = (index - (count - 1) * 0.5) * 0.65;
          const source = new Vector3(
            player.position.x + Math.sin(angle) * 3,
            player.position.y,
            player.position.z + Math.cos(angle) * 3
          );
          debugGrabIds.add(id);
          player.beginEnemyGrabStruggle(id);
          player.applyEnemyGrabPressure(id, source, 0, 1, 0);
        }
        return player.getGrabStruggleDebugSnapshot();
      },
      stopPlayerGrabStruggleSimulation: () => {
        for (const id of debugGrabIds) player.endEnemyGrabStruggle(id);
        debugGrabIds.clear();
        return player.getGrabStruggleDebugSnapshot();
      },
      simulateShadowGrabbers: (seconds: number, stepSeconds = 1 / 60) => {
        const committedStates = new Set([
          "telegraphing",
          "attacking",
          "grabbing",
          "holding",
          "retracting",
        ]);
        const safeStep = Math.max(1 / 240, Math.min(0.05, stepSeconds));
        const steps = Math.ceil(Math.max(0, Math.min(30, seconds)) / safeStep);
        let maxCommitted = 0;
        for (let index = 0; index < steps; index++) {
          shadowGrabberBehaviorSystem.update(safeStep);
          enemyManager.update(safeStep);
          maxCommitted = Math.max(
            maxCommitted,
            shadowGrabberBehaviorSystem
              .getDebugSnapshots()
              .filter((snapshot) => committedStates.has(snapshot.state)).length
          );
        }
        return { maxCommitted, steps };
      },
      teleportPlayer: (x: number, z: number) => {
        player.root.position.set(
          x,
          player.getWalkableSurfaceHeight(playerWorld, x, z) + player.getCollisionHeight(),
          z
        );
      },
      facePlayerAt: (x: number, z: number) => {
        const directionX = x - player.position.x;
        const directionZ = z - player.position.z;
        if (Math.hypot(directionX, directionZ) <= 0.001) return;
        const desiredYaw = Math.atan2(directionX, directionZ);
        const yawDelta = Math.atan2(
          Math.sin(desiredYaw - player.root.rotation.y),
          Math.cos(desiredYaw - player.root.rotation.y)
        );
        player.applyLookDelta(yawDelta, 0);
      },
      aimPlayerAt: (x: number, y: number, z: number) => {
        player.camera.getViewMatrix(true);
        const cameraPosition = player.camera.globalPosition;
        const directionX = x - cameraPosition.x;
        const directionZ = z - cameraPosition.z;
        const planarDistance = Math.hypot(directionX, directionZ);
        if (planarDistance <= 0.001) return;
        const desiredYaw = Math.atan2(directionX, directionZ);
        const yawDelta = Math.atan2(
          Math.sin(desiredYaw - player.root.rotation.y),
          Math.cos(desiredYaw - player.root.rotation.y)
        );
        const desiredPitch = Math.atan2(cameraPosition.y - y, planarDistance);
        const pitchDelta = desiredPitch - player.camera.rotation.x;
        player.applyLookDelta(yawDelta, pitchDelta);
      },
    };
    const debugGlobal = globalThis as typeof globalThis & {
      __bosqueShadowGrabberDebug?: typeof shadowGrabberDebug;
    };
    debugGlobal.__bosqueShadowGrabberDebug = shadowGrabberDebug;
    scene.onDisposeObservable.addOnce(() => {
      if (debugGlobal.__bosqueShadowGrabberDebug === shadowGrabberDebug) {
        delete debugGlobal.__bosqueShadowGrabberDebug;
      }
    });
  }
  scene.onDisposeObservable.addOnce(() => shadowGrabberBehaviorSystem.dispose());

  const ignoredLineOfSightMeshes = new Set([
    ...player.getAvatarMeshes(),
    ...skyEye.getAttackHitMeshes(),
    ...enemyManager
      .getAll()
      .flatMap((enemy) => [...enemy.getAttackHitMeshes()]),
  ]);
  const hasGameplayLineOfSight = (origin: Vector3, target: Vector3) => {
    const direction = target.subtract(origin);
    const distance = direction.length();
    if (distance <= 0.05) return true;
    direction.scaleInPlace(1 / distance);
    const hit = scene.pickWithRay(
      new Ray(origin, direction, distance),
      (mesh) =>
        mesh.isEnabled() &&
        mesh.isPickable &&
        mesh.visibility > 0.05 &&
        !ignoredLineOfSightMeshes.has(mesh) &&
        !mesh.name.toLocaleLowerCase().includes("water")
    );
    return !hit?.hit || hit.distance >= distance - 0.35;
  };
  const hermanoMayor = segments.getHermanoMayor();
  const hermanoMayorContactShadow = hermanoMayor
    ? new CharacterContactShadow(
        scene,
        {
          root: hermanoMayor.root,
          getGroundHeight: (x, z) =>
            player.getWalkableSurfaceHeight(playerWorld, x, z),
        },
        {
          name: "hermanoMayor",
          radiusX: 0.72,
          radiusZ: 0.44,
          opacity: 0.38,
          maxDistance: 70,
        }
      )
    : null;
  const hermanoMayorAxe = segments.getHermanoMayorAxe();
  const firstPathNotePosition = segments.getFirstPathNotePosition();
  let hermanoMayorBehavior: HermanoMayorBehavior | null = null;
  hermanoMayor?.setAxePickupTarget(hermanoMayorAxe);
  const hermanoMayorAxeCinematic = hermanoMayor
    ? new HermanoMayorAxePickupCinematic(player, hermanoMayor)
    : null;
  const hermanoMayorForestCrossingCinematic =
    hermanoMayor && firstPathNotePosition
      ? new HermanoMayorForestCrossingCinematic({
          player,
          actor: hermanoMayor,
          firstNotePosition: firstPathNotePosition,
          getGroundHeight: (x, z) =>
            player.getWalkableSurfaceHeight(playerWorld, x, z),
          onStart: () => {
            attackSystem.cancelCharge();
            playerStats.cancelLightAbsorption("controls-locked");
            interactSystem.clearMessage();
            hermanoMayorBehavior?.playNearbyUnseenCue();
          },
        })
      : null;
  scene.metadata.hermanoMayorForestCrossingCinematic =
    hermanoMayorForestCrossingCinematic;
  const hermanoMayorGrabHud = new HermanoMayorGrabHud();
  const hermanoMayorAxeDodgeHud = new HermanoMayorAxeDodgeHud();
  const playerHitBloodVfx = new PlayerHitBloodVFX();
  playerDeathSequence = new PlayerDeathSequence(scene, {
    player,
    smokeSystem: blackSmokeWrapSystem,
    portalQuality: quality.name === "desktop" ? "high" : "low",
    onStart: () => {
      attackSystem.cancelCharge();
      playerStats.cancelLightAbsorption("death");
      interactSystem.clearMessage();
      hints.set(null);
      hermanoMayorBehavior?.beginRetreatAfterPlayerDeath();
    },
    onChoice: (choice) =>
      runtimeOptions.onPlayerDeathChoice?.(
        choice,
        forestKeyCheckpointReached
          ? FOREST_KEY_CHECKPOINT_ENTRY_POINT
          : FOREST_START_CHECKPOINT_ENTRY_POINT
      ),
  });
  const endHouseBounds = segments.getEndHouseBounds();
  const hermanoMayorNavigationProbe = Vector3.Zero();
  const hermanoMayorNeckTarget = Vector3.Zero();
  hermanoMayor?.setNeckGrabTargetProvider((result) =>
    player.getNeckWorldPositionToRef(result)
  );
  const isHermanoMayorNavigationBlocked = (x: number, z: number) => {
    // His rig is wider than the playable characters, so give authored props
    // and walls a little extra clearance. The expanded lagoon query keeps both
    // feet visibly on dry ground instead of stopping at the water mesh center.
    if (segments.isColliding(x, z, 0.22)) return true;
    hermanoMayorNavigationProbe.set(x, terminalConfig.waterLevel, z);
    return waterSurfaces.isPointInsideWaterSurface(
      hermanoMayorNavigationProbe,
      0.85
    );
  };
  hermanoMayorBehavior = hermanoMayor && endHouseBounds
    ? new HermanoMayorBehavior({
        actor: hermanoMayor,
        playerPosition: () => player.position,
        playerNeckPosition: () =>
          player.getNeckWorldPositionToRef(hermanoMayorNeckTarget),
        houseBounds: endHouseBounds,
        visionRange:
          mapLayout.segmentLength * HERMANO_MAYOR_VISION_SEGMENT_MULTIPLIER,
        getGroundHeight: (x, z) =>
          player.getWalkableSurfaceHeight(playerWorld, x, z),
        isBlocked: isHermanoMayorNavigationBlocked,
        hasLineOfSight: hasGameplayLineOfSight,
        isVisibleToPlayer: () => {
          player.camera.computeWorldMatrix();
          const insideFrustum = hermanoMayor.meshes.some((mesh) =>
            player.camera.isInFrustum(mesh)
          );
          if (!insideFrustum) return false;
          const target = new Vector3(
            hermanoMayor.root.position.x,
            hermanoMayor.root.position.y + 2.15,
            hermanoMayor.root.position.z
          );
          return hasGameplayLineOfSight(player.camera.globalPosition, target);
        },
        getSfxVolume: () => musicPlayer?.getSfxVolume() ?? 0.8,
        canGrabPlayer: () =>
          !playerStats.isDead &&
          !player.isGameplayControlLocked &&
          player.waterLocomotionState === "grounded",
        wasGrabEscapePressed: () => input.wasPressed("interact"),
        setGrabVictimPose: (
          active,
          attackerPosition,
          lift,
          escapeProgress
        ) =>
          player.setNeckGrabState({
            active,
            attackerPosition,
            lift,
            escapeProgress,
          }),
        setGrabEscapeHud: (active, progress) =>
          hermanoMayorGrabHud.setState(active, progress),
        onGrabStarted: () => {
          attackSystem.cancelCharge();
          playerStats.cancelLightAbsorption("grab");
          setHermanoMayorGrabHapticsActive(true);
        },
        onGrabDamage: (fractionOfMaxHealth, kind) => {
          const initial = kind === "initial";
          playerStats.takeDamage(
            playerStats.snapshot.maxHealth * fractionOfMaxHealth,
            {
              type: "physical",
              source: `hermano-mayor:neck-grab:${kind}`,
              ignoreSanityModifier: true,
            }
          );
          playerStats.modifySanity(
            initial ? -4 : -1.5,
            `hermano-mayor:neck-grab:${kind}:sanity`
          );
        },
        onAxeDamage: (fractionOfMaxHealth) => {
          attackSystem.cancelCharge();
          playerHitBloodVfx.play();
          playerStats.takeDamage(
            playerStats.snapshot.maxHealth * fractionOfMaxHealth,
            {
              type: "physical",
              source: "hermano-mayor:axe-blade",
              ignoreSanityModifier: true,
            }
          );
          if (playerStats.isDead) return;
          player.playReaction({
            kind: "hit",
            sourcePosition: hermanoMayor.root.position,
            strength: 1,
            hitZone: "chest",
            impactType: "heavy",
            movementLockSeconds: 1.25,
          });
        },
        onAxeDodged: () =>
          player.playReaction({
            kind: "dodge",
            sourcePosition: hermanoMayor.root.position,
            strength: 1,
            style: "sidestep",
            side: "auto",
            movementLockSeconds: 0.34,
          }),
        getPlayerSanity: () => playerStats.normalizedSanity,
        wasAxeDodgePressed: () => input.wasPressed("interact"),
        setAxeDodgePrompt: (state, remaining, sanity) =>
          hermanoMayorAxeDodgeHud.setState(state, remaining, sanity),
        onGrabEnded: () => setHermanoMayorGrabHapticsActive(false),
        beginAxePickupCinematic: () => {
          attackSystem.cancelCharge();
          playerStats.cancelLightAbsorption("controls-locked");
          interactSystem.clearMessage();
          return hermanoMayorAxeCinematic?.start() ?? false;
        },
        endAxePickupCinematic: (completed) =>
          hermanoMayorAxeCinematic?.finish(completed),
      })
    : null;
  if (hermanoMayor && hermanoMayorBehavior) {
    hermanoMayorLightTarget = {
      id: "hermano-mayor",
      type: "hermano-mayor",
      enabled: true,
      getAttackHitMeshes: () => hermanoMayor.meshes,
      getAttackTargetPositionToRef: (result) => {
        result.copyFrom(hermanoMayor.root.position);
        result.y += 1.65;
        return true;
      },
      receiveAttack: () => {
        hermanoMayorBehavior.stun();
      },
    };
  }
  scene.onDisposeObservable.addOnce(() => {
    hermanoMayorForestCrossingCinematic?.dispose();
    hermanoMayorContactShadow?.dispose();
    hermanoMayorBehavior?.dispose();
    hermanoMayorAxeCinematic?.dispose();
    setHermanoMayorGrabHapticsActive(false);
    hermanoMayorGrabHud.dispose();
    hermanoMayorAxeDodgeHud.dispose();
    playerHitBloodVfx.dispose();
    player.setNeckGrabState({ active: false });
  });
  if (import.meta.env.DEV && hermanoMayor && hermanoMayorBehavior) {
    const hermanoMayorDebug = {
      getGrab: () => hermanoMayorBehavior.getGrabDebugSnapshot(),
      getAxe: () => ({
        pickup: hermanoMayor.getAxePickupDebugSnapshot(),
        attack: hermanoMayor.getAxeAttackDebugSnapshot(),
        cinematic: hermanoMayorAxeCinematic?.getDebugSnapshot() ?? null,
      }),
      getForestCrossing: () =>
        hermanoMayorForestCrossingCinematic?.getDebugSnapshot() ?? null,
      forceForestCrossing: () =>
        hermanoMayorForestCrossingCinematic?.forceForestCrossing() ?? false,
      setAxeDebugVisible: (visible: boolean) =>
        hermanoMayor.setAxePickupDebugVisible(visible),
      seekAxePickup: (time: number) => {
        const actionMoved = hermanoMayor.seekAxePickupForDebug(time);
        const cameraMoved = hermanoMayorAxeCinematic?.seekForDebug(time) ?? false;
        return actionMoved && cameraMoved;
      },
      forceAxePickup: () => hermanoMayorBehavior.forceAxePickup(),
      forceAxeAttack: () => hermanoMayorBehavior.forceAxeAttack(),
      forceGrab: (positionPlayer = true) => {
        if (positionPlayer) {
          const yaw = hermanoMayor.root.rotation.y;
          const x = hermanoMayor.root.position.x + Math.sin(yaw) * 1.45;
          const z = hermanoMayor.root.position.z + Math.cos(yaw) * 1.45;
          player.root.position.set(
            x,
            player.getWalkableSurfaceHeight(playerWorld, x, z) +
              player.getCollisionHeight(),
            z
          );
          const desiredYaw = Math.atan2(
            hermanoMayor.root.position.x - x,
            hermanoMayor.root.position.z - z
          );
          const yawDelta = Math.atan2(
            Math.sin(desiredYaw - player.root.rotation.y),
            Math.cos(desiredYaw - player.root.rotation.y)
          );
          player.applyLookDelta(yawDelta, 0);
        }
        return hermanoMayorBehavior.forceGrab();
      },
      pressEscape: () => hermanoMayorBehavior.simulateGrabEscapePress(),
      getPlayerPose: () => player.getGrabStruggleDebugSnapshot(),
      getCamera: () => player.getNeckGrabCameraDebugSnapshot(),
      setViewMode: (mode: ViewMode) => player.setViewMode(mode),
      getPlayerStats: () => playerStats.snapshot,
      isPlayerAvailable: () =>
        !playerStats.isDead &&
        !player.isGameplayControlLocked &&
        player.waterLocomotionState === "grounded",
    };
    const debugGlobal = globalThis as typeof globalThis & {
      __bosqueHermanoMayorDebug?: typeof hermanoMayorDebug;
    };
    debugGlobal.__bosqueHermanoMayorDebug = hermanoMayorDebug;
    scene.onDisposeObservable.addOnce(() => {
      if (debugGlobal.__bosqueHermanoMayorDebug === hermanoMayorDebug) {
        delete debugGlobal.__bosqueHermanoMayorDebug;
      }
    });
  }
  const sanctuaryLightSources = [
    ...endTorches.safeLightPositions,
    terminalLandmark.caveCandleFocusPoint,
  ];
  const isNearPlanarLight = (
    position: Vector3,
    sources: readonly Vector3[],
    radius: number
  ) => {
    const radiusSquared = radius * radius;
    return sources.some((source) => {
      const dx = source.x - position.x;
      const dz = source.z - position.z;
      return dx * dx + dz * dz <= radiusSquared;
    });
  };
  let survivalGameplayActive = false;
  const survivalSystem = new PlayerSurvivalSystem({
    player,
    input,
    stats: playerStats,
    isGameplayActive: () => survivalGameplayActive,
    getEnvironment: () => {
      const position = player.position;
      const inSanctuary = isNearPlanarLight(
        position,
        sanctuaryLightSources,
        6
      );
      const inWeakFixedLight = isNearPlanarLight(position, getAttackLightSources(), 12);
      return {
        onLitPath:
          Math.abs(position.x) <= 4.5 &&
          position.z >= -800 &&
          position.z <=
            mapLayout.segmentLength * mapLayout.endHouseSegment - 8,
        inWeakLight: flashlightEnabled || inWeakFixedLight,
        inSanctuary,
        inTotalDarkness:
          !flashlightEnabled && !inWeakFixedLight && !inSanctuary,
      };
    },
    isSurrounded: () =>
      isPlayerPhysicallySurrounded(
        player.position,
        shadowGrabberBehaviorSystem.getDebugSnapshots(),
        hasGameplayLineOfSight
      ),
    getEyeGaze: () => ({
      active: skyEyeEncounter.state === "watching" && skyEye.enabled,
      hasLineOfSight:
        skyEyeEncounter.state === "watching" &&
        skyEye.enabled &&
        hasGameplayLineOfSight(skyEye.root.position, player.position),
    }),
  });
  const disposeMobileControls = setupMobileControls(
    player,
    input
  );
  scene.metadata.playerStats = playerStats;
  scene.onDisposeObservable.addOnce(() => {
    disposeMobileControls();
    survivalSystem.dispose();
  });

  // Render the exact light/material states encountered at the forest, house
  // entrance and lagoon while the loading overlay still hides incomplete RTTs.
  // Real frames both compile shaders and populate the water render targets;
  // scene.whenReadyAsync(true) cannot be used here because those targets may
  // wait indefinitely before the normal render loop has started.
  const initialPlayerPosition = player.position.clone();
  const houseWarmupPosition = segments.getEndHouseCheckpoint();
  const terminalTransitionWarmupPosition = new Vector3(
    terminalConfig.lagoonCenterX,
    initialPlayerPosition.y,
    terminalConfig.transitionStartZ + 6
  );
  const lagoonWarmupPosition = terminalLandmark.waterfallImpactPoint.clone();
  const prepareTransitionState = async (position: Vector3, frameCount = 2) => {
    segments.update(position);
    segments.prepareLightingForPosition(position);
    terminalLandmark.update(0, position);
    endTorches.update(position);
    // The regular guard runs in onBeforeRender, but these readiness passes run
    // before the first frame. Clamp imported glTF materials here as well or
    // Babylon may generate 12-15-light shaders that exceed WebGL2 UBO limits.
    enforceSceneMaterialLightBudget(scene);
    synchronizeSceneLightPriorities(scene);
    for (let frame = 0; frame < frameCount; frame++) {
      scene.render();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  };

  onProgress(0.96, "Compilando materiales del bosque...");
  await prepareTransitionState(initialPlayerPosition);
  onProgress(0.97, "Compilando materiales de la casa...");
  await prepareTransitionState(houseWarmupPosition);
  onProgress(0.98, "Compilando transición al lago...");
  await prepareTransitionState(terminalTransitionWarmupPosition);
  onProgress(0.986, "Compilando materiales del lago...");
  skyEye.setPosition(skyEyeHoverPosition);
  skyEye.setEnabled(true);
  skyEye.snapLookAt(lagoonWarmupPosition);
  await prepareTransitionState(lagoonWarmupPosition);
  onProgress(0.991, "Restaurando bosque...");
  await prepareTransitionState(initialPlayerPosition);
  skyEye.setEnabled(false);
  skyEye.setPosition(skyEyeHoverPosition);
  onProgress(0.995, "Preparando controles...");

  // =========================
  // Loop
  // =========================
  let grassWindTimer = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.max(0, Math.min(engine.getDeltaTime() / 1000, 0.05));
    if (!playerStats.isDead && input.wasPressed("toggleFlashlight")) {
      setFlashlightEnabled(!flashlightEnabled);
    }
    interactSystem.update(dt);
    houseArrivalCinematic.update(dt);
    hermanoMayorForestCrossingCinematic?.update(dt);
    // During the reveal, upload the already-preassembled final streaming window
    // before the player crosses the boundary that used to expose the hitch.
    segments.update(
      player.position,
      houseArrivalCinematic.shouldPrepareHouseSegment
        ? DEFAULT_END_HOUSE_SEGMENT
        : undefined
    );
    // From the house onward, close cameras are part of the level design: they
    // avoid the expensive distant lake view and preserve underwater searching.
    player.setIsometricViewAllowed(
      player.position.z < terminalConfig.houseFrontZ - 7,
      0.78
    );
    player.update(dt, playerWorld);
    if (
      !forestKeyCheckpointReached &&
      player.position.z >= forestKeyCheckpoint.z - 1.2
    ) {
      forestKeyCheckpointReached = true;
    }
    if (!hermanoMayorForestCrossingCinematic?.isActive) {
      hermanoMayorBehavior?.update(dt);
    }
    hermanoMayorAxeCinematic?.update(dt);
    skyEyeEncounter.update(dt);
    shadowGrabberBehaviorSystem.update(dt);
    enemyManager.update(dt);
    attackSystem.update(dt);
    enemyHealthHud.update(
      dt,
      skyEyeEncounter.state === "watching" && skyEye.enabled,
      skyEye.health,
      skyEye.maxHealth
    );
    survivalSystem.update(dt);
    playerDeathSequence?.update(dt);
    waterContactSystem.update(dt);
    waterInteractionVfx.update(dt);
    musicPlayer?.updateListenerPosition(player.position);
    terminalLandmark.update(dt, player.position);
    lagoonUnderwaterEffect.update(dt);
    endTorches.update(player.position);
    synchronizeSceneLightPriorities(scene);
    segments.updateIsometricOccluders(
      player.position,
      player.currentViewMode === "iso"
    );
    if (quality.grassWindInterval <= 0) {
      grassLibrary.updateWind(dt);
    } else {
      grassWindTimer += dt;
      if (grassWindTimer >= quality.grassWindInterval) {
        grassLibrary.updateWind(grassWindTimer);
        grassWindTimer = 0;
      }
    }

    const interactionState = worldObjectInspectionActive
      ? null
      : interactSystem.getInteractionState();
    cursorController?.setCursorRequest(
      "interaction",
      interactionState?.cursor ?? null
    );
    if (!interactSystem.isMessageActive()) {
      const interactionLabel = interactionState?.label ?? null;
      hints.set(
        interactionLabel,
        interactionLabel ? "interact" : undefined
      );
    }
  });

  // Hold the player and the elevated opening camera before the first frame that
  // can become visible. The UI presentation decides when both begin moving.
  const skipOpeningForAxeDebug = useAxePickupDebugLighting;
  if (prepareOpeningSequence && !skipOpeningForAxeDebug) {
    player.prepareOpeningSequence();
  }
  survivalGameplayActive = true;
  onProgress(1, "Listo");
  return {
    scene,
    playOpeningSequence: () => player.playOpeningSequence(),
  };
}
