import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import {
  createTheatreStaircaseMaterial,
  type TheatreStaircaseMaterialHandle,
} from "./TheatreStaircaseMaterial";

export const STAIR_CONFIG = {
  startZ: 0,
  stepCount: 74,
  stepDepth: 1.5,
  stepRise: 0.43,
  baseWidth: 12.5,
  topWidth: 7.2,
};

export type StaircaseHandle = {
  root: TransformNode;
  endZ: number;
  topY: number;
  getHeightAt: (z: number) => number;
  material: TheatreStaircaseMaterialHandle;
};

type StairSurfaceData = {
  positions: number[];
  indices: number[];
  uvs: number[];
};

function appendSurfaceQuad(data: StairSurfaceData, points: Vector3[], uv: number[]) {
  const vertexOffset = data.positions.length / 3;
  for (const point of points) data.positions.push(point.x, point.y, point.z);
  data.uvs.push(...uv);
  data.indices.push(
    vertexOffset,
    vertexOffset + 1,
    vertexOffset + 2,
    vertexOffset,
    vertexOffset + 2,
    vertexOffset + 3
  );
}

function transformStepPoint(point: Vector3, centerZ: number, angle: number) {
  if (angle === 0) return point;
  const local = point.subtract(new Vector3(0, 0, centerZ));
  return Vector3.TransformCoordinates(local, Matrix.RotationY(angle)).addInPlaceFromFloats(0, 0, centerZ);
}

export function createExpressionistStaircase(scene: Scene): StaircaseHandle {
  const root = new TransformNode("expressionistStaircase", scene);
  const staircaseMaterial = createTheatreStaircaseMaterial(scene);
  const surfaceData: StairSurfaceData = { positions: [], indices: [], uvs: [] };
  const sideData: StairSurfaceData = { positions: [], indices: [], uvs: [] };
  const totalSurfaceLength =
    STAIR_CONFIG.stepCount * (STAIR_CONFIG.stepRise + STAIR_CONFIG.stepDepth);
  const stepDepthOverlap = 0.045;
  const riserSurfaceOffset = 0.014;
  const treadSurfaceOffset = 0.026;

  for (let i = 0; i < STAIR_CONFIG.stepCount; i += 1) {
    const t = i / Math.max(1, STAIR_CONFIG.stepCount - 1);
    const width = STAIR_CONFIG.baseWidth + (STAIR_CONFIG.topWidth - STAIR_CONFIG.baseWidth) * t;
    const zStart = STAIR_CONFIG.startZ + i * STAIR_CONFIG.stepDepth;
    const zEnd = zStart + STAIR_CONFIG.stepDepth;
    const topY = (i + 1) * STAIR_CONFIG.stepRise;
    const previousTopY = i * STAIR_CONFIG.stepRise;
    const stepFrontZ = zStart - stepDepthOverlap * 0.5;
    const treadEndZ = zEnd - stepDepthOverlap * 0.5;
    const angle = i > 8 && i % 11 === 0 ? (i % 22 === 0 ? 1 : -1) * 0.018 : 0;
    const pathStart = i * (STAIR_CONFIG.stepRise + STAIR_CONFIG.stepDepth);
    const riserTopV = (pathStart + STAIR_CONFIG.stepRise) / totalSurfaceLength;
    const treadEndV =
      (pathStart + STAIR_CONFIG.stepRise + STAIR_CONFIG.stepDepth) / totalSurfaceLength;
    const pathStartV = pathStart / totalSurfaceLength;
    const halfWidth = width * 0.5;
    const point = (x: number, y: number, z: number) =>
      transformStepPoint(new Vector3(x, y, z), (zStart + zEnd) * 0.5, angle);

    appendSurfaceQuad(sideData, [
      point(-halfWidth, previousTopY, stepFrontZ),
      point(-halfWidth, previousTopY, treadEndZ),
      point(-halfWidth, topY, treadEndZ),
      point(-halfWidth, topY, stepFrontZ),
    ], [0, 0, 1, 0, 1, 1, 0, 1]);
    appendSurfaceQuad(sideData, [
      point(halfWidth, previousTopY, stepFrontZ),
      point(halfWidth, topY, stepFrontZ),
      point(halfWidth, topY, treadEndZ),
      point(halfWidth, previousTopY, treadEndZ),
    ], [0, 0, 0, 1, 1, 1, 1, 0]);
    appendSurfaceQuad(sideData, [
      point(-halfWidth, previousTopY, stepFrontZ),
      point(halfWidth, previousTopY, stepFrontZ),
      point(halfWidth, previousTopY, treadEndZ),
      point(-halfWidth, previousTopY, treadEndZ),
    ], [0, 0, 1, 0, 1, 1, 0, 1]);
    appendSurfaceQuad(sideData, [
      point(-halfWidth, previousTopY, treadEndZ),
      point(halfWidth, previousTopY, treadEndZ),
      point(halfWidth, topY, treadEndZ),
      point(-halfWidth, topY, treadEndZ),
    ], [0, 0, 1, 0, 1, 1, 0, 1]);

    appendSurfaceQuad(surfaceData, [
      point(-halfWidth, previousTopY, stepFrontZ - riserSurfaceOffset),
      point(-halfWidth, topY, stepFrontZ - riserSurfaceOffset),
      point(halfWidth, topY, stepFrontZ - riserSurfaceOffset),
      point(halfWidth, previousTopY, stepFrontZ - riserSurfaceOffset),
    ], [0, pathStartV, 0, riserTopV, 1, riserTopV, 1, pathStartV]);
    appendSurfaceQuad(surfaceData, [
      point(-halfWidth, topY + treadSurfaceOffset, stepFrontZ),
      point(-halfWidth, topY + treadSurfaceOffset, treadEndZ),
      point(halfWidth, topY + treadSurfaceOffset, treadEndZ),
      point(halfWidth, topY + treadSurfaceOffset, stepFrontZ),
    ], [0, riserTopV, 0, treadEndV, 1, treadEndV, 1, riserTopV]);
  }

  const surfaceNormals: number[] = [];
  VertexData.ComputeNormals(surfaceData.positions, surfaceData.indices, surfaceNormals);
  const surfaceVertexData = new VertexData();
  surfaceVertexData.positions = surfaceData.positions;
  surfaceVertexData.indices = surfaceData.indices;
  surfaceVertexData.normals = surfaceNormals;
  surfaceVertexData.uvs = surfaceData.uvs;
  const surface = new Mesh("staircaseContinuousSurface", scene);
  surfaceVertexData.applyToMesh(surface, true);
  surface.parent = root;
  surface.material = staircaseMaterial.material;
  surface.receiveShadows = true;
  surface.isPickable = false;

  const sideNormals: number[] = [];
  VertexData.ComputeNormals(sideData.positions, sideData.indices, sideNormals);
  const sideVertexData = new VertexData();
  sideVertexData.positions = sideData.positions;
  sideVertexData.indices = sideData.indices;
  sideVertexData.normals = sideNormals;
  sideVertexData.uvs = sideData.uvs;
  const sides = new Mesh("staircaseLateralShell", scene);
  sideVertexData.applyToMesh(sides, true);
  sides.parent = root;
  sides.material = staircaseMaterial.sideMaterial;
  sides.receiveShadows = true;
  sides.isPickable = false;

  const slabMaterial = new StandardMaterial("expressionistSlab", scene);
  slabMaterial.diffuseColor = new Color3(0.018, 0.018, 0.021);
  slabMaterial.specularColor = Color3.Black();
  for (let i = 0; i < 18; i += 1) {
    const t = i / 17;
    const z = 4 + t * 101;
    const y = 2.5 + t * 28;
    const side = i % 2 === 0 ? -1 : 1;
    const slab = MeshBuilder.CreateBox(
      `slab_${i}`,
      { width: 0.32, height: 8 + (i % 4) * 2.4, depth: 2.2 },
      scene
    );
    slab.parent = root;
    slab.position = new Vector3(side * (7.8 + (i % 3) * 1.6), y + 2, z);
    slab.rotation.z = side * (0.08 + (i % 5) * 0.025);
    slab.rotation.y = side * 0.18;
    slab.material = slabMaterial;
    slab.isPickable = false;
  }

  const endZ = STAIR_CONFIG.startZ + STAIR_CONFIG.stepCount * STAIR_CONFIG.stepDepth;
  const topY = STAIR_CONFIG.stepCount * STAIR_CONFIG.stepRise;
  const portalFrameMaterial = new StandardMaterial("portalFrame", scene);
  portalFrameMaterial.diffuseColor = new Color3(0.12, 0.12, 0.13);
  portalFrameMaterial.emissiveColor = new Color3(0.025, 0.025, 0.028);
  const portalLightMaterial = new StandardMaterial("portalLight", scene);
  portalLightMaterial.diffuseColor = new Color3(0.75, 0.75, 0.7);
  portalLightMaterial.emissiveColor = new Color3(0.62, 0.6, 0.54);
  portalLightMaterial.disableLighting = true;
  const portalZ = endZ + 1.2;
  const portalY = topY + 2.1;
  const left = MeshBuilder.CreateBox("portalLeft", { width: 0.35, height: 5.2, depth: 0.7 }, scene);
  const right = left.clone("portalRight")!;
  const top = MeshBuilder.CreateBox("portalTop", { width: 3.5, height: 0.35, depth: 0.7 }, scene);
  left.parent = right.parent = top.parent = root;
  left.position.set(-1.55, portalY, portalZ);
  right.position.set(1.55, portalY, portalZ);
  top.position.set(0, portalY + 2.42, portalZ);
  left.material = right.material = top.material = portalFrameMaterial;
  const slit = MeshBuilder.CreatePlane("portalSlit", { width: 0.34, height: 4.3 }, scene);
  slit.parent = root;
  slit.position.set(0, portalY, portalZ - 0.37);
  slit.material = portalLightMaterial;
  slit.isPickable = false;

  const getHeightAt = (z: number) => {
    if (z <= STAIR_CONFIG.startZ) return 0;
    const index = Math.floor((z - STAIR_CONFIG.startZ) / STAIR_CONFIG.stepDepth);
    const clamped = Math.max(0, Math.min(STAIR_CONFIG.stepCount, index + 1));
    return clamped * STAIR_CONFIG.stepRise;
  };
  return { root, endZ, topY, getHeightAt, material: staircaseMaterial };
}
