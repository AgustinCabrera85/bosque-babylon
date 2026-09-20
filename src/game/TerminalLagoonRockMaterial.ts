import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

export type TerminalLagoonRockRegion = {
  seed: number;
  transitionStartZ: number;
  lagoonCenterX: number;
  lagoonCenterZ: number;
  lagoonRadiusX: number;
  lagoonRadiusZ: number;
  waterfallZ: number;
};

const ROCK_TEXTURE_ROOT = "/assets/models/textures/terrain/ground_rocks";

/** World-space metres covered by one repeat of the authored rock texture. */
export const TERMINAL_LAGOON_ROCK_TILE_METERS = 5.5;

const ROCK_BASE_COLOR_TEXTURE = `${ROCK_TEXTURE_ROOT}/Rocks_basecolor.png`;
const ROCK_NORMAL_TEXTURE = `${ROCK_TEXTURE_ROOT}/Rocks_normal.png`;
const ROCK_ORM_TEXTURE = `${ROCK_TEXTURE_ROOT}/Rocks_ORM.png`;

const ROCK_FRAGMENT_DEFINITIONS = `
uniform sampler2D terminalLagoonRockBaseSampler;
uniform sampler2D terminalLagoonRockNormalSampler;
uniform sampler2D terminalLagoonRockOrmSampler;

float terminalLagoonRockDistance(vec3 worldPosition) {
  vec2 localPosition = worldPosition.xz - terminalLagoonRockRegion.xy;
  float angle = atan(localPosition.y, localPosition.x);
  float phase = terminalLagoonRockTuning.x;
  float irregularZ = 1.0 + cos(angle * 4.0 - phase) * 0.055;
  float rearAngleDelta = atan(
    sin(angle - 1.57079632679),
    cos(angle - 1.57079632679)
  );
  float rearCoveWeight = exp(-pow(abs(rearAngleDelta) / 0.34, 4.0));
  float edgeScaleX =
    1.0 +
    sin(angle * 3.0 + phase) * 0.075 +
    sin(angle * 7.0 - phase) * 0.035;
  float edgeScaleZ = mix(
    irregularZ,
    max(irregularZ, terminalLagoonRockTuning.y),
    rearCoveWeight
  );
  vec2 scaledRadii = max(
    terminalLagoonRockRegion.zw * vec2(edgeScaleX, edgeScaleZ),
    vec2(0.001)
  );
  return length(localPosition / scaledRadii);
}

float terminalLagoonTransitionMask(vec3 worldPosition) {
  float corridorProgress = smoothstep(
    terminalLagoonRockCoverage.x,
    terminalLagoonRockCoverage.y,
    worldPosition.z
  );
  float corridorHalfWidth = mix(
    terminalLagoonRockCoverage.z,
    terminalLagoonRockCoverage.w,
    corridorProgress
  );
  float lateralMask = 1.0 - smoothstep(
    corridorHalfWidth,
    corridorHalfWidth + 12.0,
    abs(worldPosition.x - terminalLagoonRockRegion.x)
  );
  float entranceMask = smoothstep(
    terminalLagoonRockCoverage.x - 10.0,
    terminalLagoonRockCoverage.x - 1.0,
    worldPosition.z
  );
  float lagoonJoinMask = 1.0 - smoothstep(
    terminalLagoonRockCoverage.y,
    terminalLagoonRockCoverage.y + 10.0,
    worldPosition.z
  );
  return entranceMask * lagoonJoinMask * lateralMask;
}

float terminalLagoonRockMask(vec3 worldPosition, float normalizedDistance) {
  // The basin remains fully rocky while the outer bank dissolves into grass.
  float lagoonMask = 1.0 - smoothstep(1.08, 1.43, normalizedDistance);
  // Continue the same material through the authored terminal transition so no
  // untextured grass/soil islands remain between the path and the shoreline.
  return max(lagoonMask, terminalLagoonTransitionMask(worldPosition));
}

float terminalLagoonRockWetBand(float normalizedDistance) {
  // A narrow, matte wet band follows the authored waterline without becoming a mirror.
  return 1.0 - smoothstep(0.025, 0.19, abs(normalizedDistance - 1.0));
}

vec2 terminalLagoonRockUv(vec3 worldPosition) {
  float rotation = 0.37;
  mat2 rotationMatrix = mat2(
    cos(rotation), -sin(rotation),
    sin(rotation), cos(rotation)
  );
  return rotationMatrix * worldPosition.xz / terminalLagoonRockTuning.z;
}
`;

const ROCK_ALBEDO_CODE = `
float terminalLagoonRockAlbedoDistance = terminalLagoonRockDistance(vPositionW);
float terminalLagoonRockAlbedoMask = terminalLagoonRockMask(
  vPositionW,
  terminalLagoonRockAlbedoDistance
);
if (terminalLagoonRockAlbedoMask > 0.0001) {
  vec2 terminalLagoonRockAlbedoUv = terminalLagoonRockUv(vPositionW);
  vec3 terminalLagoonRockAlbedo = texture2D(
    terminalLagoonRockBaseSampler,
    terminalLagoonRockAlbedoUv
  ).rgb;
  terminalLagoonRockAlbedo = toLinearSpace(vec4(terminalLagoonRockAlbedo, 1.0)).rgb;
  float terminalLagoonRockWetness = terminalLagoonRockWetBand(
    terminalLagoonRockAlbedoDistance
  );
  terminalLagoonRockAlbedo *= terminalLagoonRockTint.rgb;
  terminalLagoonRockAlbedo *= mix(1.0, 0.72, terminalLagoonRockWetness);
  surfaceAlbedo = mix(
    surfaceAlbedo,
    terminalLagoonRockAlbedo,
    terminalLagoonRockAlbedoMask
  );
}
`;

const ROCK_NORMAL_AND_ORM_CODE = `
float terminalLagoonRockDistanceMain = terminalLagoonRockDistance(vPositionW);
float terminalLagoonRockMaskMain = terminalLagoonRockMask(
  vPositionW,
  terminalLagoonRockDistanceMain
);
vec3 terminalLagoonRockOrmMain = vec3(1.0, 0.86, 0.0);
if (terminalLagoonRockMaskMain > 0.0001) {
  vec2 terminalLagoonRockUvMain = terminalLagoonRockUv(vPositionW);
  terminalLagoonRockOrmMain = texture2D(
    terminalLagoonRockOrmSampler,
    terminalLagoonRockUvMain
  ).rgb;

  vec3 terminalLagoonRockNormal = texture2D(
    terminalLagoonRockNormalSampler,
    terminalLagoonRockUvMain
  ).xyz * 2.0 - 1.0;
  terminalLagoonRockNormal.xy *= terminalLagoonRockTuning.w;
  terminalLagoonRockNormal = normalize(terminalLagoonRockNormal);

  vec3 terminalLagoonRockDpDx = dFdx(vPositionW);
  vec3 terminalLagoonRockDpDy = dFdy(vPositionW);
  vec2 terminalLagoonRockUvDx = dFdx(terminalLagoonRockUvMain);
  vec2 terminalLagoonRockUvDy = dFdy(terminalLagoonRockUvMain);
  vec3 terminalLagoonRockTangentRaw =
    terminalLagoonRockDpDx * terminalLagoonRockUvDy.y -
    terminalLagoonRockDpDy * terminalLagoonRockUvDx.y;
  vec3 terminalLagoonRockBitangentRaw =
    -terminalLagoonRockDpDx * terminalLagoonRockUvDy.x +
    terminalLagoonRockDpDy * terminalLagoonRockUvDx.x;
  vec3 terminalLagoonRockTangent = normalize(
    terminalLagoonRockTangentRaw -
    normalW * dot(normalW, terminalLagoonRockTangentRaw)
  );
  vec3 terminalLagoonRockBitangent = normalize(
    cross(normalW, terminalLagoonRockTangent)
  );
  terminalLagoonRockBitangent *= sign(
    dot(terminalLagoonRockBitangent, terminalLagoonRockBitangentRaw)
  );
  vec3 terminalLagoonRockWorldNormal = normalize(
    mat3(
      terminalLagoonRockTangent,
      terminalLagoonRockBitangent,
      normalW
    ) * terminalLagoonRockNormal
  );
  normalW = normalize(mix(
    normalW,
    terminalLagoonRockWorldNormal,
    terminalLagoonRockMaskMain
  ));
}
`;

const ROCK_METALLIC_ROUGHNESS_CODE = `
float terminalLagoonRockReflectivityDistance = terminalLagoonRockDistance(vPositionW);
float terminalLagoonRockReflectivityMask = terminalLagoonRockMask(
  vPositionW,
  terminalLagoonRockReflectivityDistance
);
if (terminalLagoonRockReflectivityMask > 0.0001) {
  vec3 terminalLagoonRockOrm = texture2D(
    terminalLagoonRockOrmSampler,
    terminalLagoonRockUv(vPositionW)
  ).rgb;
  float terminalLagoonRockWetness = terminalLagoonRockWetBand(
    terminalLagoonRockReflectivityDistance
  );
  float terminalLagoonRockRoughness = clamp(terminalLagoonRockOrm.g, 0.70, 0.98);
  terminalLagoonRockRoughness = max(
    0.58,
    terminalLagoonRockRoughness - terminalLagoonRockWetness * 0.14
  );
  // B is the authored metallic channel, clamped because natural rock is dielectric.
  float terminalLagoonRockMetallic = min(terminalLagoonRockOrm.b, 0.015);
  metallicRoughness.r = mix(
    metallicRoughness.r,
    terminalLagoonRockMetallic,
    terminalLagoonRockReflectivityMask
  );
  metallicRoughness.g = mix(
    metallicRoughness.g,
    terminalLagoonRockRoughness,
    terminalLagoonRockReflectivityMask
  );
}
`;

const ROCK_AO_CODE = `$1
if (terminalLagoonRockMaskMain > 0.0001) {
  // R is the packed ambient-occlusion channel; keep the influence restrained.
  float terminalLagoonRockAo = mix(
    1.0,
    terminalLagoonRockOrmMain.r,
    terminalLagoonRockTint.a
  );
  aoOut.ambientOcclusionColor *= mix(
    vec3(1.0),
    vec3(terminalLagoonRockAo),
    terminalLagoonRockMaskMain
  );
}
`;

class TerminalLagoonRockMaterialPlugin extends MaterialPluginBase {
  private readonly baseColorTexture: Texture;
  private readonly normalTexture: Texture;
  private readonly ormTexture: Texture;
  private readonly phase: number;
  private readonly rearCoveScale: number;

  constructor(
    material: PBRMaterial,
    private readonly region: TerminalLagoonRockRegion
  ) {
    super(material, "TerminalLagoonRock", 195, {}, true, true);

    this.phase = (region.seed % 997) * 0.017;
    this.rearCoveScale =
      (region.waterfallZ + 2.5 - region.lagoonCenterZ) /
      region.lagoonRadiusZ;
    this.baseColorTexture = this.createTexture(
      ROCK_BASE_COLOR_TEXTURE,
      material.getScene(),
      true
    );
    this.normalTexture = this.createTexture(
      ROCK_NORMAL_TEXTURE,
      material.getScene(),
      false
    );
    this.ormTexture = this.createTexture(
      ROCK_ORM_TEXTURE,
      material.getScene(),
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
    return "TerminalLagoonRock";
  }

  override isReadyForSubMesh() {
    return (
      this.baseColorTexture.isReadyOrNotBlocking() &&
      this.normalTexture.isReadyOrNotBlocking() &&
      this.ormTexture.isReadyOrNotBlocking()
    );
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "terminalLagoonRockRegion", size: 4, type: "vec4" },
        { name: "terminalLagoonRockCoverage", size: 4, type: "vec4" },
        { name: "terminalLagoonRockTuning", size: 4, type: "vec4" },
        { name: "terminalLagoonRockTint", size: 4, type: "vec4" },
      ],
      fragment: `
uniform vec4 terminalLagoonRockRegion;
uniform vec4 terminalLagoonRockCoverage;
uniform vec4 terminalLagoonRockTuning;
uniform vec4 terminalLagoonRockTint;
`,
    };
  }

  override getSamplers(samplers: string[]) {
    samplers.push(
      "terminalLagoonRockBaseSampler",
      "terminalLagoonRockNormalSampler",
      "terminalLagoonRockOrmSampler"
    );
  }

  override getActiveTextures(activeTextures: BaseTexture[]) {
    activeTextures.push(
      this.baseColorTexture,
      this.normalTexture,
      this.ormTexture
    );
  }

  override hasTexture(texture: BaseTexture) {
    return (
      texture === this.baseColorTexture ||
      texture === this.normalTexture ||
      texture === this.ormTexture
    );
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer) {
    uniformBuffer.updateFloat4(
      "terminalLagoonRockRegion",
      this.region.lagoonCenterX,
      this.region.lagoonCenterZ,
      this.region.lagoonRadiusX,
      this.region.lagoonRadiusZ
    );
    uniformBuffer.updateFloat4(
      "terminalLagoonRockCoverage",
      this.region.transitionStartZ,
      this.region.lagoonCenterZ - this.region.lagoonRadiusZ * 0.42,
      this.region.lagoonRadiusX * 0.92,
      this.region.lagoonRadiusX * 1.36
    );
    uniformBuffer.updateFloat4(
      "terminalLagoonRockTuning",
      this.phase,
      this.rearCoveScale,
      TERMINAL_LAGOON_ROCK_TILE_METERS,
      0.58
    );
    uniformBuffer.updateFloat4(
      "terminalLagoonRockTint",
      0.52,
      0.56,
      0.55,
      0.76
    );
    uniformBuffer.setTexture(
      "terminalLagoonRockBaseSampler",
      this.baseColorTexture
    );
    uniformBuffer.setTexture(
      "terminalLagoonRockNormalSampler",
      this.normalTexture
    );
    uniformBuffer.setTexture("terminalLagoonRockOrmSampler", this.ormTexture);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: ROCK_FRAGMENT_DEFINITIONS,
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: ROCK_ALBEDO_CODE,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: ROCK_NORMAL_AND_ORM_CODE,
      CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: ROCK_METALLIC_ROUGHNESS_CODE,
      "!(aoOut=ambientOcclusionBlock\\([\\s\\S]*?\\);)": ROCK_AO_CODE,
    };
  }

  override dispose() {
    this.baseColorTexture.dispose();
    this.normalTexture.dispose();
    this.ormTexture.dispose();
    super.dispose();
  }
}

/**
 * Gives the existing terminal terrain a local rock response around the lagoon.
 * Geometry, collision data and water render-list membership remain unchanged.
 */
export function applyTerminalLagoonRockMaterial(
  scene: Scene,
  terrainMesh: Mesh,
  region: TerminalLagoonRockRegion
) {
  const baseMaterial = terrainMesh.material;
  if (!(baseMaterial instanceof PBRMaterial)) return null;

  const lagoonTerrainMaterial = baseMaterial.clone(
    "terminalLagoonTerrainMaterial"
  );
  if (!lagoonTerrainMaterial) return null;

  terrainMesh.material = lagoonTerrainMaterial;
  new TerminalLagoonRockMaterialPlugin(lagoonTerrainMaterial, region);
  lagoonTerrainMaterial.markAsDirty(PBRMaterial.AllDirtyFlag);
  scene.markAllMaterialsAsDirty(PBRMaterial.AllDirtyFlag);
  return lagoonTerrainMaterial;
}
