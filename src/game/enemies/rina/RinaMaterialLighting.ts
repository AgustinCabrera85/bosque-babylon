import type { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

type LightState = {
  violet: Vector3;
  cyan: Vector3;
};

/** Two soft stage lights in the PBR shader, without extra scene lights. */
class RinaStageLightingPlugin extends MaterialPluginBase {
  constructor(material: PBRMaterial, private readonly lights: LightState,
    private readonly strength: number) {
    super(material, "RinaStageLighting", 210, {}, true, true);
  }

  override isCompatible(shaderLanguage: ShaderLanguage) {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override getClassName() { return "RinaStageLighting"; }

  override getUniforms() {
    return { ubo: [
      { name: "rinaVioletLight", size: 4, type: "vec4" },
      { name: "rinaCyanLight", size: 4, type: "vec4" },
    ] };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer) {
    const { violet, cyan } = this.lights;
    uniformBuffer.updateFloat4(
      "rinaVioletLight", violet.x, violet.y, violet.z, this.strength
    );
    uniformBuffer.updateFloat4(
      "rinaCyanLight", cyan.x, cyan.y, cyan.z, this.strength
    );
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
vec3 rinaNormal = normalize(normalW);
vec3 rinaVioletVector = rinaVioletLight.xyz - vPositionW;
vec3 rinaCyanVector = rinaCyanLight.xyz - vPositionW;
float rinaVioletDistance = length(rinaVioletVector);
float rinaCyanDistance = length(rinaCyanVector);
float rinaVioletDiffuse = max(dot(rinaNormal,
  rinaVioletVector / max(rinaVioletDistance, 0.001)), 0.0);
float rinaCyanDiffuse = max(dot(rinaNormal,
  rinaCyanVector / max(rinaCyanDistance, 0.001)), 0.0);
float rinaVioletFalloff = 1.0 / (1.0 + rinaVioletDistance * rinaVioletDistance);
float rinaCyanFalloff = 1.0 / (1.0 + rinaCyanDistance * rinaCyanDistance);
float rinaRim = pow(1.0 - max(dot(rinaNormal,
  normalize(viewDirectionW)), 0.0), 3.0);
vec3 rinaStageLight =
  vec3(0.72, 0.19, 0.88) * rinaVioletDiffuse * rinaVioletFalloff +
  vec3(0.13, 0.67, 0.89) * rinaCyanDiffuse * rinaCyanFalloff;
rinaStageLight += vec3(0.28, 0.12, 0.42) * rinaRim * 0.18;
finalColor.rgb += rinaStageLight * rinaVioletLight.w;
` };
  }
}

export class RinaMaterialLighting {
  private readonly lights: LightState = {
    violet: Vector3.Zero(),
    cyan: Vector3.Zero(),
  };
  private readonly violetLocal = new Vector3(-0.75, 1.95, -0.7);
  private readonly cyanLocal = new Vector3(0.8, 1.45, 0.35);

  constructor(materials: readonly Material[], private readonly root: TransformNode,
    height: number) {
    const heightScale = height / 1.75;
    this.violetLocal.scaleInPlace(heightScale);
    this.cyanLocal.scaleInPlace(heightScale);
    for (const material of materials) {
      if (!(material instanceof PBRMaterial)) continue;
      const name = material.name.toLowerCase();
      // Keep the transparent corneas clear and the facial texture readable.
      if (name.includes("cornea")) continue;
      const strength = name.includes("rostro") ? 0.045 :
        name.includes("ojo_") ? 0.025 : 0.075;
      new RinaStageLightingPlugin(material, this.lights,
        strength * heightScale * heightScale);
    }
    this.update();
  }

  update() {
    this.root.computeWorldMatrix(true);
    const world = this.root.getWorldMatrix();
    Vector3.TransformCoordinatesToRef(
      this.violetLocal, world, this.lights.violet
    );
    Vector3.TransformCoordinatesToRef(
      this.cyanLocal, world, this.lights.cyan
    );
  }
}
