import { asset } from "../../utils/asset";

export type CursorType =
  | "menu"
  | "default"
  | "interact"
  | "pickup"
  | "danger"
  | "anomaly";

export interface CursorDefinition {
  url: string;
  hotspotX: number;
  hotspotY: number;
  fallback: string;
  rasterSize: number;
}

const CURSOR_ROOT = "assets/ui/cursors/";

export const CURSORS: Record<CursorType, CursorDefinition> = {
  menu: {
    url: asset(`${CURSOR_ROOT}menu-cursor.png`),
    hotspotX: 20,
    hotspotY: 10,
    fallback: "pointer",
    rasterSize: 64,
  },
  default: {
    url: asset(`${CURSOR_ROOT}cursor-default.png`),
    hotspotX: 32,
    hotspotY: 32,
    fallback: "default",
    rasterSize: 64,
  },
  interact: {
    url: asset(`${CURSOR_ROOT}cursor-interact.png`),
    hotspotX: 32,
    hotspotY: 32,
    fallback: "pointer",
    rasterSize: 64,
  },
  pickup: {
    url: asset(`${CURSOR_ROOT}cursor-pickup.png`),
    hotspotX: 32,
    hotspotY: 32,
    fallback: "grab",
    rasterSize: 64,
  },
  danger: {
    url: asset(`${CURSOR_ROOT}cursor-danger.png`),
    hotspotX: 32,
    hotspotY: 32,
    fallback: "crosshair",
    rasterSize: 64,
  },
  anomaly: {
    url: asset(`${CURSOR_ROOT}cursor-anomaly.png`),
    hotspotX: 32,
    hotspotY: 32,
    fallback: "pointer",
    rasterSize: 64,
  },
};

/** Highest priority first. Visibility (pointer lock/gamepad) is resolved separately. */
export const CURSOR_PRIORITY: readonly CursorType[] = [
  "menu",
  "pickup",
  "interact",
  "anomaly",
  "danger",
  "default",
];

const BASE_CURSOR_SOURCE = "base";
const CURSOR_CSS_PROPERTY = "--bosque-cursor";

export function resolveCursorType(types: Iterable<CursorType>): CursorType {
  const requested = new Set(types);
  return CURSOR_PRIORITY.find((type) => requested.has(type)) ?? "default";
}

export class CursorController {
  private readonly requests = new Map<string, CursorType>([
    [BASE_CURSOR_SOURCE, "default"],
  ]);
  private readonly preparedUrls = new Map<CursorType, string>();
  private readonly objectUrls = new Set<string>();
  private currentCursor: CursorType = "default";
  private cursorVisible = true;
  private preloadPromise: Promise<void> | null = null;
  private disposed = false;

  public constructor(
    private readonly pointerLockTarget: HTMLCanvasElement,
    private readonly root: HTMLElement = document.documentElement
  ) {
    this.root.dataset.bosqueCursorManaged = "true";
    document.addEventListener("pointerlockchange", this.applyCursor);
    this.applyCursor();
  }

  public preload(): Promise<void> {
    if (this.preloadPromise) return this.preloadPromise;

    this.preloadPromise = Promise.all(
      (Object.entries(CURSORS) as [CursorType, CursorDefinition][]).map(
        async ([type, definition]) => {
          try {
            const preparedUrl = await prepareCursorAsset(definition);
            if (this.disposed) {
              if (preparedUrl.startsWith("blob:")) URL.revokeObjectURL(preparedUrl);
              return;
            }
            this.preparedUrls.set(type, preparedUrl);
            if (preparedUrl.startsWith("blob:")) this.objectUrls.add(preparedUrl);
          } catch (error) {
            if (import.meta.env.DEV) {
              console.warn(`[Cursor] No se pudo precargar ${type}; se usara el fallback.`, error);
            }
          }
        }
      )
    ).then(() => {
      this.applyCursor();
    });

    return this.preloadPromise;
  }

  public setCursor(type: CursorType): void {
    this.setCursorRequest(BASE_CURSOR_SOURCE, type);
  }

  public setCursorRequest(source: string, type: CursorType | null): void {
    if (this.disposed || !source) return;
    if (type) this.requests.set(source, type);
    else if (source !== BASE_CURSOR_SOURCE) this.requests.delete(source);
    this.resolveAndApply();
  }

  public resetCursor(): void {
    if (this.disposed) return;
    this.requests.clear();
    this.requests.set(BASE_CURSOR_SOURCE, "default");
    this.resolveAndApply();
  }

  public hideCursor(): void {
    if (this.disposed || !this.cursorVisible) return;
    this.cursorVisible = false;
    this.applyCursor();
  }

  public showCursor(): void {
    if (this.disposed || this.cursorVisible) return;
    this.cursorVisible = true;
    this.applyCursor();
  }

  public getCurrentCursor(): CursorType {
    return this.currentCursor;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener("pointerlockchange", this.applyCursor);
    this.root.removeAttribute("data-bosque-cursor-managed");
    this.root.removeAttribute("data-bosque-cursor-hidden");
    this.root.removeAttribute("data-bosque-cursor-type");
    this.root.style.removeProperty(CURSOR_CSS_PROPERTY);
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.preparedUrls.clear();
    this.requests.clear();
  }

  private resolveAndApply() {
    const next = resolveCursorType(this.requests.values());
    if (next === this.currentCursor) return;
    this.currentCursor = next;
    this.applyCursor();
  }

  private readonly applyCursor = () => {
    if (this.disposed) return;
    const definition = CURSORS[this.currentCursor];
    const url = this.preparedUrls.get(this.currentCursor) ?? definition.url;
    const safeUrl = url.replace(/(["\\])/g, "\\$1");
    this.root.dataset.bosqueCursorType = this.currentCursor;
    this.root.style.setProperty(
      CURSOR_CSS_PROPERTY,
      `url("${safeUrl}") ${definition.hotspotX} ${definition.hotspotY}, ${definition.fallback}`
    );

    const hidden =
      !this.cursorVisible || document.pointerLockElement === this.pointerLockTarget;
    this.root.toggleAttribute("data-bosque-cursor-hidden", hidden);
  };
}

async function prepareCursorAsset(definition: CursorDefinition): Promise<string> {
  const image = await loadImage(definition.url);
  if (isSvgUrl(definition.url)) return definition.url;
  if (
    image.naturalWidth <= definition.rasterSize &&
    image.naturalHeight <= definition.rasterSize
  ) {
    return definition.url;
  }

  const canvas = document.createElement("canvas");
  canvas.width = definition.rasterSize;
  canvas.height = definition.rasterSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D no disponible para preparar el cursor");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo reducir el cursor");
  return URL.createObjectURL(blob);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
    image.src = url;
  });
}

function isSvgUrl(url: string) {
  return new URL(url, window.location.href).pathname.toLowerCase().endsWith(".svg");
}
