import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_STADIUM } from "./RinaLevelConfig";
import { RINA_DOUBLE_TIER_PROFILE } from "./RinaDoubleTierSideStands";

/**
 * UPDATE 03 V3 — structural correction of the two existing corner pavilions.
 * The stage, rear exit and seating are deliberately untouched.
 * All measurements are LOCAL and scaled only once by rinaStadiumRoot.
 */
export type CornerMaterialSet = Readonly<{
  concrete: Material;
  darkConcrete: Material;
  aisle: Material;
  ledRibbon: Material;
}>;

export interface RinaStadiumCornerOptions {
  performanceTier: "desktop" | "mobile";
  materials: CornerMaterialSet;
  /** Mirror the rear pavilions to the stage end without changing their design. */
  end?: "rear" | "stage";
}

export interface RinaStadiumCornerHandle {
  readonly meshes: readonly Mesh[];
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** Keep previous dimensions/landmarks so the old V2 can be replaced in place. */
export const RINA_CORNER_PAVILION_PROFILE = {
  sideEndZ: -RINA_DOUBLE_TIER_PROFILE.length * 0.5,
  backLowerFrontZ: -(RINA_STADIUM.pitchLength * 0.5 + 8.5 + 3),
  backUpperFrontZ: -(RINA_STADIUM.pitchLength * 0.5 + 8.5 + 9 * 1.65 + 3.25 + 2.35),
  towerCenterAbsX: RINA_STADIUM.pitchWidth * 0.5 + 15.7,
  towerCenterZ: -(RINA_STADIUM.pitchLength * 0.5 + 16),
  towerWidth: 14.4,
  towerDepth: 12.5,
  foundationHeight: 1.9,
  towerRoofY: 25.7,
  galleryLevels: [4.2, 8.3, 12.48, 16.7, 20.95] as readonly number[],
  pitchSafetyMargin: 2,
  // Self-contained facade and bridge detailing. All values in local units.
  primaryColumnWidth: 0.85,
  floorThickness: 0.42,
  parapetHeight: 0.96,
  bridgePierThickness: 0.38,
} as const;

type PointXZ = Readonly<{ x: number; z: number }>;
type Bridge = Readonly<{
  name: string;
  from: PointXZ;
  to: PointXZ;
  y: number;
  width: number;
  face: "front" | "inner";
}>;
type GroupName = "structure" | "floors" | "steel" | "dark" | "trim";
type Groups = Record<GroupName, Mesh[]>;

type TowerPlan = Readonly<{
  cx: number;
  cz: number;
  nearZ: number;
  farZ: number;
  innerX: number;
  outerX: number;
  halfW: number;
  halfD: number;
  side: -1 | 1;
  label: string;
}>;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function box(
  scene: Scene, parts: Groups, category: GroupName, name: string,
  position: Vector3, width: number, height: number, depth: number,
  yaw = 0
): Mesh {
  if (width <= 0 || height <= 0 || depth <= 0) throw new Error(`Invalid corner part: ${name}`);
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position.copyFrom(position);
  mesh.rotation.y = yaw;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  parts[category].push(mesh);
  return mesh;
}

/** The bridge's local Z axis follows its plan direction. */
function span(
  scene: Scene, parts: Groups, category: GroupName, name: string,
  from: PointXZ, to: PointXZ, y: number, width: number, thickness: number
) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.15) return;
  box(scene, parts, category, name,
    new Vector3((from.x + to.x) * 0.5, y, (from.z + to.z) * 0.5),
    width, thickness, len + 0.22, Math.atan2(dx, dz));
}

/** For diagonal truss stays and load-bearing struts, not scenery stairs. */
function tubeBetween(
  scene: Scene, parts: Groups, name: string,
  from: Vector3, to: Vector3, radius: number
) {
  const delta = to.subtract(from);
  const height = delta.length();
  if (height < 0.1) return;
  const mesh = MeshBuilder.CreateCylinder(name,
    { height, diameter: radius * 2, tessellation: 6 }, scene);
  mesh.position.copyFrom(from.add(to).scale(0.5));
  const normal = delta.scale(1 / height);
  const axis = Vector3.Cross(Vector3.Up(), normal);
  if (axis.lengthSquared() > 1e-8) {
    mesh.rotationQuaternion = Quaternion.RotationAxis(
      axis.normalize(), Math.acos(clamp(normal.y, -1, 1)));
  }
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  parts.steel.push(mesh);
}

function createTowerPlan(side: -1 | 1): TowerPlan {
  const p = RINA_CORNER_PAVILION_PROFILE;
  const cx = side * p.towerCenterAbsX;
  const cz = p.towerCenterZ;
  return {
    side, cx, cz,
    nearZ: cz + p.towerDepth * 0.5,
    farZ: cz - p.towerDepth * 0.5,
    innerX: cx - side * p.towerWidth * 0.5,
    outerX: cx + side * p.towerWidth * 0.5,
    halfW: p.towerWidth * 0.5,
    halfD: p.towerDepth * 0.5,
    label: side === -1 ? "West" : "East",
  };
}

/** Endpoints reflect the exact current Rina stadium side and rear profiles. */
function bridgesForTower(t: TowerPlan): readonly Bridge[] {
  const p = RINA_CORNER_PAVILION_PROFILE;
  const s = RINA_DOUBLE_TIER_PROFILE;
  const outerCurveAtEnd = s.zCurve;
  const sideLowerEndX = RINA_STADIUM.pitchWidth * 0.5 + s.fieldMargin +
    s.lowerRows * s.lowerTread + outerCurveAtEnd;
  const sideUpperStartX = sideLowerEndX + s.concourseDepth;
  return [
    {
      name: `${t.label}_SideConcourse`,
      from: { x: t.side * sideLowerEndX, z: p.sideEndZ + 0.38 },
      to: { x: t.cx + t.side * 2.1, z: t.nearZ + 0.08 },
      y: 8.3, width: 2.65, face: "front",
    },
    {
      name: `${t.label}_BackConcourse`,
      from: { x: t.innerX + t.side * 0.48, z: t.farZ + 1.1 },
      to: { x: t.side * (RINA_STADIUM.pitchWidth * 0.5 + 3.9),
        z: p.backLowerFrontZ - 13.2 },
      y: 8.3, width: 2.45, face: "inner",
    },
    {
      name: `${t.label}_SideUpper`,
      from: { x: t.side * (sideUpperStartX + 2), z: p.sideEndZ + 0.38 },
      to: { x: t.cx + t.side * 3.75, z: t.nearZ + 0.1 },
      y: 12.48, width: 2.3, face: "front",
    },
    {
      name: `${t.label}_BackUpper`,
      from: { x: t.innerX + t.side * 0.40, z: t.farZ + 0.85 },
      to: { x: t.side * (RINA_STADIUM.pitchWidth * 0.5 + 2.15),
        z: p.backUpperFrontZ - 4 * 1.55 },
      y: 12.48, width: 2.2, face: "inner",
    },
  ];
}

/** Rail intervals stop around actual bridge landings: no rail through a door. */
function cutSegments(start: number, end: number,
  center: number | null, gap: number): Array<readonly [number, number]> {
  if (center === null) return [[start, end]];
  const left = clamp(center - gap * 0.5, start, end);
  const right = clamp(center + gap * 0.5, start, end);
  const result: Array<readonly [number, number]> = [];
  if (left - start > 0.1) result.push([start, left]);
  if (end - right > 0.1) result.push([right, end]);
  return result;
}

function fenceX(scene: Scene, parts: Groups, name: string,
  x0: number, x1: number, z: number, y: number, mobile: boolean) {
  const len = x1 - x0;
  if (len < 0.1) return;
  const center = (x0 + x1) * 0.5;
  for (const [tier, height] of [["top", 0.96], ["lower", 0.51]] as const) {
    box(scene, parts, "steel", `${name}_${tier}`,
      new Vector3(center, y + height, z), len, 0.064, 0.064);
  }
  const posts = mobile ? Math.max(1, Math.ceil(len / 5.5)) : Math.max(1, Math.ceil(len / 3.1));
  for (let i = 0; i <= posts; i++) {
    box(scene, parts, "steel", `${name}_post_${i}`,
      new Vector3(x0 + len * i / posts, y + 0.57, z),
      0.070, 0.92, 0.070);
  }
}

function fenceZ(scene: Scene, parts: Groups, name: string,
  z0: number, z1: number, x: number, y: number, mobile: boolean) {
  const len = z1 - z0;
  if (len < 0.1) return;
  const center = (z0 + z1) * 0.5;
  for (const [tier, height] of [["top", 0.96], ["lower", 0.51]] as const) {
    box(scene, parts, "steel", `${name}_${tier}`,
      new Vector3(x, y + height, center), 0.064, 0.064, len);
  }
  const posts = mobile ? Math.max(1, Math.ceil(len / 5.5)) : Math.max(1, Math.ceil(len / 3.1));
  for (let i = 0; i <= posts; i++) {
    box(scene, parts, "steel", `${name}_post_${i}`,
      new Vector3(x, y + 0.57, z0 + len * i / posts),
      0.070, 0.92, 0.070);
  }
}

/** Structural beam + deck + low-cost truss/columns at a nonplayable position. */
function guardedBridge(scene: Scene, parts: Groups, bridge: Bridge,
  mobile: boolean) {
  const { name, from, to, y, width } = bridge;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return;
  const px = -dz / len;
  const pz = dx / len;
  const center = { x: (from.x + to.x) * 0.5, z: (from.z + to.z) * 0.5 };
  // The deck is tied to two lower longitudinal steel/concrete stringers.
  span(scene, parts, "floors", `${name}_deck`, from, to, y, width, 0.28);
  for (const side of [-1, 1]) {
    const offset = side * (width * 0.5 - 0.13);
    const a = { x: from.x + px * offset, z: from.z + pz * offset };
    const b = { x: to.x + px * offset, z: to.z + pz * offset };
    span(scene, parts, "structure", `${name}_longitudinalBeam_${side}`,
      a, b, y - 0.32, 0.21, 0.40);
    span(scene, parts, "steel", `${name}_handrail_${side}`,
      a, b, y + 0.98, 0.065, 0.065);
    span(scene, parts, "steel", `${name}_midrail_${side}`,
      a, b, y + 0.55, 0.046, 0.046);
    const posts = mobile ? 2 : Math.max(2, Math.ceil(len / 3.1));
    for (let j = 0; j <= posts; j++) {
      const t = j / posts;
      box(scene, parts, "steel", `${name}_post_${side}_${j}`,
        new Vector3(a.x + (b.x - a.x) * t, y + 0.55,
          a.z + (b.z - a.z) * t), 0.07, 0.96, 0.07);
    }
  }
  // A dedicated pier under the walkway makes the span read as supported.
  // All spans lie outside the playable rectangle, so no gameplay is affected.
  const pierHeight = Math.max(0.3, y - 0.5);
  box(scene, parts, "structure", `${name}_pier`,
    new Vector3(center.x, pierHeight * 0.5, center.z),
    RINA_CORNER_PAVILION_PROFILE.bridgePierThickness, pierHeight,
    RINA_CORNER_PAVILION_PROFILE.bridgePierThickness);
  if (!mobile) {
    const top = new Vector3(center.x, y - 0.32, center.z);
    const quarter = (t: number) => new Vector3(
      from.x + dx * t, y - 0.2, from.z + dz * t);
    tubeBetween(scene, parts, `${name}_braceA`,
      new Vector3(center.x, y - 1.15, center.z), quarter(0.24), 0.08);
    tubeBetween(scene, parts, `${name}_braceB`,
      new Vector3(center.x, y - 1.15, center.z), quarter(0.76), 0.08);
    void top;
  }
}

function createPavilion(scene: Scene, parts: Groups,
  side: -1 | 1, mobile: boolean) {
  const p = RINA_CORNER_PAVILION_PROFILE;
  const t = createTowerPlan(side);
  const bridges = bridgesForTower(t);

  // Continuous foundation + long concrete columns visually support EVERY slab.
  box(scene, parts, "structure", `${t.label}_foundation`,
    new Vector3(t.cx, p.foundationHeight * 0.5, t.cz),
    p.towerWidth + 0.45, p.foundationHeight, p.towerDepth + 0.45);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(scene, parts, "structure", `${t.label}_primaryColumn_${sx}_${sz}`,
      new Vector3(t.cx + sx * (t.halfW - 0.5),
        (p.towerRoofY + p.foundationHeight) * 0.5,
        t.cz + sz * (t.halfD - 0.5)),
      p.primaryColumnWidth, p.towerRoofY - p.foundationHeight,
      p.primaryColumnWidth);
  }
  for (const offset of [-0.34, 0.34]) {
    box(scene, parts, "structure", `${t.label}_secondaryFrontColumn_${offset}`,
      new Vector3(t.cx + offset * p.towerWidth,
        (p.towerRoofY + p.foundationHeight) * 0.5, t.nearZ - 0.32),
      0.33, p.towerRoofY - p.foundationHeight, 0.34);
  }

  // Enclosed stair/service core in the outer rear quarter. Its facade has
  // recessed door/window panels: the tower is no longer only five bare slabs.
  const coreX = t.cx + t.side * (t.halfW - 2.0);
  const coreZ = t.farZ + 2.6;
  const coreW = 3.5;
  const coreD = 4.65;
  const coreHeight = p.towerRoofY - p.foundationHeight;
  box(scene, parts, "structure", `${t.label}_stairCore`,
    new Vector3(coreX, p.foundationHeight + coreHeight * 0.5, coreZ),
    coreW, coreHeight, coreD);
  for (let i = 0; i < p.galleryLevels.length; i++) {
    // Keep window panels on the field-facing surface, not floating inside it.
    const y = p.galleryLevels[i] + 1.35;
    if (y + 0.8 >= p.towerRoofY) continue;
    box(scene, parts, "dark", `${t.label}_coreWindow_${i}`,
      new Vector3(coreX, y, coreZ + coreD * 0.5 + 0.012),
      1.75, 1.46, 0.055);
    box(scene, parts, "steel", `${t.label}_coreWindowSill_${i}`,
      new Vector3(coreX, y - 0.82, coreZ + coreD * 0.5 + 0.095),
      2.05, 0.09, 0.1);
  }
  // Dark back spandrels help distinguish gallery voids at night.
  for (let i = 0; i < p.galleryLevels.length - 1; i++) {
    const bottom = p.galleryLevels[i] + 0.3;
    const height = p.galleryLevels[i + 1] - p.galleryLevels[i] - 0.65;
    box(scene, parts, "dark", `${t.label}_rearRecess_${i}`,
      new Vector3(t.cx - t.side * 2.0, bottom + height * 0.5, t.farZ + 0.53),
      p.towerWidth - 5.6, height, 0.13);
  }

  const xMin = t.cx - t.halfW + 0.38;
  const xMax = t.cx + t.halfW - 0.38;
  const zMin = t.farZ + 0.42;
  const zMax = t.nearZ - 0.42;
  const innerFaceX = t.innerX - t.side * 0.37;

  for (let i = 0; i < p.galleryLevels.length; i++) {
    const floorY = p.galleryLevels[i];
    box(scene, parts, "floors", `${t.label}_gallery_${i}`,
      new Vector3(t.cx, floorY, t.cz),
      p.towerWidth + 0.56, p.floorThickness, p.towerDepth + 0.56);
    // Perimeter beams are below the slab; these are not extra seating steps.
    for (const z of [t.nearZ - 0.45, t.farZ + 0.45]) {
      box(scene, parts, "structure", `${t.label}_floorCrossBeam_${i}_${z}`,
        new Vector3(t.cx, floorY - 0.38, z),
        p.towerWidth - 0.72, 0.56, 0.36);
    }
    for (const x of [t.innerX + t.side * 0.46, t.outerX - t.side * 0.46]) {
      box(scene, parts, "structure", `${t.label}_floorLongBeam_${i}_${x}`,
        new Vector3(x, floorY - 0.38, t.cz),
        0.36, 0.56, p.towerDepth - 0.72);
    }

    // Only floors 1 and 2 have elevated footbridges; the openings in the
    // facade rail MUST correspond to their actual landing coordinates.
    const frontBridge = bridges.find(b => b.face === "front" && Math.abs(b.y - floorY) < 0.01);
    const backBridge = bridges.find(b => b.face === "inner" && Math.abs(b.y - floorY) < 0.01);
    const frontGap = frontBridge ? frontBridge.width + 0.48 : 0;
    const innerGap = backBridge ? backBridge.width + 0.42 : 0;
    for (const [j, [a, b]] of cutSegments(
      xMin, xMax, frontBridge ? frontBridge.to.x : null, frontGap).entries()) {
      fenceX(scene, parts, `${t.label}_frontRailing_${i}_${j}`,
        a, b, t.nearZ + 0.41, floorY + p.floorThickness * 0.5, mobile);
    }
    for (const [j, [a, b]] of cutSegments(
      zMin, zMax, backBridge ? backBridge.from.z : null, innerGap).entries()) {
      fenceZ(scene, parts, `${t.label}_innerRailing_${i}_${j}`,
        a, b, innerFaceX, floorY + p.floorThickness * 0.5, mobile);
    }
    // Exterior return remains guarded around the solid stair/service core.
    if (!mobile) {
      fenceZ(scene, parts, `${t.label}_outerRailing_${i}`,
        t.nearZ - 3.1, t.nearZ - 0.5,
        t.outerX - t.side * 0.44, floorY + p.floorThickness * 0.5, mobile);
    }
  }

  // Internal (visual-only) half-flights imply circulation between floors.
  // All treads stay within the pavilion envelope and share the same structure.
  if (!mobile) {
    const innerStairX = t.cx - t.side * (t.halfW - 2.35);
    for (let i = 0; i < p.galleryLevels.length - 1; i++) {
      const y0 = p.galleryLevels[i] + 0.40;
      const y1 = p.galleryLevels[i + 1] - 0.32;
      const steps = 7;
      for (let k = 0; k < steps; k++) {
        const frac = (k + 0.5) / steps;
        box(scene, parts, "floors", `${t.label}_internalStair_${i}_${k}`,
          new Vector3(innerStairX, y0 + frac * (y1 - y0),
            t.nearZ - 2.05 - frac * 6.2),
          1.72, 0.15, 0.93);
      }
    }
  }

  box(scene, parts, "structure", `${t.label}_roof`,
    new Vector3(t.cx, p.towerRoofY, t.cz),
    p.towerWidth + 1.1, 0.52, p.towerDepth + 1.1);
  for (const bridge of bridges) guardedBridge(scene, parts, bridge, mobile);

  // Continuity of the existing middle-level LED strips, but no extra beams
  // cutting through the audience or the stadium's playfield.
  const lowerSideX = RINA_STADIUM.pitchWidth * 0.5 +
    RINA_DOUBLE_TIER_PROFILE.fieldMargin +
    RINA_DOUBLE_TIER_PROFILE.lowerRows * RINA_DOUBLE_TIER_PROFILE.lowerTread +
    RINA_DOUBLE_TIER_PROFILE.zCurve;
  span(scene, parts, "trim", `${t.label}_sideRibbon`,
    { x: t.side * (lowerSideX - 0.16), z: p.sideEndZ + 0.2 },
    { x: t.cx + t.side * 2.1, z: t.nearZ + 0.10 }, 8.55, 0.10, 0.1);
}

function localMaterial(scene: Scene, name: string, diffuse: Color3, glow: Color3) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = diffuse;
  material.emissiveColor = glow;
  material.specularColor = new Color3(0.025, 0.03, 0.035);
  material.specularPower = 38;
  return material;
}

function mergeGroup(name: string, meshes: Mesh[], material: Material): Mesh | null {
  if (!meshes.length) return null;
  for (const item of meshes) item.computeWorldMatrix(true);
  const merged = meshes.length === 1 ? meshes[0] :
    Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
  if (!merged) throw new Error(`Failed to merge Rina corner group: ${name}`);
  merged.name = name;
  merged.material = material;
  merged.isPickable = false;
  merged.checkCollisions = false;
  merged.receiveShadows = false;
  return merged;
}

export function createRinaStadiumCornerConnectors(
  scene: Scene, options: RinaStadiumCornerOptions
): RinaStadiumCornerHandle {
  const p = RINA_CORNER_PAVILION_PROFILE;
  const stageEnd = options.end === "stage";
  const prefix = stageEnd ? "rinaStageCornerV3" : "rinaCornerV3";
  if (p.towerCenterAbsX - p.towerWidth * 0.5 <
      RINA_STADIUM.pitchWidth * 0.5 + p.pitchSafetyMargin ||
      p.towerCenterZ + p.towerDepth * 0.5 > -RINA_STADIUM.pitchLength * 0.5) {
    throw new Error("Rina corner tower would intrude into the playable field");
  }
  const parts: Groups = { structure: [], floors: [], steel: [], dark: [], trim: [] };
  const mobile = options.performanceTier === "mobile";
  for (const side of [-1, 1] as const) createPavilion(scene, parts, side, mobile);

  const frame = localMaterial(scene, `${prefix}ConcreteStructure`,
    new Color3(0.14, 0.15, 0.17), new Color3(0.018, 0.020, 0.027));
  const slabs = localMaterial(scene, `${prefix}FloorMaterial`,
    new Color3(0.17, 0.18, 0.20), new Color3(0.019, 0.022, 0.029));
  const steel = localMaterial(scene, `${prefix}Steel`,
    new Color3(0.19, 0.21, 0.23), new Color3(0.026, 0.030, 0.035));
  const dark = localMaterial(scene, `${prefix}Recess`,
    new Color3(0.018, 0.021, 0.029), new Color3(0.006, 0.008, 0.013));
  const ownMaterials = [frame, slabs, steel, dark];
  const groups = [
    mergeGroup(`${prefix}_LoadBearingFrame`, parts.structure, frame),
    mergeGroup(`${prefix}_BalconiesAndBridges`, parts.floors, slabs),
    mergeGroup(`${prefix}_RailsAndBracing`, parts.steel, steel),
    mergeGroup(`${prefix}_CoreWindows`, parts.dark, dark),
    mergeGroup(`${prefix}_LEDTrim`, parts.trim, options.materials.ledRibbon),
  ].filter((mesh): mesh is Mesh => mesh !== null);
  if (stageEnd) {
    // Merged source geometry is already in local stadium coordinates. Reflect
    // its transform across the pitch centre so tower and bridge endpoints stay
    // aligned with the +Z ends of the two existing side stands.
    for (const mesh of groups) {
      mesh.position.z *= -1;
      mesh.scaling.z *= -1;
      mesh.computeWorldMatrix(true);
    }
  }
  let disposed = false;
  return {
    meshes: groups,
    setEnabled(enabled: boolean) {
      if (!disposed) for (const mesh of groups) mesh.setEnabled(enabled);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of groups) if (!mesh.isDisposed()) mesh.dispose();
      for (const material of ownMaterials) material.dispose();
    },
  };
}
