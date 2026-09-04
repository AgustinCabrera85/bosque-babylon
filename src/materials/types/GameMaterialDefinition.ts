/**
 * Data shared by rendering, physics and gameplay systems for a logical game material.
 * Values are deliberately game-tuning defaults rather than scientific measurements.
 */
export interface GameMaterialDefinition {
  readonly id: string;
  readonly name: string;
  readonly visual: {
    readonly color?: string;
    readonly metallic?: number;
    readonly roughness?: number;
    readonly albedoTexture?: string;
    readonly normalTexture?: string;
    readonly emissiveColor?: string;
  };
  readonly physics: {
    readonly friction: number;
    readonly restitution: number;
    readonly density?: number;
  };
  readonly gameplay: {
    readonly hardness: number;
    readonly flammable: boolean;
    readonly ignitionTemperature?: number;
    readonly burnRate?: number;
    readonly heatTransfer?: number;
    readonly breakable: boolean;
    readonly damageMultiplier?: number;
    readonly wetnessAbsorption?: number;
  };
}
