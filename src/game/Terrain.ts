// Terrain.ts
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { setGameMaterial } from "../materials";

// ✅ Vite assets (IMPORTADOS)

export type TerrainHandle = {
  mesh: any;
  size: number;
  segments: number;
  heights: Float32Array;
  getHeightAt: (x: number, z: number) => number;

  // útil para límites / spawn
  playableHalfWidth: number; // hasta antes de montaña
  mountainStart: number;
};

export type TerrainHeightModifier = (x: number, z: number, currentHeight: number) => number;

type FlatArea = {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  fade?: number;
};

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ruido barato para variar un poco
function hash2(x: number, z: number) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function createTerrain(
  scene: Scene,
  opts: {
    size: number;
    segments: number;
    pathHalfWidth: number;

    // control montañas laterales
    mountainStart?: number; // donde arranca el “muro”
    mountainEnd?: number; // donde ya es alto
    mountainHeight?: number;
    playableHalfWidth?: number; // límite de movimiento (antes de montaña)
    flatAreas?: FlatArea[];
    heightModifiers?: readonly TerrainHeightModifier[];
  }
): TerrainHandle {
  const size = opts.size;
  const segments = opts.segments;
  const pathHalfWidth = opts.pathHalfWidth;

  // 🏔️ Montañas laterales (por |x|)
  const mountainStart = opts.mountainStart ?? 26; // empieza a subir
  const mountainEnd = opts.mountainEnd ?? 48; // ya es “pared”
  const mountainHeight = opts.mountainHeight ?? 26; // alto del muro

  // 🧱 Límite jugable (antes de montaña)
  const playableHalfWidth = opts.playableHalfWidth ?? mountainStart - 2;
  const flatAreas = opts.flatAreas ?? [];
  const heightModifiers = opts.heightModifiers ?? [];

  const step = size / segments;
  const half = size / 2;

  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const heights = new Float32Array((segments + 1) * (segments + 1));

  // ======= Construcción de vértices =======
  let idx = 0;
  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const x = -half + ix * step;
      const z = -half + iz * step;

      const absX = Math.abs(x);

      // base ondulada suave
      const base =
        Math.sin(x * 0.02) * Math.cos(z * 0.018) * 1.4 +
        Math.sin(z * 0.012) * 0.8;

      // pequeñas lomas
      const hills = Math.sin((x + z) * 0.015) * 0.6;

      // máscara de cordón montañoso (solo costados)
      const ridgeMask = smoothstep(mountainStart, mountainEnd, absX);

      // variación del muro (para que no sea una pared lisa)
      const noise = (hash2(x * 0.15, z * 0.15) - 0.5) * 2.0; // [-1..1]
      const ridge = ridgeMask * (mountainHeight + noise * 4.0);

      let h = base + hills + ridge;

      // Aplanar el sendero central (ojo: el camino real es el mesh "path" en tu Scene)
      if (absX < pathHalfWidth + 1.2) h = 0;
      h = applyFlatAreas(x, z, h);
      for (const modifyHeight of heightModifiers) h = modifyHeight(x, z, h);

      heights[idx] = h;
      positions.push(x, h, z);

      const uvScale = 18; // metros por repetición (ajustable)
      uvs.push(x / uvScale, z / uvScale);


      idx++;
    }
  }

  // ======= Indices =======
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * (segments + 1) + ix;
      const b = a + 1;
      const c = a + (segments + 1);
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;

  // ===== Mesh =====
  scene.getMeshByName("terrain")?.dispose(true, true);

  const mesh = MeshBuilder.CreateGround(
    "terrain",
    { width: size, height: size, subdivisions: segments },
    scene
  );

  vd.applyToMesh(mesh, true);
  mesh.isPickable = true;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.computeWorldMatrix(true);
  mesh.refreshBoundingInfo(true);

  // ✅ IMPORTANTE: el terreno debe recibir sombras (casters: árboles/rocas)
  mesh.receiveShadows = true;

  // Shared PBR material retains the dark night tint and Babylon fog support.
  setGameMaterial(mesh, "grass", scene);

  // ======= HeightAt (bilinear) =======
  function applyFlatAreas(x: number, z: number, h: number) {
    let height = h;

    for (const area of flatAreas) {
      const fade = area.fade ?? 8;
      const dx = Math.abs(x - area.x);
      const dz = Math.abs(z - area.z);
      const halfW = area.width * 0.5;
      const halfD = area.depth * 0.5;
      const maskX = 1 - smoothstep(halfW, halfW + fade, dx);
      const maskZ = 1 - smoothstep(halfD, halfD + fade, dz);
      const mask = maskX * maskZ;
      height = height * (1 - mask) + area.height * mask;
    }

    return height;
  }

  function getHeightAt(x: number, z: number) {
    const sx = (x + half) / size;
    const sz = (z + half) / size;
    if (sx < 0 || sx > 1 || sz < 0 || sz > 1) return 0;

    const fx = sx * segments;
    const fz = sz * segments;

    const ix = Math.floor(fx);
    const iz = Math.floor(fz);

    const ix1 = Math.min(ix + 1, segments);
    const iz1 = Math.min(iz + 1, segments);

    const tx = fx - ix;
    const tz = fz - iz;

    const stride = segments + 1;
    const i00 = iz * stride + ix;
    const i10 = iz * stride + ix1;
    const i01 = iz1 * stride + ix;
    const i11 = iz1 * stride + ix1;

    const y00 = heights[i00];
    const y10 = heights[i10];
    const y01 = heights[i01];
    const y11 = heights[i11];

    // Match the two triangles emitted for each terrain cell. Bilinear sampling
    // can differ visibly from the rendered plane on the steep lagoon banks.
    if (tx + tz <= 1) {
      return y00 + (y10 - y00) * tx + (y01 - y00) * tz;
    }
    return y11 + (y01 - y11) * (1 - tx) + (y10 - y11) * (1 - tz);
  }

  return {
    mesh,
    size,
    segments,
    heights,
    getHeightAt,
    playableHalfWidth,
    mountainStart,
  };
}
