import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { RockLibrary } from "./RockLibrary";
import { createTerrain } from "./Terrain";
import { PlayerController } from "./PlayerController";
import { Segments } from "./Segments";
import { TreeLibrary } from "./TreeLibrary";
import { GrassLibrary } from "./GrassLibrary";
import { PlantLibrary } from "./PlantLibrary";
import { InteractSystem } from "./InteractSystem";
import { setupMobileControls } from "./MobileControls";
import { createRainSystem } from "./Rain";
import { createFireflies } from "./Fireflies";
import { createEndTorches } from "./Torches";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PhotoDome } from "@babylonjs/core/Helpers/photoDome";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator"; 
import { Light } from "@babylonjs/core/Lights/light";



// ✅ Vite url imports (desde src/assets)
const pathUrl = "/assets/models/textures/terrain/ground_camino/ground.jpg";
const skyUrl = "/assets/hdr/hdr_high.png";
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
  photoDomeResolution: 64,
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
  photoDomeResolution: 32,
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
  quality: QualityProfile = desktopQuality
) {
  onProgress(0.08, "Creando escena...");
  const scene = new Scene(engine);

  // =========================
  // Fog lúgubre (NOCHE)
  // =========================
  // EXP2: densa y natural PERO con densidad baja (0.05 era demasiado)
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = new Color3(0.014, 0.017, 0.022); // casi negro azulado
  scene.fogDensity = 0.021; // 🔥 probá 0.010..0.018

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
hemi.intensity = 0.015; // MUY bajo
hemi.groundColor = new Color3(0.01, 0.01, 0.01);

const moon = new DirectionalLight("moon", new Vector3(-0.35, -1, 0.25), scene);
moon.position = new Vector3(60, 120, 40);
moon.intensity = 0.045; // suave
moon.diffuse = new Color3(0.6, 0.65, 0.9);
moon.specular = new Color3(0, 0, 0);


  // =========================
  // Terreno
  // =========================
onProgress(0.18, "Generando terreno...");
const terrain = createTerrain(scene, {
  size: 1600,
  segments: quality.terrainSegments,
  pathHalfWidth: 4,
  flatAreas: [
    {
      x: 0,
      z: 70 * 8 + 18,
      width: 72,
      depth: 96,
      height: 0,
      fade: 22,
    },
  ],

  mountainStart: 55,    // antes 26
  mountainEnd: 95,      // antes 48
  mountainHeight: 34,   // un poco más alto
  playableHalfWidth: 52 // antes de montaña
});


  // =========================
  // Sendero plano (opcional)
  // =========================
  const path = createPathMesh(scene, terrain, quality.pathRows, undefined, 70 * 8 - 8);

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
  path.material = pathMat;

  // =========================
  // SKY (PhotoDome PNG 360)
  // =========================
  onProgress(0.3, "Cargando cielo...");
  const photoDome = new PhotoDome(
    "skyDome",
    skyUrl,
    {
      resolution: quality.photoDomeResolution,
      size: 3000,
    },
    scene
  );

  photoDome.mesh.infiniteDistance = true;
  photoDome.mesh.isPickable = false;
  photoDome.mesh.renderingGroupId = 0;

  // ✅ el cielo NO debe recibir fog
  // (PhotoDome.material no siempre tipa fogEnabled, por eso el cast)
  (photoDome.material as any).fogEnabled = false;

  // ✅ “bajar” la potencia visual del cielo (si está muy brillante)
  // (depende del material que use internamente)
  const m: any = photoDome.material as any;
  if (m.emissiveColor?.set) m.emissiveColor.set(0.42, 0.42, 0.42);
  if (m.diffuseColor?.set) m.diffuseColor.set(0, 0, 0);
  if (m.specularColor?.set) m.specularColor.set(0, 0, 0);

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
  });

// =========================
// 🔦 FLASHLIGHT (SpotLight)
// =========================
const flashlight = new SpotLight(
  "flashlight",
  player.camera.globalPosition.clone(),
  player.camera.getDirection(Vector3.Forward()),
  Math.PI / 3.8,
  1,
  scene
);

// Falloff más “físico”
flashlight.falloffType = Light.FALLOFF_GLTF;
flashlight.innerAngle = Math.PI / 11;

flashlight.intensity = 4.4;
flashlight.range = 40;

flashlight.diffuse = new Color3(1.0, 0.96, 0.88); // cálida
flashlight.specular = new Color3(0, 0, 0);

const flashlightFill = new SpotLight(
  "flashlightFill",
  player.camera.globalPosition.clone(),
  player.camera.getDirection(Vector3.Forward()),
  Math.PI / 1.55,
  1,
  scene
);

flashlightFill.falloffType = Light.FALLOFF_GLTF;
flashlightFill.innerAngle = Math.PI / 6.5;
flashlightFill.intensity = 0.85;
flashlightFill.range = 34;
flashlightFill.diffuse = new Color3(0.82, 0.74, 0.58);
flashlightFill.specular = new Color3(0, 0, 0);

const flashlightReach = new SpotLight(
  "flashlightReach",
  player.camera.globalPosition.clone(),
  player.camera.getDirection(Vector3.Forward()),
  Math.PI / 1.35,
  1,
  scene
);

flashlightReach.falloffType = Light.FALLOFF_STANDARD;
flashlightReach.intensity = 0.62;
flashlightReach.range = 95;
flashlightReach.diffuse = new Color3(0.72, 0.70, 0.62);
flashlightReach.specular = new Color3(0, 0, 0);

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
  const pos = player.camera.globalPosition;
  const dir = player.camera.getDirection(Vector3.Forward());

  flashlight.position.copyFrom(pos);
  flashlight.direction.copyFrom(dir);
  flashlightFill.position.copyFrom(pos);
  flashlightFill.direction.copyFrom(dir);
  flashlightReach.position.copyFrom(pos);
  flashlightReach.direction.copyFrom(dir);

  // micro flicker (casi imperceptible)
  t += scene.getEngine().getDeltaTime() * 0.001;
  const flicker = Math.sin(t * 17.0) * 0.05 + Math.sin(t * 7.0) * 0.035;
  flashlight.intensity = 4.4 + flicker;
  flashlightFill.intensity = 0.85 + flicker * 0.25;
  flashlightReach.intensity = 0.62 + flicker * 0.12;
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
    segmentLength: 70,
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
  await createEndTorches(scene, terrain);

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
  const interactSystem = new InteractSystem(scene, player.camera, hints);
  setupMobileControls(player, () => interactSystem.tryInteract());

  // =========================
  // Lluvia
  // =========================
  createRainSystem(scene, terrain, quality.rainDrops);
  createFireflies(scene, terrain, () => player.position, quality.fireflyCount);
  onProgress(0.92, "Preparando controles...");

  // =========================
  // Loop
  // =========================
  let grassWindTimer = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    player.update(dt, terrain, segments);
    segments.update(player.position.z);
    if (quality.grassWindInterval <= 0) {
      grassLibrary.updateWind(dt);
    } else {
      grassWindTimer += dt;
      if (grassWindTimer >= quality.grassWindInterval) {
        grassLibrary.updateWind(grassWindTimer);
        grassWindTimer = 0;
      }
    }

    const looking = segments.peekInteractable(player.camera);
    hints.set(looking ? "E: interactuar" : null);
  });

  onProgress(1, "Listo");
  return scene;
}
