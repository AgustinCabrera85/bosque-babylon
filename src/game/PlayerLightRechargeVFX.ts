import { Engine } from "@babylonjs/core/Engines/engine";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";

export type PlayerLightRechargeVFXConfig = {
  ringRadius: number;
  auraHeight: number;
  ringBrightness: number;
  ringPulseStrength: number;
  particleEmissionRate: number;
  particleMinLifetime: number;
  particleMaxLifetime: number;
  particleMinSize: number;
  particleMaxSize: number;
  particleMinSpeed: number;
  particleMaxSpeed: number;
  particleArcAmount: number;
  particleSourceHeight: number;
  particleTargetHeight: number;
  completionFlashIntensity: number;
  completionFlashDuration: number;
  fadeInSpeed: number;
  fadeOutSpeed: number;
  particleCapacity: number;
};

export type PlayerLightRechargeVFXTarget = {
  getGroundPositionToRef: (result: Vector3) => Vector3;
  getGroundSurfaceHeightAt?: (x: number, z: number) => number;
};

export type PlayerLightRechargeVFXState = {
  active: boolean;
  progress: number;
  sourcePosition: Vector3 | null;
  completed: boolean;
};

/**
 * Visual-only tuning for the light pool, lower-body halo and rising motes.
 * None of these values participate in recharge timing or light-orb economy.
 */
export const DEFAULT_PLAYER_LIGHT_RECHARGE_VFX_CONFIG: PlayerLightRechargeVFXConfig = {
  ringRadius: 0.92,
  auraHeight: 0.72,
  ringBrightness: 0.62,
  ringPulseStrength: 0.09,
  particleEmissionRate: 36,
  particleMinLifetime: 0.22,
  particleMaxLifetime: 0.72,
  particleMinSize: 0.024,
  particleMaxSize: 0.05,
  particleMinSpeed: 5.2,
  particleMaxSpeed: 6.2,
  particleArcAmount: 0.055,
  particleSourceHeight: 1.15,
  particleTargetHeight: 0.62,
  completionFlashIntensity: 0.68,
  completionFlashDuration: 0.28,
  fadeInSpeed: 6.5,
  fadeOutSpeed: 4.2,
  particleCapacity: 36,
};

const GROUND_SURFACE_BIAS = 0.012;
const GROUND_SUBDIVISIONS = 6;
const VISIBILITY_EPSILON = 0.008;

const AURA_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;

uniform mat4 world;
uniform mat4 worldViewProjection;

varying vec3 vLocalPosition;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main(void) {
  vec4 worldPosition = world * vec4(position, 1.0);
  vLocalPosition = position;
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize((world * vec4(normal, 0.0)).xyz);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const AURA_FRAGMENT_SHADER = `
precision highp float;

uniform vec3 cameraPosition;
uniform float time;
uniform float intensity;
uniform float progress;

varying vec3 vLocalPosition;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main(void) {
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  float facing = abs(dot(normalize(vWorldNormal), viewDirection));
  float surfaceSoftness = smoothstep(0.04, 0.58, facing);
  float height01 = clamp(vLocalPosition.y + 0.5, 0.0, 1.0);
  float azimuth = atan(vLocalPosition.z, vLocalPosition.x);
  float streamA = 0.5 + 0.5 * sin(azimuth * 5.0 - time * 1.46 + height01 * 7.4);
  float streamB = 0.5 + 0.5 * sin(azimuth * -8.0 - time * 0.91 + height01 * 10.2);
  float streamC = 0.5 + 0.5 * sin(azimuth * 13.0 - time * 2.05);
  float tongueNoise = clamp(streamA * 0.54 + streamB * 0.3 + streamC * 0.16, 0.0, 1.0);
  float flameHeight = 0.16 + pow(tongueNoise, 1.55) * (0.3 + progress * 0.055);
  float flameBody = 1.0 - smoothstep(flameHeight - 0.055, flameHeight + 0.085, height01);
  float tipGlow = 1.0 - smoothstep(0.025, 0.13, abs(height01 - flameHeight));
  tipGlow *= smoothstep(0.1, 0.32, height01);
  float shimmer = smoothstep(0.4, 0.92, tongueNoise);
  float breathing = 0.94 + sin(time * 2.25) * 0.06;
  vec3 coolWhite = vec3(0.88, 0.955, 1.0);
  vec3 sacredWhite = vec3(1.0, 0.995, 0.97);
  vec3 color = mix(coolWhite, sacredWhite, 0.76 + progress * 0.08);
  float energy = intensity * breathing * surfaceSoftness *
    (0.28 + flameBody * 0.22 + shimmer * 0.58 + tipGlow * 0.34);
  float alpha = intensity * surfaceSoftness * (
    flameBody * (0.01 + shimmer * 0.027) + tipGlow * 0.018
  );
  if (alpha < 0.001) discard;
  gl_FragColor = vec4(color * energy, clamp(alpha, 0.0, 0.14));
}
`;

const GROUND_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 worldViewProjection;

varying vec2 vUV;

void main(void) {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const GROUND_FRAGMENT_SHADER = `
precision highp float;

uniform float time;
uniform float intensity;
uniform float progress;
uniform float completionProgress;
uniform float completionIntensity;

varying vec2 vUV;

void main(void) {
  vec2 p = vUV * 2.0 - 1.0;
  float radius = length(p);
  float angle = atan(p.y, p.x);
  float contourA = sin(angle * 5.0 - time * 1.18);
  float contourB = sin(angle * -9.0 - time * 0.76 + contourA * 0.52);
  float contourC = sin(angle * 14.0 - time * 1.67 + contourB * 0.34);
  float contourWarp = contourA * 0.02 + contourB * 0.012 + contourC * 0.006;
  float warpedRadius = radius - contourWarp;
  float ringCenter = 0.575;
  float ringHalfWidth = 0.068 + (0.5 + 0.5 * contourB) * 0.026;
  float hotCore = 1.0 - smoothstep(
    ringHalfWidth * 0.24,
    ringHalfWidth,
    abs(warpedRadius - ringCenter)
  );

  float lickSeed = max(
    0.0,
    sin(angle * 7.0 - time * 2.15 + contourA * 0.9 + contourC * 0.22)
  );
  lickSeed = pow(lickSeed, 4.2);
  float outwardDistance = warpedRadius - ringCenter;
  float lickReach = 0.075 + lickSeed * (0.1 + progress * 0.025);
  float outerLicks = smoothstep(-0.025, 0.028, outwardDistance) *
    (1.0 - smoothstep(lickReach * 0.42, lickReach, outwardDistance)) *
    lickSeed;
  float innerAura = pow(1.0 - smoothstep(0.0, 0.64, radius), 1.8);
  float livingRing = hotCore * (0.84 + contourC * 0.075) + outerLicks * 0.42;
  float breathing = 0.91 + sin(time * (2.05 + progress * 0.4)) * (0.045 + progress * 0.035);

  float completionRadius = mix(0.44, 0.96, completionProgress);
  float completionRing = 1.0 - smoothstep(
    0.035,
    0.12,
    abs(radius - completionRadius)
  );
  float completionEnvelope = sin(completionProgress * 3.14159265);
  float centerFlash = (1.0 - smoothstep(0.0, 0.56, radius)) *
    pow(1.0 - completionProgress, 2.4);

  vec3 coolWhite = vec3(0.86, 0.95, 1.0);
  vec3 sacredWhite = vec3(1.0, 0.995, 0.965);
  vec3 color = mix(coolWhite, sacredWhite, 0.76 + progress * 0.08);
  float baseAlpha = intensity * breathing * (livingRing * 0.115 + innerAura * 0.012);
  float flashAlpha = completionIntensity * (
    completionRing * completionEnvelope * 0.21 + centerFlash * 0.13
  );
  gl_FragColor = vec4(color, clamp(baseAlpha + flashAlpha, 0.0, 0.19));
}
`;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function configureAdditiveMaterial(material: ShaderMaterial) {
  material.alphaMode = Engine.ALPHA_ADD;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.needDepthPrePass = false;
}

function configureSoftAlphaMaterial(material: ShaderMaterial) {
  material.alphaMode = Engine.ALPHA_COMBINE;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.needDepthPrePass = false;
}

function createMoteTexture(scene: Scene) {
  const texture = new DynamicTexture(
    "playerLightRechargeMoteTexture",
    { width: 32, height: 32 },
    scene,
    false
  );
  const context = texture.getContext();
  const gradient = context.createRadialGradient(16, 16, 0.8, 16, 16, 15.5);
  gradient.addColorStop(0, "rgba(255, 255, 252, 1)");
  gradient.addColorStop(0.22, "rgba(244, 250, 255, 0.96)");
  gradient.addColorStop(0.58, "rgba(205, 232, 255, 0.38)");
  gradient.addColorStop(1, "rgba(174, 216, 255, 0)");
  context.clearRect(0, 0, 32, 32);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  texture.hasAlpha = true;
  texture.update(false);
  return texture;
}

/** A focused, allocation-free-per-frame VFX for recovering light near a source. */
export class PlayerLightRechargeVFX {
  private readonly config: PlayerLightRechargeVFXConfig;
  private readonly root: TransformNode;
  private readonly auraMaterial: ShaderMaterial;
  private readonly aura: Mesh;
  private readonly groundMaterial: ShaderMaterial;
  private readonly groundAura: Mesh;
  private readonly particleTexture: DynamicTexture;
  private readonly particles: ParticleSystem;
  private readonly groundPosition = Vector3.Zero();
  private readonly sourcePosition = Vector3.Zero();
  private readonly absorptionPosition = Vector3.Zero();
  private groundBasePositions = new Float32Array();
  private groundPositions = new Float32Array();
  private elapsed = 0;
  private visualStrength = 0;
  private startSurge = 0;
  private particleArcScale = 1;
  private completionElapsed = Number.POSITIVE_INFINITY;
  private wasActive = false;
  private particlesStarted = false;
  private disposed = false;

  public constructor(
    scene: Scene,
    private readonly target: PlayerLightRechargeVFXTarget,
    overrides: Partial<PlayerLightRechargeVFXConfig> = {}
  ) {
    this.config = { ...DEFAULT_PLAYER_LIGHT_RECHARGE_VFX_CONFIG, ...overrides };
    this.root = new TransformNode("playerLightRechargeVFX", scene);

    this.auraMaterial = new ShaderMaterial(
      "playerLightRechargeAuraMaterial",
      scene,
      { vertexSource: AURA_VERTEX_SHADER, fragmentSource: AURA_FRAGMENT_SHADER },
      {
        attributes: ["position", "normal"],
        uniforms: [
          "world",
          "worldViewProjection",
          "cameraPosition",
          "time",
          "intensity",
          "progress",
        ],
        needAlphaBlending: true,
      }
    );
    configureAdditiveMaterial(this.auraMaterial);

    this.aura = MeshBuilder.CreateCylinder(
      "playerLightRechargeLowerBodyAura",
      {
        height: 1,
        diameterBottom: 2,
        diameterTop: 0.92,
        tessellation: 24,
        subdivisions: 2,
        cap: Mesh.NO_CAP,
      },
      scene
    );
    this.aura.parent = this.root;
    this.aura.material = this.auraMaterial;
    this.aura.position.y = this.config.auraHeight * 0.5 + 0.018;
    this.aura.isPickable = false;
    this.aura.applyFog = false;
    this.aura.alwaysSelectAsActiveMesh = true;
    this.aura.renderingGroupId = 1;
    this.aura.alphaIndex = 10;

    this.groundMaterial = new ShaderMaterial(
      "playerLightRechargeGroundMaterial",
      scene,
      { vertexSource: GROUND_VERTEX_SHADER, fragmentSource: GROUND_FRAGMENT_SHADER },
      {
        attributes: ["position", "uv"],
        uniforms: [
          "worldViewProjection",
          "time",
          "intensity",
          "progress",
          "completionProgress",
          "completionIntensity",
        ],
        needAlphaBlending: true,
      }
    );
    configureSoftAlphaMaterial(this.groundMaterial);

    this.groundAura = MeshBuilder.CreateGround(
      "playerLightRechargeGroundAura",
      { width: 2, height: 2, subdivisions: GROUND_SUBDIVISIONS, updatable: true },
      scene
    );
    const groundPositions = this.groundAura.getVerticesData(VertexBuffer.PositionKind);
    if (groundPositions) {
      this.groundBasePositions = Float32Array.from(groundPositions);
      this.groundPositions = Float32Array.from(groundPositions);
    }
    this.groundAura.material = this.groundMaterial;
    this.groundAura.isPickable = false;
    this.groundAura.applyFog = false;
    this.groundAura.alwaysSelectAsActiveMesh = true;
    this.groundAura.renderingGroupId = 0;
    this.groundAura.alphaIndex = 24;

    this.particleTexture = createMoteTexture(scene);
    this.particles = new ParticleSystem(
      "playerLightRechargeIncomingMotes",
      this.config.particleCapacity,
      scene
    );
    this.particles.particleTexture = this.particleTexture;
    this.particles.emitter = this.sourcePosition;
    this.particles.isLocal = false;
    this.particles.startPositionFunction = (
      _worldMatrix,
      positionToUpdate
    ) => {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * 0.1;
      positionToUpdate.set(
        this.sourcePosition.x + Math.cos(angle) * radius,
        this.sourcePosition.y + (Math.random() - 0.5) * 0.12,
        this.sourcePosition.z + Math.sin(angle) * radius
      );
    };
    this.particles.startDirectionFunction = (
      _worldMatrix,
      directionToUpdate,
      particle
    ) => {
      const dx = this.absorptionPosition.x - particle.position.x;
      const dy = this.absorptionPosition.y - particle.position.y;
      const dz = this.absorptionPosition.z - particle.position.z;
      const inverseLength = 1 / Math.max(0.0001, Math.hypot(dx, dy, dz));
      const towardX = dx * inverseLength;
      const towardY = dy * inverseLength;
      const towardZ = dz * inverseLength;
      const arc =
        (Math.random() - 0.5) *
        this.config.particleArcAmount *
        this.particleArcScale;
      directionToUpdate.set(
        towardX - towardZ * arc,
        towardY + Math.abs(arc) * 0.35,
        towardZ + towardX * arc
      );
      directionToUpdate.normalize();
    };
    this.particles.minEmitPower = this.config.particleMinSpeed;
    this.particles.maxEmitPower = this.config.particleMaxSpeed;
    this.particles.minLifeTime = this.config.particleMinLifetime;
    this.particles.maxLifeTime = this.config.particleMaxLifetime;
    // Babylon size gradients are absolute world sizes, not multipliers of min/max size.
    // Direct sizing keeps these sprites as motes instead of turning them into floor billboards.
    this.particles.minSize = this.config.particleMinSize;
    this.particles.maxSize = this.config.particleMaxSize;
    this.particles.minScaleX = 0.86;
    this.particles.maxScaleX = 1;
    this.particles.minScaleY = 0.92;
    this.particles.maxScaleY = 1.12;
    this.particles.minAngularSpeed = -0.45;
    this.particles.maxAngularSpeed = 0.45;
    this.particles.emitRate = 0;
    this.particles.gravity.set(0, 0, 0);
    this.particles.color1 = new Color4(1, 0.995, 0.97, 0.58);
    this.particles.color2 = new Color4(0.88, 0.96, 1, 0.5);
    this.particles.colorDead = new Color4(0.78, 0.9, 1, 0);
    this.particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.particles.updateSpeed = 0.012;
    this.particles.renderingGroupId = 1;
    this.particles.disposeOnStop = false;

    this.hideAuraMeshes();
  }

  public update(deltaTimeSeconds: number, state: PlayerLightRechargeVFXState) {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(deltaTimeSeconds, 0.05));
    const progress = clamp01(state.progress);
    if (state.completed) this.completionElapsed = 0;
    else this.completionElapsed += dt;
    const completionProgress = clamp01(
      this.completionElapsed / Math.max(0.001, this.config.completionFlashDuration)
    );
    const completionActive = completionProgress < 1;
    const targetStrength = state.active ? 0.5 + progress * 0.5 : 0;
    const smoothingSpeed = state.active ? this.config.fadeInSpeed : this.config.fadeOutSpeed;
    const smoothing = 1 - Math.exp(-smoothingSpeed * dt);
    this.visualStrength = lerp(this.visualStrength, targetStrength, smoothing);
    this.elapsed += dt;

    if (state.active && !this.wasActive) this.startSurge = 1;
    this.wasActive = state.active;
    this.startSurge = Math.max(0, this.startSurge - dt * 3.2);

    this.target.getGroundPositionToRef(this.groundPosition);
    this.root.position.copyFrom(this.groundPosition);
    this.absorptionPosition.copyFrom(this.groundPosition);
    this.absorptionPosition.y += this.config.particleTargetHeight;
    const hasSource = state.active && state.sourcePosition !== null;
    if (hasSource) {
      this.sourcePosition.copyFrom(state.sourcePosition!);
      this.sourcePosition.y += this.config.particleSourceHeight;
    }

    const visible = this.visualStrength > VISIBILITY_EPSILON || completionActive;
    this.aura.setEnabled(visible);
    this.groundAura.setEnabled(visible);
    if (!visible) {
      this.stopParticles();
      return;
    }

    const pulseWave = Math.sin(this.elapsed * 2.55);
    const pulseStrength = this.config.ringPulseStrength * (0.55 + progress * 0.45);
    const pulse =
      1 + pulseWave * pulseStrength + this.startSurge * 0.05;
    const brightness = this.config.ringBrightness * this.visualStrength * pulse;
    const radius =
      this.config.ringRadius *
      (0.92 + progress * 0.08 + pulseWave * pulseStrength * 0.028);

    this.aura.scaling.set(radius * 0.58, this.config.auraHeight, radius * 0.58);
    this.auraMaterial.setFloat("time", this.elapsed);
    this.auraMaterial.setFloat("intensity", brightness);
    this.auraMaterial.setFloat("progress", progress);
    this.groundMaterial.setFloat("time", this.elapsed);
    this.groundMaterial.setFloat("intensity", brightness);
    this.groundMaterial.setFloat("progress", progress);
    this.groundMaterial.setFloat("completionProgress", completionProgress);
    this.groundMaterial.setFloat(
      "completionIntensity",
      this.config.completionFlashIntensity
    );
    this.updateGroundGeometry(radius);
    this.updateParticles(hasSource, progress, brightness);
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopParticles();
    this.particles.dispose(false);
    this.particleTexture.dispose();
    this.aura.dispose(false, false);
    this.groundAura.dispose(false, false);
    this.auraMaterial.dispose(false, false);
    this.groundMaterial.dispose(false, false);
    this.root.dispose(false, false);
  }

  private updateGroundGeometry(radius: number) {
    if (this.groundBasePositions.length === 0 || this.groundPositions.length === 0) return;
    const centerX = this.root.position.x;
    const centerZ = this.root.position.z;
    const fallbackY = this.root.position.y + GROUND_SURFACE_BIAS;
    for (let index = 0; index < this.groundBasePositions.length; index += 3) {
      const x = centerX + this.groundBasePositions[index] * radius;
      const z = centerZ + this.groundBasePositions[index + 2] * radius;
      const sampledY = this.target.getGroundSurfaceHeightAt?.(x, z);
      this.groundPositions[index] = x;
      this.groundPositions[index + 1] =
        sampledY !== undefined && Number.isFinite(sampledY)
          ? sampledY + GROUND_SURFACE_BIAS
          : fallbackY;
      this.groundPositions[index + 2] = z;
    }
    this.groundAura.updateVerticesData(VertexBuffer.PositionKind, this.groundPositions, true);
  }

  private updateParticles(active: boolean, progress: number, brightness: number) {
    if (!active) {
      this.stopParticles();
      return;
    }
    if (!this.particlesStarted) {
      this.particles.start();
      this.particlesStarted = true;
    }
    const emissionStrength = this.visualStrength * (0.55 + progress * 0.45);
    this.particleArcScale = 0.88 + progress * 0.12;
    const sourceDistance = Vector3.Distance(this.sourcePosition, this.absorptionPosition);
    const minimumArrivalSpeed =
      sourceDistance / Math.max(0.001, this.config.particleMaxLifetime);
    this.particles.minEmitPower = Math.max(
      this.config.particleMinSpeed * (0.94 + progress * 0.06),
      minimumArrivalSpeed * 0.96
    );
    this.particles.maxEmitPower = Math.max(
      this.config.particleMaxSpeed * (0.9 + progress * 0.1),
      minimumArrivalSpeed * 1.08
    );
    const averageSpeed =
      (this.particles.minEmitPower + this.particles.maxEmitPower) * 0.5;
    const travelTime = sourceDistance / Math.max(0.001, averageSpeed);
    this.particles.minLifeTime = Math.max(
      this.config.particleMinLifetime,
      Math.min(this.config.particleMaxLifetime, travelTime * 0.92)
    );
    this.particles.maxLifeTime = Math.max(
      this.particles.minLifeTime,
      Math.min(this.config.particleMaxLifetime, travelTime * 1.08)
    );
    this.particles.emitRate =
      this.config.particleEmissionRate * emissionStrength * (1 + this.startSurge * 0.18);
    const particleAlpha = clamp01(0.34 + brightness * 0.36);
    this.particles.color1.set(1, 0.995, 0.97, particleAlpha);
    this.particles.color2.set(0.88, 0.96, 1, particleAlpha * 0.86);
  }

  private stopParticles() {
    if (!this.particlesStarted) return;
    this.particles.emitRate = 0;
    this.particles.stop();
    this.particlesStarted = false;
  }

  private hideAuraMeshes() {
    this.aura.setEnabled(false);
    this.groundAura.setEnabled(false);
  }
}
