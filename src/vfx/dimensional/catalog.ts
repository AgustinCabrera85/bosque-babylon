/** Sources from Dimensional FX Lab v0.13; Shadertoy links are visual references.
 * `approved` reflects the user's last audited 17-shader catalog, not production certification.
 * All code here is independently authored; no original Shadertoy source is copied.
 */
export type DimensionalKind = 'surface' | 'postprocess' | 'projection' | 'material-plugin' | 'connector' | 'text';
export type DimensionalMode = 'quad'|'fire'|'portal'|'screens'|'post'|'mesh'|'ethereal'|'warp'|'text';
export type DimensionalLevel = 'bosque'|'rina'|'dream'|'manicomio'|'sanctuary'|'cinematica'|'futuro'|'multi';
export interface DimensionalEntry {
  readonly id: string; readonly name: string; readonly kind: DimensionalKind;
  readonly level: DimensionalLevel; readonly mode: DimensionalMode;
  readonly reference: string; readonly approved: boolean;
  readonly colors: readonly [string, string]; readonly speed: number;
  readonly scale: number; readonly intensity: number; readonly progress: number;
}
export const DIMENSIONAL_FX_CATALOG = [
  {
    "id": "lsySzd",
    "name": "Expansión volumétrica",
    "kind": "surface",
    "level": "cinematica",
    "mode": "quad",
    "reference": "https://www.shadertoy.com/view/lsySzd",
    "approved": true,
    "colors": [
      "#fb6431",
      "#ffd49a"
    ],
    "speed": 0.8,
    "scale": 1.2,
    "intensity": 1.1,
    "progress": 0.42
  },
  {
    "id": "ldBfDR",
    "name": "Lava Planet / Santuario",
    "kind": "surface",
    "level": "sanctuary",
    "mode": "quad",
    "reference": "https://www.shadertoy.com/view/ldBfDR",
    "approved": true,
    "colors": [
      "#c32212",
      "#ff7619"
    ],
    "speed": 0.6,
    "scale": 1,
    "intensity": 1.1,
    "progress": 0.5
  },
  {
    "id": "Ms2fWW",
    "name": "Túnel inicial de Santuario",
    "kind": "surface",
    "level": "sanctuary",
    "mode": "quad",
    "reference": "https://www.shadertoy.com/view/Ms2fWW",
    "approved": true,
    "colors": [
      "#1a1832",
      "#ee584a"
    ],
    "speed": 1,
    "scale": 1,
    "intensity": 1.1,
    "progress": 0.5
  },
  {
    "id": "XsXSWS",
    "name": "Llama sobrenatural",
    "kind": "surface",
    "level": "bosque",
    "mode": "fire",
    "reference": "https://www.shadertoy.com/view/XsXSWS",
    "approved": true,
    "colors": [
      "#da2110",
      "#ffbd38"
    ],
    "speed": 1.1,
    "scale": 1,
    "intensity": 1.2,
    "progress": 0.5
  },
  {
    "id": "MdfGRX",
    "name": "Portal de niebla infernal",
    "kind": "surface",
    "level": "sanctuary",
    "mode": "portal",
    "reference": "https://www.shadertoy.com/view/MdfGRX",
    "approved": true,
    "colors": [
      "#8b1026",
      "#ff5c2b"
    ],
    "speed": 1,
    "scale": 1,
    "intensity": 1.15,
    "progress": 0.5
  },
  {
    "id": "XsjXR1",
    "name": "Drenaje vital / filamentos",
    "kind": "surface",
    "level": "cinematica",
    "mode": "quad",
    "reference": "https://www.shadertoy.com/view/XsjXR1",
    "approved": true,
    "colors": [
      "#52182c",
      "#d95668"
    ],
    "speed": 1.2,
    "scale": 1,
    "intensity": 1,
    "progress": 0.5
  },
  {
    "id": "ttlXRf",
    "name": "Crawl Space / Manicomio",
    "kind": "surface",
    "level": "manicomio",
    "mode": "quad",
    "reference": "https://www.shadertoy.com/view/ttlXRf",
    "approved": true,
    "colors": [
      "#41415b",
      "#c4513e"
    ],
    "speed": 0.8,
    "scale": 1.1,
    "intensity": 1,
    "progress": 0.5
  },
  {
    "id": "4l2GW1",
    "name": "Anomalía de percepción",
    "kind": "postprocess",
    "level": "manicomio",
    "mode": "post",
    "reference": "https://www.shadertoy.com/view/4l2GW1",
    "approved": true,
    "colors": [
      "#4125be",
      "#d03d8e"
    ],
    "speed": 0.8,
    "scale": 1,
    "intensity": 0.85,
    "progress": 0.5
  },
  {
    "id": "wslcDf",
    "name": "Rorschach generativo",
    "kind": "surface",
    "level": "manicomio",
    "mode": "quad",
    "reference": "https://www.shadertoy.com/view/wslcDf",
    "approved": true,
    "colors": [
      "#17152a",
      "#6c314d"
    ],
    "speed": 0.4,
    "scale": 1,
    "intensity": 1,
    "progress": 0.5
  },
  {
    "id": "XlBXRK",
    "name": "Smash / impacto",
    "kind": "postprocess",
    "level": "cinematica",
    "mode": "post",
    "reference": "https://www.shadertoy.com/view/XlBXRK",
    "approved": true,
    "colors": [
      "#a72553",
      "#ffcf8d"
    ],
    "speed": 1,
    "scale": 1,
    "intensity": 1.3,
    "progress": 0.2
  },
  {
    "id": "4t2cR1",
    "name": "Viaje cósmico",
    "kind": "surface",
    "level": "dream",
    "mode": "quad",
    "reference": "https://www.shadertoy.com/view/4t2cR1",
    "approved": true,
    "colors": [
      "#1d1a70",
      "#8fbbff"
    ],
    "speed": 1.4,
    "scale": 1,
    "intensity": 1.4,
    "progress": 0.5
  },
  {
    "id": "XsKGRW",
    "name": "Desenfoque radial",
    "kind": "postprocess",
    "level": "cinematica",
    "mode": "post",
    "reference": "https://www.shadertoy.com/view/XsKGRW",
    "approved": true,
    "colors": [
      "#64218d",
      "#ff66ae"
    ],
    "speed": 1,
    "scale": 1,
    "intensity": 0.8,
    "progress": 0.5
  },
  {
    "id": "NsS3Dt",
    "name": "Red Landscape",
    "kind": "surface",
    "level": "sanctuary",
    "mode": "quad",
    "reference": "https://www.shadertoy.com/view/NsS3Dt",
    "approved": true,
    "colors": [
      "#9a2026",
      "#fa6950"
    ],
    "speed": 0.6,
    "scale": 1,
    "intensity": 1,
    "progress": 0.5
  },
  {
    "id": "lX2GzD",
    "name": "Pantallas del estadio de Rina",
    "kind": "surface",
    "level": "rina",
    "mode": "screens",
    "reference": "https://www.shadertoy.com/view/lX2GzD",
    "approved": false,
    "colors": [
      "#ff27c5",
      "#4eeeff"
    ],
    "speed": 1,
    "scale": 1,
    "intensity": 1.1,
    "progress": 0.5
  },
  {
    "id": "4XVBzK",
    "name": "Avance de la oscuridad",
    "kind": "surface",
    "level": "bosque",
    "mode": "quad",
    "reference": "https://www.shadertoy.com/view/4XVBzK",
    "approved": true,
    "colors": [
      "#24365d",
      "#8b4ada"
    ],
    "speed": 0.6,
    "scale": 1,
    "intensity": 1,
    "progress": 0.5
  },
  {
    "id": "ldySzW",
    "name": "Galería inundada / Santuario",
    "kind": "surface",
    "level": "sanctuary",
    "mode": "quad",
    "reference": "https://www.shadertoy.com/view/ldySzW",
    "approved": true,
    "colors": [
      "#6b1018",
      "#e7dad1"
    ],
    "speed": 0.45,
    "scale": 1,
    "intensity": 1,
    "progress": 0.5
  },
  {
    "id": "ldK3RW",
    "name": "Crecimiento ramificado sobre GLB",
    "kind": "projection",
    "level": "futuro",
    "mode": "mesh",
    "reference": "https://www.shadertoy.com/view/ldK3RW",
    "approved": true,
    "colors": [
      "#004b13",
      "#45ff40"
    ],
    "speed": 0.7,
    "scale": 1,
    "intensity": 1.6,
    "progress": 0.5
  },
  {
    "id": "ethereal-mesh",
    "name": "Ethereal Mesh GLB",
    "kind": "material-plugin",
    "level": "multi",
    "mode": "ethereal",
    "reference": "https://www.shadertoy.com/view/N3yXRV",
    "approved": false,
    "colors": [
      "#b86cff",
      "#54e0ff"
    ],
    "speed": 0.42,
    "scale": 1.95,
    "intensity": 1,
    "progress": 0.2
  },
  {
    "id": "warp-connection",
    "name": "Warp Tunnel 3D",
    "kind": "connector",
    "level": "multi",
    "mode": "warp",
    "reference": "https://www.shadertoy.com/view/XtdGR7",
    "approved": false,
    "colors": [
      "#9e4ee8",
      "#5eb9ef"
    ],
    "speed": 1.35,
    "scale": 1,
    "intensity": 1,
    "progress": 0.5
  },
  {
    "id": "rorschach-text",
    "name": "Rorschach Text",
    "kind": "text",
    "level": "multi",
    "mode": "text",
    "reference": "https://www.shadertoy.com/view/wslcDf",
    "approved": false,
    "colors": [
      "#c9bacf",
      "#7d4092"
    ],
    "speed": 1,
    "scale": 1,
    "intensity": 1,
    "progress": 0.5
  }
] as const satisfies readonly DimensionalEntry[];
export type DimensionalFXId = (typeof DIMENSIONAL_FX_CATALOG)[number]['id'];
export const DIMENSIONAL_SHADER_IDS = ["lsySzd", "ldBfDR", "Ms2fWW", "XsXSWS", "MdfGRX", "XsjXR1", "ttlXRf", "4l2GW1", "wslcDf", "XlBXRK", "4t2cR1", "XsKGRW", "NsS3Dt", "lX2GzD", "4XVBzK", "ldySzW", "ldK3RW"] as const;
const ENTRIES = new Map<string, DimensionalEntry>(DIMENSIONAL_FX_CATALOG.map(e => [e.id,e]));
export function getDimensionalFX(id: DimensionalFXId): DimensionalEntry {
 const found=ENTRIES.get(id); if(!found) throw new Error(`Unknown Dimensional FX: ${id}`);
 return found;
}
