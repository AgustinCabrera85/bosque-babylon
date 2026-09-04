import type { GameMaterialDefinition } from "../types/GameMaterialDefinition";

export const stone: GameMaterialDefinition = {
  id: "stone",
  name: "Stone",
  visual: {
    color: "#6D7074",
    metallic: 0,
    roughness: 0.92,
  },
  physics: {
    friction: 0.85,
    restitution: 0.05,
    density: 2650,
  },
  gameplay: {
    hardness: 0.9,
    flammable: false,
    heatTransfer: 0.12,
    breakable: true,
    damageMultiplier: 0.35,
    wetnessAbsorption: 0.05,
  },
};
