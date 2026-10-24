import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

/** Two scene-local lights are allocated once and reused by every strike. */
export class StormLightPool {
  readonly head: PointLight;
  readonly contact: PointLight;
  private enabled = true;

  constructor(scene: Scene, recipients: readonly AbstractMesh[]) {
    const make = (name: string, color: Color3) => {
      const light = new PointLight(name, Vector3.Zero(), scene);
      light.diffuse = color;
      light.specular = color.scale(0.24);
      light.range = 12;
      light.intensity = 0;
      light.includedOnlyMeshes = [...recipients];
      return light;
    };
    this.head = make("stormHeadLight", new Color3(0.75, 0.82, 1));
    this.contact = make("stormContactLight", new Color3(0.83, 0.68, 1));
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.clear(); }
  illuminate(head: Vector3, impact: Vector3, energy: number): void {
    if (!this.enabled) return;
    this.head.position.copyFrom(head);
    this.contact.position.copyFrom(impact);
    this.head.intensity = Math.max(0, energy) * 0.68;
    this.contact.intensity = Math.max(0, energy) * 0.34;
  }
  clear(): void { this.head.intensity = 0; this.contact.intensity = 0; }
  dispose(): void { this.head.dispose(); this.contact.dispose(); }
}
