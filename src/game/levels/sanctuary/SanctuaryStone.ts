import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Scene } from "@babylonjs/core/scene";

const ASSET_BASE = "/assets/textures/sanctuary/";
const ORIGINAL_ALBEDO = `${ASSET_BASE}stone_monolith_albedo_1024.webp`;

type SanctuaryStoneVariant = "original" | "megalithic";

type HeightFogSettings = {
  fogStartHeight: number;
  fogEndHeight: number;
  distanceInfluence: number;
  atmosphericBlend: number;
  heightNoiseStrength: number;
  ambientDensity: number;
};

// Opaque, per-fragment atmospheric blending keeps Babylon's depth and reflection passes intact.
class SanctuaryHeightFogPlugin extends MaterialPluginBase {
  private readonly perMesh = new WeakMap<AbstractMesh, HeightFogSettings>();

  constructor(material: StandardMaterial, private readonly defaultSettings?: HeightFogSettings) {
    super(material, "SanctuaryHeightFog", 200);
    // The pillar material is shared with unfogged landings, so bind for every mesh draw.
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  setMesh(mesh: AbstractMesh, settings: HeightFogSettings): void {
    this.perMesh.set(mesh, settings);
  }

  getUniforms() {
    return {
      ubo: [
        { name: "sanctuaryHeightFogRange", size: 4, type: "vec4" },
        { name: "sanctuaryHeightFogDetail", size: 4, type: "vec4" },
      ],
    };
  }

  hardBindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: unknown, subMesh: SubMesh): void {
    const settings = this.perMesh.get(subMesh.getMesh()) ?? this.defaultSettings;
    if (!settings) {
      uniformBuffer.updateFloat4("sanctuaryHeightFogRange", 0, 1, 0, 0);
      uniformBuffer.updateFloat4("sanctuaryHeightFogDetail", 0, 0, 0, 0);
      return;
    }
    uniformBuffer.updateFloat4("sanctuaryHeightFogRange", settings.fogStartHeight,
      settings.fogEndHeight, settings.distanceInfluence, settings.atmosphericBlend);
    uniformBuffer.updateFloat4("sanctuaryHeightFogDetail", settings.heightNoiseStrength,
      settings.ambientDensity, 0, 0);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef FOG
float sanctuaryDistance = length(vPositionW - vEyePosition.xyz);
float sanctuaryDepthFog = 1.0 - exp(-sanctuaryDistance * sanctuaryHeightFogDetail.y);
float sanctuaryRange = max(sanctuaryHeightFogRange.y - sanctuaryHeightFogRange.x, 1.0);
float sanctuaryShift = sanctuaryRange * sanctuaryHeightFogRange.z * sanctuaryDepthFog;
float sanctuaryNoise = sin(vPositionW.x * 0.018 + vPositionW.z * 0.011)
  * sin(vPositionW.z * 0.023 - vPositionW.y * 0.006) * sanctuaryHeightFogDetail.x;
float sanctuaryHeight = vPositionW.y + sanctuaryNoise;
float sanctuaryFade = smoothstep(sanctuaryHeightFogRange.x - sanctuaryShift,
  sanctuaryHeightFogRange.y - sanctuaryShift, sanctuaryHeight) * sanctuaryHeightFogRange.w;
// Match the dark clear-sky gradient behind the stone; EXP2 supplies the distance tint afterwards.
vec3 sanctuaryRay = normalize(vPositionW - vEyePosition.xyz);
float sanctuaryElevation = clamp(sanctuaryRay.y * 0.75 + 0.42, 0.0, 1.0);
vec3 sanctuarySky = mix(vec3(0.075, 0.009, 0.014), vec3(0.19, 0.027, 0.03), sanctuaryElevation);
float sanctuaryHorizon = 1.0 - smoothstep(0.0, 0.24, abs(sanctuaryRay.y));
sanctuarySky = mix(sanctuarySky, vec3(0.18, 0.028, 0.032), sanctuaryHorizon * 0.75);
color.rgb = mix(color.rgb, sanctuarySky, sanctuaryFade);
#endif
`,
    };
  }
}

/** Ancient grey lithic monoliths: no glowing red seams baked into the stone. */
export function createSanctuaryStoneMaterials(scene: Scene, mobile: boolean, heightFogEnabled = true,
  variant: SanctuaryStoneVariant = "megalithic") {
  const makeStone = (name: string, tileU: number, tileV: number, tone: number, normalStrength: number,
    megalithic?: { albedo: string; tileU: number; tileV: number; tone: number }) => {
    const mat = new StandardMaterial(name, scene);
    // Keep a visible, previously shipped texture bound until the new one is ready.
    // A missing WebP therefore cannot leave the stone without an albedo.
    const original = new Texture(ORIGINAL_ALBEDO, scene, true, false);
    original.uScale = tileU;
    original.vScale = tileV;
    mat.diffuseTexture = original;
    const useMegalithic = variant === "megalithic" && megalithic !== undefined;
    mat.diffuseColor = new Color3(tone, tone * 1.01, tone * 1.04);
    mat.specularColor = new Color3(0.038, 0.038, 0.039);
    mat.specularPower = 15;
    if (useMegalithic) {
      const candidate = new Texture(`${ASSET_BASE}${megalithic.albedo}`, scene, true, false);
      candidate.uScale = megalithic.tileU;
      candidate.vScale = megalithic.tileV;
      const applyMegalithic = () => {
        if (!candidate.isReady()) return;
        mat.diffuseTexture = candidate;
        mat.diffuseColor = new Color3(megalithic.tone, megalithic.tone * 1.01, megalithic.tone * 1.04);
        original.dispose();
      };
      if (candidate.isReady()) applyMegalithic();
      else candidate.onLoadObservable.addOnce(applyMegalithic);
    }
    if (!mobile && normalStrength > 0) {
      const normal = new Texture(`${ASSET_BASE}stone_monolith_normal_1024.webp`, scene, true, false);
      normal.uScale = tileU;
      normal.vScale = tileV;
      normal.level = normalStrength;
      mat.bumpTexture = normal;
    }
    return mat;
  };
  const pillar = makeStone("sanctuaryMonolithicStone", 1.5, 3.0, .62, .23);
  const wall = makeStone("sanctuaryInfiniteStoneWall", 7.0, 12.0, .40, .0, {
    albedo: "sanctuary_wall_megalithic_basecolor_1024.webp",
    tileU: .85, tileV: 1.1, tone: .68,
  });
  const stairs = makeStone("sanctuarySolidStoneSteps", 2.0, 2.0, .46, .0, {
    albedo: "sanctuary_stairs_eroded_basecolor_1024.webp",
    tileU: 1, tileV: 1, tone: .74,
  });
  const parapet = variant === "megalithic"
    ? makeStone("sanctuaryMegalithicParapets", 2.0, 2.0, .46, .0, {
      albedo: "sanctuary_parapet_blocks_basecolor_1024.webp",
      tileU: .5, tileV: .7, tone: .74,
    })
    : stairs;
  // Same near-field appearance as sanctuaryObsidan, isolated from hands, gate and doors.
  const upperStructure = new StandardMaterial("sanctuaryUpperStructure", scene);
  upperStructure.diffuseColor = new Color3(.017, .018, .022);
  upperStructure.specularColor = new Color3(.02, .015, .013);
  upperStructure.emissiveColor = Color3.Black();
  const pillarFog = heightFogEnabled ? new SanctuaryHeightFogPlugin(pillar) : null;
  const upperStructureFog = heightFogEnabled ? new SanctuaryHeightFogPlugin(upperStructure) : null;
  if (heightFogEnabled) {
    new SanctuaryHeightFogPlugin(wall, {
      fogStartHeight: 360,
      fogEndHeight: 2300,
      distanceInfluence: .32,
      atmosphericBlend: 1,
      heightNoiseStrength: 65,
      ambientDensity: scene.fogDensity,
    });
  }
  return {
    // Different UV scales because the wall's surface area is vastly larger.
    pillar,
    wall,
    upperStructure,
    stairs,
    parapet,
    setPillarHeightFog(mesh: AbstractMesh, height: number) {
      const fog = mesh.material === pillar ? pillarFog
        : mesh.material === upperStructure ? upperStructureFog : null;
      fog?.setMesh(mesh, {
        fogStartHeight: height * .38,
        fogEndHeight: height * .92,
        distanceInfluence: .20,
        atmosphericBlend: 1,
        heightNoiseStrength: height * .025,
        ambientDensity: scene.fogDensity,
      });
    },
  };
}
