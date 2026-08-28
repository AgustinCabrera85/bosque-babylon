import { Scene } from "@babylonjs/core/scene";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

type Hints = { set(text: string | null): void };
type LookRay = {
  origin: Vector3;
  direction: Vector3;
  proximityOrigin?: Vector3;
  proximityRadius?: number;
};
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

const INTERACTION_RAY_LENGTH = 4.25;
const INTERACTION_PROXIMITY_VERTICAL_TOLERANCE = 2.2;

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

  peekInteractable() {
    return this.findInteractable(this.getLookRay());
  }

  tryInteract() {
    const pickedMesh = this.peekInteractable();
    if (!pickedMesh) return;

    const data = pickedMesh.metadata as InteractableMetadata | undefined;
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
        this.hints.set("La puerta esta cerrada. Falta una llave...");
      } else {
        this.hints.set("Abris la puerta (demo).");
      }
      return;
    }

    this.hints.set(`Interaccion: ${data?.type ?? "objeto"}`);
  }

  private findInteractable(look: LookRay) {
    const ray = new Ray(look.origin, look.direction, INTERACTION_RAY_LENGTH);
    const hit = this.scene.pickWithRay(ray, (m) => !!m.metadata?.interactable);
    if (hit?.hit && hit.pickedMesh) return hit.pickedMesh;

    if (!look.proximityOrigin || !look.proximityRadius) return null;
    return this.findNearestInteractable(look.proximityOrigin, look.proximityRadius);
  }

  private findNearestInteractable(origin: Vector3, radius: number) {
    let nearest: AbstractMesh | null = null;
    let nearestDistanceSq = radius * radius;

    for (const mesh of this.scene.meshes) {
      if (!mesh.isEnabled() || !mesh.isPickable || !mesh.metadata?.interactable) continue;

      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      const min = box.minimumWorld;
      const max = box.maximumWorld;
      const verticalDistance = this.distanceOutsideRange(origin.y, min.y, max.y);
      if (verticalDistance > INTERACTION_PROXIMITY_VERTICAL_TOLERANCE) continue;

      const dx = this.distanceOutsideRange(origin.x, min.x, max.x);
      const dz = this.distanceOutsideRange(origin.z, min.z, max.z);
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > nearestDistanceSq) continue;

      nearestDistanceSq = distanceSq;
      nearest = mesh;
    }

    return nearest;
  }

  private distanceOutsideRange(value: number, min: number, max: number) {
    if (value < min) return min - value;
    if (value > max) return value - max;
    return 0;
  }
}
