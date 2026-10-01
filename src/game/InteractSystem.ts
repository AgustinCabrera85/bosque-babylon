import { Scene } from "@babylonjs/core/scene";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { InputManager } from "./input/InputManager";

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
  interactionLabel?: string | (() => string);
  onInteract?: () => InteractResult | void;
};

const INTERACTION_RAY_LENGTH = 4.25;
const INTERACTION_PROXIMITY_VERTICAL_TOLERANCE = 2.2;
const INTERACTION_MESSAGE_DURATION_SECONDS = 2.4;

export class InteractSystem {
  private messageSecondsRemaining = 0;

  constructor(
    private scene: Scene,
    private input: InputManager,
    private getLookRay: () => LookRay,
    private hints: Hints,
    private onAction?: (type?: string, movementLockSeconds?: number) => void,
    private canInteract: () => boolean = () => true
  ) {}

  update(deltaSeconds: number) {
    this.messageSecondsRemaining = Math.max(
      0,
      this.messageSecondsRemaining - Math.max(0, deltaSeconds)
    );
    if (this.input.wasPressed("interact") && this.canInteract()) this.tryInteract();
    if (this.input.wasPressed("cancel")) this.clearMessage();
  }

  isMessageActive() {
    return this.messageSecondsRemaining > 0;
  }

  clearMessage() {
    this.messageSecondsRemaining = 0;
    this.hints.set(null);
  }

  peekInteractable() {
    return this.findInteractable(this.getLookRay());
  }

  getInteractionLabel() {
    const pickedMesh = this.peekInteractable();
    if (!pickedMesh) return null;
    const data = pickedMesh.metadata as InteractableMetadata | undefined;
    const explicitLabel = typeof data?.interactionLabel === "function"
      ? data.interactionLabel()
      : data?.interactionLabel;
    if (explicitLabel?.trim()) return explicitLabel.trim();
    return defaultInteractionLabel(data);
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
      this.showMessage(customMessage);
      return;
    }

    if (data?.type === "clue") {
      this.showMessage(`Pista: ${data.title ?? data.id}`);
      return;
    }

    if (data?.type === "door") {
      const locked = !!data.locked;
      if (locked) {
        this.showMessage("La puerta esta cerrada. Falta una llave...");
      } else {
        this.showMessage("Abris la puerta (demo).");
      }
      return;
    }

    this.showMessage(`Interaccion: ${data?.type ?? "objeto"}`);
  }

  private showMessage(message: string) {
    this.messageSecondsRemaining = INTERACTION_MESSAGE_DURATION_SECONDS;
    this.hints.set(message);
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

function defaultInteractionLabel(data: InteractableMetadata | undefined) {
  switch (data?.type) {
    case "key":
    case "matches":
    case "note":
    case "photo":
      return "recoger";
    case "door":
      return "abrir";
    case "inspect":
      return "examinar";
    case "clue":
      return "leer";
    default:
      return "interactuar";
  }
}
