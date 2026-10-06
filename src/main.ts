import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
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
import { setupLevelTransitionOverlay } from "./game/runtime/LevelTransitionOverlay";
import { setupInputPrompts } from "./game/input/InputPrompts";
import { setupGamepadFeedback } from "./game/input/GamepadFeedback";
import { CursorController } from "./game/input/CursorController";
import {
  CHARACTER_SELECTION_RETURN_EVENT,
  CHECKPOINT_RESTART_EVENT,
  type CheckpointRestartRequest,
} from "./game/runtime/CheckpointRestart";

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

async function calibrateAutomaticHardwareScaling(
  scene: Scene,
  currentScaling: number
) {
  if (document.visibilityState !== "visible") return currentScaling;

  // Calibrate behind the loading screen after all forest states were warmed.
  // This prevents later resolution changes from reallocating framebuffers in
  // front of the player and ignores isolated compilation/GC spikes by using
  // the median of several complete display intervals.
  const samples: number[] = [];
  scene.render();
  let previousFrameStart = performance.now();
  for (let frame = 0; frame < 13; frame++) {
    await nextFrame();
    const frameStart = performance.now();
    if (frame >= 3) samples.push(frameStart - previousFrameStart);
    scene.render();
    previousFrameStart = frameStart;
  }

  const sorted = samples.sort((a, b) => a - b);
  const medianFrameMs = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const calibratedScaling = medianFrameMs >= 30
    ? 2
    : medianFrameMs >= 22
      ? 1.67
      : medianFrameMs >= 18.5
        ? 1.43
        : currentScaling;
  const nextScaling = Math.max(currentScaling, calibratedScaling);
  if (nextScaling <= currentScaling + 0.01) return currentScaling;

  engine.setHardwareScalingLevel(nextScaling);
  engine.resize();
  // Absorb framebuffer allocation and the first resized frames while the
  // loading cover is still opaque.
  for (let frame = 0; frame < 3; frame++) {
    scene.render();
    await nextFrame();
  }
  return nextScaling;
}

const performanceTier: PerformanceTier = shouldUseMobileQuality() ? "mobile" : "desktop";
let automaticHardwareScaling = performanceTier === "mobile"
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
  const debugAxePickupMode =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("debugAxePickup") === "1";
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
  const selectedCharacter = debugAxePickupMode
    ? "lautaro"
    : await setupCharacterSelection({
        input,
        requireInitialInput: !isTouchFirstDevice(),
      });
  if (debugAxePickupMode) {
    const selection = document.getElementById("characterSelection");
    selection?.classList.add("hidden");
    selection?.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("character-selecting");
  showLoading();
  const inputPrompts = setupInputPrompts(input);
  const pauseMenu = setupPauseMenu({
    canvas: renderCanvas,
    engine,
    getAutomaticHardwareScaling: () => automaticHardwareScaling,
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
  const levelTransitionOverlay = setupLevelTransitionOverlay();

  const registry = new LevelRegistry().register("forest", async () => {
    const module = await import("./game/levels/forest/createForestLevel");
    return module.createForestLevel;
  }).register("theatre", async () => {
    const module = await import("./game/levels/theatre/createTheatreLevel");
    return module.createTheatreLevel;
  });
  let activeDebug: { dispose(): void } | null = null;
  let portalTransitionPending = false;
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
    onLevelTransitionRequested: async ({ entryPoint, load }) => {
      if (entryPoint !== "forest-exit-portal") {
        await load();
        return;
      }
      if (portalTransitionPending) return;
      portalTransitionPending = true;
      pauseMenu.setPaused(false);
      inventory.close();
      itemInspector.close();
      hideLoading();

      try {
        await levelTransitionOverlay.cover();
        const minimumWhiteHold = wait(2000);
        const loaded = await load();
        await new Promise<void>((resolve) => {
          loaded.scene.onAfterRenderObservable.addOnce(() => resolve());
        });

        // Future narrative beat: reproduce transition audio and reveal its
        // text here while the frame remains completely white.
        // Loading happens behind the white frame; reveal only after both the
        // next scene is ready and the two-second narrative window has elapsed.
        await minimumWhiteHold;
      } catch (error) {
        showLoading();
        setLoading(1, "No se pudo cambiar de nivel");
        throw error;
      } finally {
        try {
          await levelTransitionOverlay.reveal();
        } finally {
          portalTransitionPending = false;
        }
      }
    },
    onTransitionError: (error) => {
      console.error("No se pudo cambiar de nivel", error);
      setLoading(1, "No se pudo cambiar de nivel");
    },
  });
  let checkpointRestartPending = false;
  const onCheckpointRestartRequested = (event: Event) => {
    if (checkpointRestartPending) return;
    const request = (event as CustomEvent<CheckpointRestartRequest>).detail;
    if (!request || (request.level !== "forest" && request.level !== "theatre")) {
      return;
    }

    checkpointRestartPending = true;
    pauseMenu.setPaused(false);
    inventory.close();
    itemInspector.close();
    showLoading();
    setLoading(0.02, "Regresando al último recuerdo...");
    void (async () => {
      let restarted = false;
      try {
        const loaded = await levelManager.loadLevel(
          request.level,
          request.entryPoint
        );
        await new Promise<void>((resolve) => {
          loaded.scene.onAfterRenderObservable.addOnce(() => resolve());
        });
        restarted = true;
      } catch (error) {
        console.error("No se pudo volver al checkpoint", error);
        setLoading(1, "No se pudo volver al checkpoint");
      } finally {
        checkpointRestartPending = false;
        if (restarted) hideLoading();
      }
    })();
  };
  window.addEventListener(
    CHECKPOINT_RESTART_EVENT,
    onCheckpointRestartRequested
  );
  const onCharacterSelectionReturnRequested = () => {
    pauseMenu.setPaused(false);
    inventory.close();
    itemInspector.close();
    // A clean navigation reconstructs the one-shot selection flow and drops
    // development query modes that could otherwise bypass it.
    window.location.replace(window.location.pathname);
  };
  window.addEventListener(
    CHARACTER_SELECTION_RETURN_EVENT,
    onCharacterSelectionReturnRequested
  );

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
  if (
    initialLevelId === "forest" &&
    performanceTier === "desktop" &&
    readStoredResolutionMode() === "auto"
  ) {
    setLoading(0.99, "Ajustando rendimiento...");
    automaticHardwareScaling = await calibrateAutomaticHardwareScaling(
      scene,
      automaticHardwareScaling
    );
  }
  window.addEventListener("pagehide", () => {
    window.removeEventListener(
      CHECKPOINT_RESTART_EVENT,
      onCheckpointRestartRequested
    );
    window.removeEventListener(
      CHARACTER_SELECTION_RETURN_EVENT,
      onCharacterSelectionReturnRequested
    );
    levelManager.dispose();
    levelTransitionOverlay.dispose();
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
    const levelTransitionActive = levelTransitionOverlay.isActive;
    const modalWasOpen =
      pauseMenu.isPaused() || itemInspector.isOpen() || inventory.isOpen();

    let modalActionHandled = false;
    if (!levelTransitionActive && input.wasPressed("cancel")) {
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
    if (
      !levelTransitionActive &&
      !modalActionHandled &&
      input.wasPressed("pause")
    ) {
      if (inventory.isOpen()) inventory.close();
      if (!itemInspector.isOpen()) pauseMenu.toggle();
      modalActionHandled = true;
    }
    if (
      !modalActionHandled &&
      !levelTransitionActive &&
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
      levelTransitionActive ||
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
      levelTransitionActive ||
      document.body.classList.contains("house-arrival-cinematic-active") ||
      document.body.classList.contains("character-selecting");
    cursorController.setCursorRequest("ui", menuCursorActive ? "menu" : null);
    gamepadFeedback.update(
      deltaSeconds,
      !gameplayBlocked &&
        !cinematicActive &&
        !loadingActive &&
        !levelTransitionActive
    );

    if (levelTransitionActive) {
      // Once loading finishes, draw the next scene behind the opaque white
      // frame so its first visible frame is already complete.
      levelManager.render();
      return;
    }
    if (gameplayBlocked) return;
    levelManager.update(deltaSeconds);
    levelManager.render();
  });

  await firstFrameReady;
  if (debugAxePickupMode) {
    await initialLevel.playOpeningSequence?.();
    hideLoading();
    const debug = (
      globalThis as typeof globalThis & {
        __bosqueHermanoMayorDebug?: {
          setAxeDebugVisible(visible: boolean): void;
          forceAxePickup(): boolean;
        };
      }
    ).__bosqueHermanoMayorDebug;
    debug?.setAxeDebugVisible(true);
    debug?.forceAxePickup();
  } else if (initialLevel.playOpeningSequence) {
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
