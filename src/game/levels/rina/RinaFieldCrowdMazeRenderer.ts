import "@babylonjs/core/Meshes/thinInstanceMesh";
import "@babylonjs/loaders/glTF";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Light } from "@babylonjs/core/Lights/light";
import type { Scene } from "@babylonjs/core/scene";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { MusicPlaybackState } from "../../MusicPlayer";
import { asset } from "../../../utils/asset";
import { RINA_CROWD_FANS } from "./crowd/RinaCrowdAssetManifest";
import { prepareRinaCrowdMaterial, RinaCrowdAssetRegistry } from "./crowd/RinaCrowdAssetRegistry";
import { RINA_FIELD_CROWD_LODS, RINA_FIELD_CROWD_LOD_DIR } from "./crowd/RinaFieldCrowdLODManifest";
import { RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";
import type { RinaFieldCrowdMazeLayout } from "./RinaFieldCrowdMazeLayout";
import { RinaFieldCrowdMotionController } from "./RinaFieldCrowdMotion";
import type { RinaFieldCrowdMotionPlacement } from "./RinaFieldCrowdMotion";
import { getRinaFieldCrowdClipPools, getRinaFieldCrowdCue } from "./RinaFieldCrowdMusic";

/** Field-only crowd. All positions come from the same layout used by collision. */
export interface RinaFieldCrowdMazeRenderHandle {
  readonly root: TransformNode;
  /** Individually animated hero spectators reserved for hand-held phones. */
  readonly phoneRigs: readonly RinaFieldPhoneRig[];
  /** Resolves once LOD assets and their thin instance buffers are ready. */
  readonly ready: Promise<void>;
  readonly stats: Readonly<{
    silhouettes: number; perimeterCandidates: number; staticFans: number;
    rigVariantsRequested: number; lod2Rim: number; lod2Core: number;
    lod1Animated: number; trianglesEstimated: number; sectors: number;
    recordingPhones: number;
  }>;
  update(elapsed: number, beatPulse: number, music: MusicPlaybackState | null): void;
  /** Reuses the one low-resolution stage capture used by the animated fans. */
  setPhoneScreenTexture(texture: BaseTexture | null): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface RinaFieldPhoneRig {
  readonly id: string;
  readonly fanId: string;
  readonly mesh: Mesh;
  readonly clips: readonly AnimationGroup[];
  setPhotoActionActive(active: boolean): void;
}

export const RINA_FIELD_CROWD_MAZE_RENDER_CONFIG = {
  // Keep every layout slot formerly occupied by a procedural spectator. The
  // ceiling only guards against accidental growth if the maze expands.
  desktop: { spacing: 1.00, keep: 0.88, staticFansMax: 6000,
    animatedFansMax: 1000, animatedRigKinds: 5 },
  mobile: { spacing: 1.45, keep: 0.72, staticFansMax: 3000,
    animatedFansMax: 0, animatedRigKinds: 3 },
  rimOffset: 0.13,
  rimSpacing: 0.72,
  rimDedupeDistance: 0.49,
  coreMargin: 0.86,
  proximityBetweenRigged: 0.48,
  proximityBetweenDetailed: 1.18,
  proximityBetweenSameFan: 2.25,
} as const;

/** Local development switch. Off fails visibly instead of restoring procedural people. */
export const USE_FIELD_CROWD_LOD = true;

type CrowdFootprint = { x: number; z: number };
type FigurePlacement = CrowdFootprint & { y: number; yaw: number; scale: number; style: number };
type StaticSource = {
  fanId: string; filename: string; container: AssetContainer; mesh: Mesh;
  worldHeight: number; triangles: number;
};

// Measured from the matching LOD2 baked vertices. LOD1 and LOD2 preserve
// vertex order, so the LOD1 hand weights identify each static palm/fingers.
// Coordinates are relative to model height, with Y measured from its feet.
// Use only poses where an open hand can touch the frame without hiding the
// display; the rally fist and low cheer hands remain phone-free.
const RECORDING_PHONE_GRIPS: Readonly<Record<string, readonly [number, number, number]>> = {
  "fan_02:clap": [-0.094, 0.977, 0.095], // right edge between thumb and index
  "fan_03:cheer": [-0.160, 0.975, -0.075], // right thumb and index on the edge
  "fan_04:cheer": [0.086, 1.003, -0.061], // left edge between thumb and index
  "fan_04:clap": [-0.112, 0.952, 0.212], // right edge between thumb and index
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Match the analytical passage border; dedupe intersections and endcaps. */
function generateRim(layout: RinaFieldCrowdMazeLayout): CrowdFootprint[] {
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
      for (const p of seen.get(`${ix + ox}/${iz + oz}`) ?? []) {
        if (Math.hypot(x - p.x, z - p.z) < cell) return;
      }
    }
    const p = { x, z };
    result.push(p);
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

function spaced(candidate: CrowdFootprint, other: readonly CrowdFootprint[], distance: number): boolean {
  const squared = distance * distance;
  return other.every(p => (candidate.x - p.x) ** 2 + (candidate.z - p.z) ** 2 >= squared);
}

function alongCrowdEdge(layout: RinaFieldCrowdMazeLayout, p: CrowdFootprint) {
  const eps = 0.08;
  const gx = layout.marginToCrowd(p.x + eps, p.z) -
    layout.marginToCrowd(p.x - eps, p.z);
  const gz = layout.marginToCrowd(p.x, p.z + eps) -
    layout.marginToCrowd(p.x, p.z - eps);
  const length = Math.hypot(gx, gz);
  if (length <= 0.0001) return { driftX: 0, driftZ: 0 };
  const tx = -gz / length, tz = gx / length;
  // At tight corners a nominal tangent may cut through the walking border.
  const clearance = Math.min(
    layout.marginToCrowd(p.x + tx * 0.2, p.z + tz * 0.2),
    layout.marginToCrowd(p.x - tx * 0.2, p.z - tz * 0.2));
  const safe = Math.max(0, Math.min(1, (clearance - 0.08) / 0.12));
  return { driftX: tx * safe, driftZ: tz * safe };
}

export function createRinaFieldCrowdMazeRenderer(
  scene: Scene,
  performanceTier: "desktop" | "mobile",
  layout: RinaFieldCrowdMazeLayout,
  actorLights: readonly Light[] = []
): RinaFieldCrowdMazeRenderHandle {
  if (!USE_FIELD_CROWD_LOD) {
    throw new Error("Rina field crowd LOD is disabled; no procedural fallback is available");
  }
  const root = new TransformNode("rinaFieldCrowdMazeRoot", scene);
  const settings = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG[performanceTier];
  const random = rng(0x20261023);
  const registry = new RinaCrowdAssetRegistry(scene, actorLights, true);
  const motion = new RinaFieldCrowdMotionController(performanceTier);
  const staticContainers: AssetContainer[] = [];
  const staticBatches: Mesh[] = [];
  const recordingPhoneMeshes: Mesh[] = [];
  const recordingPhoneBodyMaterial = new StandardMaterial("rinaIslandPhoneBody", scene);
  recordingPhoneBodyMaterial.diffuseColor = new Color3(0.012, 0.016, 0.02);
  recordingPhoneBodyMaterial.specularColor = new Color3(0.04, 0.04, 0.05);
  const recordingPhoneScreenMaterial = new StandardMaterial("rinaIslandPhoneScreen", scene);
  recordingPhoneScreenMaterial.diffuseColor = Color3.White();
  recordingPhoneScreenMaterial.specularColor = Color3.Black();
  recordingPhoneScreenMaterial.emissiveColor = Color3.Black();
  recordingPhoneScreenMaterial.disableLighting = true;
  recordingPhoneScreenMaterial.backFaceCulling = false;
  recordingPhoneScreenMaterial.fogEnabled = false;
  const phoneRigs: RinaFieldPhoneRig[] = [];
  const usedPhoneRim: FigurePlacement[] = [];
  let disposed = false;
  let staticFans = 0, lod2Rim = 0, lod2Core = 0, lod1Animated = 0;
  let recordingPhones = 0;
  let trianglesEstimated = 0;

  // Keep the old deterministic placement sequence, including its style draw.
  // It is also the source of the established maze collision visualization.
  const core: FigurePlacement[] = [];
  const rim: FigurePlacement[] = [];
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
      if (layout.marginToCrowd(xx, zz) < RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.coreMargin) continue;
      const style = Math.floor(random() * 4);
      core.push({ x: xx, z: zz, y: 0,
        yaw: (random() - .5) * .5, scale: .92 + random() * .17, style });
    }
  }
  for (const p of generateRim(layout)) {
    const style = Math.floor(random() * 4);
    rim.push({ x: p.x, z: p.z, y: 0,
      yaw: (random() - .5) * .34, scale: .95 + random() * .11, style });
  }

  // The rim is the visible edge of the real crowd. These slots stay out of
  // the thin-instance batches so each phone has its own animated skeleton.
  const phoneTargets = [
    { x: -3, z: -32 }, { x: 9, z: -24 }, { x: -11, z: -17 },
    { x: 8, z: -9 }, { x: -6, z: -2 }, { x: 12, z: 5 },
    { x: -12, z: 12 }, { x: 7, z: 19 },
  ];
  const phoneRim: FigurePlacement[] = [];
  for (const target of phoneTargets.slice(0, performanceTier === "mobile" ? 3 : 8)) {
    const candidate = [...rim].sort((a, b) =>
      (a.x - target.x) ** 2 + (a.z - target.z) ** 2 -
      ((b.x - target.x) ** 2 + (b.z - target.z) ** 2))
      .find(p => spaced(p, phoneRim, 4));
    if (candidate) phoneRim.push(candidate);
  }
  // A few shared rigs occupy other distinct rim slots. Unavailable LOD1
  // assets do not reserve those positions: LOD2 fills the space instead.
  const animatedRim: FigurePlacement[] = [];
  for (let i = 0; i < rim.length && animatedRim.length < settings.animatedFansMax; i++) {
    const candidate = rim[(i * 37) % rim.length];
    if (spaced(candidate, animatedRim, RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.proximityBetweenRigged)
      && spaced(candidate, phoneRim, 0.8)) {
      animatedRim.push(candidate);
    }
  }

  type AnimatedGroup = {
    clips: readonly AnimationGroup[]; playingIndex: number; chorusMode: boolean | null;
    calmClips: readonly number[]; chorusClips: readonly number[];
    photoActionActive?: boolean;
  };
  const animated: AnimatedGroup[] = [];
  const playOnlyClip = (clips: readonly AnimationGroup[], index: number) => {
    for (const clip of clips) clip.stop();
    clips[index].start(false);
  };

  async function loadStaticSource(fanId: string, filename: string): Promise<StaticSource | null> {
    let container: AssetContainer | null = null;
    try {
      container = await SceneLoader.LoadAssetContainerAsync(asset(RINA_FIELD_CROWD_LOD_DIR), filename, scene);
      if (disposed || scene.isDisposed) { container.dispose(); return null; }
      const drawable = container.meshes.filter(m => m instanceof Mesh && m.getTotalVertices() > 0) as Mesh[];
      if (drawable.length !== 1 || container.skeletons.length || container.animationGroups.length) {
        throw new Error("expected one static mesh, no skeleton and no animation");
      }
      container.addAllToScene();
      staticContainers.push(container);
      for (const node of container.rootNodes) node.parent = root;
      const mesh = drawable[0];
      mesh.name = `rinaMazeLOD2Source_${filename}`;
      mesh.isVisible = false; // The loader's base mesh must never render at the origin.
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      prepareRinaCrowdMaterial(mesh.material, true);
      const fan = RINA_CROWD_FANS.find(item => item.id === fanId);
      return { fanId, filename, container, mesh,
        worldHeight: fan?.targetWorldHeight ?? 2.56,
        triangles: Math.floor((mesh.getIndices()?.length ?? 0) / 3) };
    } catch (error) {
      if (container) {
        const index = staticContainers.indexOf(container);
        if (index >= 0) staticContainers.splice(index, 1);
        container.dispose();
      }
      console.warn(`Rina field LOD2 ${filename} unavailable`, error);
      return null;
    }
  }

  const ready = (async () => {
    const staticRequests = RINA_FIELD_CROWD_LODS.flatMap(fan =>
      fan.static.map(filename => loadStaticSource(fan.id, filename)));
    const rigRequests = RINA_FIELD_CROWD_LODS.slice(0, settings.animatedRigKinds).map(async (fanLod, index) => {
        const fan = RINA_CROWD_FANS.find(item => item.id === fanLod.id);
        if (!fan) return null;
        try {
          const groups = await registry.loadAnimated(fan, "middle",
            performanceTier === "mobile" ? 1 : index < 3 ? 3 : 2,
            `${RINA_FIELD_CROWD_LOD_DIR}${fanLod.animated}`);
          return groups?.[0] ? { fan, groups } : null;
        } catch (error) {
          console.warn(`Rina field LOD1 ${fanLod.animated} unavailable`, error);
          return null;
        }
      });
    const [staticResults, rigResults] = await Promise.all([
      Promise.all(staticRequests), Promise.all(rigRequests),
    ]);
    if (disposed || scene.isDisposed) return;
    const sources = staticResults.filter((source): source is StaticSource => source !== null);
    if (!sources.length) throw new Error("Rina field crowd: no LOD2 models loaded");
    const rigs = rigResults.filter((result): result is NonNullable<typeof result> => result !== null);
    const activeAnimated = performanceTier === "mobile" ? [] : rigs.length ? animatedRim : [];
    const rigSlots = new Map<string, FigurePlacement[]>();
    for (const { fan } of rigs) rigSlots.set(fan.id, []);
    for (let i = 0; i < activeAnimated.length; i++) {
      rigSlots.get(rigs[i % rigs.length].fan.id)!.push(activeAnimated[i]);
    }
    for (const { fan, groups } of rigs) {
      const group = groups[0];
      const members = rigSlots.get(fan.id)!;
      if (!members.length) { group.mesh.setEnabled(false); continue; }
      for (const node of group.roots) node.parent = root;
      const mesh = group.mesh;
      mesh.computeWorldMatrix(true);
      const inverse = mesh.getWorldMatrix().clone().invert();
      const bounds = mesh.getBoundingInfo().boundingBox;
      const height = Math.max(.001, bounds.extendSize.y * 2);
      const resize = fan.targetWorldHeight / height;
      const matrices = new Float32Array(members.length * 16);
      for (let i = 0; i < members.length; i++) {
        const p = members[i];
        Matrix.Compose(new Vector3(resize, resize, resize),
          Quaternion.RotationAxis(Vector3.Up(), p.yaw),
          new Vector3(p.x * RINA_STADIUM_SCALE, 0, p.z * RINA_STADIUM_SCALE))
          .multiply(inverse).copyToArray(matrices, i * 16);
      }
      mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
      mesh.thinInstanceRefreshBoundingInfo(true, true);
      motion.trackBaked(mesh, members.map(p => ({ ...p, scale: resize,
        intensity: 1.3, ...alongCrowdEdge(layout, p) })),
        matrices, inverse, RINA_STADIUM_SCALE);
      const pools = getRinaFieldCrowdClipPools(group.clips.map(clip => clip.name));
      const playingIndex = RINA_FIELD_CROWD_LODS.findIndex(item => item.id === fan.id) % group.clips.length;
      playOnlyClip(group.clips, playingIndex);
      animated.push({ clips: group.clips, playingIndex, chorusMode: null,
        calmClips: pools.calm, chorusClips: pools.chorus });
      lod1Animated += members.length;
      trianglesEstimated += members.length * Math.floor((mesh.getIndices()?.length ?? 0) / 3);
    }

    for (let i = 0; i < phoneRim.length; i++) {
      const rig = rigs[i % rigs.length];
      if (!rig) break;
      const group = rig.groups[performanceTier === "mobile"
        ? 0 : 1 + Math.floor(i / rigs.length)];
      if (!group) continue;
      const p = phoneRim[i];
      const mesh = group.mesh;
      const height = Math.max(.001, mesh.getBoundingInfo().boundingBox.extendSize.y * 2);
      const placement = new TransformNode(`rinaPhoneFanPlacement_${rig.fan.id}`, scene);
      placement.parent = root;
      placement.position.set(p.x, 0, p.z);
      placement.rotation.y = p.yaw;
      for (const node of group.roots) node.parent = placement;
      // The GLB has an Armature node scaled to 0.01. Measure its composed
      // world matrix after parenting; sizing from raw mesh bounds alone would
      // make the fan and its hand bones a hundred times too small.
      mesh.computeWorldMatrix(true);
      const matrix = mesh.getWorldMatrix().m;
      const importedHeight = height * Math.hypot(matrix[4], matrix[5], matrix[6]);
      placement.scaling.setAll(rig.fan.targetWorldHeight / Math.max(.001, importedHeight));
      const pools = getRinaFieldCrowdClipPools(group.clips.map(clip => clip.name));
      playOnlyClip(group.clips, pools.calm[0]);
      const animatedGroup: AnimatedGroup = { clips: group.clips,
        playingIndex: pools.calm[0], chorusMode: null,
        calmClips: pools.calm, chorusClips: pools.chorus };
      animated.push(animatedGroup);
      phoneRigs.push({ id: `${rig.fan.id}-${i}`, fanId: rig.fan.id,
        mesh, clips: group.clips,
        setPhotoActionActive(active) {
          if (animatedGroup.photoActionActive === active) return;
          animatedGroup.photoActionActive = active;
          if (active) group.clips[animatedGroup.playingIndex].pause();
          else group.clips[animatedGroup.playingIndex].play(false);
        } });
      usedPhoneRim.push(p);
      lod1Animated++;
      trianglesEstimated += Math.floor((mesh.getIndices()?.length ?? 0) / 3);
    }

    // The previous 1100-person cap sampled only the rim and the first thin
    // strip of the core, leaving most of the former procedural crowd empty.
    // Use the original deterministic slots throughout the field. Only the
    // slots replaced by a rigged fan are removed to avoid double characters.
    const replacementRadius = 0.65;
    const reserved = [...activeAnimated, ...usedPhoneRim];
    const selectedRim = rim.filter(p => spaced(p, reserved, replacementRadius));
    const selectedCore = core.filter(p => spaced(p, reserved, replacementRadius));
    if (selectedRim.length + selectedCore.length > settings.staticFansMax) {
      throw new Error(`Rina field crowd has ${selectedRim.length + selectedCore.length} LOD2 slots, ` +
        `exceeding the configured ${performanceTier} ceiling of ${settings.staticFansMax}`);
    }

    // Assign each placement to an available pose, preserving identity variety.
    const bySource = new Map<StaticSource, { rim: FigurePlacement[]; core: FigurePlacement[] }>();
    for (const source of sources) bySource.set(source, { rim: [], core: [] });
    const byFan = new Map<string, CrowdFootprint[]>();
    for (const source of sources) if (!byFan.has(source.fanId)) byFan.set(source.fanId, []);
    for (const [fanId, placements] of rigSlots) byFan.get(fanId)?.push(...placements);
    const assign = (placements: readonly FigurePlacement[], region: "rim" | "core") => {
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        const ordered = [...sources].sort((a, b) => {
          const aNear = spaced(p, byFan.get(a.fanId)!,
            RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.proximityBetweenSameFan) ? 0 : 1;
          const bNear = spaced(p, byFan.get(b.fanId)!,
            RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.proximityBetweenSameFan) ? 0 : 1;
          return aNear - bNear || bySource.get(a)![region].length - bySource.get(b)![region].length ||
            (sources.indexOf(a) - i % sources.length + sources.length) % sources.length -
            (sources.indexOf(b) - i % sources.length + sources.length) % sources.length;
        });
        const source = ordered[0];
        bySource.get(source)![region].push(p);
        byFan.get(source.fanId)!.push(p);
      }
    };
    assign(selectedRim, "rim");
    assign(selectedCore, "core");

    const addRecordingPhones = (source: StaticSource,
      placements: readonly FigurePlacement[], grip: readonly [number, number, number]) => {
      // The LOD2 crowd is a baked mesh. These particular variants already
      // have raised hands; put a phone against one palm and move it with the same
      // foot-pivot sway as its owner. One body and one display draw all copies.
      if (!placements.length) return;
      // The phone lives under stadiumRoot (scale 1.5), while the imported
      // fan's thin-instance matrix cancels that parent scale. Match the
      // fan's final world height before applying the shared parent transform.
      const height = source.worldHeight / RINA_STADIUM_SCALE;
      const width = height * 0.045;
      const phoneHeight = height * 0.083;
      const bounds = source.mesh.getBoundingInfo().boundingBox;
      const modelHeight = Math.max(0.001, bounds.maximum.y - bounds.minimum.y);
      const centerX = grip[0] * height;
      const centerY = (bounds.minimum.y + grip[1] * modelHeight) * height / modelHeight;
      const centerZ = grip[2] * height;
      const body = MeshBuilder.CreateBox(`rinaIslandPhoneBody_${source.fanId}_${source.filename}`,
        { width, height: phoneHeight, depth: height * 0.005 }, scene);
      body.position.set(centerX, centerY, centerZ);
      body.bakeCurrentTransformIntoVertices();
      body.material = recordingPhoneBodyMaterial;
      const screen = MeshBuilder.CreatePlane(`rinaIslandPhoneScreen_${source.fanId}_${source.filename}`,
        { width: width * 0.87, height: phoneHeight * 0.87 }, scene);
      // The spectator is behind the device (-Z); the camera faces Rina (+Z).
      screen.position.set(centerX, centerY, centerZ - height * 0.0031);
      screen.bakeCurrentTransformIntoVertices();
      screen.material = recordingPhoneScreenMaterial;
      for (const mesh of [body, screen]) {
        mesh.parent = root;
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.receiveShadows = false;
        mesh.alwaysSelectAsActiveMesh = true;
        const matrices = new Float32Array(placements.length * 16);
        for (let i = 0; i < placements.length; i++) {
          const p = placements[i];
          const scale = .97 + (p.scale - .92) / .17 * .06;
          Matrix.Compose(new Vector3(scale, scale, scale),
            Quaternion.RotationAxis(Vector3.Up(), p.yaw),
            new Vector3(p.x, 0, p.z)).copyToArray(matrices, i * 16);
        }
        mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
        mesh.thinInstanceRefreshBoundingInfo(true, true);
        motion.trackCore(mesh, placements.map(p => {
          const depth = Math.max(0, Math.min(1,
            (layout.marginToCrowd(p.x, p.z) - 0.35) / 4.0));
          const smoothDepth = depth * depth * (3 - 2 * depth);
          return { ...p, scale: .97 + (p.scale - .92) / .17 * .06,
            intensity: 1.35 - 0.95 * smoothDepth };
        }), matrices);
        recordingPhoneMeshes.push(mesh);
      }
      recordingPhones += placements.length;
    };

    for (const [source, regions] of bySource) {
      const members = [...regions.rim, ...regions.core];
      if (!members.length) continue;
      // Use the imported mesh directly, as the previous posed GLB crowd did.
      // Cloning its transformed hierarchy per sector left most copies out of
      // the rendered field even though their CPU-side positions looked valid.
      const mesh = source.mesh;
      mesh.name = `rinaMazeRealStatic_${source.filename}:field`;
      mesh.isVisible = true;
      mesh.receiveShadows = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.computeWorldMatrix(true);
      const inverse = mesh.getWorldMatrix().clone().invert();
      const height = Math.max(.001, mesh.getBoundingInfo().boundingBox.extendSize.y * 2);
      const baseScale = source.worldHeight / height;
      const matrices = new Float32Array(members.length * 16);
      const colors = new Float32Array(members.length * 4);
      const motionPlacements: RinaFieldCrowdMotionPlacement[] = [];
      for (let i = 0; i < members.length; i++) {
        const p = members[i];
        const scale = baseScale * (.97 + (p.scale - .92) / .17 * .06);
        const depth = Math.max(0, Math.min(1,
          (layout.marginToCrowd(p.x, p.z) - 0.35) / 4.0));
        const smoothDepth = depth * depth * (3 - 2 * depth);
        // Thin-instance color preserves the authored texture hue. Each island
        // falls into shadow a few rows behind its walkable edge.
        const shade = (0.93 - 0.68 * smoothDepth) *
          (0.96 + 0.08 * random());
        const colorOffset = i * 4;
        colors[colorOffset] = shade;
        colors[colorOffset + 1] = shade;
        colors[colorOffset + 2] = shade;
        colors[colorOffset + 3] = 1;
        motionPlacements.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale,
          intensity: 1.35 - 0.95 * smoothDepth });
        Matrix.Compose(new Vector3(scale, scale, scale),
          Quaternion.RotationAxis(Vector3.Up(), p.yaw),
          new Vector3(p.x * RINA_STADIUM_SCALE, 0, p.z * RINA_STADIUM_SCALE))
          .multiply(inverse).copyToArray(matrices, i * 16);
      }
      mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
      mesh.thinInstanceSetBuffer("color", colors, 4, true);
      mesh.thinInstanceRefreshBoundingInfo(true, true);
      motion.trackBaked(mesh, motionPlacements, matrices, inverse, RINA_STADIUM_SCALE);
      for (const light of actorLights) light.includedOnlyMeshes.push(mesh);
      staticBatches.push(mesh);
      trianglesEstimated += members.length * source.triangles;

      // Only baked poses with a genuinely raised palm get a phone. Other
      // cheer poses keep their original animation without a floating device.
      const pose = /_Static_(cheer|clap|rally)_/.exec(source.filename)?.[1];
      const grip = pose && RECORDING_PHONE_GRIPS[`${source.fanId}:${pose}`];
      if (grip) {
        const chance = performanceTier === "mobile" ? 0.38 : 0.55;
        const withPhones = regions.core.filter(p => {
          const n = Math.sin(p.x * 37.719 + p.z * 113.53 + source.fanId.length * 17) * 43758.5453;
          return n - Math.floor(n) < chance;
        });
        addRecordingPhones(source, withPhones, grip);
      }
    }
    lod2Rim = selectedRim.length;
    lod2Core = selectedCore.length;
    staticFans = lod2Rim + lod2Core;
    console.info("Rina field crowd LOD", { coreCandidates: core.length, rimCandidates: rim.length,
      lod1Animated, lod2Rim, lod2Core,
      sectors: staticBatches.length, trianglesEstimated, recordingPhones, lego: 0 });
  })();

  return {
    root, ready, phoneRigs,
    setPhoneScreenTexture(texture) {
      if (!disposed) recordingPhoneScreenMaterial.emissiveTexture = texture;
    },
    get stats() {
      return { silhouettes: 0, perimeterCandidates: rim.length, staticFans,
        rigVariantsRequested: settings.animatedRigKinds, lod2Rim, lod2Core,
        lod1Animated, trianglesEstimated, sectors: staticBatches.length,
        recordingPhones };
    },
    update(elapsed, beatPulse, music) {
      if (disposed || !root.isEnabled()) return;
      const cue = getRinaFieldCrowdCue(music);
      const inChorus = cue.chorus >= .55;
      for (const group of animated) {
        if (group.photoActionActive) continue;
        const pool = inChorus ? group.chorusClips : group.calmClips;
        if (group.chorusMode !== inChorus) {
          group.chorusMode = inChorus;
          group.playingIndex = pool[0];
          playOnlyClip(group.clips, group.playingIndex);
        } else if (!group.clips[group.playingIndex].isPlaying) {
          const current = pool.indexOf(group.playingIndex);
          group.playingIndex = pool[(current + 1) % pool.length];
          playOnlyClip(group.clips, group.playingIndex);
        }
      }
      motion.update(elapsed, beatPulse, cue);
    },
    setEnabled(enabled) { if (!disposed) root.setEnabled(enabled); },
    dispose() {
      if (disposed) return;
      disposed = true;
      motion.dispose();
      for (const light of actorLights) {
        light.includedOnlyMeshes = light.includedOnlyMeshes.filter(mesh =>
          !staticBatches.some(batch => batch === mesh));
      }
      for (const mesh of recordingPhoneMeshes) mesh.dispose(false, false);
      recordingPhoneBodyMaterial.dispose(false, false);
      recordingPhoneScreenMaterial.dispose(false, false);
      for (const container of staticContainers) container.dispose();
      registry.dispose();
      root.dispose(false, false);
    },
  };
}
