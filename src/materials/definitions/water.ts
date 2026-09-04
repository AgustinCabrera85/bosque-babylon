import type { GameMaterialDefinition } from "../types/GameMaterialDefinition";

export const water: GameMaterialDefinition = {
  id: "water",
  name: "Water",
  visual: {
    color: "#1B6974",
    metallic: 0,
    roughness: 0.12,
  },
  physics: {
    friction: 0.05,
    restitution: 0,
    density: 1000,
  },
  gameplay: {
    hardness: 0,
    flammable: false,
    heatTransfer: 0.72,
    breakable: false,
    damageMultiplier: 0,
    wetnessAbsorption: 0,
  },
};
