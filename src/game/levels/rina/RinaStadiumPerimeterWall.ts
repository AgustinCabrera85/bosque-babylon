import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_STADIUM } from "./RinaLevelConfig";
import { RINA_DOUBLE_TIER_PROFILE } from "./RinaDoubleTierSideStands";
import { RINA_BACK_STAND_LED_PROFILE } from "./RinaBackStandExit";

/** A low exterior shell closes the open space below the stands and corner bridges. */
export function createRinaStadiumPerimeterWall(scene: Scene) {
  const side = RINA_DOUBLE_TIER_PROFILE;
  const rear = RINA_BACK_STAND_LED_PROFILE;
  const outerX = RINA_STADIUM.pitchWidth * 0.5 + side.fieldMargin +
    side.lowerRows * side.lowerTread + side.concourseDepth +
    side.upperRows * side.upperTread + side.zCurve + 2.7;
  const outerZ = -rear.rearZ + rear.lowerRows * rear.lowerRowDepth +
    rear.concourseDepth + 2.35 + rear.upperRows * rear.upperRowDepth + 4.5;
  const wallHeight = 12.8;
  const thickness = 1.6;
  const material = new StandardMaterial("rinaPerimeterWallMaterial", scene);
  material.diffuseColor = new Color3(0.057, 0.053, 0.064);
  material.emissiveColor = new Color3(0.006, 0.005, 0.008);
  material.specularColor = Color3.Black();

  const wall = (name: string, width: number, depth: number, x: number, z: number) => {
    const mesh = MeshBuilder.CreateBox(name, { width, height: wallHeight, depth }, scene);
    mesh.position.set(x, wallHeight * 0.5, z);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = false;
  };
  for (const sign of [-1, 1]) {
    wall(`rinaPerimeterSideWall_${sign}`, thickness, outerZ * 2 + thickness,
      sign * outerX, 0);
    wall(`rinaPerimeterEndWall_${sign}`, outerX * 2 + thickness, thickness,
      0, sign * outerZ);
  }
}
