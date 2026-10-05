import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BlackSmokeWrapSystem } from "./BlackSmokeWrapSystem";
import { DEFAULT_SHADOW_GRABBER_CONFIG } from "./enemies/shadowGrabber/ShadowGrabberConfig";
import { ShadowGrabberFxController } from "./enemies/shadowGrabber/ShadowGrabberFxController";
import type { PlayerController } from "./PlayerController";

// The shared procedural controller renders beyond its proxy bounds. This is
// exactly twice the previous calibrated size, per the death-sequence framing.
const PLAYER_DEATH_PORTAL_PROXY_DIAMETER = 2.32;
const PLAYER_SOUL_RELEASE_SECONDS = 2.8;
const DEATH_FINAL_POSE_SETTLE_SECONDS = 0.08;

export const PLAYER_DEATH_SEQUENCE_TIMING = {
  portalOpenSeconds: 1.2,
  sinkStartSeconds: 0.62,
  sinkDurationSeconds: 1.7,
  fadeStartSeconds: 1.2,
  messageStartSeconds: 2.6,
  messageExtinguishSeconds: 4.35,
  completeSeconds: 5.45,
} as const;

export type PlayerDeathSequenceFrame = {
  portalProgress: number;
  sinkProgress: number;
  fadeToBlack: boolean;
  showMessage: boolean;
  extinguishMessage: boolean;
  complete: boolean;
};

export type PlayerSoulLightFrame = {
  riseProgress: number;
  opacity: number;
};

type PlayerDeathSequenceOptions = {
  player: PlayerController;
  smokeSystem: BlackSmokeWrapSystem;
  portalQuality: "low" | "high";
  onStart?: () => void;
  onChoice?: (choice: PlayerDeathChoice) => void;
};

export type PlayerDeathChoice = "checkpoint" | "character-selection";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
}

/** Pure timing sampler kept independent from Babylon observers for reuse and tests. */
export function samplePlayerDeathSequence(
  portalElapsedSeconds: number
): PlayerDeathSequenceFrame {
  const elapsed = Math.max(0, portalElapsedSeconds);
  return {
    portalProgress: smoothstep01(
      elapsed / PLAYER_DEATH_SEQUENCE_TIMING.portalOpenSeconds
    ),
    sinkProgress: smoothstep01(
      (elapsed - PLAYER_DEATH_SEQUENCE_TIMING.sinkStartSeconds) /
        PLAYER_DEATH_SEQUENCE_TIMING.sinkDurationSeconds
    ),
    fadeToBlack: elapsed >= PLAYER_DEATH_SEQUENCE_TIMING.fadeStartSeconds,
    showMessage: elapsed >= PLAYER_DEATH_SEQUENCE_TIMING.messageStartSeconds,
    extinguishMessage:
      elapsed >= PLAYER_DEATH_SEQUENCE_TIMING.messageExtinguishSeconds,
    complete: elapsed >= PLAYER_DEATH_SEQUENCE_TIMING.completeSeconds,
  };
}

/** Pure sampler for the light that separates from the body and escapes. */
export function samplePlayerSoulLight(
  elapsedSeconds: number
): PlayerSoulLightFrame {
  const elapsed = Math.max(0, elapsedSeconds);
  // First gather as a glow inside the torso, then detach and accelerate away.
  const riseProgress = smoothstep01(
    (elapsed - 0.32) / (PLAYER_SOUL_RELEASE_SECONDS - 0.32)
  );
  const fadeIn = smoothstep01(elapsed / 0.28);
  const fadeOut = 1 - smoothstep01((elapsed - 2.05) / 0.75);
  return {
    riseProgress,
    opacity: fadeIn * fadeOut,
  };
}

class PlayerSoulLightEffect {
  private readonly root: TransformNode;
  private readonly core: Mesh;
  private readonly halo: Mesh;
  private readonly wisps: Mesh[];
  private readonly motes: Mesh[];
  private readonly coreMaterial: StandardMaterial;
  private readonly haloMaterial: StandardMaterial;
  private readonly wispMaterial: StandardMaterial;
  private readonly light: PointLight;
  private readonly origin = Vector3.Zero();

  constructor(scene: Scene) {
    this.root = new TransformNode("playerDeathSoulLight", scene);

    this.coreMaterial = this.createMaterial(
      "playerDeathSoulCoreMaterial",
      new Color3(0.72, 0.91, 1),
      1
    );
    this.haloMaterial = this.createMaterial(
      "playerDeathSoulHaloMaterial",
      new Color3(0.24, 0.62, 1),
      0
    );
    this.wispMaterial = this.createMaterial(
      "playerDeathSoulWispMaterial",
      new Color3(0.28, 0.62, 1),
      0
    );

    this.core = MeshBuilder.CreateSphere(
      "playerDeathSoulCore",
      { diameter: 0.16, segments: 16 },
      scene
    );
    this.core.parent = this.root;
    this.core.material = this.coreMaterial;

    this.halo = MeshBuilder.CreateSphere(
      "playerDeathSoulHalo",
      { diameter: 0.52, segments: 16 },
      scene
    );
    this.halo.parent = this.root;
    this.halo.material = this.haloMaterial;

    // Overlapping ellipsoids form a soft, broken tail without the rigid cone
    // silhouette of the first pass.
    this.wisps = Array.from({ length: 4 }, (_, index) => {
      const wisp = MeshBuilder.CreateSphere(
        `playerDeathSoulWisp:${index}`,
        { diameter: 0.14 + index * 0.018, segments: 12 },
        scene
      );
      wisp.parent = this.root;
      wisp.material = this.wispMaterial;
      return wisp;
    });

    this.motes = Array.from({ length: 6 }, (_, index) => {
      const mote = MeshBuilder.CreateSphere(
        `playerDeathSoulMote:${index}`,
        { diameter: 0.026 + (index % 3) * 0.009, segments: 8 },
        scene
      );
      mote.parent = this.root;
      mote.material = this.haloMaterial;
      return mote;
    });

    for (const mesh of [this.core, this.halo, ...this.wisps, ...this.motes]) {
      mesh.isPickable = false;
      mesh.renderingGroupId = 1;
    }

    this.light = new PointLight(
      "playerDeathSoulPointLight",
      Vector3.Zero(),
      scene
    );
    this.light.parent = this.root;
    this.light.diffuse = new Color3(0.48, 0.78, 1);
    this.light.specular = new Color3(0.18, 0.38, 0.7);
    this.light.range = 4.2;
    this.light.intensity = 0;
    this.root.setEnabled(false);
  }

  start(origin: Vector3) {
    this.origin.copyFrom(origin);
    this.root.position.copyFrom(origin);
    this.root.setEnabled(false);
  }

  update(elapsedSeconds: number) {
    if (elapsedSeconds < 0) {
      this.root.setEnabled(false);
      return;
    }

    const frame = samplePlayerSoulLight(elapsedSeconds);
    if (frame.opacity <= 0.001) {
      this.root.setEnabled(false);
      return;
    }

    this.root.setEnabled(true);
    const rise = frame.riseProgress;
    const pulse = 0.5 + Math.sin(elapsedSeconds * 11.5) * 0.5;
    this.root.position.set(
      this.origin.x + Math.sin(rise * Math.PI * 2.7) * rise * 0.14,
      this.origin.y + 0.04 + rise * 3.25,
      this.origin.z + Math.cos(rise * Math.PI * 2.15) * rise * 0.09
    );
    this.core.scaling.setAll(0.78 + pulse * 0.34);
    this.halo.scaling.setAll(0.96 + pulse * 0.2 + rise * 0.45);
    this.coreMaterial.alpha = frame.opacity;
    this.haloMaterial.alpha = frame.opacity * (0.14 + pulse * 0.1);
    this.wispMaterial.alpha = frame.opacity * (0.16 + pulse * 0.08);
    this.light.intensity = frame.opacity * (0.9 + pulse * 0.42);

    for (let index = 0; index < this.wisps.length; index++) {
      const wisp = this.wisps[index];
      const phase = elapsedSeconds * (3.1 + index * 0.24) + index * 1.35;
      wisp.position.set(
        Math.sin(phase) * (0.025 + index * 0.012),
        -0.12 - index * (0.105 + rise * 0.035),
        Math.cos(phase * 0.83) * (0.02 + index * 0.01)
      );
      wisp.scaling.set(0.72, 1.15 + rise * 0.65 + index * 0.08, 0.72);
    }

    for (let index = 0; index < this.motes.length; index++) {
      const mote = this.motes[index];
      const phase = elapsedSeconds * (3.8 + index * 0.21) + index * 1.9;
      const radius = 0.075 + (index % 3) * 0.035 + rise * 0.04;
      mote.position.set(
        Math.sin(phase) * radius,
        -0.08 - (index % 4) * 0.12 + Math.sin(phase * 0.61) * 0.035,
        Math.cos(phase) * radius
      );
    }
  }

  dispose() {
    if (!this.root.isDisposed()) this.root.dispose(false, true);
  }

  private createMaterial(name: string, emissive: Color3, alpha: number) {
    const material = new StandardMaterial(name, this.root.getScene());
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = emissive;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.alpha = alpha;
    material.alphaMode = Engine.ALPHA_ADD;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    return material;
  }
}

/**
 * Reusable death presentation. Damage systems only start it; the level
 * decides what happens after the text has gone dark.
 */
export class PlayerDeathSequence {
  private readonly player: PlayerController;
  private readonly onStart?: () => void;
  private readonly onChoice?: (choice: PlayerDeathChoice) => void;
  private readonly portalRoot: TransformNode;
  private readonly portalFx: ShadowGrabberFxController;
  private readonly soulLight: PlayerSoulLightEffect;
  private readonly overlay: HTMLDivElement;
  private readonly checkpointButton: HTMLButtonElement;
  private readonly characterSelectionButton: HTMLButtonElement;
  private readonly groundPosition = Vector3.Zero();
  private readonly bodyCenterPosition = Vector3.Zero();
  private deathAnimationSeconds = 1.8;
  private elapsed = 0;
  private active = false;
  private completed = false;
  private disposed = false;
  private finalPlacementCaptured = false;
  private decisionTimer: number | null = null;

  constructor(scene: Scene, options: PlayerDeathSequenceOptions) {
    this.player = options.player;
    this.onStart = options.onStart;
    this.onChoice = options.onChoice;

    this.portalRoot = new TransformNode("playerDeathPortalRoot", scene);
    // The shared creature portal faces local +X. Rotate that normal upward so
    // the exact Shadow Grabber/Sky Eye effect opens flat beneath the player.
    this.portalRoot.rotation.z = Math.PI * 0.5;
    this.portalRoot.setEnabled(false);

    // As in SkyEyeFxController, a short-lived proxy only supplies stable
    // bounds to the shared procedural portal. At this diameter the rendered
    // rim encloses Lautaro without reading as an arena-sized opening.
    const portalBounds = MeshBuilder.CreateBox(
      "playerDeathPortalBounds",
      {
        width: PLAYER_DEATH_PORTAL_PROXY_DIAMETER * 0.12,
        height: PLAYER_DEATH_PORTAL_PROXY_DIAMETER,
        depth: PLAYER_DEATH_PORTAL_PROXY_DIAMETER,
      },
      scene
    );
    portalBounds.parent = this.portalRoot;
    portalBounds.isVisible = false;
    portalBounds.visibility = 0;
    portalBounds.isPickable = false;
    portalBounds.renderingGroupId = 1;
    this.portalFx = new ShadowGrabberFxController(
      scene,
      this.portalRoot,
      portalBounds,
      options.portalQuality,
      options.smokeSystem,
      DEFAULT_SHADOW_GRABBER_CONFIG.portalFx
    );
    this.portalFx.setState("hunt");
    this.portalFx.setOwnerEnabled(false);
    this.portalFx.playSpawn();
    portalBounds.dispose(false, false);
    this.soulLight = new PlayerSoulLightEffect(scene);

    const overlay = this.createOverlay();
    this.overlay = overlay.root;
    this.checkpointButton = overlay.checkpointButton;
    this.characterSelectionButton = overlay.characterSelectionButton;
    this.checkpointButton.addEventListener("click", () =>
      this.finish("checkpoint")
    );
    this.characterSelectionButton.addEventListener("click", () =>
      this.finish("character-selection")
    );
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  get isActive() {
    return this.active;
  }

  start() {
    if (this.active || this.completed || this.disposed) return false;
    this.active = true;
    this.elapsed = 0;
    this.finalPlacementCaptured = false;
    this.onStart?.();

    const cinematicStarted = this.player.beginCinematicSequence();
    if (cinematicStarted) {
      this.player.root.computeWorldMatrix(true);
      this.player.camera.computeWorldMatrix();
      const cameraPosition = this.player.camera.globalPosition.clone();
      this.player.getGroundContactPositionToRef(this.groundPosition);
      const cameraTarget = this.groundPosition.add(new Vector3(0, 0.72, 0));
      this.player.setCinematicCamera(cameraPosition, cameraTarget, 0, 0.82);
    } else {
      this.player.getGroundContactPositionToRef(this.groundPosition);
    }

    this.deathAnimationSeconds = Math.max(
      0.1,
      this.player.playDeathAnimation()
    );
    this.portalRoot.setEnabled(false);
    this.portalFx.setOwnerEnabled(false);
    this.portalFx.setFormationProgress(0, 0);
    this.overlay.classList.remove(
      "fading",
      "message-visible",
      "message-extinguishing",
      "decision-visible"
    );
    document.body.classList.add("player-death-sequence-active");
    window.dispatchEvent(new CustomEvent("bosque:player-death-started"));
    // DOM time is an intentional safety net: if the render observer is paused
    // or interrupted after the fade, the player must still receive a choice.
    this.clearDecisionTimer();
    this.decisionTimer = window.setTimeout(
      () => this.completePresentation(),
      (this.deathAnimationSeconds +
        DEATH_FINAL_POSE_SETTLE_SECONDS +
        PLAYER_DEATH_SEQUENCE_TIMING.completeSeconds +
        0.15) *
        1000
    );
    return true;
  }

  update(deltaTimeSeconds: number) {
    if (!this.active || this.completed || this.disposed) return;
    this.elapsed += Math.max(0, Math.min(0.1, deltaTimeSeconds));
    const presentationStart =
      this.deathAnimationSeconds + DEATH_FINAL_POSE_SETTLE_SECONDS;
    if (this.elapsed < presentationStart) return;
    if (!this.finalPlacementCaptured) this.captureFinalBodyPlacement();

    const portalElapsed = this.elapsed - presentationStart;
    this.soulLight.update(portalElapsed);
    const frame = samplePlayerDeathSequence(portalElapsed);
    this.portalRoot.setEnabled(true);
    this.portalFx.setOwnerEnabled(true);
    this.portalFx.setFormationProgress(
      frame.portalProgress,
      frame.portalProgress
    );
    this.portalFx.update(deltaTimeSeconds);
    this.player.setDeathSinkProgress(frame.sinkProgress);

    if (frame.fadeToBlack) this.overlay.classList.add("fading");
    if (frame.showMessage) this.overlay.classList.add("message-visible");
    if (frame.extinguishMessage) {
      this.overlay.classList.add("message-extinguishing");
    }
    if (!frame.complete) return;

    this.completePresentation();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDecisionTimer();
    document.body.classList.remove("player-death-sequence-active");
    this.overlay.remove();
    this.soulLight.dispose();
    this.portalFx.dispose();
    if (!this.portalRoot.isDisposed()) this.portalRoot.dispose(false, true);
  }

  private showDecision() {
    this.overlay.classList.add("decision-visible");
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    document.exitPointerLock?.();
    this.checkpointButton.focus({ preventScroll: true });
  }

  private captureFinalBodyPlacement() {
    this.finalPlacementCaptured = true;
    this.player.getGroundContactPositionToRef(this.groundPosition);
    this.player.getAnimatedBodyCenterPositionToRef(this.bodyCenterPosition);

    // The portal belongs under the final animated torso, while its vertical
    // coordinate remains on the terrain rather than following the skeleton.
    this.portalRoot.position.set(
      this.bodyCenterPosition.x,
      this.groundPosition.y + 0.018,
      this.bodyCenterPosition.z
    );
    this.soulLight.start(this.bodyCenterPosition);
  }

  private completePresentation() {
    if (this.completed || !this.active || this.disposed) return;
    this.completed = true;
    this.clearDecisionTimer();
    // Force the title out even if the browser failed to advance its CSS
    // animation while pointer lock or the render loop was changing state.
    this.overlay.classList.add("fading", "message-extinguishing");
    this.showDecision();
  }

  private clearDecisionTimer() {
    if (this.decisionTimer === null) return;
    window.clearTimeout(this.decisionTimer);
    this.decisionTimer = null;
  }

  private finish(choice: PlayerDeathChoice) {
    if (!this.completed || !this.active || this.disposed) return;
    this.active = false;
    this.clearDecisionTimer();
    this.checkpointButton.disabled = true;
    this.characterSelectionButton.disabled = true;
    this.onChoice?.(choice);
  }

  private createOverlay() {
    const root = document.createElement("div");
    root.className = "player-death-overlay";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "assertive");
    root.setAttribute("aria-atomic", "true");

    const message = document.createElement("p");
    message.className = "player-death-message";
    message.textContent = "Tu existencia ha terminado.";

    const choice = document.createElement("div");
    choice.className = "player-death-choice";
    choice.setAttribute("aria-label", "Opciones después de morir");

    const question = document.createElement("p");
    question.className = "player-death-choice-question";
    question.textContent = "¿Qué deseas hacer?";

    const actions = document.createElement("div");
    actions.className = "player-death-choice-actions";
    const checkpointButton = document.createElement("button");
    checkpointButton.type = "button";
    checkpointButton.className = "player-death-choice-button primary";
    checkpointButton.textContent = "Retomar desde el último checkpoint";
    const characterSelectionButton = document.createElement("button");
    characterSelectionButton.type = "button";
    characterSelectionButton.className = "player-death-choice-button";
    characterSelectionButton.textContent = "Volver a selección de personaje";
    actions.append(checkpointButton, characterSelectionButton);
    choice.append(question, actions);
    root.append(message, choice);
    document.body.append(root);
    return { root, checkpointButton, characterSelectionButton };
  }
}
