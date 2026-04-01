import { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

type Hints = { set(text: string | null): void };

export class InteractSystem {
  constructor(private scene: Scene, private camera: Camera, private hints: Hints) {
    scene.onKeyboardObservable.add((kb) => {
      if (kb.type === KeyboardEventTypes.KEYDOWN && kb.event.code === "KeyE") {
        this.tryInteract();
      }
      if (kb.type === KeyboardEventTypes.KEYDOWN && kb.event.code === "Escape") {
        this.hints.set(null);
      }
    });
  }

  private tryInteract() {
    const origin = this.camera.globalPosition;
    const forward = this.camera.getDirection(Vector3.Forward());
    const ray = new Ray(origin, forward, 3.0);

    const hit = this.scene.pickWithRay(ray, (m) => !!m.metadata?.interactable);
    if (!hit?.hit || !hit.pickedMesh) return;

    const data = hit.pickedMesh.metadata;

    if (data?.type === "clue") {
      this.hints.set(`Pista: ${data.title ?? data.id}`);
      return;
    }

    if (data?.type === "door") {
      const locked = !!data.locked;
      if (locked) {
        this.hints.set("La puerta está cerrada. Falta una llave…");
      } else {
        this.hints.set("Abrís la puerta (demo).");
      }
      return;
    }

    this.hints.set(`Interacción: ${data?.type ?? "objeto"}`);
  }
}
