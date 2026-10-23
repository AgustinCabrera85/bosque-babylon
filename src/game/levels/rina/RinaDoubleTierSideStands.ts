import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_STADIUM } from "./RinaLevelConfig";

/**
 * Side stands are visual scenery only. Their coordinates are local stadium
 * coordinates. createRinaLevel.ts parents the meshes to rinaStadiumRoot, whose
 * world scale is RINA_STADIUM_SCALE. Never multiply by that scale here.
 *
 * No side-stand mesh has collision, pickability, AI, or gameplay surfaces.
 */
export const RINA_DOUBLE_TIER_PROFILE = {
  length: 112,
  fieldMargin: 3.7,
  zCurve: 1.9,
  lowerRows: 11,
  lowerTread: 1.48,
  lowerRise: 0.74,
  lowerInitialHeight: 0.72,
  concourseDepth: 5.1,
  concourseClearHeight: 3.1,
  upperRows: 13,
  upperTread: 1.43,
  upperRise: 1.02,
  upperInitialRise: 0.52,
  aisleHalfWidth: 1.32,
  aislePositions: [-34, 0, 34],
  vomitoryWidth: 4.6,
  parapetHeight: 1.65,
} as const;

export type RinaSideTier = "lower" | "upper";
export type RinaStandSide = -1 | 1;

export interface RinaDoubleTierStandMaterials {
  concrete: Material;
  darkConcrete: Material;
  aisle: Material;
  ledRibbon: Material;
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function outwardCurve(z: number) {
  const normalized = clamp(
    z / (RINA_DOUBLE_TIER_PROFILE.length * 0.5), -1, 1
  );
  return RINA_DOUBLE_TIER_PROFILE.zCurve * normalized * normalized;
}

function outwardCurveDerivative(z: number) {
  const half = RINA_DOUBLE_TIER_PROFILE.length * 0.5;
  return 2 * RINA_DOUBLE_TIER_PROFILE.zCurve * clamp(z, -half, half) / (half * half);
}

function tierMetrics(tier: RinaSideTier) {
  const p = RINA_DOUBLE_TIER_PROFILE;
  const lowerStartX = RINA_STADIUM.pitchWidth * 0.5 + p.fieldMargin;
  const lowerTopY = p.lowerInitialHeight + p.lowerRows * p.lowerRise;
  const lowerEndX = lowerStartX + p.lowerRows * p.lowerTread;
  const upperStartX = lowerEndX + p.concourseDepth;
  const upperStartY = lowerTopY + p.concourseClearHeight;
  return tier === "lower"
    ? {
        startX: lowerStartX,
        startY: p.lowerInitialHeight,
        rows: p.lowerRows,
        tread: p.lowerTread,
        rise: p.lowerRise,
        fillBottomY: 0,
      }
    : {
        startX: upperStartX,
        startY: upperStartY + p.upperInitialRise,
        rows: p.upperRows,
        tread: p.upperTread,
        rise: p.upperRise,
        fillBottomY: lowerTopY + 0.42,
      };
}

/** Position for *visual-only* NPCs later; returns unscaled local coordinates. */
export function getRinaSideStandAudienceAnchor(
  side: RinaStandSide,
  tier: RinaSideTier,
  row: number,
  z: number
): Vector3 {
  const m = tierMetrics(tier);
  const index = clamp(Math.floor(row), 0, m.rows - 1);
  return new Vector3(
    side * (m.startX + (index + 0.52) * m.tread + outwardCurve(z)),
    m.startY + index * m.rise + 0.08,
    clamp(z, -RINA_DOUBLE_TIER_PROFILE.length * 0.49,
      RINA_DOUBLE_TIER_PROFILE.length * 0.49)
  );
}

function newStandMaterial(
  scene: Scene,
  name: string,
  diffuse: Color3,
  emissive: Color3
) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = diffuse;
  mat.emissiveColor = emissive;
  mat.specularColor = Color3.Black();
  return mat;
}

function collectBox(
  scene: Scene,
  destination: Mesh[],
  name: string,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  yaw = 0
) {
  const mesh = MeshBuilder.CreateBox(name, {
    width,
    height,
    depth,
  }, scene);
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  destination.push(mesh);
  return mesh;
}

function collectBeam(
  scene: Scene,
  destination: Mesh[],
  name: string,
  from: Vector3,
  to: Vector3,
  radius: number
) {
  const span = to.subtract(from);
  const height = span.length();
  if (height < 0.001) return;
  const tube = MeshBuilder.CreateCylinder(name, {
    height,
    diameter: radius * 2,
    tessellation: 6,
  }, scene);
  tube.position.copyFrom(from).addInPlace(to).scaleInPlace(0.5);
  const axis = Vector3.Cross(Vector3.Up(), span.scale(1 / height));
  if (axis.lengthSquared() > 0.000001) {
    axis.normalize();
    const angle = Math.acos(clamp(span.y / height, -1, 1));
    tube.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
  }
  tube.isPickable = false;
  tube.checkCollisions = false;
  destination.push(tube);
}

function mergeGroup(
  name: string,
  input: Mesh[],
  material: Material
): Mesh | null {
  if (!input.length) return null;
  const merged = Mesh.MergeMeshes(input, true, true, undefined, false, false);
  if (!merged) throw new Error(`Unable to merge ${name}`);
  merged.name = name;
  merged.material = material;
  merged.isPickable = false;
  merged.checkCollisions = false;
  merged.receiveShadows = false;
  return merged;
}

/**
 * Visual-only, double-decker stands for both field sidelines.
 *
 * Lower deck: eleven readable steps.
 * Middle: recessed concourse with three dark vomitories on each side.
 * Upper deck: steeper, higher, thirteen-row seating surface.
 * The entire assembly is lightly curved along the field's long axis.
 *
 * Geometry is merged by material so the architecture stays cheap to render.
 */
export function createRinaDoubleTierSideStands(
  scene: Scene,
  performanceTier: "desktop" | "mobile",
  materials: RinaDoubleTierStandMaterials
) {
  const p = RINA_DOUBLE_TIER_PROFILE;
  const lower = tierMetrics("lower");
  const upper = tierMetrics("upper");
  const lowerTop = lower.startY + (lower.rows - 1) * lower.rise;
  const upperTop = upper.startY + (upper.rows - 1) * upper.rise;
  const lowerEndX = lower.startX + lower.rows * lower.tread;
  const upperEndX = upper.startX + upper.rows * upper.tread;
  const qualitySegments = performanceTier === "mobile" ? 6 : 10;
  const sectionLength = p.length / qualitySegments;

  // Very restrained self-illumination keeps the architectural silhouette
  // legible against the current, near-black concert ambience.
  const seating = newStandMaterial(
    scene, "rinaDoubleStandSeatConcrete",
    new Color3(0.043, 0.041, 0.040),
    new Color3(0.002, 0.002, 0.003)
  );
  const darkVoid = newStandMaterial(
    scene, "rinaDoubleStandRecess",
    new Color3(0.008, 0.009, 0.014),
    new Color3(0.002, 0.003, 0.007)
  );
  const railing = newStandMaterial(
    scene, "rinaDoubleStandRails",
    new Color3(0.076, 0.076, 0.076),
    new Color3(0.003, 0.003, 0.004)
  );
  const edge = newStandMaterial(
    scene, "rinaDoubleStandEdge",
    new Color3(0.061, 0.060, 0.058),
    new Color3(0.003, 0.003, 0.004)
  );

  const structureParts: Mesh[] = [];
  const seatParts: Mesh[] = [];
  const aisleParts: Mesh[] = [];
  const fasciaParts: Mesh[] = [];
  const recessParts: Mesh[] = [];
  const edgeParts: Mesh[] = [];
  const railParts: Mesh[] = [];
  const ledParts: Mesh[] = [];

  for (const side of [-1, 1] as const) {
    for (const tier of ["lower", "upper"] as const) {
      const t = tier === "lower" ? lower : upper;
      const relativeBottom = t.fillBottomY;
      for (let row = 0; row < t.rows; row++) {
        const topY = t.startY + row * t.rise;
        for (let part = 0; part < qualitySegments; part++) {
          const z = -p.length * 0.5 + (part + 0.5) * sectionLength;
          const yaw = Math.atan(side * outwardCurveDerivative(z));
          const x = side * (t.startX + (row + 0.5) * t.tread + outwardCurve(z));
          collectBox(
            scene, structureParts, `rina_${tier}_structure_${side}_${row}_${part}`,
            t.tread + 0.045, topY - relativeBottom,
            sectionLength - 0.02,
            x, (topY + relativeBottom) * 0.5, z, yaw
          );
          collectBox(
            scene, seatParts, `rina_${tier}_seat_${side}_${row}_${part}`,
            t.tread + 0.025, 0.092, sectionLength - 0.015,
            x, topY + 0.046, z, yaw
          );
          collectBox(
            scene, edgeParts, `rina_${tier}_nosing_${side}_${row}_${part}`,
            0.095, 0.13, sectionLength - 0.015,
            side * (t.startX + row * t.tread + outwardCurve(z)),
            topY - 0.018, z, yaw
          );
        }

        // Broad stairs marking spectator circulation; no collision or walking
        // is introduced. Rows stay continuous underneath these markings.
        for (const z of p.aislePositions) {
          const laneX = side * (t.startX + (row + 0.5) * t.tread + outwardCurve(z));
          collectBox(
            scene, aisleParts, `rina_${tier}_aisle_${side}_${row}_${z}`,
            t.tread - 0.05, 0.023, p.aisleHalfWidth * 2,
            laneX, topY + 0.107, z,
            Math.atan(side * outwardCurveDerivative(z))
          );
        }
      }

      // Lightweight paired handrails run alongside each stepped aisle.
      for (const aisleZ of p.aislePositions) {
        for (const offset of [-1, 1]) {
          const z = aisleZ + offset * (p.aisleHalfWidth + 0.11);
          const from = new Vector3(
            side * (t.startX + outwardCurve(z) + 0.24),
            t.startY + 0.95,
            z
          );
          const to = new Vector3(
            side * (t.startX + (t.rows - 0.62) * t.tread + outwardCurve(z)),
            t.startY + (t.rows - 1) * t.rise + 0.95,
            z
          );
          collectBeam(scene, railParts,
            `rina_${tier}_aisleRail_${side}_${aisleZ}_${offset}`,
            from, to, 0.042);
          if (performanceTier === "desktop") {
            for (let row = 1; row < t.rows; row += 3) {
              const frac = row / Math.max(1, t.rows - 1);
              const railPoint = Vector3.Lerp(from, to, frac);
              const postEnd = railPoint.add(new Vector3(0, -0.78, 0));
              collectBeam(scene, railParts,
                `rina_${tier}_post_${side}_${aisleZ}_${row}_${offset}`,
                railPoint, postEnd, 0.032);
            }
          }
        }
      }
    }

    // Middle concourse and fascia. Visual-only dark entry tunnels are recessed
    // between genuine wall segments instead of painted on a flat rectangle.
    for (let part = 0; part < qualitySegments; part++) {
      const z = -p.length * 0.5 + (part + 0.5) * sectionLength;
      const yaw = Math.atan(side * outwardCurveDerivative(z));
      const curve = outwardCurve(z);
      collectBox(
        scene, fasciaParts, `rinaConcourseFloor_${side}_${part}`,
        p.concourseDepth + 0.2, 0.32, sectionLength - 0.015,
        side * (lowerEndX + p.concourseDepth * 0.5 + curve),
        lowerTop + 0.13, z, yaw
      );
      collectBox(
        scene, fasciaParts, `rinaConcourseCanopy_${side}_${part}`,
        p.concourseDepth + 0.3, 0.5, sectionLength - 0.015,
        side * (lowerEndX + p.concourseDepth * 0.5 + curve),
        upper.startY - 0.48, z, yaw
      );
      collectBox(
        scene, ledParts, `rinaConcourseLed_${side}_${part}`,
        0.11, 0.21, sectionLength - 0.015,
        side * (lowerEndX + curve - 0.08),
        upper.startY - 0.67, z, yaw
      );
      collectBox(
        scene, edgeParts, `rinaConcourseLip_${side}_${part}`,
        0.3, 0.26, sectionLength - 0.015,
        side * (lowerEndX + curve - 0.1),
        lowerTop + 0.36, z, yaw
      );
    }

    const openings = p.aislePositions;
    const half = p.length * 0.5;
    const frontIntervals: Array<[number, number]> = [];
    let cursor = -half;
    for (const center of openings) {
      const start = center - p.vomitoryWidth * 0.5;
      if (start > cursor) frontIntervals.push([cursor, start]);
      cursor = center + p.vomitoryWidth * 0.5;
    }
    if (cursor < half) frontIntervals.push([cursor, half]);

    const fasciaHeight = p.concourseClearHeight - 0.78;
    const fasciaY = lowerTop + 0.36 + fasciaHeight * 0.5;
    for (const [start, end] of frontIntervals) {
      const z = (start + end) * 0.5;
      const curve = outwardCurve(z);
      collectBox(
        scene, fasciaParts, `rinaConcourseFascia_${side}_${start}`,
        0.32, fasciaHeight, end - start - 0.01,
        side * (lowerEndX + curve + 0.18), fasciaY, z,
        Math.atan(side * outwardCurveDerivative(z))
      );
    }

    for (const z of openings) {
      const curve = outwardCurve(z);
      const facadeX = side * (lowerEndX + curve + 0.16);
      collectBox(
        scene, recessParts, `rinaVomitoryBlack_${side}_${z}`,
        0.15, fasciaHeight - 0.13, p.vomitoryWidth - 0.16,
        facadeX, fasciaY - 0.04, z
      );
      for (const boundary of [-1, 1]) {
        collectBox(
          scene, edgeParts, `rinaVomitoryJamb_${side}_${z}_${boundary}`,
          0.26, fasciaHeight + 0.1, 0.18,
          side * (lowerEndX + curve - 0.03),
          fasciaY, z + boundary * p.vomitoryWidth * 0.5
        );
      }
      collectBox(
        scene, ledParts, `rinaVomitoryHeader_${side}_${z}`,
        0.2, 0.13, p.vomitoryWidth - 0.25,
        side * (lowerEndX + curve - 0.02),
        lowerTop + p.concourseClearHeight - 0.23, z
      );
    }

    // Top parapet and very subtle crown lighting: important for the stadium's
    // silhouette in the night sky, but no extra dynamic lights are created.
    for (let part = 0; part < qualitySegments; part++) {
      const z = -p.length * 0.5 + (part + 0.5) * sectionLength;
      const yaw = Math.atan(side * outwardCurveDerivative(z));
      const x = side * (upperEndX + outwardCurve(z) + 0.08);
      collectBox(scene, fasciaParts, `rinaCrown_${side}_${part}`,
        0.62, p.parapetHeight, sectionLength - 0.015,
        x, upperTop + p.parapetHeight * 0.5 + 0.12, z, yaw);
      collectBox(scene, edgeParts, `rinaCrownCap_${side}_${part}`,
        0.88, 0.14, sectionLength - 0.015,
        x, upperTop + p.parapetHeight + 0.18, z, yaw);
    }
  }

  const merged: Mesh[] = [];
  for (const [name, group, material] of [
    ["rinaDoubleStandStructure", structureParts, materials.darkConcrete],
    ["rinaDoubleStandSeating", seatParts, seating],
    ["rinaDoubleStandAisles", aisleParts, materials.aisle],
    ["rinaDoubleStandFascia", fasciaParts, materials.concrete],
    ["rinaDoubleStandVomitories", recessParts, darkVoid],
    ["rinaDoubleStandNosing", edgeParts, edge],
    ["rinaDoubleStandRailings", railParts, railing],
    ["rinaDoubleStandLedBands", ledParts, materials.ledRibbon],
  ] as const) {
    const mesh = mergeGroup(name, group, material);
    if (mesh) merged.push(mesh);
  }

  // The calling Scene owns meshes and shared materials. In particular, do not
  // dispose concrete/aisle/LED mats here: RinaStadiumGeometry uses them too.
  return {
    meshes: merged as readonly Mesh[],
    dispose() {
      for (const mesh of merged) {
        if (!mesh.isDisposed()) mesh.dispose();
      }
      for (const owned of [seating, darkVoid, railing, edge]) {
        owned.dispose();
      }
    },
  };
}
