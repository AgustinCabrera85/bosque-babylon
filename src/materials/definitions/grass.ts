import type { GameMaterialDefinition } from "../types/GameMaterialDefinition";

export const grass: GameMaterialDefinition = {
  id: "grass",
  name: "Grass",
  visual: {
    // The terrain's existing texture keeps its appearance familiar after the PBR migration.
    color: "#383838",
    metallic: 0,
    roughness: 0.86,
    albedoTexture: "/assets/models/textures/terrain/ground_grass/wispy-grass-meadow_albedo.png",
    normalTexture: "/assets/models/textures/terrain/ground_grass/wispy-grass-meadow_normal-ogl.png",
  },
  physics: {
    friction: 0.72,
    restitution: 0.04,
    density: 180,
  },
  gameplay: {
    hardness: 0.08,
    flammable: true,
    ignitionTemperature: 225,
    burnRate: 0.9,
    heatTransfer: 0.1,
    breakable: true,
    damageMultiplier: 1.35,
    wetnessAbsorption: 0.7,
  },
};
