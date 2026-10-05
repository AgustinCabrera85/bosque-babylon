import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

export const HERMANO_MAYOR_AXE_WORLD_LENGTH = 1.2;
export const HERMANO_MAYOR_AXE_APPROACH_DISTANCE_FROM_GRIP = 1.05;
export const HERMANO_MAYOR_AXE_GRIP_LOWER_METERS = 0.025;
export const HERMANO_MAYOR_AXE_GRIP_TOWARD_THUMB_METERS = 0.08;
export const HERMANO_MAYOR_AXE_READY_WRIST_PITCH_DEGREES = 11;
export const HERMANO_MAYOR_AXE_READY_WRIST_YAW_DEGREES = -12;
export const HERMANO_MAYOR_AXE_READY_WRIST_ROLL_DEGREES = 45;
const AXE_APPROACH_CLEARANCE_STEP = 0.08;
const AXE_APPROACH_CLEARANCE_ATTEMPTS = 10;
// Leave a short butt below the little finger, as in a real one-handed axe
// grip, instead of pinning the very end of the handle to the palm center.
const AXE_GRIP_FROM_BASE_FRACTION = 0.11;
const PALM_GRIP_FROM_WRIST_FRACTION = 0.56;
// A real handle enters the fist through the web between index and thumb. The
// average of all four knuckles sits too far toward the middle/ring fingers and
// makes the mesh cut through them, so bias the socket toward the index side.
const HANDLE_TOWARD_THUMB_FROM_KNUCKLE_CENTER = 1.8;
// Keep the handle hanging almost along the legs, with a small forward/outward
// cant so the head clears the body. The half-turn around the handle puts the
// cutting edge on the lower side instead of facing upward.
const RIGHT_HAND_AXE_GRIP_YAW = Math.PI;
const RIGHT_HAND_AXE_GRIP_PITCH = (-12 * Math.PI) / 180;
const RIGHT_HAND_AXE_GRIP_ROLL = (-8 * Math.PI) / 180;
const RIGHT_HAND_AXE_FINE_TUNE_X_DEGREES = -15;
const RIGHT_HAND_AXE_FINE_TUNE_Z_DEGREES = -13;
// The imported axe runs from its wooden butt toward the metal head on +Y.
// Angle the metal head forward and down from the grip, alongside the leg.
// The imported character's visible forward is opposite the movement root's +Z.
const EQUIPPED_AXE_MODEL_X_ROTATION = -Math.PI * 0.25;
// The accepted axe direction was authored while the wrist roll was -45 deg.
// The anatomically corrected wrist now uses +45 deg, so the child socket must
// cancel that 90-degree delta instead of making the axe inherit it.
const AXE_DIRECTION_REFERENCE_WRIST_ROLL_DEGREES = -45;
// The four knuckle roots average slightly behind the palm. The handle belongs
// near the thumb web (about z=1.1 in this rig), not three rig units in front
// of the skin where the fingers cannot visibly wrap around it.
const HANDLE_FORWARD_FROM_KNUCKLE_PLANE = 1.6;

// Fallback for compatible rigs that do not expose every finger base. The
// Hermano Mayor path derives the socket from the actual knuckle landmarks.
const RIGHT_HAND_GRIP_SOCKET_FALLBACK = new Vector3(2.2, 5.2, 2.7);

export type HermanoMayorAxeBounds = {
  min: Vector3;
  max: Vector3;
};

export type HermanoMayorAxeNodeTransformSnapshot = {
  name: string;
  parent: string | null;
  hierarchy: readonly string[];
  localPosition: { x: number; y: number; z: number };
  worldPosition: { x: number; y: number; z: number };
  localRotationQuaternion: { x: number; y: number; z: number; w: number };
  worldRotationQuaternion: { x: number; y: number; z: number; w: number };
  localScaling: { x: number; y: number; z: number };
  worldScaling: { x: number; y: number; z: number };
  worldMatrix: readonly number[];
  worldDeterminant: number;
};

export type HermanoMayorAxeAttachmentStateSnapshot = {
  handSocket: HermanoMayorAxeNodeTransformSnapshot;
  rightHand: HermanoMayorAxeNodeTransformSnapshot | null;
  handParentChain: readonly HermanoMayorAxeNodeTransformSnapshot[];
  axeRoot: HermanoMayorAxeNodeTransformSnapshot;
  axeGripSocket: HermanoMayorAxeNodeTransformSnapshot;
  visibleMeshes: readonly HermanoMayorAxeNodeTransformSnapshot[];
  visibleMeshParents: readonly HermanoMayorAxeNodeTransformSnapshot[];
};

export type HermanoMayorAxeAttachmentDebugSnapshot = {
  attached: boolean;
  attachedNode: string;
  attachmentTarget: string;
  operationOrder: readonly string[];
  sourceBounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
    center: { x: number; y: number; z: number };
  };
  gripPointLocal: { x: number; y: number; z: number };
  rootOriginToGeometryCenterLocal: { x: number; y: number; z: number };
  visibleMeshHierarchy: readonly {
    name: string;
    parent: string | null;
    hierarchy: readonly string[];
  }[];
  current: HermanoMayorAxeAttachmentStateSnapshot;
  lastAttachment: {
    before: HermanoMayorAxeAttachmentStateSnapshot;
    after: HermanoMayorAxeAttachmentStateSnapshot;
    parentWorldScale: { x: number; y: number; z: number };
    appliedRootLocalScale: number;
    handednessCompensated: boolean;
    positionError: {
      x: number;
      y: number;
      z: number;
      distance: number;
    };
    rotationError: {
      quaternion: { x: number; y: number; z: number; w: number };
      axis: { x: number; y: number; z: number };
      angleRadians: number;
      angleDegrees: number;
    };
  } | null;
};

type Disposable = { dispose(): void };

export type HermanoMayorAxeHandle = {
  root: TransformNode;
  meshes: readonly AbstractMesh[];
  gripSocket: TransformNode;
  readonly attached: boolean;
  getGripWorldPositionToRef(result: Vector3): boolean;
  getRootWorldPositionToRef(result: Vector3): boolean;
  getGripWorldAxesToRef(x: Vector3, y: Vector3, z: Vector3): boolean;
  getPickupTableCenterWorldPositionToRef(result: Vector3): boolean;
  getPickupApproachWorldPositionToRef(result: Vector3): boolean;
  attachToHandSocket(handSocket: TransformNode): boolean;
  getAttachmentDebugSnapshot(
    handSocket: TransformNode
  ): HermanoMayorAxeAttachmentDebugSnapshot;
  setDebugBoundsVisible(visible: boolean): void;
  disposePickupEffects(): void;
};

export type CreateHermanoMayorAxeOptions = {
  scene: Scene;
  root: TransformNode;
  meshes: readonly AbstractMesh[];
  sourceBounds: HermanoMayorAxeBounds;
  pickupSurfaceCenter?: Vector3 | null;
  isPickupApproachBlocked?: (x: number, z: number) => boolean;
  interaction?: Disposable | null;
  pickupLight?: Disposable | null;
  pickupFlare?: Disposable | null;
};

/** Wraps the single axe instance placed on the picnic table. */
export function createHermanoMayorAxeHandle(
  options: CreateHermanoMayorAxeOptions
): HermanoMayorAxeHandle {
  const { scene, root, meshes, sourceBounds } = options;
  const sourceLength = Math.max(0.001, sourceBounds.max.y - sourceBounds.min.y);
  const gripPoint = findHandleBaseGripPoint(
    meshes,
    root,
    sourceBounds,
    sourceBounds.min.y + sourceLength * AXE_GRIP_FROM_BASE_FRACTION
  );
  const gripSocket = new TransformNode("endHouseAxeGripSocket", scene);
  gripSocket.parent = root;
  gripSocket.position.copyFrom(gripPoint);
  const pickupTableCenter = options.pickupSurfaceCenter?.clone() ?? null;
  const pickupApproachPosition = Vector3.Zero();
  let hasPickupApproachPosition = false;
  if (pickupTableCenter) {
    root.computeWorldMatrix(true);
    gripSocket.computeWorldMatrix(true);
    const gripWorldPosition = gripSocket.getAbsolutePosition();
    const outward = gripWorldPosition.subtract(pickupTableCenter);
    outward.y = 0;
    if (outward.lengthSquared() > 0.000001) {
      outward.normalize();
      for (
        let attempt = 0;
        attempt <= AXE_APPROACH_CLEARANCE_ATTEMPTS;
        attempt += 1
      ) {
        const distance =
          HERMANO_MAYOR_AXE_APPROACH_DISTANCE_FROM_GRIP +
          attempt * AXE_APPROACH_CLEARANCE_STEP;
        pickupApproachPosition
          .copyFrom(gripWorldPosition)
          .addInPlace(outward.scale(distance));
        if (
          !options.isPickupApproachBlocked?.(
            pickupApproachPosition.x,
            pickupApproachPosition.z
          )
        ) {
          break;
        }
      }
      hasPickupApproachPosition = true;
    }
  }

  let interaction = options.interaction ?? null;
  let pickupLight = options.pickupLight ?? null;
  let pickupFlare = options.pickupFlare ?? null;
  let attached = false;
  let lastAttachment: HermanoMayorAxeAttachmentDebugSnapshot["lastAttachment"] =
    null;

  const sourceBoundsCenter = sourceBounds.min.add(sourceBounds.max).scale(0.5);

  const captureState = (handSocket: TransformNode) => ({
    handSocket: captureNodeTransform(handSocket),
    rightHand:
      handSocket.parent instanceof TransformNode
        ? captureNodeTransform(handSocket.parent)
        : null,
    handParentChain: hierarchyNodes(handSocket).map(captureNodeTransform),
    axeRoot: captureNodeTransform(root),
    axeGripSocket: captureNodeTransform(gripSocket),
    visibleMeshes: meshes.map(captureNodeTransform),
    visibleMeshParents: uniqueTransformParents(meshes).map(captureNodeTransform),
  });

  const getAttachmentDebugSnapshot = (handSocket: TransformNode) => ({
    attached,
    attachedNode: root.name,
    attachmentTarget: handSocket.name,
    operationOrder: [
      "if handSocket determinant is negative, create a Z-reflected handedness bridge",
      "root.parent = handednessBridge ?? handSocket",
      "root.rotation = (0, 0, 0)",
      "root.rotationQuaternion = -45 degrees around local X",
      "root.scaling = computed localScale",
      "root.position = -rotatedGripPoint * localScale + world-down grip offset",
      "root.computeWorldMatrix(true)",
    ],
    sourceBounds: {
      min: vectorSnapshot(sourceBounds.min),
      max: vectorSnapshot(sourceBounds.max),
      center: vectorSnapshot(sourceBoundsCenter),
    },
    gripPointLocal: vectorSnapshot(gripPoint),
    rootOriginToGeometryCenterLocal: vectorSnapshot(sourceBoundsCenter),
    visibleMeshHierarchy: meshes.map((mesh) => ({
      name: mesh.name,
      parent: mesh.parent?.name ?? null,
      hierarchy: hierarchyNames(mesh),
    })),
    current: captureState(handSocket),
    lastAttachment,
  });

  const disposePickupEffects = () => {
    interaction?.dispose();
    pickupLight?.dispose();
    pickupFlare?.dispose();
    interaction = null;
    pickupLight = null;
    pickupFlare = null;
  };

  return {
    root,
    meshes,
    gripSocket,
    get attached() {
      return attached;
    },
    getGripWorldPositionToRef: (result) => {
      if (root.isDisposed() || gripSocket.isDisposed()) return false;
      gripSocket.computeWorldMatrix(true);
      result.copyFrom(gripSocket.getAbsolutePosition());
      return true;
    },
    getRootWorldPositionToRef: (result) => {
      if (root.isDisposed()) return false;
      root.computeWorldMatrix(true);
      result.copyFrom(root.getAbsolutePosition());
      return true;
    },
    getGripWorldAxesToRef: (x, y, z) => {
      if (root.isDisposed() || gripSocket.isDisposed()) return false;
      gripSocket.computeWorldMatrix(true);
      transformNormalizedDirectionToRef(
        Vector3.Right(),
        gripSocket.getWorldMatrix(),
        x
      );
      transformNormalizedDirectionToRef(
        Vector3.Up(),
        gripSocket.getWorldMatrix(),
        y
      );
      transformNormalizedDirectionToRef(
        Vector3.Forward(),
        gripSocket.getWorldMatrix(),
        z
      );
      return true;
    },
    getPickupTableCenterWorldPositionToRef: (result) => {
      if (root.isDisposed() || attached || !pickupTableCenter) return false;
      result.copyFrom(pickupTableCenter);
      return true;
    },
    getPickupApproachWorldPositionToRef: (result) => {
      if (root.isDisposed() || attached || !hasPickupApproachPosition) {
        return false;
      }
      result.copyFrom(pickupApproachPosition);
      return true;
    },
    attachToHandSocket: (handSocket) => {
      if (attached || root.isDisposed() || handSocket.isDisposed()) return false;
      disposePickupEffects();

      handSocket.computeWorldMatrix(true);
      const handScale = Vector3.One();
      handSocket
        .getWorldMatrix()
        .decompose(handScale, Quaternion.Identity(), Vector3.Zero());
      const parentScale = Math.max(
        0.0001,
        (Math.abs(handScale.x) + Math.abs(handScale.y) + Math.abs(handScale.z)) / 3
      );
      const localScale =
        HERMANO_MAYOR_AXE_WORLD_LENGTH / (sourceLength * parentScale);

      const before = captureState(handSocket);

      // Babylon's GLTF loader gives the Hermano Mayor import root a negative-Z
      // conversion. The axe GLB has its own negative-Z import root. Parenting
      // one directly below the other cancels both reflections and mirrors the
      // visible axe compared with its authored/table orientation. A bridge
      // cancels only the character-side reflection, preserving the axe GLB's
      // own handedness correction without changing its handle axis (+Y).
      const handednessCompensated =
        handSocket.getWorldMatrix().determinant() < 0;
      let attachmentParent = handSocket;
      if (handednessCompensated) {
        const handednessBridge = new TransformNode(
          "hermanoMayorAxeHandednessBridge",
          scene
        );
        handednessBridge.parent = handSocket;
        handednessBridge.rotationQuaternion = Quaternion.Identity();
        handednessBridge.scaling.set(1, 1, -1);
        handednessBridge.computeWorldMatrix(true);
        attachmentParent = handednessBridge;
      }

      root.parent = attachmentParent;
      root.rotation.setAll(0);
      root.rotationQuaternion = Quaternion.RotationAxis(
        Vector3.Right(),
        EQUIPPED_AXE_MODEL_X_ROTATION
      );
      root.scaling.setAll(localScale);
      // Rotating around the root would move the handle out of the fist. Move
      // the root by the rotated grip offset so that the grip remains fixed.
      root.position.copyFrom(
        Vector3.TransformCoordinates(
          gripPoint,
          Matrix.RotationX(EQUIPPED_AXE_MODEL_X_ROTATION)
        )
      ).scaleInPlace(-localScale);
      // Seat the handle slightly toward the thumb web, clear of the finger,
      // while retaining the existing 2.5 cm downward offset and axe angle.
      attachmentParent.computeWorldMatrix(true);
      const towardThumbWorld = Vector3.TransformNormal(
        Vector3.Right(),
        attachmentParent.getWorldMatrix()
      ).normalize().scaleInPlace(HERMANO_MAYOR_AXE_GRIP_TOWARD_THUMB_METERS);
      root.position.addInPlace(
        Vector3.TransformNormal(
          towardThumbWorld.addInPlace(
            new Vector3(0, -HERMANO_MAYOR_AXE_GRIP_LOWER_METERS, 0)
          ),
          Matrix.Invert(attachmentParent.getWorldMatrix())
        )
      );
      root.computeWorldMatrix(true);
      for (const mesh of meshes) {
        mesh.isPickable = false;
        mesh.computeWorldMatrix(true);
      }
      attached = true;
      const after = captureState(handSocket);
      const positionError = after.axeGripSocket.worldPosition;
      const handPosition = after.handSocket.worldPosition;
      const dx = positionError.x - handPosition.x;
      const dy = positionError.y - handPosition.y;
      const dz = positionError.z - handPosition.z;
      lastAttachment = {
        before,
        after,
        parentWorldScale: vectorSnapshot(handScale),
        appliedRootLocalScale: localScale,
        handednessCompensated,
        positionError: {
          x: dx,
          y: dy,
          z: dz,
          distance: Math.hypot(dx, dy, dz),
        },
        rotationError: quaternionRotationError(
          after.handSocket.worldRotationQuaternion,
          after.axeGripSocket.worldRotationQuaternion
        ),
      };
      return true;
    },
    getAttachmentDebugSnapshot,
    setDebugBoundsVisible: (visible) => {
      for (const mesh of meshes) mesh.showBoundingBox = visible;
    },
    disposePickupEffects,
  };
}

export function createHermanoMayorHandGripSocket(
  scene: Scene,
  rightHand: TransformNode,
  fingerBases: readonly TransformNode[] = []
) {
  const socket = new TransformNode("hermanoMayorRightHandGripSocket", scene);
  socket.parent = rightHand;
  socket.position.copyFrom(
    resolvePalmGripSocketPosition(rightHand, fingerBases)
  );
  // Keep the corrected +45-degree wrist pose, but cancel its change of axe
  // direction inside the child socket. The final local X/Z adjustment then
  // seats the handle against the closed fingers without rotating the hand
  // back into the anatomically wrong pose.
  const correctedReadyWrist = Quaternion.RotationYawPitchRoll(
    radians(HERMANO_MAYOR_AXE_READY_WRIST_YAW_DEGREES),
    radians(HERMANO_MAYOR_AXE_READY_WRIST_PITCH_DEGREES),
    radians(HERMANO_MAYOR_AXE_READY_WRIST_ROLL_DEGREES)
  );
  const axeDirectionReferenceWrist = Quaternion.RotationYawPitchRoll(
    radians(HERMANO_MAYOR_AXE_READY_WRIST_YAW_DEGREES),
    radians(HERMANO_MAYOR_AXE_READY_WRIST_PITCH_DEGREES),
    radians(AXE_DIRECTION_REFERENCE_WRIST_ROLL_DEGREES)
  );
  const carryOrientation = Quaternion.RotationYawPitchRoll(
    RIGHT_HAND_AXE_GRIP_YAW,
    RIGHT_HAND_AXE_GRIP_PITCH,
    RIGHT_HAND_AXE_GRIP_ROLL
  );
  const gripFineTune = Quaternion.RotationYawPitchRoll(
    0,
    radians(RIGHT_HAND_AXE_FINE_TUNE_X_DEGREES),
    radians(RIGHT_HAND_AXE_FINE_TUNE_Z_DEGREES)
  );
  socket.rotationQuaternion = Quaternion.Inverse(correctedReadyWrist)
    .multiply(axeDirectionReferenceWrist)
    .multiply(carryOrientation)
    .multiply(gripFineTune)
    .normalize();
  return socket;
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function resolvePalmGripSocketPosition(
  rightHand: TransformNode,
  fingerBases: readonly TransformNode[]
) {
  const directFingerBases = fingerBases.filter(
    (fingerBase) => fingerBase.parent === rightHand
  );
  if (directFingerBases.length < 4) {
    return RIGHT_HAND_GRIP_SOCKET_FALLBACK;
  }

  const knuckleCenter = directFingerBases.reduce(
    (sum, fingerBase) => sum.addInPlace(fingerBase.position),
    Vector3.Zero()
  );
  knuckleCenter.scaleInPlace(1 / directFingerBases.length);
  return new Vector3(
    knuckleCenter.x + HANDLE_TOWARD_THUMB_FROM_KNUCKLE_CENTER,
    knuckleCenter.y * PALM_GRIP_FROM_WRIST_FRACTION,
    knuckleCenter.z + HANDLE_FORWARD_FROM_KNUCKLE_PLANE
  );
}

function findHandleBaseGripPoint(
  meshes: readonly AbstractMesh[],
  relativeTo: TransformNode,
  sourceBounds: HermanoMayorAxeBounds,
  gripY: number
) {
  relativeTo.computeWorldMatrix(true);
  const inverse = Matrix.Invert(relativeTo.getWorldMatrix());
  const handleBandTop =
    sourceBounds.min.y + (sourceBounds.max.y - sourceBounds.min.y) * 0.12;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const mesh of meshes) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) continue;
    mesh.computeWorldMatrix(true);
    for (let index = 0; index < positions.length; index += 3) {
      const world = Vector3.TransformCoordinates(
        Vector3.FromArray(positions, index),
        mesh.getWorldMatrix()
      );
      const local = Vector3.TransformCoordinates(world, inverse);
      if (local.y > handleBandTop) continue;
      minX = Math.min(minX, local.x);
      maxX = Math.max(maxX, local.x);
      minZ = Math.min(minZ, local.z);
      maxZ = Math.max(maxZ, local.z);
    }
  }

  if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) {
    return new Vector3(
      (sourceBounds.min.x + sourceBounds.max.x) * 0.5,
      gripY,
      (sourceBounds.min.z + sourceBounds.max.z) * 0.5
    );
  }
  return new Vector3((minX + maxX) * 0.5, gripY, (minZ + maxZ) * 0.5);
}

function captureNodeTransform(
  node: TransformNode
): HermanoMayorAxeNodeTransformSnapshot {
  node.computeWorldMatrix(true);
  const worldScaling = Vector3.One();
  const worldRotation = Quaternion.Identity();
  const worldPosition = Vector3.Zero();
  node.getWorldMatrix().decompose(worldScaling, worldRotation, worldPosition);
  const localRotation =
    node.rotationQuaternion?.clone() ??
    Quaternion.RotationYawPitchRoll(
      node.rotation.y,
      node.rotation.x,
      node.rotation.z
    );
  return {
    name: node.name,
    parent: node.parent?.name ?? null,
    hierarchy: hierarchyNames(node),
    localPosition: vectorSnapshot(node.position),
    worldPosition: vectorSnapshot(worldPosition),
    localRotationQuaternion: quaternionSnapshot(localRotation),
    worldRotationQuaternion: quaternionSnapshot(worldRotation),
    localScaling: vectorSnapshot(node.scaling),
    worldScaling: vectorSnapshot(worldScaling),
    worldMatrix: Array.from(node.getWorldMatrix().toArray()),
    worldDeterminant: node.getWorldMatrix().determinant(),
  };
}

function hierarchyNames(node: TransformNode) {
  return hierarchyNodes(node).map((current) => current.name);
}

function hierarchyNodes(node: TransformNode) {
  const nodes: TransformNode[] = [];
  let current: TransformNode | null = node;
  while (current) {
    nodes.unshift(current);
    current = current.parent instanceof TransformNode ? current.parent : null;
  }
  return nodes;
}

function uniqueTransformParents(meshes: readonly AbstractMesh[]) {
  const parents = new Set<TransformNode>();
  for (const mesh of meshes) {
    if (mesh.parent instanceof TransformNode) parents.add(mesh.parent);
  }
  return [...parents];
}

function transformNormalizedDirectionToRef(
  localDirection: Vector3,
  worldMatrix: Matrix,
  result: Vector3
) {
  Vector3.TransformNormalToRef(localDirection, worldMatrix, result);
  const lengthSquared = result.lengthSquared();
  if (lengthSquared > 0.000001) result.scaleInPlace(1 / Math.sqrt(lengthSquared));
}

function quaternionRotationError(
  from: { x: number; y: number; z: number; w: number },
  to: { x: number; y: number; z: number; w: number }
) {
  const fromQuaternion = new Quaternion(from.x, from.y, from.z, from.w);
  const toQuaternion = new Quaternion(to.x, to.y, to.z, to.w);
  const delta = Quaternion.Inverse(fromQuaternion).multiply(toQuaternion);
  delta.normalize();
  if (delta.w < 0) {
    delta.x *= -1;
    delta.y *= -1;
    delta.z *= -1;
    delta.w *= -1;
  }
  const angleRadians = 2 * Math.acos(Math.max(-1, Math.min(1, delta.w)));
  const sineHalfAngle = Math.sqrt(Math.max(0, 1 - delta.w * delta.w));
  const axis =
    sineHalfAngle > 0.000001
      ? new Vector3(
          delta.x / sineHalfAngle,
          delta.y / sineHalfAngle,
          delta.z / sineHalfAngle
        )
      : Vector3.Zero();
  return {
    quaternion: quaternionSnapshot(delta),
    axis: vectorSnapshot(axis),
    angleRadians,
    angleDegrees: (angleRadians * 180) / Math.PI,
  };
}

function vectorSnapshot(value: Vector3) {
  return { x: value.x, y: value.y, z: value.z };
}

function quaternionSnapshot(value: Quaternion) {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}
