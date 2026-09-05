import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { RockLibrary } from "./RockLibrary";
import { createTerrain } from "./Terrain";
import {
  getNextPrimaryViewMode,
  PlayerController,
  type CharacterId,
  type IsometricCameraAnchor,
  type ViewMode,
} from "./PlayerController";
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
import { TERMINAL_LAGOON_VISUAL_CONFIG } from "./TerminalLagoonVisualConfig";
import { WaterContactSystem } from "./WaterContactSystem";
import { WaterInteractionVFX } from "./WaterInteractionVFX";
import { WaterSurfaceRegistry } from "./WaterSurface";
import type { MusicPlayerHandle } from "./MusicPlayer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PhotoDome } from "@babylonjs/core/Helpers/photoDome";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator"; 
import { Light } from "@babylonjs/core/Lights/light";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import { ShadowAuraController } from "./ShadowAura";
import { createShadowAuraDebugControls } from "./ShadowAuraDebug";
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
  SHADOW_GRABBER_TYPE,
  ShadowGrabberBehaviorSystem,
  registerShadowGrabber,
} from "./enemies";
import { loadInitialForestEnemies } from "./levels/ForestEnemySpawns";



// ✅ Vite url imports (desde src/assets)
const pathUrl = "/assets/models/textures/terrain/ground_camino/ground.jpg";
const SKY_DESKTOP_URL = "/assets/hdr/forest_night_8k.jpg";
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
  objectSegmentAhead: 5,
  plantSegmentBehind: 1,
  plantSegmentAhead: 8,
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

function getViewModeShortLabel(mode: ViewMode) {
  if (mode === "first") return "1P";
  if (mode === "iso") return "ISO";
  if (mode === "front") return "FR";
  return "3P";
}

function getViewModeName(mode: ViewMode) {
  if (mode === "first") return "primera persona";
  if (mode === "iso") return "isometrica";
  if (mode === "front") return "frontal";
  return "tercera persona";
}

function setupViewModeControls(player: PlayerController) {
  const cameraButton = document.getElementById("cameraModeButton") as HTMLButtonElement | null;
  const frontButton = document.getElementById("frontCameraButton") as HTMLButtonElement | null;
  const isometricButton = document.getElementById("isometricCameraButton") as HTMLButtonElement | null;
  const reticle = document.getElementById("reticle");
  if (!cameraButton) return;

  const setMode = (mode: ViewMode) => {
    const isFirstPerson = mode === "first";
    const isFrontView = mode === "front";
    const isIsometricView = mode === "iso";
    const nextMode = getNextPrimaryViewMode(mode);
    cameraButton.classList.toggle("active", isFirstPerson);
    cameraButton.textContent = getViewModeShortLabel(nextMode);
    cameraButton.setAttribute("aria-pressed", String(isFirstPerson));
    cameraButton.setAttribute(
      "aria-label",
      `Cambiar a vista ${getViewModeName(nextMode)}`
    );
    frontButton?.classList.toggle("active", isFrontView);
    frontButton?.setAttribute("aria-pressed", String(isFrontView));
    frontButton?.setAttribute(
      "aria-label",
      isFrontView ? "Volver a tercera persona" : "Activar camara frontal"
    );
    isometricButton?.classList.toggle("active", isIsometricView);
    isometricButton?.setAttribute("aria-pressed", String(isIsometricView));
    isometricButton?.setAttribute(
      "aria-label",
      isIsometricView ? "Volver a tercera persona" : "Activar vista isometrica"
    );
    reticle?.classList.toggle("hidden", isFrontView || isIsometricView);
  };

  cameraButton.addEventListener("click", (event) => {
    event.stopPropagation();
    player.toggleViewMode();
  });

  frontButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    player.setViewMode(player.currentViewMode === "front" ? "third" : "front");
  });

  isometricButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    player.setViewMode(player.currentViewMode === "iso" ? "third" : "iso");
  });

  player.onViewModeChange(setMode);
}

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
  musicPlayer: MusicPlayerHandle | null = null
) {
  onProgress(0.08, "Creando escena...");
  const scene = new Scene(engine);
  installSceneMaterialLightBudgetGuard(scene);
  const enemyManager = new EnemyManager(scene);
  registerShadowGrabber(enemyManager);
  scene.metadata ??= {};
  scene.metadata.enemyManager = enemyManager;
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

const moon = new DirectionalLight("moon", new Vector3(-0.35, -1, 0.25), scene);
moon.position = new Vector3(60, 120, 40);
moon.intensity = BASE_MOON_INTENSITY; // suave
moon.diffuse = new Color3(0.6, 0.65, 0.9);
moon.specular = new Color3(0, 0, 0);


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
  const player = new PlayerController(scene, canvas, {
    eyeHeight: 1.7,
    walkSpeed: 2.8,
    runSpeed: 6.8,
    jumpSpeed: 6.2,
    gravity: -18.0,
  }, selectedCharacter);
  setupViewModeControls(player);
  const vintageFilm = createVintageFilmPostProcess(scene, player.camera, {
    enabled: true,
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
  const shadowAura = new ShadowAuraController(
    scene,
    {
      root: player.root,
      avatarMeshes: player.getAvatarMeshes(),
      getGroundSurfaceHeightAt: (x, z) => player.getWalkableSurfaceHeight(terrain, x, z),
    },
    {
      performance: {
        allowFlames: true,
        qualityLevel: quality.name === "desktop" ? "high" : "low",
      },
    }
  );
  const shadowAuraDebug = createShadowAuraDebugControls(shadowAura);
  player.onViewModeChange((mode) => shadowAura.setVisible(mode !== "first"));
  const requestedShadowView = new URLSearchParams(window.location.search).get("shadowView");
  if (
    requestedShadowView === "first" ||
    requestedShadowView === "third" ||
    requestedShadowView === "front" ||
    requestedShadowView === "iso"
  ) {
    player.setViewMode(requestedShadowView);
  }
  scene.onDisposeObservable.add(() => shadowAuraDebug.dispose());

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
const flashlightButton = document.getElementById("flashlightButton") as HTMLButtonElement | null;
const setFlashlightEnabled = (enabled: boolean) => {
  flashlightEnabled = enabled;
  flashlight.intensity = enabled ? FLASHLIGHT_BASE_INTENSITY : 0;
  flashlightFill.intensity = enabled ? FLASHLIGHT_FILL_BASE_INTENSITY : 0;
  flashlightReach.intensity = enabled ? FLASHLIGHT_REACH_BASE_INTENSITY : 0;
  for (const light of flashlightLights) {
    if (light.isEnabled() !== enabled) light.setEnabled(enabled);
  }
  flashlightButton?.classList.toggle("active", enabled);
  flashlightButton?.setAttribute("aria-pressed", String(enabled));
};

flashlightButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  setFlashlightEnabled(!flashlightEnabled);
});

scene.onKeyboardObservable.add((kb) => {
  if (kb.type !== KeyboardEventTypes.KEYDOWN) return;
  const event = kb.event as KeyboardEvent;
  if (event.code === "KeyF" && !event.repeat) setFlashlightEnabled(!flashlightEnabled);
});

// Sombras (opcional pero suma MUCHO)
if (quality.shadowMapSize > 0) {
const shadows = new ShadowGenerator(quality.shadowMapSize, flashlight);
shadows.useBlurExponentialShadowMap = true;
shadows.blurKernel = quality.shadowBlurKernel;
shadows.darkness = 0.65;

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

  onProgress(0.45, "Cargando rocas...");
  await rockLibrary.load(scene, quality.rockTemplateLimit);
  onProgress(0.62, "Cargando arboles...");
  await treeLibrary.load(scene, quality.treeTemplateLimit);
  onProgress(0.74, "Cargando pasto...");
  await grassLibrary.load(scene, quality.grassTemplateLimit);
  onProgress(0.82, "Cargando plantas...");
  await plantLibrary.load(scene, quality.plantTemplateLimit);

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
  });

  onProgress(0.88, "Cargando casa...");
  await segments.loadCandles();
  await segments.loadStartBlocker();
  await segments.loadEndHouse();
  onProgress(0.89, "Cargando enemigos...");
  await enemyManager.preload(SHADOW_GRABBER_TYPE);
  const terminalLandmark = new TerminalLandmarkGenerator(
    scene,
    terrain,
    treeLibrary,
    rockLibrary,
    plantLibrary,
    {
      waterRenderTargetSize: quality.name === "mobile" ? 128 : 256,
      environmentReflectionMeshes: [photoDome.mesh],
      visualConfig: TERMINAL_LAGOON_VISUAL_CONFIG,
      instantiateCandleAsset: (name, scale) =>
        segments.instantiateCandleAsset(name, scale),
    }
  ).generateWaterfallLagoonEnd(terminalConfig);
  const lagoonIsometricCameraAnchor: IsometricCameraAnchor = {
    // A high, stable world-space viewpoint keeps the orthographic camera away
    // from the lagoon banks, waterfall ribbons and terrain underside.
    cameraPosition: new Vector3(
      terminalConfig.lagoonCenterX + 28,
      terminalConfig.waterLevel + 32,
      terminalConfig.lagoonCenterZ - 34
    ),
    targetPosition: new Vector3(
      terminalConfig.lagoonCenterX,
      terminalConfig.waterLevel + 0.8,
      terminalConfig.lagoonCenterZ + 4
    ),
    orthographicHeight: 38,
    cameraFollowFactorX: 0.42,
    maxCameraOffsetX: 9.5,
    targetFollowFactor: 0.36,
    maxTargetOffsetX: 8,
    maxTargetOffsetZ: 16,
  };
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
        player.setMobileRun(true);
        player.setMobileRun(false);
      },
      setMovement: (x: number, y: number) => player.setMobileMove(x, y),
      setViewMode: (mode: ViewMode) => player.setViewMode(mode),
      playThrowObject: () => player.playThrowObject(0),
      setSimulationActive: (active: boolean) => player.setMobileEnabled(active),
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
  // UI hints + Interacción (E)
  // =========================
  const hints = {
    set(text: string | null) {
      const el = document.getElementById("hint");
      if (!el) return;
      if (!text) {
        el.classList.add("hidden");
        el.textContent = "";
        return;
      }
      el.textContent = text;
      el.classList.remove("hidden");
    },
  };
  const interactSystem = new InteractSystem(
    scene,
    () => player.getLookRay(),
    hints,
    (type, movementLockSeconds) => player.playInteractionAction(type, movementLockSeconds)
  );
  setupMobileControls(player, () => interactSystem.tryInteract());

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
      getSanity: () => shadowAura.getSanity(),
      applySanityDrain: (amount) => shadowAura.applySanityDrain(amount),
      applyGrabPressure: (source, duration, movementMultiplier, pullSpeed) =>
        player.applyEnemyGrabPressure(
          source,
          duration,
          movementMultiplier,
          pullSpeed
        ),
      onSanityHit: (intensity) => shadowAura.pulseSanityHit(intensity),
    },
    navigation: {
      getGroundHeight: (x, z) => player.getWalkableSurfaceHeight(terrain, x, z),
      isBlocked: (x, z) => segments.isColliding(x, z),
    },
    fixedSafeLightPositions: [
      ...segments.getFixedSafeLightPositions(),
      ...endTorches.safeLightPositions,
    ],
    getFlashlight: () => {
      const ray = player.getFlashlightRay();
      return {
        enabled: flashlightEnabled,
        origin: ray.origin,
        direction: ray.direction,
      };
    },
    onEvent: (id, event) => {
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
    getGroundHeight: (x, z) => player.getWalkableSurfaceHeight(terrain, x, z),
  });
  scene.metadata.shadowGrabberBehaviorSystem = shadowGrabberBehaviorSystem;
  if (import.meta.env.DEV) {
    const shadowGrabberDebug = {
      getSnapshots: () => shadowGrabberBehaviorSystem.getDebugSnapshots(),
      getPlayerPosition: () => player.position.clone(),
      getSanity: () => shadowAura.getSanity(),
      getPerformance: () => ({
        fps: engine.getFps(),
        frameTimeMs: engine.getDeltaTime(),
      }),
      setFxEnabled: (enabled: boolean) =>
        shadowGrabberBehaviorSystem.setFxEnabled(enabled),
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
          player.getWalkableSurfaceHeight(terrain, x, z) + player.getCollisionHeight(),
          z
        );
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
  await prepareTransitionState(lagoonWarmupPosition);
  // The flashlight is normally on, but its off-state has a different stable
  // light membership. Compile the three main regions once so toggling it does
  // not move shader work into gameplay.
  onProgress(0.991, "Compilando iluminación alternativa...");
  setFlashlightEnabled(false);
  await prepareTransitionState(initialPlayerPosition, 1);
  await prepareTransitionState(houseWarmupPosition, 1);
  await prepareTransitionState(lagoonWarmupPosition, 1);
  setFlashlightEnabled(true);
  await prepareTransitionState(initialPlayerPosition);
  onProgress(0.995, "Preparando controles...");

  // =========================
  // Loop
  // =========================
  let grassWindTimer = 0;
  let previousCameraZonePlayerZ = player.position.z;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.max(0, Math.min(engine.getDeltaTime() / 1000, 0.05));
    // Activate cached world content before collision and movement use it.
    segments.update(player.position);
    const cameraZoneTravelDeltaZ = player.position.z - previousCameraZonePlayerZ;
    previousCameraZonePlayerZ = player.position.z;
    if (
      player.currentViewMode === "iso" &&
      segments.isInsideEndHouseCameraZone(player.position, cameraZoneTravelDeltaZ)
    ) {
      // Start outside the front wall, before the isometric collision ray can
      // collapse the camera into the roof or floor meshes.
      player.setViewMode("third", 0.78);
    }
    const lagoonIsometricCameraActive =
      player.currentViewMode === "iso" &&
      Math.abs(player.position.x - terminalConfig.lagoonCenterX) <=
        terminalConfig.lagoonRadiusX + 24 &&
      player.position.z >=
        terminalConfig.lagoonCenterZ - terminalConfig.lagoonRadiusZ + 6 &&
      player.position.z <= terminalConfig.backCliffZ + 16;
    player.setIsometricCameraAnchor(
      lagoonIsometricCameraActive ? lagoonIsometricCameraAnchor : null
    );
    player.update(dt, terrain, segments);
    shadowGrabberBehaviorSystem.update(dt);
    enemyManager.update(dt);
    waterContactSystem.update(dt);
    waterInteractionVfx.update(dt);
    musicPlayer?.updateListenerPosition(player.position);
    terminalLandmark.update(dt, player.position);
    lagoonUnderwaterEffect.update(dt);
    endTorches.update(player.position);
    synchronizeSceneLightPriorities(scene);
    segments.updateIsometricOccluders(
      player.position,
      player.currentViewMode === "iso" && !lagoonIsometricCameraActive
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

    const looking = interactSystem.peekInteractable();
    hints.set(looking ? "E: interactuar" : null);
  });

  onProgress(1, "Listo");
  return scene;
}
