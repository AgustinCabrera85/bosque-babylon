import "@babylonjs/loaders/glTF";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Scene } from "@babylonjs/core/scene";
import { patchCharacterMaterial } from "./CharacterPresentation";
import type { CharacterId } from "./PlayerController";
import type { InputDeviceType } from "./input/InputActions";
import type { InputManager } from "./input/InputManager";

const CHARACTER_STORAGE_KEY = "bosque.selectedCharacter";
const CHARACTER_ROOT_URL = "/assets/models/character/";
const CHARACTER_MODELS: Record<CharacterId, string> = {
  lautaro: "Lautaro_Animated.glb",
  sofia: "Sofia_Animated.glb",
};
const CHARACTER_PREVIEW_CAMERA: Record<CharacterId, {
  target: Vector3;
  radius: number;
}> = {
  lautaro: {
    target: new Vector3(0, 0.75, 0),
    radius: 1.32,
  },
  sofia: {
    target: new Vector3(0, 0.76, 0),
    radius: 1.46,
  },
};

function isCharacter(value: string | null): value is CharacterId {
  return value === "lautaro" || value === "sofia";
}

interface CharacterSelectionOptions {
  input: InputManager;
  requireInitialInput: boolean;
}

export function setupCharacterSelection({
  input,
  requireInitialInput,
}: CharacterSelectionOptions): Promise<CharacterId> {
  const overlay = document.getElementById("characterSelection");
  const startButton = document.getElementById("startCharacterButton") as HTMLButtonElement | null;
  const inputGate = document.getElementById("initialInputGate");
  const selectionShell = overlay?.querySelector<HTMLElement>(".character-selection-shell") ?? null;
  const cards = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".character-card[data-character]")
  );

  if (!overlay || !startButton || cards.length === 0) return Promise.resolve("lautaro");

  const stored = window.localStorage.getItem(CHARACTER_STORAGE_KEY);
  let selectedCharacter: CharacterId = isCharacter(stored) ? stored : "lautaro";
  const previewDisposers = cards.map((card) => {
    const character = card.dataset.character as CharacterId;
    const canvas = card.querySelector<HTMLCanvasElement>(".character-preview");
    const status = card.querySelector<HTMLElement>(".character-preview-status");
    return canvas ? mountCharacterPreview(canvas, status, character) : () => {};
  });

  const selectCharacter = (character: CharacterId) => {
    selectedCharacter = character;
    for (const card of cards) {
      const selected = card.dataset.character === character;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    }
  };

  for (const card of cards) {
    card.addEventListener("click", () => selectCharacter(card.dataset.character as CharacterId));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const nextCharacter: CharacterId = selectedCharacter === "lautaro" ? "sofia" : "lautaro";
      selectCharacter(nextCharacter);
      cards.find((item) => item.dataset.character === nextCharacter)?.focus();
    });
  }
  selectCharacter(selectedCharacter);

  return new Promise((resolve) => {
    const eventController = new AbortController();
    let animationFrame = 0;
    let previousFrameTime = performance.now();
    let inputGateActive = requireInitialInput && inputGate !== null && selectionShell !== null;
    let waitForGamepadRelease = false;
    let horizontalGamepadInputActive = false;
    let finished = false;

    const getConnectedGamepads = (): Gamepad[] => {
      if (typeof navigator.getGamepads !== "function") return [];
      return Array.from(navigator.getGamepads()).filter(
        (gamepad): gamepad is Gamepad => gamepad !== null
      );
    };

    const focusSelectedCard = () => {
      cards
        .find((card) => card.dataset.character === selectedCharacter)
        ?.focus({ preventScroll: true });
    };

    const completeInputGate = (
      device: Extract<InputDeviceType, "keyboardMouse" | "gamepad">
    ) => {
      if (!inputGateActive) return;

      inputGateActive = false;
      input.setPreferredDevice(device);
      overlay.classList.remove("awaiting-initial-input");
      inputGate?.classList.add("hidden");
      inputGate?.setAttribute("aria-hidden", "true");
      selectionShell?.removeAttribute("aria-hidden");
      if (selectionShell) selectionShell.inert = false;

      waitForGamepadRelease = device === "gamepad";
      if (device === "gamepad") focusSelectedCard();
    };

    const cleanup = () => {
      finished = true;
      eventController.abort();
      window.cancelAnimationFrame(animationFrame);
      overlay.classList.remove("awaiting-initial-input");
      inputGate?.classList.add("hidden");
      inputGate?.setAttribute("aria-hidden", "true");
      selectionShell?.removeAttribute("aria-hidden");
      if (selectionShell) selectionShell.inert = false;
    };

    const startGame = () => {
      if (finished || inputGateActive) return;

      window.localStorage.setItem(CHARACTER_STORAGE_KEY, selectedCharacter);
      cleanup();
      for (const dispose of previewDisposers) dispose();
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      resolve(selectedCharacter);
    };

    startButton.addEventListener("click", startGame, { signal: eventController.signal });

    overlay.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") return;

      if (inputGateActive) {
        completeInputGate("keyboardMouse");
        return;
      }

      input.setPreferredDevice("keyboardMouse");
    }, { signal: eventController.signal });

    window.addEventListener("keydown", (event) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;

      if (inputGateActive) {
        event.preventDefault();
        completeInputGate("keyboardMouse");
        return;
      }

      input.setPreferredDevice("keyboardMouse");
    }, { signal: eventController.signal });

    if (inputGateActive) {
      overlay.classList.add("awaiting-initial-input");
      inputGate?.classList.remove("hidden");
      inputGate?.setAttribute("aria-hidden", "false");
      selectionShell?.setAttribute("aria-hidden", "true");
      if (selectionShell) selectionShell.inert = true;
    }

    const updateMenuInput = (now: number) => {
      if (finished) return;

      const connectedGamepads = getConnectedGamepads();
      const pressedGamepadButton = connectedGamepads.some((gamepad) =>
        gamepad.buttons.some((button) => button.pressed)
      );

      if (inputGateActive) {
        if (pressedGamepadButton) completeInputGate("gamepad");
        previousFrameTime = now;
        animationFrame = window.requestAnimationFrame(updateMenuInput);
        return;
      }

      const deltaSeconds = Math.min(Math.max((now - previousFrameTime) / 1000, 0), 0.1);
      previousFrameTime = now;
      input.update(deltaSeconds);

      if (waitForGamepadRelease) {
        if (!pressedGamepadButton) waitForGamepadRelease = false;
        animationFrame = window.requestAnimationFrame(updateMenuInput);
        return;
      }

      if (input.getActiveDevice() === "gamepad") {
        const horizontalInput = input.getMovement().x;
        if (Math.abs(horizontalInput) >= 0.55 && !horizontalGamepadInputActive) {
          const selectedIndex = Math.max(
            0,
            cards.findIndex((card) => card.dataset.character === selectedCharacter)
          );
          const direction = horizontalInput > 0 ? 1 : -1;
          const nextIndex = (selectedIndex + direction + cards.length) % cards.length;
          selectedCharacter = cards[nextIndex].dataset.character as CharacterId;
          selectCharacter(selectedCharacter);
          focusSelectedCard();
          horizontalGamepadInputActive = true;
        } else if (Math.abs(horizontalInput) <= 0.25) {
          horizontalGamepadInputActive = false;
        }

        if (input.wasPressed("jump")) {
          startGame();
          return;
        }
      }

      animationFrame = window.requestAnimationFrame(updateMenuInput);
    };

    if (requireInitialInput) {
      animationFrame = window.requestAnimationFrame(updateMenuInput);
    }
  });
}

function mountCharacterPreview(
  canvas: HTMLCanvasElement,
  status: HTMLElement | null,
  character: CharacterId
) {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: false,
    premultipliedAlpha: true,
  });
  engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.ambientColor = new Color3(0.18, 0.2, 0.23);
  const portrait = CHARACTER_PREVIEW_CAMERA[character];

  const camera = new ArcRotateCamera(
    `${character}PreviewCamera`,
    Math.PI / 2,
    Math.PI / 2,
    portrait.radius,
    portrait.target,
    scene
  );
  camera.fov = 0.46;
  camera.minZ = 0.01;
  scene.activeCamera = camera;

  const fill = new HemisphericLight(`${character}PreviewFill`, new Vector3(0, 1, 0), scene);
  fill.intensity = 1.25;
  fill.diffuse = new Color3(0.76, 0.83, 0.94);
  fill.groundColor = new Color3(0.16, 0.13, 0.11);

  const key = new DirectionalLight(
    `${character}PreviewKey`,
    new Vector3(-0.45, -0.62, -0.7),
    scene
  );
  key.intensity = 1.15;
  key.diffuse = new Color3(1, 0.88, 0.69);

  let disposed = false;
  const observer = new ResizeObserver(() => engine.resize());
  observer.observe(canvas);
  engine.runRenderLoop(() => scene.render());

  void SceneLoader.ImportMeshAsync(null, CHARACTER_ROOT_URL, CHARACTER_MODELS[character], scene)
    .then((result) => {
      if (disposed) return;

      const avatarMeshes = result.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
      for (const mesh of avatarMeshes) {
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.visibility = 1;
        (mesh as any).hasVertexAlpha = false;
        (mesh as any).alphaIndex = 0;
        patchCharacterMaterial(mesh.material, character);
      }

      const idleAnimation = result.animationGroups.find((group) => /idle/i.test(group.name));
      (idleAnimation ?? result.animationGroups[0])?.start(true);
      status?.classList.add("hidden");
    })
    .catch((error) => {
      if (disposed) return;
      console.error(`No se pudo cargar la vista previa de ${character}`, error);
      if (status) status.textContent = "Vista no disponible";
    });

  return () => {
    disposed = true;
    observer.disconnect();
    engine.stopRenderLoop();
    scene.dispose();
    engine.dispose();
  };
}
