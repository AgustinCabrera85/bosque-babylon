import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

const ASSET_BASE = "/assets/textures/sanctuary/";

/** Ancient grey lithic monoliths: no glowing red seams baked into the stone. */
export function createSanctuaryStoneMaterials(scene: Scene, mobile: boolean) {
  const makeStone = (name: string, tileU: number, tileV: number, tone: number, normalStrength: number) => {
    const mat = new StandardMaterial(name, scene);
    const texture = new Texture(`${ASSET_BASE}stone_monolith_albedo_1024.webp`, scene, true, false);
    texture.uScale = tileU;
    texture.vScale = tileV;
    mat.diffuseTexture = texture;
    mat.diffuseColor = new Color3(tone, tone * 1.01, tone * 1.04);
    mat.specularColor = new Color3(0.038, 0.038, 0.039);
    mat.specularPower = 15;
    if (!mobile && normalStrength > 0) {
      const normal = new Texture(`${ASSET_BASE}stone_monolith_normal_1024.webp`, scene, true, false);
      normal.uScale = tileU;
      normal.vScale = tileV;
      normal.level = normalStrength;
      mat.bumpTexture = normal;
    }
    return mat;
  };
  return {
    // Different UV scales because the wall's surface area is vastly larger.
    pillar: makeStone("sanctuaryMonolithicStone", 1.5, 3.0, .62, .23),
    wall: makeStone("sanctuaryInfiniteStoneWall", 7.0, 12.0, .40, .0),
    stairs: makeStone("sanctuarySolidStoneSteps", 2.0, 2.0, .46, .0),
  };
}
