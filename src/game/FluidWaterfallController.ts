import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
import type {
  FluidRenderer,
  IFluidRenderingRenderObject,
} from "@babylonjs/core/Rendering/fluidRenderer/fluidRenderer";
import "@babylonjs/core/Rendering/fluidRenderer/fluidRenderer";
import { mulberry32 } from "../utils/seed";

export type FluidWaterfallPreset = "low" | "medium" | "high";

export type FluidWaterfallFeatureOptions = {
  enabled: boolean;
  debug?: boolean;
  preset?: FluidWaterfallPreset;
};

export interface FluidWaterfallConfig {
  enabled: boolean;
  debug: boolean;
  preset: FluidWaterfallPreset;
  emitterWidth: number;
  emitterDepth: number;
  emitterPosition: Vector3;
  impactPosition: Vector3;
  lakeY: number;
  emitRate: number;
  maxParticles: number;
  initialForwardSpeed: number;
  initialDownSpeed: number;
  gravityStrength: number;
  lateralJitter: number;
  convergenceStrength: number;
  minLifeTime: number;
  maxLifeTime: number;
  particleSize: number;
  density: number;
  surfaceThickness: number;
  minimumThickness: number;
  blurSize: number;
  blurDepthScale: number;
  refractionStrength: number;
  fresnelClamp: number;
  specularPower: number;
  renderTargetSize: number;
  fullDetailDistance: number;
  disableDistance: number;
}

export type FluidWaterfallDebugSnapshot = {
  available: boolean;
  enabled: boolean;
  running: boolean;
  preset: FluidWaterfallPreset;
  activeParticles: number;
  configuredMaxParticles: number;
  emitRate: number;
  fps: number;
  frameTimeMs: number;
  emitterPosition: { x: number; y: number; z: number };
  impactPosition: { x: number; y: number; z: number };
  lakeY: number;
  gravityStrength: number;
  initialForwardSpeed: number;
  initialDownSpeed: number;
  initializationError: string | null;
};

type FluidWaterfallPlacement = FluidWaterfallFeatureOptions & {
  emitterWidth: number;
  emitterPosition: Vector3;
  impactPosition: Vector3;
  lakeY: number;
};

const PRESET_MAX_PARTICLES: Record<FluidWaterfallPreset, number> = {
  low: 300,
  medium: 600,
  high: 1000,
};

const PRESET_RENDER_TARGET_SIZE: Record<FluidWaterfallPreset, number> = {
  low: 320,
  medium: 512,
  high: 768,
};

export function isFluidWaterfallPreset(value: string | null): value is FluidWaterfallPreset {
  return value === "low" || value === "medium" || value === "high";
}

export function createFluidWaterfallConfig(
  placement: FluidWaterfallPlacement
): FluidWaterfallConfig {
  const preset = placement.preset ?? "medium";
  const gravityStrength = 9.81;
  const initialDownSpeed = 0.2;
  const fallDistance = Math.max(0.1, placement.emitterPosition.y - placement.lakeY);
  const fallTime =
    (-initialDownSpeed +
      Math.sqrt(initialDownSpeed * initialDownSpeed + 2 * gravityStrength * fallDistance)) /
    gravityStrength;
  const minLifeTime = fallTime * 0.985;
  const maxLifeTime = fallTime * 1.015;
  const maxParticles = PRESET_MAX_PARTICLES[preset];
  const averageLifeTime = (minLifeTime + maxLifeTime) * 0.5;
  const initialForwardSpeed = Math.max(
    0,
    (placement.emitterPosition.z - placement.impactPosition.z) / averageLifeTime
  );

  return {
    enabled: placement.enabled,
    debug: placement.debug ?? false,
    preset,
    emitterWidth: placement.emitterWidth,
    emitterDepth: 0.72,
    emitterPosition: placement.emitterPosition.clone(),
    impactPosition: placement.impactPosition.clone(),
    lakeY: placement.lakeY,
    // Slightly over-fill the capacity so the steady-state count reaches the
    // selected density without beginning with an unnecessarily large pool.
    emitRate: (maxParticles / averageLifeTime) * 1.04,
    maxParticles,
    // The horizontal component is derived from the safe lagoon impact point.
    // Gravity still dominates the trajectory after the water leaves the lip.
    initialForwardSpeed,
    initialDownSpeed,
    gravityStrength,
    lateralJitter: 0.11,
    convergenceStrength: 0.028,
    minLifeTime,
    maxLifeTime,
    // FluidRenderer is now a detail layer over the authored water sheet, so
    // individual reconstructed droplets stay small and translucent.
    particleSize: preset === "low" ? 0.44 : preset === "high" ? 0.3 : 0.36,
    density: 0.52,
    surfaceThickness: 0.3,
    minimumThickness: 0.025,
    blurSize: preset === "high" ? 6 : preset === "low" ? 4 : 5,
    blurDepthScale: 18,
    refractionStrength: 0.028,
    fresnelClamp: 0.1,
    specularPower: 54,
    renderTargetSize: PRESET_RENDER_TARGET_SIZE[preset],
    fullDetailDistance: 74,
    disableDistance: 138,
  };
}

/**
 * CPU particles provide the authored trajectory while FluidRenderer only
 * reconstructs their screen-space surface. This is deliberately not an SPH
 * simulation and owns no lake, contact, splash, mist or gameplay behavior.
 */
export class FluidWaterfallController {
  private readonly particleSystem: ParticleSystem;
  private readonly particleTexture: RawTexture;
  private readonly impactPosition: Vector3;
  private readonly random: () => number;
  private readonly renderer: FluidRenderer | null;
  private renderObject: IFluidRenderingRenderObject | null;
  private readonly ownsRenderer: boolean;
  private readonly debugMeshes: Mesh[] = [];
  private readonly debugMaterials: StandardMaterial[] = [];
  private debugPanel: HTMLPreElement | null = null;
  private debugRefreshRemaining = 0;
  private requestedEnabled: boolean;
  private running = false;
  private disposed = false;
  private initializationError: string | null = null;

  constructor(
    private readonly scene: Scene,
    readonly config: FluidWaterfallConfig,
    seed: number
  ) {
    this.requestedEnabled = config.enabled;
    this.random = mulberry32(seed ^ 0x5f10_dca7);
    this.impactPosition = config.impactPosition.clone();
    this.particleTexture = RawTexture.CreateRGBATexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      scene,
      false,
      false
    );
    this.particleTexture.name = "terminalFluidWaterfallParticleTexture";
    this.particleSystem = this.createParticleSystem();

    const existingRenderer = scene.fluidRenderer;
    let renderer: FluidRenderer | null = null;
    let renderObject: IFluidRenderingRenderObject | null = null;
    try {
      renderer = scene.enableFluidRenderer();
      if (!renderer) {
        throw new Error("Babylon.js did not provide a FluidRenderer for this scene.");
      }
      renderObject = renderer.addParticleSystem(
        this.particleSystem,
        false,
        undefined,
        scene.activeCamera ?? undefined
      );
      this.configureFluidAppearance(renderObject);
    } catch (error) {
      this.initializationError =
        error instanceof Error ? error.message : "Unknown FluidRenderer initialization error";
    }
    this.renderer = renderer;
    this.renderObject = renderObject;
    this.ownsRenderer = existingRenderer === null && renderer !== null;

    if (config.debug) this.createDebugView();
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  get isAvailable() {
    return this.renderer !== null && this.initializationError === null;
  }

  get isEnabled() {
    return this.requestedEnabled && this.isAvailable;
  }

  getImpactPosition() {
    return this.impactPosition.clone();
  }

  setEnabled(enabled: boolean) {
    this.requestedEnabled = enabled;
    if (!enabled) this.setRunning(false);
    return this.isEnabled;
  }

  update(deltaTime: number, playerPosition?: Vector3) {
    if (this.disposed) return;

    const distance = playerPosition
      ? Vector3.Distance(playerPosition, this.impactPosition)
      : 0;
    const shouldRun = this.isEnabled && distance < this.config.disableDistance;
    this.setRunning(shouldRun);

    if (shouldRun) {
      const distanceBlend = clamp01(
        (distance - this.config.fullDetailDistance) /
          Math.max(0.001, this.config.disableDistance - this.config.fullDetailDistance)
      );
      this.particleSystem.emitRate =
        this.config.emitRate * lerp(1, 0.3, distanceBlend);
    }

    if (this.config.debug) this.updateDebugView(deltaTime);
  }

  getDebugSnapshot(): FluidWaterfallDebugSnapshot {
    const engine = this.scene.getEngine();
    return {
      available: this.isAvailable,
      enabled: this.isEnabled,
      running: this.running,
      preset: this.config.preset,
      activeParticles: this.particleSystem.getActiveCount(),
      configuredMaxParticles: this.config.maxParticles,
      emitRate: this.particleSystem.emitRate,
      fps: engine.getFps(),
      frameTimeMs: engine.getDeltaTime(),
      emitterPosition: vectorSnapshot(this.config.emitterPosition),
      impactPosition: vectorSnapshot(this.impactPosition),
      lakeY: this.config.lakeY,
      gravityStrength: this.config.gravityStrength,
      initialForwardSpeed: this.config.initialForwardSpeed,
      initialDownSpeed: this.config.initialDownSpeed,
      initializationError: this.initializationError,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.setRunning(false);

    this.detachRenderObject();
    if (!this.particleSystem.isDisposed) {
      this.particleSystem.dispose(false);
    }
    this.particleTexture.dispose();
    for (const mesh of this.debugMeshes) mesh.dispose();
    for (const material of this.debugMaterials) material.dispose();
    this.debugPanel?.remove();
    this.debugPanel = null;

    if (
      this.ownsRenderer &&
      this.renderer &&
      this.scene.fluidRenderer === this.renderer &&
      this.renderer.renderObjects.length === 0
    ) {
      this.scene.disableFluidRenderer();
    }
  }

  private createParticleSystem() {
    const config = this.config;
    const system = new ParticleSystem(
      "terminalFluidWaterfall",
      config.maxParticles,
      this.scene
    );
    system.particleTexture = this.particleTexture;
    system.emitter = config.emitterPosition.clone();
    system.createBoxEmitter(
      Vector3.Zero(),
      Vector3.Zero(),
      new Vector3(-config.emitterWidth * 0.5, -0.05, -config.emitterDepth * 0.5),
      new Vector3(config.emitterWidth * 0.5, 0.05, config.emitterDepth * 0.5)
    );
    system.startDirectionFunction = (_worldMatrix, direction, particle) => {
      const lateralOffset = particle.position.x - config.emitterPosition.x;
      const jitterX = (this.random() * 2 - 1) * config.lateralJitter;
      const jitterZ = (this.random() * 2 - 1) * config.lateralJitter * 0.35;
      direction.set(
        -lateralOffset * config.convergenceStrength + jitterX,
        -config.initialDownSpeed,
        -config.initialForwardSpeed + jitterZ
      );
    };
    system.gravity.set(0, -config.gravityStrength, 0);
    system.minEmitPower = 1;
    system.maxEmitPower = 1;
    system.minLifeTime = config.minLifeTime;
    system.maxLifeTime = config.maxLifeTime;
    system.minSize = config.particleSize;
    system.maxSize = config.particleSize;
    system.emitRate = config.emitRate;
    system.updateSpeed = 1 / 60;
    system.color1 = new Color4(0.72, 0.86, 0.88, 0.72);
    system.color2 = new Color4(0.9, 0.96, 0.96, 0.82);
    system.colorDead = new Color4(0.62, 0.78, 0.8, 0);
    system.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    system.renderingGroupId = 0;
    system.disposeOnStop = false;
    return system;
  }

  private configureFluidAppearance(renderObject: IFluidRenderingRenderObject) {
    const config = this.config;
    renderObject.object.particleSize = config.particleSize;
    renderObject.object.particleThicknessAlpha = config.surfaceThickness;

    const target = renderObject.targetRenderer;
    target.fluidColor = new Color3(0.76, 0.88, 0.9);
    target.density = config.density;
    target.refractionStrength = config.refractionStrength;
    target.fresnelClamp = config.fresnelClamp;
    target.specularPower = config.specularPower;
    target.minimumThickness = config.minimumThickness;
    target.enableBlurDepth = true;
    target.blurDepthFilterSize = config.blurSize;
    target.blurDepthDepthScale = config.blurDepthScale;
    target.blurDepthNumIterations = 2;
    target.enableBlurThickness = true;
    target.blurThicknessFilterSize = Math.max(3, config.blurSize - 2);
    target.blurThicknessNumIterations = 1;
    target.depthMapSize = config.renderTargetSize;
    target.thicknessMapSize = Math.max(192, Math.floor(config.renderTargetSize * 0.5));
    target.samples = 1;
    target.dirLight = new Vector3(-0.35, -1, 0.25).normalize();
  }

  private setRunning(running: boolean) {
    if (
      this.running === running &&
      ((running && this.renderObject !== null) || (!running && this.renderObject === null))
    ) {
      return;
    }
    this.running = running;
    if (running) {
      if (!this.attachRenderObject()) {
        this.running = false;
        return;
      }
      this.particleSystem.start();
    } else {
      this.particleSystem.stop();
      this.particleSystem.reset();
      this.detachRenderObject();
    }
    for (const mesh of this.debugMeshes) mesh.setEnabled(running && this.config.debug);
  }

  private attachRenderObject() {
    if (this.renderObject) return true;
    if (!this.renderer || this.initializationError) return false;
    try {
      this.renderObject = this.renderer.addParticleSystem(
        this.particleSystem,
        false,
        undefined,
        this.scene.activeCamera ?? undefined
      );
      this.configureFluidAppearance(this.renderObject);
      return true;
    } catch (error) {
      this.initializationError =
        error instanceof Error ? error.message : "Unknown FluidRenderer registration error";
      return false;
    }
  }

  private detachRenderObject() {
    if (!this.renderer || !this.renderObject) return;
    this.renderer.removeRenderObject(this.renderObject);
    this.renderObject = null;
  }

  private createDebugView() {
    const emitterMaterial = new StandardMaterial(
      "terminalFluidWaterfallEmitterDebugMaterial",
      this.scene
    );
    emitterMaterial.disableLighting = true;
    emitterMaterial.emissiveColor = new Color3(0.1, 0.9, 1);
    emitterMaterial.alpha = 0.78;
    emitterMaterial.wireframe = true;

    const emitterBounds = MeshBuilder.CreateBox(
      "terminalFluidWaterfallEmitterBounds",
      {
        width: this.config.emitterWidth,
        height: 0.1,
        depth: this.config.emitterDepth,
      },
      this.scene
    );
    emitterBounds.position.copyFrom(this.config.emitterPosition);
    emitterBounds.material = emitterMaterial;
    emitterBounds.isPickable = false;

    this.debugMeshes.push(emitterBounds);
    this.debugMaterials.push(emitterMaterial);
    for (const mesh of this.debugMeshes) mesh.setEnabled(false);

    const panel = document.createElement("pre");
    panel.id = "fluidWaterfallDebug";
    Object.assign(panel.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "10000",
      margin: "0",
      padding: "10px 12px",
      color: "#c9f8ff",
      background: "rgba(3, 15, 18, 0.88)",
      border: "1px solid rgba(96, 224, 240, 0.7)",
      borderRadius: "6px",
      font: "12px/1.45 monospace",
      pointerEvents: "none",
      whiteSpace: "pre-wrap",
    });
    document.body.appendChild(panel);
    this.debugPanel = panel;
    this.renderDebugPanel();
  }

  private updateDebugView(deltaTime: number) {
    this.debugRefreshRemaining -= Math.max(0, deltaTime);
    if (this.debugRefreshRemaining > 0) return;
    this.debugRefreshRemaining = 0.25;
    this.renderDebugPanel();
  }

  private renderDebugPanel() {
    if (!this.debugPanel) return;
    const snapshot = this.getDebugSnapshot();
    const status = snapshot.available
      ? snapshot.running
        ? "RUNNING"
        : "CULLED"
      : "FALLBACK";
    this.debugPanel.textContent = [
      `FLUID WATERFALL ${status}`,
      `preset: ${snapshot.preset}`,
      `particles: ${snapshot.activeParticles}/${snapshot.configuredMaxParticles}`,
      `emit rate: ${snapshot.emitRate.toFixed(1)}/s`,
      `fps: ${snapshot.fps.toFixed(1)} (${snapshot.frameTimeMs.toFixed(2)} ms)`,
      `top: ${formatVector(snapshot.emitterPosition)}`,
      `impact: ${formatVector(snapshot.impactPosition)}`,
      `lakeY: ${snapshot.lakeY.toFixed(2)}`,
      `gravity: ${snapshot.gravityStrength.toFixed(2)}`,
      `initial velocity: (0, ${(-snapshot.initialDownSpeed).toFixed(2)}, ${(-snapshot.initialForwardSpeed).toFixed(2)})`,
      snapshot.initializationError ? `error: ${snapshot.initializationError}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
}

function vectorSnapshot(vector: Vector3) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function formatVector(vector: { x: number; y: number; z: number }) {
  return `${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)}`;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}
