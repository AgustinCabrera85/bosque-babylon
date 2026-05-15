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

export type InspectableItem = {
  id: string;
  name: string;
  typeLabel: string;
  description: string;
  inspectMode?: "model" | "image";
  modelRootPath?: string;
  modelFileName?: string;
  texturePath?: string;
  contentImagePath?: string;
  inventoryIconPath?: string;
  modelScale?: number;
  cameraRadius?: number;
};

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
};

export function setupItemInspector(): ItemInspectorHandle {
  const dom = createInspectorDom();
  let engine: Engine | null = null;
  let scene: Scene | null = null;
  let open = false;

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
  };

  const inspect = (item: InspectableItem) => {
    void openItem(item, dom, () => ({ engine, scene }), (nextEngine, nextScene) => {
      engine = nextEngine;
      scene = nextScene;
    });
    open = true;
  };

  dom.closeButton.addEventListener("click", close);
  dom.overlay.addEventListener("pointerdown", (event) => event.stopPropagation());
  dom.overlay.addEventListener("click", (event) => event.stopPropagation());
  window.addEventListener("resize", () => engine?.resize());
  document.addEventListener("keydown", (event) => {
    if (!open) return;
    event.stopPropagation();
    if (event.code === "Escape") close();
  }, true);
  window.addEventListener("bosque:inspect-item", (event) => {
    inspect((event as InspectItemEvent).detail);
  });

  return {
    inspect,
    isOpen: () => open,
  };
}

async function openItem(
  item: InspectableItem,
  dom: InspectorDom,
  getState: () => { engine: Engine | null; scene: Scene | null },
  setState: (engine: Engine, scene: Scene) => void
) {
  const previous = getState();
  previous.engine?.stopRenderLoop();
  previous.scene?.dispose();
  previous.engine?.dispose();

  if (document.pointerLockElement instanceof HTMLElement) {
    document.exitPointerLock?.();
  }

  dom.title.textContent = item.name;
  dom.type.textContent = item.typeLabel;
  dom.description.textContent = item.description;
  dom.overlay.classList.remove("hidden");
  dom.overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("inspector-open");
  window.dispatchEvent(new CustomEvent("bosque:pause", { detail: { paused: true } }));

  if (item.inspectMode === "image") {
    openImageItem(item, dom);
    return;
  }

  if (!item.modelRootPath || !item.modelFileName) {
    openImageItem(item, dom);
    return;
  }

  dom.canvas.classList.remove("hidden");
  dom.image.classList.add("hidden");
  dom.controls.textContent = "";
  const rotate = document.createElement("span");
  rotate.textContent = "Arrastrar para rotar";
  const zoom = document.createElement("span");
  zoom.textContent = "Rueda para zoom";
  dom.controls.append(rotate, zoom);

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

function openImageItem(item: InspectableItem, dom: InspectorDom) {
  dom.canvas.classList.add("hidden");
  dom.image.classList.remove("hidden");
  dom.image.alt = item.name;
  dom.image.draggable = false;
  dom.controls.textContent = "";
  const zoom = document.createElement("span");
  zoom.textContent = "Rueda para acercar";
  const pan = document.createElement("span");
  pan.textContent = "Arrastrar para panear";
  const close = document.createElement("span");
  close.textContent = "Guardar para cerrar";
  dom.controls.append(zoom, pan, close);

  let scale = 1;
  const offset = { x: 0, y: 0 };
  const lastPointer = { x: 0, y: 0 };
  let panning = false;

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
    dom.controls.append(error, close);
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
