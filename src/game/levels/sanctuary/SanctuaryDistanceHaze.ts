import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";

/** Keep the portal masonry and its guardians dark through the red atmosphere. */
export class SanctuaryDistanceHazePlugin extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(material, "SanctuaryDistanceHaze", 230, {}, true, true);
    this._enable(true);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
float sanctuaryPortalRange = length(vPositionW - vEyePosition.xyz);
float sanctuaryPortalHaze = smoothstep(280.0, 1550.0, sanctuaryPortalRange) * 0.62;
finalColor.rgb = mix(finalColor.rgb, vec3(0.105, 0.024, 0.028), sanctuaryPortalHaze);
`,
    };
  }
}
