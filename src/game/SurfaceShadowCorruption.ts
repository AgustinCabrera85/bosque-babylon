import { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";

export type SurfaceShadowCorruptionConfig = {
  noiseScale: number;
  flowSpeed: number;
  maxDarkness: number;
};

type SurfaceShadowState = {
  time: number;
  healthDamage: number;
  sanityDamage: number;
  strength: number;
  bodyBaseY: number;
  bodyHeight: number;
  originX: number;
  originZ: number;
  noiseScale: number;
  flowSpeed: number;
  maxDarkness: number;
};

const VERTEX_DEFINITIONS = `
varying vec3 vSurfaceShadowWorldPosition;
`;

const VERTEX_WORLD_POSITION = `
vSurfaceShadowWorldPosition = worldPos.xyz;
`;

const FRAGMENT_DEFINITIONS = `
varying vec3 vSurfaceShadowWorldPosition;

float surfaceShadowOrganicNoise(vec3 p) {
  float broad = sin(dot(p, vec3(0.83, 1.21, -0.67)));
  float folded = sin(dot(p, vec3(-1.37, 0.59, 1.11)) + broad * 1.45);
  float detail = sin(dot(p, vec3(2.03, -0.91, 1.73)) - folded * 1.15);
  return 0.5 + broad * 0.22 + folded * 0.19 + detail * 0.09;
}

float surfaceShadowMask() {
  float time = surfaceShadowState.x;
  float healthDamage = clamp(surfaceShadowState.y, 0.0, 1.0);
  float sanityDamage = clamp(surfaceShadowState.z, 0.0, 1.0);
  float enabledStrength = max(surfaceShadowState.w, 0.0);
  float bodyBaseY = surfaceShadowBounds.x;
  float bodyHeight = max(surfaceShadowBounds.y, 0.001);
  vec3 localPosition = vec3(
    vSurfaceShadowWorldPosition.x - surfaceShadowBounds.z,
    vSurfaceShadowWorldPosition.y - bodyBaseY,
    vSurfaceShadowWorldPosition.z - surfaceShadowBounds.w
  );
  float normalizedHeight = clamp(localPosition.y / bodyHeight, 0.0, 1.0);
  float chaos = pow(sanityDamage, 1.25);
  float speed = surfaceShadowTuning.y * mix(0.16, 0.48, chaos);

  // Two slow, unrelated flows prevent the pattern from reading as a vertical wipe.
  vec3 flowA = vec3(time * speed * 0.31, time * speed * 0.18, -time * speed * 0.23);
  vec3 flowB = vec3(-time * speed * 0.27, time * speed * 0.11, time * speed * 0.35);
  float scale = surfaceShadowTuning.x;
  float broadNoise = surfaceShadowOrganicNoise(localPosition * scale + flowA);
  float detailNoise = surfaceShadowOrganicNoise(localPosition * (scale * 2.35) + flowB);
  float pattern = clamp(broadNoise * 0.68 + detailNoise * 0.32, 0.0, 1.0);

  // Health raises a broken consumption frontier from feet to head. Very low
  // sanity can make a few tendrils crawl near the feet without raising it.
  float frontier = healthDamage * 1.12 + sanityDamage * 0.085;
  float frontierWarp = (broadNoise - 0.5) * mix(0.09, 0.24, chaos);
  frontierWarp += (detailNoise - 0.5) * mix(0.035, 0.105, chaos);
  float consumed = 1.0 - smoothstep(frontier - 0.075, frontier + 0.035, normalizedHeight - frontierWarp);

  // Sanity changes holes, branching and edge instability. It does not simply
  // turn up opacity. Health makes already-consumed regions more cohesive.
  float holeThreshold = mix(0.34, 0.49, chaos) - healthDamage * 0.08;
  float brokenMass = smoothstep(holeThreshold, holeThreshold + 0.19, pattern);
  float ridges = 1.0 - abs(detailNoise * 2.0 - 1.0);
  float branches = smoothstep(mix(0.86, 0.69, chaos), 0.96, ridges) * chaos;
  float coverage = clamp(brokenMass + branches * 0.58, 0.0, 1.0);

  float presence = max(healthDamage, sanityDamage * 0.16);
  float activation = smoothstep(0.012, 0.07, presence);
  float darkness = mix(0.66, surfaceShadowTuning.z, healthDamage);

  // Preserve facial planes and albedo contrast even at 0/0; the corruption
  // remains strong around the head without turning it into a featureless void.
  float faceRegion = smoothstep(0.82, 0.96, normalizedHeight);
  float faceReadability = mix(1.0, 0.54, faceRegion);
  return clamp(consumed * coverage * activation * darkness * faceReadability * enabledStrength, 0.0, 0.94);
}
`;

class SurfaceShadowMaterialPlugin extends MaterialPluginBase {
  private readonly state: SurfaceShadowState;
  private readonly outputColorName: "color" | "finalColor";

  constructor(material: PBRMaterial | StandardMaterial, state: SurfaceShadowState) {
    super(material, "SurfaceShadowCorruption", 210, {}, true, true);
    this.state = state;
    this.outputColorName = material instanceof PBRMaterial ? "finalColor" : "color";
  }

  override isCompatible(shaderLanguage: ShaderLanguage) {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override getClassName() {
    return "SurfaceShadowCorruption";
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "surfaceShadowState", size: 4, type: "vec4" },
        { name: "surfaceShadowBounds", size: 4, type: "vec4" },
        { name: "surfaceShadowTuning", size: 4, type: "vec4" },
      ],
      fragment: `
uniform vec4 surfaceShadowState;
uniform vec4 surfaceShadowBounds;
uniform vec4 surfaceShadowTuning;
`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer) {
    const state = this.state;
    uniformBuffer.updateFloat4(
      "surfaceShadowState",
      state.time,
      state.healthDamage,
      state.sanityDamage,
      state.strength
    );
    uniformBuffer.updateFloat4(
      "surfaceShadowBounds",
      state.bodyBaseY,
      state.bodyHeight,
      state.originX,
      state.originZ
    );
    uniformBuffer.updateFloat4(
      "surfaceShadowTuning",
      state.noiseScale,
      state.flowSpeed,
      state.maxDarkness,
      0
    );
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: VERTEX_DEFINITIONS,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: VERTEX_WORLD_POSITION,
      };
    }
    if (shaderType === "fragment") {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_DEFINITIONS,
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
float surfaceShadowAmount = surfaceShadowMask();
${this.outputColorName}.rgb = mix(${this.outputColorName}.rgb, vec3(0.0039, 0.0039, 0.0078), surfaceShadowAmount);
`,
      };
    }
    return null;
  }
}

function collectSupportedMaterials(material: Material | null, result: Set<PBRMaterial | StandardMaterial>) {
  if (!material) return;
  const subMaterials = (material as Material & { subMaterials?: Array<Material | null> }).subMaterials;
  if (subMaterials?.length) {
    for (const subMaterial of subMaterials) collectSupportedMaterials(subMaterial, result);
    return;
  }
  if (material instanceof PBRMaterial || material instanceof StandardMaterial) result.add(material);
}

/**
 * Adds animated darkness to the avatar's existing PBR/Standard materials.
 * It never creates geometry, changes vertex positions, or alters alpha/depth.
 */
export class SurfaceShadowCorruption {
  private readonly root: TransformNode;
  private readonly bodyMinY: number;
  private readonly state: SurfaceShadowState;
  private readonly plugins: SurfaceShadowMaterialPlugin[];

  constructor(
    root: TransformNode,
    avatarMeshes: readonly AbstractMesh[],
    bodyMinY: number,
    bodyHeight: number,
    config: SurfaceShadowCorruptionConfig
  ) {
    this.root = root;
    this.bodyMinY = bodyMinY;
    this.state = {
      time: 0,
      healthDamage: 0,
      sanityDamage: 0,
      strength: 0,
      bodyBaseY: root.getAbsolutePosition().y + bodyMinY,
      bodyHeight,
      originX: root.getAbsolutePosition().x,
      originZ: root.getAbsolutePosition().z,
      noiseScale: config.noiseScale,
      flowSpeed: config.flowSpeed,
      maxDarkness: config.maxDarkness,
    };

    const materials = new Set<PBRMaterial | StandardMaterial>();
    for (const mesh of avatarMeshes) collectSupportedMaterials(mesh.material, materials);
    this.plugins = Array.from(materials, (material) => new SurfaceShadowMaterialPlugin(material, this.state));
  }

  get materialCount() {
    return this.plugins.length;
  }

  update(time: number, healthDamage: number, sanityDamage: number, strength: number) {
    const rootPosition = this.root.getAbsolutePosition();
    this.state.time = time;
    this.state.healthDamage = healthDamage;
    this.state.sanityDamage = sanityDamage;
    this.state.strength = strength;
    this.state.bodyBaseY = rootPosition.y + this.bodyMinY;
    this.state.originX = rootPosition.x;
    this.state.originZ = rootPosition.z;
  }

  hide() {
    this.state.strength = 0;
  }

  dispose() {
    this.hide();
    for (const plugin of this.plugins) plugin.dispose();
  }
}
