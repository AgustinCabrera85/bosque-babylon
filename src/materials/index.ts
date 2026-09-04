export { MaterialFactory } from "./MaterialFactory";
export { MaterialRegistry } from "./MaterialRegistry";
export {
  SAFE_MAX_SIMULTANEOUS_LIGHTS,
  enforceSceneMaterialLightBudget,
  installSceneMaterialLightBudgetGuard,
  synchronizeSceneLightPriorities,
} from "./LightBudget";
export {
  GAME_MATERIAL_METADATA_KEY,
  getGameMaterial,
  getGameMaterialId,
  setGameMaterial,
} from "./MaterialAssignment";
export type { SetGameMaterialOptions } from "./MaterialAssignment";
export type { GameMaterialDefinition } from "./types/GameMaterialDefinition";
