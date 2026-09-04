import type { GameMaterialDefinition } from "../types/GameMaterialDefinition";

export const wood: GameMaterialDefinition = {
  id: "wood",
  name: "Wood",
  visual: {
    color: "#70482D",
    metallic: 0,
    roughness: 0.78,
  },
  physics: {
    friction: 0.68,
    restitution: 0.12,
    density: 700,
  },
  gameplay: {
    hardness: 0.38,
    flammable: true,
    ignitionTemperature: 300,
    burnRate: 0.62,
    heatTransfer: 0.16,
    breakable: true,
    damageMultiplier: 1.1,
    wetnessAbsorption: 0.75,
  },
};
