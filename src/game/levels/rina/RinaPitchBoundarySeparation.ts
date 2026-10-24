import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_STADIUM } from "./RinaLevelConfig";
import { RINA_DOUBLE_TIER_PROFILE } from "./RinaDoubleTierSideStands";
import { RINA_BACK_STAND_LED_PROFILE } from "./RinaBackStandExit";

/**
 * UPDATE 01 — Visual pitch/stand separation.
 *
 * Coordinates are LOCAL to rinaStadiumRoot. createRinaLevel.ts subsequently
 * scales that root by RINA_STADIUM_SCALE (currently 1.5).
 * NEVER apply that scale here and NEVER parent these meshes yourself.
 *
 * The existing RinaStadiumWorld decides all gameplay collisions and navigation.
 * All geometry created by this helper is decorative and non-pickable.
 */
export const RINA_PITCH_BOUNDARY_PROFILE = {
  // Stay beyond the football pitch and outside the current player collider.
  pitchMargin: 0.36,
  // Decorative work ends short of the north stage and south corner connection.
  zStart: -49,
  zEnd: 30,
  // The side stand's first seat starts 3.7 units outside the pitch.
  clearanceToFirstSeat: 0.19,
  // Small concrete field-side curb. Height before the stadium's 1.5x scale.
  curbWidth: 0.33,
  curbHeight: 0.34,
  laneThickness: 0.12,
  outerKerbWidth: 0.23,
  outerKerbHeight: 0.18,
  // Rail is lower than the player eye line after world scaling.
  railTopY: 1.03,
  railMiddleY: 0.73,
  railPostBottomY: 0.35,
  railPostDiameter: 0.065,
  // Number of visible service access pavement markings (not walkable).
  markerInterval: 11.5,
  desktopSegments: 18,
  mobileSegments: 10,
  desktopPostInterval: 4.4,
  mobilePostInterval: 6.4,
} as const;

export const RINA_REAR_APRON_PROFILE = {
  standFrontZ: RINA_BACK_STAND_LED_PROFILE.rearZ - 3 +
    RINA_BACK_STAND_LED_PROFILE.lowerRowDepth * 0.5,
  fieldOverlapZ: -RINA_STADIUM.pitchLength * 0.5 + 0.65,
  railZ: -RINA_STADIUM.pitchLength * 0.5 - 0.2,
  halfWidth: RINA_STADIUM.pitchWidth * 0.5 +
    RINA_DOUBLE_TIER_PROFILE.fieldMargin + RINA_DOUBLE_TIER_PROFILE.zCurve,
  exitOpeningHalfWidth: RINA_BACK_STAND_LED_PROFILE.openingHalfWidth,
} as const;

export interface RinaPitchBoundaryMaterials {
  concrete: Material;
  darkConcrete: Material;
  aisle: Material;
  ledRibbon: Material;
}

export interface RinaPitchBoundaryHandle {
  readonly meshes: readonly Mesh[];
  /** Remove only this module's geometry. Does not touch shared materials. */
  dispose(): void;
  setEnabled(enabled: boolean): void;
}

type Assembly = {
  lane: Mesh[];
  curb: Mesh[];
  kerb: Mesh[];
  rails: Mesh[];
  brightRail: Mesh[];
  markers: Mesh[];
};

function createPart(
  scene: Scene,
  items: Mesh[],
  name: string,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number
) {
  if (width <= 0 || height <= 0 || depth <= 0) {
    throw new Error(`Invalid pitch-boundary dimension: ${name}`);
  }
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position.set(x, y, z);
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  items.push(mesh);
  return mesh;
}

function createLocalMaterial(
  scene: Scene,
  name: string,
  diffuse: Color3,
  emissive: Color3
) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = diffuse;
  material.emissiveColor = emissive;
  material.specularColor = new Color3(0.025, 0.028, 0.03);
  return material;
}

/** Matches RinaDoubleTierSideStands.ts without moving its existing steps. */
function standCurve(z: number) {
  const halfLength = RINA_DOUBLE_TIER_PROFILE.length * 0.5;
  const normalized = Math.max(-1, Math.min(1, z / halfLength));
  return RINA_DOUBLE_TIER_PROFILE.zCurve * normalized * normalized;
}

/** First stand row's near edge in local positive X coordinates. */
function standNearEdge(z: number) {
  return RINA_STADIUM.pitchWidth * 0.5 +
    RINA_DOUBLE_TIER_PROFILE.fieldMargin + standCurve(z);
}

function mergeParts(name: string, pieces: Mesh[], material: Material) {
  if (pieces.length === 0) return null;
  const merged = pieces.length === 1
    ? pieces[0]
    : Mesh.MergeMeshes(pieces, true, true, undefined, false, false);
  if (!merged) throw new Error(`Could not merge pitch-boundary geometry: ${name}`);
  merged.name = name;
  merged.material = material;
  merged.isPickable = false;
  merged.checkCollisions = false;
  merged.receiveShadows = false;
  return merged;
}

/**
 * Adds a slim technical/service strip between the field and the *side* lower
 * stands, a continuous low curb and light metal spectator railings.
 *
 * This is a VISUAL-ONLY update: no collisions, no picking, no agent AI, no
 * gameplay surface, no point lights and no additional texture assets.
 *
 * Geometry remains unparented so createRinaLevel.ts automatically attaches
 * it to the already-existing `rinaStadiumRoot` with the rest of the scenery.
 */
export function createRinaPitchBoundarySeparation(
  scene: Scene,
  performanceTier: "desktop" | "mobile",
  materials: RinaPitchBoundaryMaterials
): RinaPitchBoundaryHandle {
  const p = RINA_PITCH_BOUNDARY_PROFILE;
  const halfPitch = RINA_STADIUM.pitchWidth * 0.5;
  const innerEdge = halfPitch + p.pitchMargin;
  const laneInner = innerEdge + p.curbWidth * 0.48;
  const totalLength = p.zEnd - p.zStart;
  const segments = performanceTier === "desktop"
    ? p.desktopSegments : p.mobileSegments;
  const postInterval = performanceTier === "desktop"
    ? p.desktopPostInterval : p.mobilePostInterval;

  const metal = createLocalMaterial(
    scene, "rinaBoundaryMetal",
    new Color3(0.25, 0.28, 0.31),
    new Color3(0.038, 0.043, 0.05)
  );
  const handrail = createLocalMaterial(
    scene, "rinaBoundaryHandrail",
    new Color3(0.39, 0.43, 0.46),
    new Color3(0.063, 0.071, 0.077)
  );
  const serviceFloor = createLocalMaterial(
    scene, "rinaBoundaryServiceFloor",
    new Color3(0.11, 0.13, 0.15),
    new Color3(0.010, 0.014, 0.019)
  );
  const assembly: Assembly = {
    lane: [], curb: [], kerb: [], rails: [], brightRail: [], markers: []
  };

  for (const side of [-1, 1] as const) {
    // The lane follows the slight stadium stand curve while the pitch-side
    // curb remains straight. Short segments avoid costly custom tessellation.
    const segmentLength = totalLength / segments;
    for (let i = 0; i < segments; i++) {
      const z = p.zStart + (i + 0.5) * segmentLength;
      const outerEdge = standNearEdge(z) - p.clearanceToFirstSeat;
      const width = outerEdge - laneInner;
      createPart(
        scene, assembly.lane, `rinaBoundaryLane_${side}_${i}`,
        width + 0.055, p.laneThickness, segmentLength + 0.035,
        side * (laneInner + outerEdge) * 0.5,
        p.laneThickness * 0.5 + 0.014, z
      );
      createPart(
        scene, assembly.kerb, `rinaBoundaryOuterKerb_${side}_${i}`,
        p.outerKerbWidth, p.outerKerbHeight, segmentLength + 0.038,
        side * (outerEdge - p.outerKerbWidth * 0.5),
        p.outerKerbHeight * 0.5 + 0.015, z
      );
    }

    // Concrete plinth separates turf from the service area without creating
    // physical collisions or adding any wall within the field dimensions.
    createPart(
      scene, assembly.curb, `rinaBoundaryFrontPlinth_${side}`,
      p.curbWidth, p.curbHeight, totalLength,
      side * innerEdge, p.curbHeight * 0.5 + 0.01,
      (p.zStart + p.zEnd) * 0.5
    );

    // Two thin steel rails (not an opaque wall) keep stadium and player views
    // open. A slightly brighter top cap makes them readable in night lighting.
    const railX = side * innerEdge;
    for (const [suffix, y, array, thickness] of [
      ["mid", p.railMiddleY, assembly.rails, 0.045],
      ["top", p.railTopY, assembly.brightRail, 0.062],
    ] as const) {
      createPart(
        scene, array, `rinaBoundaryRail_${suffix}_${side}`,
        thickness, thickness, totalLength,
        railX, y, (p.zStart + p.zEnd) * 0.5
      );
    }
    const numberOfPosts = Math.ceil(totalLength / postInterval);
    for (let n = 0; n <= numberOfPosts; n++) {
      const z = p.zStart + (n / numberOfPosts) * totalLength;
      const height = p.railTopY - p.railPostBottomY;
      createPart(
        scene, assembly.rails, `rinaBoundaryPost_${side}_${n}`,
        p.railPostDiameter, height, p.railPostDiameter,
        railX, p.railPostBottomY + height * 0.5, z
      );
    }

    // Sparse, subdued aisle markers — no point lights or lightmaps required.
    const markerCount = Math.floor(totalLength / p.markerInterval);
    for (let j = 0; j < markerCount; j++) {
      const z = p.zStart + (j + 0.5) * p.markerInterval;
      createPart(
        scene, assembly.markers, `rinaBoundaryMarker_${side}_${j}`,
        0.42, 0.025, 0.22,
        side * (innerEdge + 1.5), 0.154, z
      );
    }
  }

  // The rear lower rows begin beyond the pitch end. A low service apron fills
  // that gap and overlaps the grass slightly so no dark seam remains visible.
  const rear = RINA_REAR_APRON_PROFILE;
  const apronStart = rear.standFrontZ - 0.24;
  const apronDepth = rear.fieldOverlapZ - apronStart;
  createPart(scene, assembly.lane, "rinaRearApronFloor",
    rear.halfWidth * 2, p.laneThickness, apronDepth,
    0, p.laneThickness * 0.5 + 0.014,
    (apronStart + rear.fieldOverlapZ) * 0.5);

  // Same curb, paired steel rails and post rhythm as the lateral plateas.
  // The central opening aligns with the existing walkable exit tunnel.
  const rearRailX = innerEdge;
  const rearSpan = rearRailX - rear.exitOpeningHalfWidth;
  const returnLength = p.zStart - rear.railZ;
  for (const side of [-1, 1] as const) {
    createPart(scene, assembly.lane, `rinaRearApronCornerFloor_${side}`,
      rear.halfWidth - innerEdge + 0.12, p.laneThickness,
      p.zStart - rear.fieldOverlapZ + 0.24,
      side * (innerEdge + rear.halfWidth) * 0.5,
      p.laneThickness * 0.5 + 0.014,
      (rear.fieldOverlapZ + p.zStart) * 0.5);
    const centerX = side * (rearRailX + rear.exitOpeningHalfWidth) * 0.5;
    createPart(scene, assembly.curb, `rinaRearApronCurb_${side}`,
      rearSpan, p.curbHeight, p.curbWidth,
      centerX, p.curbHeight * 0.5 + 0.01, rear.railZ);
    createPart(scene, assembly.curb, `rinaRearApronReturnCurb_${side}`,
      p.curbWidth, p.curbHeight, returnLength,
      side * rearRailX, p.curbHeight * 0.5 + 0.01,
      (rear.railZ + p.zStart) * 0.5);
    for (const [suffix, y, array, thickness] of [
      ["mid", p.railMiddleY, assembly.rails, 0.045],
      ["top", p.railTopY, assembly.brightRail, 0.062],
    ] as const) {
      createPart(scene, array, `rinaRearApronRail_${suffix}_${side}`,
        rearSpan, thickness, thickness,
        centerX, y, rear.railZ);
      createPart(scene, array, `rinaRearApronReturnRail_${suffix}_${side}`,
        thickness, thickness, returnLength,
        side * rearRailX, y, (rear.railZ + p.zStart) * 0.5);
    }
    const postCount = Math.ceil(rearSpan / postInterval);
    for (let n = 0; n <= postCount; n++) {
      const x = side * (rear.exitOpeningHalfWidth + n * rearSpan / postCount);
      const height = p.railTopY - p.railPostBottomY;
      createPart(scene, assembly.rails, `rinaRearApronPost_${side}_${n}`,
        p.railPostDiameter, height, p.railPostDiameter,
        x, p.railPostBottomY + height * 0.5, rear.railZ);
    }
  }

  const merged = [
    mergeParts("rinaBoundary_ServiceLane", assembly.lane, serviceFloor),
    mergeParts("rinaBoundary_FieldCurb", assembly.curb, materials.darkConcrete),
    mergeParts("rinaBoundary_StandKerb", assembly.kerb, materials.concrete),
    mergeParts("rinaBoundary_RailPosts", assembly.rails, metal),
    mergeParts("rinaBoundary_TopHandrail", assembly.brightRail, handrail),
    mergeParts("rinaBoundary_AisleMarkers", assembly.markers, materials.ledRibbon),
  ].filter((mesh): mesh is Mesh => mesh !== null);

  return {
    meshes: merged,
    setEnabled(enabled: boolean) {
      for (const mesh of merged) if (!mesh.isDisposed()) mesh.setEnabled(enabled);
    },
    dispose() {
      for (const mesh of merged) if (!mesh.isDisposed()) mesh.dispose();
      serviceFloor.dispose();
      handrail.dispose();
      metal.dispose();
      // IMPORTANT: never dispose shared materials from RinaStadiumGeometry.
    },
  };
}
