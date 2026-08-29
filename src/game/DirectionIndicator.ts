import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { asset } from "../utils/asset";
import type { TerrainHandle } from "./Terrain";
import type { Camera } from "@babylonjs/core/Cameras/camera";

type DirectionIndicatorViewMode = "first" | "third" | "front" | "iso";

type DirectionIndicatorOptions = {
  camera: Camera;
  canvas: HTMLCanvasElement;
  getPlayerPosition: () => Vector3;
  getCheckpoint: () => Vector3 | null;
  getViewMode: () => DirectionIndicatorViewMode;
};

const INDICATOR_TEXTURE_URL = asset("assets/ui/arrow_indicator_right.svg");
const INDICATOR_GROUND_DISTANCE = 1.9;
const INDICATOR_FLOAT_HEIGHT = 0.18;
const INDICATOR_LENGTH = 0.92;
const INDICATOR_WIDTH = 0.58;
const INDICATOR_PATH_OFFSET = 0.1;
const INDICATOR_PATH_HALF_WIDTH = 4.5;
const INDICATOR_PATH_START_Z = -800;
const INDICATOR_PATH_END_Z = 70 * 8 - 8;
const SVG_RIGHT_TO_WORLD_FORWARD_ROTATION = -Math.PI * 0.5;
const HUD_HORIZONTAL_LIMIT = 0.82;
const HUD_EDGE_PADDING = 72;
const HUD_TOP_DESKTOP = 132;
const HUD_TOP_MOBILE = 92;
const HUD_MOBILE_WIDTH = 760;
const RAD_TO_DEGREES = 180 / Math.PI;

export function createDirectionIndicator(
  scene: Scene,
  terrain: TerrainHandle,
  options: DirectionIndicatorOptions
) {
  const root = new TransformNode("directionIndicatorRoot", scene);
  root.setEnabled(false);

  const glow = createIndicatorMesh(scene, "directionIndicatorGlow", INDICATOR_LENGTH, INDICATOR_WIDTH);
  glow.parent = root;
  glow.position.y = 0.006;
  glow.scaling.set(1.42, 1, 1.42);
  glow.material = createIndicatorMaterial(scene, "directionIndicatorGlowMat", new Color3(1, 0.52, 0.15), 0.36);
  glow.renderingGroupId = 2;

  const arrow = createIndicatorMesh(scene, "directionIndicatorArrow", INDICATOR_LENGTH, INDICATOR_WIDTH);
  arrow.parent = root;
  arrow.position.y = 0.018;
  arrow.material = createIndicatorMaterial(scene, "directionIndicatorMat", new Color3(1, 0.74, 0.36), 0.96);
  arrow.renderingGroupId = 2;

  const hudIndicator = createHudIndicator();
  let lastDirection = Vector3.Forward();
  let enabled = true;
  let elapsed = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const checkpoint = options.getCheckpoint();
    const viewMode = options.getViewMode();
    const showGroundIndicator = enabled && !!checkpoint && viewMode === "iso";
    const showHudIndicator = enabled && !!checkpoint && viewMode !== "iso";

    root.setEnabled(showGroundIndicator);
    hudIndicator.classList.toggle("hidden", !showHudIndicator);
    if (!enabled || !checkpoint) return;

    const dt = scene.getEngine().getDeltaTime() * 0.001;
    elapsed += dt;

    const playerPosition = options.getPlayerPosition();
    const direction = checkpoint.subtract(playerPosition);
    direction.y = 0;
    if (direction.lengthSquared() > 0.0001) {
      direction.normalize();
      lastDirection = direction.clone();
    } else {
      direction.copyFrom(lastDirection);
    }

    if (showHudIndicator) {
      updateHudIndicator(options.camera, options.canvas, playerPosition, checkpoint, hudIndicator, elapsed);
      return;
    }

    const center = playerPosition.add(direction.scale(INDICATOR_GROUND_DISTANCE));
    const groundY = terrain.getHeightAt(center.x, center.z) + getPathSurfaceOffset(center);
    const bob = Math.sin(elapsed * 3.3) * 0.018;
    const pulse = 1 + Math.sin(elapsed * 4.6) * 0.04;
    const glowPulse = 1.42 + Math.sin(elapsed * 4.6) * 0.08;

    root.position.set(center.x, groundY + INDICATOR_FLOAT_HEIGHT + bob, center.z);
    root.rotation.y = Math.atan2(direction.x, direction.z) + SVG_RIGHT_TO_WORLD_FORWARD_ROTATION;
    arrow.scaling.set(pulse, 1, pulse);
    glow.scaling.set(glowPulse, 1, glowPulse);
  });

  const dispose = () => {
    scene.onBeforeRenderObservable.remove(observer);
    root.dispose(false, true);
    hudIndicator.remove();
  };

  scene.onDisposeObservable.addOnce(dispose);

  return {
    setEnabled(next: boolean) {
      enabled = next;
    },
    dispose,
  };
}

function createHudIndicator() {
  const indicator = document.createElement("img");
  indicator.src = INDICATOR_TEXTURE_URL;
  indicator.className = "checkpoint-indicator-hud hidden";
  indicator.alt = "";
  indicator.setAttribute("aria-hidden", "true");
  (document.getElementById("hud") ?? document.body).appendChild(indicator);
  return indicator;
}

function updateHudIndicator(
  camera: Camera,
  canvas: HTMLCanvasElement,
  playerPosition: Vector3,
  checkpoint: Vector3,
  indicator: HTMLImageElement,
  elapsed: number
) {
  camera.computeWorldMatrix();

  const targetDirection = checkpoint.subtract(playerPosition);
  targetDirection.y = 0;
  if (targetDirection.lengthSquared() <= 0.0001) targetDirection.copyFrom(Vector3.Forward());
  targetDirection.normalize();

  const cameraForward = camera.getDirection(Vector3.Forward());
  cameraForward.y = 0;
  if (cameraForward.lengthSquared() <= 0.0001) cameraForward.copyFrom(Vector3.Forward());
  cameraForward.normalize();

  const cameraRight = camera.getDirection(new Vector3(1, 0, 0));
  cameraRight.y = 0;
  if (cameraRight.lengthSquared() <= 0.0001) cameraRight.copyFrom(new Vector3(1, 0, 0));
  cameraRight.normalize();

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const aspect = width / height;
  const horizontalFov = 2 * Math.atan(Math.tan(camera.fov * 0.5) * aspect);
  const targetSide = Vector3.Dot(targetDirection, cameraRight);
  const targetAhead = Vector3.Dot(targetDirection, cameraForward);
  const projectedX = targetAhead > 0.001
    ? targetSide / (targetAhead * Math.tan(horizontalFov * 0.5))
    : targetSide * 1.15;
  const normalizedX = clamp(projectedX, -HUD_HORIZONTAL_LIMIT, HUD_HORIZONTAL_LIMIT);
  const markerX = clamp(
    width * 0.5 + normalizedX * width * 0.5,
    HUD_EDGE_PADDING,
    width - HUD_EDGE_PADDING
  );
  const markerY = width < HUD_MOBILE_WIDTH ? HUD_TOP_MOBILE : HUD_TOP_DESKTOP;
  const x = rect.left + markerX;
  const y = rect.top + markerY;
  const directionDegrees = getHudDirectionDegrees(
    camera,
    checkpoint,
    markerX,
    markerY,
    width,
    height,
    horizontalFov
  );
  const pulse = 1 + Math.sin(elapsed * 4.2) * 0.055;
  const opacity = targetAhead > 0 ? 0.96 : 0.72;

  indicator.style.left = `${x}px`;
  indicator.style.top = `${y}px`;
  indicator.style.opacity = `${opacity}`;
  indicator.style.transform = `translate(-50%, -50%) rotate(${directionDegrees}deg) scale(${pulse})`;
}

function getHudDirectionDegrees(
  camera: Camera,
  checkpoint: Vector3,
  markerX: number,
  markerY: number,
  width: number,
  height: number,
  horizontalFov: number
) {
  const toCheckpoint = checkpoint.subtract(camera.globalPosition);
  if (toCheckpoint.lengthSquared() <= 0.0001) return -90;
  toCheckpoint.normalize();

  const cameraForward = camera.getDirection(Vector3.Forward());
  const cameraRight = camera.getDirection(new Vector3(1, 0, 0));
  const cameraUp = camera.getDirection(Vector3.Up());
  if (cameraForward.lengthSquared() > 0) cameraForward.normalize();
  if (cameraRight.lengthSquared() > 0) cameraRight.normalize();
  if (cameraUp.lengthSquared() > 0) cameraUp.normalize();

  const ahead = Vector3.Dot(toCheckpoint, cameraForward);
  const side = Vector3.Dot(toCheckpoint, cameraRight);
  const up = Vector3.Dot(toCheckpoint, cameraUp);

  if (ahead <= 0.001) {
    return Math.atan2(1, side) * RAD_TO_DEGREES;
  }

  const xNdc = side / (ahead * Math.tan(horizontalFov * 0.5));
  const yNdc = up / (ahead * Math.tan(camera.fov * 0.5));
  const targetX = width * 0.5 + xNdc * width * 0.5;
  const targetY = height * 0.5 - yNdc * height * 0.5;
  const dx = targetX - markerX;
  const dy = targetY - markerY;

  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) + Math.abs(dy) < 0.001) {
    return -90;
  }

  return Math.atan2(dy, dx) * RAD_TO_DEGREES;
}

function createIndicatorMesh(scene: Scene, name: string, length: number, width: number) {
  const halfLength = length * 0.5;
  const halfWidth = width * 0.5;
  const mesh = new Mesh(name, scene);
  const positions = [
    -halfLength, 0, -halfWidth,
    halfLength, 0, -halfWidth,
    halfLength, 0, halfWidth,
    -halfLength, 0, halfWidth,
  ];
  const indices = [0, 2, 1, 0, 3, 2];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = [0, 1, 1, 1, 1, 0, 0, 0];
  vertexData.applyToMesh(mesh);

  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.setBoundingInfo(new BoundingInfo(
    new Vector3(-halfLength, -0.02, -halfWidth),
    new Vector3(halfLength, 0.02, halfWidth)
  ));
  return mesh;
}

function createIndicatorMaterial(scene: Scene, name: string, color: Color3, alpha: number) {
  const texture = new Texture(INDICATOR_TEXTURE_URL, scene);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;

  const material = new StandardMaterial(name, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.opacityTexture = texture;
  material.diffuseColor = color;
  material.emissiveColor = color;
  material.alpha = alpha;
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.useAlphaFromDiffuseTexture = true;
  material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
  return material;
}

function getPathSurfaceOffset(position: Vector3) {
  const onPath =
    Math.abs(position.x) <= INDICATOR_PATH_HALF_WIDTH &&
    position.z >= INDICATOR_PATH_START_Z &&
    position.z <= INDICATOR_PATH_END_Z;
  return onPath ? INDICATOR_PATH_OFFSET : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
