import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { RINA_STADIUM } from "./RinaLevelConfig";

export type RinaStandMaterials = {
  concrete: StandardMaterial;
  darkConcrete: StandardMaterial;
  aisle: StandardMaterial;
  ledRibbon: StandardMaterial;
};

export type RinaBackStandBuildOptions = {
  performanceTier: "desktop" | "mobile";
  materials: RinaStandMaterials;
};

type BuildState = {
  scene: Scene;
  meshes: Mesh[];
  materials: RinaStandMaterials;
  performanceTier: "desktop" | "mobile";
};

const LOWER_ROWS = 9;
const UPPER_ROWS = 11;
const ROW_HEIGHT = 0.72;
const LOWER_ROW_DEPTH = 1.65;
const UPPER_ROW_DEPTH = 1.55;
const CONCOURSE_HEIGHT = 2.35;
const CONCOURSE_DEPTH = 3.25;
const CROWN_HEIGHT = 1.25;
const BACK_OFFSET = 8.5;
// Stop the rear steps before the side stands' inner edges at the corners.
const STAND_HALF_WIDTH = RINA_STADIUM.pitchWidth * 0.5 + 4.5;
const OPENING_HALF_WIDTH = RINA_STADIUM.exitTunnel.halfWidth + 4.25;
const REAR_Z = -(RINA_STADIUM.pitchLength * 0.5 + BACK_OFFSET);
const EXIT_SIGN_WIDTH = 0.95;
const EXIT_SIGN_HEIGHT = 0.25;
const EXIT_SIGN_DEPTH = 0.08;

function createBox(state: BuildState, name: string, width: number, height: number, depth: number, x: number, y: number, z: number, material: StandardMaterial) {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, state.scene);
  mesh.position.set(x, y, z);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  state.meshes.push(mesh);
  return mesh;
}

function createDynamicExitSignMaterial(scene: Scene) {
  const texture = new DynamicTexture("rinaExitSignTexture", { width: 1024, height: 320 }, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 1024, 320);

  // Dark acrylic panel.
  ctx.fillStyle = "#071109";
  ctx.fillRect(0, 0, 1024, 320);

  // Green neon border.
  ctx.strokeStyle = "#45ff7a";
  ctx.lineWidth = 20;
  ctx.strokeRect(18, 18, 988, 284);

  // Subtle top lamps.
  for (let i = 0; i < 6; i++) {
    const x = 110 + i * 150;
    ctx.fillStyle = "rgba(120,255,160,0.12)";
    ctx.beginPath();
    ctx.arc(x, 28, 13, 0, Math.PI * 2);
    ctx.fill();
  }

  // Main word.
  // The visible face of a Babylon box reverses this canvas horizontally.
  ctx.save();
  ctx.translate(1024, 0);
  ctx.scale(-1, 1);
  ctx.font = "bold 190px Arial, Helvetica, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(85,255,130,0.95)";
  ctx.shadowBlur = 36;
  ctx.fillStyle = "#7dff9e";
  ctx.fillText("SALIDA", 512, 165);

  ctx.restore();

  texture.update(false);

  const material = new StandardMaterial("rinaExitSignMaterial", scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.disableLighting = false;
  material.emissiveColor = new Color3(0.18, 1.0, 0.35);
  material.specularColor = Color3.Black();
  return material;
}

function buildLowerTier(state: BuildState) {
  const startZ = REAR_Z - 3.0;
  for (let row = 0; row < LOWER_ROWS; row++) {
    const y = 0.45 + row * ROW_HEIGHT;
    const z = startZ - row * LOWER_ROW_DEPTH;
    const rowDepth = LOWER_ROW_DEPTH;
    const rowHeight = ROW_HEIGHT;
    const sideWidth = STAND_HALF_WIDTH - OPENING_HALF_WIDTH;
    const centerX = (OPENING_HALF_WIDTH + STAND_HALF_WIDTH) * 0.5;
    createBox(state, `rinaRearLowerLeft_${row}`, sideWidth, rowHeight, rowDepth, -centerX, y, z, state.materials.concrete);
    createBox(state, `rinaRearLowerRight_${row}`, sideWidth, rowHeight, rowDepth, centerX, y, z, state.materials.concrete);

    // Visible aisle strips every few rows.
    if (row === 3 || row === 6) {
      createBox(state, `rinaRearLowerAisleLeft_${row}`, sideWidth, 0.08, rowDepth + 0.14, -centerX, y + rowHeight * 0.5 + 0.03, z, state.materials.aisle);
      createBox(state, `rinaRearLowerAisleRight_${row}`, sideWidth, 0.08, rowDepth + 0.14, centerX, y + rowHeight * 0.5 + 0.03, z, state.materials.aisle);
    }
  }
}

function buildConcourse(state: BuildState) {
  const lowerTopY = 0.45 + (LOWER_ROWS - 1) * ROW_HEIGHT + ROW_HEIGHT * 0.5;
  const concourseY = lowerTopY + CONCOURSE_HEIGHT * 0.5 + 0.35;
  const concourseZ = REAR_Z - LOWER_ROWS * LOWER_ROW_DEPTH - CONCOURSE_DEPTH * 0.5 + 0.2;
  const sideWidth = STAND_HALF_WIDTH - OPENING_HALF_WIDTH;
  const centerX = (OPENING_HALF_WIDTH + STAND_HALF_WIDTH) * 0.5;

  createBox(state, "rinaRearConcourseLeft", sideWidth, CONCOURSE_HEIGHT, CONCOURSE_DEPTH, -centerX, concourseY, concourseZ, state.materials.darkConcrete);
  createBox(state, "rinaRearConcourseRight", sideWidth, CONCOURSE_HEIGHT, CONCOURSE_DEPTH, centerX, concourseY, concourseZ, state.materials.darkConcrete);

  // LED ribbon along the front edge of the concourse.
  createBox(state, "rinaRearConcourseRibbonLeft", sideWidth, 0.14, 0.16, -centerX, concourseY + 0.42, concourseZ + CONCOURSE_DEPTH * 0.5 - 0.08, state.materials.ledRibbon);
  createBox(state, "rinaRearConcourseRibbonRight", sideWidth, 0.14, 0.16, centerX, concourseY + 0.42, concourseZ + CONCOURSE_DEPTH * 0.5 - 0.08, state.materials.ledRibbon);

  // Central tunnel frame above the existing exit corridor.
  createBox(state, "rinaRearExitFrameTop", OPENING_HALF_WIDTH * 2 + 1.5, 0.4, 0.6, 0, concourseY + CONCOURSE_HEIGHT * 0.5 - 0.15, concourseZ + CONCOURSE_DEPTH * 0.5 - 0.35, state.materials.aisle);
  createBox(state, "rinaRearExitFrameLeft", 0.4, CONCOURSE_HEIGHT - 0.2, 0.6, -OPENING_HALF_WIDTH - 0.35, concourseY, concourseZ + CONCOURSE_DEPTH * 0.5 - 0.35, state.materials.aisle);
  createBox(state, "rinaRearExitFrameRight", 0.4, CONCOURSE_HEIGHT - 0.2, 0.6, OPENING_HALF_WIDTH + 0.35, concourseY, concourseZ + CONCOURSE_DEPTH * 0.5 - 0.35, state.materials.aisle);
}

function buildUpperTier(state: BuildState) {
  const lowerTopY = 0.45 + (LOWER_ROWS - 1) * ROW_HEIGHT + ROW_HEIGHT * 0.5;
  const upperBaseY = lowerTopY + CONCOURSE_HEIGHT + 0.75;
  const upperBaseZ = REAR_Z - LOWER_ROWS * LOWER_ROW_DEPTH - CONCOURSE_DEPTH - 2.35;
  const upperWidth = STAND_HALF_WIDTH * 2;

  for (let row = 0; row < UPPER_ROWS; row++) {
    const y = upperBaseY + row * ROW_HEIGHT;
    const z = upperBaseZ - row * UPPER_ROW_DEPTH;
    const widthShrink = row * 1.0;
    const width = Math.max(16, upperWidth - widthShrink);
    createBox(state, `rinaRearUpper_${row}`, width, ROW_HEIGHT, UPPER_ROW_DEPTH, 0, y, z, row % 3 === 0 ? state.materials.aisle : state.materials.concrete);
  }

  // Sector separators / vomitories.
  const separatorZ = upperBaseZ - UPPER_ROWS * UPPER_ROW_DEPTH * 0.42;
  const separatorY = upperBaseY + UPPER_ROWS * ROW_HEIGHT * 0.5;
  for (const x of [-22, 0, 22]) {
    createBox(state, `rinaRearUpperSeparator_${x}`, 0.35, UPPER_ROWS * ROW_HEIGHT + 2, UPPER_ROWS * UPPER_ROW_DEPTH * 0.9, x, separatorY, separatorZ, state.materials.darkConcrete);
  }

  // Upper crown.
  const topY = upperBaseY + (UPPER_ROWS - 1) * ROW_HEIGHT + ROW_HEIGHT * 0.5;
  const topZ = upperBaseZ - UPPER_ROWS * UPPER_ROW_DEPTH - 0.75;
  createBox(state, "rinaRearUpperCrown", upperWidth - UPPER_ROWS * 0.8, CROWN_HEIGHT, 1.0, 0, topY + CROWN_HEIGHT * 0.5 + 0.4, topZ, state.materials.darkConcrete);
}

function buildStairCuts(state: BuildState) {
  const lowerStartZ = REAR_Z - 3.0;
  const lowerTopY = 0.45 + (LOWER_ROWS - 1) * ROW_HEIGHT + ROW_HEIGHT * 0.5;
  const upperBaseY = lowerTopY + CONCOURSE_HEIGHT + 0.75;
  const stairMat = state.materials.aisle;

  for (const side of [-1, 1]) {
    const stairX = side * (STAND_HALF_WIDTH - 8.5);
    for (let row = 0; row < LOWER_ROWS; row++) {
      createBox(state, `rinaRearLowerStair_${side}_${row}`, 2.25, 0.08, LOWER_ROW_DEPTH + 0.1, stairX, 0.86 + row * ROW_HEIGHT, lowerStartZ - row * LOWER_ROW_DEPTH, stairMat);
    }
    const upperBaseZ = REAR_Z - LOWER_ROWS * LOWER_ROW_DEPTH - CONCOURSE_DEPTH - 2.35;
    for (let row = 0; row < UPPER_ROWS; row++) {
      createBox(state, `rinaRearUpperStair_${side}_${row}`, 2.25, 0.08, UPPER_ROW_DEPTH + 0.1, stairX, upperBaseY + 0.36 + row * ROW_HEIGHT, upperBaseZ - row * UPPER_ROW_DEPTH, stairMat);
    }
  }
}

function buildExitSign(state: BuildState) {
  const signMaterial = createDynamicExitSignMaterial(state.scene);
  const sign = MeshBuilder.CreateBox("rinaRearExitSign", {
    width: EXIT_SIGN_WIDTH,
    height: EXIT_SIGN_HEIGHT,
    depth: EXIT_SIGN_DEPTH,
  }, state.scene);
  // Sit on the field-facing edge of the tunnel frame, above its roof beam.
  const tunnelFrontZ = RINA_STADIUM.exitTunnel.endZ + 2.5;
  sign.position.set(0, 5.025 + EXIT_SIGN_HEIGHT * 0.5 + 0.04, tunnelFrontZ + EXIT_SIGN_DEPTH * 0.5);
  sign.material = signMaterial;
  sign.isPickable = false;
  sign.checkCollisions = false;
  state.meshes.push(sign);

  if (state.performanceTier === "desktop") {
    const glow = new PointLight("rinaRearExitSignLight", new Vector3(0, 0, 1.2), state.scene);
    glow.parent = sign;
    glow.diffuse = new Color3(0.25, 1, 0.45);
    glow.intensity = 1.2;
    glow.range = 6;
  }
}

/**
 * Adds a more convincing rear stand for the Rina stadium.
 * This helper is strictly visual: no navigation, no collisions, no gameplay.
 * It is designed to live on top of the existing exit tunnel / gameplay exit.
 */
export function createRinaBackStandWithExit(scene: Scene, options: RinaBackStandBuildOptions): AbstractMesh[] {
  const state: BuildState = {
    scene,
    meshes: [],
    materials: options.materials,
    performanceTier: options.performanceTier,
  };

  buildLowerTier(state);
  buildConcourse(state);
  buildUpperTier(state);
  buildStairCuts(state);
  buildExitSign(state);

  // Merge by material family where possible to keep the scene lighter.
  const concreteMeshes = state.meshes.filter((mesh) => mesh.material === state.materials.concrete);
  const darkMeshes = state.meshes.filter((mesh) => mesh.material === state.materials.darkConcrete);
  const aisleMeshes = state.meshes.filter((mesh) => mesh.material === state.materials.aisle);
  const ribbonMeshes = state.meshes.filter((mesh) => mesh.material === state.materials.ledRibbon);
  const merged: AbstractMesh[] = [];

  const mergeGroup = (group: Mesh[], name: string) => {
    if (group.length === 0) return;
    if (group.length === 1) {
      group[0].name = name;
      merged.push(group[0]);
      return;
    }
    const result = Mesh.MergeMeshes(group, true, true);
    if (result) {
      result.name = name;
      result.isPickable = false;
      result.checkCollisions = false;
      merged.push(result);
    }
  };

  mergeGroup(concreteMeshes, "rinaRearStandConcrete");
  mergeGroup(darkMeshes, "rinaRearStandDarkConcrete");
  mergeGroup(aisleMeshes, "rinaRearStandAisles");
  mergeGroup(ribbonMeshes, "rinaRearStandRibbons");

  // Preserve any mesh left unmerged, such as the exit sign.
  for (const mesh of state.meshes) {
    if (!mesh.isDisposed() && !merged.includes(mesh)) {
      merged.push(mesh);
    }
  }

  return merged;
}
