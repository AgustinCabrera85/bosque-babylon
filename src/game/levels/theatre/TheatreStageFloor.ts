import { PBRCustomMaterial } from "@babylonjs/materials/custom/pbrCustomMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../utils/asset";

const STAGE_WOOD_TEXTURE =
  "assets/textures/theatre/stage/wooden-scenario-floor-texture.png";
const PLANK_COUNT = 16;
const PLANK_GAP = 0.014;
const SURFACE_Y = 0.006;
const VISUAL_SIDE_EXTENSION = 5;

export type TheatreStageFloorDimensions = {
  width: number;
  depth: number;
  centerZ: number;
};

function deterministicNoise(index: number, salt: number) {
  let value =
    Math.imul(index + 23, 0x9e3779b1) ^
    Math.imul(salt + 41, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function createStageWoodMaterial(
  scene: Scene,
  sideFadeStart: number,
  sideFadeEnd: number
) {
  const texture = new Texture(asset(STAGE_WOOD_TEXTURE), scene);
  texture.wrapU = Texture.MIRROR_ADDRESSMODE;
  texture.wrapV = Texture.MIRROR_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  texture.hasAlpha = false;

  const material = new PBRCustomMaterial("theatreStageWood", scene);
  material.albedoTexture = texture;
  material.albedoColor = new Color3(0.42, 0.37, 0.34);
  material.metallic = 0;
  material.roughness = 0.54;
  material.maxSimultaneousLights = 8;
  material.fogEnabled = true;

  material.Fragment_Definitions(`
    float theatreStageHash(vec2 point) {
      return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float theatreStageValueNoise(vec2 point) {
      vec2 cell = floor(point);
      vec2 local = fract(point);
      local = local * local * (3.0 - 2.0 * local);
      float a = theatreStageHash(cell);
      float b = theatreStageHash(cell + vec2(1.0, 0.0));
      float c = theatreStageHash(cell + vec2(0.0, 1.0));
      float d = theatreStageHash(cell + vec2(1.0, 1.0));
      return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
    }

    float theatreStageMacroNoise(vec2 worldXZ) {
      float broad = theatreStageValueNoise(worldXZ * 0.11);
      float medium = theatreStageValueNoise(worldXZ * 0.22 + vec2(13.7, 4.9));
      return mix(broad, medium, 0.34);
    }
  `);
  material.Fragment_Custom_Albedo(`
    float stageAlbedoMacro = theatreStageMacroNoise(vPositionW.xz);
    surfaceAlbedo *= mix(0.94, 1.07, stageAlbedoMacro);
  `);
  material.Fragment_Custom_MetallicRoughness(`
    float stageRoughnessMacro = theatreStageMacroNoise(vPositionW.xz + vec2(21.3, 8.6));
    metallicRoughness.g = clamp(
      metallicRoughness.g + (stageRoughnessMacro - 0.5) * 0.08,
      0.48,
      0.62
    );
  `);
  material.Fragment_Before_FragColor(`
    float stageSideVisibility = 1.0 - smoothstep(
      ${sideFadeStart.toFixed(3)},
      ${sideFadeEnd.toFixed(3)},
      abs(vPositionW.x)
    );
    finalColor.rgb *= mix(0.003, 1.0, stageSideVisibility);
  `);

  return material;
}

function offsetPlankUvs(plank: Mesh, plankIndex: number) {
  const uvs = plank.getVerticesData(VertexBuffer.UVKind);
  if (!uvs) throw new Error(`El tablon ${plankIndex} no tiene coordenadas UV.`);

  const mirrorAlongGrain = deterministicNoise(plankIndex, 7) > 0.5;
  const uScale = 1.02 + deterministicNoise(plankIndex, 13) * 0.08;
  const uOffset = deterministicNoise(plankIndex, 19) * 0.72;
  const vScale = 0.082 + deterministicNoise(plankIndex, 29) * 0.025;
  const vOffset = deterministicNoise(plankIndex, 37) * (1 - vScale);

  for (let index = 0; index < uvs.length; index += 2) {
    const sourceU = mirrorAlongGrain ? 1 - uvs[index] : uvs[index];
    uvs[index] = uOffset + sourceU * uScale;
    uvs[index + 1] = vOffset + uvs[index + 1] * vScale;
  }
  plank.setVerticesData(VertexBuffer.UVKind, uvs, false);
}

export function createTheatreStageFloor(
  scene: Scene,
  parent: TransformNode,
  dimensions: TheatreStageFloorDimensions
) {
  const visualWidth = dimensions.width + VISUAL_SIDE_EXTENSION * 2;
  const sideFadeStart = dimensions.width * 0.34;
  const sideFadeEnd = visualWidth * 0.5 - 0.8;
  const material = createStageWoodMaterial(
    scene,
    sideFadeStart,
    sideFadeEnd
  );
  const plankDepth = dimensions.depth / PLANK_COUNT;
  const stageNearZ = dimensions.centerZ - dimensions.depth * 0.5;
  const planks: Mesh[] = [];

  for (let index = 0; index < PLANK_COUNT; index += 1) {
    const plank = MeshBuilder.CreateGround(
      `theatreStagePlank_${index}`,
      {
        width: visualWidth,
        height: plankDepth - PLANK_GAP,
        subdivisions: 1,
      },
      scene
    );
    plank.position.set(
      0,
      SURFACE_Y,
      stageNearZ + plankDepth * (index + 0.5)
    );
    offsetPlankUvs(plank, index);
    plank.material = material;
    plank.isPickable = false;
    plank.receiveShadows = true;
    planks.push(plank);
  }

  const surface = Mesh.MergeMeshes(planks, true, true);
  if (!surface) throw new Error("No se pudo construir el piso de madera del teatro.");
  surface.name = "theatreStageWoodSurface";
  surface.parent = parent;
  surface.material = material;
  surface.isPickable = false;
  surface.receiveShadows = true;
  return surface;
}
