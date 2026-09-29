import type { Scene } from "@babylonjs/core/scene";
import type { InspectorToken } from "@babylonjs/inspector";

export class BabylonInspectorDebug {
  private opening: Promise<void> | null = null;
  private inspector: InspectorToken | null = null;
  private disposed = false;

  public constructor(private readonly scene: Scene) {}

  public async open() {
    if (this.disposed || this.scene.isDisposed) return;
    if (this.inspector && !this.inspector.isDisposed) return;

    if (!this.opening) {
      this.opening = import("@babylonjs/inspector")
        .then(({ ShowInspector }) => {
          if (this.disposed || this.scene.isDisposed) return;

          const inspector = ShowInspector(this.scene, { layoutMode: "overlay" });
          this.inspector = inspector;
          inspector.onDisposed.addOnce(() => {
            if (this.inspector === inspector) this.inspector = null;
          });
        })
        .finally(() => {
          this.opening = null;
        });
    }

    await this.opening;
  }

  public async close() {
    await this.opening;
    const inspector = this.inspector;
    this.inspector = null;
    if (inspector && !inspector.isDisposed) await inspector.dispose();
  }

  public async toggle() {
    if (this.inspector && !this.inspector.isDisposed) {
      await this.close();
      return;
    }
    await this.open();
  }

  public dispose() {
    this.disposed = true;
    void this.close();
  }
}
