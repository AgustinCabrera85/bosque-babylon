import type { InspectableItem } from "./ItemInspector";
import { asset } from "../utils/asset";

type InventoryItem = InspectableItem & {
  count: number;
};

type InventoryOptions = {
  inspectItem: (item: InspectableItem) => void;
};

type InventoryDom = {
  button: HTMLButtonElement;
  overlay: HTMLDivElement;
  itemsGrid: HTMLDivElement;
  filters: HTMLDivElement;
  detailName: HTMLElement;
  detailType: HTMLElement;
  detailDescription: HTMLElement;
  detailCount: HTMLElement;
  detailStatus: HTMLElement;
  inspectButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
};

type AddInventoryItemEvent = CustomEvent<InspectableItem>;

export type InventoryHandle = {
  addItem: (item: InspectableItem) => void;
  setItemCount: (item: InspectableItem, count: number) => void;
  hasItem: (id: string) => boolean;
  getItemCount: (id: string) => number;
  consumeItem: (id: string, amount?: number) => boolean;
  isOpen: () => boolean;
};

export function setupInventory({ inspectItem }: InventoryOptions): InventoryHandle {
  const dom = createInventoryDom();
  const items = new Map<string, InventoryItem>();
  let selectedId: string | null = null;
  let currentFilter = "all";
  let open = false;

  const render = () => {
    renderFilters(dom, items, currentFilter, (filter) => {
      currentFilter = filter;
      render();
    });
    renderItems(dom, items, selectedId, currentFilter, (id) => {
      selectedId = id;
      render();
    });
    renderDetail(dom, selectedId ? items.get(selectedId) ?? null : null);
  };

  const close = () => {
    if (!open) return;
    open = false;
    dom.overlay.classList.add("hidden");
    dom.overlay.setAttribute("aria-hidden", "true");
    dom.button.setAttribute("aria-pressed", "false");
    document.body.classList.remove("inventory-open");
    window.dispatchEvent(new CustomEvent("bosque:pause", { detail: { paused: false } }));
  };

  const openInventory = () => {
    if (open) return;
    if (document.body.classList.contains("sky-eye-cinematic-active")) return;
    if (document.pointerLockElement instanceof HTMLElement) document.exitPointerLock?.();

    open = true;
    dom.overlay.classList.remove("hidden");
    dom.overlay.setAttribute("aria-hidden", "false");
    dom.button.setAttribute("aria-pressed", "true");
    document.body.classList.add("inventory-open");
    window.dispatchEvent(new CustomEvent("bosque:pause", { detail: { paused: true } }));
    render();
  };

  const toggle = () => {
    if (open) close();
    else openInventory();
  };

  const addItem = (item: InspectableItem) => {
    const existing = items.get(item.id);
    if (existing) {
      Object.assign(existing, item);
      existing.count += 1;
    } else {
      items.set(item.id, { ...item, count: 1 });
      selectedId = item.id;
    }
    render();
  };

  const setItemCount = (item: InspectableItem, count: number) => {
    const safeCount = Math.max(0, Math.floor(count));
    const existing = items.get(item.id);
    if (existing) {
      Object.assign(existing, item);
      existing.count = safeCount;
    } else {
      items.set(item.id, { ...item, count: safeCount });
      selectedId ??= item.id;
    }
    render();
  };

  const consumeItem = (id: string, amount = 1) => {
    const item = items.get(id);
    const safeAmount = Math.max(1, Math.floor(amount));
    if (!item || item.count < safeAmount) return false;
    item.count -= safeAmount;
    render();
    return true;
  };

  dom.button.addEventListener("click", toggle);
  dom.closeButton.addEventListener("click", close);
  dom.inspectButton.addEventListener("click", () => {
    if (!selectedId) return;
    const item = items.get(selectedId);
    if (!item || !canInspectItem(item)) return;

    close();
    inspectItem(item);
  });
  dom.overlay.addEventListener("pointerdown", (event) => event.stopPropagation());
  dom.overlay.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("keydown", (event) => {
    if (document.body.classList.contains("inspector-open")) return;

    if (event.code === "KeyI" && !event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      toggle();
      return;
    }

    if (open && event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }, true);
  window.addEventListener("bosque:inventory:add-item", (event) => {
    addItem((event as AddInventoryItemEvent).detail);
  });

  render();

  return {
    addItem,
    setItemCount,
    hasItem: (id) => items.has(id),
    getItemCount: (id) => items.get(id)?.count ?? 0,
    consumeItem,
    isOpen: () => open,
  };
}

function createInventoryDom(): InventoryDom {
  const button = document.createElement("button");
  button.id = "inventoryButton";
  button.type = "button";
  button.textContent = "Inventario";
  button.setAttribute("aria-label", "Abrir inventario");
  button.setAttribute("aria-pressed", "false");
  document.body.appendChild(button);

  const overlay = document.createElement("div");
  overlay.id = "inventoryOverlay";
  overlay.className = "inventory-overlay hidden";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <section class="inventory-panel" aria-labelledby="inventoryTitle">
      <span class="corner tl"></span>
      <span class="corner tr"></span>
      <span class="corner bl"></span>
      <span class="corner br"></span>

      <header class="inventory-header">
        <p class="inventory-kicker">Bosque Babylon</p>
        <h1 id="inventoryTitle" class="inventory-title">Inventario</h1>
      </header>

      <main class="inventory-layout">
        <section class="inventory-section" aria-labelledby="inventoryItemsTitle">
          <h2 id="inventoryItemsTitle" class="inventory-section-title">Objetos recolectados</h2>
          <div id="inventoryFilters" class="inventory-filters"></div>
          <div id="inventoryItemsGrid" class="inventory-items-grid"></div>
        </section>

        <aside class="inventory-section inventory-detail" aria-live="polite">
          <p id="inventoryDetailType" class="inventory-detail-type">Inventario</p>
          <h2 id="inventoryDetailName" class="inventory-detail-name">Sin objetos</h2>
          <p id="inventoryDetailDescription" class="inventory-detail-description">
            Los objetos encontrados apareceran aca.
          </p>
          <div class="inventory-detail-meta">
            <div class="inventory-meta-row">
              <span>Cantidad</span>
              <strong id="inventoryDetailCount">-</strong>
            </div>
            <div class="inventory-meta-row">
              <span>Estado</span>
              <strong id="inventoryDetailStatus">-</strong>
            </div>
          </div>
        </aside>
      </main>

      <footer class="inventory-actions">
        <button id="inventoryInspectButton" class="menu-button" type="button">Inspeccionar</button>
        <button id="inventoryCloseButton" class="menu-button secondary" type="button">Cerrar</button>
      </footer>
    </section>
  `;
  document.body.appendChild(overlay);

  return {
    button,
    overlay,
    itemsGrid: overlay.querySelector("#inventoryItemsGrid") as HTMLDivElement,
    filters: overlay.querySelector("#inventoryFilters") as HTMLDivElement,
    detailName: overlay.querySelector("#inventoryDetailName") as HTMLElement,
    detailType: overlay.querySelector("#inventoryDetailType") as HTMLElement,
    detailDescription: overlay.querySelector("#inventoryDetailDescription") as HTMLElement,
    detailCount: overlay.querySelector("#inventoryDetailCount") as HTMLElement,
    detailStatus: overlay.querySelector("#inventoryDetailStatus") as HTMLElement,
    inspectButton: overlay.querySelector("#inventoryInspectButton") as HTMLButtonElement,
    closeButton: overlay.querySelector("#inventoryCloseButton") as HTMLButtonElement,
  };
}

function renderFilters(
  dom: InventoryDom,
  items: Map<string, InventoryItem>,
  currentFilter: string,
  onSelect: (filter: string) => void
) {
  const filters = Array.from(new Set(Array.from(items.values()).map((item) => item.typeLabel)));
  dom.filters.replaceChildren();

  const all = createFilterButton("Todos", "all", currentFilter, onSelect);
  dom.filters.appendChild(all);

  for (const filter of filters) {
    dom.filters.appendChild(createFilterButton(filter, filter, currentFilter, onSelect));
  }
}

function createFilterButton(
  label: string,
  value: string,
  currentFilter: string,
  onSelect: (filter: string) => void
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inventory-filter";
  button.textContent = label;
  button.classList.toggle("active", currentFilter === value);
  button.addEventListener("click", () => onSelect(value));
  return button;
}

function renderItems(
  dom: InventoryDom,
  items: Map<string, InventoryItem>,
  selectedId: string | null,
  currentFilter: string,
  onSelect: (id: string) => void
) {
  dom.itemsGrid.replaceChildren();
  const visible = Array.from(items.values()).filter(
    (item) => currentFilter === "all" || item.typeLabel === currentFilter
  );

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "inventory-empty";
    empty.textContent = "No hay objetos recolectados.";
    dom.itemsGrid.appendChild(empty);
    return;
  }

  for (const item of visible) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inventory-item-card";
    button.classList.toggle("selected", item.id === selectedId);
    button.addEventListener("click", () => onSelect(item.id));

    const count = document.createElement("span");
    count.className = "inventory-item-count";
    count.textContent = String(item.count);

    const preview = document.createElement("span");
    preview.className = "inventory-item-preview";
    if (item.inventoryIconPath) {
      const icon = document.createElement("img");
      icon.className = "inventory-item-icon";
      icon.src = asset(item.inventoryIconPath);
      icon.alt = "";
      icon.draggable = false;
      preview.appendChild(icon);
    } else {
      preview.textContent = item.name.slice(0, 1).toUpperCase();
    }

    const name = document.createElement("span");
    name.className = "inventory-item-name";
    name.textContent = item.name;

    button.append(count, preview, name);
    dom.itemsGrid.appendChild(button);
  }
}

function renderDetail(dom: InventoryDom, item: InventoryItem | null) {
  dom.detailName.textContent = item?.name ?? "Sin objetos";
  dom.detailType.textContent = item?.typeLabel ?? "Inventario";
  dom.detailDescription.textContent =
    item?.description ?? "Los objetos encontrados apareceran aca.";
  dom.detailCount.textContent = item ? String(item.count) : "-";
  dom.detailStatus.textContent = item
    ? item.typeLabel === "Municion"
      ? "Equipado"
      : "Guardado"
    : "-";
  dom.inspectButton.disabled = !item || !canInspectItem(item);
}

function canInspectItem(item: InspectableItem) {
  return !!(
    item.inspectMode ||
    item.modelRootPath ||
    item.contentImagePath ||
    item.texturePath
  );
}
