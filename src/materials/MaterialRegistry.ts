import { grass } from "./definitions/grass";
import { metal } from "./definitions/metal";
import { soil } from "./definitions/soil";
import { stone } from "./definitions/stone";
import { water } from "./definitions/water";
import { wood } from "./definitions/wood";
import type { GameMaterialDefinition } from "./types/GameMaterialDefinition";

const definitions: readonly GameMaterialDefinition[] = [wood, stone, metal, grass, soil, water];
const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));

/** Central, data-only lookup for all logical game materials. */
export class MaterialRegistry {
  static get(id: string): GameMaterialDefinition | undefined {
    return definitionsById.get(id);
  }

  static has(id: string): boolean {
    return definitionsById.has(id);
  }

  static getAll(): readonly GameMaterialDefinition[] {
    return definitions;
  }
}
