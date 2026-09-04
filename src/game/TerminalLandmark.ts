import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Light } from "@babylonjs/core/Lights/light";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Scene } from "@babylonjs/core/scene";
import { WaterMaterial } from "@babylonjs/materials/water";
import { setGameMaterial } from "../materials";
import { mulberry32 } from "../utils/seed";
import type { PlantLibrary } from "./PlantLibrary";
import type { RockLibrary } from "./RockLibrary";
import type { TerrainHandle, TerrainHeightModifier } from "./Terrain";
import type { TreeLibrary } from "./TreeLibrary";
import { createCandleFireMaterial, createGlowMaterial } from "./Torches";
import {
  TERMINAL_LAGOON_VISUAL_CONFIG,
  type TerminalLagoonVisualConfig,
} from "./TerminalLagoonVisualConfig";

export const DEFAULT_END_HOUSE_SEGMENT = 8;
export const DEFAULT_WORLD_SEGMENT_LENGTH = 70;
const CAVE_LIGHT_ACTIVATION_RADIUS = 112;

export type TerminalLandmarkConfig = {
  seed: number;
  houseFrontZ: number;
  transitionStartZ: number;
  lagoonCenterX: number;
  lagoonCenterZ: number;
  lagoonRadiusX: number;
  lagoonRadiusZ: number;
  lagoonDepth: number;
  waterLevel: number;
  waterfallZ: number;
  waterfallWidth: number;
  backCliffZ: number;
  cliffHeight: number;
};

export type TerminalCollisionBlocker = {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation?: number;
};

/**
 * Navigation datum only. A future level-exit system can consume this anchor
 * without coupling map loading or transition behavior to the landmark.
 */
export type TerminalPassageAnchor = {
  position: Vector3;
  direction: Vector3;
};

export type TerminalLandmarkHandle = {
  root: TransformNode;
  lagoon: Mesh;
  lagoonWaterMaterial: WaterMaterial;
  underwaterLight: PointLight;
  waterfallImpactLight: PointLight;
  waterfall: Mesh;
  waterfallLayers: readonly Mesh[];
  waterfallImpactPoint: Vector3;
  passageAnchor: TerminalPassageAnchor;
  update: (deltaTime: number, playerPosition?: Vector3) => void;
  blockers: readonly TerminalCollisionBlocker[];
  generationExclusion: TerminalCollisionBlocker;
};

type TerminalLayoutOptions = {
  segmentLength?: number;
  endHouseSegment?: number;
  seed?: number;
};

export type TerminalLandmarkRenderOptions = {
  waterRenderTargetSize?: number;
  environmentReflectionMeshes?: readonly AbstractMesh[];
  visualConfig?: TerminalLagoonVisualConfig;
  instantiateCandleAsset?: (
    name: string,
    scale: Vector3
  ) => {
    root: TransformNode;
    baseOffsetY: number;
    topOffsetY: number;
  } | null;
};

export function createTerminalLandmarkConfig(
  options: TerminalLayoutOptions = {}
): TerminalLandmarkConfig {
  const segmentLength = options.segmentLength ?? DEFAULT_WORLD_SEGMENT_LENGTH;
  const endHouseSegment = options.endHouseSegment ?? DEFAULT_END_HOUSE_SEGMENT;
  const houseFrontZ = segmentLength * endHouseSegment;

  return {
    seed: options.seed ?? 0x1a90_0f11,
    houseFrontZ,
    transitionStartZ: houseFrontZ + 34,
    lagoonCenterX: 0,
    lagoonCenterZ: houseFrontZ + 98,
    lagoonRadiusX: 34,
    lagoonRadiusZ: 42,
    lagoonDepth: 3.8,
    waterLevel: TERMINAL_LAGOON_VISUAL_CONFIG.underwater.waterLevel,
    waterfallZ: houseFrontZ + 143,
    waterfallWidth: 15,
    backCliffZ: houseFrontZ + 151,
    cliffHeight: 20,
  };
}

/**
 * Shapes the same procedural terrain used by the forest. Keeping this as a pure
 * function lets Terrain generate correct heights before any landmark meshes exist.
 */
export function createTerminalTerrainModifier(
  config: TerminalLandmarkConfig
): TerrainHeightModifier {
  const phase = (config.seed % 997) * 0.017;

  return (x, z, currentHeight) => {
    const localX = x - config.lagoonCenterX;
    const localZ = z - config.lagoonCenterZ;
    const angle = Math.atan2(localZ, localX);
    const irregularX = 1 + Math.sin(angle * 3 + phase) * 0.075 + Math.sin(angle * 7 - phase) * 0.035;
    const irregularZ = 1 + Math.cos(angle * 4 - phase) * 0.055;
    const lagoonDistance = Math.hypot(
      localX / (config.lagoonRadiusX * irregularX),
      localZ / (config.lagoonRadiusZ * irregularZ)
    );

    const basinWeight = 1 - smoothstep(0.72, 1.08, lagoonDistance);
    const centerDepth = 1 - smoothstep(0, 0.9, lagoonDistance);
    const basinHeight = config.waterLevel - 0.35 - config.lagoonDepth * centerDepth;
    let height = lerp(currentHeight, basinHeight, basinWeight);

    const rearRamp = smoothstep(config.waterfallZ + 1, config.backCliffZ + 8, z);
    const rearWidth = 1 - smoothstep(58, 88, Math.abs(localX));
    height += rearRamp * rearWidth * config.cliffHeight;

    const terminalBand =
      smoothstep(config.transitionStartZ + 6, config.lagoonCenterZ - 4, z) *
      (1 - smoothstep(config.backCliffZ + 16, config.backCliffZ + 48, z));
    const sideRise = smoothstep(
      config.lagoonRadiusX * 0.78,
      config.lagoonRadiusX + 22,
      Math.abs(localX)
    );
    height += terminalBand * sideRise * 11;

    return height;
  };
}

type WaterfallMetrics = {
  cliffTop: number;
  bottom: number;
  height: number;
  impactPoint: Vector3;
};

type CaveCandleDecoration = {
  meshes: AbstractMesh[];
  lights: PointLight[];
};

class LagoonRippleMaterialPlugin extends MaterialPluginBase {
  private readonly shaderCode: string;

  constructor(
    material: WaterMaterial,
    impactPointLocal: Vector2,
    tuning: TerminalLagoonVisualConfig["lagoon"]
  ) {
    super(material, "LagoonImpactRipple", 190, {}, true, true);
    this.shaderCode = `
float lagoonRippleDistance = distance(p.xz, vec2(${impactPointLocal.x.toFixed(6)}, ${impactPointLocal.y.toFixed(6)}));
float lagoonRippleEnvelope = exp(-lagoonRippleDistance * ${tuning.rippleFalloff.toFixed(6)});
lagoonRippleEnvelope *= 1.0 - smoothstep(${(tuning.rippleRadius * 0.78).toFixed(6)}, ${tuning.rippleRadius.toFixed(6)}, lagoonRippleDistance);
float lagoonRipple = sin(lagoonRippleDistance * ${tuning.rippleFrequency.toFixed(6)} - time * ${tuning.rippleSpeed.toFixed(6)});
p.y += lagoonRipple * ${tuning.rippleAmplitude.toFixed(6)} * lagoonRippleEnvelope;
#ifdef USE_WORLD_COORDINATES
gl_Position = viewProjection * vec4(p, 1.0);
#else
gl_Position = viewProjection * finalWorld * vec4(p, 1.0);
#endif
`;
  }

  override isCompatible(shaderLanguage: ShaderLanguage) {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override getClassName() {
    return "LagoonImpactRipple";
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "vertex") return null;
    return { CUSTOM_VERTEX_MAIN_END: this.shaderCode };
  }
}

export class TerminalLandmarkGenerator {
  private readonly animatedMaterials = new Set<ShaderMaterial>();
  private readonly flickeringLights: {
    light: PointLight;
    baseIntensity: number;
    phase: number;
  }[] = [];
  private animationTime = 0;

  constructor(
    private readonly scene: Scene,
    private readonly terrain: TerrainHandle,
    private readonly treeLibrary: TreeLibrary,
    private readonly rockLibrary: RockLibrary,
    private readonly plantLibrary: PlantLibrary,
    private readonly renderOptions: TerminalLandmarkRenderOptions = {}
  ) {}

  private get visualConfig() {
    return this.renderOptions.visualConfig ?? TERMINAL_LAGOON_VISUAL_CONFIG;
  }

  generateWaterfallLagoonEnd(config: TerminalLandmarkConfig): TerminalLandmarkHandle {
    const root = new TransformNode("terminalWaterfallLagoonRoot", this.scene);
    const random = mulberry32(config.seed);

    this.createFadingTrail(root, config, random);
    const lagoon = this.createLagoon(root, config);
    const waterfallMetrics = this.getWaterfallMetrics(config);
    const passageAnchor = this.createPassageAnchor(config);
    const waterfallLayers = this.createWaterfall(root, config, waterfallMetrics);
    const waterfallFoam = this.createWaterfallFoam(root, config, waterfallMetrics.impactPoint);
    this.createWaterfallSplash(config, waterfallMetrics.impactPoint);
    this.createWaterfallMist(config, waterfallMetrics.impactPoint);
    const nearbyRockMeshes = this.populateRockClosure(root, config, random);
    const caveRockMeshes = this.populateWaterfallCaveRocks(
      root,
      config,
      waterfallMetrics,
      random
    );
    nearbyRockMeshes.push(...caveRockMeshes);
    const caveCandles = this.createCaveEntranceCandles(
      root,
      config,
      waterfallMetrics,
      random
    );
    const nearbyVegetationMeshes = this.populateWetVegetation(root, config, random);
    const lagoonWaterMaterial = this.createLagoonWaterMaterial(
      config,
      waterfallMetrics.impactPoint
    );
    const waterRenderMeshes = [
      ...waterfallLayers,
      waterfallFoam,
      ...nearbyRockMeshes,
      ...nearbyVegetationMeshes,
      ...caveCandles.meshes,
    ];
    this.configureLagoonRenderLists(lagoonWaterMaterial, lagoon, waterRenderMeshes);
    lagoon.material = lagoonWaterMaterial;

    const underwaterLight = this.createUnderwaterLight(root, config);
    const waterfallImpactLight = this.createWaterfallImpactLight(
      root,
      waterfallMetrics.impactPoint
    );
    this.limitLagoonLights(
      underwaterLight,
      waterfallImpactLight,
      lagoon,
      waterRenderMeshes
    );
    this.limitCaveCandleLights(caveCandles.lights, [
      this.terrain.mesh,
      ...caveRockMeshes,
      ...caveCandles.meshes,
    ]);

    return {
      root,
      lagoon,
      lagoonWaterMaterial,
      underwaterLight,
      waterfallImpactLight,
      waterfall: waterfallLayers[0],
      waterfallLayers,
      waterfallImpactPoint: waterfallMetrics.impactPoint.clone(),
      passageAnchor,
      update: (deltaTime, playerPosition) => this.updateAnimation(deltaTime, playerPosition),
      blockers: createTerminalBlockers(config),
      generationExclusion: {
        x: config.lagoonCenterX,
        z: (config.transitionStartZ + config.backCliffZ) * 0.5,
        width: 150,
        depth: config.backCliffZ - config.transitionStartZ + 64,
      },
    };
  }

  private createFadingTrail(
    root: TransformNode,
    config: TerminalLandmarkConfig,
    random: () => number
  ) {
    const shoreZ = config.lagoonCenterZ - config.lagoonRadiusZ * 0.86;
    const patchCount = 9;

    for (let index = 0; index < patchCount; index++) {
      const t = index / Math.max(1, patchCount - 1);
      const z = lerp(config.transitionStartZ, shoreZ, t) + (random() - 0.5) * 1.8;
      const x = (random() - 0.5) * lerp(1.2, 4.8, t);
      const patch = MeshBuilder.CreateDisc(
        `terminalTrailPatch_${index}`,
        { radius: 1, tessellation: 18, sideOrientation: Mesh.DOUBLESIDE },
        this.scene
      );
      const width = lerp(3.1, 0.7, t) * (0.82 + random() * 0.35);
      const depth = lerp(2.8, 1.15, t) * (0.8 + random() * 0.4);
      patch.scaling.set(width, depth, 1);
      patch.rotation.x = Math.PI * 0.5;
      patch.rotation.z = (random() - 0.5) * 0.35;
      patch.position.set(x, this.terrain.getHeightAt(x, z) + 0.045, z);
      patch.isPickable = false;
      patch.receiveShadows = true;
      patch.setParent(root);
      setGameMaterial(patch, "soil", this.scene);
    }
  }

  private createLagoon(root: TransformNode, config: TerminalLandmarkConfig) {
    const lagoon = new Mesh("terminalLagoon", this.scene);
    // Enough static vertices for the impact ripple to bend the silhouette while
    // remaining tiny compared with the surrounding terrain and vegetation.
    const radialRings = 16;
    const radialSegments = 96;
    const positions: number[] = [0, 0, 0];
    const normals: number[] = [];
    const uvs: number[] = [0.5, 0.5];
    const indices: number[] = [];
    const phase = (config.seed % 997) * 0.017;

    for (let ring = 1; ring <= radialRings; ring++) {
      const radius = ring / radialRings;
      for (let segment = 0; segment < radialSegments; segment++) {
        const angle = (segment / radialSegments) * Math.PI * 2;
        const irregularX = 1 + Math.sin(angle * 3 + phase) * 0.075 + Math.sin(angle * 7 - phase) * 0.035;
        const irregularZ = 1 + Math.cos(angle * 4 - phase) * 0.055;
        const x = Math.cos(angle) * config.lagoonRadiusX * irregularX * radius;
        const z = Math.sin(angle) * config.lagoonRadiusZ * irregularZ * radius;
        positions.push(x, 0, z);
        uvs.push(x / (config.lagoonRadiusX * 2) + 0.5, z / (config.lagoonRadiusZ * 2) + 0.5);
      }
    }

    for (let segment = 0; segment < radialSegments; segment++) {
      indices.push(0, 1 + segment, 1 + ((segment + 1) % radialSegments));
    }

    for (let ring = 1; ring < radialRings; ring++) {
      const innerStart = 1 + (ring - 1) * radialSegments;
      const outerStart = 1 + ring * radialSegments;
      for (let segment = 0; segment < radialSegments; segment++) {
        const next = (segment + 1) % radialSegments;
        indices.push(
          innerStart + segment,
          outerStart + segment,
          innerStart + next,
          innerStart + next,
          outerStart + segment,
          outerStart + next
        );
      }
    }

    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.uvs = uvs;
    data.applyToMesh(lagoon);

    lagoon.position.set(config.lagoonCenterX, config.waterLevel, config.lagoonCenterZ);
    lagoon.isPickable = false;
    lagoon.alwaysSelectAsActiveMesh = true;
    lagoon.setParent(root);
    setGameMaterial(lagoon, "water", this.scene, { applyVisual: false });
    return lagoon;
  }

  private createLagoonWaterMaterial(
    config: TerminalLandmarkConfig,
    impactPoint: Vector3
  ) {
    const tuning = this.visualConfig.lagoon;
    const requestedSize = this.renderOptions.waterRenderTargetSize ?? 256;
    const renderTargetSize = Math.max(64, Math.min(512, Math.round(requestedSize)));
    const material = new WaterMaterial(
      "terminalLagoonWaterMaterial",
      this.scene,
      new Vector2(renderTargetSize, renderTargetSize)
    );

    material.bumpTexture = this.createLagoonNormalTexture();
    material.windForce = 0.55;
    material.windDirection = new Vector2(0.28, 0.14);
    material.waveHeight = tuning.baseWaveAmplitude;
    material.waveLength = 2.8;
    material.waveSpeed = tuning.baseWaveSpeed;
    material.waveCount = Math.max(
      0.06,
      Math.min(0.12, 6.5 / (config.lagoonRadiusX + config.lagoonRadiusZ))
    );
    material.bumpHeight = 0.075;
    material.bumpSuperimpose = true;
    material.bumpAffectsReflection = true;
    material.fresnelSeparate = true;

    // Near/refraction color remains deep; the greener far color only tints
    // reflections and never acts as an emissive source.
    material.waterColor = new Color3(0.022, 0.13, 0.15);
    material.colorBlendFactor = 0.68;
    material.waterColor2 = new Color3(0.04, 0.23, 0.22);
    material.colorBlendFactor2 = 0.48;
    material.diffuseColor = new Color3(0.035, 0.12, 0.13);
    material.specularColor = new Color3(0.24, 0.46, 0.47);
    material.specularPower = 96;
    material.maxSimultaneousLights = 8;
    material.disableLighting = false;
    material.alpha = 0.94;
    material.backFaceCulling = true;
    material.useWorldCoordinatesForWaveDeformation = false;

    // The plugin reuses WaterMaterial's existing time uniform and adds no
    // textures, render targets or per-frame CPU updates.
    new LagoonRippleMaterialPlugin(
      material,
      new Vector2(
        impactPoint.x - config.lagoonCenterX,
        impactPoint.z - config.lagoonCenterZ
      ),
      tuning
    );

    return material;
  }

  private createLagoonNormalTexture() {
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    const tau = Math.PI * 2;
    const heightAt = (x: number, y: number) => {
      const u = (x / size) * tau;
      const v = (y / size) * tau;
      return (
        Math.sin(u * 3 + v * 0.7) * 0.52 +
        Math.sin(u * 1.3 - v * 4) * 0.3 +
        Math.cos(u * 5.1 + v * 2.2) * 0.18
      );
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const slopeX = (heightAt(x - 1, y) - heightAt(x + 1, y)) * 1.8;
        const slopeY = (heightAt(x, y - 1) - heightAt(x, y + 1)) * 1.8;
        const inverseLength = 1 / Math.hypot(slopeX, slopeY, 1);
        const index = (y * size + x) * 4;
        data[index] = Math.round((slopeX * inverseLength * 0.5 + 0.5) * 255);
        data[index + 1] = Math.round((slopeY * inverseLength * 0.5 + 0.5) * 255);
        data[index + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
        data[index + 3] = 255;
      }
    }

    const texture = RawTexture.CreateRGBATexture(
      data,
      size,
      size,
      this.scene,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE
    );
    texture.name = "terminalLagoonNormalTexture";
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 2;
    texture.level = 0.45;
    return texture;
  }

  private configureLagoonRenderLists(
    material: WaterMaterial,
    lagoon: Mesh,
    nearbyMeshes: readonly AbstractMesh[]
  ) {
    const commonMeshes = [...new Set(nearbyMeshes)].filter(
      (mesh) => mesh !== lagoon && !mesh.isDisposed()
    );
    for (const mesh of commonMeshes) material.addToRenderList(mesh);

    // The large terrain is useful below the water but not as a reflected object.
    // Keeping it refraction-only reveals the basin without doubling that draw.
    const terrainMesh = this.terrain.mesh as AbstractMesh;
    pushUniqueRenderMesh(material.refractionTexture, terrainMesh);

    // The dark sky is reflection-only. Distant forest, grass and the player are
    // deliberately excluded from both RTTs.
    for (const mesh of this.renderOptions.environmentReflectionMeshes ?? []) {
      if (mesh !== lagoon && !mesh.isDisposed()) {
        pushUniqueRenderMesh(material.reflectionTexture, mesh);
      }
    }

    const refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES;
    if (material.refractionTexture) material.refractionTexture.refreshRate = refreshRate;
    if (material.reflectionTexture) material.reflectionTexture.refreshRate = refreshRate;
  }

  private createUnderwaterLight(root: TransformNode, config: TerminalLandmarkConfig) {
    const light = new PointLight(
      "lagoonUnderwaterLight",
      new Vector3(
        config.lagoonCenterX,
        config.waterLevel - 1.4,
        config.lagoonCenterZ + config.lagoonRadiusZ * 0.18
      ),
      this.scene
    );
    light.diffuse = new Color3(0.08, 0.29, 0.31);
    light.specular = new Color3(0.05, 0.18, 0.2);
    light.intensity = 0.82;
    light.range = 50;
    light.falloffType = Light.FALLOFF_STANDARD;
    light.renderPriority = 4;
    light.parent = root;
    return light;
  }

  private createWaterfallImpactLight(root: TransformNode, impactPoint: Vector3) {
    const light = new PointLight(
      "lagoonWaterfallImpactLight",
      impactPoint.add(new Vector3(0, 0.57, 0)),
      this.scene
    );
    light.diffuse = new Color3(0.13, 0.34, 0.35);
    light.specular = new Color3(0.18, 0.4, 0.41);
    light.intensity = 0.74;
    light.range = 22;
    light.falloffType = Light.FALLOFF_STANDARD;
    light.renderPriority = 3;
    light.parent = root;
    return light;
  }

  private limitLagoonLights(
    underwaterLight: PointLight,
    impactLight: PointLight,
    lagoon: Mesh,
    nearbyMeshes: readonly AbstractMesh[]
  ) {
    const terrainMesh = this.terrain.mesh as AbstractMesh;
    const litMeshes = [...new Set([lagoon, terrainMesh, ...nearbyMeshes])].filter(
      (mesh) => !mesh.isDisposed()
    );
    underwaterLight.includedOnlyMeshes.push(...litMeshes);
    impactLight.includedOnlyMeshes.push(...litMeshes);
  }

  private limitCaveCandleLights(
    lights: readonly PointLight[],
    meshes: readonly AbstractMesh[]
  ) {
    const litMeshes = [...new Set(meshes)].filter((mesh) => !mesh.isDisposed());
    for (const light of lights) light.includedOnlyMeshes.push(...litMeshes);
  }

  private getWaterfallMetrics(config: TerminalLandmarkConfig): WaterfallMetrics {
    const cliffTop = Math.max(
      config.waterLevel + 8,
      this.terrain.getHeightAt(config.lagoonCenterX, config.backCliffZ + 8) - 1.2
    );
    const bottom = config.waterLevel + 0.25;
    const height = cliffTop - bottom;
    // The lagoon outline and terrain basin share this exact procedural edge.
    // Keep the whole waterfall footprint safely inside it, including the wide
    // outer columns, instead of assuming waterfallZ is still over water.
    const phase = (config.seed % 997) * 0.017;
    const rearIrregularity = 1 + Math.cos(Math.PI * 2 - phase) * 0.055;
    const rearWaterEdgeZ =
      config.lagoonCenterZ + config.lagoonRadiusZ * rearIrregularity;
    const impactInset = Math.max(6, config.waterfallWidth * 0.4);
    const impactZ = Math.min(
      config.waterfallZ - 1.25,
      rearWaterEdgeZ - impactInset
    );
    return {
      cliffTop,
      bottom,
      height,
      impactPoint: new Vector3(
        config.lagoonCenterX,
        config.waterLevel + 0.08,
        impactZ
      ),
    };
  }

  private createPassageAnchor(config: TerminalLandmarkConfig): TerminalPassageAnchor {
    const passageZ = config.waterfallZ + 2.4;
    return {
      position: new Vector3(
        config.lagoonCenterX,
        this.terrain.getHeightAt(config.lagoonCenterX, passageZ) + 1,
        passageZ
      ),
      direction: new Vector3(0, 0, 1),
    };
  }

  private createWaterfall(
    root: TransformNode,
    config: TerminalLandmarkConfig,
    metrics: WaterfallMetrics
  ) {
    const layers = [
      {
        name: "terminalWaterfallMain",
        widthScale: 1,
        xOffset: -config.waterfallWidth * 0.025,
        zOffset: 0,
        opacityScale: 1,
        phase: 0.35,
      },
      {
        name: "terminalWaterfallVeil",
        widthScale: 0.78,
        xOffset: config.waterfallWidth * 0.1,
        zOffset: -0.2,
        opacityScale: this.visualConfig.waterfall.secondaryLayerAlpha,
        phase: 2.1,
      },
    ];

    return layers.map((layer) => {
      const waterfall = this.createWaterfallRibbon(
        layer.name,
        config,
        metrics,
        layer.widthScale,
        layer.xOffset,
        layer.zOffset,
        layer.phase
      );
      waterfall.material = this.createWaterfallMaterial(
        `${layer.name}Material`,
        layer.opacityScale,
        layer.phase
      );
      // Keep the translucent ribbons in the main rendering group. Later groups
      // clear their depth buffer by default, which made the waterfall draw over
      // opaque foreground meshes (including the player).
      waterfall.renderingGroupId = 0;
      waterfall.isPickable = false;
      waterfall.alwaysSelectAsActiveMesh = true;
      waterfall.setParent(root);
      setGameMaterial(waterfall, "water", this.scene, { applyVisual: false });
      return waterfall;
    });
  }

  private createWaterfallRibbon(
    name: string,
    config: TerminalLandmarkConfig,
    metrics: WaterfallMetrics,
    widthScale: number,
    xOffset: number,
    zOffset: number,
    phase: number
  ) {
    const paths: Vector3[][] = [];
    const columnCount = 7;
    const rowCount = 15;
    const widthVariation = this.visualConfig.waterfall.widthVariation;

    for (let column = 0; column < columnCount; column++) {
      const horizontal = (column / (columnCount - 1)) * 2 - 1;
      const path: Vector3[] = [];
      for (let row = 0; row < rowCount; row++) {
        const vertical = row / (rowCount - 1);
        const broadVariation = Math.sin(vertical * Math.PI * 2.3 + phase) * widthVariation * 0.62;
        const detailVariation = Math.sin(vertical * Math.PI * 5.1 - phase * 0.7) * widthVariation * 0.24;
        const endTaper = 0.9 + Math.sin(vertical * Math.PI) * 0.1;
        const halfWidth = config.waterfallWidth * widthScale * 0.5;
        const lateralDrift = Math.sin(vertical * Math.PI * 2 + phase) * config.waterfallWidth * 0.025;
        const x =
          config.lagoonCenterX +
          xOffset +
          lateralDrift +
          horizontal * halfWidth * (1 + broadVariation + detailVariation) * endTaper;
        const y = metrics.bottom + vertical * metrics.height;
        // A falling sheet accelerates away from the cliff. Its lower edge must
        // converge on the authored impact point, which is guaranteed to be in
        // the lagoon, while the upper lip remains attached to the rock wall.
        const fallingProgress = 1 - vertical;
        const trajectory = fallingProgress * fallingProgress;
        const baseZ = lerp(config.waterfallZ, metrics.impactPoint.z, trajectory);
        const z =
          baseZ +
          zOffset * vertical -
          Math.sin(vertical * Math.PI) * (0.55 + widthScale * 0.18) +
          Math.sin(vertical * Math.PI * 3.4 + phase) *
            Math.sin(vertical * Math.PI) *
            0.07;
        path.push(new Vector3(x, y, z));
      }
      paths.push(path);
    }

    return MeshBuilder.CreateRibbon(
      name,
      {
        pathArray: paths,
        closeArray: false,
        closePath: false,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      this.scene
    );
  }

  private createWaterfallMaterial(name: string, layerOpacity: number, phase: number) {
    const tuning = this.visualConfig.waterfall;
    const material = new ShaderMaterial(
      name,
      this.scene,
      {
        vertexSource: `
          precision highp float;
          attribute vec3 position;
          attribute vec2 uv;
          uniform mat4 worldViewProjection;
          uniform float time;
          uniform float noiseStrength;
          uniform float layerPhase;
          varying vec2 vUV;
          void main(void) {
            vec3 p = position;
            vec2 waterfallUV = vec2(uv.y, uv.x);
            p.x += sin(waterfallUV.y * 18.0 - time * 1.15 + layerPhase) * noiseStrength * 0.045;
            p.z += sin(waterfallUV.y * 11.0 + waterfallUV.x * 5.0 + time * 0.72) * noiseStrength * 0.035;
            vUV = uv;
            gl_Position = worldViewProjection * vec4(p, 1.0);
          }
        `,
        fragmentSource: `
          precision highp float;
          varying vec2 vUV;
          uniform float time;
          uniform float baseAlpha;
          uniform float emissiveStrength;
          uniform float noiseStrength;
          uniform float scrollSpeed;
          uniform float layerOpacity;
          uniform float layerPhase;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }

          float noise(vec2 p) {
            vec2 cell = floor(p);
            vec2 local = fract(p);
            local = local * local * (3.0 - 2.0 * local);
            return mix(
              mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
              mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), local.x),
              local.y
            );
          }

          void main(void) {
            vec2 waterfallUV = vec2(vUV.y, vUV.x);
            float verticalFlow = waterfallUV.y + time * scrollSpeed;
            float slowWarp = noise(vec2(verticalFlow * 1.15, layerPhase)) - 0.5;
            float broad = noise(vec2(waterfallUV.x * 7.5 + slowWarp * 1.2, verticalFlow * 0.72));
            float detail = noise(vec2(waterfallUV.x * 19.0 - slowWarp * 2.1, verticalFlow * 1.55 + layerPhase));
            float edgeWarp = (slowWarp + (detail - 0.5) * 0.3) * noiseStrength * 0.13;
            float edgeFade = smoothstep(0.015 + edgeWarp, 0.15 + edgeWarp, waterfallUV.x);
            edgeFade *= smoothstep(0.015 - edgeWarp, 0.15 - edgeWarp, 1.0 - waterfallUV.x);

            float fineFlow = noise(vec2(waterfallUV.x * 13.0 + slowWarp * 1.7, verticalFlow * 1.12 - layerPhase));
            float softStreaks = smoothstep(0.32, 0.88, broad * 0.52 + fineFlow * 0.48);
            float brokenFlow = smoothstep(0.2, 0.84, broad * 0.56 + detail * 0.29 + fineFlow * 0.15);
            float transparency = 0.18 + softStreaks * 0.28 + brokenFlow * 0.3;
            float verticalBlend = smoothstep(0.0, 0.055, waterfallUV.y) * smoothstep(0.0, 0.075, 1.0 - waterfallUV.y);

            vec3 blueGray = vec3(0.24, 0.38, 0.42);
            vec3 aeratedWater = vec3(0.72, 0.82, 0.84);
            vec3 water = mix(blueGray, aeratedWater, softStreaks * 0.28 + detail * 0.12);
            water *= 0.9 + emissiveStrength;
            float alpha = baseAlpha * layerOpacity * transparency * edgeFade * verticalBlend;
            gl_FragColor = vec4(water, alpha);
          }
        `,
      },
      {
        attributes: ["position", "uv"],
        uniforms: [
          "worldViewProjection",
          "time",
          "baseAlpha",
          "emissiveStrength",
          "noiseStrength",
          "scrollSpeed",
          "layerOpacity",
          "layerPhase",
        ],
        needAlphaBlending: true,
      }
    );

    material.setFloat("time", 0);
    material.setFloat("baseAlpha", tuning.alpha);
    material.setFloat("emissiveStrength", tuning.emissive);
    material.setFloat("noiseStrength", tuning.noiseStrength);
    material.setFloat("scrollSpeed", tuning.scrollSpeed);
    material.setFloat("layerOpacity", layerOpacity);
    material.setFloat("layerPhase", phase);
    material.alphaMode = Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    this.animatedMaterials.add(material);
    return material;
  }

  private createWaterfallFoam(
    root: TransformNode,
    config: TerminalLandmarkConfig,
    impactPoint: Vector3
  ) {
    const foam = MeshBuilder.CreateDisc(
      "terminalWaterfallFoam",
      { radius: 1, tessellation: 48, sideOrientation: Mesh.DOUBLESIDE },
      this.scene
    );
    foam.scaling.set(config.waterfallWidth * 0.7, 3.5, 1);
    foam.rotation.x = Math.PI * 0.5;
    foam.position.copyFrom(impactPoint);
    foam.isPickable = false;
    foam.setParent(root);

    const material = new ShaderMaterial(
      "terminalWaterfallFoamMaterial",
      this.scene,
      {
        vertexSource: `
          precision highp float;
          attribute vec3 position;
          attribute vec2 uv;
          uniform mat4 worldViewProjection;
          varying vec2 vUV;
          void main(void) {
            vUV = uv;
            gl_Position = worldViewProjection * vec4(position, 1.0);
          }
        `,
        fragmentSource: `
          precision highp float;
          varying vec2 vUV;
          uniform float time;
          uniform float foamAlpha;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }

          void main(void) {
            vec2 p = (vUV - 0.5) * 2.0;
            float distanceFromImpact = length(p);
            float angle = atan(p.y, p.x);
            float edgeNoise = sin(angle * 9.0 + time * 0.75) * 0.035;
            edgeNoise += (hash(floor(vUV * 18.0 + time * 0.35)) - 0.5) * 0.045;
            float softPatch = 1.0 - smoothstep(0.48 + edgeNoise, 1.0 + edgeNoise, distanceFromImpact);
            float rings = sin(distanceFromImpact * 26.0 - time * 2.25 + sin(angle * 5.0) * 0.7) * 0.5 + 0.5;
            float brokenFoam = smoothstep(0.38, 0.9, rings) * softPatch;
            float centerChurn = 1.0 - smoothstep(0.04, 0.56, distanceFromImpact);
            float opacity = foamAlpha * softPatch * (0.2 + brokenFoam * 0.52 + centerChurn * 0.28);
            vec3 foamColor = mix(vec3(0.18, 0.30, 0.31), vec3(0.52, 0.62, 0.62), brokenFoam * 0.55 + centerChurn * 0.24);
            gl_FragColor = vec4(foamColor * 0.78, opacity);
          }
        `,
      },
      {
        attributes: ["position", "uv"],
        uniforms: ["worldViewProjection", "time", "foamAlpha"],
        needAlphaBlending: true,
      }
    );
    material.setFloat("time", 0);
    material.setFloat("foamAlpha", this.visualConfig.impact.foamAlpha);
    material.alphaMode = Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    this.animatedMaterials.add(material);
    foam.material = material;
    setGameMaterial(foam, "water", this.scene, { applyVisual: false });
    return foam;
  }

  private createWaterfallSplash(config: TerminalLandmarkConfig, impactPoint: Vector3) {
    const texture = new DynamicTexture(
      "terminalWaterfallSplashTexture",
      { width: 32, height: 32 },
      this.scene,
      false
    );
    const context = texture.getContext();
    const gradient = context.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, "rgba(220, 238, 238, 0.82)");
    gradient.addColorStop(0.35, "rgba(150, 196, 198, 0.54)");
    gradient.addColorStop(1, "rgba(80, 120, 124, 0)");
    context.clearRect(0, 0, 32, 32);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
    texture.hasAlpha = true;
    texture.update();

    const splash = new ParticleSystem(
      "terminalWaterfallSplash",
      this.visualConfig.impact.splashCapacity,
      this.scene
    );
    splash.particleTexture = texture;
    splash.emitter = impactPoint.add(new Vector3(0, 0.12, 0));
    splash.minEmitBox = new Vector3(-config.waterfallWidth * 0.34, 0, -0.45);
    splash.maxEmitBox = new Vector3(config.waterfallWidth * 0.34, 0.15, 0.45);
    splash.direction1 = new Vector3(-0.9, 1.8, -0.65);
    splash.direction2 = new Vector3(0.9, 3.1, 0.35);
    splash.color1 = new Color4(0.55, 0.7, 0.71, 0.5);
    splash.color2 = new Color4(0.3, 0.5, 0.52, 0.3);
    splash.colorDead = new Color4(0.12, 0.2, 0.21, 0);
    splash.minSize = 0.06;
    splash.maxSize = 0.18;
    splash.minLifeTime = 0.35;
    splash.maxLifeTime = 0.78;
    splash.emitRate = 17;
    splash.minEmitPower = 0.55;
    splash.maxEmitPower = 1.2;
    splash.updateSpeed = 0.012;
    splash.gravity = new Vector3(0, -5.5, 0);
    splash.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    splash.start();
  }

  private createWaterfallMist(config: TerminalLandmarkConfig, impactPoint: Vector3) {
    const texture = new DynamicTexture(
      "terminalWaterfallMistTexture",
      { width: 64, height: 64 },
      this.scene,
      false
    );
    const context = texture.getContext();
    const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
    gradient.addColorStop(0, "rgba(220, 245, 245, 0.85)");
    gradient.addColorStop(0.45, "rgba(155, 215, 220, 0.4)");
    gradient.addColorStop(1, "rgba(70, 120, 130, 0)");
    context.clearRect(0, 0, 64, 64);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    texture.hasAlpha = true;
    texture.update();

    const mist = new ParticleSystem(
      "terminalWaterfallMist",
      this.visualConfig.impact.mistCapacity,
      this.scene
    );
    mist.particleTexture = texture;
    mist.emitter = impactPoint.add(new Vector3(0, 0.32, -0.1));
    mist.minEmitBox = new Vector3(-config.waterfallWidth * 0.42, 0, -0.8);
    mist.maxEmitBox = new Vector3(config.waterfallWidth * 0.42, 0.35, 0.8);
    mist.direction1 = new Vector3(-0.35, 0.5, -0.4);
    mist.direction2 = new Vector3(0.35, 1.25, 0.25);
    mist.color1 = new Color4(0.5, 0.66, 0.67, 0.22);
    mist.color2 = new Color4(0.3, 0.5, 0.52, 0.12);
    mist.colorDead = new Color4(0.12, 0.2, 0.22, 0);
    mist.minSize = 0.5;
    mist.maxSize = 1.65;
    mist.minLifeTime = 0.75;
    mist.maxLifeTime = 1.65;
    mist.emitRate = 22;
    mist.minEmitPower = 0.25;
    mist.maxEmitPower = 0.85;
    mist.updateSpeed = 0.012;
    mist.gravity = new Vector3(0, -0.18, 0);
    mist.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    mist.start();
  }

  private populateWaterfallCaveRocks(
    root: TransformNode,
    config: TerminalLandmarkConfig,
    metrics: WaterfallMetrics,
    random: () => number
  ) {
    const reflectionMeshes: AbstractMesh[] = [];
    // Frame the fall like a cave mouth while keeping its full body visible.
    // These rocks sit behind the water ribbon; none is allowed to cross the
    // deliberately wide central opening.
    const placements = [
      { x: -0.93, height: 0.12, z: 6.8, scale: 1.7, stretchY: 1.65, tilt: -0.08 },
      { x: 0.93, height: 0.12, z: 6.8, scale: 1.7, stretchY: 1.65, tilt: 0.08 },
      { x: -0.9, height: 0.47, z: 7.0, scale: 1.6, stretchY: 1.5, tilt: -0.14 },
      { x: 0.9, height: 0.47, z: 7.0, scale: 1.6, stretchY: 1.5, tilt: 0.14 },
      { x: -0.84, height: 0.78, z: 7.2, scale: 1.45, stretchY: 1.18, tilt: -0.24 },
      { x: 0.84, height: 0.78, z: 7.2, scale: 1.45, stretchY: 1.18, tilt: 0.24 },
      { x: -0.58, height: 1.08, z: 7.4, scale: 1.25, stretchY: 0.82, tilt: -0.34 },
      { x: 0.58, height: 1.08, z: 7.4, scale: 1.25, stretchY: 0.82, tilt: 0.34 },
    ];

    placements.forEach((placement, index) => {
      const rock = this.rockLibrary.instantiateByIndex(
        `terminalWaterfallLipRock_${index}`,
        this.scene,
        Math.floor(random() * 1_000_000)
      );
      const scale = placement.scale * (0.88 + random() * 0.24);
      rock.position.set(
        config.lagoonCenterX + placement.x * config.waterfallWidth,
        metrics.bottom + metrics.height * placement.height,
        config.waterfallZ + placement.z
      );
      rock.scaling.set(
        scale * (0.9 + random() * 0.16),
        scale * placement.stretchY,
        scale * (0.86 + random() * 0.18)
      );
      rock.rotation.set(
        (random() - 0.5) * 0.18,
        random() * Math.PI * 2,
        placement.tilt + (random() - 0.5) * 0.08
      );
      rock.setParent(root);
      this.collectChildMeshes(rock, reflectionMeshes, 20);
    });

    return reflectionMeshes;
  }

  private createCaveEntranceCandles(
    root: TransformNode,
    config: TerminalLandmarkConfig,
    metrics: WaterfallMetrics,
    random: () => number
  ): CaveCandleDecoration {
    const meshes: AbstractMesh[] = [];
    const lights: PointLight[] = [];
    const instantiateCandleAsset = this.renderOptions.instantiateCandleAsset;
    if (!instantiateCandleAsset) {
      console.warn(
        "[TerminalLandmark] No candle asset factory was provided; cave candles were omitted."
      );
      return { meshes, lights };
    }

    const flameMaterial = createCandleFireMaterial(this.scene);
    flameMaterial.name = "terminalCaveCandleFlameMaterial";
    flameMaterial.fogEnabled = false;
    const glowMaterial = createGlowMaterial(this.scene);
    glowMaterial.name = "terminalCaveCandleGlowMaterial";
    glowMaterial.fogEnabled = false;
    const z = config.waterfallZ - 3.6;
    const candleScale = new Vector3(0.18, 0.085, 0.18);
    const flameWidth = 0.48;
    const flameHeight = 0.56;

    [-1, 1].forEach((side, index) => {
      const x = config.lagoonCenterX + side * config.waterfallWidth * 0.52;
      // The candles rest on protruding wall ledges. Keeping them above the far
      // shore silhouette makes both flames readable from the trail entrance.
      const ledgeY = metrics.bottom + metrics.height * 0.23;
      const support = this.rockLibrary.instantiateByIndex(
        `terminalCaveCandleSupport_${index}`,
        this.scene,
        Math.floor(random() * 1_000_000)
      );
      support.position.set(x, ledgeY - 0.48, z + 0.22);
      support.scaling.set(1.45, 0.52, 1.2);
      support.rotation.y = random() * Math.PI * 2;
      support.setParent(root);
      this.collectChildMeshes(support, meshes, 48);

      const candle = instantiateCandleAsset(
        `terminalCaveCandleAsset_${index}`,
        candleScale
      );
      if (!candle) return;
      candle.root.position.set(x, ledgeY - candle.baseOffsetY - 0.015, z);
      candle.root.rotation.y = side * 0.22 + (random() - 0.5) * 0.18;
      candle.root.setParent(root);
      this.collectChildMeshes(candle.root, meshes, 48);

      const flameY = candle.root.position.y + candle.topOffsetY - 0.115;

      const flame = MeshBuilder.CreatePlane(
        `terminalCaveCandleFlame_${index}`,
        { width: flameWidth, height: flameHeight },
        this.scene
      );
      flame.position.set(x, flameY + flameHeight * 0.42, z - 0.03);
      flame.material = flameMaterial;
      flame.billboardMode = Mesh.BILLBOARDMODE_ALL;
      flame.isPickable = false;
      flame.alwaysSelectAsActiveMesh = true;
      flame.setParent(root);

      const glow = MeshBuilder.CreatePlane(
        `terminalCaveCandleGlow_${index}`,
        { width: 2.3, height: 2.6 },
        this.scene
      );
      glow.position.set(x, flameY + flameHeight * 0.4, z + 0.02);
      glow.material = glowMaterial;
      glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
      glow.isPickable = false;
      glow.alwaysSelectAsActiveMesh = true;
      glow.setParent(root);

      const light = new PointLight(
        `terminalCaveCandleLight_${index}`,
        new Vector3(x, flameY + flameHeight * 0.36, z - 0.18),
        this.scene
      );
      light.diffuse = new Color3(1, 0.48, 0.16);
      light.specular = new Color3(0.62, 0.23, 0.06);
      light.intensity = 4.4;
      light.range = 24;
      light.falloffType = Light.FALLOFF_STANDARD;
      light.renderPriority = 9;
      light.parent = root;
      light.setEnabled(false);
      lights.push(light);
      this.flickeringLights.push({
        light,
        baseIntensity: light.intensity,
        phase: index * 2.37 + 0.4,
      });
      meshes.push(flame, glow);
    });

    return { meshes, lights };
  }

  private populateRockClosure(
    root: TransformNode,
    config: TerminalLandmarkConfig,
    random: () => number
  ) {
    const reflectionMeshes: AbstractMesh[] = [];
    const backRockCount = 34;
    for (let index = 0; index < backRockCount; index++) {
      const row = index % 2;
      const column = Math.floor(index / 2);
      const t = (column / Math.max(1, backRockCount / 2 - 1)) * 2 - 1;
      const x = config.lagoonCenterX + t * (config.lagoonRadiusX + 26) + (random() - 0.5) * 4;
      // Large imported rocks extend well beyond their origin. A generous
      // reserved corridor prevents random cliff pieces from covering the fall.
      if (Math.abs(x - config.lagoonCenterX) < config.waterfallWidth * 1.5) continue;

      const z = config.backCliffZ - Math.abs(t) * 18 + row * 5 + (random() - 0.5) * 3;
      const rock = this.rockLibrary.instantiateByIndex(
        `terminalCliffRock_${index}`,
        this.scene,
        Math.floor(random() * 1_000_000)
      );
      const scale = 3.7 + random() * 3.4;
      rock.position.set(x, this.terrain.getHeightAt(x, z) - scale * 0.55, z);
      rock.scaling.set(scale * (0.8 + random() * 0.45), scale * (1.15 + random() * 0.75), scale);
      rock.rotation.set((random() - 0.5) * 0.16, random() * Math.PI * 2, (random() - 0.5) * 0.16);
      rock.setParent(root);
      if (index % 4 === 0) this.collectChildMeshes(rock, reflectionMeshes, 18);
    }

    const shoreRockCount = 18;
    for (let index = 0; index < shoreRockCount; index++) {
      const angle = random() * Math.PI * 2;
      const ring = 0.91 + random() * 0.2;
      const x = config.lagoonCenterX + Math.cos(angle) * config.lagoonRadiusX * ring;
      const z = config.lagoonCenterZ + Math.sin(angle) * config.lagoonRadiusZ * ring;
      if (z < config.lagoonCenterZ - config.lagoonRadiusZ * 0.55 && Math.abs(x) < 10) continue;
      const blocksWaterfallView =
        z > config.lagoonCenterZ + config.lagoonRadiusZ * 0.34 &&
        Math.abs(x - config.lagoonCenterX) < config.waterfallWidth * 0.92;
      if (blocksWaterfallView) continue;

      const rock = this.rockLibrary.instantiateByIndex(
        `terminalShoreRock_${index}`,
        this.scene,
        Math.floor(random() * 1_000_000)
      );
      const scale = 0.65 + random() * 1.15;
      rock.position.set(x, this.terrain.getHeightAt(x, z) - scale * 0.12, z);
      rock.scaling.set(scale * (0.8 + random() * 0.5), scale * (0.7 + random() * 0.6), scale);
      rock.rotation.y = random() * Math.PI * 2;
      rock.setParent(root);
      if (index % 3 === 0) this.collectChildMeshes(rock, reflectionMeshes, 24);
    }

    return reflectionMeshes;
  }

  private populateWetVegetation(
    root: TransformNode,
    config: TerminalLandmarkConfig,
    random: () => number
  ) {
    const reflectionMeshes: AbstractMesh[] = [];
    const treesPerSide = 6;
    for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
      const side = sideIndex === 0 ? -1 : 1;
      for (let index = 0; index < treesPerSide; index++) {
        const x =
          config.lagoonCenterX +
          side * (config.lagoonRadiusX + 7 + random() * 13);
        const z = lerp(
          config.lagoonCenterZ - config.lagoonRadiusZ * 0.55,
          config.backCliffZ - 8,
          (index + random() * 0.7) / treesPerSide
        );
        const tree = this.treeLibrary.instantiateByIndex(
          `terminalWetTree_${sideIndex}_${index}`,
          this.scene,
          Math.floor(random() * 1_000_000),
          1
        );
        tree.position.set(x, this.terrain.getHeightAt(x, z), z);
        tree.scaling.setAll(1.05 + random() * 0.7);
        tree.rotation.y = random() * Math.PI * 2;
        tree.setParent(root);
        if (index === 2 || index === 4) {
          this.collectChildMeshes(tree, reflectionMeshes, 8);
        }
      }
    }

    const prototypes = this.plantLibrary.getAll();
    if (!prototypes.length) return reflectionMeshes;

    const plantCount = 30;
    for (let index = 0; index < plantCount; index++) {
      const angle = random() * Math.PI * 2;
      const ring = 0.93 + random() * 0.28;
      const x = config.lagoonCenterX + Math.cos(angle) * config.lagoonRadiusX * ring;
      const z = config.lagoonCenterZ + Math.sin(angle) * config.lagoonRadiusZ * ring;
      if (z < config.lagoonCenterZ - config.lagoonRadiusZ * 0.62 && Math.abs(x) < 8) continue;
      const blocksWaterfallView =
        z > config.lagoonCenterZ + config.lagoonRadiusZ * 0.32 &&
        Math.abs(x - config.lagoonCenterX) < config.waterfallWidth;
      if (blocksWaterfallView) continue;

      const prototypeIndex = Math.floor(random() * prototypes.length);
      const plant = prototypes[prototypeIndex].createInstance(`terminalWetPlant_${index}`);
      const scale = 0.7 + random() * 0.85;
      plant.position.set(
        x,
        this.terrain.getHeightAt(x, z) + this.plantLibrary.getGroundOffset(prototypeIndex) * scale + 0.03,
        z
      );
      plant.scaling.setAll(scale);
      plant.rotation.y = random() * Math.PI * 2;
      plant.isPickable = false;
      plant.receiveShadows = true;
      plant.setEnabled(true);
      plant.setParent(root);
    }

    return reflectionMeshes;
  }

  private collectChildMeshes(
    root: TransformNode,
    target: AbstractMesh[],
    maximumCount: number
  ) {
    if (target.length >= maximumCount) return;
    for (const mesh of root.getChildMeshes(false)) {
      if (target.length >= maximumCount) break;
      if (!mesh.isDisposed()) target.push(mesh);
    }
  }

  private updateAnimation(deltaTime: number, playerPosition?: Vector3) {
    this.animationTime += Math.max(0, Math.min(deltaTime, 0.1));
    for (const material of this.animatedMaterials) {
      material.setFloat("time", this.animationTime);
    }
    for (const { light, baseIntensity, phase } of this.flickeringLights) {
      const shouldEnable =
        !playerPosition ||
        Vector3.DistanceSquared(playerPosition, light.getAbsolutePosition()) <=
          CAVE_LIGHT_ACTIVATION_RADIUS * CAVE_LIGHT_ACTIVATION_RADIUS;
      light.setEnabled(shouldEnable);
      if (!shouldEnable) continue;
      const flicker =
        Math.sin(this.animationTime * 11.5 + phase) * 0.09 +
        Math.sin(this.animationTime * 23.0 + phase * 0.7) * 0.045;
      light.intensity = baseIntensity + flicker;
    }
  }
}

export function createTerminalBlockers(
  config: TerminalLandmarkConfig
): readonly TerminalCollisionBlocker[] {
  return [
    // The lagoon basin and waterfall curtain intentionally remain collision-free
    // so the player can wade across and stand behind the falling water.
    {
      x: config.lagoonCenterX,
      z: config.backCliffZ + 7,
      width: 142,
      depth: 12,
    },
    {
      x: config.lagoonCenterX - config.lagoonRadiusX - 14,
      z: config.lagoonCenterZ + 9,
      width: 8,
      depth: 108,
      rotation: -0.08,
    },
    {
      x: config.lagoonCenterX + config.lagoonRadiusX + 14,
      z: config.lagoonCenterZ + 9,
      width: 8,
      depth: 108,
      rotation: 0.08,
    },
  ];
}

function pushUniqueRenderMesh(
  target: RenderTargetTexture | null,
  mesh: AbstractMesh
) {
  if (!target?.renderList || target.renderList.includes(mesh)) return;
  target.renderList.push(mesh);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}
