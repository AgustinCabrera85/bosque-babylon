import "@babylonjs/loaders/glTF";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import { asset } from "../utils/asset";
import { applyPhotoCardMaterials } from "./PhotoCard";
import type { InputManager } from "./input/InputManager";
import { renderActionPrompt } from "./input/InputPrompts";

export type InspectableItem = {
  id: string;
  name: string;
  typeLabel: string;
  description: string;
  inspectOnPickup?: boolean;
  pickupInspectionDelaySeconds?: number;
  inspectMode?: "model" | "image";
  modelRootPath?: string;
  modelFileName?: string;
  texturePath?: string;
  contentImagePath?: string;
  inventoryIconPath?: string;
  modelScale?: number;
  cameraRadius?: number;
};

export const ITEM_INSPECTOR_OPENED_EVENT = "bosque:item-inspector:opened";

type InspectItemEvent = CustomEvent<InspectableItem>;

type InspectorDom = {
  overlay: HTMLDivElement;
  view: HTMLDivElement;
  canvas: HTMLCanvasElement;
  image: HTMLImageElement;
  controls: HTMLElement;
  title: HTMLElement;
  type: HTMLElement;
  description: HTMLElement;
  closeButton: HTMLButtonElement;
};

const INSPECTABLE_IMAGE_FALLBACKS: Record<string, string> = {
  "note-1": "assets/models/props/png/notes/Note_1.png",
};

export type ItemInspectorHandle = {
  inspect: (item: InspectableItem) => void;
  isOpen: () => boolean;
  close: () => void;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
};

type InspectorMode = "model" | "image";
type InspectorInteraction = (deltaSeconds: number) => void;

type ItemInspectorOptions = {
  input: InputManager;
};

export function setupItemInspector({ input }: ItemInspectorOptions): ItemInspectorHandle {
  const dom = createInspectorDom();
  let engine: Engine | null = null;
  let scene: Scene | null = null;
  let interaction: InspectorInteraction | null = null;
  let currentMode: InspectorMode | null = null;
  let open = false;
  const abortController = new AbortController();
  const signal = abortController.signal;

  const close = () => {
    if (!open) return;
    open = false;
    dom.overlay.classList.add("hidden");
    dom.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("inspector-open");
    window.dispatchEvent(new CustomEvent("bosque:pause", { detail: { paused: false } }));
    engine?.stopRenderLoop();
    scene?.dispose();
    engine?.dispose();
    scene = null;
    engine = null;
    interaction = null;
    currentMode = null;
  };

  const inspect = (item: InspectableItem) => {
    currentMode = resolveInspectorMode(item);
    renderInspectorControls(dom, input, currentMode);
    void openItem(
      item,
      dom,
      input,
      () => ({ engine, scene }),
      (nextEngine, nextScene) => {
        engine = nextEngine;
        scene = nextScene;
      },
      (nextInteraction) => {
        interaction = nextInteraction;
      }
    );
    open = true;
    window.dispatchEvent(new CustomEvent(ITEM_INSPECTOR_OPENED_EVENT));
  };

  dom.closeButton.addEventListener("click", close, { signal });
  dom.overlay.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
  dom.overlay.addEventListener("click", (event) => event.stopPropagation(), { signal });
  window.addEventListener("resize", () => engine?.resize(), { signal });
  window.addEventListener("bosque:inspect-item", (event) => {
    inspect((event as InspectItemEvent).detail);
  }, { signal });
  const unsubscribeInput = input.onActiveDeviceChanged(() => {
    if (currentMode) renderInspectorControls(dom, input, currentMode);
  });
  signal.addEventListener("abort", unsubscribeInput, { once: true });

  return {
    inspect,
    isOpen: () => open,
    close,
    update: (deltaSeconds) => {
      if (open) interaction?.(deltaSeconds);
    },
    dispose: () => {
      close();
      abortController.abort();
      dom.overlay.remove();
    },
  };
}

async function openItem(
  item: InspectableItem,
  dom: InspectorDom,
  input: InputManager,
  getState: () => { engine: Engine | null; scene: Scene | null },
  setState: (engine: Engine, scene: Scene) => void,
  setInteraction: (interaction: InspectorInteraction | null) => void
) {
  const previous = getState();
  previous.engine?.stopRenderLoop();
  previous.scene?.dispose();
  previous.engine?.dispose();
  setInteraction(null);

  dom.title.textContent = item.name;
  dom.type.textContent = item.typeLabel;
  dom.description.textContent = item.description;
  dom.overlay.classList.remove("hidden");
  dom.overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("inspector-open");
  if (document.pointerLockElement instanceof HTMLElement) {
    document.exitPointerLock?.();
  }
  window.dispatchEvent(new CustomEvent("bosque:pause", { detail: { paused: true } }));

  if (item.inspectMode === "image") {
    openImageItem(item, dom, input, setInteraction);
    return;
  }

  if (!item.modelRootPath || !item.modelFileName) {
    openImageItem(item, dom, input, setInteraction);
    return;
  }

  dom.canvas.classList.remove("hidden");
  dom.image.classList.add("hidden");

  const engine = new Engine(dom.canvas, true, {
    preserveDrawingBuffer: false,
    stencil: false,
    antialias: true,
  });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 0);

  const camera = new ArcRotateCamera(
    "itemInspectorCamera",
    Math.PI * 0.5,
    Math.PI * 0.42,
    item.cameraRadius ?? 2.4,
    Vector3.Zero(),
    scene
  );
  camera.lowerRadiusLimit = 1.2;
  camera.upperRadiusLimit = 5.2;
  camera.wheelDeltaPercentage = 0.01;
  camera.pinchDeltaPercentage = 0.008;
  camera.angularSensibilityX = 900;
  camera.angularSensibilityY = 900;
  camera.attachControl(dom.canvas, true);
  setInteraction((deltaSeconds) => {
    updateModelWithGamepad(input, camera, deltaSeconds);
  });

  const hemi = new HemisphericLight("itemInspectorHemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 1.25;
  hemi.diffuse = new Color3(0.95, 0.88, 0.74);
  hemi.groundColor = new Color3(0.2, 0.13, 0.08);

  const key = new DirectionalLight("itemInspectorKey", new Vector3(-0.45, -0.7, -0.52), scene);
  key.intensity = 1.8;
  key.diffuse = new Color3(1.0, 0.9, 0.72);

  const res = await SceneLoader.ImportMeshAsync(
    null,
    asset(item.modelRootPath),
    item.modelFileName,
    scene
  );
  if (item.texturePath) applyPhotoCardMaterials(scene, res.meshes, asset(item.texturePath));
  prepareInspectableMeshes(res.meshes, item.modelScale ?? 1.0);
  frameCamera(camera, res.meshes);

  setState(engine, scene);
  engine.runRenderLoop(() => scene.render());
  engine.resize();
}

function openImageItem(
  item: InspectableItem,
  dom: InspectorDom,
  input: InputManager,
  setInteraction: (interaction: InspectorInteraction | null) => void
) {
  dom.canvas.classList.add("hidden");
  dom.image.classList.remove("hidden");
  dom.image.alt = item.name;
  dom.image.draggable = false;

  let scale = 1;
  const offset = { x: 0, y: 0 };
  const lastPointer = { x: 0, y: 0 };
  let panning = false;
  let initialPinchDistance: number | null = null;
  let initialPinchScale = 1;

  const clampOffset = () => {
    const viewWidth = dom.view.clientWidth;
    const viewHeight = dom.view.clientHeight;
    const imageWidth = dom.image.offsetWidth;
    const imageHeight = dom.image.offsetHeight;
    const maxX = Math.max((imageWidth * scale - viewWidth) * 0.5, 0);
    const maxY = Math.max((imageHeight * scale - viewHeight) * 0.5, 0);

    offset.x = Math.min(maxX, Math.max(-maxX, offset.x));
    offset.y = Math.min(maxY, Math.max(-maxY, offset.y));
  };

  const applyTransform = () => {
    clampOffset();
    dom.image.style.transform = `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
    dom.image.classList.toggle("is-zoomed", scale > 1.01);
  };

  const resetView = () => {
    scale = 1;
    offset.x = 0;
    offset.y = 0;
    applyTransform();
  };

  const imagePath = getInspectableImagePath(item);
  dom.image.onload = () => {
    dom.image.classList.remove("unavailable");
    window.requestAnimationFrame(resetView);
  };
  dom.image.onerror = () => {
    dom.image.classList.add("unavailable");
    dom.controls.textContent = "";
    const error = document.createElement("span");
    error.textContent = "Imagen no disponible";
    dom.controls.append(error);
  };
  dom.image.src = imagePath ? asset(imagePath) : "";
  dom.image.classList.toggle("unavailable", !imagePath);

  resetView();
  dom.image.onwheel = (event) => {
    event.preventDefault();
    scale = Math.max(0.75, Math.min(2.8, scale + (event.deltaY < 0 ? 0.12 : -0.12)));
    if (scale <= 1.01) {
      offset.x = 0;
      offset.y = 0;
    }
    applyTransform();
  };
  dom.image.onpointerdown = (event) => {
    event.preventDefault();
    if (scale <= 1.01) return;

    panning = true;
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
    dom.image.classList.add("is-panning");
    dom.image.setPointerCapture(event.pointerId);
  };
  dom.image.onpointermove = (event) => {
    if (!panning) return;
    event.preventDefault();

    offset.x += event.clientX - lastPointer.x;
    offset.y += event.clientY - lastPointer.y;
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
    applyTransform();
  };

  const stopPanning = (event: PointerEvent) => {
    if (!panning) return;
    panning = false;
    dom.image.classList.remove("is-panning");
    if (dom.image.hasPointerCapture(event.pointerId)) {
      dom.image.releasePointerCapture(event.pointerId);
    }
  };
  dom.image.onpointerup = stopPanning;
  dom.image.onpointercancel = stopPanning;
  dom.image.ondragstart = (event) => event.preventDefault();
  dom.view.ontouchstart = (event) => {
    if (event.touches.length === 2) {
      initialPinchDistance = getTouchDistance(event.touches[0], event.touches[1]);
      initialPinchScale = scale;
      panning = false;
      dom.image.classList.remove("is-panning");
    }
  };
  dom.view.ontouchmove = (event) => {
    if (event.touches.length !== 2 || !initialPinchDistance) return;
    event.preventDefault();

    const distance = getTouchDistance(event.touches[0], event.touches[1]);
    scale = Math.max(1, Math.min(3.2, initialPinchScale * (distance / initialPinchDistance)));
    if (scale <= 1.01) {
      offset.x = 0;
      offset.y = 0;
    }
    applyTransform();
  };
  dom.view.ontouchend = () => {
    initialPinchDistance = null;
  };

  setInteraction((deltaSeconds) => {
    if (input.getActiveDevice() !== "gamepad") return;

    const movement = input.getMovement();
    const look = input.getLook();
    const zoomDirection = Number(input.isDown("attack")) - Number(input.isDown("absorbLight"));
    let changed = false;

    if (zoomDirection !== 0) {
      scale = Math.max(1, Math.min(2.8, scale + zoomDirection * deltaSeconds * 1.15));
      changed = true;
    }

    if (scale > 1.01) {
      const panSpeed = 420 * deltaSeconds;
      offset.x += movement.x * panSpeed + look.x * 180;
      offset.y += -movement.y * panSpeed + look.y * 180;
      changed ||= Math.abs(movement.x) + Math.abs(movement.y) > 0.001;
      changed ||= Math.abs(look.x) + Math.abs(look.y) > 0.001;
    } else if (offset.x !== 0 || offset.y !== 0) {
      offset.x = 0;
      offset.y = 0;
      changed = true;
    }

    if (changed) applyTransform();
  });
}

function resolveInspectorMode(item: InspectableItem): InspectorMode {
  return item.inspectMode === "image" || !item.modelRootPath || !item.modelFileName
    ? "image"
    : "model";
}

function renderInspectorControls(
  dom: InspectorDom,
  input: InputManager,
  mode: InspectorMode
) {
  dom.controls.replaceChildren();
  const device = input.getActiveDevice();

  const addText = (text: string) => {
    const row = document.createElement("span");
    row.textContent = text;
    dom.controls.appendChild(row);
  };

  if (device === "gamepad") {
    addText(mode === "model" ? "Sticks: rotar objeto" : "Sticks: desplazar imagen");
    for (const [action, copy] of [
      ["attack", "Acercar"],
      ["absorbLight", "Alejar"],
      ["cancel", "Cerrar"],
    ] as const) {
      const row = document.createElement("div");
      row.className = "item-inspector-control-row";
      renderActionPrompt(row, input, action, copy);
      dom.controls.appendChild(row);
    }
    return;
  }

  if (device === "touch") {
    addText(mode === "model" ? "Arrastrar para rotar" : "Arrastrar para desplazar");
    addText("Pellizcar para acercar o alejar");
    return;
  }

  addText(mode === "model" ? "Arrastrar para rotar" : "Arrastrar para desplazar");
  addText("Rueda para acercar o alejar");
  addText("Guardar para cerrar");
}

function updateModelWithGamepad(
  input: InputManager,
  camera: ArcRotateCamera,
  deltaSeconds: number
) {
  if (input.getActiveDevice() !== "gamepad") return;

  const movement = input.getMovement();
  const look = input.getLook();
  camera.alpha -= movement.x * deltaSeconds * 1.75 + look.x * 0.8;
  camera.beta += -movement.y * deltaSeconds * 1.45 + look.y * 0.8;
  camera.beta = Math.max(0.15, Math.min(Math.PI - 0.15, camera.beta));

  const zoomDirection = Number(input.isDown("absorbLight")) - Number(input.isDown("attack"));
  if (zoomDirection === 0) return;
  const minRadius = camera.lowerRadiusLimit ?? 1.2;
  const maxRadius = camera.upperRadiusLimit ?? 5.2;
  camera.radius = Math.max(
    minRadius,
    Math.min(maxRadius, camera.radius + zoomDirection * deltaSeconds * 2.25)
  );
}

function getTouchDistance(a: Touch, b: Touch) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getInspectableImagePath(item: InspectableItem) {
  return item.contentImagePath ?? item.texturePath ?? INSPECTABLE_IMAGE_FALLBACKS[item.id] ?? "";
}

function createInspectorDom(): InspectorDom {
  const overlay = document.createElement("div");
  overlay.id = "itemInspector";
  overlay.className = "item-inspector hidden";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <section class="item-inspector-panel" aria-labelledby="itemInspectorTitle">
      <span class="corner tl"></span>
      <span class="corner tr"></span>
      <span class="corner bl"></span>
      <span class="corner br"></span>

      <div class="item-inspector-view">
        <canvas id="itemInspectorCanvas"></canvas>
        <img id="itemInspectorImage" class="item-inspector-image hidden" alt="" />
      </div>

      <aside class="item-inspector-detail">
        <p id="itemInspectorType" class="item-inspector-type"></p>
        <h2 id="itemInspectorTitle" class="item-inspector-title"></h2>
        <p id="itemInspectorDescription" class="item-inspector-description"></p>
        <div id="itemInspectorControls" class="item-inspector-controls"></div>
        <button id="itemInspectorClose" class="menu-button secondary" type="button">Guardar</button>
      </aside>
    </section>
  `;
  document.body.appendChild(overlay);

  return {
    overlay,
    view: overlay.querySelector(".item-inspector-view") as HTMLDivElement,
    canvas: overlay.querySelector("#itemInspectorCanvas") as HTMLCanvasElement,
    image: overlay.querySelector("#itemInspectorImage") as HTMLImageElement,
    controls: overlay.querySelector("#itemInspectorControls") as HTMLElement,
    title: overlay.querySelector("#itemInspectorTitle") as HTMLElement,
    type: overlay.querySelector("#itemInspectorType") as HTMLElement,
    description: overlay.querySelector("#itemInspectorDescription") as HTMLElement,
    closeButton: overlay.querySelector("#itemInspectorClose") as HTMLButtonElement,
  };
}

function prepareInspectableMeshes(meshes: AbstractMesh[], scale: number) {
  for (const mesh of meshes) {
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.scaling.scaleInPlace(scale);
    mesh.computeWorldMatrix(true);
  }
}

function frameCamera(camera: ArcRotateCamera, meshes: AbstractMesh[]) {
  const bounds = collectBounds(meshes);
  if (!bounds) return;

  const center = bounds.min.add(bounds.max).scale(0.5);
  const size = bounds.max.subtract(bounds.min);
  const radius = Math.max(size.x, size.y, size.z, 0.7) * 1.45;
  camera.target.copyFrom(center);
  camera.radius = Math.max(radius, camera.lowerRadiusLimit ?? radius);
}

function collectBounds(meshes: AbstractMesh[]) {
  const renderable = meshes.filter((mesh) => mesh.getTotalVertices() > 0);
  if (!renderable.length) return null;

  const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  for (const mesh of renderable) {
    mesh.refreshBoundingInfo({});
    const box = mesh.getBoundingInfo().boundingBox;
    min.copyFrom(Vector3.Minimize(min, box.minimumWorld));
    max.copyFrom(Vector3.Maximize(max, box.maximumWorld));
  }

  return { min, max };
}
