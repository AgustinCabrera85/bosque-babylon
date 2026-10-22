import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_BACK_STAND_LED_PROFILE } from "./RinaBackStandExit";
import { RINA_DOUBLE_TIER_PROFILE } from "./RinaDoubleTierSideStands";
import { RINA_STADIUM } from "./RinaLevelConfig";

/** All measurements are local to rinaStadiumRoot; they are scaled with the stadium. */
export const RINA_STANDS_LED_DETAILS = {
  panelHeight: 0.60,
  panelWidth: 9.6,
  mobilePanelWidth: 12.8,
  desktopPulsePeriodSeconds: 5.4,
  pulseAmplitude: 0.045,
  scrollCyclesPerSecond: 0.065,
} as const;

type Accent = "cyan" | "magenta" | "white";
type Groups = Record<Accent | "backing" | "stepLights", Mesh[]>;

function scenic(mesh: Mesh) {
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  return mesh;
}

function box(scene: Scene, group: Mesh[], name: string,
  width: number, height: number, depth: number,
  x: number, y: number, z: number, yaw = 0) {
  const mesh = scenic(MeshBuilder.CreateBox(name, { width, height, depth }, scene));
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  group.push(mesh);
  return mesh;
}

function merge(scene: Scene, root: TransformNode, name: string,
  meshes: Mesh[], material: StandardMaterial) {
  if (!meshes.length) return;
  for (const mesh of meshes) mesh.computeWorldMatrix(true);
  const result = meshes.length === 1 ? meshes[0]
    : Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
  if (!result) throw new Error(`Could not merge ${name}`);
  result.name = name;
  result.material = material;
  scenic(result);
  result.parent = root;
  void scene;
}

function solidMaterial(scene: Scene, name: string, diffuse: Color3, emissive: Color3) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = diffuse;
  material.emissiveColor = emissive;
  material.specularColor = Color3.Black();
  return material;
}

function textMaterial(scene: Scene, name: string, label: string,
  color: string, width: number, height: number, fontSize: number) {
  const texture = new DynamicTexture(`${name}Texture`, { width, height }, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#02040a";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(80,120,155,.10)";
  for (let x = 5; x < width; x += 11) {
    for (let y = 5; y < height; y += 11) ctx.fillRect(x, y, 2, 2);
  }
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(12, height - 8);
  ctx.lineTo(width - 12, height - 8);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Rasterize the glyphs once as a mask, then light a coarse grid of round
  // diodes wherever the mask has ink. The animated texture is never redrawn.
  const stencil = document.createElement("canvas");
  stencil.width = width;
  stencil.height = height;
  const stencilCtx = stencil.getContext("2d", { willReadFrequently: true });
  if (!stencilCtx) throw new Error(`Could not draw LED text: ${name}`);
  stencilCtx.font = `700 ${fontSize}px Arial, sans-serif`;
  stencilCtx.textAlign = "center";
  stencilCtx.textBaseline = "middle";
  stencilCtx.fillStyle = "#fff";
  stencilCtx.fillText(label, width * 0.5, height * 0.47, width - 42);
  const mask = stencilCtx.getImageData(0, 0, width, height).data;
  const pitch = height <= 64 ? 5 : 6;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 2;
  for (let y = pitch; y < height - pitch; y += pitch) {
    for (let x = pitch; x < width - pitch; x += pitch) {
      const alpha = Math.max(
        mask[(y * width + x) * 4 + 3],
        mask[(y * width + x - 1) * 4 + 3],
        mask[((y - 1) * width + x) * 4 + 3]
      );
      if (alpha < 100) continue;
      // Babylon reverses V when this canvas is shown on a stadium-facing plane.
      ctx.beginPath();
      ctx.arc(x, height - y, pitch * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;

  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  material.emissiveTexture = texture;
  texture.level = 0.86;
  material.disableLighting = true;
  material.backFaceCulling = false;
  return material;
}

function sideCurve(z: number) {
  const p = RINA_DOUBLE_TIER_PROFILE;
  const t = Math.max(-1, Math.min(1, z / (p.length * 0.5)));
  return p.zCurve * t * t;
}

function sideYaw(side: -1 | 1, z: number) {
  const p = RINA_DOUBLE_TIER_PROFILE;
  return Math.atan(side * 2 * p.zCurve * z / ((p.length * 0.5) ** 2));
}

function sidePanel(scene: Scene, groups: Groups, side: -1 | 1,
  faceAbsX: number, y: number, z: number, width: number,
  material: StandardMaterial, accent: Accent, name: string) {
  const h = RINA_STANDS_LED_DETAILS.panelHeight;
  const yaw = sideYaw(side, z);
  const backX = side * (faceAbsX - 0.025);
  box(scene, groups.backing, `${name}Housing`, 0.085, h + 0.12, width + 0.16,
    backX, y, z, yaw);
  const face = scenic(MeshBuilder.CreatePlane(`${name}Face`, { width, height: h }, scene));
  face.position.set(side * (faceAbsX - 0.09), y, z);
  // Babylon planes face local -Z. Turn that face toward the field, so the
  // texture is read from its front rather than mirrored through its back.
  face.rotation.y = side * Math.PI * 0.5 + yaw;
  groups[accent].push(face);
  box(scene, groups[accent], `${name}Lip`, 0.048, 0.025, width + 0.10,
    side * (faceAbsX - 0.075), y + h * 0.5 + 0.046, z, yaw);
  face.material = material;
}

function rearPanel(scene: Scene, groups: Groups,
  x: number, y: number, frontZ: number, width: number,
  material: StandardMaterial, accent: Accent, name: string) {
  const h = RINA_STANDS_LED_DETAILS.panelHeight;
  box(scene, groups.backing, `${name}Housing`, width + 0.16, h + 0.12, 0.085,
    x, y, frontZ + 0.025);
  const face = scenic(MeshBuilder.CreatePlane(`${name}Face`, { width, height: h }, scene));
  face.position.set(x, y, frontZ + 0.09);
  face.rotation.y = Math.PI;
  face.material = material;
  groups[accent].push(face);
  box(scene, groups[accent], `${name}Lip`, width + 0.10, 0.025, 0.048,
    x, y + h * 0.5 + 0.046, frontZ + 0.075);
}

/** Visual-only stadium dressing, deliberately independent of stand construction. */
export function createRinaStandsLedDetails(scene: Scene, performanceTier: "desktop" | "mobile") {
  const mobile = performanceTier === "mobile";
  const root = new TransformNode("rinaStandsLedDetailsRoot", scene);
  const groups: Groups = { cyan: [], magenta: [], white: [], backing: [], stepLights: [] };
  const slogans: Record<Accent, StandardMaterial> = {
    cyan: textMaterial(scene, "rinaStandBannerCyan", "SI ME MIRÁS", "#32b8d4", 1024, 64, 50),
    magenta: textMaterial(scene, "rinaStandBannerMagenta", "RINA  ·  RECITAL", "#d943b5", 1024, 64, 52),
    white: textMaterial(scene, "rinaStandBannerWhite", "LA SOMBRA DE RINA", "#96c8d7", 1024, 64, 49),
  };
  const backing = solidMaterial(scene, "rinaStandBannerHousing",
    new Color3(0.008, 0.012, 0.022), new Color3(0.003, 0.006, 0.012));
  const stepLights = solidMaterial(scene, "rinaStandStepLights",
    Color3.Black(), new Color3(0.12, 0.52, 0.63));
  const edgeCyan = solidMaterial(scene, "rinaStandAccessEdgeCyan",
    Color3.Black(), new Color3(0.10, 0.30, 0.37));
  const edgeMagenta = solidMaterial(scene, "rinaStandAccessEdgeMagenta",
    Color3.Black(), new Color3(0.29, 0.09, 0.27));
  const cyanEdges: Mesh[] = [];
  const magentaEdges: Mesh[] = [];
  const signMaterials: StandardMaterial[] = [];
  const p = RINA_DOUBLE_TIER_PROFILE;
  const lowerStartX = RINA_STADIUM.pitchWidth * 0.5 + p.fieldMargin;
  const lowerEndX = lowerStartX + p.lowerRows * p.lowerTread;
  const lowerTopY = p.lowerInitialHeight + (p.lowerRows - 1) * p.lowerRise;
  const fasciaY = lowerTopY + 0.36 + (p.concourseClearHeight - 0.78) * 0.5;
  const panelW = mobile ? RINA_STANDS_LED_DETAILS.mobilePanelWidth
    : RINA_STANDS_LED_DETAILS.panelWidth;

  // The intervals are the real solid fascia between the six existing vomitories.
  const cuts = [-p.length * 0.5,
    ...p.aislePositions.flatMap(z => [z - p.vomitoryWidth * 0.5, z + p.vomitoryWidth * 0.5]),
    p.length * 0.5];
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < cuts.length - 1; i += 2) {
      const start = cuts[i];
      const end = cuts[i + 1];
      const middle = (start + end) * 0.5;
      if (mobile && Math.abs(middle) > 30) continue;
      const count = !mobile && end - start > 24 ? 2 : 1;
      for (let j = 0; j < count; j++) {
        const z = middle + (j - (count - 1) * 0.5) * (panelW + 1.0);
        const accent: Accent = (i / 2 + j + (side === 1 ? 1 : 0)) % 3 === 0
          ? "magenta" : "cyan";
        sidePanel(scene, groups, side, lowerEndX + sideCurve(z) + 0.02,
          fasciaY - 0.12, z, panelW, slogans[accent], accent,
          `rinaSideFascia_${side}_${i}_${j}`);
      }
    }

    // The front-most riser gets a restrained LED strip, separate from the upper fascia.
    const lowerZ = mobile ? [0] : [-23, 23];
    for (const [i, z] of lowerZ.entries()) {
      const accent: Accent = i === 0 ? "white" : "magenta";
      sidePanel(scene, groups, side, lowerStartX + sideCurve(z) - 0.02,
        p.lowerInitialHeight * 0.5, z, panelW, slogans[accent], accent,
        `rinaSideLower_${side}_${i}`);
    }

    // Shallow cool/magenta outlines pick out actual tunnel mouths, without filling them.
    for (const [i, z] of p.aislePositions.entries()) {
      if (mobile && i !== 1) continue;
      const trim = side === -1 ? cyanEdges : magentaEdges;
      const x = side * (lowerEndX + sideCurve(z) - 0.19);
      for (const edge of [-1, 1]) {
        box(scene, trim, `rinaVomitoryOutline_${side}_${z}_${edge}`,
          0.055, 1.94, 0.055, x, fasciaY - 0.06,
          z + edge * (p.vomitoryWidth * 0.5 - 0.07));
      }
      box(scene, trim, `rinaVomitoryOutlineTop_${side}_${z}`,
        0.055, 0.055, p.vomitoryWidth - 0.12,
        x, fasciaY + 0.94, z);
    }

    // Small sector plaques occupy unused end pieces of fascia, beside the banners.
    if (!mobile || side === -1) {
      for (const [i, z] of (mobile ? [-53] : [-53, 53]).entries()) {
        const label = `SECTOR ${side === -1 ? "10" : "20"}${i + 1}`;
        const mat = textMaterial(scene, `rinaSectorSign_${side}_${i}`,
          label, side === -1 ? "#8ae9ff" : "#ff9bec", 512, 128, 50);
        signMaterials.push(mat);
        const sign = scenic(MeshBuilder.CreatePlane(`rinaSectorPlate_${side}_${i}`,
          { width: 2.15, height: 0.54 }, scene));
        sign.position.set(side * (lowerEndX + sideCurve(z) - 0.15),
          fasciaY + 0.67, z);
        sign.rotation.y = side * Math.PI * 0.5 + sideYaw(side, z);
        sign.material = mat;
        sign.parent = root;
      }
    }

    // Sparse aisle lamps, flush with the existing visual stair markings.
    for (const z of p.aislePositions) {
      for (const row of mobile ? [5] : [1, 5, 9]) {
        box(scene, groups.stepLights, `rinaAisleMarker_${side}_${z}_${row}`,
          0.23, 0.018, 0.72,
          side * (lowerStartX + (row + 0.5) * p.lowerTread + sideCurve(z)),
          p.lowerInitialHeight + row * p.lowerRise + 0.133, z,
          sideYaw(side, z));
      }
    }
  }

  const rear = RINA_BACK_STAND_LED_PROFILE;
  const rearLowerTopY = 0.45 + (rear.lowerRows - 1) * rear.rowHeight + rear.rowHeight * 0.5;
  const rearConcourseY = rearLowerTopY + rear.concourseHeight * 0.5 + 0.35;
  const rearFrontZ = rear.rearZ - rear.lowerRows * rear.lowerRowDepth + 0.2;
  const rearCenterX = (rear.openingHalfWidth + rear.halfWidth) * 0.5;
  for (const side of [-1, 1] as const) {
    const offsets = mobile ? [0] : [-7, 7];
    for (const [i, offset] of offsets.entries()) {
      const accent: Accent = side === -1 ? "cyan" : "magenta";
      rearPanel(scene, groups, side * rearCenterX + offset,
        rearConcourseY, rearFrontZ, mobile ? panelW : 12,
        slogans[accent], accent, `rinaRearBanner_${side}_${i}`);
    }
  }

  // Merge by material: panel faces, metal lips, housings and markers stay cheap.
  for (const accent of ["cyan", "magenta", "white"] as const) {
    const faces = groups[accent].filter(mesh => mesh.name.endsWith("Face"));
    const lips = groups[accent].filter(mesh => mesh.name.endsWith("Lip"));
    merge(scene, root, `rinaStandLedFaces_${accent}`, faces, slogans[accent]);
    merge(scene, root, `rinaStandLedLips_${accent}`, lips,
      accent === "magenta" ? edgeMagenta : edgeCyan);
  }
  merge(scene, root, "rinaStandLedHousings", groups.backing, backing);
  merge(scene, root, "rinaStandAisleMarkers", groups.stepLights, stepLights);
  merge(scene, root, "rinaStandTunnelCyanTrim", cyanEdges, edgeCyan);
  merge(scene, root, "rinaStandTunnelMagentaTrim", magentaEdges, edgeMagenta);

  let elapsed = 0;
  let animationTimer = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(scene.getEngine().getDeltaTime(), 100) / 1000;
    elapsed += dt;
    animationTimer += dt;
    if (animationTimer < (mobile ? 0.10 : 0.05)) return;
    animationTimer = 0;
    const phase = elapsed * Math.PI * 2 / RINA_STANDS_LED_DETAILS.desktopPulsePeriodSeconds;
    for (const [i, material] of Object.values(slogans).entries()) {
      const texture = material.emissiveTexture as DynamicTexture | null;
      if (!texture) continue;
      // UV motion repeats the already uploaded message; no canvas redraws.
      texture.uOffset = (elapsed * RINA_STANDS_LED_DETAILS.scrollCyclesPerSecond) % 1;
      if (!mobile) {
        texture.level = 0.86 + RINA_STANDS_LED_DETAILS.pulseAmplitude * Math.sin(phase + i * 1.5);
      }
    }
  });

  return {
    root,
    dispose() {
      scene.onBeforeRenderObservable.remove(observer);
      root.dispose(false, false);
      for (const material of [
        ...Object.values(slogans), backing, stepLights, edgeCyan, edgeMagenta,
        ...signMaterials,
      ]) material.dispose(false, true);
    },
  };
}
