import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Scene } from "@babylonjs/core/scene";

/** A short neon bounce on the shared stone arch, independent of portal art. */
export class SanctuaryPortalStoneContact extends MaterialPluginBase {
  private reveal = 0;
  private time = 0;

  constructor(material: PBRMaterial, private readonly portalX: number,
    private readonly portalY: number, private readonly portalZ: number,
    private readonly leftTint: Color3, private readonly rightTint: Color3) {
    super(material, "SanctuaryPortalStoneContact", 250);
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  update(reveal: number, time: number): void {
    this.reveal = reveal;
    this.time = time;
  }

  getUniforms() {
    return { ubo: [
      { name: "portalStoneContact", size: 4, type: "vec4" },
      { name: "portalContactLeftTint", size: 4, type: "vec4" },
      { name: "portalContactRightTint", size: 4, type: "vec4" },
    ] };
  }

  hardBindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: unknown,
    _subMesh: SubMesh): void {
    uniformBuffer.updateFloat4("portalStoneContact",
      this.portalX, this.portalZ, this.reveal, this.time);
    uniformBuffer.updateFloat4("portalContactLeftTint",
      this.leftTint.r, this.leftTint.g, this.leftTint.b, this.portalY);
    uniformBuffer.updateFloat4("portalContactRightTint",
      this.rightTint.r, this.rightTint.g, this.rightTint.b, 0);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    // These offsets follow the real GLB's inner jambs and crown.
    const left = "-3.400";
    const right = "3.400";
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
float portalContactDepth = 1.0 - smoothstep(0.35, 2.2,
  abs(vPositionW.x - portalStoneContact.x));
float portalContactLeft = 1.0 - smoothstep(0.08, 1.35,
  abs(vPositionW.z - (portalStoneContact.y + ${left})));
float portalContactRight = 1.0 - smoothstep(0.08, 1.35,
  abs(vPositionW.z - (portalStoneContact.y + ${right})));
float portalContactSides = max(portalContactLeft, portalContactRight)
  * smoothstep(portalContactLeftTint.w + 0.45,
    portalContactLeftTint.w + 1.4, vPositionW.y)
  * (1.0 - smoothstep(portalContactLeftTint.w + 13.5,
    portalContactLeftTint.w + 14.7, vPositionW.y));
float portalContactCrown = (1.0 - smoothstep(0.08, 1.4,
  abs(vPositionW.y - (portalContactLeftTint.w + 14.4))))
  * smoothstep(portalStoneContact.y + ${left} - 1.1,
    portalStoneContact.y + ${left} + 0.8, vPositionW.z)
  * (1.0 - smoothstep(portalStoneContact.y + ${right} - 0.8,
    portalStoneContact.y + ${right} + 1.1, vPositionW.z));
float portalContactPulse = 0.91 + 0.09 * sin(
  vPositionW.y * 0.72 + portalStoneContact.w * 1.6);
float portalContactGlow = max(portalContactSides, portalContactCrown)
  * portalContactDepth * portalStoneContact.z * portalContactPulse;
vec3 portalContactTint = mix(portalContactLeftTint.rgb,
  portalContactRightTint.rgb,
  smoothstep(portalStoneContact.y + ${left},
    portalStoneContact.y + ${right}, vPositionW.z));
finalColor.rgb += (portalContactTint * 0.7 + vec3(0.72, 0.78, 0.86) * 0.075)
  * portalContactGlow;
`,
    };
  }
}
