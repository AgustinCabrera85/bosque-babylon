import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

/**
 * All measurements are in RinaStage.ts LOCAL metres, before stadiumRoot's 1.5x scale.
 * Deliberately presentation-only: neither collisions nor physical speaker forces.
 */
export type RinaSpeakerRigOptions = Readonly<{
  stageWidth: number;
  stageFrontZ: number;
  stageHeight: number;
  mobile?: boolean;
}>;

export type RinaSpeakerRigHandle = {
  readonly root: TransformNode;
  /** Frees procedural textures/materials. Child geometry is owned by scene/root. */
  dispose(): void;
};

function mat(scene: Scene, name: string, color: Color3, shine = 0.07) {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = color;
  result.specularColor = new Color3(shine, shine, shine * 1.10);
  result.specularPower = 72;
  result.backFaceCulling = false;
  return result;
}

/** Real shallow dark perforations, outlined frames, ghosted woofer circles.
 *  Same tiny generated texture is reused by every line-array cabinet.
 */
function buildGrille(scene: Scene, name: string, subwoofer: boolean) {
  const width = 512;
  const height = subwoofer ? 512 : 256;
  const texture = new DynamicTexture(name, { width, height }, scene, false);
  const ctx = texture.getContext();
  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#353c43");
  base.addColorStop(0.37, "#252c33");
  base.addColorStop(0.73, "#303842");
  base.addColorStop(1, "#141a21");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  function woofer(cx: number, cy: number, radius: number) {
    const shadow = ctx.createRadialGradient(cx, cy, radius * 0.18, cx, cy, radius);
    shadow.addColorStop(0, "rgba(5,7,10,.88)");
    shadow.addColorStop(0.62, "rgba(4,6,10,.78)");
    shadow.addColorStop(0.78, "rgba(2,3,6,.95)");
    shadow.addColorStop(0.86, "rgba(95,104,110,.46)");
    shadow.addColorStop(0.95, "rgba(8,11,14,.78)");
    shadow.addColorStop(1, "rgba(8,11,14,0)");
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = shadow;
    ctx.fill();
  }

  if (subwoofer) {
    woofer(256, 252, 187);
  } else {
    woofer(130, 130, 113);
    woofer(383, 130, 113);
    ctx.fillStyle = "rgba(4,6,8,.76)";
    ctx.fillRect(223, 39, 66, 183);
    ctx.fillStyle = "rgba(70,78,88,.37)";
    for (let y = 49; y <= 202; y += 25) ctx.fillRect(231, y, 50, 3);
  }

  // Aligned/staggered perforations. A one-pixel glint makes the holes readable
  // under low contrast lighting without becoming a luminous dotted pattern.
  for (let y = 10, row = 0; y < height - 8; y += 10, row++) {
    for (let x = 10 + (row % 2) * 5; x < width - 8; x += 11) {
      ctx.fillStyle = "rgba(1,3,5,.95)";
      ctx.beginPath();
      ctx.arc(x, y, 2.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(175,183,193,.16)";
      ctx.fillRect(x - 1.6, y - 3.15, 3.2, 0.8);
    }
  }

  const shade = ctx.createLinearGradient(0, 0, width, 0);
  shade.addColorStop(0, "rgba(0,0,0,.48)");
  shade.addColorStop(0.10, "rgba(0,0,0,0)");
  shade.addColorStop(0.89, "rgba(0,0,0,.05)");
  shade.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#4a5158";
  ctx.lineWidth = subwoofer ? 7 : 5;
  ctx.strokeRect(5, 5, width - 10, height - 10);
  ctx.strokeStyle = "rgba(0,0,0,.80)";
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, width - 24, height - 24);
  texture.update(false);
  texture.hasAlpha = false;
  return texture;
}

/**
 * Build the stage PA with 5 shared opaque materials and TWO generated textures.
 * Box details are merged by material when possible, so hundreds of little
 * cabinet screws / rails do not become hundreds of draw calls.
 */
export function createRinaStageSpeakers(
  scene: Scene,
  parent: TransformNode,
  options: RinaSpeakerRigOptions
): RinaSpeakerRigHandle {
  const root = new TransformNode("rinaV3SpeakerRig", scene);
  root.parent = parent;
  const body = mat(scene, "rinaSpeakerCharcoalCabinet", new Color3(.043, .051, .061));
  const frame = mat(scene, "rinaSpeakerHardRubberFrame", new Color3(.080, .085, .093));
  const metal = mat(scene, "rinaSpeakerHangingMetal", new Color3(.24, .25, .28), .23);
  const recess = mat(scene, "rinaSpeakerSideRecess", new Color3(.014, .018, .024));
  const grille = mat(scene, "rinaSpeakerPerforatedGrille", Color3.White(), .16);
  const subGrille = mat(scene, "rinaSpeakerSubwooferGrille", Color3.White(), .13);
  const grilleTexture = buildGrille(scene, "rinaSpeakerGrilleTexture", false);
  const subTexture = buildGrille(scene, "rinaSubwooferGrilleTexture", true);
  grille.diffuseTexture = grilleTexture;
  subGrille.diffuseTexture = subTexture;
  // Reflected stage spill, deliberately faint and not neon: the patterns remain
  // legible when the concert scene goes dark without turning speakers into LEDs.
  grille.emissiveTexture = grilleTexture;
  subGrille.emissiveTexture = subTexture;
  grille.emissiveColor = new Color3(.095, .10, .12);
  subGrille.emissiveColor = new Color3(.095, .10, .12);
  body.emissiveColor = new Color3(.010, .012, .015);
  frame.emissiveColor = new Color3(.018, .020, .025);

  const allMaterials = [body, frame, metal, recess, grille, subGrille];
  const batches = new Map<StandardMaterial, Mesh[]>();
  const owned = new Set<Mesh>();
  let disposed = false;

  function record(mesh: Mesh, parentNode: TransformNode, material: StandardMaterial) {
    mesh.parent = parentNode;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = false;
    owned.add(mesh);
    const group = batches.get(material) ?? [];
    group.push(mesh);
    batches.set(material, group);
    return mesh;
  }
  function box(
    name: string,
    node: TransformNode,
    material: StandardMaterial,
    position: Vector3,
    width: number,
    height: number,
    depth: number
  ) {
    const mesh = record(MeshBuilder.CreateBox(name, {
      width, height, depth
    }, scene), node, material);
    mesh.position.copyFrom(position);
    return mesh;
  }
  function panel(
    name: string,
    node: TransformNode,
    material: StandardMaterial,
    position: Vector3,
    width: number,
    height: number
  ) {
    const mesh = record(MeshBuilder.CreatePlane(name, { width, height }, scene), node, material);
    mesh.position.copyFrom(position);
    return mesh;
  }
  function bolt(name: string, node: TransformNode, x: number, y: number, z: number) {
    const mesh = record(MeshBuilder.CreateCylinder(name, {
      height: .026, diameter: .062, tessellation: 8
    }, scene), node, metal);
    mesh.position.set(x, y, z);
    mesh.rotation.x = Math.PI / 2;
  }
  function rod(name: string, node: TransformNode, a: Vector3, b: Vector3, diameter: number) {
    const vector = b.subtract(a);
    const mesh = record(MeshBuilder.CreateCylinder(name, {
      height: vector.length(), diameter, tessellation: 8
    }, scene), node, metal);
    mesh.position.copyFrom(a.add(b).scale(.5));
    const quaternion = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), vector.normalize(), quaternion);
    mesh.rotationQuaternion = quaternion;
    return mesh;
  }

  // Two curved line-array hangs, 8 independently angled cabinets per side.
  // Each hangs beyond the left/right edge of the live-video panels.
  const moduleCount = options.mobile ? 6 : 8;
  const unitWidth = 2.44;
  const unitHeight = 1.11;
  const unitDepth = 1.38;
  const xHang = options.stageWidth / 2 + 3.35;
  for (const side of [-1, 1]) {
    const hangX = side * xHang;
    const hangZ = options.stageFrontZ - 1.65;
    const topY = 19.85;
    box(`rinaSpeakerSuspensionMotor_${side}`, root, frame,
      new Vector3(hangX, topY + 1.14, hangZ), 1.28, .46, 1.0);
    rod(`rinaSpeakerRigCableL_${side}`, root,
      new Vector3(hangX - .82, 24.0, hangZ),
      new Vector3(hangX - .82, topY + .6, hangZ), .054);
    rod(`rinaSpeakerRigCableR_${side}`, root,
      new Vector3(hangX + .82, 24.0, hangZ),
      new Vector3(hangX + .82, topY + .6, hangZ), .054);
    for (let index = 0; index < moduleCount; index++) {
      const t = index / Math.max(1, moduleCount - 1);
      const node = new TransformNode(`rinaSpeakerCabinet_${side}_${index}`, scene);
      node.parent = root;
      node.position.set(
        hangX,
        topY - .58 - index * 1.19,
        hangZ - Math.pow(t, 1.7) * .5
      );
      node.rotation.x = -.018 - t * .23;
      const frontZ = -unitDepth * .5;

      box(`rinaSpeakerBody_${side}_${index}`, node, body,
        Vector3.Zero(), unitWidth, unitHeight, unitDepth);
      // The front plate is visually in front of the cabinet and has no alpha.
      panel(`rinaSpeakerGrille_${side}_${index}`, node, grille,
        new Vector3(0, 0, frontZ - .019), unitWidth - .22, unitHeight - .20);

      // Edge framing separates the cabinets without needing texture variants.
      for (const x of [-1, 1]) {
        box(`rinaSpeakerEdge_${side}_${index}_${x}`, node, frame,
          new Vector3(x * (unitWidth * .5 - .085), 0, frontZ - .018),
          .14, unitHeight - .10, .048);
        box(`rinaSpeakerSideHandle_${side}_${index}_${x}`, node, metal,
          new Vector3(x * (unitWidth * .5 + .022), .01, -.15),
          .038, .49, .40);
        box(`rinaSpeakerSideRecess_${side}_${index}_${x}`, node, recess,
          new Vector3(x * (unitWidth * .5 + .022), .01, -.155),
          .043, .32, .22);
      }
      for (const y of [-1, 1]) {
        box(`rinaSpeakerSeam_${side}_${index}_${y}`, node, frame,
          new Vector3(0, y * (unitHeight * .5 - .056), frontZ - .022),
          unitWidth - .05, .092, .046);
      }
      for (const x of [-1, 1]) {
        for (const y of [-1, 1]) {
          bolt(`rinaSpeakerBolt_${side}_${index}_${x}_${y}`,
            node, x * (unitWidth * .5 - .12),
            y * (unitHeight * .5 - .095), frontZ - .067);
        }
      }
    }
  }

  // Ground stacks of bass cabinets (subwoofers) flanking the lower stage.
  // They have a different, large-woofer patterned grille and physical feet.
  for (const side of [-1, 1]) {
    for (let index = 0; index < (options.mobile ? 1 : 2); index++) {
      const x = side * (options.stageWidth * .5 - 2.8 - index * 2.26);
      const node = new TransformNode(`rinaSubwoofer_${side}_${index}`, scene);
      node.parent = root;
      node.position.set(x, .74, options.stageFrontZ - 1.2);
      const frontZ = -.74;
      box(`rinaSubBody_${side}_${index}`, node, body,
        Vector3.Zero(), 2.05, 1.44, 1.48);
      panel(`rinaSubGrille_${side}_${index}`, node, subGrille,
        new Vector3(0, 0, frontZ - .025), 1.89, 1.27);
      for (const y of [-1, 1]) {
        box(`rinaSubRail_${side}_${index}_${y}`, node, frame,
          new Vector3(0, y * .68, frontZ - .035), 2.02, .065, .08);
      }
      for (const xSide of [-1, 1]) {
        box(`rinaSubSide_${side}_${index}_${xSide}`, node, metal,
          new Vector3(xSide * 1.002, 0, -.2), .03, .68, .33);
      }
      for (const px of [-.8, .8]) {
        for (const pz of [-.52, .52]) {
          box(`rinaSubFoot_${side}_${index}_${px}_${pz}`, node, frame,
            new Vector3(px, -.745, pz), .20, .07, .17);
        }
      }
    }
  }

  // Wedge monitors replace the former untextured stage-front blocks.
  for (const side of [-1, 1]) {
    for (let index = 0; index < 3; index++) {
      const node = new TransformNode(`rinaMonitorWedge_${side}_${index}`, scene);
      node.parent = root;
      node.position.set(side * (8.5 + index * 5.6),
        options.stageHeight + .31, options.stageFrontZ + .9);
      node.rotation.x = -.16;
      box(`rinaMonitorBody_${side}_${index}`, node, body,
        Vector3.Zero(), 2.05, .53, 1.12);
      panel(`rinaMonitorGrille_${side}_${index}`, node, grille,
        new Vector3(0, .028, -.57), 1.88, .43);
      for (const x of [-1, 1]) {
        box(`rinaMonitorEdge_${side}_${index}_${x}`, node, frame,
          new Vector3(x * .99, .015, -.59), .09, .49, .055);
      }
    }
  }

  // Merge by shared material with baked rotations/positions, not entire rigs.
  // Batching occurs BEFORE stadiumRoot receives the global 1.5x transform.
  for (const [material, meshes] of batches) {
    if (meshes.length < 2) continue;
    meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!merged) continue;
    merged.name = `rinaV3SpeakerMerged_${material.name}`;
    merged.parent = root;
    merged.material = material;
    merged.isPickable = false;
    merged.checkCollisions = false;
    owned.add(merged);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.dispose(false, false);
    grilleTexture.dispose();
    subTexture.dispose();
    for (const m of allMaterials) m.dispose();
    owned.clear();
  }
  return { root, dispose };
}
