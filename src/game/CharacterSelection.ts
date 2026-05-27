import "@babylonjs/loaders/glTF";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Scene } from "@babylonjs/core/scene";
import type { CharacterId } from "./PlayerController";

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

export function setupCharacterSelection(): Promise<CharacterId> {
  const overlay = document.getElementById("characterSelection");
  const startButton = document.getElementById("startCharacterButton") as HTMLButtonElement | null;
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
    startButton.addEventListener("click", () => {
      window.localStorage.setItem(CHARACTER_STORAGE_KEY, selectedCharacter);
      for (const dispose of previewDisposers) dispose();
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      resolve(selectedCharacter);
    }, { once: true });
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
        patchPreviewMaterial(mesh.material);
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

function patchPreviewMaterial(material: BabylonMaterial | null) {
  if (!material) return;

  const materials: BabylonMaterial[] = (material as any).subMaterials?.length
    ? (material as any).subMaterials
    : [material];

  for (const mat of materials) {
    if (!mat) continue;
    mat.alpha = 1;
    mat.alphaMode = BabylonMaterial.MATERIAL_OPAQUE;
    mat.transparencyMode = BabylonMaterial.MATERIAL_OPAQUE;
    mat.backFaceCulling = false;
    (mat as any).forceDepthWrite = true;
    (mat as any).needDepthPrePass = false;

    if (mat instanceof PBRMaterial) {
      mat.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
      mat.useAlphaFromAlbedoTexture = false;
      mat.metallic = Math.min(mat.metallic ?? 0, 0.15);
      mat.roughness = Math.max(mat.roughness ?? 0.65, 0.55);
      mat.environmentIntensity = Math.min(mat.environmentIntensity ?? 0.35, 0.35);
    } else if (mat instanceof StandardMaterial) {
      mat.useAlphaFromDiffuseTexture = false;
    }
  }
}
