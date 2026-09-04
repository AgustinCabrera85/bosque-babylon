import type { GameMaterialDefinition } from "../types/GameMaterialDefinition";

export const metal: GameMaterialDefinition = {
  id: "metal",
  name: "Metal",
  visual: {
    color: "#747C86",
    metallic: 0.9,
    roughness: 0.38,
  },
  physics: {
    friction: 0.42,
    restitution: 0.08,
    density: 7850,
  },
  gameplay: {
    hardness: 0.86,
    flammable: false,
    heatTransfer: 0.92,
    breakable: false,
    damageMultiplier: 0.2,
    wetnessAbsorption: 0.04,
  },
};
