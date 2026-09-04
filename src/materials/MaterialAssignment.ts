import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { MaterialFactory } from "./MaterialFactory";
import { MaterialRegistry } from "./MaterialRegistry";
import type { GameMaterialDefinition } from "./types/GameMaterialDefinition";

export const GAME_MATERIAL_METADATA_KEY = "gameMaterialId";

export type SetGameMaterialOptions = {
  /**
   * Keeps an imported material intact while still assigning the logical definition.
   * This is useful for GLB assets whose original texture set must be preserved.
   */
  readonly applyVisual?: boolean;
};

type MeshMetadata = Record<string, unknown> & {
  gameMaterialId?: string;
};

/** Assigns logical data and, by default, its shared Babylon PBR material to a mesh. */
export function setGameMaterial(
  mesh: AbstractMesh,
  id: string,
  scene: Scene,
  options: SetGameMaterialOptions = {}
): GameMaterialDefinition | undefined {
  const definition = MaterialRegistry.get(id);
  if (!definition) {
    console.warn(`[GameMaterial] Unknown material id "${id}" for mesh "${mesh.name}".`);
    return undefined;
  }

  const metadata = getWritableMetadata(mesh);
  metadata[GAME_MATERIAL_METADATA_KEY] = definition.id;

  if (options.applyVisual !== false) {
    const material = MaterialFactory.getOrCreate(definition.id, scene);
    if (material) mesh.material = material;
  }

  return definition;
}

/** Returns the complete logical definition, or undefined for unassigned/unknown meshes. */
export function getGameMaterial(mesh: AbstractMesh): GameMaterialDefinition | undefined {
  const id = getGameMaterialId(mesh);
  return id ? MaterialRegistry.get(id) : undefined;
}

export function getGameMaterialId(mesh: AbstractMesh): string | undefined {
  const metadata = mesh.metadata;
  if (!isMetadataRecord(metadata)) return undefined;

  const id = metadata[GAME_MATERIAL_METADATA_KEY];
  return typeof id === "string" ? id : undefined;
}

function getWritableMetadata(mesh: AbstractMesh): MeshMetadata {
  if (isMetadataRecord(mesh.metadata)) return mesh.metadata as MeshMetadata;

  // Babylon accepts any metadata shape. Preserve an uncommon primitive/array value rather than dropping it.
  const existingMetadata = mesh.metadata;
  const metadata: MeshMetadata = existingMetadata === undefined || existingMetadata === null
    ? {}
    : { legacyMetadata: existingMetadata };
  mesh.metadata = metadata;
  return metadata;
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
