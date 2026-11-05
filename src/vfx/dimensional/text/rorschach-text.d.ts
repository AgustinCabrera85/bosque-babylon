import type { Scene } from '@babylonjs/core/scene';
import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
export interface InkTextSettings {
  mode: 'dialogue' | 'note'; ink: string;edge: string;paper: string;
  motion: number;warp: number;glyphDrift: number;glow: number;breath: number;
  readability: number;bleed: number;liquify: number;tendrils: number;pooling: number;blotScale: number;
}
export const INK_PRESETS: {
  darkness:InkTextSettings; note:InkTextSettings; possessed:InkTextSettings;
};
export class RorschachTextRenderer {
  readonly plane:Mesh;readonly material:ShaderMaterial;readonly settings:InkTextSettings;
  constructor(options:{BABYLON:unknown;scene:Scene;fragment:string;width?:number;height?:number;planeWidth?:number;settings?:InkTextSettings});
  setContent(text:string,speaker?:string):void;
  setSettings(settings:Partial<InkTextSettings>):void;
  updateMask(limit?:number):void;
  tick(dt:number,paused?:boolean):void;
  dispose():void;
}
