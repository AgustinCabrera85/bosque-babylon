import { Scene } from "@babylonjs/core/scene";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

type Hints = { set(text: string | null): void };
type LookRay = { origin: Vector3; direction: Vector3 };
type InteractResult =
  | string
  | {
      message?: string;
      actionType?: string;
      movementLockSeconds?: number;
      suppressAction?: boolean;
    };

type InteractableMetadata = {
  interactable?: boolean;
  type?: string;
  id?: string;
  title?: string;
  locked?: boolean;
  onInteract?: () => InteractResult | void;
};

export class InteractSystem {
  constructor(
    private scene: Scene,
    private getLookRay: () => LookRay,
    private hints: Hints,
    private onAction?: (type?: string, movementLockSeconds?: number) => void
  ) {
    scene.onKeyboardObservable.add((kb) => {
      if (kb.type === KeyboardEventTypes.KEYDOWN && kb.event.code === "KeyE") {
        this.tryInteract();
      }
      if (kb.type === KeyboardEventTypes.KEYDOWN && kb.event.code === "Escape") {
        this.hints.set(null);
      }
    });
  }

  tryInteract() {
    const look = this.getLookRay();
    const ray = new Ray(look.origin, look.direction, 3.0);

    const hit = this.scene.pickWithRay(ray, (m) => !!m.metadata?.interactable);
    if (!hit?.hit || !hit.pickedMesh) return;

    const data = hit.pickedMesh.metadata as InteractableMetadata | undefined;
    const customResult = data?.onInteract?.();
    const customMessage =
      typeof customResult === "string" ? customResult : customResult?.message;
    const actionType =
      typeof customResult === "object" ? customResult.actionType ?? data?.type : data?.type;
    const suppressAction =
      typeof customResult === "object" ? !!customResult.suppressAction : false;

    const movementLockSeconds =
      typeof customResult === "object" ? customResult.movementLockSeconds : undefined;

    if (!suppressAction) this.onAction?.(actionType, movementLockSeconds);

    if (customMessage) {
      this.hints.set(customMessage);
      return;
    }

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
