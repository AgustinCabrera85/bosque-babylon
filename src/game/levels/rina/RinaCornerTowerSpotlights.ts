import { Engine } from "@babylonjs/core/Engines/engine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_CORNER_PAVILION_PROFILE } from "./RinaStadiumCornerConnectors";

type Parts = {
  metal: Mesh[];
  blueLens: Mesh[];
  magentaLens: Mesh[];
  blueBeam: Mesh[];
  magentaBeam: Mesh[];
  blueBeamCore: Mesh[];
  magentaBeamCore: Mesh[];
};

function scenic(mesh: Mesh) {
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  return mesh;
}

function alignY(direction: Vector3) {
  const axis = Vector3.Cross(Vector3.Up(), direction);
  if (axis.lengthSquared() < 1e-8) {
    return direction.y >= 0 ? Quaternion.Identity()
      : Quaternion.RotationAxis(Vector3.Right(), Math.PI);
  }
  return Quaternion.RotationAxis(axis.normalize(),
    Math.acos(Math.max(-1, Math.min(1, direction.y))));
}

function merge(name: string, meshes: Mesh[], material: StandardMaterial) {
  if (!meshes.length) return null;
  for (const mesh of meshes) mesh.computeWorldMatrix(true);
  const result = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
  if (!result) throw new Error(`Unable to merge ${name}`);
  result.name = name;
  result.material = material;
  return scenic(result);
}

function beamMaterial(scene: Scene, name: string, color: Color3, alpha: number) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.Black();
  material.emissiveColor = color;
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.fogEnabled = false;
  material.alphaMode = Engine.ALPHA_ADD;
  material.alpha = alpha;
  return material;
}

/** Local stadium coordinates; caller parents the returned root to rinaStadiumRoot. */
export function createRinaCornerTowerSpotlights(
  scene: Scene,
  performanceTier: "desktop" | "mobile"
) {
  const profile = RINA_CORNER_PAVILION_PROFILE;
  const root = new TransformNode("rinaCornerTowerSpotlightsRoot", scene);
  const parts: Parts = {
    metal: [], blueLens: [], magentaLens: [], blueBeam: [], magentaBeam: [],
    blueBeamCore: [], magentaBeamCore: [],
  };
  const blue = new Color3(0.16, 0.58, 1);
  const magenta = new Color3(0.98, 0.14, 0.68);
  const metal = new StandardMaterial("rinaCornerSpotMetal", scene);
  metal.diffuseColor = new Color3(0.10, 0.12, 0.16);
  metal.emissiveColor = new Color3(0.014, 0.019, 0.028);
  metal.specularColor = new Color3(0.21, 0.24, 0.30);
  const blueLens = new StandardMaterial("rinaCornerSpotBlueLens", scene);
  blueLens.diffuseColor = Color3.Black();
  blueLens.emissiveColor = blue;
  blueLens.disableLighting = true;
  const magentaLens = new StandardMaterial("rinaCornerSpotMagentaLens", scene);
  magentaLens.diffuseColor = Color3.Black();
  magentaLens.emissiveColor = magenta;
  magentaLens.disableLighting = true;
  const blueBeam = beamMaterial(scene, "rinaCornerSpotBlueBeam", blue, 0.065);
  const magentaBeam = beamMaterial(scene, "rinaCornerSpotMagentaBeam", magenta, 0.065);
  const blueBeamCore = beamMaterial(scene, "rinaCornerSpotBlueBeamCore", blue, 0.045);
  const magentaBeamCore = beamMaterial(scene, "rinaCornerSpotMagentaBeamCore", magenta, 0.045);
  const materials = [metal, blueLens, magentaLens, blueBeam, magentaBeam,
    blueBeamCore, magentaBeamCore];

  const offsets = performanceTier === "desktop"
    ? [-5.1, -1.7, 1.7, 5.1]
    : [-3.3, 3.3];
  const roofTop = profile.towerRoofY + 0.26;
  const mountZ = profile.towerCenterZ + profile.towerDepth * 0.5 - 0.9;

  for (const side of [-1, 1] as const) {
    for (const [index, offset] of offsets.entries()) {
      const label = `${side < 0 ? "West" : "East"}_${index}`;
      const x = side * profile.towerCenterAbsX + offset;
      const isBlue = (index + (side < 0 ? 1 : 0)) % 2 === 0;
      const direction = new Vector3(
        -side * (0.43 + Math.abs(offset) * 0.012),
        -0.46,
        0.78 + offset * 0.008
      ).normalize();
      const headRotation = alignY(direction);

      const base = scenic(MeshBuilder.CreateCylinder(
        `rinaCornerSpot_${label}_Base`,
        { height: 0.28, diameter: 1.12, tessellation: 10 }, scene));
      base.position.set(x, roofTop + 0.14, mountZ);
      parts.metal.push(base);
      for (const bracketSide of [-1, 1]) {
        const bracket = scenic(MeshBuilder.CreateBox(
          `rinaCornerSpot_${label}_Bracket_${bracketSide}`,
          { width: 0.12, height: 0.64, depth: 0.36 }, scene));
        bracket.position.set(x + bracketSide * 0.35, roofTop + 0.54, mountZ);
        parts.metal.push(bracket);
      }

      const headCenter = new Vector3(x, roofTop + 0.98, mountZ);
      const head = scenic(MeshBuilder.CreateCylinder(
        `rinaCornerSpot_${label}_Head`,
        { height: 0.82, diameterTop: 1.13, diameterBottom: 0.72,
          tessellation: 12 }, scene));
      head.position.copyFrom(headCenter);
      head.rotationQuaternion = headRotation;
      parts.metal.push(head);

      const lensPosition = headCenter.add(direction.scale(0.44));
      const lens = scenic(MeshBuilder.CreateCylinder(
        `rinaCornerSpot_${label}_Lens`,
        { height: 0.075, diameter: 0.96, tessellation: 12 }, scene));
      lens.position.copyFrom(lensPosition);
      lens.rotationQuaternion = headRotation;
      parts[isBlue ? "blueLens" : "magentaLens"].push(lens);

      const beamLength = performanceTier === "desktop" ? 13.5 : 10.5;
      const beamStart = lensPosition.add(direction.scale(0.08));
      const beamRotation = alignY(direction.scale(-1));
      const beam = scenic(MeshBuilder.CreateCylinder(
        `rinaCornerSpot_${label}_Beam`,
        { height: beamLength, diameterTop: 0.38, diameterBottom: 2.65,
          tessellation: performanceTier === "desktop" ? 12 : 8, cap: 0 }, scene));
      beam.position.copyFrom(beamStart.add(direction.scale(beamLength * 0.5)));
      beam.rotationQuaternion = beamRotation;
      parts[isBlue ? "blueBeam" : "magentaBeam"].push(beam);

      if (performanceTier === "desktop") {
        const core = scenic(MeshBuilder.CreateCylinder(
          `rinaCornerSpot_${label}_BeamCore`,
          { height: beamLength * 0.88, diameterTop: 0.24, diameterBottom: 1.06,
            tessellation: 10, cap: 0 }, scene));
        core.position.copyFrom(beamStart.add(direction.scale(beamLength * 0.44)));
        core.rotationQuaternion = beamRotation;
        parts[isBlue ? "blueBeamCore" : "magentaBeamCore"].push(core);
      }
    }
  }

  const groups = [
    merge("rinaCornerSpotMetal", parts.metal, metal),
    merge("rinaCornerSpotBlueLenses", parts.blueLens, blueLens),
    merge("rinaCornerSpotMagentaLenses", parts.magentaLens, magentaLens),
    merge("rinaCornerSpotBlueBeams", parts.blueBeam, blueBeam),
    merge("rinaCornerSpotMagentaBeams", parts.magentaBeam, magentaBeam),
    merge("rinaCornerSpotBlueBeamCores", parts.blueBeamCore, blueBeamCore),
    merge("rinaCornerSpotMagentaBeamCores", parts.magentaBeamCore, magentaBeamCore),
  ];
  for (const mesh of groups) if (mesh) mesh.parent = root;

  let disposed = false;
  return {
    root,
    dispose() {
      if (disposed) return;
      disposed = true;
      root.dispose(false, false);
      for (const material of materials) material.dispose();
    },
  };
}
