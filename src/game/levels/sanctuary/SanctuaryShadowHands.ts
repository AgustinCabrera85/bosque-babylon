import "@babylonjs/loaders/glTF";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Bone } from "@babylonjs/core/Bones/bone";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { Scene } from "@babylonjs/core/scene";
import type { FloatArray, IndicesArray } from "@babylonjs/core/types";
import { SHADOW_GRABBER_MODEL_URL } from "../../enemies/shadowGrabber/ShadowGrabberConfig";
import { SANCTUARY_ASCENT as ASCENT, SANCTUARY_CONFIG as CFG,
  SANCTUARY_STOPS } from "./SanctuaryLayout";

type HandPlacement = {
  kind: "climber" | "guide";
  x: number;
  palmY: number;
  z: number;
  scale: number;
  yaw: number;
  pitch: number;
  tilt: number;
  phase: number;
  mirror?: boolean;
  pillar?: { x: number; z: number; side: -1 | 1 };
};

type AmbientHand = {
  root: TransformNode;
  arm: Mesh;
  skeleton: Skeleton;
  origin: Bone;
  wrist: Bone;
  palm: Bone;
  fingertip: Bone;
  thumb: Bone;
  grab?: AnimationGroup;
  idle?: AnimationGroup;
  sourcePositions: Float32Array;
  indices: IndicesArray;
  grabPoses: Float32Array[];
  boundsInitialized?: boolean;
  placement: HandPlacement;
};

const WATER_ORIGIN_Y = CFG.riverY - 22;
const ARM_LOWER_SIDE = 52;
const ARM_HAND_SIDE = 85;
const ARM_FACE_DEPTH = 52;
const ARM_HAND_DEPTH = 53;
const ARM_SWEEP = Math.PI * 2;

const smoothstep = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

// Skin a few authored Grab poses once. At runtime we interpolate their vertex
// positions directly; Babylon's paused animation groups cannot leave the
// visible mesh in a stale GPU/CPU skinning pose.
const sampleGrabPoses = (arm: Mesh, skeleton: Skeleton, grab: AnimationGroup,
  sourcePositions: Float32Array): Float32Array[] => {
  const joints = arm.getVerticesData(VertexBuffer.MatricesIndicesKind);
  const weights = arm.getVerticesData(VertexBuffer.MatricesWeightsKind);
  if (!joints || !weights) throw new Error("ShadowGrabber arm has no skinning weights.");
  const poses: Float32Array[] = [];
  const sampleCount = 12;
  for (let poseIndex = 0; poseIndex <= sampleCount; poseIndex++) {
    grab.goToFrame(grab.from + (grab.to - grab.from) * poseIndex / sampleCount);
    skeleton.prepare(true);
    const matrices = skeleton.getTransformMatrices(arm);
    const positions = new Float32Array(sourcePositions.length);
    for (let i = 0; i < sourcePositions.length; i += 3) {
      const vertex = i / 3;
      const x = sourcePositions[i];
      const y = sourcePositions[i + 1];
      const z = sourcePositions[i + 2];
      for (let influence = 0; influence < 4; influence++) {
        const weight = weights[vertex * 4 + influence];
        if (weight <= 0) continue;
        const m = joints[vertex * 4 + influence] * 16;
        positions[i] += weight * (x * matrices[m] + y * matrices[m + 4]
          + z * matrices[m + 8] + matrices[m + 12]);
        positions[i + 1] += weight * (x * matrices[m + 1] + y * matrices[m + 5]
          + z * matrices[m + 9] + matrices[m + 13]);
        positions[i + 2] += weight * (x * matrices[m + 2] + y * matrices[m + 6]
          + z * matrices[m + 10] + matrices[m + 14]);
      }
    }
    poses.push(positions);
  }
  grab.goToFrame(grab.from);
  skeleton.prepare(true);
  return poses;
};

const interpolateGrabPose = (hand: AmbientHand, curl: number) => {
  const positions = hand.arm.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;
  const frame = curl * (hand.grabPoses.length - 1);
  const fromIndex = Math.floor(frame);
  const fraction = frame - fromIndex;
  const from = hand.grabPoses[fromIndex];
  const to = hand.grabPoses[Math.min(fromIndex + 1, hand.grabPoses.length - 1)];
  for (let i = 0; i < positions.length; i++) {
    positions[i] = from[i] + (to[i] - from[i]) * fraction;
  }
  return positions;
};

// The GLB has no UVs. Its tar pattern uses world space on both hand types.
class SanctuaryTarSurface extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(material, "SanctuaryTarSurface", 200, {}, true, true);
  }

  override isCompatible(shaderLanguage: ShaderLanguage) {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override getClassName() {
    return "SanctuaryTarSurface";
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
float sanctuaryTarPattern(vec3 worldPos) {
  vec3 p = worldPos * 0.052;
  float fold = sin(p.y * 1.34 + sin(p.x * 0.73 + p.z * 0.91) * 1.62);
  float vein = sin(p.x * 3.17 - p.z * 2.39 + fold * 1.38);
  float grain = sin(p.x * 10.7 + p.y * 8.3) * sin(p.z * 9.1 - p.y * 7.6);
  return clamp(0.5 + fold * 0.24 + vein * 0.16 + grain * 0.07, 0.0, 1.0);
}
`,
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
float sanctuaryTarDark = sanctuaryTarPattern(vPositionW);
surfaceAlbedo = vec3(0.0010, 0.00085, 0.00095) * (0.62 + sanctuaryTarDark * 0.62);
`,
      CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: `
float sanctuaryTarWet = smoothstep(0.34, 0.78, sanctuaryTarPattern(vPositionW));
metallicRoughness.r = 0.0;
metallicRoughness.g = mix(0.80, 0.54, sanctuaryTarWet);
`,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
if (vPositionW.y < ${(CFG.riverY - .12).toFixed(3)}) discard;
`,
    };
  }
}

export async function createSanctuaryShadowHands(scene: Scene) {
  const modelName = SHADOW_GRABBER_MODEL_URL.slice(SHADOW_GRABBER_MODEL_URL.lastIndexOf("/") + 1);
  const modelRoot = SHADOW_GRABBER_MODEL_URL.slice(0, -modelName.length);
  const container = await SceneLoader.LoadAssetContainerAsync(modelRoot, modelName, scene);
  if (scene.isDisposed) {
    container.dispose();
    throw new Error("The sanctuary closed while loading its shadow hands.");
  }
  const materials: PBRMaterial[] = [];
  const makeTarMaterial = (name: string) => {
    const material = new PBRMaterial(name, scene);
    material.albedoColor = new Color3(.001, .00085, .00095);
    material.metallic = 0;
    material.roughness = .7;
    material.environmentIntensity = .035;
    material.specularIntensity = .32;
    material.metallicF0Factor = .36;
    material.emissiveColor = Color3.Black();
    material.clearCoat.isEnabled = true;
    material.clearCoat.intensity = .08;
    material.clearCoat.roughness = .58;
    material.sheen.isEnabled = false;
    material.backFaceCulling = false;
    materials.push(material);
    new SanctuaryTarSurface(material);
    return material;
  };
  const guideTar = makeTarMaterial("sanctuaryGuideTar");

  const pillarA = SANCTUARY_STOPS[0];
  const pillarB = SANCTUARY_STOPS[3];
  const pillarAX = pillarA.x + pillarA.side * 166;
  const pillarBX = pillarB.x + pillarB.side * 166;
  const guideZ = ASCENT.stairStartZ - 30;
  const placements: HandPlacement[] = [
    // Each arm follows the outside of its pillar from a submerged base.
    { kind: "climber", x: pillarAX - ARM_HAND_SIDE, palmY: pillarA.height - 58,
      z: pillarA.z + 54 - ARM_HAND_DEPTH, scale: 285, yaw: Math.PI / 2, pitch: 0,
      tilt: 1.5, phase: .3,
      pillar: { x: pillarAX, z: pillarA.z + 54, side: -1 } },
    { kind: "climber", x: pillarBX + ARM_HAND_SIDE, palmY: pillarB.height - 68,
      z: pillarB.z + 54 - ARM_HAND_DEPTH, scale: 330, yaw: Math.PI / 2, pitch: 0,
      tilt: 1.5, phase: 2.1, mirror: true,
      pillar: { x: pillarBX, z: pillarB.z + 54, side: 1 } },
    // Both palms stay outside the walkable width; their fingers reach its edges.
    { kind: "guide", x: -115, palmY: CFG.riverY + 8, z: guideZ,
      scale: 285, yaw: Math.PI / 2, pitch: 0, tilt: 1.5, phase: 4.5, mirror: true },
    { kind: "guide", x: 115, palmY: CFG.riverY + 8, z: guideZ,
      scale: 285, yaw: Math.PI / 2, pitch: 0, tilt: 1.5, phase: 5.8 },
  ];

  const hands: AmbientHand[] = [];
  const animationGroups: AnimationGroup[] = [];
  const palmWorld = new Vector3();
  const originWorld = new Vector3();
  const wristWorld = new Vector3();
  const fingertipWorld = new Vector3();
  const thumbWorld = new Vector3();
  const thumbBaseWorld = new Vector3();
  const palmFacing = new Vector3();
  const palmReference = new Vector3();
  const fingerDirection = new Vector3();
  const thumbDirection = new Vector3();
  const viewerFacing = new Vector3(0, .27, -.963);
  const anchorPalm = (hand: AmbientHand, bob = 0, swayX = 0) => {
    hand.arm.computeWorldMatrix(true);
    hand.skeleton.prepare(true);
    hand.skeleton.computeAbsoluteTransforms(true);
    hand.palm.getAbsolutePositionToRef(hand.arm, palmWorld);
    hand.root.position.x += hand.placement.x + swayX - palmWorld.x;
    hand.root.position.y += hand.placement.palmY + bob - palmWorld.y;
    hand.root.position.z += hand.placement.z - palmWorld.z;
  };
  const skinnedWorld = new Vector3();
  const bentWorld = new Vector3();
  const drawnWorld = new Vector3();
  const drawnLocal = new Vector3();
  const tangentWorld = new Vector3();
  const radialWorld = new Vector3();
  const acrossWorld = new Vector3();
  const bendClimberArm = (hand: AmbientHand, seconds: number, positions: FloatArray,
    swayX = 0, swayY = 0) => {
    const { arm, placement, sourcePositions, indices } = hand;
    const pillar = placement.pillar;
    if (!pillar) return;
    // The sampled Grab pose is already in the vertex buffer. Bend only its
    // original forearm around the pillar; keep the authored fingers intact.
    const normals = arm.getVerticesData(VertexBuffer.NormalKind);
    if (!normals) return;
    arm.computeWorldMatrix(true);
    const world = arm.getWorldMatrix();
    const inverseWorld = world.clone().invert();
    for (let i = 0; i < positions.length; i += 3) {
      const t = Math.max(0, Math.min(1, (sourcePositions[i] + .448) / .648));
      const handBlend = smoothstep(.94, 1, t);
      const reach = smoothstep(.70, 1, t);
      const sweepAngle = Math.PI / 4 + ARM_SWEEP * t;
      const span = ARM_LOWER_SIDE + (ARM_HAND_SIDE - ARM_LOWER_SIDE) * reach;
      const front = ARM_FACE_DEPTH + (ARM_HAND_DEPTH - ARM_FACE_DEPTH) * reach;
      const sweepX = Math.cos(sweepAngle);
      const sweepZ = Math.sin(sweepAngle);
      // A soft superellipse rounds the pillar corners without cutting through it.
      const perimeter = Math.pow(Math.pow(Math.abs(sweepX), 3.4)
        + Math.pow(Math.abs(sweepZ), 3.4), 1 / 3.4);
      const sideWave = 9 * Math.sin(seconds * .62 + t * 9 + placement.phase)
        * Math.sin(Math.PI * t);
      const headSway = smoothstep(.55, 1, t);
      const centerX = pillar.x + pillar.side * span * sweepX / perimeter
        + sideWave + swayX * headSway;
      const centerY = WATER_ORIGIN_Y + (placement.palmY - WATER_ORIGIN_Y) * t
        + swayY * headSway;
      const centerZ = pillar.z - front * sweepZ / perimeter;
      tangentWorld.set(-pillar.side * span * ARM_SWEEP * sweepZ,
        placement.palmY - WATER_ORIGIN_Y, -front * ARM_SWEEP * sweepX).normalize();
      radialWorld.set(pillar.side * sweepX, 0, -sweepZ);
      Vector3.CrossToRef(tangentWorld, radialWorld, acrossWorld);
      acrossWorld.normalize();
      Vector3.CrossToRef(acrossWorld, tangentWorld, radialWorld);
      radialWorld.normalize();
      // Carry both axes of the authored arm section around the curve. The old
      // quarter-scale, axis-aligned offsets collapsed it into a thin ribbon.
      const sectionScale = placement.scale * (.70 + .65 * smoothstep(.45, .83, t));
      const radialOffset = sectionScale * (sourcePositions[i + 1] - .52);
      const acrossOffset = sectionScale * (sourcePositions[i + 2] + .015);
      bentWorld.set(centerX + radialWorld.x * radialOffset + acrossWorld.x * acrossOffset,
        centerY + radialWorld.y * radialOffset + acrossWorld.y * acrossOffset,
        centerZ + radialWorld.z * radialOffset + acrossWorld.z * acrossOffset);
      Vector3.TransformCoordinatesFromFloatsToRef(
        positions[i], positions[i + 1], positions[i + 2], world, skinnedWorld);
      Vector3.LerpToRef(bentWorld, skinnedWorld, handBlend, drawnWorld);
      const dx = drawnWorld.x - pillar.x;
      const dz = drawnWorld.z - pillar.z;
      const insideX = 36.5 - Math.abs(dx);
      const insideZ = 37 - Math.abs(dz);
      if (insideX > 0 && insideZ > 0) {
        const radialLength = Math.hypot(radialWorld.x, radialWorld.z);
        const outwardX = radialWorld.x / radialLength;
        const outwardZ = radialWorld.z / radialLength;
        const push = Math.min(insideX / Math.max(Math.abs(outwardX), .001),
          insideZ / Math.max(Math.abs(outwardZ), .001)) + .25;
        drawnWorld.x += outwardX * push;
        drawnWorld.z += outwardZ * push;
      }
      Vector3.TransformCoordinatesToRef(drawnWorld, inverseWorld, drawnLocal);
      drawnLocal.toArray(positions, i);
    }
    VertexData.ComputeNormals(positions, indices, normals);
    arm.updateVerticesData(VertexBuffer.PositionKind, positions);
    arm.updateVerticesData(VertexBuffer.NormalKind, normals);
    if (!hand.boundsInitialized) {
      arm.refreshBoundingInfo(false);
      hand.boundsInitialized = true;
    }
  };
  const spawnedRoots: TransformNode[] = [];
  try {
  for (const [index, placement] of placements.entries()) {
    const instance = container.instantiateModelsToScene(
      (name) => `sanctuaryShadowHand${index}:${name}`, false, { doNotInstantiate: true });
    const root = new TransformNode(`sanctuaryShadowHand_${index}`, scene);
    spawnedRoots.push(root);
    root.rotation.set(placement.pitch, placement.yaw, placement.tilt);
    root.scaling.setAll(placement.scale);
    for (const node of instance.rootNodes) node.parent = root;
    const nodes = instance.rootNodes.flatMap((node) => [node, ...node.getDescendants(false)]);
    const arm = nodes.find((node): node is Mesh => node instanceof Mesh &&
      node.name.endsWith("ShadowArm_Main"));
    const orb = nodes.find((node): node is AbstractMesh => node instanceof AbstractMesh &&
      node.name.endsWith("ShadowOrb_Core"));
    const skeleton = instance.skeletons[0];
    const origin = skeleton?.bones.find((bone) => bone.name.endsWith("Arm_01"));
    const wrist = skeleton?.bones.find((bone) => bone.name.endsWith("Arm_05"));
    const palm = skeleton?.bones.find((bone) => bone.name.endsWith("Palm"));
    const fingertip = skeleton?.bones.find((bone) => bone.name.endsWith("Middle_04"));
    const thumb = skeleton?.bones.find((bone) => bone.name.endsWith("Thumb_03"));
    const thumbBase = skeleton?.bones.find((bone) => bone.name.endsWith("Thumb_01"));
    const hold = instance.animationGroups.find((group) => group.name.endsWith("AS_Hold"));
    const grab = instance.animationGroups.find((group) => group.name.endsWith("AS_Grab"));
    const idle = instance.animationGroups.find((group) => group.name.endsWith("AS_Idle"));
    if (!arm || !skeleton || !origin || !wrist || !palm || !fingertip || !thumb || !thumbBase || !hold || !grab || !idle) {
      throw new Error("ShadowGrabber asset is missing its hand, bones, or required animations.");
    }
    if (placement.mirror) root.scaling.z = -placement.scale;
    arm.material = placement.kind === "climber"
      ? makeTarMaterial(`sanctuaryClimberTar_${index}`) : guideTar;
    arm.isPickable = false;
    arm.checkCollisions = false;
    arm.alwaysSelectAsActiveMesh = true;
    orb?.setEnabled(false);
    for (const group of instance.animationGroups) {
      const keep = placement.kind === "climber"
        ? group === hold || group === grab : group === idle || group === grab;
      if (keep) animationGroups.push(group);
      else group.dispose();
    }
    if (placement.kind === "climber") {
      arm.makeGeometryUnique();
      const sourcePositions = arm.setPositionsForCPUSkinning();
      const sourceNormals = arm.setNormalsForCPUSkinning();
      const indices = arm.getIndices();
      if (!sourcePositions || !sourceNormals || !indices) {
        throw new Error("ShadowGrabber climber has no skinnable arm geometry.");
      }
      // Retain the skeleton (and its GLB pose matrix), but compile the mesh
      // without GPU bone influences. The CPU path below skins before bending.
      arm.numBoneInfluencers = 0;
      // Grab has keyed finger motion; Hold leaves most finger joints static.
      // Sampling the paused clip writes the pose before CPU skinning this frame.
      grab.start(true, 1);
      grab.pause();
      grab.goToFrame(grab.from + (grab.to - grab.from) * ((index * .43) % 1));
      // The loader changes handedness. Check the posed bones, not Euler signs.
      arm.computeWorldMatrix(true);
      skeleton.computeAbsoluteTransforms(true);
      origin.getAbsolutePositionToRef(arm, originWorld);
      fingertip.getAbsolutePositionToRef(arm, fingertipWorld);
      if (fingertipWorld.y < originWorld.y) {
        placement.tilt += Math.PI;
        root.rotation.z = placement.tilt;
      }
      const hand: AmbientHand = { root, arm, skeleton, origin, wrist, palm, fingertip, thumb,
        grab, sourcePositions, indices, grabPoses: sampleGrabPoses(arm, skeleton, grab, sourcePositions), placement };
      anchorPalm(hand);
      const positions = interpolateGrabPose(hand, .5 - .5 * Math.cos(placement.phase));
      if (positions) bendClimberArm(hand, 0, positions);
      hands.push(hand);
      continue;
    } else {
      idle.start(true, .22 + index * .02);
      idle.goToFrame(idle.from + (idle.to - idle.from) * ((index * .27) % 1), true);
      // Aim the fingers at the stair edge and turn the palm toward the path,
      // rather than accepting an upward-facing palm with the right fingertip.
      let bestScore = -Infinity;
      let bestWristDrop = 0;
      const left = placement.x < 0;
      const targetInward = Math.abs(placement.x) - ASCENT.stairWidth / 2;
      const targetForward = ASCENT.stairStartZ + 6 - placement.z;
      for (const yaw of left ? [-3.1, -2.85, 2.9] : [-.35, -.1, .15]) {
        for (const tilt of [-.6, -.85]) {
          for (const pitch of left ? [-.6, -.85, -1.1] : [.65, .9, 1.15]) {
            root.rotation.set(pitch, yaw, tilt);
            arm.computeWorldMatrix(true);
            skeleton.computeAbsoluteTransforms(true);
            palm.getAbsolutePositionToRef(arm, palmWorld);
            wrist.getAbsolutePositionToRef(arm, wristWorld);
            fingertip.getAbsolutePositionToRef(arm, fingertipWorld);
            thumb.getAbsolutePositionToRef(arm, thumbWorld);
            fingertipWorld.subtractToRef(palmWorld, fingerDirection);
            thumbWorld.subtractToRef(palmWorld, thumbDirection);
            Vector3.CrossToRef(fingerDirection, thumbDirection, palmFacing);
            palmFacing.normalize();
            Vector3.TransformNormalToRef(Vector3.Down(), arm.getWorldMatrix(), palmReference);
            if (Vector3.Dot(palmFacing, palmReference) < 0) palmFacing.scaleInPlace(-1);
            const front = Vector3.Dot(palmFacing, viewerFacing);
            const palmInward = palmFacing.x * (left ? 1 : -1);
            const palmUp = Math.abs(palmFacing.y);
            const fingerRise = fingertipWorld.y - palmWorld.y;
            const wristDrop = palmWorld.y - wristWorld.y;
            const fingerInward = (fingertipWorld.x - palmWorld.x) * (left ? 1 : -1);
            const fingerForward = fingertipWorld.z - palmWorld.z;
            if (front < .55 || palmInward < .35 || palmUp > .35 ||
              fingerRise < placement.scale * .035 || fingerInward < placement.scale * .1 ||
              fingerForward < placement.scale * .04 || wristDrop < placement.scale * .02) continue;
            const score = front * 25 + palmInward * 45 - palmUp * 20
              - Math.abs(fingerInward - targetInward)
              - Math.abs(fingerForward - targetForward) * .7
              - Math.abs(fingerRise - placement.scale * .1) * .25 + wristDrop * .1;
            if (score > bestScore) {
              bestScore = score;
              bestWristDrop = wristDrop;
              placement.pitch = pitch;
              placement.yaw = yaw;
              placement.tilt = tilt;
            }
          }
        }
      }
      if (!Number.isFinite(bestScore)) throw new Error("ShadowGrabber guide hand cannot face the player from the water.");
      placement.palmY = CFG.riverY + Math.min(9, Math.max(5, bestWristDrop * .55));
      root.rotation.set(placement.pitch, placement.yaw, placement.tilt);
      idle.pause();
      grab.start(true, 1);
      grab.pause();
      // Keep the authored thumb joints. Test a few small rotations of the
      // whole hand against the Grab cycle so its thumb clears the landing.
      let bestThumbClearance = -Infinity;
      let bestPitchNudge = 0;
      let bestTiltNudge = 0;
      for (const [pitchNudge, tiltNudge] of [[0, 0], [-.12, 0], [.12, 0], [0, -.12], [0, .12]]) {
        root.rotation.set(placement.pitch + pitchNudge, placement.yaw, placement.tilt + tiltNudge);
        arm.computeWorldMatrix(true);
        grab.goToFrame(grab.from);
        skeleton.prepare(true);
        skeleton.computeAbsoluteTransforms(true);
        palm.getAbsolutePositionToRef(arm, palmWorld);
        const anchoredPalmY = palmWorld.y;
        let thumbClearance = Infinity;
        for (const fraction of [0, .25, .5, .75, 1]) {
          grab.goToFrame(grab.from + (grab.to - grab.from) * fraction);
          skeleton.prepare(true);
          skeleton.computeAbsoluteTransforms(true);
          thumbBase.getAbsolutePositionToRef(arm, thumbBaseWorld);
          thumb.getAbsolutePositionToRef(arm, thumbWorld);
          thumbClearance = Math.min(thumbClearance,
            thumbBaseWorld.y - anchoredPalmY, thumbWorld.y - anchoredPalmY);
        }
        if (thumbClearance > bestThumbClearance) {
          bestThumbClearance = thumbClearance;
          bestPitchNudge = pitchNudge;
          bestTiltNudge = tiltNudge;
        }
      }
      placement.pitch += bestPitchNudge;
      placement.tilt += bestTiltNudge;
      placement.palmY = Math.max(placement.palmY, ASCENT.lowerY + 8 - bestThumbClearance);
      root.rotation.set(placement.pitch, placement.yaw, placement.tilt);
      grab.goToFrame(grab.from);
    }
    arm.makeGeometryUnique();
    const sourcePositions = arm.setPositionsForCPUSkinning();
    const sourceNormals = arm.setNormalsForCPUSkinning();
    const indices = arm.getIndices();
    if (!sourcePositions || !sourceNormals || !indices) {
      throw new Error("ShadowGrabber guide has no skinnable arm geometry.");
    }
    arm.numBoneInfluencers = 0;
    const hand: AmbientHand = { root, arm, skeleton, origin, wrist, palm, fingertip, thumb,
      grab, idle, sourcePositions, indices,
      grabPoses: sampleGrabPoses(arm, skeleton, grab, sourcePositions), placement };
    anchorPalm(hand);
    const positions = interpolateGrabPose(hand, .5 - .5 * Math.cos(placement.phase));
    const normals = arm.getVerticesData(VertexBuffer.NormalKind);
    if (positions && normals) {
      VertexData.ComputeNormals(positions, indices, normals);
      arm.updateVerticesData(VertexBuffer.PositionKind, positions);
      arm.updateVerticesData(VertexBuffer.NormalKind, normals);
      arm.refreshBoundingInfo(false);
    }
    hands.push(hand);
  }
  } catch (error) {
    // A failed later hand must not leave earlier, static instances in the scene.
    for (const group of animationGroups) { group.stop(); group.dispose(); }
    for (const root of spawnedRoots) root.dispose(false, false);
    for (const material of materials) material.dispose();
    container.dispose();
    throw error;
  }

  let disposed = false;
  const animateHands = (seconds: number) => {
    if (disposed) return;
    for (const hand of hands) {
      const { root, placement } = hand;
      const climber = placement.kind === "climber";
      const period = climber ? 3.6 : 4.7;
      const cycle = (seconds / period + placement.phase / (Math.PI * 2)) % 1;
      const curl = .5 - .5 * Math.cos(cycle * Math.PI * 2);
      const swayPhase = seconds * .88 + placement.phase;
      const swayX = climber ? 12 * Math.sin(swayPhase) : 0;
      const bob = climber ? 5 * Math.sin(swayPhase * .79)
        : .18 * Math.sin(seconds * .31 + placement.phase);
      root.rotation.x = placement.pitch + (climber ? .035 : .008) * Math.sin(swayPhase);
      root.rotation.y = placement.yaw + (climber ? .04 : .009) * Math.sin(swayPhase * .84);
      root.rotation.z = placement.tilt + (climber ? .025 : .004) * Math.sin(swayPhase * .72);
      anchorPalm(hand, bob, swayX);
      const positions = interpolateGrabPose(hand, curl);
      if (climber && positions) bendClimberArm(hand, seconds, positions, swayX, bob);
      else if (positions) {
        const normals = hand.arm.getVerticesData(VertexBuffer.NormalKind);
        if (!normals) continue;
        VertexData.ComputeNormals(positions, hand.indices, normals);
        hand.arm.updateVerticesData(VertexBuffer.PositionKind, positions);
        hand.arm.updateVerticesData(VertexBuffer.NormalKind, normals);
      }
    }
  };
  return {
    update(seconds: number) {
      animateHands(seconds);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const group of animationGroups) { group.stop(); group.dispose(); }
      for (const { root } of hands) root.dispose(false, false);
      for (const material of materials) material.dispose();
      container.dispose();
    },
  };
}
