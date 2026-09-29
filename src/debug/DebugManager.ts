import type { Scene } from "@babylonjs/core/scene";
import { BabylonInspectorDebug } from "./inspector/BabylonInspectorDebug";
import { DebugPanel } from "./ui/DebugPanel";

export type DebugManagerOptions = {
  openAnimationLab?: () => void | Promise<void>;
};

export class DebugManager {
  private readonly panel = new DebugPanel("BOSQUE BABYLON \u2014 DEBUG");
  private readonly inspector: BabylonInspectorDebug;
  private disposed = false;

  public constructor(scene: Scene, options: DebugManagerOptions = {}) {
    this.inspector = new BabylonInspectorDebug(scene);

    const sceneSection = this.panel.addSection("SCENE");
    this.panel.addButton(sceneSection, "Babylon Inspector", () =>
      this.inspector.toggle()
    );

    const animationSection = this.panel.addSection("PROCEDURAL ANIMATION");
    this.panel.addButton(
      animationSection,
      "Procedural Animation Lab",
      () => options.openAnimationLab?.()
    );

    window.addEventListener("keydown", this.onKeyDown);
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "F9" || event.repeat) return;
    event.preventDefault();
    this.panel.toggle();
  };

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    this.inspector.dispose();
    this.panel.dispose();
  }
}
