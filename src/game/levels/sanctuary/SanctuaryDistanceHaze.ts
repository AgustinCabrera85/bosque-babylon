import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Scene } from "@babylonjs/core/scene";

/** Keep the portal masonry and its guardians dark through the red atmosphere. */
export class SanctuaryDistanceHazePlugin extends MaterialPluginBase {
  constructor(material: PBRMaterial, private readonly maxStrength = 0.62) {
    super(material, "SanctuaryDistanceHaze", 230, {}, true, true);
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  getUniforms() {
    return { ubo: [{ name: "sanctuaryPortalHazeStrength", size: 1, type: "float" }] };
  }

  hardBindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: unknown,
    _subMesh: SubMesh): void {
    uniformBuffer.updateFloat("sanctuaryPortalHazeStrength", this.maxStrength);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
float sanctuaryPortalRange = length(vPositionW - vEyePosition.xyz);
float sanctuaryPortalHaze = smoothstep(280.0, 1550.0, sanctuaryPortalRange)
  * sanctuaryPortalHazeStrength;
finalColor.rgb = mix(finalColor.rgb, vec3(0.105, 0.024, 0.028), sanctuaryPortalHaze);
`,
    };
  }
}
