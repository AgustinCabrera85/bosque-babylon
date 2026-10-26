import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { MixamoProceduralRig, type MixamoJointName } from "../../animation/MixamoProceduralRig";
import type { PerformanceTier } from "../../runtime/LevelTypes";
import {
  createTheatreAudiencePhones,
  type PhotoPhase,
  type TheatrePhoneHolder,
  type TheatrePhonesHandle,
} from "../theatre/TheatreAudiencePhones";
import type { RinaFieldPhoneRig } from "./RinaFieldCrowdMazeRenderer";
import { RINA_CROWD_FANS } from "./crowd/RinaCrowdAssetManifest";

type PhonePose = {
  rig: MixamoProceduralRig;
  anchor: TransformNode;
  wrapper: TransformNode | null;
  hand: TransformNode;
  middleKnuckle: TransformNode;
  leftHand: TransformNode;
  head: TransformNode;
  neck: TransformNode;
  body: AbstractMesh | null;
  weight: number;
  phase: PhotoPhase;
  offsets: Map<MixamoJointName, Quaternion> | null;
  grip: (typeof MODEL_GRIP)[keyof typeof MODEL_GRIP];
};

// Imported Mixamo fans use the same right-side hierarchy. Keep differences
// local to the model rather than changing their authored NLA clips.
const MODEL_GRIP = {
  fan_01: { wrist: 0.12, raiseHeight: 0.30, phoneLift: 0.045, phoneSide: 0.10, phoneDepth: 0.09, leftSide: 0.16, leftDepth: 0, leftRise: -0.04, anchor: new Vector3(0.012, 0.008, 0.005),
    rotation: new Vector3(-0.18, 0, Math.PI - 0.12) },
  fan_02: { wrist: 0.18, raiseHeight: 0.30, phoneLift: 0.075, phoneSide: 0.10, phoneDepth: 0.07, leftSide: 0.15, leftDepth: 0.04, leftRise: 0, anchor: new Vector3(0.014, 0.008, 0.008),
    rotation: new Vector3(-0.16, -0.70, -0.16) },
  fan_03: { wrist: 0.28, raiseHeight: 0.30, phoneLift: 0.075, phoneSide: 0.16, phoneDepth: 0.06, leftSide: 0.18, leftDepth: 0.065, leftRise: 0, anchor: new Vector3(0.011, 0.010, 0.005),
    rotation: new Vector3(-0.20, 0, -0.10) },
  fan_04: { wrist: 0.22, raiseHeight: 0.30, phoneLift: 0.07, phoneSide: 0.06, phoneDepth: 0.04, leftSide: 0.15, leftDepth: 0.05, leftRise: 0.06, anchor: new Vector3(0.012, 0.009, 0.007),
    rotation: new Vector3(-0.17, 0, -0.12) },
  fan_05: { wrist: 0.23, raiseHeight: 0.30, phoneLift: 0.075, phoneSide: 0.10, phoneDepth: 0.05, leftSide: 0.15, leftDepth: 0, leftRise: 0, anchor: new Vector3(0.012, 0.009, 0.006),
    rotation: new Vector3(-0.18, 0.45, -0.12) },
} as const;

const RIGHT_ARM_CHAIN = [
  { joint: "rightForeArm", maxAngle: 0.38 },
  { joint: "rightArm", maxAngle: 0.42 },
  { joint: "rightShoulder", maxAngle: 0.20 },
] as const;
const LEFT_ARM_CHAIN = [
  { joint: "leftForeArm", maxAngle: 0.38 },
  { joint: "leftArm", maxAngle: 0.42 },
  { joint: "leftShoulder", maxAngle: 0.20 },
] as const;
export async function createRinaAudiencePhoneIntegration(
  scene: Scene,
  tier: PerformanceTier,
  candidates: readonly RinaFieldPhoneRig[],
  stageMeshes: readonly AbstractMesh[],
  singerPosition: Vector3,
  onPhotoTaken?: (worldFootPosition: Vector3, candidate: RinaFieldPhoneRig) => void,
): Promise<{ phones: TheatrePhonesHandle; update(dt: number, target: Vector3): void; dispose(): void }> {
  const poses: PhonePose[] = [];
  const photographerPosition = Vector3.Zero();
  const holders = candidates.flatMap(candidate => {
    const required = ["rightShoulder", "rightArm", "rightForeArm", "rightHand",
      "rightHandThumb1", "rightHandIndex1", "rightHandMiddle1",
      "rightHandThumb2", "rightHandIndex2", "rightHandMiddle2",
      "rightHandRing1", "rightHandRing2", "rightHandPinky1",
      "rightHandPinky2", "leftShoulder", "leftArm",
      "leftForeArm", "leftHand", "leftHandThumb1", "leftHandIndex1",
      "leftHandThumb2", "leftHandIndex2", "leftHandMiddle1",
      "leftHandMiddle2", "leftHandRing1", "leftHandRing2",
      "leftHandPinky1", "leftHandPinky2", "neck", "head"] as const;
    const rig = new MixamoProceduralRig([candidate.mesh], candidate.clips, required);
    const hand = rig.getJointNode("rightHand");
    const middleKnuckle = rig.getJointNode("rightHandMiddle1");
    const leftHand = rig.getJointNode("leftHand");
    const head = rig.getJointNode("head");
    const neck = rig.getJointNode("neck");
    if (!rig.available || !hand || !middleKnuckle || !leftHand || !head || !neck) {
      console.warn(`[RinaPhones] ${candidate.id}: missing Mixamo photo joints; skipping phone`);
      return [];
    }
    const grip = MODEL_GRIP[candidate.fanId as keyof typeof MODEL_GRIP];
    if (!grip) return [];
    const anchor = new TransformNode(`rinaPhoneHand_${candidate.id}`, scene);
    anchor.rotationQuaternion = Quaternion.Identity();
    const pose: PhonePose = { rig, anchor, hand, middleKnuckle, leftHand, head, neck,
      wrapper: null, body: null,
      weight: 0, phase: "idle", offsets: null, grip };
    poses.push(pose);
    const fanHeight = RINA_CROWD_FANS.find(fan => fan.id === candidate.fanId)?.targetWorldHeight ?? 1.6;
    return [{ id: candidate.id, handAnchor: anchor,
      scale: fanHeight / 1.6,
      positionOffset: grip.anchor.clone(), rotationOffset: grip.rotation.clone(),
      onShutter() {
        candidate.getWorldFootPositionToRef(photographerPosition);
        onPhotoTaken?.(photographerPosition, candidate);
      },
      onPoseWeight(weight: number, phase: PhotoPhase) {
        pose.weight = weight;
        pose.phase = phase;
        if (phase === "idle") pose.offsets = null;
        candidate.setPhotoActionActive(phase !== "idle");
      } }];
  });

  const before = scene.onBeforeAnimationsObservable.add(() => {
    for (const pose of poses) pose.rig.restoreBasePose();
  });
  const handScale = Vector3.One();
  const handRotation = Quaternion.Identity();
  const flashDirection = Vector3.Zero();
  const targetDirection = Vector3.Zero();
  const correctionAxis = Vector3.Zero();
  const stageForward = Vector3.Zero();
  const side = Vector3.Zero();
  const rightTarget = Vector3.Zero();
  const leftTarget = Vector3.Zero();
  const gazeDirection = Vector3.Zero();
  const palmPosition = Vector3.Zero();
  const phoneCenter = Vector3.Zero();
  const phoneGripPosition = Vector3.Zero();
  const neutralRotation = Quaternion.Identity();
  const blendedRotation = Quaternion.Identity();
  const positionPhoneAtPalm = (pose: PhonePose) => {
    pose.hand.computeWorldMatrix(true);
    pose.middleKnuckle.computeWorldMatrix(true);
    Vector3.LerpToRef(pose.hand.getAbsolutePosition(),
      pose.middleKnuckle.getAbsolutePosition(), 0.55, palmPosition);
    pose.anchor.position.copyFrom(palmPosition);
    pose.hand.getWorldMatrix().decompose(handScale, handRotation);
    pose.anchor.rotationQuaternion!.copyFrom(handRotation);
    if (!pose.body) return;
    singerPosition.subtractToRef(palmPosition, stageForward);
    stageForward.y = 0;
    stageForward.normalize();
    side.set(stageForward.z, 0, -stageForward.x);
    phoneGripPosition.copyFrom(palmPosition).addInPlaceFromFloats(
      -side.x * pose.grip.phoneSide-stageForward.x*pose.grip.phoneDepth,
      pose.grip.phoneLift,
      -side.z * pose.grip.phoneSide-stageForward.z*pose.grip.phoneDepth);
    pose.anchor.computeWorldMatrix(true);
    Vector3.TransformCoordinatesToRef(
      pose.body.getBoundingInfo().boundingBox.center,
      pose.body.computeWorldMatrix(true), phoneCenter);
    pose.anchor.position.subtractInPlace(phoneCenter.subtractInPlace(phoneGripPosition));
    pose.body.computeWorldMatrix(true);
  };
  const loosenPhotoFinger = (pose: PhonePose, hand: "right" | "left", finger: "Thumb" | "Index") => {
    const firstName = `${hand}Hand${finger}1` as MixamoJointName;
    const secondName = `${hand}Hand${finger}2` as MixamoJointName;
    const tipName = `${hand}Hand${finger}3` as MixamoJointName;
    const first = pose.rig.getJointNode(firstName);
    const second = pose.rig.getJointNode(secondName);
    const tip = pose.rig.getJointNode(tipName);
    if (!first || !second || !tip) return;
    for (const node of [first, second, tip]) node.computeWorldMatrix(true);
    const proximal = second.getAbsolutePosition().subtract(first.getAbsolutePosition()).normalize();
    const distal = tip.getAbsolutePosition().subtract(second.getAbsolutePosition()).normalize();
    const axis = Vector3.Cross(distal, proximal);
    if (axis.lengthSquared() < 0.0001) return;
    axis.normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(distal, proximal))));
    pose.rig.rotateWorld(secondName, axis,
      Math.min(angle * (hand === "left" ? 0.8 : 0.65), 0.7));
    pose.rig.prepare();
  };
  const solveFullPhotoPose = (pose: PhonePose) => {
    const grip = pose.grip;
    const originals = new Map<MixamoJointName, Quaternion>();
    for (const name of Object.keys(pose.rig.getResolvedBones()) as MixamoJointName[]) {
      const rotation = pose.rig.getJointNode(name)?.rotationQuaternion;
      if (rotation) originals.set(name, rotation.clone());
    }
    pose.rig.applyLocalOffset("rightHand", Axis.X, grip.wrist);
    if(grip===MODEL_GRIP.fan_04)pose.rig.appendLocalOffset("rightHand",Axis.Y,0.45);
    if(grip===MODEL_GRIP.fan_04){
      for(const hand of ["right","left"] as const)
        for(const finger of ["Thumb","Index"] as const)
          loosenPhotoFinger(pose,hand,finger);
    }
    pose.rig.prepare();
    pose.head.computeWorldMatrix(true);
    const headPosition = pose.head.getAbsolutePosition();
    singerPosition.subtractToRef(headPosition, stageForward);
    stageForward.y = 0;
    stageForward.normalize();
    side.set(stageForward.z, 0, -stageForward.x);
    rightTarget.copyFrom(headPosition).addInPlaceFromFloats(
      stageForward.x * 0.32 + side.x * 0.055, grip.raiseHeight,
      stageForward.z * 0.32 + side.z * 0.055);
    pose.rig.solveCcdToTarget(RIGHT_ARM_CHAIN, "rightHandMiddle1", rightTarget, 7);
    pose.rig.prepare();
    pose.hand.computeWorldMatrix(true);
    pose.middleKnuckle.computeWorldMatrix(true);
    Vector3.LerpToRef(pose.hand.getAbsolutePosition(),
      pose.middleKnuckle.getAbsolutePosition(), 0.55, palmPosition);
    phoneGripPosition.copyFrom(palmPosition).addInPlaceFromFloats(
      -side.x * grip.phoneSide, grip.phoneLift, -side.z * grip.phoneSide);
    leftTarget.copyFrom(phoneGripPosition).addInPlaceFromFloats(
      -side.x * grip.leftSide-stageForward.x*grip.leftDepth,
      -0.09+grip.leftRise,
      -side.z * grip.leftSide-stageForward.z*grip.leftDepth);
    pose.rig.solveCcdToTarget(LEFT_ARM_CHAIN, "leftHand", leftTarget, 9);
    pose.rig.prepare();
    pose.head.computeWorldMatrix(true);
    pose.middleKnuckle.computeWorldMatrix(true);
    pose.middleKnuckle.getAbsolutePosition().subtractToRef(
      pose.head.getAbsolutePosition(), gazeDirection);
    gazeDirection.normalize();
    Vector3.TransformNormalToRef(Axis.Z, pose.head.getWorldMatrix(), flashDirection);
    flashDirection.normalize();
    if (Vector3.Dot(flashDirection, stageForward) < 0) flashDirection.negateInPlace();
    Vector3.CrossToRef(flashDirection, gazeDirection, correctionAxis);
    const gazeAxisLength = correctionAxis.length();
    if (gazeAxisLength > 0.0001) {
      correctionAxis.scaleInPlace(1 / gazeAxisLength);
      pose.rig.rotateWorld("neck", correctionAxis,
        Math.min(Math.acos(Math.max(-1, Math.min(1,
          Vector3.Dot(flashDirection, gazeDirection)))), 0.32));
      pose.rig.prepare();
    }
    // Fit a fixed phone-to-hand rotation at the aimed pose. The phone keeps
    // that local rotation while the arm raises, so it follows the hand without
    // the wrist being twisted to compensate for an arbitrary GLB orientation.
    if (pose.wrapper) {
      pose.hand.computeWorldMatrix(true);
      singerPosition.subtractToRef(pose.hand.getAbsolutePosition(), targetDirection);
      targetDirection.y += 1.35;
      targetDirection.normalize();
      // The imported display plane's actual normal is -Z. Point local +Z
      // toward the stage so the screen (-Z) faces the spectator.
      const desiredWorldRotation = Quaternion.FromLookDirectionLH(targetDirection, Axis.Y);
      const currentHandRotation = Quaternion.Identity();
      pose.hand.getWorldMatrix().decompose(Vector3.One(), currentHandRotation);
      const desiredMatrix = Matrix.Identity(), handMatrix = Matrix.Identity();
      Matrix.FromQuaternionToRef(desiredWorldRotation, desiredMatrix);
      Matrix.FromQuaternionToRef(currentHandRotation, handMatrix);
      const localMatrix = desiredMatrix.multiply(Matrix.Invert(handMatrix));
      const localRotation = Quaternion.Identity();
      localMatrix.decompose(Vector3.One(), localRotation);
      pose.wrapper.rotation.copyFrom(localRotation.toEulerAngles());
    }
    const offsets = new Map<MixamoJointName, Quaternion>();
    for (const [name, original] of originals) {
      const current = pose.rig.getJointNode(name)?.rotationQuaternion;
      if (!current) continue;
      const offset = original.conjugate().multiply(current).normalize();
      if (Math.abs(offset.x) + Math.abs(offset.y) + Math.abs(offset.z) > 0.0001)
        offsets.set(name, offset);
    }
    pose.rig.restoreBasePose();
    return offsets;
  };
  const after = scene.onAfterAnimationsObservable.add(() => {
    for (const pose of poses) {
      pose.rig.captureBasePose();
      const weight = pose.weight;
      if (pose.phase !== "idle" && !pose.offsets) pose.offsets = solveFullPhotoPose(pose);
      if (weight > 0.001 && pose.offsets) {
        for (const [name, offset] of pose.offsets) {
          Quaternion.SlerpToRef(neutralRotation, offset, weight, blendedRotation);
          pose.rig.applyLocalQuaternionOffset(name, blendedRotation);
        }
        pose.rig.prepare();
      }
      // As with Rina's microphone, RightHand is the wrist. The phone follows
      // the inner palm and keeps a fixed local orientation throughout the shot.
      positionPhoneAtPalm(pose);
    }
  });

  try {
    const cameraOffset = new Vector3(0, 1.9, -7.5);
    const targetOffset = new Vector3(0, 1.15, 0);
    const capturePosition = Vector3.Zero();
    const captureTarget = Vector3.Zero();
    const phones = await createTheatreAudiencePhones({
      scene, performanceTier: tier, holders, stageMeshes,
      capturePosition: singerPosition.add(cameraOffset),
      captureTarget: singerPosition.add(targetOffset),
    });
    for (const pose of poses) {
      const id = pose.anchor.name.slice("rinaPhoneHand_".length);
      pose.wrapper = scene.getTransformNodeByName(`theatrePhone_${id}`);
      pose.body = pose.wrapper?.getChildMeshes(false)
        .find(mesh => mesh.name.includes("SmartPhone_Body")) ?? null;
    }
    if (import.meta.env.DEV) {
      scene.metadata ??= {};
      scene.metadata.rinaPhones = { phones, cameraOffset, targetOffset,
        holders: holders.map(holder => ({ id: holder.id,
          positionOffset: holder.positionOffset,
          rotationOffset: holder.rotationOffset })) };
    }
    const disposeDebug = import.meta.env.DEV &&
      new URLSearchParams(window.location.search).has("rinaPhonesDebug")
      ? createRinaPhoneDebugPanel(phones, holders, cameraOffset, targetOffset)
      : () => {};
    let disposed = false;
    return {
      phones,
      update(dt, target) {
        if (disposed) return;
        capturePosition.copyFrom(target).addInPlace(cameraOffset);
        captureTarget.copyFrom(target).addInPlace(targetOffset);
        phones.setCapture(capturePosition, captureTarget);
        phones.update(dt);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        disposeDebug();
        if (scene.metadata?.rinaPhones?.phones === phones) delete scene.metadata.rinaPhones;
        phones.dispose();
        for (const candidate of candidates) candidate.setPhotoActionActive(false);
        scene.onBeforeAnimationsObservable.remove(before);
        scene.onAfterAnimationsObservable.remove(after);
        for (const pose of poses) { pose.rig.restoreBasePose(); pose.anchor.dispose(); }
      },
    };
  } catch (error) {
    scene.onBeforeAnimationsObservable.remove(before);
    scene.onAfterAnimationsObservable.remove(after);
    for (const pose of poses) { pose.rig.restoreBasePose(); pose.anchor.dispose(); }
    throw error;
  }
}

function createRinaPhoneDebugPanel(
  phones: TheatrePhonesHandle,
  holders: readonly TheatrePhoneHolder[],
  cameraOffset: Vector3,
  targetOffset: Vector3,
): () => void {
  const panel = document.createElement("aside");
  panel.id = "rinaPhonesDebug";
  panel.style.cssText = "position:fixed;top:8px;right:8px;z-index:10000;width:255px;max-height:94vh;overflow:auto;padding:10px;background:#111e;color:#eee;font:12px sans-serif;border:1px solid #777";
  panel.innerHTML = `<strong>Rina phones: ${phones.count}</strong><div data-controls></div>`;
  const controls = panel.querySelector("[data-controls]") as HTMLDivElement;
  const row = (label: string, element: HTMLElement) => {
    const wrapper = document.createElement("label");
    wrapper.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin:5px 0";
    wrapper.append(label, element);
    controls.append(wrapper);
  };
  const checkbox = (label: string, checked: boolean, change: (value: boolean) => void) => {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => change(input.checked));
    row(label, input);
    return input;
  };
  const number = (label: string, value: number, change: (value: number) => void) => {
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.01";
    input.value = String(value);
    input.style.width = "65px";
    input.addEventListener("change", () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) change(parsed);
    });
    row(label, input);
    return input;
  };
  checkbox("Activos", true, value => phones.setEnabled(value));
  checkbox("RTT", true, value => phones.setFeedEnabled(value));
  const mobile = phones.feed?.getSize().width === 96;
  number("Capturas por segundo", mobile ? 4 : 7.5,
    value => phones.setFeedRefreshFrames(60 / Math.max(1, value)));
  const width = number("Ancho", phones.feed?.getSize().width ?? 0, () => resize());
  const height = number("Alto", phones.feed?.getSize().height ?? 0, () => resize());
  const resize = () => phones.setFeedResolution(Number(width.value), Number(height.value));
  const select = document.createElement("select");
  for (const id of phones.ids) select.add(new Option(id, id));
  row("Espectador", select);
  const button = document.createElement("button");
  button.textContent = "Test photo";
  button.addEventListener("click", () => phones.triggerPhoto(select.value));
  controls.append(button);
  const offsets = document.createElement("div");
  controls.append(offsets);
  const showOffsets = () => {
    offsets.replaceChildren();
    const holder = holders.find(item => item.id === select.value);
    if (!holder?.positionOffset || !holder.rotationOffset) return;
    for (const [label, vector] of [["Mano pos", holder.positionOffset],
      ["Mano rot", holder.rotationOffset]] as const) {
      for (const axis of ["x", "y", "z"] as const) {
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.01";
        input.value = String(vector[axis]);
        input.style.width = "65px";
        input.addEventListener("change", () => {
          vector[axis] = Number(input.value);
          phones.setHolderOffset(holder.id, holder.positionOffset!, holder.rotationOffset!);
        });
        const line = document.createElement("label");
        line.style.cssText = "display:flex;justify-content:space-between;margin:4px 0";
        line.append(`${label} ${axis}`, input);
        offsets.append(line);
      }
    }
  };
  select.addEventListener("change", showOffsets);
  showOffsets();
  for (const [label, vector] of [["Cámara", cameraOffset], ["Target", targetOffset]] as const) {
    for (const axis of ["x", "y", "z"] as const) {
      number(`${label} ${axis}`, vector[axis], value => { vector[axis] = value; });
    }
  }
  const previewEnabled = checkbox("Preview", false, () => {});
  const preview = document.createElement("canvas");
  preview.width = phones.feed?.getSize().width ?? 128;
  preview.height = phones.feed?.getSize().height ?? 256;
  preview.style.cssText = "display:block;width:96px;height:192px;margin:6px auto;background:#000";
  controls.append(preview);
  document.body.append(panel);
  let reading = false;
  const timer = window.setInterval(() => {
    const feed = phones.feed;
    if (!previewEnabled.checked || !feed || reading) return;
    reading = true;
    void Promise.resolve(feed.readPixels()).then(pixels => {
      if (!pixels || !panel.isConnected) return;
      const { width: w, height: h } = feed.getSize();
      const bytes = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      if (bytes.length < w * h * 4) return;
      preview.width = w;
      preview.height = h;
      const context = preview.getContext("2d");
      if (!context) return;
      const image = context.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        image.data.set(bytes.subarray((h - y - 1) * w * 4, (h - y) * w * 4), y * w * 4);
      }
      context.putImageData(image, 0, 0);
    }).catch(error => console.warn("Rina phone preview", error))
      .finally(() => { reading = false; });
  }, 500);
  return () => { window.clearInterval(timer); panel.remove(); };
}
