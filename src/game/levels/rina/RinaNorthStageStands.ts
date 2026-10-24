import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_BACK_STAND_LED_PROFILE, type RinaStandMaterials } from "./RinaBackStandExit";
import { RINA_STADIUM } from "./RinaLevelConfig";

/** Local stadium coordinates. The center remains clear for the concert stage. */
export const RINA_NORTH_STAGE_STAND_PROFILE = {
  innerClearHalfWidth: RINA_STADIUM.stage.width * 0.5 + 5.5,
  outerHalfWidth: RINA_BACK_STAND_LED_PROFILE.halfWidth,
  lowerFrontZ: -RINA_BACK_STAND_LED_PROFILE.rearZ + 3,
} as const;

export function createRinaNorthStageStands(
  scene: Scene,
  materials: RinaStandMaterials
): readonly Mesh[] {
  const rear = RINA_BACK_STAND_LED_PROFILE;
  const profile = RINA_NORTH_STAGE_STAND_PROFILE;
  if (profile.lowerFrontZ <= RINA_STADIUM.stage.centerZ + RINA_STADIUM.stage.depth * 0.5 + 5 ||
      profile.innerClearHalfWidth <= RINA_STADIUM.stage.width * 0.5 + 3) {
    throw new Error("Rina stage stands would overlap the concert stage");
  }

  const groups = {
    concrete: [] as Mesh[],
    dark: [] as Mesh[],
    aisle: [] as Mesh[],
    ribbon: [] as Mesh[],
  };
  const box = (
    group: keyof typeof groups, name: string,
    width: number, height: number, depth: number,
    x: number, y: number, z: number
  ) => {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = false;
    groups[group].push(mesh);
  };

  const lowerTop = 0.45 + (rear.lowerRows - 1) * rear.rowHeight + rear.rowHeight * 0.5;
  const concourseZ = -rear.rearZ + rear.lowerRows * rear.lowerRowDepth + rear.concourseDepth * 0.5 - 0.2;
  const concourseTop = lowerTop + rear.concourseHeight + 0.35;
  const upperBaseY = lowerTop + rear.concourseHeight + 0.75;
  const upperFrontZ = -rear.rearZ + rear.lowerRows * rear.lowerRowDepth + rear.concourseDepth + 2.35;

  for (const side of [-1, 1]) {
    const width = profile.outerHalfWidth - profile.innerClearHalfWidth;
    const centerX = side * (profile.innerClearHalfWidth + profile.outerHalfWidth) * 0.5;
    for (let row = 0; row < rear.lowerRows; row++) {
      const top = 0.45 + row * rear.rowHeight + rear.rowHeight * 0.5;
      const z = profile.lowerFrontZ + row * rear.lowerRowDepth;
      // A continuous riser reaches ground; these steps cannot read as floating slabs.
      box("dark", `rinaNorthWingLowerSupport_${side}_${row}`,
        width, top, rear.lowerRowDepth, centerX, top * 0.5, z);
      box(row === 3 || row === 6 ? "aisle" : "concrete",
        `rinaNorthWingLowerTread_${side}_${row}`,
        width, 0.09, rear.lowerRowDepth, centerX, top + 0.045, z);
    }

    box("dark", `rinaNorthWingConcourseSupport_${side}`,
      width, concourseTop, rear.concourseDepth, centerX, concourseTop * 0.5, concourseZ);
    box("concrete", `rinaNorthWingConcourseDeck_${side}`,
      width, 0.18, rear.concourseDepth, centerX, concourseTop + 0.09, concourseZ);
    box("ribbon", `rinaNorthWingConcourseRibbon_${side}`,
      width, 0.1, 0.12, centerX, lowerTop + 0.42, concourseZ - rear.concourseDepth * 0.5 - 0.07);

    for (let row = 0; row < rear.upperRows; row++) {
      const outerX = profile.outerHalfWidth - row * 0.5;
      const upperWidth = outerX - profile.innerClearHalfWidth;
      const upperX = side * (profile.innerClearHalfWidth + outerX) * 0.5;
      const top = upperBaseY + row * rear.rowHeight + rear.rowHeight * 0.5;
      const z = upperFrontZ + row * rear.upperRowDepth;
      box("dark", `rinaNorthWingUpperSupport_${side}_${row}`,
        upperWidth, top, rear.upperRowDepth, upperX, top * 0.5, z);
      box(row % 3 === 0 ? "aisle" : "concrete",
        `rinaNorthWingUpperTread_${side}_${row}`,
        upperWidth, 0.09, rear.upperRowDepth, upperX, top + 0.045, z);
    }

    const crownTop = upperBaseY + (rear.upperRows - 1) * rear.rowHeight + rear.rowHeight * 0.5;
    const crownOuterX = profile.outerHalfWidth - (rear.upperRows - 1) * 0.5;
    box("dark", `rinaNorthWingCrown_${side}`,
      crownOuterX - profile.innerClearHalfWidth, 1.25, 1,
      side * (profile.innerClearHalfWidth + crownOuterX) * 0.5,
      crownTop + 1.025, upperFrontZ + rear.upperRows * rear.upperRowDepth + 0.75);
  }

  const merge = (name: string, source: Mesh[], material: RinaStandMaterials[keyof RinaStandMaterials]) => {
    for (const mesh of source) mesh.computeWorldMatrix(true);
    const mesh = Mesh.MergeMeshes(source, true, true);
    if (!mesh) throw new Error(`Failed to merge ${name}`);
    mesh.name = name;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = false;
    return mesh;
  };
  return [
    merge("rinaNorthStageWingsConcrete", groups.concrete, materials.concrete),
    merge("rinaNorthStageWingsStructure", groups.dark, materials.darkConcrete),
    merge("rinaNorthStageWingsAisles", groups.aisle, materials.aisle),
    merge("rinaNorthStageWingsRibbon", groups.ribbon, materials.ledRibbon),
  ];
}
