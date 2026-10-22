import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_STADIUM } from "./RinaLevelConfig";
import { RINA_DOUBLE_TIER_PROFILE } from "./RinaDoubleTierSideStands";

/**
 * UPDATE 03 (corrected) — architectural corner pavilions inspired by stadium
 * circulation towers, NOT extra stepped seating. Each pavilion visually joins
 * the rear end of a side stand to the rear stand with galleries and walkways.
 *
 * All positions are in local stadium coordinates. RinaLevel's stadiumRoot
 * applies RINA_STADIUM_SCALE exactly once. Never scale or parent here.
 * These are scenic meshes: no picking, collisions, AI, or navigation.
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
}

export interface RinaStadiumCornerHandle {
  readonly meshes: readonly Mesh[];
  /** Useful to temporarily hide the update when comparing before/after. */
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** Geometry contract measured against the current side/rear stand sources. */
export const RINA_CORNER_PAVILION_PROFILE = {
  /** Rear end of RinaDoubleTierSideStands, before 1.5x stadium scaling. */
  sideEndZ: -RINA_DOUBLE_TIER_PROFILE.length * 0.5,
  /** RinaBackStandExit's first lower-row center is z=-64. */
  backLowerFrontZ: -(RINA_STADIUM.pitchLength * 0.5 + 8.5 + 3.0),
  /** RinaBackStandExit's front upper-row center is z≈-81.45. */
  backUpperFrontZ: -(RINA_STADIUM.pitchLength * 0.5 + 8.5 + 9 * 1.65 + 3.25 + 2.35),
  towerCenterAbsX: RINA_STADIUM.pitchWidth * 0.5 + 15.7,
  towerCenterZ: -(RINA_STADIUM.pitchLength * 0.5 + 16.0),
  towerWidth: 14.4,
  towerDepth: 12.5,
  foundationHeight: 1.9,
  towerRoofY: 25.7,
  /** Gallery floors pair with actual side / rear stand levels. */
  galleryLevels: [4.2, 8.3, 12.48, 16.7, 20.95] as readonly number[],
  pitchSafetyMargin: 2.0,
} as const;

type BuildingParts = {
  structure: Mesh[];
  slab: Mesh[];
  rail: Mesh[];
  recess: Mesh[];
  trim: Mesh[];
};
type GroupKey = keyof BuildingParts;

type PlanPoint = { x: number; z: number };

function createMaterial(scene: Scene, name: string, diffuse: Color3, glow: Color3) {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = diffuse;
  result.emissiveColor = glow;
  result.specularColor = new Color3(0.035, 0.04, 0.045);
  result.specularPower = 40;
  return result;
}

function addBox(
  scene: Scene, parts: BuildingParts, group: GroupKey, name: string,
  x: number, y: number, z: number,
  width: number, height: number, depth: number, yaw = 0
): Mesh {
  if (!(width > 0 && height > 0 && depth > 0)) {
    throw new Error(`Invalid stadium corner part: ${name}`);
  }
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  parts[group].push(mesh);
  return mesh;
}

/** Beam/bridge axis follows horizontal displacement; not giant stair blocks. */
function addSpan(
  scene: Scene, parts: BuildingParts, group: GroupKey, name: string,
  from: PlanPoint, to: PlanPoint, y: number,
  width: number, height: number
) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return;
  // A local +Z beam rotated about Y follows (dx,dz).
  const yaw = Math.atan2(dx, dz);
  addBox(scene, parts, group, name,
    (from.x + to.x) * 0.5, y, (from.z + to.z) * 0.5,
    width, height, length + 0.28, yaw);
}

/** Thin elevated connections with guards; no people, navmesh or collision. */
function addGuardedBridge(
  scene: Scene, parts: BuildingParts, name: string,
  from: PlanPoint, to: PlanPoint, y: number,
  width: number, mobile: boolean
) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.15) return;
  addSpan(scene, parts, "slab", `${name}_Deck`, from, to, y, width, 0.26);
  const perpX = -dz / length;
  const perpZ = dx / length;
  for (const sign of [-1, 1]) {
    const offset = width * 0.5 - 0.15;
    const a = { x: from.x + sign * perpX * offset,
                z: from.z + sign * perpZ * offset };
    const b = { x: to.x + sign * perpX * offset,
                z: to.z + sign * perpZ * offset };
    addSpan(scene, parts, "rail", `${name}_Guard_${sign}`,
      a, b, y + 0.84, 0.075, 0.075);
    const posts = mobile ? 2 : Math.max(2, Math.ceil(length / 3.8));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      addBox(scene, parts, "rail", `${name}_Post_${sign}_${i}`,
        a.x + (b.x - a.x) * t, y + 0.43,
        a.z + (b.z - a.z) * t, 0.075, 0.84, 0.075);
    }
  }
}

function createPavilion(
  scene: Scene, parts: BuildingParts, side: -1 | 1,
  mobile: boolean
) {
  const p = RINA_CORNER_PAVILION_PROFILE;
  const cx = side * p.towerCenterAbsX;
  const cz = p.towerCenterZ;
  const hw = p.towerWidth * 0.5;
  const hd = p.towerDepth * 0.5;
  const nearZ = cz + hd;
  const farZ = cz - hd;
  const innerX = side * (p.towerCenterAbsX - hw);
  const outerX = side * (p.towerCenterAbsX + hw);
  const label = side === -1 ? "West" : "East";

  // Main visual-language reference: four open structural faces, stacked
  // galleries, and a service core rather than a solid seating wedge.
  addBox(scene, parts, "structure", `${label}_Foundation`,
    cx, p.foundationHeight * 0.5, cz,
    p.towerWidth + 0.35, p.foundationHeight, p.towerDepth + 0.35);
  addBox(scene, parts, "recess", `${label}_InnerDarkCore`,
    cx + side * 0.8, 14.0, farZ + 0.56,
    p.towerWidth - 2.1, 22.0, 0.18);
  addBox(scene, parts, "recess", `${label}_OuterDarkCore`,
    outerX - side * 0.33, 14.0, cz,
    0.18, 22.0, p.towerDepth - 1.5);

  // Corner columns are uninterrupted structural supports (no stairs).
  for (const ix of [-1, 1]) for (const iz of [-1, 1]) {
    addBox(scene, parts, "structure", `${label}_Column_${ix}_${iz}`,
      cx + ix * (hw - 0.33), (p.towerRoofY + p.foundationHeight) * 0.5,
      cz + iz * (hd - 0.33),
      0.62, p.towerRoofY - p.foundationHeight, 0.62);
  }
  // Recessed front mullions keep the facade recognisable from the pitch.
  for (const frac of [-0.34, 0.34]) {
    addBox(scene, parts, "structure", `${label}_FrontMullion_${frac}`,
      cx + frac * p.towerWidth, (p.towerRoofY + p.foundationHeight) * 0.5,
      nearZ - 0.2,
      0.28, p.towerRoofY - p.foundationHeight, 0.3);
  }
  if (!mobile) {
    for (const frac of [-0.30, 0.30]) {
      addBox(scene, parts, "structure", `${label}_InnerMullion_${frac}`,
        innerX + side * 0.18, (p.towerRoofY + p.foundationHeight) * 0.5,
        cz + frac * p.towerDepth,
        0.27, p.towerRoofY - p.foundationHeight, 0.27);
    }
  }

  // Horizontal floor slabs: open balconies between them, just like the
  // corners of the reference football stadium. Side/rear deck elevations are
  // deliberately different — the pavilion is the change of level.
  for (let i = 0; i < p.galleryLevels.length; i++) {
    const y = p.galleryLevels[i];
    addBox(scene, parts, "slab", `${label}_OpenGallery_${i}`,
      cx, y, cz, p.towerWidth + 0.75, 0.46, p.towerDepth + 0.75);
    // Visible balcony extension toward the field (positive Z).
    addBox(scene, parts, "slab", `${label}_BalconyNose_${i}`,
      cx, y + 0.05, nearZ + 0.30,
      p.towerWidth - 0.5, 0.25, 0.99);
    if (i < p.galleryLevels.length - 1) {
      addBox(scene, parts, "rail", `${label}_FrontGuard_${i}`,
        cx, y + 0.82, nearZ + 0.78,
        p.towerWidth - 0.7, 0.07, 0.065);
      addBox(scene, parts, "rail", `${label}_InnerGuard_${i}`,
        innerX - side * 0.08, y + 0.82, cz,
        0.065, 0.07, p.towerDepth - 0.4);
      const guardPosts = mobile ? [-0.35, 0.35] : [-0.40, -0.13, 0.13, 0.40];
      for (const frac of guardPosts) {
        addBox(scene, parts, "rail", `${label}_GuardPost_${i}_${frac}`,
          cx + frac * p.towerWidth, y + 0.48, nearZ + 0.78,
          0.065, 0.71, 0.065);
      }
    }
  }

  // Crown is a flat structural roof, not an impossible row of seats.
  addBox(scene, parts, "structure", `${label}_RoofFascia`,
    cx, p.towerRoofY + 0.23, cz,
    p.towerWidth + 1.15, 0.46, p.towerDepth + 1.15);

  // Shadowed real-looking facade panels with very soft reflected concert color.
  for (let i = 0; i < p.galleryLevels.length - 1; i++) {
    const y = (p.galleryLevels[i] + p.galleryLevels[i + 1]) * 0.5;
    addBox(scene, parts, "recess", `${label}_DarkInterior_${i}`,
      cx, y, farZ + 0.75, p.towerWidth - 1.8,
      Math.max(0.8, p.galleryLevels[i + 1] - p.galleryLevels[i] - 0.9), 0.1);
  }

  // MID-LEVEL BRIDGES. Side grandstand ends at z=-56; rear stand begins
  // approximately z=-64 (low) and -81 (upper). The pavilion spans that gap.
  const sideProfile = RINA_DOUBLE_TIER_PROFILE;
  const curvedOffset = sideProfile.zCurve;
  const lowerEndX = RINA_STADIUM.pitchWidth * 0.5 + sideProfile.fieldMargin +
    sideProfile.lowerRows * sideProfile.lowerTread + curvedOffset;
  const upperStartX = lowerEndX + sideProfile.concourseDepth;

  // 1) Side middle concourse (Y≈8.25) to the pavilion's matching floor.
  addGuardedBridge(scene, parts, `${label}_SideConcourse`,
    { x: side * lowerEndX, z: p.sideEndZ + 0.38 },
    { x: side * (p.towerCenterAbsX + 2.1), z: nearZ + 0.08 },
    8.3, 2.65, mobile);

  // 2) Rear concourse connects at z≈-77.3, INSIDE its current X extent
  // (half-width = 44.5 with the updated 80-unit pitch).
  addGuardedBridge(scene, parts, `${label}_RearConcourse`,
    { x: side * (p.towerCenterAbsX - hw + 0.48), z: farZ + 1.1 },
    { x: side * (RINA_STADIUM.pitchWidth * 0.5 + 3.9), z: p.backLowerFrontZ - 13.2 },
    8.3, 2.45, mobile);

  // 3) Side upper row / concourse, Y≈12.48, not at the higher crown.
  addGuardedBridge(scene, parts, `${label}_SideUpper`,
    { x: side * (upperStartX + 2.0), z: p.sideEndZ + 0.38 },
    { x: side * (p.towerCenterAbsX + 3.75), z: nearZ + 0.10 },
    12.48, 2.3, mobile);

  // 4) Rear upper: connect to the existing fourth row (Y≈12.55),
  // rather than leaving a bridge hanging in front of the stand facade.
  addGuardedBridge(scene, parts, `${label}_RearUpper`,
    { x: side * (p.towerCenterAbsX - hw + 0.40), z: farZ + 0.85 },
    { x: side * (RINA_STADIUM.pitchWidth * 0.5 + 2.15), z: p.backUpperFrontZ - 4 * 1.55 },
    12.48, 2.2, mobile);


  // Diagonal retaining wall ONLY at field-side low corner: short and thin,
  // never protruding inside the rectangle of the playable pitch.
  addSpan(scene, parts, "structure", `${label}_LowCornerFace`,
    { x: side * (RINA_STADIUM.pitchWidth * 0.5 + sideProfile.fieldMargin +
       curvedOffset + 0.25), z: p.sideEndZ - 0.20 },
    { x: side * (p.towerCenterAbsX - hw + 0.20), z: nearZ + 0.15 },
    1.65, 0.38, 2.0);

  // Small visual fascia continuations along side/back concourse.
  addSpan(scene, parts, "trim", `${label}_SideLEDContinuation`,
    { x: side * (lowerEndX - 0.16), z: p.sideEndZ + 0.20 },
    { x: side * (p.towerCenterAbsX + 2.1), z: nearZ + 0.10 },
    8.52, 0.08, 0.11);
  addSpan(scene, parts, "trim", `${label}_BackLEDContinuation`,
    { x: innerX + side * 0.35, z: farZ - 0.10 },
    { x: side * (RINA_STADIUM.pitchWidth * 0.5 + 3.9), z: p.backLowerFrontZ - 13.2 },
    8.52, 0.08, 0.11);
}

function mergeGroup(name: string, parts: Mesh[], material: Material) {
  if (!parts.length) return null;
  for (const part of parts) part.computeWorldMatrix(true);
  const mesh = parts.length === 1
    ? parts[0]
    : Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!mesh) throw new Error(`Rina corner module could not merge ${name}`);
  mesh.name = name;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  return mesh;
}

/**
 * Construct both rear corner pavilions. Never call in addition to the broken
 * earlier version — REPLACE the file and keep only one integration call.
 * Nothing is parented: RinaStadiumGeometry runs before stadiumRoot is created,
 * so createRinaLevel.ts automatically parents these meshes to stadiumRoot.
 */
export function createRinaStadiumCornerConnectors(
  scene: Scene,
  options: RinaStadiumCornerOptions
): RinaStadiumCornerHandle {
  const p = RINA_CORNER_PAVILION_PROFILE;
  if (p.towerCenterAbsX - p.towerWidth * 0.5 <
      RINA_STADIUM.pitchWidth * 0.5 + p.pitchSafetyMargin) {
    throw new Error("Rina corner pavilion would intrude into the pitch");
  }
  if (p.towerCenterZ + p.towerDepth * 0.5 > -RINA_STADIUM.pitchLength * 0.5) {
    throw new Error("Rina corner pavilion would intrude into the pitch endline");
  }

  const parts: BuildingParts = {
    structure: [], slab: [], rail: [], recess: [], trim: []
  };
  const isMobile = options.performanceTier === "mobile";
  for (const side of [-1, 1] as const) {
    createPavilion(scene, parts, side, isMobile);
  }

  // Intentionally modest and readable in the concert night lighting.
  const frameConcrete = createMaterial(scene, "rinaCornerConcreteFrame",
    new Color3(0.15, 0.16, 0.18), new Color3(0.019, 0.022, 0.03));
  const balconyConcrete = createMaterial(scene, "rinaCornerBalconyConcrete",
    new Color3(0.18, 0.19, 0.21), new Color3(0.020, 0.023, 0.029));
  const steel = createMaterial(scene, "rinaCornerSteel",
    new Color3(0.19, 0.21, 0.23), new Color3(0.027, 0.030, 0.035));
  const darkInterior = createMaterial(scene, "rinaCornerDarkInterior",
    new Color3(0.022, 0.025, 0.033), new Color3(0.007, 0.009, 0.016));
  const ownedMaterials = [frameConcrete, balconyConcrete, steel, darkInterior];
  const grouped = [
    mergeGroup("rinaCornerV2_ConcreteStructure", parts.structure, frameConcrete),
    mergeGroup("rinaCornerV2_FloorsAndBalconies", parts.slab, balconyConcrete),
    mergeGroup("rinaCornerV2_Balustrades", parts.rail, steel),
    mergeGroup("rinaCornerV2_RecessedBays", parts.recess, darkInterior),
    mergeGroup("rinaCornerV2_Trim", parts.trim, options.materials.ledRibbon),
  ].filter((mesh): mesh is Mesh => mesh !== null);

  let disposed = false;
  return {
    meshes: grouped,
    setEnabled(enabled: boolean) {
      if (!disposed) for (const mesh of grouped) mesh.setEnabled(enabled);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of grouped) if (!mesh.isDisposed()) mesh.dispose();
      for (const material of ownedMaterials) material.dispose();
      // Shared materials are owned by RinaStadiumGeometry / the Scene.
    },
  };
}
