/**
 * Rina theatre audience phones — Babylon.js / TypeScript.
 *
 * - Loads ONE prepared Smartphone_RinaReady.glb asset container.
 * - Instantiates the model at supplied hand anchors.
 * - Shares ONE 128x256 (desktop) or 96x192 (mobile) low-FPS stage RTT.
 * - Uses one photo flash light, individual billboards, and unsynchronized events.
 * - Does NOT alter existing character NLA/Mixamo animations; pass onPoseWeight
 *   to the audience's existing additive arm/hand pose system.
 *
 * Source model screen marker: RinaPhone_DisplayOverlay.
 * Source model flash marker:  RinaPhone_FlashAnchor.
 */

import "@babylonjs/loaders/glTF";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { PerformanceTier } from "../../runtime/LevelTypes";
import { asset } from "../../../utils/asset";

const ROOT_URL = "assets/models/theatre/";
const MODEL_FILE = "Smartphone_RinaReady.glb";
const SCREEN_MARKER = "RinaPhone_DisplayOverlay";
const FLASH_MARKER = "RinaPhone_FlashAnchor";
const FLASH_SECONDS = 0.22;

export type PhotoPhase = "idle" | "raise" | "aim" | "shot" | "hold" | "lower";

/** One candidate is one real animated spectator's hand transform, NOT a seat proxy. */
export type TheatrePhoneHolder = {
  id: string;
  handAnchor: TransformNode;
  positionOffset?: Vector3;
  rotationOffset?: Vector3; // radians; adjust once in the Babylon debug inspector
  scale?: number;          // default 1; source phone is already ~14.4 cm tall
  /** Call your EXISTING additive Mixamo/procedural upper-body pose logic here. */
  onPoseWeight?: (weight: number, phase: PhotoPhase) => void;
};

export type TheatrePhonesOptions = {
  scene: Scene;
  performanceTier: PerformanceTier;
  holders: readonly TheatrePhoneHolder[];
  /** ALL meshes to show on phone: Rina animated skinned meshes, stage, curtain, etc. */
  stageMeshes?: readonly AbstractMesh[];
  /** Stage capture CAMERA, not game camera. Pass actual stage coordinates. */
  capturePosition?: Vector3;
  captureTarget?: Vector3;
  /** Optional instead of live RTT: one shared VideoTexture or Texture (caller-owned). */
  screenTexture?: BaseTexture;
  seed?: number;
};

export type TheatrePhonesHandle = {
  readonly count: number;
  readonly ids: readonly string[];
  readonly feed: RenderTargetTexture | null;
  /** Must be called from the theatre GameLevel.update(dt). */
  update(dtSeconds: number): void;
  /** Call again after Rina's stage meshes have finished loading. */
  setStageMeshes(meshes: readonly AbstractMesh[]): void;
  /** Pauses all spectator photo events; phones stay where they are. */
  setEnabled(enabled: boolean): void;
  /** Forces a shot for QA / debug; omit id to use the first phone. */
  triggerPhoto(id?: string): void;
  setFeedEnabled(enabled: boolean): void;
  setFeedRefreshFrames(frames: number): void;
  setFeedResolution(width: number, height: number): void;
  setCapture(position: Vector3, target: Vector3): void;
  setHolderOffset(id: string, position: Vector3, rotation: Vector3): void;
  dispose(): void;
};

type RuntimeHolder = {
  descriptor: TheatrePhoneHolder;
  wrapper: TransformNode;
  flashAnchor: TransformNode;
  flare: Mesh;
  phase: PhotoPhase;
  timeInPhase: number;
  phaseDuration: number;
  flashed: boolean;
  flashRemaining: number;
};

function createRandom(seed: number) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function createFlareTexture(scene: Scene) {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - size / 2) / (size / 2);
      const dy = (y + 0.5 - size / 2) / (size / 2);
      const radiusSq = dx * dx + dy * dy;
      const halo = Math.exp(-radiusSq * 4.8);
      const spike = Math.exp(-Math.abs(dx) * 28) * Math.exp(-Math.abs(dy) * 2.7)
        + Math.exp(-Math.abs(dy) * 28) * Math.exp(-Math.abs(dx) * 2.7);
      const alpha = Math.min(1, Math.pow(halo, 1.5) * 0.8 + spike * 0.25);
      const i = (y * size + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 251;
      pixels[i + 2] = 234;
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return RawTexture.CreateRGBATexture(
    pixels, size, size, scene, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE
  );
}

function uniqueValidMeshes(meshes: readonly AbstractMesh[]) {
  return Array.from(new Set(meshes)).filter((mesh) => !mesh.isDisposed());
}

/** Call after the theatre has created its active playable camera. */
export async function createTheatreAudiencePhones(
  options: TheatrePhonesOptions
): Promise<TheatrePhonesHandle> {
  const { scene, performanceTier, holders } = options;
  if (!holders.length) {
    return {
      count: 0,
      ids: [],
      feed: null,
      update() {},
      setStageMeshes() {},
      setEnabled() {},
      triggerPhoto() {},
      setFeedEnabled() {},
      setFeedRefreshFrames() {},
      setFeedResolution() {},
      setCapture() {},
      setHolderOffset() {},
      dispose() {},
    };
  }
  const random = createRandom(options.seed ?? 0x52494e41);
  const container: AssetContainer = await SceneLoader.LoadAssetContainerAsync(
    asset(ROOT_URL), MODEL_FILE, scene
  );
  if (scene.isDisposed) {
    container.dispose();
    throw new Error("Se cerró el teatro antes de cargar los teléfonos.");
  }

  let disposed = false;
  let enabled = true;
  let captureCamera: FreeCamera | undefined;
  let rtt: RenderTargetTexture | undefined;
  const screenMaterial = new StandardMaterial("theatrePhoneSharedDisplay", scene);
  const flareMaterial = new StandardMaterial("theatrePhoneFlashFlareMaterial", scene);
  const flareTexture = createFlareTexture(scene);
  const runtimes: RuntimeHolder[] = [];
  const wrappers: TransformNode[] = [];
  const light = new PointLight("theatrePhonePooledFlash", Vector3.Zero(), scene);
  let litPhone: RuntimeHolder | undefined;
  let flashCooldown = 0;
  let feedEnabled = true;
  let sceneDisposeObserver: Observer<Scene> | null = null;

  try {
    // Stage feedback: ONE render target for all phones, not one per fan.
    let screenSource = options.screenTexture;
    if (!screenSource) {
      captureCamera = new FreeCamera(
        "theatrePhoneStageCaptureCamera",
        options.capturePosition?.clone() ?? new Vector3(0, 0.75, -21.5),
        scene
      );
      captureCamera.setTarget(options.captureTarget?.clone() ?? new Vector3(0, 1.35, -13.0));
      captureCamera.fov = 0.78;
      captureCamera.minZ = 0.08;
      captureCamera.maxZ = 65;

      const mobile = performanceTier === "mobile";
      rtt = new RenderTargetTexture(
        "theatrePhoneSharedStageFeed",
        { width: mobile ? 96 : 128, height: mobile ? 192 : 256 },
        scene,
        false,
        false
      );
      rtt.activeCamera = captureCamera;
      // Brighten only the texture on the tiny displays, never the stage itself.
      rtt.level = 2.4;
      rtt.renderList = uniqueValidMeshes(options.stageMeshes ?? []);
      rtt.refreshRate = mobile ? 15 : 8; // At 60 FPS: ~4 / ~7.5 captures per second.
      rtt.renderParticles = false;
      rtt.renderSprites = false;
      rtt.clearColor = new Color4(0.004, 0.001, 0.005, 1);
      scene.customRenderTargets.push(rtt);
      screenSource = rtt;
      if (!rtt.renderList?.length) {
        console.warn("[RinaPhones] Stage feed sin meshes. Llamar setStageMeshes() luego de cargar a Rina.");
      }
    }

    // The patched GLB has a dedicated UV 0..1 display plane. No UV repacking.
    screenMaterial.diffuseColor = Color3.White();
    screenMaterial.specularColor = Color3.Black();
    screenMaterial.emissiveColor = Color3.Black();
    screenMaterial.disableLighting = true;
    screenMaterial.fogEnabled = false;
    screenMaterial.emissiveTexture = screenSource;
    screenMaterial.backFaceCulling = false;

    // Additive circular flash textured once and shared by all billboards.
    flareMaterial.diffuseColor = Color3.Black();
    flareMaterial.emissiveColor = new Color3(3.2, 3.0, 2.65);
    flareMaterial.emissiveTexture = flareTexture;
    flareMaterial.opacityTexture = flareTexture;
    flareMaterial.disableLighting = true;
    flareMaterial.backFaceCulling = false;
    flareMaterial.disableDepthWrite = true;
    // The lens is on the stage side of the phone. Crowd and phone materials
    // otherwise cut the flare in half when viewed from behind the spectator.
    flareMaterial.depthFunction = Constants.ALWAYS;
    flareMaterial.alphaMode = Constants.ALPHA_ADD;
    flareMaterial.fogEnabled = false;

    light.diffuse = new Color3(1, 0.95, 0.85);
    light.specular = Color3.Black();
    light.intensity = 0;
    light.range = 4.5;
    light.shadowEnabled = false;

    const overlaySource = container.meshes.find((mesh) => mesh.name.includes(SCREEN_MARKER));
    if (!overlaySource) {
      throw new Error(`Smartphone_RinaReady.glb no contiene ${SCREEN_MARKER}`);
    }
    overlaySource.material = screenMaterial;

    for (let i = 0; i < holders.length; i++) {
      const desc = holders[i];
      const wrapper = new TransformNode(`theatrePhone_${desc.id}`, scene);
      wrapper.parent = desc.handAnchor;
      wrapper.position.copyFrom(desc.positionOffset ?? Vector3.Zero());
      if (desc.rotationOffset) wrapper.rotation.copyFrom(desc.rotationOffset);
      wrapper.scaling.setAll(desc.scale ?? 1);
      wrappers.push(wrapper);
      const inst = container.instantiateModelsToScene(
        (sourceName) => `${wrapper.name}_${sourceName}`, false
      );
      for (const rootNode of inst.rootNodes) rootNode.parent = wrapper;
      for (const mesh of wrapper.getChildMeshes()) {
        mesh.isPickable = false;
        mesh.receiveShadows = false;
      }
      const flashAnchor = wrapper.getDescendants(false).find((node) =>
        node instanceof TransformNode && node.name.includes(FLASH_MARKER)
      );
      if (!(flashAnchor instanceof TransformNode)) {
        throw new Error(`No se encontró ${FLASH_MARKER} en la copia ${desc.id}`);
      }

      const flare = MeshBuilder.CreatePlane(`theatrePhoneFlare_${desc.id}`, { size: 0.28 }, scene);
      // Do not parent this world-sized quad under the GLB! Its Body node has
      // a non-uniform ~0.012 scale, which would shrink the flare to a speck.
      // Instead we track the marker world position while the flash is active.
      flare.billboardMode = Mesh.BILLBOARDMODE_ALL;
      flare.renderingGroupId = 2;
      flare.material = flareMaterial;
      flare.isPickable = false;
      flare.setEnabled(false);

      const runtime: RuntimeHolder = {
        descriptor: desc,
        wrapper,
        flashAnchor,
        flare,
        phase: "idle",
        timeInPhase: 0,
        phaseDuration: 0.6 + random() * 14, // stagger first poses
        flashed: false,
        flashRemaining: 0,
      };
      runtimes.push(runtime);
      wrapper.setEnabled(false);
    }

    const setPhase = (phone: RuntimeHolder, phase: PhotoPhase, duration: number) => {
      phone.phase = phase;
      phone.timeInPhase = 0;
      phone.phaseDuration = duration;
      phone.flashed = false;
    };

    const flash = (phone: RuntimeHolder) => {
      if (litPhone && litPhone !== phone) {
        litPhone.flashRemaining = 0;
        litPhone.flare.setEnabled(false);
      }
      phone.flashRemaining = FLASH_SECONDS;
      flashCooldown = 0.35;
      phone.flare.position.copyFrom(phone.flashAnchor.getAbsolutePosition());
      phone.flare.setEnabled(true);
      // PointLight is pooled. If two devices shoot together, BOTH show emissive
      // flares, but there is still only one light affecting the whole scene.
      if (!litPhone || litPhone.flashRemaining <= 0) {
        litPhone = phone;
      }
    };

    const update = (dtSeconds: number) => {
      if (disposed || !enabled) return;
      const dt = Math.max(0, Math.min(0.1, dtSeconds));
      flashCooldown = Math.max(0, flashCooldown - dt);
      for (const phone of runtimes) {
        phone.timeInPhase += dt;
        if (phone.phase === "shot" && !phone.flashed) {
          if (flashCooldown > 0) phone.timeInPhase = 0;
          else {
            phone.flashed = true;
            flash(phone);
          }
        }
        if (phone.timeInPhase >= phone.phaseDuration) {
          switch (phone.phase) {
            case "idle": setPhase(phone, "raise", 0.95 + random() * 0.20); break;
            case "raise": setPhase(phone, "aim", 1.65 + random() * 0.45); break;
            case "aim": setPhase(phone, "shot", FLASH_SECONDS); break;
            case "shot": setPhase(phone, "hold", 0.65 + random() * 0.25); break;
            case "hold": setPhase(phone, "lower", 0.95 + random() * 0.20); break;
            case "lower": setPhase(phone, "idle", 7 + random() * 17); break;
          }
        }
        phone.wrapper.setEnabled(phone.phase !== "idle");
        const t = Math.min(1, phone.timeInPhase / Math.max(phone.phaseDuration, 0.0001));
        const weight = phone.phase === "raise" ? t * t * (3 - 2 * t)
          : phone.phase === "lower" ? 1 - t * t * (3 - 2 * t)
          : phone.phase === "idle" ? 0 : 1;
        phone.descriptor.onPoseWeight?.(weight, phone.phase);

        if (phone.flashRemaining > 0) {
          phone.flashRemaining = Math.max(0, phone.flashRemaining - dt);
          phone.flare.position.copyFrom(phone.flashAnchor.getAbsolutePosition());
          // Flaring quickly up and fading down. No per-flash mesh allocations.
          const strength = phone.flashRemaining / FLASH_SECONDS;
          phone.flare.scaling.setAll(0.85 + 0.55 * strength);
          if (phone.flashRemaining <= 0) phone.flare.setEnabled(false);
        }
      }

      if (litPhone && litPhone.flashRemaining > 0) {
        light.position.copyFrom(litPhone.flashAnchor.getAbsolutePosition());
        const strength = litPhone.flashRemaining / FLASH_SECONDS;
        light.intensity = (performanceTier === "mobile" ? 8 : 30) *
          Math.sqrt(strength);
      } else {
        light.intensity = 0;
        litPhone = undefined;
      }
    };

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (sceneDisposeObserver) {
        scene.onDisposeObservable.remove(sceneDisposeObserver);
        sceneDisposeObserver = null;
      }
      enabled = false;
      light.intensity = 0;
      // Release procedural rig weights while anchors and character are alive.
      for (const p of runtimes) p.descriptor.onPoseWeight?.(0, "idle");
      for (const phone of runtimes) phone.flare.dispose(false, false);
      for (const wrapper of wrappers) wrapper.dispose(false, false);
      if (rtt) {
        const targetIdx = scene.customRenderTargets.indexOf(rtt);
        if (targetIdx >= 0) scene.customRenderTargets.splice(targetIdx, 1);
        rtt.dispose();
      }
      captureCamera?.dispose();
      light.dispose();
      screenMaterial.dispose(false, false);
      flareMaterial.dispose(false, false);
      flareTexture.dispose();
      container.dispose();
    };
    // Never store global observers on the main game scene.
    sceneDisposeObserver = scene.onDisposeObservable.addOnce(dispose);

    return {
      count: runtimes.length,
      ids: runtimes.map(phone => phone.descriptor.id),
      get feed() { return rtt ?? null; },
      update,
      setStageMeshes(meshes) {
        if (rtt && !disposed) rtt.renderList = uniqueValidMeshes(meshes);
      },
      triggerPhoto(id) {
        if (disposed || !enabled) return;
        const candidate = id ? runtimes.find((item) => item.descriptor.id === id) : runtimes[0];
        if (!candidate) return;
        setPhase(candidate, "raise", 0.95 + random() * 0.20);
        candidate.wrapper.setEnabled(true);
        candidate.descriptor.onPoseWeight?.(0, "raise");
      },
      setFeedEnabled(value) {
        if (!rtt || disposed || feedEnabled === value) return;
        feedEnabled = value;
        const index = scene.customRenderTargets.indexOf(rtt);
        if (value && index < 0) scene.customRenderTargets.push(rtt);
        if (!value && index >= 0) scene.customRenderTargets.splice(index, 1);
      },
      setFeedRefreshFrames(frames) {
        if (rtt && !disposed) rtt.refreshRate = Math.max(1, Math.round(frames));
      },
      setFeedResolution(width, height) {
        if (rtt && !disposed) rtt.resize({ width: Math.max(32, Math.round(width)),
          height: Math.max(32, Math.round(height)) });
      },
      setCapture(position, target) {
        if (!captureCamera || disposed) return;
        captureCamera.position.copyFrom(position);
        captureCamera.setTarget(target);
      },
      setHolderOffset(id, position, rotation) {
        const phone = runtimes.find(item => item.descriptor.id === id);
        if (!phone || disposed) return;
        phone.wrapper.position.copyFrom(position);
        phone.wrapper.rotation.copyFrom(rotation);
      },
      setEnabled(value) {
        enabled = value;
        if (!value) {
          for (const p of runtimes) p.descriptor.onPoseWeight?.(0, "idle");
          for (const p of runtimes) p.wrapper.setEnabled(false);
          light.intensity = 0;
          litPhone = undefined;
          for (const p of runtimes) {
            p.flashRemaining = 0;
            p.flare.setEnabled(false);
          }
        }
      },
      dispose,
    };
  } catch (error) {
    // If loading a spectator copy fails, don't leave half the theatre initialized.
    for (const phone of runtimes) phone.flare.dispose(false, false);
    for (const wrapper of wrappers) wrapper.dispose(false, false);
    if (rtt) {
      const targetIdx = scene.customRenderTargets.indexOf(rtt);
      if (targetIdx >= 0) scene.customRenderTargets.splice(targetIdx, 1);
      rtt.dispose();
    }
    captureCamera?.dispose();
    light.dispose();
    screenMaterial.dispose(false, false);
    flareMaterial.dispose(false, false);
    flareTexture.dispose();
    container.dispose();
    throw error;
  }
}
