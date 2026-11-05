import * as BABYLON from '@babylonjs/core';
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { INK_PRESETS, RorschachTextRenderer, type InkTextSettings } from './text/rorschach-text.js';
import textFragment from './shaders/text/rorschach-text.frag.glsl?raw';
export { INK_PRESETS };
export type { InkTextSettings };

/** Instantiates the lab-approved experimental renderer, independent from lab HTML/DOM. */
export class RorschachTextFX {
  readonly renderer:RorschachTextRenderer;
  private readonly observer:Observer<Scene>;
  private paused=false;
  private disposed=false;
  constructor(private readonly scene:Scene,options:{
    width?:number;height?:number;planeWidth?:number;settings?:Partial<InkTextSettings>;
  }={}) {
    this.renderer=new RorschachTextRenderer({
      BABYLON,scene,fragment:textFragment,
      width:options.width??1280,height:options.height??720,
      planeWidth:options.planeWidth??10,
      settings:{...INK_PRESETS.darkness,...options.settings},
    });
    this.observer=scene.onBeforeRenderObservable.add(()=>{
      this.renderer.tick(Math.max(0,scene.getEngine().getDeltaTime())*.001,this.paused);
    });
  }
  setContent(text:string,speaker=''):void{this.renderer.setContent(text,speaker);}
  setSettings(next:Partial<InkTextSettings>):void{this.renderer.setSettings(next);}
  /** Typewriter counts Unicode code points. */
  revealCharacters(count:number):void{this.renderer.updateMask(count);}
  setPaused(value:boolean):void{this.paused=value;}
  dispose():void{
    if(this.disposed)return;this.disposed=true;
    this.scene.onBeforeRenderObservable.remove(this.observer);this.renderer.dispose();
  }
}
