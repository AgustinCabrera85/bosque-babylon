import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

const TEXTURE_ROOT = "/assets/textures/theatre/staircase/";

export type StaircaseMaterialSettings = {
  brightness: number;
  uScale: number;
  vScale: number;
  uOffset: number;
  vOffset: number;
};

export type TheatreStaircaseMaterialHandle = {
  material: StandardMaterial;
  sideMaterial: StandardMaterial;
  getSettings(): Readonly<StaircaseMaterialSettings>;
  setBrightness(value: number): void;
  setUvScale(u: number, v: number): void;
  setUvOffset(u: number, v: number): void;
};

export const STAIRCASE_DEFAULT_SETTINGS: StaircaseMaterialSettings = {
  brightness: 0.42,
  uScale: 1,
  vScale: 12,
  uOffset: 0,
  vOffset: 0,
};

export function createTheatreStaircaseMaterial(scene: Scene): TheatreStaircaseMaterialHandle {
  const material = new StandardMaterial("theatreStaircaseSurface", scene);
  const baseColor = new Texture(`${TEXTURE_ROOT}Textura_escalera.png`, scene);
  baseColor.wrapU = Texture.CLAMP_ADDRESSMODE;
  baseColor.wrapV = Texture.WRAP_ADDRESSMODE;
  baseColor.anisotropicFilteringLevel = 8;
  baseColor.hasAlpha = false;
  material.diffuseTexture = baseColor;
  material.alpha = 1;
  material.transparencyMode = Material.MATERIAL_OPAQUE;
  material.emissiveColor = new Color3(0.006, 0.0055, 0.005);
  material.ambientColor = new Color3(0.036, 0.034, 0.031);
  material.specularColor = new Color3(0.065, 0.065, 0.065);
  material.backFaceCulling = false;

  let settings = { ...STAIRCASE_DEFAULT_SETTINGS };
  const applyUvTransform = () => {
    baseColor.uScale = settings.uScale;
    baseColor.vScale = settings.vScale;
    baseColor.uOffset = settings.uOffset;
    baseColor.vOffset = settings.vOffset;
  };
  const applyBrightness = () => {
    material.diffuseColor.set(
      settings.brightness,
      settings.brightness * 0.97,
      settings.brightness * 0.93
    );
  };
  applyBrightness();
  applyUvTransform();

  const sideMaterial = new StandardMaterial("theatreStaircaseSides", scene);
  sideMaterial.diffuseColor = new Color3(0.105, 0.102, 0.1);
  sideMaterial.ambientColor = new Color3(0.028, 0.027, 0.025);
  sideMaterial.specularColor = new Color3(0.014, 0.014, 0.014);
  sideMaterial.specularPower = 12;

  return {
    material,
    sideMaterial,
    getSettings: () => settings,
    setBrightness(value) {
      settings = { ...settings, brightness: value };
      applyBrightness();
    },
    setUvScale(u, v) {
      settings = { ...settings, uScale: u, vScale: v };
      applyUvTransform();
    },
    setUvOffset(u, v) {
      settings = { ...settings, uOffset: u, vOffset: v };
      applyUvTransform();
    },
  };
}
