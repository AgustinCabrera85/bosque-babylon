import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../../utils/asset";

const BASE = "assets/textures/rina/stands-impostors/v1/";

export type StandsSpectator = {
  id: number;
  atlasIndex: number;
  clipIndex: number;
  viewIndex: number;
  position: [number, number, number];
  width: number;
  height: number;
  color: [number, number, number, number];
  speed: number;
  frameOffset: number;
};

export type StandsClip = {
  index: number;
  startCell: number;
  frames: number;
  views: number;
  playbackFps: number;
};

export type StandsAtlas = {
  texture: Texture;
  columns: number;
  rows: number;
  width: number;
  height: number;
  clips: StandsClip[];
};

export type StandsSpriteAssets = {
  spectators: StandsSpectator[];
  playbackSpeed: number;
  atlases: StandsAtlas[];
  dispose(): void;
};

type Layout = {
  schema: string;
  count: number;
  playbackSpeed: number;
  atlases: { atlas: string; manifest: string }[];
  spectators: StandsSpectator[];
};

type Manifest = {
  schema: string;
  atlas: {
    file: string; width: number; height: number; cellWidth: number; cellHeight: number;
    columns: number; rows: number; usedCells: number; layout: string; alpha: boolean;
  };
  clips: StandsClip[];
};

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Rina stands impostors: ${message}`);
}

async function readJson<T>(relativePath: string): Promise<T> {
  const url = asset(BASE + relativePath);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Rina stands impostors: ${url} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function loadTexture(scene: Scene, relativePath: string): Promise<Texture> {
  const url = asset(BASE + relativePath);
  return new Promise((resolve, reject) => {
    const texture = new Texture(url, scene, true, true, Texture.BILINEAR_SAMPLINGMODE,
      () => resolve(texture),
      (_message, exception) => {
        texture.dispose();
        reject(new Error(`Rina stands impostors: failed to load ${url}: ${exception ?? _message}`));
      });
    texture.hasAlpha = true;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  });
}

export async function loadRinaStandsSpriteAssets(scene: Scene): Promise<StandsSpriteAssets> {
  const layout = await readJson<Layout>("crowd_layout.json");
  requireValid(layout.schema === "lo-realy-lo-otro/crowd-layout/v1", "unexpected layout schema");
  requireValid(Array.isArray(layout.spectators) && layout.spectators.length === layout.count && layout.count === 500,
    "layout must contain 500 spectators");
  requireValid(Number.isFinite(layout.playbackSpeed) && layout.playbackSpeed > 0, "invalid playback speed");
  requireValid(Array.isArray(layout.atlases) && layout.atlases.length === 4, "expected four atlases");
  const manifests = await Promise.all(layout.atlases.map(({ manifest }) => readJson<Manifest>(manifest)));
  const textures: Texture[] = [];
  try {
    for (let i = 0; i < manifests.length; i++) {
      const { atlas: info, clips, schema } = manifests[i];
      requireValid(schema === "lo-realy-lo-otro/impostor-atlas/v1", `atlas ${i + 1}: unexpected schema`);
      requireValid(info.layout === "row-major" && info.alpha && info.cellWidth === 256 && info.cellHeight === 256,
        `atlas ${i + 1}: unexpected cell layout`);
      requireValid(info.columns * info.cellWidth === info.width && info.rows * info.cellHeight === info.height,
        `atlas ${i + 1}: invalid dimensions`);
      requireValid(layout.atlases[i].atlas.endsWith(info.file), `atlas ${i + 1}: file mismatch`);
      requireValid(Array.isArray(clips) && clips.length > 0, `atlas ${i + 1}: no clips`);
      clips.forEach((clip, j) => {
        requireValid(clip.index === j && Number.isInteger(clip.startCell) && Number.isInteger(clip.frames)
          && clip.frames > 0 && Number.isInteger(clip.views) && clip.views > 0
          && Number.isFinite(clip.playbackFps) && clip.playbackFps > 0
          && clip.startCell + clip.frames * clip.views <= info.usedCells
          && info.usedCells <= info.columns * info.rows,
        `atlas ${i + 1}: invalid clip ${j}`);
      });
    }
    layout.spectators.forEach((s, i) => {
      const clips = manifests[s.atlasIndex]?.clips;
      const clip = clips?.[s.clipIndex];
      requireValid(!!clip && Number.isInteger(s.viewIndex) && s.viewIndex >= 0 && s.viewIndex < clip.views,
        `spectator ${i}: atlas, clip or view out of range`);
      requireValid(s.width > 0 && s.height > 0 && s.speed > 0 && Number.isFinite(s.frameOffset)
        && s.color.length === 4 && s.color.every(Number.isFinite), `spectator ${i}: invalid sprite attributes`);
    });
    // A Texture is shared by every spatial batch using this atlas.
    for (const entry of layout.atlases) textures.push(await loadTexture(scene, entry.atlas));
    textures.forEach((texture, i) => {
      const size = texture.getSize();
      requireValid(size.width === manifests[i].atlas.width && size.height === manifests[i].atlas.height,
        `atlas ${i + 1}: loaded texture size differs from manifest`);
    });
    return {
      spectators: layout.spectators,
      playbackSpeed: layout.playbackSpeed,
      atlases: manifests.map((manifest, i) => ({
        texture: textures[i], columns: manifest.atlas.columns, rows: manifest.atlas.rows,
        width: manifest.atlas.width, height: manifest.atlas.height, clips: manifest.clips,
      })),
      dispose: () => textures.forEach(texture => texture.dispose()),
    };
  } catch (error) {
    textures.forEach(texture => texture.dispose());
    throw error;
  }
}
