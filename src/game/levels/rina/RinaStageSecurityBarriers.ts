import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../utils/asset";
import { RINA_STAGE_SECURITY, RINA_STAGE_STAIRS, RINA_STADIUM } from "./RinaLevelConfig";

const MODEL_FILE = "vallado_shaded.glb";
const MODEL_ROOT = "assets/models/rina/";

/** All positions are local stadium coordinates; rinaStadiumRoot scales once. */
export const RINA_STAGE_BARRIER_PROFILE = {
  frontOffsetFromStage: RINA_STADIUM.stage.frontZ - RINA_STAGE_SECURITY.frontZ,
  innerWingStart: RINA_STAGE_SECURITY.catwalkFenceHalfWidth,
  catwalkTipZ: RINA_STAGE_SECURITY.catwalkFenceTipZ,
  stairCenterX: RINA_STAGE_STAIRS.centerX,
  stairWidth: RINA_STAGE_STAIRS.width,
  stairGapExtra: 1.42,
  outerWingEnd: RINA_STADIUM.stage.width * 0.5 - 2.1,
  innerReturnEndOffset: 1.6,
  outerReturnEndOffset: 0.85,
  exteriorWingReturnDepth: 3.75,
  modelWidth: 1.9503823518753052,
  modelHeight: 1,
  panelWidth: 2.925,
  mobilePanelWidth: 3.3,
  railTop: 1.29,
} as const;

export interface RinaStageSecurityBarrierHandle {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly panelCount: number;
  readonly collisionSpans: readonly RinaStageBarrierCollisionSpan[];
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface RinaStageBarrierCollisionSpan {
  readonly startX: number;
  readonly startZ: number;
  readonly endX: number;
  readonly endZ: number;
  readonly bottomY: number;
  readonly topY: number;
}

type Point2 = { x: number; z: number };

function addSpan(
  matrices: Matrix[],
  collisionSpans: RinaStageBarrierCollisionSpan[],
  a: Point2,
  b: Point2,
  targetPanelWidth: number
) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.05) return;

  const profile = RINA_STAGE_BARRIER_PROFILE;
  collisionSpans.push({
    startX: a.x, startZ: a.z,
    endX: b.x, endZ: b.z,
    bottomY: 0, topY: profile.railTop,
  });
  const count = Math.max(1, Math.round(distance / targetPanelWidth));
  const panelLength = distance / count;
  const yaw = -Math.atan2(dz, dx);
  const rotation = Quaternion.FromEulerAngles(0, yaw, 0);
  const scale = new Vector3(
    panelLength / profile.modelWidth,
    profile.railTop / profile.modelHeight,
    panelLength / profile.modelWidth
  );

  for (let index = 0; index < count; index++) {
    const t = (index + 0.5) / count;
    const position = new Vector3(a.x + dx * t, 0, a.z + dz * t);
    matrices.push(Matrix.Compose(scale, rotation, position));
  }
}

function buildPanelGeometry(performanceTier: "desktop" | "mobile") {
  const p = RINA_STAGE_BARRIER_PROFILE;
  const frontZ = RINA_STADIUM.stage.frontZ - p.frontOffsetFromStage;
  const stairGapStart = p.stairCenterX - p.stairWidth * 0.5 - p.stairGapExtra;
  const stairGapEnd = p.stairCenterX + p.stairWidth * 0.5 + p.stairGapExtra;
  if (p.innerWingStart >= stairGapStart || stairGapEnd >= p.outerWingEnd) {
    throw new Error("Rina security barriers cannot fit around the stage stairs");
  }

  const matrices: Matrix[] = [];
  const collisionSpans: RinaStageBarrierCollisionSpan[] = [];
  const panelWidth = performanceTier === "mobile"
    ? p.mobilePanelWidth : p.panelWidth;
  for (const side of [-1, 1] as const) {
    const at = (x: number, z: number): Point2 => ({ x: side * x, z });
    addSpan(matrices, collisionSpans,
      at(p.innerWingStart, frontZ), at(p.innerWingStart, p.catwalkTipZ),
      panelWidth);
    addSpan(matrices, collisionSpans,
      at(p.innerWingStart, frontZ), at(stairGapStart, frontZ), panelWidth);
    addSpan(matrices, collisionSpans,
      at(stairGapEnd, frontZ), at(p.outerWingEnd, frontZ), panelWidth);
    addSpan(matrices, collisionSpans,
      at(stairGapStart, frontZ),
      at(stairGapStart, RINA_STADIUM.stage.frontZ - p.innerReturnEndOffset),
      panelWidth);
    addSpan(matrices, collisionSpans,
      at(stairGapEnd, frontZ),
      at(stairGapEnd, RINA_STADIUM.stage.frontZ - p.outerReturnEndOffset),
      panelWidth);
    addSpan(matrices, collisionSpans,
      at(p.outerWingEnd, frontZ),
      at(p.outerWingEnd + 1.8, frontZ + p.exteriorWingReturnDepth),
      panelWidth);
  }
  addSpan(matrices, collisionSpans,
    { x: -p.innerWingStart, z: p.catwalkTipZ },
    { x: p.innerWingStart, z: p.catwalkTipZ },
    panelWidth);
  return { matrices, collisionSpans };
}

/** Load one GLB mesh and draw all stage barriers as thin instances. */
export async function createRinaStageSecurityBarriers(
  scene: Scene,
  performanceTier: "desktop" | "mobile"
): Promise<RinaStageSecurityBarrierHandle> {
  const { matrices, collisionSpans } = buildPanelGeometry(performanceTier);
  const container = await SceneLoader.LoadAssetContainerAsync(
    asset(MODEL_ROOT), MODEL_FILE, scene
  );
  if (scene.isDisposed) {
    container.dispose();
    throw new Error("Rina stadium closed while the security barriers loaded");
  }

  const drawableMeshes = container.meshes.filter(
    (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0
  );
  if (drawableMeshes.length !== 1) {
    container.dispose();
    throw new Error(`Expected one drawable Rina barrier mesh; found ${drawableMeshes.length}`);
  }

  const root = new TransformNode("rinaStageSecurityFenceRoot", scene);
  try {
    container.addAllToScene();
    const source = drawableMeshes[0];
    source.name = "rinaStageFence_Model";
    source.parent = root;
    source.position.set(0, 0, 0);
    source.rotationQuaternion = null;
    source.rotation.set(0, 0, 0);
    source.scaling.setAll(1);
    source.isPickable = false;
    source.checkCollisions = false;
    source.receiveShadows = false;

    const buffer = new Float32Array(matrices.length * 16);
    for (let index = 0; index < matrices.length; index++) {
      matrices[index].copyToArray(buffer, index * 16);
    }
    source.thinInstanceSetBuffer("matrix", buffer, 16, true);
    source.thinInstanceRefreshBoundingInfo(true);

    for (const [index, span] of collisionSpans.entries()) {
      const dx = span.endX - span.startX;
      const dz = span.endZ - span.startZ;
      const plane = MeshBuilder.CreatePlane(`rinaStageFenceCollider_${index}`, {
        width: Math.hypot(dx, dz),
        height: span.topY - span.bottomY,
        sideOrientation: Mesh.DOUBLESIDE,
      }, scene);
      plane.parent = root;
      plane.position.set(
        (span.startX + span.endX) * 0.5,
        (span.bottomY + span.topY) * 0.5,
        (span.startZ + span.endZ) * 0.5
      );
      plane.rotation.y = -Math.atan2(dz, dx);
      plane.isVisible = false;
      plane.isPickable = false;
      plane.checkCollisions = true;
    }

    let disposed = false;
    return {
      root,
      meshes: [source],
      panelCount: matrices.length,
      collisionSpans,
      setEnabled(enabled: boolean) {
        if (!disposed) root.setEnabled(enabled);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        container.dispose();
        root.dispose(false, false);
      },
    };
  } catch (error) {
    container.dispose();
    root.dispose(false, false);
    throw error;
  }
}
