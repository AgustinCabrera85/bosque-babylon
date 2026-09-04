import type { GameMaterialDefinition } from "../types/GameMaterialDefinition";

export const soil: GameMaterialDefinition = {
  id: "soil",
  name: "Soil",
  visual: {
    color: "#5B4634",
    metallic: 0,
    roughness: 0.96,
  },
  physics: {
    friction: 0.8,
    restitution: 0.02,
    density: 1450,
  },
  gameplay: {
    hardness: 0.24,
    flammable: false,
    heatTransfer: 0.2,
    breakable: true,
    damageMultiplier: 0.85,
    wetnessAbsorption: 0.9,
  },
};
