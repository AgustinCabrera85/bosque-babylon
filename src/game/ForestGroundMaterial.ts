import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

const FOREST_GROUND_TEXTURE_ROOT =
  "/assets/models/textures/terrain/forest_ground";
const DRY_TEXTURE_ROOT = `${FOREST_GROUND_TEXTURE_ROOT}/forest_ground_dry_01`;
const VEGETATED_TEXTURE_ROOT =
  `${FOREST_GROUND_TEXTURE_ROOT}/forest_ground_vegetated_01`;

const DRY_BASE_COLOR_TEXTURE =
  `${DRY_TEXTURE_ROOT}/forest_ground_dry_01_basecolor_1024.png`;
const DRY_NORMAL_TEXTURE =
  `${DRY_TEXTURE_ROOT}/forest_ground_dry_01_normal_1024.png`;
const DRY_MASKS_TEXTURE =
  `${DRY_TEXTURE_ROOT}/forest_ground_dry_01_masks_1024.png`;
const VEGETATED_BASE_COLOR_TEXTURE =
  `${VEGETATED_TEXTURE_ROOT}/forest_ground_vegetated_01_basecolor_1024.png`;
const VEGETATED_NORMAL_TEXTURE =
  `${VEGETATED_TEXTURE_ROOT}/forest_ground_vegetated_01_normal_1024.png`;
const VEGETATED_MASKS_TEXTURE =
  `${VEGETATED_TEXTURE_ROOT}/forest_ground_vegetated_01_masks_1024.png`;

export const FOREST_GROUND_TERRAIN_MATERIAL_NAME =
  "forestGroundTerrainMaterial";

export type ForestGroundMaterialRegion = {
  fadeOutStartZ: number;
  fadeOutEndZ: number;
};

const FOREST_GROUND_FRAGMENT_DEFINITIONS = `
uniform sampler2D forestGroundDryBaseSampler;
uniform sampler2D forestGroundDryNormalSampler;
uniform sampler2D forestGroundDryMasksSampler;
uniform sampler2D forestGroundVegetatedBaseSampler;
uniform sampler2D forestGroundVegetatedNormalSampler;
uniform sampler2D forestGroundVegetatedMasksSampler;

float forestGroundHash(vec2 value) {
  return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
}

float forestGroundValueNoise(vec2 position) {
  vec2 cell = floor(position);
  vec2 local = fract(position);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = forestGroundHash(cell);
  float b = forestGroundHash(cell + vec2(1.0, 0.0));
  float c = forestGroundHash(cell + vec2(0.0, 1.0));
  float d = forestGroundHash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

vec2 forestGroundUv(vec3 worldPosition) {
  float rotation = 0.19;
  mat2 rotationMatrix = mat2(
    cos(rotation), -sin(rotation),
    sin(rotation), cos(rotation)
  );
  return rotationMatrix * worldPosition.xz / forestGroundTuning.x;
}

float forestGroundVegetatedMask(vec3 worldPosition) {
  vec2 position = worldPosition.xz;
  float mediumNoise = forestGroundValueNoise(position / 27.0 + vec2(3.7, -8.1));
  float broadNoise = forestGroundValueNoise(position / 63.0 + vec2(-5.3, 2.9));
  float patchNoise = mediumNoise * 0.72 + broadNoise * 0.28;
  float patches = smoothstep(0.57, 0.75, patchNoise);

  // Prefer lateral clearings: not on the path shoulder and not in the dense
  // outer tree belt. A small residual keeps the distribution from looking
  // like a perfectly authored stripe.
  float lateralDistance = abs(worldPosition.x);
  float awayFromPath = smoothstep(5.0, 8.5, lateralDistance);
  float awayFromOuterTrees = 1.0 - smoothstep(20.0, 29.0, lateralDistance);
  float clearingBias = awayFromPath * awayFromOuterTrees;
  return clamp(patches * mix(0.16, 1.0, clearingBias), 0.0, 1.0);
}

float forestGroundMacroVariation(vec3 worldPosition) {
  float macroNoise = forestGroundValueNoise(
    worldPosition.xz / 46.0 + vec2(7.1, 4.2)
  );
  return mix(0.94, 1.06, macroNoise);
}

float forestGroundCoverage(vec3 worldPosition) {
  return 1.0 - smoothstep(
    forestGroundRegion.x,
    forestGroundRegion.y,
    worldPosition.z
  );
}
`;

const FOREST_GROUND_ALBEDO_CODE = `
float forestGroundAlbedoCoverage = forestGroundCoverage(vPositionW);
if (forestGroundAlbedoCoverage > 0.0001) {
  float forestGroundAlbedoVegetation = forestGroundVegetatedMask(vPositionW);
  vec2 forestGroundAlbedoUv = forestGroundUv(vPositionW);
  vec3 forestGroundAlbedo = texture2D(
    forestGroundDryBaseSampler,
    forestGroundAlbedoUv
  ).rgb;
  forestGroundAlbedo = toLinearSpace(vec4(forestGroundAlbedo, 1.0)).rgb;
  forestGroundAlbedo *= forestGroundDryTint.rgb;
  if (forestGroundAlbedoVegetation > 0.0001) {
    vec3 forestGroundVegetatedAlbedo = texture2D(
      forestGroundVegetatedBaseSampler,
      forestGroundAlbedoUv
    ).rgb;
    forestGroundVegetatedAlbedo = toLinearSpace(
      vec4(forestGroundVegetatedAlbedo, 1.0)
    ).rgb;
    forestGroundVegetatedAlbedo *= forestGroundVegetatedTint.rgb;
    forestGroundAlbedo = mix(
      forestGroundAlbedo,
      forestGroundVegetatedAlbedo,
      forestGroundAlbedoVegetation
    );
  }
  surfaceAlbedo = mix(
    surfaceAlbedo,
    forestGroundAlbedo * forestGroundMacroVariation(vPositionW),
    forestGroundAlbedoCoverage
  );
}
`;

const FOREST_GROUND_NORMAL_AND_MASKS_CODE = `
float forestGroundCoverageMain = forestGroundCoverage(vPositionW);
vec3 forestGroundMasksMain = vec3(1.0);
if (forestGroundCoverageMain > 0.0001) {
  float forestGroundVegetationMain = forestGroundVegetatedMask(vPositionW);
  vec2 forestGroundUvMain = forestGroundUv(vPositionW);
  vec3 forestGroundNormalMain = texture2D(
    forestGroundDryNormalSampler,
    forestGroundUvMain
  ).xyz * 2.0 - 1.0;
  forestGroundMasksMain = texture2D(
    forestGroundDryMasksSampler,
    forestGroundUvMain
  ).rgb;
  if (forestGroundVegetationMain > 0.0001) {
    vec3 forestGroundVegetatedNormal = texture2D(
      forestGroundVegetatedNormalSampler,
      forestGroundUvMain
    ).xyz * 2.0 - 1.0;
    vec3 forestGroundVegetatedMasks = texture2D(
      forestGroundVegetatedMasksSampler,
      forestGroundUvMain
    ).rgb;
    forestGroundNormalMain = normalize(mix(
      forestGroundNormalMain,
      forestGroundVegetatedNormal,
      forestGroundVegetationMain
    ));
    forestGroundMasksMain = mix(
      forestGroundMasksMain,
      forestGroundVegetatedMasks,
      forestGroundVegetationMain
    );
  }
  forestGroundNormalMain.xy *= forestGroundTuning.y;
  forestGroundNormalMain = normalize(forestGroundNormalMain);

  vec3 forestGroundDpDx = dFdx(vPositionW);
  vec3 forestGroundDpDy = dFdy(vPositionW);
  vec2 forestGroundUvDx = dFdx(forestGroundUvMain);
  vec2 forestGroundUvDy = dFdy(forestGroundUvMain);
  vec3 forestGroundTangentRaw =
    forestGroundDpDx * forestGroundUvDy.y -
    forestGroundDpDy * forestGroundUvDx.y;
  vec3 forestGroundBitangentRaw =
    -forestGroundDpDx * forestGroundUvDy.x +
    forestGroundDpDy * forestGroundUvDx.x;
  vec3 forestGroundTangent = normalize(
    forestGroundTangentRaw - normalW * dot(normalW, forestGroundTangentRaw)
  );
  vec3 forestGroundBitangent = normalize(cross(normalW, forestGroundTangent));
  forestGroundBitangent *= sign(dot(
    forestGroundBitangent,
    forestGroundBitangentRaw
  ));
  vec3 forestGroundWorldNormal = normalize(mat3(
    forestGroundTangent,
    forestGroundBitangent,
    normalW
  ) * forestGroundNormalMain);
  normalW = normalize(mix(
    normalW,
    forestGroundWorldNormal,
    forestGroundCoverageMain
  ));
}
`;

const FOREST_GROUND_METALLIC_ROUGHNESS_CODE = `
float forestGroundReflectivityCoverage = forestGroundCoverage(vPositionW);
if (forestGroundReflectivityCoverage > 0.0001) {
  float forestGroundVegetationReflectivity = forestGroundVegetatedMask(vPositionW);
  vec2 forestGroundReflectivityUv = forestGroundUv(vPositionW);
  vec3 forestGroundMasks = texture2D(
    forestGroundDryMasksSampler,
    forestGroundReflectivityUv
  ).rgb;
  if (forestGroundVegetationReflectivity > 0.0001) {
    vec3 forestGroundVegetatedMasks = texture2D(
      forestGroundVegetatedMasksSampler,
      forestGroundReflectivityUv
    ).rgb;
    forestGroundMasks = mix(
      forestGroundMasks,
      forestGroundVegetatedMasks,
      forestGroundVegetationReflectivity
    );
  }
  metallicRoughness.r = mix(
    metallicRoughness.r,
    0.0,
    forestGroundReflectivityCoverage
  );
  metallicRoughness.g = mix(
    metallicRoughness.g,
    clamp(forestGroundMasks.g, 0.72, 0.98),
    forestGroundReflectivityCoverage
  );
}
`;

const FOREST_GROUND_AO_CODE = `$1
float forestGroundAo = mix(
  1.0,
  forestGroundMasksMain.b,
  forestGroundTuning.z
);
aoOut.ambientOcclusionColor *= vec3(mix(
  1.0,
  forestGroundAo,
  forestGroundCoverageMain
));
`;

class ForestGroundMaterialPlugin extends MaterialPluginBase {
  private readonly dryBaseColorTexture: Texture;
  private readonly dryNormalTexture: Texture;
  private readonly dryMasksTexture: Texture;
  private readonly vegetatedBaseColorTexture: Texture;
  private readonly vegetatedNormalTexture: Texture;
  private readonly vegetatedMasksTexture: Texture;

  constructor(
    material: PBRMaterial,
    private readonly region?: ForestGroundMaterialRegion
  ) {
    super(material, "ForestGround", 185, {}, true, true);
    const scene = material.getScene();
    this.dryBaseColorTexture = this.createTexture(
      DRY_BASE_COLOR_TEXTURE,
      scene,
      true
    );
    this.dryNormalTexture = this.createTexture(DRY_NORMAL_TEXTURE, scene, false);
    this.dryMasksTexture = this.createTexture(DRY_MASKS_TEXTURE, scene, false);
    this.vegetatedBaseColorTexture = this.createTexture(
      VEGETATED_BASE_COLOR_TEXTURE,
      scene,
      true
    );
    this.vegetatedNormalTexture = this.createTexture(
      VEGETATED_NORMAL_TEXTURE,
      scene,
      false
    );
    this.vegetatedMasksTexture = this.createTexture(
      VEGETATED_MASKS_TEXTURE,
      scene,
      false
    );
  }

  private createTexture(url: string, scene: Scene, gammaSpace: boolean) {
    const texture = new Texture(url, scene, {
      noMipmap: false,
      invertY: false,
      samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
      gammaSpace,
      useSRGBBuffer: false,
    });
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;
    return texture;
  }

  override isCompatible(shaderLanguage: ShaderLanguage) {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override getClassName() {
    return "ForestGround";
  }

  override isReadyForSubMesh() {
    return [
      this.dryBaseColorTexture,
      this.dryNormalTexture,
      this.dryMasksTexture,
      this.vegetatedBaseColorTexture,
      this.vegetatedNormalTexture,
      this.vegetatedMasksTexture,
    ].every((texture) => texture.isReadyOrNotBlocking());
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "forestGroundTuning", size: 4, type: "vec4" },
        { name: "forestGroundRegion", size: 4, type: "vec4" },
        { name: "forestGroundDryTint", size: 4, type: "vec4" },
        { name: "forestGroundVegetatedTint", size: 4, type: "vec4" },
      ],
      fragment: `
uniform vec4 forestGroundTuning;
uniform vec4 forestGroundRegion;
uniform vec4 forestGroundDryTint;
uniform vec4 forestGroundVegetatedTint;
`,
    };
  }

  override getSamplers(samplers: string[]) {
    samplers.push(
      "forestGroundDryBaseSampler",
      "forestGroundDryNormalSampler",
      "forestGroundDryMasksSampler",
      "forestGroundVegetatedBaseSampler",
      "forestGroundVegetatedNormalSampler",
      "forestGroundVegetatedMasksSampler"
    );
  }

  override getActiveTextures(activeTextures: BaseTexture[]) {
    activeTextures.push(
      this.dryBaseColorTexture,
      this.dryNormalTexture,
      this.dryMasksTexture,
      this.vegetatedBaseColorTexture,
      this.vegetatedNormalTexture,
      this.vegetatedMasksTexture
    );
  }

  override hasTexture(texture: BaseTexture) {
    return [
      this.dryBaseColorTexture,
      this.dryNormalTexture,
      this.dryMasksTexture,
      this.vegetatedBaseColorTexture,
      this.vegetatedNormalTexture,
      this.vegetatedMasksTexture,
    ].includes(texture as Texture);
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer) {
    // x: metres per texture repeat, y: normal strength, z: AO strength.
    // 5.04 m is exactly 70% of the previous 7.2 m feature scale.
    uniformBuffer.updateFloat4("forestGroundTuning", 5.04, 0.56, 0.58, 0);
    uniformBuffer.updateFloat4(
      "forestGroundRegion",
      this.region?.fadeOutStartZ ?? 1_000_000,
      this.region?.fadeOutEndZ ?? 1_000_001,
      0,
      0
    );
    uniformBuffer.updateFloat4("forestGroundDryTint", 0.56, 0.51, 0.44, 1);
    uniformBuffer.updateFloat4(
      "forestGroundVegetatedTint",
      0.43,
      0.47,
      0.35,
      1
    );
    uniformBuffer.setTexture(
      "forestGroundDryBaseSampler",
      this.dryBaseColorTexture
    );
    uniformBuffer.setTexture(
      "forestGroundDryNormalSampler",
      this.dryNormalTexture
    );
    uniformBuffer.setTexture(
      "forestGroundDryMasksSampler",
      this.dryMasksTexture
    );
    uniformBuffer.setTexture(
      "forestGroundVegetatedBaseSampler",
      this.vegetatedBaseColorTexture
    );
    uniformBuffer.setTexture(
      "forestGroundVegetatedNormalSampler",
      this.vegetatedNormalTexture
    );
    uniformBuffer.setTexture(
      "forestGroundVegetatedMasksSampler",
      this.vegetatedMasksTexture
    );
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: FOREST_GROUND_FRAGMENT_DEFINITIONS,
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: FOREST_GROUND_ALBEDO_CODE,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: FOREST_GROUND_NORMAL_AND_MASKS_CODE,
      CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS:
        FOREST_GROUND_METALLIC_ROUGHNESS_CODE,
      "!(aoOut=ambientOcclusionBlock\\([\\s\\S]*?\\);)": FOREST_GROUND_AO_CODE,
    };
  }

  override dispose() {
    this.dryBaseColorTexture.dispose();
    this.dryNormalTexture.dispose();
    this.dryMasksTexture.dispose();
    this.vegetatedBaseColorTexture.dispose();
    this.vegetatedNormalTexture.dispose();
    this.vegetatedMasksTexture.dispose();
    super.dispose();
  }
}

/**
 * Gives the terrain an isolated, world-space forest-floor material. The source
 * logical grass material remains shared by grass instances and other meshes.
 */
export function applyForestGroundMaterial(
  scene: Scene,
  terrainMesh: Mesh,
  region?: ForestGroundMaterialRegion
) {
  const baseMaterial = terrainMesh.material;
  if (!(baseMaterial instanceof PBRMaterial)) return null;

  const terrainMaterial = baseMaterial.clone(
    FOREST_GROUND_TERRAIN_MATERIAL_NAME
  );
  if (!terrainMaterial) return null;

  // Preserve the inherited albedo as a colour fallback where the regional
  // plugins feather out, but do not retain its normal map. Babylon evaluates
  // the base bump before plugin hooks, so keeping it would layer the legacy
  // wispy-grass relief underneath both the forest-floor and lagoon normals.
  // The lagoon supplies its own authored Rocks_normal.png response.
  terrainMaterial.bumpTexture = null;
  terrainMaterial.metallic = 0;
  terrainMaterial.roughness = 0.9;
  terrainMesh.material = terrainMaterial;

  new ForestGroundMaterialPlugin(terrainMaterial, region);
  terrainMaterial.markAsDirty(PBRMaterial.AllDirtyFlag);
  scene.markAllMaterialsAsDirty(PBRMaterial.AllDirtyFlag);
  return terrainMaterial;
}
