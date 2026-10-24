import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import {
  RINA_FIELD_CROWD_BEAT_ORIGIN, RINA_FIELD_CROWD_BEAT_PERIOD,
  type RinaFieldCrowdCue,
} from "./RinaFieldCrowdMusic";

/**
 * Visual movement for FIELD silhouettes and GLB thin instances, not the stands.
 *
 * Animate only thin-instance MATRIX buffers. Do not touch layout nodes,
 * collision spans, model geometry, UVs, baked poses or the source GLBs.
 *
 * The rendering parent is rinaStadiumRoot (scale = 1.5). Procedural
 * silhouettes use stadium-LOCAL transforms; imported baked GLBs are
 * instanced using WORLD transforms compensated by inverseMeshWorld.
 */
export type RinaFieldCrowdMotionPlacement = Readonly<{
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}>;

export const RINA_FIELD_CROWD_MOTION = {
  enabled: true,
  desktop: { updatesPerSecond: 10, swayRadians: 0.044, yawRadians: 0.060,
    bobLocal: 0.024, chorusJumpLocal: 0.16 },
  mobile: { updatesPerSecond: 5, swayRadians: 0.022, yawRadians: 0.027,
    bobLocal: 0.012, chorusJumpLocal: 0.10 },
  // Reduce the motion of cheap interior silhouettes. Keep the edge expressive.
  coreIntensity: 0.62,
  rimIntensity: 1.0,
  // No animated translation across X/Z: visual actor never leaves its collider.
  horizontalDisplacement: 0,
} as const;

type Track = {
  mesh: Mesh;
  instances: readonly RinaFieldCrowdMotionPlacement[];
  matrices: Float32Array;
  type: "core" | "baked";
  /** PRESENT only for imported GLBs whose matrices are world-space corrected. */
  inverseMeshWorld?: Matrix;
  stadiumScale: number;
};

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function hash01(x: number, z: number): number {
  const f = Math.sin(x * 12.9898 + z * 78.233 + 3.171) * 43758.5453123;
  return f - Math.floor(f);
}

/** No per-instance Matrix allocations. Matches Babylon's column-major Y rotation. */
function writeLocalMatrix(
  data: Float32Array, off: number, p: RinaFieldCrowdMotionPlacement,
  yaw: number, lean: number, verticalOffset: number,
): void {
  const sc = p.scale;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cz = Math.cos(lean), sz = Math.sin(lean);
  // R = Ry(yaw) * Rz(lean). Translation stays at original x/z.
  data[off] = cy * cz * sc;
  data[off + 1] = sz * sc;
  data[off + 2] = -sy * cz * sc;
  data[off + 3] = 0;
  data[off + 4] = -cy * sz * sc;
  data[off + 5] = cz * sc;
  data[off + 6] = sy * sz * sc;
  data[off + 7] = 0;
  data[off + 8] = sy * sc;
  data[off + 9] = 0;
  data[off + 10] = cy * sc;
  data[off + 11] = 0;
  data[off + 12] = p.x;
  data[off + 13] = p.y + verticalOffset;
  data[off + 14] = p.z;
  data[off + 15] = 1;
}

export class RinaFieldCrowdMotionController {
  private tracks = new Map<Mesh, Track>();
  private readonly tempScale = new Vector3(1, 1, 1);
  private readonly tempPosition = Vector3.Zero();
  private readonly tempRotation = Quaternion.Identity();
  private readonly tempWorld = Matrix.Identity();
  private readonly tempInstance = Matrix.Identity();
  private previousElapsed: number | null = null;
  private lastUpload = -Infinity;
  private pulse = 0;
  private activity = 0.12;
  private chorus = 0;
  private disposed = false;
  private readonly conf: typeof RINA_FIELD_CROWD_MOTION.desktop | typeof RINA_FIELD_CROWD_MOTION.mobile;

  constructor(performanceTier: "desktop" | "mobile") {
    this.conf = RINA_FIELD_CROWD_MOTION[performanceTier];
  }

  /**
   * Re-register after replacing a silhouette batch (e.g. when an imported
   * static GLB successfully replaces one of the fallback silhouettes).
   * Pass the SAME Float32Array used in mesh.thinInstanceSetBuffer("matrix").
   * That buffer must be created with staticBuffer=false.
   */
  trackCore(mesh: Mesh, instances: readonly RinaFieldCrowdMotionPlacement[],
    matrixData: Float32Array): void {
    if (this.disposed) return;
    if (matrixData.length !== instances.length * 16) {
      throw new Error(`Rina maze core motion: matrix buffer mismatch for ${mesh.name}`);
    }
    this.tracks.set(mesh, {
      mesh, instances, matrices: matrixData,
      type: "core", stadiumScale: 1,
    });
  }

  /**
   * Imported posed or rigged GLB thin instances. `scale` is already the actual
   * WORLD desired scale (the same number used by the existing renderer).
   * `inverseMeshWorld` is measured AFTER parenting to the stadium root.
   */
  trackBaked(mesh: Mesh, instances: readonly RinaFieldCrowdMotionPlacement[],
    matrixData: Float32Array, inverseMeshWorld: Matrix, stadiumScale: number): void {
    if (this.disposed) return;
    if (matrixData.length !== instances.length * 16) {
      throw new Error(`Rina maze baked motion: matrix buffer mismatch for ${mesh.name}`);
    }
    this.tracks.set(mesh, {
      mesh, instances, matrices: matrixData, type: "baked",
      inverseMeshWorld: inverseMeshWorld.clone(), stadiumScale,
    });
  }

  untrack(mesh: Mesh): void { this.tracks.delete(mesh); }

  /** `elapsedSeconds` is the absolute level time, not deltaTime. */
  update(elapsedSeconds: number, beatPulse: number, cue: RinaFieldCrowdCue): void {
    if (this.disposed || !RINA_FIELD_CROWD_MOTION.enabled || !Number.isFinite(elapsedSeconds)) return;
    const dt = this.previousElapsed === null
      ? 0 : Math.max(0, Math.min(0.05, elapsedSeconds - this.previousElapsed));
    this.previousElapsed = elapsedSeconds;
    // Capture short stage beats even when the matrix upload is throttled.
    this.pulse = Math.max(clamp01(beatPulse), this.pulse * Math.exp(-5.5 * dt));
    this.activity += (cue.activity - this.activity) * Math.min(1, dt * 4.5);
    this.chorus += (cue.chorus - this.chorus) * Math.min(1, dt * 7);
    if (elapsedSeconds - this.lastUpload < 1 / this.conf.updatesPerSecond) return;
    this.lastUpload = elapsedSeconds;

    for (const track of this.tracks.values()) {
      const { mesh, instances, matrices } = track;
      if (mesh.isDisposed() || !mesh.isEnabled()) continue;
      const intensity = track.type === "core"
        ? RINA_FIELD_CROWD_MOTION.coreIntensity : RINA_FIELD_CROWD_MOTION.rimIntensity;
      for (let i = 0; i < instances.length; i++) {
        const p = instances[i];
        const seed = hash01(p.x, p.z);
        const phase = seed * 6.28318530718;
        // Variations in tempo prevent synchronized crowd motion.
        const tempo = 1.35 + seed * 1.35;
        const body = Math.sin(elapsedSeconds * tempo + phase);
        const sideToSide = Math.sin(elapsedSeconds * (tempo * 0.48) + phase * 0.72);
        // Spatial traveling wave across islands, stronger on a musical beat.
        const wave = Math.sin(elapsedSeconds * 2.1 - p.x * 0.18 - p.z * 0.10);
        const dance = 0.3 + this.activity * 1.35;
        const sway = this.conf.swayRadians * intensity * dance *
          (body * 0.68 + wave * 0.32 * this.pulse);
        const yaw = p.yaw + this.conf.yawRadians * intensity * dance * sideToSide;
        const lift = Math.pow(Math.max(0, Math.sin(elapsedSeconds * (tempo * 1.7) + phase)), 2);
        const normalBob = this.conf.bobLocal * intensity * lift *
          (0.15 + this.activity * 0.55 + this.pulse * 0.3);
        // Every field spectator joins the refrain. Small per-person offsets
        // avoid a rigid wave while the 140 BPM grid keeps jumps on the song.
        let jumpArc = 0;
        if (cue.playing && this.chorus > 0.005) {
          const beat = (cue.songTime - RINA_FIELD_CROWD_BEAT_ORIGIN) /
            RINA_FIELD_CROWD_BEAT_PERIOD + seed * 0.18;
          const beatPhase = beat - Math.floor(beat);
          jumpArc = Math.pow(Math.sin(Math.PI * beatPhase), 1.35);
        }
        const jumpIntensity = track.type === "core" ? 0.82 : 1;
        const bob = normalBob + this.conf.chorusJumpLocal * jumpIntensity *
          this.chorus * jumpArc;
        const offset = i * 16;
        if (track.type === "core") {
          writeLocalMatrix(matrices, offset, p, yaw, sway, bob);
        } else {
          // Match the existing V08: desired world transform * inverse mesh world.
          this.tempScale.setAll(p.scale);
          this.tempPosition.set(p.x * track.stadiumScale,
            (p.y + bob) * track.stadiumScale, p.z * track.stadiumScale);
          Quaternion.RotationYawPitchRollToRef(yaw, 0, sway, this.tempRotation);
          Matrix.ComposeToRef(this.tempScale, this.tempRotation, this.tempPosition, this.tempWorld);
          this.tempWorld.multiplyToRef(track.inverseMeshWorld!, this.tempInstance);
          this.tempInstance.copyToArray(matrices, offset);
        }
      }
      mesh.thinInstanceBufferUpdated("matrix");
    }
  }

  dispose(): void {
    this.disposed = true;
    this.tracks.clear();
  }
}
