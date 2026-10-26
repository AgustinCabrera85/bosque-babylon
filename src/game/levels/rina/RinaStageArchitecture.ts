import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
/** Deliberately structural: this addon only consumes the existing audio envelope. */
export type RinaStageAudioEnvelope = Readonly<{
  playing: boolean;
  energy: number;
  bass: number;
}>;
import { RINA_STAGE_STAIRS, RINA_STADIUM } from "./RinaLevelConfig";
import { createRinaStageSpeakers } from "./RinaStageSpeakers";

/**
 * Architectural expansion for the existing Rina concert stage.
 *
 * This module deliberately DOES NOT create:
 *   - Rina / character animations
 *   - live video cameras / screens
 *   - pyrotechnics / StagePyro
 *   - expensive extra real-time lights
 *   - gameplay colliders
 *
 * RinaStage.ts already owns those things. This builds scene architecture only.
 *
 * IMPORTANT: geometry is authored in the same unscaled LOCAL coordinates as
 * RinaStage.ts. The caller must parent the returned root to `stadiumRoot`
 * AFTER the existing RINA_STADIUM_SCALE transform has been set.
 */
export type StageArchitectureQuality = "desktop" | "mobile";

export interface RinaStageArchitectureHandle {
  readonly root: TransformNode;
  update(dt: number, music: RinaStageAudioEnvelope | null, beatPulse: number): void;
  dispose(): void;
}

type RodData = {
  positions: number[];
  indices: number[];
  normals: number[];
  uvs: number[];
};

function makeMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  emission?: Color3
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = Color3.Black();
  if (emission) m.emissiveColor = emission;
  return m;
}

function addRod(data: RodData, a: Vector3, b: Vector3, thickness: number) {
  const axis = b.subtract(a);
  if (axis.lengthSquared() < 0.0001) return;
  const direction = axis.normalize();
  const guide = Math.abs(direction.y) > 0.92 ? Vector3.Right() : Vector3.Up();
  const u = Vector3.Cross(direction, guide).normalize().scale(thickness * 0.5);
  const v = Vector3.Cross(direction, u).normalize().scale(thickness * 0.5);
  const corners = [u.add(v), u.subtract(v), u.scale(-1).subtract(v), v.subtract(u)];
  for (let side = 0; side < 4; side++) {
    const next = (side + 1) % 4;
    const p0 = a.add(corners[side]);
    const p1 = a.add(corners[next]);
    const p2 = b.add(corners[next]);
    const p3 = b.add(corners[side]);
    const normal = Vector3.Cross(p1.subtract(p0), p3.subtract(p0)).normalize();
    const offset = data.positions.length / 3;
    for (const p of [p0, p1, p2, p3]) {
      data.positions.push(p.x, p.y, p.z);
      data.normals.push(normal.x, normal.y, normal.z);
    }
    data.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    data.indices.push(offset, offset + 1, offset + 2,
      offset, offset + 2, offset + 3);
  }
}

function addTruss(
  data: RodData,
  start: Vector3,
  end: Vector3,
  halfWidth: number,
  cells: number
) {
  const axis = end.subtract(start).normalize();
  const guide = Math.abs(axis.y) > 0.92 ? Vector3.Right() : Vector3.Up();
  const u = Vector3.Cross(axis, guide).normalize().scale(halfWidth);
  const v = Vector3.Cross(axis, u).normalize().scale(halfWidth);
  const corners = [u.add(v), u.subtract(v), v.scale(-1).subtract(u), v.subtract(u)];
  for (const corner of corners) {
    addRod(data, start.add(corner), end.add(corner), 0.105);
  }
  for (let c = 0; c < cells; c++) {
    const t0 = c / cells;
    const t1 = (c + 1) / cells;
    const p0 = Vector3.Lerp(start, end, t0);
    const p1 = Vector3.Lerp(start, end, t1);
    for (let face = 0; face < 4; face++) {
      const next = (face + 1) % 4;
      if (c % 2 === 0) {
        addRod(data, p0.add(corners[face]), p1.add(corners[next]), 0.06);
      } else {
        addRod(data, p0.add(corners[next]), p1.add(corners[face]), 0.06);
      }
      if (c === 0 || c === cells - 1 || c % 3 === 0) {
        addRod(data, p0.add(corners[face]), p0.add(corners[next]), 0.06);
      }
    }
  }
}

function makeMetalTrusses(scene: Scene, root: TransformNode, mobile: boolean, stageZ: number) {
  const data: RodData = { positions: [], indices: [], normals: [], uvs: [] };
  const zRear = stageZ + 7.8;
  const zFront = stageZ - 8;

  // Front / rear overhead gantries and longitudinal outriggers.
  addTruss(data, new Vector3(-34, 24.8, zRear), new Vector3(34, 24.8, zRear), 0.34, 25);
  addTruss(data, new Vector3(-32, 21.5, zFront), new Vector3(32, 21.5, zFront), 0.3, 23);
  addTruss(data, new Vector3(-33.3, 0, zRear), new Vector3(-33.3, 24.8, zRear), 0.31, 11);
  addTruss(data, new Vector3(33.3, 0, zRear), new Vector3(33.3, 24.8, zRear), 0.31, 11);
  addTruss(data, new Vector3(-33, 21.5, zFront), new Vector3(-33, 24.8, zRear), 0.26, 8);
  addTruss(data, new Vector3(33, 21.5, zFront), new Vector3(33, 24.8, zRear), 0.26, 8);
  addTruss(data, new Vector3(0, 21.5, zFront), new Vector3(0, 24.8, zRear), 0.22, 8);
  if (!mobile) {
    addTruss(data, new Vector3(-18, 21.5, zFront), new Vector3(-18, 24.8, zRear), 0.19, 8);
    addTruss(data, new Vector3(18, 21.5, zFront), new Vector3(18, 24.8, zRear), 0.19, 8);
  }

  // Suspend the halo from the truss. Dark hardware, not emissive light ropes.
  const radius = 10.8;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = stageZ + Math.sin(angle) * radius * 0.55;
    addRod(data, new Vector3(x, 24.7, z), new Vector3(x, 21.9, z), 0.055);
  }

  const mesh = new Mesh("rinaV2_AllTrussStructure", scene);
  const vertexData = new VertexData();
  vertexData.positions = data.positions;
  vertexData.indices = data.indices;
  vertexData.normals = data.normals;
  vertexData.uvs = data.uvs;
  vertexData.applyToMesh(mesh);
  mesh.material = makeMaterial(scene, "rinaV2TrussMetal",
    new Color3(0.095, 0.105, 0.122),
    new Color3(0.012, 0.015, 0.024));
  mesh.parent = root;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  return mesh;
}

export function createRinaStageArchitecture(
  scene: Scene,
  quality: StageArchitectureQuality
): RinaStageArchitectureHandle {
  const mobile = quality === "mobile";
  const root = new TransformNode("rinaStageV2Root", scene);
  const owned: Mesh[] = [];
  let disposed = false;
  let elapsed = 0;
  let ledsActive = 0.5;

  const magenta = makeMaterial(scene, "rinaV2MagentaLED", Color3.Black(),
    new Color3(0.72, 0.035, 0.48));
  const cyan = makeMaterial(scene, "rinaV2CyanLED", Color3.Black(),
    new Color3(0.015, 0.36, 0.84));
  const white = makeMaterial(scene, "rinaV2IceLED", Color3.Black(),
    new Color3(0.52, 0.78, 1.0));
  const charcoal = makeMaterial(scene, "rinaV2Charcoal",
    new Color3(0.021, 0.025, 0.034));
  const stageFloor = makeMaterial(scene, "rinaV2Platform",
    new Color3(0.042, 0.045, 0.054));
  const blackSteel = makeMaterial(scene, "rinaV2BlackSteel",
    new Color3(0.062, 0.068, 0.082));

  const groups = new Map<StandardMaterial, Mesh[]>();
  const allMaterials = [magenta, cyan, white, charcoal, stageFloor, blackSteel];
  function box(
    name: string, x: number, y: number, z: number,
    width: number, height: number, depth: number, material: StandardMaterial,
    batch = true
  ) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.parent = root;
    owned.push(mesh);
    if (batch) {
      const list = groups.get(material) ?? [];
      list.push(mesh);
      groups.set(material, list);
    }
    return mesh;
  }
  const stage = RINA_STADIUM.stage;
  const z = stage.centerZ;
  const mainDeckY = stage.height;

  // Scenic back wall. Existing live video screens remain in front of it.
  box("rinaV2RearStageWall", 0, 11.7, z + 10.25, 64, 19, 1.5, charcoal);
  for (const side of [-1, 1]) {
    box(`rinaV2RearWing_${side}`, side * 29.4, 10.6, z + 6.0,
      7, 15.5, 5.2, charcoal);
    box(`rinaV2SideWing_${side}`, side * 31.3, 5.7, z - 1.1,
      3.4, 7.0, 12.2, blackSteel);
  }

  makeMetalTrusses(scene, root, mobile, z);

  // Screens already belong to RinaStage.ts, including their live RTT camera.
  // Draw emissive borders only, in FRONT of the existing screen pictures.
  const screenY = stage.height + 12.5 * 0.5 + 1.1;
  const screenFront = z + 6.5 - 0.66;
  for (const side of [-1, 1]) {
    const x = side * 20;
    const width = 18.2;
    const height = 13.65;
    for (const xOffset of [-width / 2, width / 2]) {
      box(`rinaV2ScreenBorderVertical_${side}_${xOffset}`, x + xOffset,
        screenY, screenFront, 0.31, height, 0.21,
        side < 0 ? magenta : cyan);
    }
    for (const yOffset of [-height / 2, height / 2]) {
      box(`rinaV2ScreenBorderHorizontal_${side}_${yOffset}`, x,
        screenY + yOffset, screenFront, width + 0.3, 0.3, 0.21,
        side < 0 ? magenta : cyan);
    }
    // A dark metal back frame visually anchors the TV to the scaffolding.
    box(`rinaV2ScreenFrameSill_${side}`, x,
      screenY - height / 2 - 0.26, screenFront + 0.65,
      width + 1.2, 0.32, 1.15, blackSteel);
  }

  // Overhead suspended rings and hanging LED tubes. These sit behind Rina.
  const haloCenterZ = z + 1.3;
  const haloY = 21.9;
  const rings: Array<{ diameter: number; thickness: number; y: number; material: StandardMaterial }> = [
    { diameter: 22.4, thickness: 0.19, y: haloY + 0.24, material: magenta },
    { diameter: 19.7, thickness: 0.14, y: haloY, material: cyan },
    { diameter: 17.2, thickness: 0.11, y: haloY - 0.26, material: white },
  ];
  for (let i = 0; i < rings.length; i++) {
    const cfg = rings[i];
    const ring = MeshBuilder.CreateTorus(`rinaV2HaloRing_${i}`,
      { diameter: cfg.diameter, thickness: cfg.thickness,
        tessellation: mobile ? 40 : 72 }, scene);
    ring.position.set(0, cfg.y, haloCenterZ);
    ring.material = cfg.material;
    ring.parent = root;
    ring.isPickable = false;
    ring.checkCollisions = false;
    owned.push(ring);
  }
  const tubeCount = mobile ? 9 : 16;
  for (let i = 0; i < tubeCount; i++) {
    const a = (i / tubeCount) * Math.PI * 2;
    const rx = Math.cos(a) * 8.65;
    const rz = haloCenterZ + Math.sin(a) * 8.65;
    // Front tubes are short, so Rina remains visible on the central runway.
    const tubeLength = rz < z - 1 ? 2.7 : 5.8 + 2.2 * Math.sin(i * 2.23) ** 2;
    box(`rinaV2RingTube_${i}`, rx, haloY - tubeLength / 2 - 0.35,
      rz, 0.11, tubeLength, 0.11, i % 3 === 0 ? white : i % 2 ? cyan : magenta);
  }

  // Center-back vertical light columns extend around the existing tower.
  const barCount = mobile ? 8 : 13;
  for (let i = 0; i < barCount; i++) {
    const x = (i - (barCount - 1) * 0.5) * 1.35;
    if (Math.abs(x) < 4.9) continue; // RinaStage already draws the center bars.
    const h = 10.5 + (i % 4) * 1.2;
    box(`rinaV2BackdropColumn_${i}`, x, mainDeckY + h * 0.5 + 2.2,
      z + 6.1, 0.42, h, 0.24, i % 2 ? cyan : magenta);
  }
  for (const side of [-1, 1]) {
    const x = side * 31.7;
    for (let i = 0; i < (mobile ? 4 : 7); i++) {
      const y = mainDeckY + 2.8 + i * 2.2;
      box(`rinaV2SideLight_${side}_${i}`, x, y, z - 3.5,
        0.45, 0.9, 0.28, i % 2 ? magenta : cyan);
    }
  }

  // Preserve the existing main deck and catwalk; add stage-edge strips only.
  box("rinaV2StageLipMagenta", 0, mainDeckY + 0.065,
    stage.frontZ - 0.11, stage.width - 1.5, 0.15, 0.14, magenta);
  box("rinaV2StageLipCyan", 0, mainDeckY - 0.25,
    stage.frontZ - 0.13, stage.width - 1.5, 0.10, 0.14, cyan);
  const runway = stage.catwalk;
  const runwayFront = runway.centerZ - runway.depth / 2;
  const runwayBack = runway.centerZ + runway.depth / 2;
  const runwayY = mainDeckY + 0.04;
  for (const side of [-1, 1]) {
    box(`rinaV2RunwayRail_${side}`, side * (runway.width * 0.5 - 0.2),
      runwayY, runway.centerZ,
      0.13, 0.11, runway.depth - 0.35, side === -1 ? magenta : cyan);
  }
  box("rinaV2RunwayNose", 0, runwayY, runwayFront + 0.12,
    runway.width - 0.25, 0.12, 0.19, white);
  for (let i = 1; i < 6; i++) {
    const zPos = runwayFront + (runwayBack - runwayFront) * i / 6;
    box(`rinaV2RunwayCrossLight_${i}`, 0, runwayY - 0.014, zPos,
      runway.width - 0.54, 0.035, 0.065, i % 2 ? cyan : magenta);
  }

  // Symmetric stairs share their dimensions with the walkable surface.
  const stairCount = RINA_STAGE_STAIRS.steps[quality];
  for (const side of [-1, 1]) {
    for (let i = 0; i < stairCount; i++) {
      const stepH = mainDeckY * (i + 1) / stairCount;
      const stepD = RINA_STAGE_STAIRS.stepDepth;
      const stepZ = stage.frontZ - (stairCount - i - 0.5) * stepD;
      box(`rinaV2Stair_${side}_${i}`, side * RINA_STAGE_STAIRS.centerX,
        stepH / 2, stepZ, RINA_STAGE_STAIRS.width, stepH, stepD,
        stageFloor);
      box(`rinaV2StairNose_${side}_${i}`, side * RINA_STAGE_STAIRS.centerX,
        stepH + 0.035, stepZ - stepD / 2 + 0.10,
        RINA_STAGE_STAIRS.width - 0.2, 0.075, 0.11, i % 2 ? cyan : magenta);
    }
  }

  // Elevated band platforms and speaker arrays give the stage real mass.
  for (const side of [-1, 1]) {
    box(`rinaV2BandRiser_${side}`, side * 13.4,
      mainDeckY + 0.68, z + 0.2,
      12.8, 1.36, 7.8, stageFloor);
    box(`rinaV2BandRiserEdge_${side}`, side * 13.4,
      mainDeckY + 1.4, z - 3.69,
      12.4, 0.13, 0.14, side < 0 ? magenta : cyan);
  }

  // Speaker/monitor geometry is now a reusable, batched physical PA system.
  // It shares 2 small procedural grille textures across all cabinets.
  const speakerRig = createRinaStageSpeakers(scene, root, {
    stageWidth: stage.width,
    stageFrontZ: stage.frontZ,
    stageHeight: stage.height,
    mobile,
  });

  // RINA logo: a real 3D quad with generated local canvas graphics, not a photo
  // of the whole stage. Babylon builds the lettering texture in the browser.
  const logoTexture = new DynamicTexture(
    "rinaV2SignTexture", { width: 1024, height: 256 }, scene, false
  );
  const ctx = logoTexture.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#09040e";
  ctx.fillRect(0, 0, 1024, 256);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 200px Georgia";
  ctx.shadowColor = "rgba(245,60,225,0.95)";
  ctx.shadowBlur = 28;
  ctx.fillStyle = "#f1a9ef";
  ctx.fillText("RINA", 512, 129, 880);
  ctx.shadowBlur = 0;
  logoTexture.update(false);
  const signMat = new StandardMaterial("rinaV2LogoMaterial", scene);
  signMat.diffuseColor = Color3.Black();
  signMat.emissiveTexture = logoTexture;
  signMat.emissiveColor = Color3.White();
  signMat.disableLighting = true;
  signMat.backFaceCulling = false;
  const logo = MeshBuilder.CreatePlane("rinaV2RinaLogo", {
    width: 10.4, height: 2.55
  }, scene);
  logo.position.set(0, 26.65, z + 7.4);
  logo.material = signMat;
  logo.parent = root;
  logo.isPickable = false;
  logo.checkCollisions = false;
  owned.push(logo);
  allMaterials.push(signMat);

  // Merge ordinary static box details by shared material for far fewer draw
  // calls. Keep the 3 halo toruses and the generated sign as separate meshes.
  for (const [sharedMaterial, meshes] of groups) {
    if (meshes.length < 2) continue;
    for (const mesh of meshes) mesh.computeWorldMatrix(true);
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (merged) {
      merged.name = `rinaV2Merged_${sharedMaterial.name}`;
      merged.material = sharedMaterial;
      merged.parent = root;
      merged.isPickable = false;
      merged.checkCollisions = false;
      owned.push(merged);
    }
  }

  function update(dt: number, music: RinaStageAudioEnvelope | null, beatPulse: number) {
    if (disposed) return;
    elapsed += Math.max(0, dt);
    const energy = music?.playing ? Math.max(0, Math.min(1, music.energy)) : 0.28;
    const bass = music?.playing ? Math.max(0, Math.min(1, music.bass)) : 0.12;
    const target = Math.min(1.65,
      0.33 + energy * 0.72 + bass * 0.33 + Math.max(0, beatPulse) * 0.45
    );
    ledsActive += (target - ledsActive) * Math.min(1, dt * 7.8);
    const wave = 0.92 + 0.08 * Math.sin(elapsed * 1.6);
    magenta.emissiveColor.copyFromFloats(
      0.78 * ledsActive * wave,
      0.045 * ledsActive,
      0.53 * ledsActive * wave
    );
    cyan.emissiveColor.copyFromFloats(
      0.027 * ledsActive,
      0.43 * ledsActive * (1.04 - 0.08 * wave),
      0.95 * ledsActive
    );
    white.emissiveColor.copyFromFloats(
      0.42 + beatPulse * 0.35,
      0.62 + beatPulse * 0.34,
      0.87 + beatPulse * 0.20
    );
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    speakerRig.dispose();
    root.dispose(false, false);
    logoTexture.dispose();
    for (const material of allMaterials) material.dispose();
  }

  return { root, update, dispose };
}
