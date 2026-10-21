import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_STADIUM } from "./RinaLevelConfig";

/**
 * UPDATE 02 — Stage-left / stage-right audience safety barriers.
 *
 * IMPORTANT TRANSFORM CONTRACT:
 * - All positions and dimensions in this file are local stadium units.
 * - The caller must parent the returned `root` to `rinaStadiumRoot` exactly once.
 * - Do not apply RINA_STADIUM_SCALE here; the scene root already does it.
 *
 * Architecture only: no colliders, no picking, no AI and no playable stairs.
 * No changes to RinaStage, StagePyro, RinaStadiumWorld or Update 01.
 */
export const RINA_STAGE_BARRIER_PROFILE = {
  // The front edge of the main deck is z = 32.5 in the current scene.
  // The first decorative stairs occupy x = ±(9 ± 2.15), z ≈ 26.5–32.5.
  frontOffsetFromStage: 7.75,
  // The catwalk's half width is 2.7. Keep the central approach clear.
  innerWingStart: RINA_STADIUM.stage.catwalk.width * 0.5 + 1.15,
  // Stair access gap is ~7.2 local units wide, centered on each x = ±9.
  stairCenterX: 9,
  stairWidth: 4.3,
  stairGapExtra: 1.42,
  outerWingEnd: RINA_STADIUM.stage.width * 0.5 - 2.1,
  innerReturnEndOffset: 1.6,
  outerReturnEndOffset: 0.85,
  exteriorWingReturnDepth: 3.75,
  // Height is local: 0.86 * 1.5 = 1.29 metres in the game.
  panelWidth: 1.55,
  railTop: 0.86,
  railMiddle: 0.50,
  railBottom: 0.12,
  postDiameter: 0.066,
  railDiameter: 0.055,
  meshWireDiameter: 0.014,
  footWidth: 0.46,
  footDepth: 0.17,
  footHeight: 0.055,
  desktopVerticalWires: 11,
  mobileVerticalWires: 6,
  desktopHorizontalWires: 4,
  mobileHorizontalWires: 2,
} as const;

export interface RinaStageSecurityBarrierHandle {
  readonly root: TransformNode;
  /** Render-ready meshes after material batching, not the temporary pieces. */
  readonly meshes: readonly Mesh[];
  readonly panelCount: number;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

type NamedGroup = "yellow" | "mesh" | "feet" | "reflective";
type Point2 = { x: number; z: number };
type Assembly = {
  yellow: Mesh[];
  mesh: Mesh[];
  feet: Mesh[];
  reflective: Mesh[];
};

const WALL_THICKNESS = 0.023;

function createPaintedMaterial(scene: Scene, name: string, rgb: Color3, emission: Color3) {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = rgb;
  result.emissiveColor = emission;
  result.specularColor = new Color3(0.06, 0.065, 0.075);
  result.specularPower = 48;
  return result;
}

/**
 * Place a short box along the local X axis of a barrier span. Each span can be
 * either straight or turned 90°, without multiplying by the stadium scale.
 */
function addPart(
  scene: Scene,
  parts: Assembly,
  kind: NamedGroup,
  name: string,
  width: number,
  height: number,
  depth: number,
  center: Point2,
  y: number,
  yaw: number
) {
  if (width <= 0 || height <= 0 || depth <= 0) {
    throw new Error(`Invalid Rina stage barrier dimension for ${name}`);
  }
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position.set(center.x, y, center.z);
  mesh.rotation.y = yaw;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  parts[kind].push(mesh);
}

/** Generate a single barrier panel between two points (oriented in XZ). */
function addPanel(
  scene: Scene,
  parts: Assembly,
  label: string,
  a: Point2,
  b: Point2,
  wires: { vertical: number; horizontal: number }
) {
  const p = RINA_STAGE_BARRIER_PROFILE;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.05) return false;

  // Local +X rotated about Y gives (cos(yaw), 0, -sin(yaw)).
  const yaw = -Math.atan2(dz, dx);
  const tangentX = dx / length;
  const tangentZ = dz / length;
  const mid: Point2 = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const at = (offset: number): Point2 => ({
    x: mid.x + tangentX * offset,
    z: mid.z + tangentZ * offset,
  });

  // Framework: tubular yellow top rail, two vertical end posts, bottom rail.
  addPart(scene, parts, "yellow", `${label}_top`,
    length + p.postDiameter, p.railDiameter, p.railDiameter,
    mid, p.railTop, yaw);
  addPart(scene, parts, "yellow", `${label}_mid`,
    length - p.postDiameter, p.railDiameter * 0.76, p.railDiameter * 0.76,
    mid, p.railMiddle, yaw);
  addPart(scene, parts, "yellow", `${label}_baseRail`,
    length - p.postDiameter, p.railDiameter * 0.85, p.railDiameter * 0.85,
    mid, p.railBottom, yaw);

  for (const sign of [-1, 1]) {
    const endpoint = at(sign * length * 0.5);
    addPart(scene, parts, "yellow", `${label}_endPost_${sign}`,
      p.postDiameter, p.railTop + 0.06, p.postDiameter,
      endpoint, (p.railTop + 0.06) * 0.5, yaw);

    // Broad, low footplates make the modular units read as event barricades.
    addPart(scene, parts, "feet", `${label}_foot_${sign}`,
      p.footDepth, p.footHeight, p.footWidth,
      endpoint, 0.03, yaw);
  }

  // Real open wirework; no transparency / textured planes to sort in smoke.
  const meshHeight = p.railTop - p.railBottom - 0.11;
  const meshY = (p.railTop + p.railBottom) * 0.5;
  const meshLeft = -length * 0.5 + 0.095;
  const meshRight = length * 0.5 - 0.095;
  for (let i = 1; i <= wires.vertical; i++) {
    const x = meshLeft + (meshRight - meshLeft) * i / (wires.vertical + 1);
    addPart(scene, parts, "mesh", `${label}_meshV_${i}`,
      p.meshWireDiameter, meshHeight, WALL_THICKNESS,
      at(x), meshY, yaw);
  }
  for (let j = 1; j <= wires.horizontal; j++) {
    const y = p.railBottom + 0.055 + meshHeight * j / (wires.horizontal + 1);
    addPart(scene, parts, "mesh", `${label}_meshH_${j}`,
      Math.max(0.05, length - 0.20), p.meshWireDiameter, WALL_THICKNESS,
      mid, y, yaw);
  }

  // Retro-reflective yellow-green squares are *not* dynamic scene lights.
  addPart(scene, parts, "reflective", `${label}_safetyStripe`,
    Math.max(0.05, length - 0.15), 0.032, 0.012,
    { x: mid.x - tangentZ * 0.035, z: mid.z + tangentX * 0.035 },
    p.railTop + 0.055, yaw);
  return true;
}

function addSpan(
  scene: Scene,
  parts: Assembly,
  tag: string,
  a: Point2,
  b: Point2,
  wires: { vertical: number; horizontal: number }
) {
  const p = RINA_STAGE_BARRIER_PROFILE;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.05) return 0;
  const count = Math.max(1, Math.ceil(distance / p.panelWidth));
  let created = 0;
  for (let i = 0; i < count; i++) {
    const t0 = i / count;
    const t1 = (i + 1) / count;
    const from = { x: a.x + dx * t0, z: a.z + dz * t0 };
    const to = { x: a.x + dx * t1, z: a.z + dz * t1 };
    if (addPanel(scene, parts, `${tag}_${i}`, from, to, wires)) created++;
  }
  return created;
}

function batch(meshes: Mesh[], name: string, material: StandardMaterial, root: TransformNode) {
  if (!meshes.length) return null;
  const merged = meshes.length === 1
    ? meshes[0]
    : Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
  if (!merged) throw new Error(`Could not merge Rina stage safety barrier: ${name}`);
  merged.name = name;
  merged.material = material;
  merged.parent = root;
  merged.isPickable = false;
  merged.checkCollisions = false;
  merged.receiveShadows = false;
  return merged;
}

export function createRinaStageSecurityBarriers(
  scene: Scene,
  performanceTier: "desktop" | "mobile"
): RinaStageSecurityBarrierHandle {
  const p = RINA_STAGE_BARRIER_PROFILE;
  const frontZ = RINA_STADIUM.stage.frontZ - p.frontOffsetFromStage;
  const stairGapStart = p.stairCenterX - p.stairWidth * 0.5 - p.stairGapExtra;
  const stairGapEnd = p.stairCenterX + p.stairWidth * 0.5 + p.stairGapExtra;

  // 2.7m half-width runway + 1.15m clearance on either side;
  // stairs centered at ±9m, width 4.3m, never covered by front rail.
  if (p.innerWingStart >= stairGapStart || stairGapEnd >= p.outerWingEnd) {
    throw new Error("Rina security barriers cannot fit around the stage stairs");
  }
  const mats = {
    yellow: createPaintedMaterial(scene,
      "rinaSecurityFenceYellow", new Color3(0.94, 0.64, 0.035),
      new Color3(0.14, 0.077, 0.005)),
    mesh: createPaintedMaterial(scene,
      "rinaSecurityFenceDarkMesh", new Color3(0.11, 0.12, 0.13),
      new Color3(0.02, 0.02, 0.022)),
    feet: createPaintedMaterial(scene,
      "rinaSecurityFenceBlackFeet", new Color3(0.052, 0.054, 0.056),
      new Color3(0.008, 0.009, 0.009)),
    reflective: createPaintedMaterial(scene,
      "rinaSecurityFenceRetroStrip", new Color3(0.92, 0.78, 0.19),
      new Color3(0.27, 0.20, 0.037)),
  };
  const parts: Assembly = { yellow: [], mesh: [], feet: [], reflective: [] };
  const wireCount = performanceTier === "desktop"
    ? { vertical: p.desktopVerticalWires, horizontal: p.desktopHorizontalWires }
    : { vertical: p.mobileVerticalWires, horizontal: p.mobileHorizontalWires };

  // TWO mirror-image security pockets: the stage catwalk remains unobstructed;
  // the central gap of each front line leads toward its existing side stairs.
  let panelCount = 0;
  for (const side of [-1, 1] as const) {
    const at = (x: number, z: number): Point2 => ({ x: side * x, z });
    panelCount += addSpan(scene, parts, `rinaFence_${side}_frontInner`,
      at(p.innerWingStart, frontZ), at(stairGapStart, frontZ), wireCount);
    panelCount += addSpan(scene, parts, `rinaFence_${side}_frontOuter`,
      at(stairGapEnd, frontZ), at(p.outerWingEnd, frontZ), wireCount);
    // Two returns frame each staircase approach without placing a fence on
    // the tread surfaces or on the main deck.
    panelCount += addSpan(scene, parts, `rinaFence_${side}_innerReturn`,
      at(stairGapStart, frontZ),
      at(stairGapStart, RINA_STADIUM.stage.frontZ - p.innerReturnEndOffset),
      wireCount);
    panelCount += addSpan(scene, parts, `rinaFence_${side}_outerReturn`,
      at(stairGapEnd, frontZ),
      at(stairGapEnd, RINA_STADIUM.stage.frontZ - p.outerReturnEndOffset),
      wireCount);
    // Slight angled tail connects to the production wing without crossing
    // the stage footprint, Rina's catwalk, or the audience circulation lane.
    panelCount += addSpan(scene, parts, `rinaFence_${side}_outerTail`,
      at(p.outerWingEnd, frontZ),
      at(p.outerWingEnd + 1.8, frontZ + p.exteriorWingReturnDepth),
      wireCount);
  }

  const root = new TransformNode("rinaStageSecurityFenceRoot", scene);
  const meshes: Mesh[] = [];
  for (const [key, name] of [
    ["yellow", "rinaStageFence_YellowFrames"],
    ["mesh", "rinaStageFence_DarkGrille"],
    ["feet", "rinaStageFence_RubberFootplates"],
    ["reflective", "rinaStageFence_ReflectiveStrips"],
  ] as const) {
    const merged = batch(parts[key], name, mats[key], root);
    if (merged) meshes.push(merged);
  }

  let disposed = false;
  return {
    root,
    meshes,
    panelCount,
    setEnabled(enabled: boolean) {
      if (!disposed) root.setEnabled(enabled);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) if (!mesh.isDisposed()) mesh.dispose();
      root.dispose(false, false);
      for (const material of Object.values(mats)) material.dispose();
    },
  };
}
