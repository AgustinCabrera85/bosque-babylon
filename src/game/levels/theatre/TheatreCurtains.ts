import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PBRCustomMaterial } from "@babylonjs/materials/custom/pbrCustomMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../utils/asset";

const CURTAIN_TEXTURE =
  "assets/textures/theatre/curtains/curtain-velvet-red.png";
const SIDE_WIDTH = 4.4;
const CURTAIN_HEIGHT = 24;
const TOP_FADE_START_Y = 9;
const TOP_FADE_END_Y = 14;
const MODULES_PER_SIDE = 2;
const HORIZONTAL_SEGMENTS = 28;
const VERTICAL_SEGMENTS = 8;
const FOLDS_PER_MODULE = 2;
const FOLD_DEPTH = 0.3;

export const THEATRE_CURTAIN_LAYOUT = {
  centerAbsX: 5.3,
  width: SIDE_WIDTH,
  z: -0.8,
} as const;

function deterministicNoise(index: number, salt: number) {
  let value =
    Math.imul(index + 31, 0x9e3779b1) ^
    Math.imul(salt + 17, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function createVelvetMaterial(scene: Scene) {
  const texture = new Texture(asset(CURTAIN_TEXTURE), scene);
  texture.wrapU = Texture.MIRROR_ADDRESSMODE;
  texture.wrapV = Texture.MIRROR_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  texture.hasAlpha = false;

  const material = new PBRCustomMaterial("theatreCurtainVelvet", scene);
  material.albedoTexture = texture;
  material.albedoColor = new Color3(0.5, 0.42, 0.42);
  material.metallic = 0;
  material.roughness = 0.82;
  material.environmentIntensity = 0.35;
  material.backFaceCulling = false;
  material.twoSidedLighting = true;
  material.fogEnabled = true;
  material.Fragment_Before_FragColor(`
    float curtainTopFade = smoothstep(
      ${TOP_FADE_START_Y.toFixed(1)},
      ${TOP_FADE_END_Y.toFixed(1)},
      vPositionW.y
    );
    finalColor.rgb *= 1.0 - curtainTopFade;
  `);
  return material;
}

function createCurtainModule(
  scene: Scene,
  moduleIndex: number,
  width: number,
  material: PBRCustomMaterial
) {
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const uScale = 0.57 + deterministicNoise(moduleIndex, 11) * 0.07;
  const uOffset = deterministicNoise(moduleIndex, 19) * 0.31;
  const vScale = 3.45 + deterministicNoise(moduleIndex, 29) * 0.35;
  const vOffset = deterministicNoise(moduleIndex, 37) * 0.43;

  for (let row = 0; row <= VERTICAL_SEGMENTS; row += 1) {
    const v = row / VERTICAL_SEGMENTS;
    const amplitude = FOLD_DEPTH * (0.82 + v * 0.18);
    for (let column = 0; column <= HORIZONTAL_SEGMENTS; column += 1) {
      const u = column / HORIZONTAL_SEGMENTS;
      const localX = (u - 0.5) * width;
      const foldPhase = u * Math.PI * 2 * FOLDS_PER_MODULE;
      const localZ =
        Math.sin(foldPhase) * amplitude +
        Math.sin(foldPhase * 2) * amplitude * 0.12;
      positions.push(localX, (v - 0.5) * CURTAIN_HEIGHT, localZ);
      uvs.push(uOffset + u * uScale, vOffset + v * vScale);
    }
  }

  const rowLength = HORIZONTAL_SEGMENTS + 1;
  for (let row = 0; row < VERTICAL_SEGMENTS; row += 1) {
    for (let column = 0; column < HORIZONTAL_SEGMENTS; column += 1) {
      const lowerLeft = row * rowLength + column;
      const lowerRight = lowerLeft + 1;
      const upperLeft = lowerLeft + rowLength;
      const upperRight = upperLeft + 1;
      indices.push(
        lowerLeft,
        lowerRight,
        upperLeft,
        lowerRight,
        upperRight,
        upperLeft
      );
    }
  }

  VertexData.ComputeNormals(positions, indices, normals);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;

  const mesh = new Mesh(`theatreCurtainModule_${moduleIndex}`, scene);
  vertexData.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return mesh;
}

export function createTheatreCurtains(
  scene: Scene,
  parent: TransformNode
) {
  const material = createVelvetMaterial(scene);
  const moduleWidth = SIDE_WIDTH / MODULES_PER_SIDE;

  for (const side of [-1, 1] as const) {
    const sideRoot = new TransformNode(`theatreCurtainSide_${side}`, scene);
    sideRoot.parent = parent;
    sideRoot.position.set(
      side * THEATRE_CURTAIN_LAYOUT.centerAbsX,
      CURTAIN_HEIGHT * 0.5,
      THEATRE_CURTAIN_LAYOUT.z
    );
    sideRoot.rotation.z = side * 0.08;

    for (let localIndex = 0; localIndex < MODULES_PER_SIDE; localIndex += 1) {
      const moduleIndex = (side > 0 ? MODULES_PER_SIDE : 0) + localIndex;
      const curtain = createCurtainModule(
        scene,
        moduleIndex,
        moduleWidth,
        material
      );
      curtain.parent = sideRoot;
      curtain.position = new Vector3(
        -SIDE_WIDTH * 0.5 + moduleWidth * (localIndex + 0.5),
        0,
        0
      );
    }
  }
}
