import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

export const LAUTARO_VISUAL_SCALE = 2.7;

const SOFIA_MATERIAL_ROUGHNESS = 0.92;
const SOFIA_SPECULAR_INTENSITY = 0.24;
const SOFIA_ENVIRONMENT_INTENSITY = 0.14;
const SOFIA_DIELECTRIC_F0_FACTOR = 0.65;

type PresentedCharacter = "lautaro" | "sofia";

export function patchCharacterMaterial(
  material: BabylonMaterial | null,
  character: PresentedCharacter
) {
  if (!material) return;

  const materials: BabylonMaterial[] = (material as any).subMaterials?.length
    ? (material as any).subMaterials
    : [material];

  for (const mat of materials) {
    if (!mat) continue;
    mat.alpha = 1;
    mat.alphaMode = BabylonMaterial.MATERIAL_OPAQUE;
    mat.transparencyMode = BabylonMaterial.MATERIAL_OPAQUE;
    mat.backFaceCulling = false;
    (mat as any).forceDepthWrite = true;
    (mat as any).needDepthPrePass = false;

    if (mat instanceof PBRMaterial) {
      mat.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
      mat.useAlphaFromAlbedoTexture = false;

      if (character === "sofia") {
        // Sofia's GLB exports a metallic-only image in the combined
        // metallic/roughness slot and its roughness image as KHR specular.
        // Keep the authored albedo and normal detail, but use the same stable
        // dielectric response in gameplay and every character preview.
        mat.metallicTexture = null;
        mat.metallicReflectanceTexture = null;
        mat.reflectanceTexture = null;
        mat.microSurfaceTexture = null;
        mat.metallic = 0;
        mat.roughness = SOFIA_MATERIAL_ROUGHNESS;
        mat.specularIntensity = SOFIA_SPECULAR_INTENSITY;
        mat.environmentIntensity = SOFIA_ENVIRONMENT_INTENSITY;
        mat.metallicF0Factor = SOFIA_DIELECTRIC_F0_FACTOR;
      } else {
        mat.metallic = Math.min(mat.metallic ?? 0, 0.15);
        mat.roughness = Math.max(mat.roughness ?? 0.65, 0.55);
        mat.environmentIntensity = Math.min(mat.environmentIntensity ?? 0.35, 0.35);
      }
    } else if (mat instanceof StandardMaterial) {
      mat.useAlphaFromDiffuseTexture = false;
    }
  }
}
