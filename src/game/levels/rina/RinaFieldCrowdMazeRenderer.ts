import "@babylonjs/core/Meshes/thinInstanceMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Light } from "@babylonjs/core/Lights/light";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { asset } from "../../../utils/asset";
import { RINA_CROWD_FANS } from "./crowd/RinaCrowdAssetManifest";
import { prepareRinaCrowdMaterial, RinaCrowdAssetRegistry } from "./crowd/RinaCrowdAssetRegistry";
import { RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";
import type { RinaFieldCrowdMazeLayout } from "./RinaFieldCrowdMazeLayout";
import { RinaFieldCrowdMotionController } from "./RinaFieldCrowdMotion";
import type { RinaFieldCrowdMotionPlacement } from "./RinaFieldCrowdMotion";

/**
 * Rina field labyrinth renderer: a visually opaque crowd, not a sea of active
 * skeletons. All display positions derive from the SAME maze layout used by
 * the collision query. The only animated fans use a shared rig per GLB.
 *
 * This is independent from RinaStandsCrowd (the audience in the grandstands).
 * All positions are LOCAL STADIUM coordinates; parent root to stadiumRoot ONCE.
 */
export interface RinaFieldCrowdMazeRenderHandle {
  readonly root: TransformNode;
  readonly stats: Readonly<{ silhouettes: number; perimeterCandidates: number; staticFans: number; rigVariantsRequested: number }>;
  update(elapsed: number, beatPulse: number): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export const RINA_FIELD_CROWD_MAZE_RENDER_CONFIG = {
  // The outermost row is positioned AT the analytical border instead of .5m
  // behind it. This removes the visually empty strip that had collision.
  desktop: { spacing: 1.00, keep: 0.88, staticFansMax: 370,
    animatedFansMax: 38, animatedRigKinds: 5 },
  mobile: { spacing: 1.45, keep: 0.72, staticFansMax: 75,
    animatedFansMax: 0, animatedRigKinds: 0 },
  rimOffset: 0.13,
  rimSpacing: 0.72,
  rimDedupeDistance: 0.49,
  coreMargin: 0.86,
  proximityBetweenRigged: 2.4,
  proximityBetweenDetailed: 1.18,
  proximityBetweenSameFan: 2.25,
  proximityToSilhouette: 0.94,
  animatedFanIds: ["fan_01", "fan_02", "fan_03", "fan_04", "fan_05"],
  // Pre-baked static snapshots of Mixamo in-place animations (no live rig).
  staticFanIds: ["fan_01", "fan_02", "fan_03", "fan_04", "fan_05"],
} as const;

const STATIC_ASSET_DIR = "assets/models/rina/crowd/static/";
/** Switch on temporarily to see RED markers at the REAL collision boundary. */
export const DEBUG_RINA_MAZE_COLLISION = false;

type CrowdFootprint = { x: number; z: number };

/** Sample the analytical crowd-facing boundaries, not an unrelated random grid.
 * Dedupe intersections where two passages meet. No expensive frame-time work.
 */
function generateRim(layout: RinaFieldCrowdMazeLayout) {
  const cfg = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG;
  const result: CrowdFootprint[] = [];
  const seen = new Map<string, CrowdFootprint[]>();
  const safeAdd = (x: number, z: number) => {
    const { bounds } = layout;
    if (x < bounds.minX + .35 || x > bounds.maxX - .35 ||
        z < bounds.minZ + .35 || z > bounds.maxZ - .35) return;
    const margin = layout.marginToCrowd(x, z);
    if (margin < .08 || Math.abs(margin - cfg.rimOffset) > .23) return;
    const cell = cfg.rimDedupeDistance;
    const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      for (const p of seen.get(`${ix+ox}/${iz+oz}`) ?? []) {
        if (Math.hypot(x - p.x, z - p.z) < cell) return;
      }
    }
    const p = { x, z }; result.push(p);
    const key = `${ix}/${iz}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(p);
  };
  for (const seg of layout.passages) {
    const dx = seg.b.x - seg.a.x, dz = seg.b.z - seg.a.z;
    const len = Math.hypot(dx, dz);
    if (!len) continue;
    const nx = -dz / len, nz = dx / len;
    const n = Math.ceil(len / cfg.rimSpacing);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      for (const side of [-1, 1]) {
        const radius = seg.halfWidth + cfg.rimOffset;
        safeAdd(seg.a.x + t * dx + side * nx * radius,
          seg.a.z + t * dz + side * nz * radius);
      }
    }
    // Endcap sections on branches and dead ends.
    for (const [at, direction] of [[seg.a, -1], [seg.b, 1]] as const) {
      for (let k = 0; k <= 6; k++) {
        const angle = (k / 6 - .5) * Math.PI;
        const along = direction * Math.cos(angle);
        const across = Math.sin(angle);
        const radius = seg.halfWidth + cfg.rimOffset;
        safeAdd(at.x + radius * (dx / len * along + nx * across),
          at.z + radius * (dz / len * along + nz * across));
      }
    }
  }
  for (const pocket of layout.rescuePockets) {
    for (let k = 0; k < 36; k++) {
      const a = k * Math.PI * 2 / 36;
      const r = pocket.radius + cfg.rimOffset;
      safeAdd(pocket.point.x + Math.cos(a) * r,
        pocket.point.z + Math.sin(a) * r);
    }
  }
  return result;
}


type RGB = readonly [number, number, number];
type Point = readonly [number, number, number];
type PoseKind = 0 | 1 | 2 | 3;
type FigurePlacement = { x: number; z: number; y: number; yaw: number; scale: number; style: number };
type MeshData = { positions: number[]; indices: number[]; colors: number[] };

const STYLES: readonly Readonly<{ shirt: RGB; pants: RGB; skin: RGB; hair: RGB; pose: PoseKind }>[] = [
  { shirt: [.14, .14, .17], pants: [.09, .095, .13], skin: [.31, .23, .18], hair: [.09, .07, .07], pose: 0 },
  { shirt: [.23, .09, .17], pants: [.095, .10, .125], skin: [.34, .24, .18], hair: [.055, .05, .055], pose: 1 },
  { shirt: [.10, .17, .20], pants: [.08, .105, .15], skin: [.23, .16, .14], hair: [.09, .07, .06], pose: 2 },
  { shirt: [.17, .17, .18], pants: [.10, .08, .12], skin: [.36, .26, .21], hair: [.08, .06, .065], pose: 3 },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function addQuad(d: MeshData, pts: readonly Point[], rgb: RGB) {
  const first = d.positions.length / 3;
  for (const p of pts) {
    d.positions.push(...p);
    d.colors.push(rgb[0], rgb[1], rgb[2], 1);
  }
  d.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
}

function addBox(d: MeshData, min: Point, max: Point, color: RGB) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const v: readonly Point[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  for (const face of [[4, 5, 1, 0], [5, 6, 2, 1], [6, 7, 3, 2],
    [7, 4, 0, 3], [7, 6, 5, 4], [0, 1, 2, 3]]) {
    addQuad(d, face.map(i => v[i]), color);
  }
}

/** Small 8-vertex taper for legs or arms, not a large stack of boxes. */
function addLimb(d: MeshData, from: Point, to: Point, width: number, rgb: RGB) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const length = Math.max(0.00001, Math.hypot(dx, dy));
  const px = -dy / length * width, py = dx / length * width;
  const lo: Point[] = [
    [from[0] - px, from[1] - py, -width], [from[0] + px, from[1] + py, -width],
    [from[0] + px, from[1] + py, width], [from[0] - px, from[1] - py, width],
  ];
  const hi: Point[] = lo.map(v => [v[0] + dx, v[1] + dy, v[2]]);
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    addQuad(d, [lo[i], lo[next], hi[next], hi[i]], rgb);
  }
  addQuad(d, [...lo].reverse(), rgb);
  addQuad(d, hi, rgb);
}

function addHead(d: MeshData, y: number, skin: RGB, hair: RGB) {
  const sides = 7, rx = 0.115, rz = 0.095;
  const lo: Point[] = [], hi: Point[] = [];
  for (let k = 0; k < sides; k++) {
    const a = k * 2 * Math.PI / sides;
    lo.push([rx * Math.cos(a), y - 0.105, rz * Math.sin(a)]);
    hi.push([rx * Math.cos(a) * 0.94, y + 0.09, rz * Math.sin(a) * 0.94]);
  }
  for (let k = 0; k < sides; k++) {
    const n = (k + 1) % sides;
    addQuad(d, [hi[k], hi[n], lo[n], lo[k]], skin);
  }
  addBox(d, [-0.118, y + 0.07, -0.085], [0.118, y + 0.17, 0.075], hair);
}

function createSilhouetteMesh(scene: Scene, name: string, style: typeof STYLES[number]) {
  const d: MeshData = { positions: [], indices: [], colors: [] };
  // 1.60 local * stadiumRoot(1.5) ~= 2.4 m, matching the asset manifest fans.
  addLimb(d, [-0.12, 0.08, 0], [-0.105, 0.66, 0], 0.064, style.pants);
  addLimb(d, [0.12, 0.08, 0], [0.105, 0.66, 0], 0.064, style.pants);
  addBox(d, [-0.20, 0.65, -0.12], [0.20, 1.28, 0.11], style.shirt);
  addBox(d, [-0.055, 1.25, -0.045], [0.055, 1.37, 0.045], style.skin);
  addHead(d, 1.45, style.skin, style.hair);
  for (const side of [-1, 1]) {
    const start: Point = [side * 0.22, 1.19, 0];
    const raised = (style.pose === 2) || (style.pose === 1 && side > 0);
    const clap = style.pose === 3;
    const elbow: Point = clap ? [side * 0.26, 1.10, 0.02]
      : raised ? [side * 0.31, 1.32, 0.00] : [side * 0.29, 0.99, 0.00];
    const wrist: Point = clap ? [side * 0.06, 1.34, 0.02]
      : raised ? [side * 0.34, 1.55, 0.02] : [side * 0.30, 0.79, 0.00];
    addLimb(d, start, elbow, 0.063, style.shirt);
    addLimb(d, elbow, wrist, 0.045, style.skin);
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = d.positions;
  vd.indices = d.indices;
  vd.colors = d.colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(d.positions, d.indices, normals);
  vd.normals = normals;
  vd.applyToMesh(mesh, false);
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = false;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  return mesh;
}

/**
 * Field crowd V08: dense, dark core + a continuous visible rim made from
 * actual crowd models (baked Mixamo poses) and a few live shared rigs.
 * Gameplay navigation still comes ONLY from RinaFieldCrowdMazeLayout.
 */
export function createRinaFieldCrowdMazeRenderer(
  scene: Scene,
  performanceTier: "desktop" | "mobile",
  layout: RinaFieldCrowdMazeLayout,
  actorLights: readonly Light[] = []
): RinaFieldCrowdMazeRenderHandle {
  const root = new TransformNode("rinaFieldCrowdMazeRoot", scene);
  const settings = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG[performanceTier];
  const random = rng(0x20261023);
  const registry = new RinaCrowdAssetRegistry(scene, actorLights, true);
  const crowdMotion = new RinaFieldCrowdMotionController(performanceTier);
  const crowdMaterials: StandardMaterial[] = [];
  const meshes: Mesh[] = [];
  const batches: FigurePlacement[][] = STYLES.map(() => []);
  const rim: FigurePlacement[] = [];
  const replaced = new Set<FigurePlacement>();
  const staticContainers: AssetContainer[] = [];
  let disposed = false;
  let realStatic = 0;

  for (let index = 0; index < STYLES.length; index++) {
    const style = STYLES[index];
    const mat = new StandardMaterial(`rinaMazeShadowCrowd_${index}`, scene);
    // Four stylized models remain in the BACK, not next to Lautaro. The original
    // emissive brightness and saturated faces made them look like cardboard.
    mat.diffuseColor = new Color3(0.33, 0.34, 0.38);
    mat.specularColor = Color3.Black();
    mat.emissiveColor = new Color3(0.002, 0.002, 0.004);
    crowdMaterials.push(mat);
    const mesh = createSilhouetteMesh(scene, `rinaMazeCore_${index}`, style);
    mesh.material = mat;
    mesh.parent = root;
    meshes.push(mesh);
  }

  const { bounds } = layout;
  const step = settings.spacing;
  const startX = Math.ceil(Math.max(bounds.minX, -RINA_STADIUM.pitchWidth * .5 + .4) / step) * step;
  const endX = Math.min(bounds.maxX, RINA_STADIUM.pitchWidth * .5 - .4);
  const startZ = Math.ceil((bounds.minZ + .5) / step) * step;
  for (let z = startZ; z < bounds.maxZ - .5; z += step) {
    for (let x = startX; x < endX; x += step) {
      if (random() > settings.keep) continue;
      const xx = x + (random() - .5) * step * .17;
      const zz = z + (random() - .5) * step * .17;
      const margin = layout.marginToCrowd(xx, zz);
      if (margin < RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.coreMargin) continue;
      const style = Math.floor(random() * STYLES.length);
      batches[style].push({ x: xx, z: zz, y: 0,
        yaw: (random() - .5) * .5,
        scale: .92 + random() * .17, style });
    }
  }

  // Boundary row is deterministic and matches the actual mathematical border.
  // This fixes the empty/invisible collision strip in the previous build.
  for (const p of generateRim(layout)) {
    const style = Math.floor(random() * STYLES.length);
    const candidate: FigurePlacement = {
      x: p.x, z: p.z, y: 0,
      yaw: (random() - .5) * .34,
      scale: .95 + random() * .11, style,
    };
    rim.push(candidate);
    batches[style].push(candidate);
  }

  function refreshSilhouetteBatches() {
    for (let i = 0; i < meshes.length; i++) {
      const visible = batches[i].filter(p => !replaced.has(p));
      if (visible.length === 0) {
        crowdMotion.untrack(meshes[i]);
        meshes[i].setEnabled(false);
        continue;
      }
      meshes[i].setEnabled(true);
      const values = new Float32Array(visible.length * 16);
      for (let j = 0; j < visible.length; j++) {
        const p = visible[j];
        Matrix.Compose(new Vector3(p.scale, p.scale, p.scale),
          Quaternion.RotationAxis(Vector3.Up(), p.yaw),
          new Vector3(p.x, p.y, p.z)).copyToArray(values, j * 16);
      }
      meshes[i].thinInstanceSetBuffer("matrix", values, 16, false);
      crowdMotion.trackCore(meshes[i], visible, values);
      meshes[i].thinInstanceRefreshBoundingInfo(true);
    }
  }
  function clearSilhouettesAround(models: readonly FigurePlacement[]) {
    const radiusSquared = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.proximityToSilhouette ** 2;
    for (const batch of batches) for (const silhouette of batch) {
      if (models.some(model =>
        (silhouette.x - model.x) ** 2 + (silhouette.z - model.z) ** 2 < radiusSquared)) {
        replaced.add(silhouette);
      }
    }
    refreshSilhouetteBatches();
  }
  refreshSilhouetteBatches();

  if (DEBUG_RINA_MAZE_COLLISION) {
    const eps = .08;
    const lines = rim.map(p => {
      // Move inward from the visible fan center to the player collision SDF.
      const gx = layout.marginToCrowd(p.x + eps, p.z) -
        layout.marginToCrowd(p.x - eps, p.z);
      const gz = layout.marginToCrowd(p.x, p.z + eps) -
        layout.marginToCrowd(p.x, p.z - eps);
      const size = Math.max(.00001, Math.hypot(gx, gz));
      const offset = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.rimOffset + .32;
      const x = p.x - gx / size * offset;
      const z = p.z - gz / size * offset;
      return [new Vector3(x, .10, z), new Vector3(x, .75, z)];
    });
    const debug = MeshBuilder.CreateLineSystem("rinaMazeBoundaryDebug",
      { lines }, scene);
    debug.color = new Color3(1, .10, .12);
    debug.isPickable = false;
    debug.parent = root;
  }

  // Reserve sparse, distant animated spectators. All thin instances of a given
  // GLB share its skeleton: no skeleton per character is created.
  const rigFans = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.animatedFanIds
    .map(id => RINA_CROWD_FANS.find(f => f.id === id))
    .filter((fan): fan is (typeof RINA_CROWD_FANS)[number] =>
      !!fan && !!fan.animationNames && fan.variants.middle.sourceHasAnimations)
    .slice(0, settings.animatedRigKinds);
  const animatedRim: FigurePlacement[] = [];
  for (let i = 0; i < rim.length && animatedRim.length < settings.animatedFansMax; i++) {
    const candidate = rim[(i * 37) % rim.length];
    if (animatedRim.some(p => Math.hypot(candidate.x - p.x, candidate.z - p.z) <
      RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.proximityBetweenRigged)) continue;
    animatedRim.push(candidate);
  }

  const detailedSpacingSquared = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.proximityBetweenDetailed ** 2;
  const staticRim = rim.filter(p => !animatedRim.some(a =>
    (p.x - a.x) ** 2 + (p.z - a.z) ** 2 < detailedSpacingSquared));
  const sampled: FigurePlacement[] = [];
  const farEnough = (candidate: FigurePlacement) => !sampled.some(p =>
    (candidate.x - p.x) ** 2 + (candidate.z - p.z) ** 2 < detailedSpacingSquared);
  // Prefer even coverage, then fill the remaining gaps. A dense rim grid is
  // useful for silhouettes, but two detailed fans at adjacent grid points
  // cross arms and look like one model with overlapping animation clips.
  const preferredCount = Math.min(settings.staticFansMax, staticRim.length);
  for (let i = 0; i < preferredCount; i++) {
    const candidate = staticRim[Math.floor((i + .5) * staticRim.length / preferredCount)];
    if (farEnough(candidate)) sampled.push(candidate);
  }
  for (const candidate of staticRim) {
    if (sampled.length >= settings.staticFansMax) break;
    if (farEnough(candidate)) sampled.push(candidate);
  }
  const staticSources = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.staticFanIds.flatMap(id => [
    { id, filename: `${id}_static_pose_1k.glb` },
    { id, filename: `${id}_static_alt_1k.glb` },
  ]);
  const positionsByFan = new Map<string, FigurePlacement[]>(
    RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.staticFanIds.map(id => [id, []]));
  for (let i = 0; i < animatedRim.length; i++) {
    positionsByFan.get(rigFans[i % rigFans.length].id)!.push(animatedRim[i]);
  }
  const staticMembers: FigurePlacement[][] = staticSources.map(() => []);
  const sameFanSpacingSquared = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.proximityBetweenSameFan ** 2;
  for (let i = 0; i < sampled.length; i++) {
    const placement = sampled[i];
    const fanIds = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.staticFanIds;
    const eligible = fanIds.map((id, order) => ({ id, order,
      positions: positionsByFan.get(id)!,
    })).filter(candidate => candidate.positions.every(other =>
      (placement.x - other.x) ** 2 + (placement.z - other.z) ** 2 >= sameFanSpacingSquared));
    // If all five identities are already nearby, leave the procedural fan at
    // this position instead of overlapping a duplicate detailed model.
    if (!eligible.length) continue;
    eligible.sort((a, b) => a.positions.length - b.positions.length ||
      (a.order - i % fanIds.length + fanIds.length) % fanIds.length -
      (b.order - i % fanIds.length + fanIds.length) % fanIds.length);
    const chosen = eligible[0];
    const poseIndex = chosen.positions.length % 2;
    chosen.positions.push(placement);
    staticMembers[chosen.order * 2 + poseIndex].push(placement);
  }

  // Load ten static, textured GLB snapshots (five identities, two poses each). They are
  // already posed and contain no rig/AnimationGroups, so repeated thin
  // instances are cheap. We only hide fallback silhouettes after successful load.
  for (let fanIndex=0; fanIndex<staticSources.length; fanIndex++) {
    const {id,filename}=staticSources[fanIndex];
    const members=staticMembers[fanIndex];
    if (!members.length) continue;
    void SceneLoader.LoadAssetContainerAsync(
      asset(STATIC_ASSET_DIR), filename, scene
    ).then(container => {
      if (disposed || scene.isDisposed) {container.dispose(); return;}
      const drawable = container.meshes.filter(m => m instanceof Mesh &&
        m.getTotalVertices()>0) as Mesh[];
      if (drawable.length!==1 || container.skeletons.length || container.animationGroups.length) {
        container.dispose();
        throw new Error(`${id} baked crowd asset must contain 1 mesh, no rig and no animation`);
      }
      container.addAllToScene();
      staticContainers.push(container);
      for(const node of container.rootNodes) node.parent=root;
      const mesh=drawable[0];
      mesh.name=`rinaMazeRealStatic_${filename.replace(".glb", "")}`;
      mesh.isPickable=false;
      mesh.checkCollisions=false;
      mesh.receiveShadows=false;
      mesh.alwaysSelectAsActiveMesh=true;
      // Use the same directional PBR response as the animated field fans.
      prepareRinaCrowdMaterial(mesh.material, true);
      for (const light of actorLights) light.includedOnlyMeshes.push(mesh);
      // No bone or texture transformation: new static asset has its original
      // texture and a baked skeleton pose in local mesh coordinates.
      mesh.computeWorldMatrix(true);
      const inverseWorld=mesh.getWorldMatrix().clone().invert();
      const height=Math.max(.01,mesh.getBoundingInfo().boundingBox.extendSize.y*2);
      const originalFan=RINA_CROWD_FANS.find(f=>f.id===id);
      const targetWorldHeight=originalFan?.targetWorldHeight ?? 2.56;
      // Desired transforms are WORLD transforms because inverseWorld already
      // includes stadiumRoot(1.5). Applying the 1.5 a second time or not
      // applying it to translation would detach the mesh from its collider.
      const scaleBase=targetWorldHeight/height;
      const matrices=new Float32Array(members.length*16);
      const posedPlacements: RinaFieldCrowdMotionPlacement[] = [];
      for(let i=0;i<members.length;i++) {
        const p=members[i];
        const scale=scaleBase*(.96+(.08*((i*17)%11)/11));
        posedPlacements.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale });
        const desired=Matrix.Compose(new Vector3(scale,scale,scale),
          Quaternion.RotationAxis(Vector3.Up(),p.yaw),
          new Vector3(p.x*RINA_STADIUM_SCALE,p.y*RINA_STADIUM_SCALE,
            p.z*RINA_STADIUM_SCALE));
        desired.multiply(inverseWorld).copyToArray(matrices,i*16);
      }
      mesh.thinInstanceSetBuffer("matrix",matrices,16,false);
      crowdMotion.trackBaked(mesh, posedPlacements, matrices, inverseWorld, RINA_STADIUM_SCALE);
      mesh.thinInstanceRefreshBoundingInfo(true,true);
      clearSilhouettesAround(members);
      realStatic+=members.length;
    }).catch(error=>{
      console.warn(`Rina maze static fan ${filename}: using silhouette fallback`,error);
    });
  }

  type AnimatedGroup = {clips:readonly AnimationGroup[];playingIndex:number};
  const animated:AnimatedGroup[]=[];
  const playOnlyClip = (clips: readonly AnimationGroup[], index: number) => {
    for (const clip of clips) clip.stop();
    clips[index].start(false);
  };
  rigFans.forEach((fan,index)=>{
    const members=animatedRim.filter((_,i)=>i%rigFans.length===index);
    if(!members.length)return;
    void registry.loadAnimated(fan,"middle",1).then(groups=>{
      if(!groups || disposed || scene.isDisposed)return;
      for(let groupIndex=0; groupIndex<groups.length; groupIndex++) {
        const group=groups[groupIndex];
        const cohortMembers=members.filter((_,memberIndex)=>
          memberIndex % groups.length === groupIndex);
        if(!cohortMembers.length) {
          group.mesh.setEnabled(false);
          continue;
        }
        const mesh=group.mesh;
        // The stadium root scales its children by 1.5. Include that parent
        // before taking the inverse, or the final fan becomes 1.5x too tall.
        for(const node of group.roots)node.parent=root;
        mesh.computeWorldMatrix(true);
        const inverseWorld=mesh.getWorldMatrix().clone().invert();
        const height=Math.max(.001,mesh.getBoundingInfo().boundingBox.extendSize.y*2);
        const resize=fan.targetWorldHeight/height;
        const vals=new Float32Array(cohortMembers.length*16);
        for(let i=0;i<cohortMembers.length;i++) {
          const p=cohortMembers[i];
          const worldWanted=Matrix.Compose(new Vector3(resize,resize,resize),
            Quaternion.RotationAxis(Vector3.Up(),p.yaw),
            new Vector3(p.x*RINA_STADIUM_SCALE,0,p.z*RINA_STADIUM_SCALE));
          worldWanted.multiply(inverseWorld).copyToArray(vals,i*16);
        }
        mesh.thinInstanceSetBuffer("matrix",vals,16,true);
        mesh.thinInstanceRefreshBoundingInfo(true,true);
        const playingIndex=(index+groupIndex)%group.clips.length;
        playOnlyClip(group.clips, playingIndex);
        animated.push({clips:group.clips,playingIndex});
      }
      clearSilhouettesAround(members);
    });
  });

  const originalSilhouetteCount=batches.reduce((count,items)=>count+items.length,0);
  return {
    root,
    get stats() {
      return {silhouettes:originalSilhouetteCount-replaced.size,
        perimeterCandidates:rim.length,staticFans:realStatic,
        rigVariantsRequested:rigFans.length};
    },
    update(elapsed,beatPulse) {
      if(disposed || !root.isEnabled())return;
      for(const group of animated) {
        if(group.clips[group.playingIndex].isPlaying)continue;
        group.playingIndex=(group.playingIndex+1)%group.clips.length;
        playOnlyClip(group.clips, group.playingIndex);
      }
      crowdMotion.update(elapsed,beatPulse);
    },
    setEnabled(enabled) {if(!disposed)root.setEnabled(enabled);},
    dispose() {
      if(disposed)return;
      disposed=true;
      crowdMotion.dispose();
      registry.dispose();
      for (const light of actorLights) {
        light.includedOnlyMeshes = light.includedOnlyMeshes.filter(mesh =>
          !staticContainers.some(container => container.meshes.includes(mesh)));
      }
      for(const container of staticContainers)container.dispose();
      for(const mesh of meshes) if(!mesh.isDisposed())mesh.dispose();
      root.dispose(false,false);
      for(const mat of crowdMaterials)mat.dispose();
    },
  };
}
