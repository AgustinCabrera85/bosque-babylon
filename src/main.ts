import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { setupMusicPlayer } from "./game/MusicPlayer";
import { setupPauseMenu } from "./game/PauseMenu";
import { readStoredResolutionMode, resolveHardwareScalingLevel } from "./game/PauseVideo";
import { setupItemInspector } from "./game/ItemInspector";
import { setupInventory } from "./game/Inventory";
import { setupCharacterSelection } from "./game/CharacterSelection";
import { InputManager } from "./game/input/InputManager";
import { LevelManager } from "./game/runtime/LevelManager";
import { LevelRegistry } from "./game/runtime/LevelRegistry";
import type { LevelId, PerformanceTier } from "./game/runtime/LevelTypes";
import { GameSession } from "./game/runtime/GameSession";
import { setupInputPrompts } from "./game/input/InputPrompts";
import { setupGamepadFeedback } from "./game/input/GamepadFeedback";
import { CursorController } from "./game/input/CursorController";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
if (!canvas) throw new Error("No se encontro #renderCanvas");
const renderCanvas = canvas;

const loadingScreen = document.getElementById("loadingScreen");
const loadingText = document.getElementById("loadingText");
const loadingBar = document.getElementById("loadingBar");
const openingSequence = document.getElementById("openingSequence");
const openingQuote = document.getElementById("openingQuote");

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function setLoading(value: number, text: string) {
  if (loadingText) loadingText.textContent = text;
  if (loadingBar) loadingBar.style.width = `${Math.round(value * 100)}%`;
}

function hideLoading() {
  if (!loadingScreen) return;
  loadingScreen.classList.add("hidden");
  loadingScreen.setAttribute("aria-hidden", "true");
}

function showLoading() {
  if (!loadingScreen) return;
  loadingScreen.classList.remove("hidden");
  loadingScreen.setAttribute("aria-hidden", "false");
}

function armDesktopControlFromStartGesture() {
  const startButton = document.getElementById("startCharacterButton");
  startButton?.addEventListener(
    "click",
    () => {
      if (!window.matchMedia("(pointer: fine)").matches) return;
      renderCanvas.requestPointerLock?.().catch(() => {
        // Some browsers refuse locking an obscured canvas. The normal canvas
        // click remains available after the cinematic in that case.
      });
    },
    { once: true }
  );
}

async function playOpeningPresentation(startCinematic: () => Promise<void>) {
  document.body.classList.add("opening-sequence-active");
  openingSequence?.classList.remove("hidden", "active", "revealing");
  openingSequence?.setAttribute("aria-hidden", "false");
  openingQuote?.classList.remove("visible");

  await nextFrame();
  openingSequence?.classList.add("active");
  await wait(720);
  hideLoading();

  openingQuote?.classList.add("visible");
  await wait(3400);
  openingQuote?.classList.remove("visible");
  await wait(1050);

  const cinematicFinished = startCinematic();
  await nextFrame();
  openingSequence?.classList.add("revealing");

  try {
    await Promise.all([cinematicFinished, wait(1950)]);
  } finally {
    openingSequence?.classList.add("hidden");
    openingSequence?.classList.remove("active", "revealing");
    openingSequence?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("opening-sequence-active");
  }
}

function isTouchFirstDevice() {
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

function shouldUseMobileQuality() {
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 760;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return isTouchFirstDevice() || smallScreen || memory <= 4;
}

const performanceTier: PerformanceTier = shouldUseMobileQuality() ? "mobile" : "desktop";
const automaticHardwareScaling = performanceTier === "mobile"
  ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4 ? 2.25 : 1.8
  // 80% per axis retains the vintage image while cutting full-screen work by 36%.
  : 1.25;
const hardwareScaling = resolveHardwareScalingLevel(
  readStoredResolutionMode(),
  automaticHardwareScaling
);

const engine = new Engine(renderCanvas, performanceTier === "desktop", {
  preserveDrawingBuffer: false,
  stencil: false,
  antialias: performanceTier === "desktop",
});
engine.setHardwareScalingLevel(hardwareScaling);

async function start() {
  let debugBootstrap: typeof import("./debug/DebugBootstrap") | null = null;
  if (import.meta.env.DEV) {
    debugBootstrap = await import("./debug/DebugBootstrap");
    if (
      await debugBootstrap.tryStartStandaloneDebugMode({
        engine,
        canvas: renderCanvas,
      })
    ) {
      return;
    }
  }

  const input = new InputManager(renderCanvas);
  const cursorController = new CursorController(renderCanvas);
  cursorController.setCursorRequest("ui", "menu");
  await cursorController.preload();
  const unsubscribeCursorDevice = input.onActiveDeviceChanged((device) => {
    if (device === "keyboardMouse") cursorController.showCursor();
    else cursorController.hideCursor();
  });

  armDesktopControlFromStartGesture();
  const musicPlayer = setupMusicPlayer();
  const selectedCharacter = await setupCharacterSelection({
    input,
    requireInitialInput: !isTouchFirstDevice(),
  });
  document.body.classList.remove("character-selecting");
  showLoading();
  const inputPrompts = setupInputPrompts(input);
  const pauseMenu = setupPauseMenu({
    canvas: renderCanvas,
    engine,
    automaticHardwareScaling,
    input,
  });
  const itemInspector = setupItemInspector({ input });
  const inventory = setupInventory({ input, inspectItem: itemInspector.inspect });
  const session = new GameSession({
    selectedCharacter,
    inventory,
    musicPlayer,
    debugPlayerStats:
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get("debugSurvival") === "1",
  });
  const gamepadFeedback = setupGamepadFeedback({
    input,
    playerStats: session.playerStats,
  });

  const registry = new LevelRegistry().register("forest", async () => {
    const module = await import("./game/levels/forest/createForestLevel");
    return module.createForestLevel;
  }).register("theatre", async () => {
    const module = await import("./game/levels/theatre/createTheatreLevel");
    return module.createTheatreLevel;
  });
  let activeDebug: { dispose(): void } | null = null;
  const levelManager = new LevelManager({
    registry,
    context: {
      engine,
      canvas: renderCanvas,
      input,
      cursorController,
      selectedCharacter: session.selectedCharacter,
      inventory: session.inventory,
      playerStats: session.playerStats,
      musicPlayer: session.musicPlayer,
      performanceTier,
      onProgress: setLoading,
    },
    input,
    playerStats: session.playerStats,
    musicPlayer: session.musicPlayer,
    onActiveSceneChanged: (scene) => {
      if (!scene) cursorController.setCursorRequest("interaction", null);
      activeDebug?.dispose();
      activeDebug = scene ? debugBootstrap?.bootstrapDebug(scene) ?? null : null;
    },
    onTransitionError: (error) => {
      console.error("No se pudo cambiar de nivel", error);
      setLoading(1, "No se pudo cambiar de nivel");
    },
  });

  const requestedLevel = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("level")
    : null;
  const initialLevelId: LevelId = requestedLevel === "theatre" ? "theatre" : "forest";
  if (import.meta.env.DEV) {
    const debugWindow = window as Window & {
      __bosqueLevelDebug?: {
        load(level: LevelId, entryPoint?: string): Promise<void>;
        current(): LevelId | null;
        snapshot(): {
          current: LevelId | null;
          transitioning: boolean;
          liveScenes: number;
          thoughtMessageRoots: number;
          playerStatusHuds: number;
        };
      };
    };
    debugWindow.__bosqueLevelDebug = {
      async load(level, entryPoint = "dev") {
        pauseMenu.setPaused(false);
        inventory.close();
        itemInspector.close();
        showLoading();
        setLoading(0.02, `Cargando ${level}...`);
        try {
          const loaded = await levelManager.loadLevel(level, entryPoint);
          await new Promise<void>((resolve) => {
            loaded.scene.onAfterRenderObservable.addOnce(() => resolve());
          });
        } finally {
          hideLoading();
        }
      },
      current: () => levelManager.currentLevelId,
      snapshot: () => ({
        current: levelManager.currentLevelId,
        transitioning: levelManager.isTransitioning,
        liveScenes: engine.scenes.filter((scene) => !scene.isDisposed).length,
        thoughtMessageRoots: document.querySelectorAll("#thoughtMessages").length,
        playerStatusHuds: document.querySelectorAll("#playerStatusHud").length,
      }),
    };
  }

  setLoading(0.02, `Iniciando motor (${performanceTier})...`);
  const initialLevel = await levelManager.loadLevel(
    initialLevelId,
    initialLevelId === "forest" ? "initial" : "dev"
  );
  const scene = initialLevel.scene;
  window.addEventListener("pagehide", () => {
    levelManager.dispose();
    gamepadFeedback.dispose();
    unsubscribeCursorDevice();
    cursorController.dispose();
    input.dispose();
    inputPrompts.dispose();
    pauseMenu.dispose();
    session.dispose();
    musicPlayer?.dispose();
    inventory.dispose();
    itemInspector.dispose();
  }, { once: true });

  const firstFrameReady = new Promise<void>((resolve) => {
    scene.onAfterRenderObservable.addOnce(() => resolve());
  });
  engine.runRenderLoop(() => {
    const deltaSeconds = engine.getDeltaTime() / 1000;
    input.update(deltaSeconds);
    const modalWasOpen =
      pauseMenu.isPaused() || itemInspector.isOpen() || inventory.isOpen();

    let modalActionHandled = false;
    if (input.wasPressed("cancel")) {
      if (itemInspector.isOpen()) {
        itemInspector.close();
        modalActionHandled = true;
      } else if (inventory.isOpen()) {
        inventory.close();
        modalActionHandled = true;
      } else if (pauseMenu.isPaused()) {
        pauseMenu.toggle();
        modalActionHandled = true;
      }
    }
    if (!modalActionHandled && input.wasPressed("pause")) {
      if (inventory.isOpen()) inventory.close();
      if (!itemInspector.isOpen()) pauseMenu.toggle();
      modalActionHandled = true;
    }
    if (
      !modalActionHandled &&
      input.wasPressed("inventory") &&
      !pauseMenu.isPaused() &&
      !itemInspector.isOpen()
    ) {
      inventory.toggle();
    }

    pauseMenu.update();
    inventory.update();
    itemInspector.update(deltaSeconds);

    const gameplayBlocked =
      modalWasOpen ||
      pauseMenu.isPaused() ||
      itemInspector.isOpen() ||
      inventory.isOpen();
    const cinematicActive =
      document.body.classList.contains("opening-sequence-active") ||
      document.body.classList.contains("sky-eye-cinematic-active");
    const loadingActive = loadingScreen
      ? !loadingScreen.classList.contains("hidden")
      : false;
    const menuCursorActive =
      pauseMenu.isPaused() ||
      itemInspector.isOpen() ||
      inventory.isOpen() ||
      cinematicActive ||
      loadingActive ||
      document.body.classList.contains("house-arrival-cinematic-active") ||
      document.body.classList.contains("character-selecting");
    cursorController.setCursorRequest("ui", menuCursorActive ? "menu" : null);
    gamepadFeedback.update(
      deltaSeconds,
      !gameplayBlocked && !cinematicActive && !loadingActive
    );

    if (gameplayBlocked) return;
    levelManager.update(deltaSeconds);
    levelManager.render();
  });

  await firstFrameReady;
  if (initialLevel.playOpeningSequence) {
    await playOpeningPresentation(initialLevel.playOpeningSequence);
  } else {
    hideLoading();
  }
}

start().catch((error) => {
  console.error("No se pudo iniciar la escena", error);
  setLoading(1, "No se pudo iniciar la escena");
});

window.addEventListener("resize", () => engine.resize());
