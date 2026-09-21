import { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

export type BrazierLogEmberOptions = {
  center: Vector3;
  radius: number;
  height: number;
  intensity?: number;
};

type BrazierLogEmberState = {
  time: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
  height: number;
  intensity: number;
};

const EMBER_VERTEX_DEFINITIONS = `
varying vec3 vBrazierLogWorldPosition;
`;

const EMBER_VERTEX_WORLD_POSITION = `
vBrazierLogWorldPosition = worldPos.xyz;
`;

const EMBER_FRAGMENT_DEFINITIONS = `
varying vec3 vBrazierLogWorldPosition;

float brazierLogOrganicNoise(vec3 p) {
  float broad = sin(dot(p, vec3(1.17, 0.73, -0.91)));
  float folded = sin(dot(p, vec3(-1.83, 1.31, 0.67)) + broad * 1.42);
  float detail = sin(dot(p, vec3(3.11, -1.47, 2.29)) - folded * 1.16);
  return clamp(0.5 + broad * 0.23 + folded * 0.18 + detail * 0.09, 0.0, 1.0);
}

vec2 brazierLogBurnMasks() {
  vec3 relative = vBrazierLogWorldPosition - brazierLogBurnOrigin.xyz;
  float radius = max(0.001, brazierLogBurnOrigin.w);
  float height = max(0.001, brazierLogBurnTuning.y);
  float radial = 1.0 - smoothstep(radius * 0.34, radius, length(relative.xz));
  float vertical = 1.0 - smoothstep(height * 0.18, height * 0.78, abs(relative.y));

  vec3 animatedPosition = relative * vec3(7.4, 10.8, 7.4);
  animatedPosition += vec3(
    brazierLogBurnTuning.x * 0.19,
    -brazierLogBurnTuning.x * 0.31,
    brazierLogBurnTuning.x * 0.14
  );
  float organic = brazierLogOrganicNoise(animatedPosition);
  float grain = abs(sin(relative.x * 24.0 + relative.z * 11.0 + organic * 2.8));
  float crossGrain = abs(sin(relative.z * 31.0 - relative.x * 8.0 - organic * 2.1));
  float cracks = 1.0 - smoothstep(0.035, 0.18, min(grain, crossGrain));
  float contact = radial * vertical;
  float charMask = contact * smoothstep(0.24, 0.68, organic + cracks * 0.18);

  float pulse =
    0.78 +
    sin(brazierLogBurnTuning.x * 4.1 + relative.x * 9.0) * 0.13 +
    sin(brazierLogBurnTuning.x * 7.3 - relative.z * 12.0) * 0.09;
  float emberMask = contact * cracks * smoothstep(0.42, 0.78, organic) * pulse;
  return vec2(clamp(charMask, 0.0, 1.0), clamp(emberMask, 0.0, 1.0));
}
`;

class BrazierLogEmberPlugin extends MaterialPluginBase {
  private readonly outputColorName: "color" | "finalColor";

  constructor(
    material: PBRMaterial | StandardMaterial,
    private readonly state: BrazierLogEmberState
  ) {
    super(material, "BrazierLogEmber", 212, {}, true, true);
    this.outputColorName = material instanceof PBRMaterial ? "finalColor" : "color";
  }

  override isCompatible(shaderLanguage: ShaderLanguage) {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override getClassName() {
    return "BrazierLogEmber";
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "brazierLogBurnOrigin", size: 4, type: "vec4" },
        { name: "brazierLogBurnTuning", size: 4, type: "vec4" },
      ],
      fragment: `
uniform vec4 brazierLogBurnOrigin;
uniform vec4 brazierLogBurnTuning;
`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer) {
    uniformBuffer.updateFloat4(
      "brazierLogBurnOrigin",
      this.state.centerX,
      this.state.centerY,
      this.state.centerZ,
      this.state.radius
    );
    uniformBuffer.updateFloat4(
      "brazierLogBurnTuning",
      this.state.time,
      this.state.height,
      this.state.intensity,
      0
    );
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: EMBER_VERTEX_DEFINITIONS,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: EMBER_VERTEX_WORLD_POSITION,
      };
    }
    if (shaderType === "fragment") {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: EMBER_FRAGMENT_DEFINITIONS,
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
vec2 brazierLogBurn = brazierLogBurnMasks();
vec3 brazierLogCharColor = vec3(0.012, 0.0045, 0.0018);
${this.outputColorName}.rgb = mix(
  ${this.outputColorName}.rgb,
  brazierLogCharColor,
  brazierLogBurn.x * 0.82
);
vec3 brazierLogEmberColor = vec3(1.45, 0.20, 0.018);
${this.outputColorName}.rgb +=
  brazierLogEmberColor * brazierLogBurn.y * brazierLogBurnTuning.z;
`,
      };
    }
    return null;
  }
}

/** Adds localized animated char and ember veins while preserving the GLB textures. */
export function applyBrazierLogEmberMaterial(
  scene: Scene,
  meshes: readonly AbstractMesh[],
  options: BrazierLogEmberOptions
) {
  const state: BrazierLogEmberState = {
    time: 0,
    centerX: options.center.x,
    centerY: options.center.y,
    centerZ: options.center.z,
    radius: Math.max(0.01, options.radius),
    height: Math.max(0.01, options.height),
    intensity: Math.max(0, options.intensity ?? 1),
  };
  const materialClones = new Map<Material, PBRMaterial | StandardMaterial>();
  const plugins: BrazierLogEmberPlugin[] = [];

  for (const mesh of meshes) {
    const source = mesh.material;
    if (!(source instanceof PBRMaterial || source instanceof StandardMaterial)) continue;

    let material = materialClones.get(source);
    if (!material) {
      const clone = source.clone(`${source.name}_brazierEmber`);
      if (!(clone instanceof PBRMaterial || clone instanceof StandardMaterial)) continue;
      material = clone;
      materialClones.set(source, material);
      plugins.push(new BrazierLogEmberPlugin(material, state));
    }
    mesh.material = material;
  }

  if (!plugins.length) return null;

  const observer = scene.onBeforeRenderObservable.add(() => {
    state.time += Math.max(
      0,
      Math.min(scene.getEngine().getDeltaTime() * 0.001, 0.05)
    );
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    scene.onBeforeRenderObservable.remove(observer);
    for (const plugin of plugins) plugin.dispose();
  };
  scene.onDisposeObservable.addOnce(dispose);
  return { dispose };
}
