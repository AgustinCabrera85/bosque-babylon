import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

const BODY_MATERIAL_NAME = "hermano_mayormaterial";
const FACE_MATERIAL_NAME = "hermanomayor_face";
const HAIR_MATERIAL_NAME = "hermanomayor_hair";
const HAIR_ALPHA_CUTOFF = 0.5;

/** Applies only the overrides required by this model's authored materials. */
export function patchHermanoMayorMaterial(material: Material | null) {
  if (!material) return;

  const materials: Material[] = (material as any).subMaterials?.length
    ? (material as any).subMaterials
    : [material];

  for (const candidate of materials) {
    if (!candidate) continue;
    const name = candidate.name.toLowerCase();

    // The face is already authored as opaque in the GLB and must remain intact.
    if (name === FACE_MATERIAL_NAME) continue;
    if (name === BODY_MATERIAL_NAME) makeOpaque(candidate);
    else if (name === HAIR_MATERIAL_NAME) makeAlphaTest(candidate);
  }
}

function makeOpaque(material: Material) {
  material.alpha = 1;
  material.alphaMode = Material.MATERIAL_OPAQUE;
  material.transparencyMode = Material.MATERIAL_OPAQUE;
  material.forceDepthWrite = true;
  material.needDepthPrePass = false;

  if (material instanceof PBRMaterial) {
    material.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
    material.useAlphaFromAlbedoTexture = false;
    if (material.albedoTexture) material.albedoTexture.hasAlpha = false;
  } else if (material instanceof StandardMaterial) {
    material.useAlphaFromDiffuseTexture = false;
    if (material.diffuseTexture) material.diffuseTexture.hasAlpha = false;
  }
}

function makeAlphaTest(material: Material) {
  material.alpha = 1;
  material.alphaMode = Material.MATERIAL_ALPHATEST;
  material.transparencyMode = Material.MATERIAL_ALPHATEST;
  material.backFaceCulling = false;
  material.forceDepthWrite = true;
  material.needDepthPrePass = true;

  if (material instanceof PBRMaterial) {
    material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    material.useAlphaFromAlbedoTexture = true;
    material.alphaCutOff = HAIR_ALPHA_CUTOFF;
    material.twoSidedLighting = true;
    if (material.albedoTexture) material.albedoTexture.hasAlpha = true;
  } else if (material instanceof StandardMaterial) {
    material.useAlphaFromDiffuseTexture = true;
    material.alphaCutOff = HAIR_ALPHA_CUTOFF;
    material.twoSidedLighting = true;
    if (material.diffuseTexture) material.diffuseTexture.hasAlpha = true;
  }
}

