import type { InspectableItem } from "./ItemInspector";

export function getInventoryPickupMessage(item: Pick<InspectableItem, "name">) {
  return `Has recogido ${item.name}`;
}
