import "@babylonjs/loaders/glTF";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../utils/asset";
import type { PerformanceTier } from "../../runtime/LevelTypes";

const CHAIR_ROOT_URL = "assets/models/theatre/";
const CHAIR_FILE = "silla-teatro.glb";

export const THEATRE_AUDIENCE_CONFIG = {
  stageBackZ: -16.9,
  stageWidth: 15,
  startZ: -20.4,
  floorY: -1.4,
  rowSpacing: 1.15,
  farRowSpacingScale: 0.93,
  seatSpacing: 0.94,
  desktop: {
    heroRows: 4,
    proxyRows: 17,
    silhouetteRows: 16,
    firstRowSeats: 16,
    lastRowSeats: 24,
  },
  mobile: {
    heroRows: 4,
    proxyRows: 12,
    silhouetteRows: 14,
    firstRowSeats: 14,
    lastRowSeats: 20,
  },
} as const;

type AudienceZone = "hero" | "proxy" | "silhouette";

type AudienceSeat = {
  row: number;
  index: number;
  zone: AudienceZone;
  zoneRow: number;
  position: Vector3;
  yaw: number;
};

type AudienceProfile = (typeof THEATRE_AUDIENCE_CONFIG)[PerformanceTier];

export type TheatreAudienceHandle = {
  root: TransformNode;
  stats: {
    heroRows: number;
    proxyRows: number;
    silhouetteRows: number;
    heroSeats: number;
    proxySeats: number;
    silhouetteSeats: number;
  };
  dispose(): void;
};

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function deterministicNoise(row: number, seat: number, salt: number) {
  let value =
    Math.imul(row + 17, 0x9e3779b1) ^
    Math.imul(seat + 31, 0x85ebca6b) ^
    Math.imul(salt + 47, 0xc2b2ae35);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function resolveZone(row: number, profile: AudienceProfile) {
  if (row < profile.heroRows) {
    return { zone: "hero" as const, zoneRow: row };
  }
  if (row < profile.heroRows + profile.proxyRows) {
    return { zone: "proxy" as const, zoneRow: row - profile.heroRows };
  }
  return {
    zone: "silhouette" as const,
    zoneRow: row - profile.heroRows - profile.proxyRows,
  };
}

function buildAudienceLayout(profile: AudienceProfile) {
  const config = THEATRE_AUDIENCE_CONFIG;
  const totalRows =
    profile.heroRows + profile.proxyRows + profile.silhouetteRows;
  const seats: AudienceSeat[] = [];
  let lastRowZ: number = config.startZ;
  let farHalfWidth: number = config.stageWidth * 0.5;

  for (let row = 0; row < totalRows; row += 1) {
    const depthProgress = row / Math.max(1, totalRows - 1);
    const spacingScale = lerp(1, config.farRowSpacingScale, depthProgress);
    const rowZ = config.startZ - row * config.rowSpacing * spacingScale;
    const seatCount = Math.round(
      lerp(profile.firstRowSeats, profile.lastRowSeats, depthProgress)
    );
    const rowShift =
      (row % 2 === 0 ? -0.035 : 0.045) +
      (deterministicNoise(row, 0, 3) - 0.5) * 0.025;
    const rowWidth = Math.max(0, seatCount - 1) * config.seatSpacing;
    const zoneInfo = resolveZone(row, profile);
    const absenceThreshold =
      zoneInfo.zone === "hero"
        ? row < 3
          ? 0
          : 0.012
        : zoneInfo.zone === "proxy"
          ? 0.018
          : 0.008;

    lastRowZ = rowZ;
    farHalfWidth = Math.max(farHalfWidth, rowWidth * 0.5 + 1.6);

    for (let index = 0; index < seatCount; index += 1) {
      const absence = deterministicNoise(row, index, 11);
      if (
        absence < absenceThreshold &&
        index > 0 &&
        index < seatCount - 1
      ) {
        continue;
      }

      const centeredIndex = index - (seatCount - 1) * 0.5;
      const lateralOffset =
        (deterministicNoise(row, index, 19) - 0.5) * 0.055;
      const x = centeredIndex * config.seatSpacing + rowShift + lateralOffset;
      const edgeCurve = Math.pow(Math.abs(x) / Math.max(1, rowWidth * 0.5), 2);
      const z =
        rowZ -
        edgeCurve * 0.08 +
        (deterministicNoise(row, index, 23) - 0.5) * 0.045;
      const yaw = (deterministicNoise(row, index, 29) - 0.5) * 0.035;
      seats.push({
        row,
        index,
        zone: zoneInfo.zone,
        zoneRow: zoneInfo.zoneRow,
        position: new Vector3(x, config.floorY, z),
        yaw,
      });
    }
  }

  return { seats, lastRowZ, farHalfWidth };
}

function createAudienceMaterial(
  scene: Scene,
  name: string,
  diffuse: Color3,
  emissive = Color3.Black(),
  disableLighting = false
) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = diffuse;
  material.emissiveColor = emissive;
  material.specularColor = Color3.Black();
  material.disableLighting = disableLighting;
  return material;
}

function createAudienceFloor(
  scene: Scene,
  root: TransformNode,
  farZ: number,
  farHalfWidth: number,
  material: StandardMaterial
) {
  const config = THEATRE_AUDIENCE_CONFIG;
  const nearHalfWidth = config.stageWidth * 0.5;
  const nearZ = config.stageBackZ - 0.02;
  const floor = new Mesh("theatreAudienceFloor", scene);
  const data = new VertexData();
  data.positions = [
    -nearHalfWidth,
    config.floorY,
    nearZ,
    nearHalfWidth,
    config.floorY,
    nearZ,
    farHalfWidth,
    config.floorY,
    farZ,
    -farHalfWidth,
    config.floorY,
    farZ,
  ];
  data.indices = [0, 1, 2, 0, 2, 3];
  const normals: number[] = [];
  VertexData.ComputeNormals(data.positions, data.indices, normals);
  data.normals = normals;
  data.applyToMesh(floor, true);
  floor.parent = root;
  floor.material = material;
  floor.isPickable = false;
  floor.receiveShadows = false;

  const apron = MeshBuilder.CreateBox(
    "theatreStageApron",
    {
      width: config.stageWidth,
      height: Math.abs(config.floorY),
      depth: 0.24,
    },
    scene
  );
  apron.parent = root;
  apron.position.set(0, config.floorY * 0.5, config.stageBackZ - 0.1);
  apron.material = material;
  apron.isPickable = false;
  apron.receiveShadows = false;

  return [floor, apron] as const;
}

function createProxySource(
  scene: Scene,
  root: TransformNode,
  name: string,
  material: StandardMaterial
) {
  const back = MeshBuilder.CreateBox(
    `${name}BackSource`,
    { width: 0.72, height: 0.62, depth: 0.12 },
    scene
  );
  back.position.set(0, 0.67, -0.2);
  back.material = material;
  const base = MeshBuilder.CreateBox(
    `${name}BaseSource`,
    { width: 0.7, height: 0.14, depth: 0.54 },
    scene
  );
  base.position.set(0, 0.36, 0.035);
  base.material = material;
  const merged = Mesh.MergeMeshes([back, base], true, true);
  if (!merged) throw new Error(`No se pudo crear el proxy ${name}.`);
  merged.name = name;
  merged.parent = root;
  merged.material = material;
  merged.isPickable = false;
  merged.receiveShadows = false;
  return merged;
}

function createSilhouetteSource(
  scene: Scene,
  root: TransformNode,
  name: string,
  material: StandardMaterial
) {
  const source = MeshBuilder.CreateBox(
    name,
    { width: 0.7, height: 0.76, depth: 0.055 },
    scene
  );
  source.parent = root;
  source.position.set(0, 0.52, -0.13);
  source.material = material;
  source.isPickable = false;
  source.receiveShadows = false;
  return source;
}

function setThinInstanceMatrices(source: Mesh, seats: AudienceSeat[]) {
  const matrices = new Float32Array(seats.length * 16);
  for (let index = 0; index < seats.length; index += 1) {
    const seat = seats[index];
    const matrix = Matrix.Compose(
      Vector3.One(),
      Quaternion.FromEulerAngles(0, seat.yaw, 0),
      seat.position
    );
    matrix.copyToArray(matrices, index * 16);
  }
  source.thinInstanceSetBuffer("matrix", matrices, 16, true);
  source.thinInstanceRefreshBoundingInfo(true);
}

function instantiateHeroSeats(
  scene: Scene,
  container: AssetContainer,
  root: TransformNode,
  seats: AudienceSeat[]
) {
  const meshes: AbstractMesh[] = [];
  for (const seat of seats) {
    const wrapper = new TransformNode(
      `theatreHeroSeat_${seat.row}_${seat.index}`,
      scene
    );
    wrapper.parent = root;
    wrapper.position.copyFrom(seat.position);
    wrapper.rotation.y = seat.yaw;
    const instance = container.instantiateModelsToScene(
      (sourceName) => `${wrapper.name}_${sourceName}`,
      false
    );
    for (const node of instance.rootNodes) node.parent = wrapper;
    for (const mesh of wrapper.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      meshes.push(mesh);
    }
  }
  return meshes;
}

function splitDepthBands(
  seats: AudienceSeat[],
  rowCount: number,
  bandCount: number
) {
  const bands = Array.from({ length: bandCount }, () => [] as AudienceSeat[]);
  for (const seat of seats) {
    const band = Math.min(
      bandCount - 1,
      Math.floor((seat.zoneRow / Math.max(1, rowCount)) * bandCount)
    );
    bands[band].push(seat);
  }
  return bands;
}

function isolateFromExistingLights(scene: Scene, meshes: AbstractMesh[]) {
  const previousLights = [...scene.lights];
  const meshSet = new Set(meshes);
  for (const light of previousLights) {
    for (const mesh of meshes) {
      if (!light.excludedMeshes.includes(mesh)) light.excludedMeshes.push(mesh);
    }
  }

  return () => {
    for (const light of previousLights) {
      for (let index = light.excludedMeshes.length - 1; index >= 0; index -= 1) {
        if (meshSet.has(light.excludedMeshes[index])) {
          light.excludedMeshes.splice(index, 1);
        }
      }
    }
  };
}

function createDramaticAudienceLight(
  scene: Scene,
  litMeshes: AbstractMesh[]
) {
  const position = new Vector3(0, 5, -17.9);
  const target = new Vector3(0, -0.72, -21.65);
  const light = new SpotLight(
    "theatreAudienceDramaticLight",
    position,
    target.subtract(position).normalize(),
    Math.PI / 1.7,
    2.4,
    scene
  );
  light.diffuse = new Color3(0.92, 0.31, 0.16);
  light.specular = new Color3(0.5, 0.16, 0.08);
  light.intensity = 11.5;
  light.range = 8.25;
  light.shadowEnabled = false;
  light.includedOnlyMeshes.push(...litMeshes);
  return light;
}

export async function createTheatreAudience(
  scene: Scene,
  performanceTier: PerformanceTier
): Promise<TheatreAudienceHandle> {
  const config = THEATRE_AUDIENCE_CONFIG;
  const profile = config[performanceTier];
  const layout = buildAudienceLayout(profile);
  const container = await SceneLoader.LoadAssetContainerAsync(
    asset(CHAIR_ROOT_URL),
    CHAIR_FILE,
    scene
  );
  if (scene.isDisposed) {
    container.dispose();
    throw new Error("El teatro se cerró mientras se cargaba la audiencia.");
  }

  const root = new TransformNode("theatreAudience", scene);
  const floorMaterial = createAudienceMaterial(
    scene,
    "theatreAudienceFloorMaterial",
    new Color3(0.009, 0.007, 0.008)
  );
  const proxyMaterials = [
    createAudienceMaterial(
      scene,
      "theatreAudienceProxyNearMaterial",
      Color3.Black(),
      new Color3(0.032, 0.006, 0.0085),
      true
    ),
    createAudienceMaterial(
      scene,
      "theatreAudienceProxyMidNearMaterial",
      Color3.Black(),
      new Color3(0.016, 0.0028, 0.0038),
      true
    ),
    createAudienceMaterial(
      scene,
      "theatreAudienceProxyMidMaterial",
      Color3.Black(),
      new Color3(0.007, 0.0011, 0.0016),
      true
    ),
    createAudienceMaterial(
      scene,
      "theatreAudienceProxyMidFarMaterial",
      Color3.Black(),
      new Color3(0.0026, 0.0004, 0.0006),
      true
    ),
    createAudienceMaterial(
      scene,
      "theatreAudienceProxyFarMaterial",
      Color3.Black(),
      new Color3(0.0007, 0.00012, 0.00018),
      true
    ),
  ] as const;
  const silhouetteMaterials = [
    createAudienceMaterial(
      scene,
      "theatreAudienceSilhouetteNearMaterial",
      Color3.Black(),
      new Color3(0.0012, 0.00022, 0.00032),
      true
    ),
    createAudienceMaterial(
      scene,
      "theatreAudienceSilhouetteMidMaterial",
      Color3.Black(),
      new Color3(0.00035, 0.00006, 0.00009),
      true
    ),
    createAudienceMaterial(
      scene,
      "theatreAudienceSilhouetteFarMaterial",
      Color3.Black(),
      new Color3(0.00008, 0.000015, 0.00002),
      true
    ),
  ] as const;
  const ownedMaterials = [
    floorMaterial,
    ...proxyMaterials,
    ...silhouetteMaterials,
  ];
  let disposed = false;
  let dramaticLight: SpotLight | null = null;
  let restoreAudienceLighting = () => {};

  try {
    const floorMeshes = createAudienceFloor(
      scene,
      root,
      layout.lastRowZ - config.rowSpacing * 2.5,
      layout.farHalfWidth + 1.8,
      floorMaterial
    );

    const heroSeats = layout.seats.filter((seat) => seat.zone === "hero");
    const proxySeats = layout.seats.filter((seat) => seat.zone === "proxy");
    const silhouetteSeats = layout.seats.filter(
      (seat) => seat.zone === "silhouette"
    );
    const heroMeshes = instantiateHeroSeats(scene, container, root, heroSeats);
    const litMeshes: AbstractMesh[] = [...floorMeshes, ...heroMeshes];
    restoreAudienceLighting = isolateFromExistingLights(scene, litMeshes);
    dramaticLight = createDramaticAudienceLight(scene, litMeshes);

    const proxyBands = splitDepthBands(
      proxySeats,
      profile.proxyRows,
      proxyMaterials.length
    );
    for (let band = 0; band < proxyBands.length; band += 1) {
      const source = createProxySource(
        scene,
        root,
        `theatreAudienceProxySource_${band}`,
        proxyMaterials[band]
      );
      setThinInstanceMatrices(source, proxyBands[band]);
    }

    const silhouetteBands = splitDepthBands(
      silhouetteSeats,
      profile.silhouetteRows,
      silhouetteMaterials.length
    );
    for (let band = 0; band < silhouetteBands.length; band += 1) {
      const source = createSilhouetteSource(
        scene,
        root,
        `theatreAudienceSilhouetteSource_${band}`,
        silhouetteMaterials[band]
      );
      setThinInstanceMatrices(source, silhouetteBands[band]);
    }

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      restoreAudienceLighting();
      dramaticLight?.dispose();
      root.dispose(false, false);
      for (const material of ownedMaterials) material.dispose();
      container.dispose();
    };
    scene.onDisposeObservable.addOnce(dispose);

    return {
      root,
      stats: {
        heroRows: profile.heroRows,
        proxyRows: profile.proxyRows,
        silhouetteRows: profile.silhouetteRows,
        heroSeats: heroSeats.length,
        proxySeats: proxySeats.length,
        silhouetteSeats: silhouetteSeats.length,
      },
      dispose,
    };
  } catch (error) {
    restoreAudienceLighting();
    dramaticLight?.dispose();
    root.dispose(false, false);
    for (const material of ownedMaterials) material.dispose();
    container.dispose();
    throw error;
  }
}
