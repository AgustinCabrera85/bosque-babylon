import "@babylonjs/core/Meshes/thinInstanceMesh";
import "@babylonjs/loaders/glTF";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Light } from "@babylonjs/core/Lights/light";
import type { Scene } from "@babylonjs/core/scene";
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
  /** Resolves once LOD assets and their thin instance buffers are ready. */
  readonly ready: Promise<void>;
  readonly stats: Readonly<{
    silhouettes: number; perimeterCandidates: number; staticFans: number;
    rigVariantsRequested: number; lod2Rim: number; lod2Core: number;
    lod1Animated: number; trianglesEstimated: number; sectors: number;
  }>;
  update(elapsed: number, beatPulse: number, music: MusicPlaybackState | null): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export const RINA_FIELD_CROWD_MAZE_RENDER_CONFIG = {
  // Keep every layout slot formerly occupied by a procedural spectator. The
  // ceiling only guards against accidental growth if the maze expands.
  desktop: { spacing: 1.00, keep: 0.88, staticFansMax: 6000,
    animatedFansMax: 1000, animatedRigKinds: 5 },
  mobile: { spacing: 1.45, keep: 0.72, staticFansMax: 3000,
    animatedFansMax: 0, animatedRigKinds: 0 },
  rimOffset: 0.13,
  rimSpacing: 0.72,
  rimDedupeDistance: 0.49,
  coreMargin: 0.86,
  proximityBetweenRigged: 0.48,
  proximityBetweenDetailed: 1.18,
  proximityBetweenSameFan: 2.25,
} as const;

/** Markers at the actual analytical collision boundary, useful while tuning. */
export const DEBUG_RINA_MAZE_COLLISION = false;
/** Local development switch. Off fails visibly instead of restoring procedural people. */
export const USE_FIELD_CROWD_LOD = true;

type CrowdFootprint = { x: number; z: number };
type FigurePlacement = CrowdFootprint & { y: number; yaw: number; scale: number; style: number };
type StaticSource = {
  fanId: string; filename: string; container: AssetContainer; mesh: Mesh;
  worldHeight: number; triangles: number;
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
  let disposed = false;
  let staticFans = 0, lod2Rim = 0, lod2Core = 0, lod1Animated = 0;
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

  if (DEBUG_RINA_MAZE_COLLISION) {
    const eps = .08;
    const lines = rim.map(p => {
      const gx = layout.marginToCrowd(p.x + eps, p.z) - layout.marginToCrowd(p.x - eps, p.z);
      const gz = layout.marginToCrowd(p.x, p.z + eps) - layout.marginToCrowd(p.x, p.z - eps);
      const size = Math.max(.00001, Math.hypot(gx, gz));
      const offset = RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.rimOffset + .32;
      const x = p.x - gx / size * offset, z = p.z - gz / size * offset;
      return [new Vector3(x, .10, z), new Vector3(x, .75, z)];
    });
    const debug = MeshBuilder.CreateLineSystem("rinaMazeBoundaryDebug", { lines }, scene);
    debug.color = new Color3(1, .10, .12);
    debug.isPickable = false;
    debug.parent = root;
  }

  // A few shared rigs occupy distinct rim slots. Unavailable LOD1 assets do
  // not reserve those positions: LOD2 will fill the space instead.
  const animatedRim: FigurePlacement[] = [];
  for (let i = 0; i < rim.length && animatedRim.length < settings.animatedFansMax; i++) {
    const candidate = rim[(i * 37) % rim.length];
    if (spaced(candidate, animatedRim, RINA_FIELD_CROWD_MAZE_RENDER_CONFIG.proximityBetweenRigged)) {
      animatedRim.push(candidate);
    }
  }

  type AnimatedGroup = {
    clips: readonly AnimationGroup[]; playingIndex: number; chorusMode: boolean | null;
    calmClips: readonly number[]; chorusClips: readonly number[];
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
    const rigRequests = performanceTier === "mobile" ? [] :
      RINA_FIELD_CROWD_LODS.slice(0, settings.animatedRigKinds).map(async fanLod => {
        const fan = RINA_CROWD_FANS.find(item => item.id === fanLod.id);
        if (!fan) return null;
        try {
          const groups = await registry.loadAnimated(fan, "middle", 1,
            `${RINA_FIELD_CROWD_LOD_DIR}${fanLod.animated}`);
          return groups?.[0] ? { fan, group: groups[0] } : null;
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
    const activeAnimated = rigs.length ? animatedRim : [];
    const rigSlots = new Map<string, FigurePlacement[]>();
    for (const { fan } of rigs) rigSlots.set(fan.id, []);
    for (let i = 0; i < activeAnimated.length; i++) {
      rigSlots.get(rigs[i % rigs.length].fan.id)!.push(activeAnimated[i]);
    }
    for (const { fan, group } of rigs) {
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

    // The previous 1100-person cap sampled only the rim and the first thin
    // strip of the core, leaving most of the former procedural crowd empty.
    // Use the original deterministic slots throughout the field. Only the
    // slots replaced by a rigged fan are removed to avoid double characters.
    const replacementRadius = 0.65;
    const selectedRim = rim.filter(p => spaced(p, activeAnimated, replacementRadius));
    const selectedCore = core.filter(p => spaced(p, activeAnimated, replacementRadius));
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
    }
    lod2Rim = selectedRim.length;
    lod2Core = selectedCore.length;
    staticFans = lod2Rim + lod2Core;
    console.info("Rina field crowd LOD", { coreCandidates: core.length, rimCandidates: rim.length,
      lod1Animated, lod2Rim, lod2Core,
      sectors: staticBatches.length, trianglesEstimated, lego: 0 });
  })();

  return {
    root, ready,
    get stats() {
      return { silhouettes: 0, perimeterCandidates: rim.length, staticFans,
        rigVariantsRequested: settings.animatedRigKinds, lod2Rim, lod2Core,
        lod1Animated, trianglesEstimated, sectors: staticBatches.length };
    },
    update(elapsed, beatPulse, music) {
      if (disposed || !root.isEnabled()) return;
      const cue = getRinaFieldCrowdCue(music);
      const inChorus = cue.chorus >= .55;
      for (const group of animated) {
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
      for (const container of staticContainers) container.dispose();
      registry.dispose();
      root.dispose(false, false);
    },
  };
}
