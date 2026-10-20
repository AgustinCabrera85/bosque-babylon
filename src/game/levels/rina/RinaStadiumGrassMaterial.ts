import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_GRASS_TEXTURES, RINA_STADIUM_SCALE } from "./RinaLevelConfig";

function configureTiling(texture: Texture) {
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = 16 * RINA_STADIUM_SCALE;
  texture.vScale = 25 * RINA_STADIUM_SCALE;
  texture.anisotropicFilteringLevel = 4;
  return texture;
}

/** Uses the supplied stadium grass maps at the resolution for this device. */
export function createRinaStadiumGrassMaterial(
  scene: Scene,
  performanceTier: "desktop" | "mobile"
) {
  const maps = RINA_GRASS_TEXTURES[performanceTier];
  const material = new PBRMaterial("rinaPitchGrass", scene);
  material.albedoColor = Color3.White();
  material.metallic = 0;
  material.roughness = 1;

  material.albedoTexture = configureTiling(new Texture(maps.albedo, scene));
  const normal = configureTiling(new Texture(maps.normal, scene));
  normal.gammaSpace = false;
  normal.level = 0.72;
  material.bumpTexture = normal;

  const orm = configureTiling(new Texture(maps.orm, scene));
  orm.gammaSpace = false;
  material.metallicTexture = orm;
  material.useAmbientOcclusionFromMetallicTextureRed = true;
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = true;
  return material;
}
