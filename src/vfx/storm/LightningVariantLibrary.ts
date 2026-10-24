import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../utils/asset";

export type LightningVariantId = "LGT_01" | "LGT_02" | "LGT_03" | "LGT_04";
export type LightningEventKind =
  | "cloud_to_ground" | "cloud_to_structure" | "cloud_to_cloud" | "background_flash";

export interface LightningHeadPath {
  schema: string;
  rootUv: { p: number; u: number; v: number };
  samples: Array<{ p: number; u: number; v: number }>;
}

export interface LightningVariant {
  id: LightningVariantId;
  slug: string;
  status: "ready" | "art_pending";
  supportedEvents: readonly LightningEventKind[];
  assetDirectory: string;
  requiredFiles: readonly [string, string, string, string];
}

const ROOT = "assets/fx/storm/lightning/";
const files = (slug: string): LightningVariant["requiredFiles"] => [
  `${slug}_bolt.png`, `${slug}_growth.png`, `${slug}_halo.png`, `${slug}_head-path.json`,
];

export const LIGHTNING_VARIANTS: readonly LightningVariant[] = [
  {
    id: "LGT_01", slug: "vertical_classic", status: "ready",
    supportedEvents: ["cloud_to_ground", "cloud_to_structure"],
    assetDirectory: `${ROOT}lgt_01_vertical_classic/`,
    // Preserve the four approved v1 files byte for byte, including their names.
    requiredFiles: ["lightning-bolt.png", "lightning-growth.png", "lightning-halo.png", "lightning-head-path.json"],
  },
  {
    id: "LGT_02", slug: "forked_crown", status: "art_pending",
    supportedEvents: ["cloud_to_ground", "cloud_to_structure"],
    assetDirectory: `${ROOT}lgt_02_forked_crown/`, requiredFiles: files("lgt_02_forked_crown"),
  },
  {
    id: "LGT_03", slug: "needle_strike", status: "art_pending",
    supportedEvents: ["cloud_to_ground"],
    assetDirectory: `${ROOT}lgt_03_needle_strike/`, requiredFiles: files("lgt_03_needle_strike"),
  },
  {
    id: "LGT_04", slug: "oblique_arc", status: "art_pending",
    supportedEvents: ["cloud_to_cloud", "cloud_to_structure"],
    assetDirectory: `${ROOT}lgt_04_oblique_arc/`, requiredFiles: files("lgt_04_oblique_arc"),
  },
];

export interface LoadedLightningVariant {
  definition: LightningVariant;
  bolt: Texture;
  growth: Texture;
  halo: Texture;
  headPath: LightningHeadPath;
  aspect: number;
}

function validHeadPath(value: unknown): value is LightningHeadPath {
  if (!value || typeof value !== "object") return false;
  const path = value as Partial<LightningHeadPath>;
  if (path.schema !== "lo-realy-lo-otro/lightning-headpath/v1" ||
      !path.rootUv || !Array.isArray(path.samples) || path.samples.length < 2 ||
      ![path.rootUv.p, path.rootUv.u, path.rootUv.v].every(Number.isFinite) ||
      path.rootUv.u < 0 || path.rootUv.u > 1 || path.rootUv.v < 0 || path.rootUv.v > 1) return false;
  let previous = -1;
  for (const sample of path.samples) {
    if (![sample.p, sample.u, sample.v].every(Number.isFinite) ||
        sample.p < previous || sample.p < 0 || sample.p > 1 ||
        sample.u < 0 || sample.u > 1 || sample.v < 0 || sample.v > 1) return false;
    previous = sample.p;
  }
  return Math.abs(path.rootUv.u - path.samples[0].u) < 0.02 &&
    Math.abs(path.rootUv.v - path.samples[0].v) < 0.02 &&
    path.samples[0].p === 0 && path.samples.at(-1)?.p === 1;
}

/** A scene owns one library; loaded textures are shared by all strikes in it. */
export class LightningVariantLibrary {
  private readonly cache = new Map<LightningVariantId, Promise<LoadedLightningVariant>>();
  private readonly ownedTextures = new Set<Texture>();
  private disposed = false;

  constructor(private readonly scene: Scene) {}

  definition(id: LightningVariantId): LightningVariant {
    const variant = LIGHTNING_VARIANTS.find(item => item.id === id);
    if (!variant) throw new Error(`Variante desconocida: ${id}`);
    return variant;
  }

  load(id: LightningVariantId): Promise<LoadedLightningVariant> {
    if (this.disposed) return Promise.reject(new Error("La biblioteca de rayos ya fue liberada"));
    const variant = this.definition(id);
    if (variant.status !== "ready") {
      return Promise.reject(new Error(`${id} (${variant.slug}) pendiente de arte: ${variant.requiredFiles.join(", ")}`));
    }
    const cached = this.cache.get(id);
    if (cached) return cached;
    const loading = this.loadReady(variant).catch(error => {
      this.cache.delete(id);
      throw error;
    });
    this.cache.set(id, loading);
    return loading;
  }

  private async loadReady(definition: LightningVariant): Promise<LoadedLightningVariant> {
    const localTextures: Texture[] = [];
    const texture = (file: string, gammaSpace: boolean): Promise<Texture> =>
      new Promise((resolve, reject) => {
        const loaded = new Texture(
          asset(definition.assetDirectory + file), this.scene, false, true,
          Texture.TRILINEAR_SAMPLINGMODE,
          () => resolve(loaded),
          (message, exception) => reject(new Error(`No se pudo cargar ${file}: ${message || exception}`)),
        );
        loaded.wrapU = Texture.CLAMP_ADDRESSMODE;
        loaded.wrapV = Texture.CLAMP_ADDRESSMODE;
        loaded.gammaSpace = gammaSpace;
        localTextures.push(loaded);
      });
    try {
      const [bolt, growth, halo, response] = await Promise.all([
        texture(definition.requiredFiles[0], true),
        texture(definition.requiredFiles[1], false),
        texture(definition.requiredFiles[2], true),
        fetch(asset(definition.assetDirectory + definition.requiredFiles[3])),
      ]);
      if (!response.ok) throw new Error(`No se pudo cargar ${definition.requiredFiles[3]}: HTTP ${response.status}`);
      const headPath: unknown = await response.json();
      if (!validHeadPath(headPath)) throw new Error(`Ruta de punta inválida para ${definition.id}`);
      const size = bolt.getSize();
      if (size.width < 2 || size.height < 2 ||
          [growth, halo].some(item => item.getSize().width !== size.width ||
            item.getSize().height !== size.height)) {
        throw new Error(`Bolt, growth y halo de ${definition.id} deben tener igual tamaño`);
      }
      if (this.disposed) throw new Error("La escena se cerró durante la carga del rayo");
      localTextures.forEach(item => this.ownedTextures.add(item));
      return { definition, bolt, growth, halo, headPath, aspect: size.width / size.height };
    } catch (error) {
      localTextures.forEach(item => item.dispose());
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ownedTextures.forEach(texture => texture.dispose());
    this.ownedTextures.clear();
    this.cache.clear();
  }
}
