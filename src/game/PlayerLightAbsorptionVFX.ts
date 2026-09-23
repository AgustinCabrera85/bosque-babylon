import { Engine } from "@babylonjs/core/Engines/engine";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";

export type PlayerLightAbsorptionVFXConfig = {
  torsoHeight: number;
  orbTravelDuration: number;
  orbSize: number;
  orbHaloScale: number;
  orbStartDistance: number;
  orbStartVerticalOffset: number;
  orbArcHeight: number;
  flashDuration: number;
  flashRadius: number;
  flashIntensity: number;
  particleCount: number;
  particleMinLifetime: number;
  particleMaxLifetime: number;
  particleMinSize: number;
  particleMaxSize: number;
  particleSpawnInnerRadius: number;
  particleSpawnOuterRadius: number;
  particleMinUpwardSpeed: number;
  particleMaxUpwardSpeed: number;
  particleDrift: number;
};

export type PlayerLightAbsorptionVFXTarget = {
  getGroundPositionToRef: (result: Vector3) => Vector3;
};

/**
 * Visual-only tuning for the single-orb absorption cue. These values do not
 * participate in absorption timing, stats, inventory, or light-orb economy.
 */
export const DEFAULT_PLAYER_LIGHT_ABSORPTION_VFX_CONFIG: PlayerLightAbsorptionVFXConfig = {
  torsoHeight: 1.03,
  orbTravelDuration: 0.26,
  orbSize: 0.11,
  orbHaloScale: 1.72,
  orbStartDistance: 0.64,
  orbStartVerticalOffset: -0.34,
  orbArcHeight: 0.24,
  flashDuration: 0.18,
  flashRadius: 0.62,
  flashIntensity: 0.78,
  particleCount: 14,
  particleMinLifetime: 0.34,
  particleMaxLifetime: 0.58,
  particleMinSize: 0.018,
  particleMaxSize: 0.042,
  particleSpawnInnerRadius: 0.2,
  particleSpawnOuterRadius: 0.38,
  particleMinUpwardSpeed: 0.48,
  particleMaxUpwardSpeed: 0.88,
  particleDrift: 0.16,
};

const ORB_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;

uniform mat4 world;
uniform mat4 worldViewProjection;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main(void) {
  vec4 worldPosition = world * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize((world * vec4(normal, 0.0)).xyz);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const ORB_CORE_FRAGMENT_SHADER = `
precision highp float;

uniform vec3 cameraPosition;
uniform float intensity;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main(void) {
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  float facing = abs(dot(normalize(vWorldNormal), viewDirection));
  float softBody = pow(clamp(facing, 0.0, 1.0), 0.42);
  float rim = pow(1.0 - facing, 2.2);
  vec3 color = mix(vec3(0.82, 0.93, 1.0), vec3(1.0, 0.998, 0.975), 0.78);
  float alpha = intensity * (0.38 + softBody * 0.34 + rim * 0.14);
  gl_FragColor = vec4(color * intensity * (0.82 + rim * 0.34), alpha);
}
`;

const ORB_SHELL_FRAGMENT_SHADER = `
precision highp float;

uniform vec3 cameraPosition;
uniform float intensity;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main(void) {
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  float facing = abs(dot(normalize(vWorldNormal), viewDirection));
  float fresnel = pow(1.0 - facing, 2.35);
  float veil = pow(clamp(facing, 0.0, 1.0), 1.8);
  vec3 color = mix(vec3(0.76, 0.9, 1.0), vec3(1.0, 0.998, 0.98), 0.7);
  float alpha = intensity * (fresnel * 0.42 + veil * 0.055);
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(color * intensity * (0.72 + fresnel * 0.46), alpha);
}
`;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function configureAdditiveMaterial(material: ShaderMaterial) {
  material.alphaMode = Engine.ALPHA_ADD;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.needDepthPrePass = false;
}

function createMoteTexture(scene: Scene) {
  const texture = new DynamicTexture(
    "playerLightAbsorptionMoteTexture",
    { width: 32, height: 32 },
    scene,
    false
  );
  const context = texture.getContext();
  const gradient = context.createRadialGradient(16, 16, 0.8, 16, 16, 15.5);
  gradient.addColorStop(0, "rgba(255, 255, 250, 1)");
  gradient.addColorStop(0.2, "rgba(245, 251, 255, 0.92)");
  gradient.addColorStop(0.55, "rgba(198, 229, 255, 0.3)");
  gradient.addColorStop(1, "rgba(168, 214, 255, 0)");
  context.clearRect(0, 0, 32, 32);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  texture.hasAlpha = true;
  texture.update(false);
  return texture;
}

/** A small, preallocated three-stage cue for each successfully absorbed orb. */
export class PlayerLightAbsorptionVFX {
  private readonly config: PlayerLightAbsorptionVFXConfig;
  private readonly root: TransformNode;
  private readonly incomingOrb: Mesh;
  private readonly glowShell: Mesh;
  private readonly coreMaterial: ShaderMaterial;
  private readonly shellMaterial: ShaderMaterial;
  private readonly particleTexture: DynamicTexture;
  private readonly particles: ParticleSystem;
  private readonly torsoPosition = Vector3.Zero();
  private readonly particleOrigin = Vector3.Zero();
  private readonly startOffset = Vector3.Zero();
  private readonly controlOffset = Vector3.Zero();
  private elapsed = 0;
  private playing = false;
  private residualEmitted = false;
  private particlesStarted = false;
  private disposed = false;

  public constructor(
    private readonly scene: Scene,
    private readonly target: PlayerLightAbsorptionVFXTarget,
    overrides: Partial<PlayerLightAbsorptionVFXConfig> = {}
  ) {
    this.config = { ...DEFAULT_PLAYER_LIGHT_ABSORPTION_VFX_CONFIG, ...overrides };
    this.root = new TransformNode("playerLightAbsorptionVFX", scene);

    this.coreMaterial = new ShaderMaterial(
      "playerLightAbsorptionCoreMaterial",
      scene,
      { vertexSource: ORB_VERTEX_SHADER, fragmentSource: ORB_CORE_FRAGMENT_SHADER },
      {
        attributes: ["position", "normal"],
        uniforms: ["world", "worldViewProjection", "cameraPosition", "intensity"],
        needAlphaBlending: true,
      }
    );
    configureAdditiveMaterial(this.coreMaterial);

    this.shellMaterial = new ShaderMaterial(
      "playerLightAbsorptionShellMaterial",
      scene,
      { vertexSource: ORB_VERTEX_SHADER, fragmentSource: ORB_SHELL_FRAGMENT_SHADER },
      {
        attributes: ["position", "normal"],
        uniforms: ["world", "worldViewProjection", "cameraPosition", "intensity"],
        needAlphaBlending: true,
      }
    );
    configureAdditiveMaterial(this.shellMaterial);

    this.incomingOrb = MeshBuilder.CreateSphere(
      "playerLightAbsorptionIncomingOrb",
      { diameter: 1, segments: 10 },
      scene
    );
    this.incomingOrb.parent = this.root;
    this.incomingOrb.material = this.coreMaterial;
    this.configureMesh(this.incomingOrb, 12);

    this.glowShell = MeshBuilder.CreateSphere(
      "playerLightAbsorptionGlowShell",
      { diameter: 1, segments: 12 },
      scene
    );
    this.glowShell.parent = this.root;
    this.glowShell.material = this.shellMaterial;
    this.configureMesh(this.glowShell, 11);

    this.particleTexture = createMoteTexture(scene);
    this.particles = new ParticleSystem(
      "playerLightAbsorptionResidualMotes",
      Math.max(16, this.config.particleCount * 2),
      scene
    );
    this.particles.particleTexture = this.particleTexture;
    this.particles.emitter = this.particleOrigin;
    this.particles.isLocal = false;
    this.particles.startPositionFunction = (_worldMatrix, positionToUpdate) => {
      const angle = Math.random() * Math.PI * 2;
      const innerRadius = Math.max(0, this.config.particleSpawnInnerRadius);
      const outerRadius = Math.max(innerRadius, this.config.particleSpawnOuterRadius);
      const radius = Math.sqrt(
        innerRadius * innerRadius +
          Math.random() * (outerRadius * outerRadius - innerRadius * innerRadius)
      );
      positionToUpdate.set(
        this.particleOrigin.x + Math.cos(angle) * radius,
        this.particleOrigin.y - 0.2 + Math.random() * 0.24,
        this.particleOrigin.z + Math.sin(angle) * radius
      );
    };
    this.particles.startDirectionFunction = (
      _worldMatrix,
      directionToUpdate,
      particle
    ) => {
      const radialX = particle.position.x - this.particleOrigin.x;
      const radialZ = particle.position.z - this.particleOrigin.z;
      const inverseRadius = 1 / Math.max(0.0001, Math.hypot(radialX, radialZ));
      const drift = (0.55 + Math.random() * 0.45) * this.config.particleDrift;
      const swirl = (Math.random() - 0.5) * this.config.particleDrift * 0.35;
      const outwardX = radialX * inverseRadius;
      const outwardZ = radialZ * inverseRadius;
      directionToUpdate.set(
        outwardX * drift - outwardZ * swirl,
        1,
        outwardZ * drift + outwardX * swirl
      );
      directionToUpdate.normalize();
    };
    this.particles.minEmitPower = this.config.particleMinUpwardSpeed;
    this.particles.maxEmitPower = this.config.particleMaxUpwardSpeed;
    this.particles.minLifeTime = this.config.particleMinLifetime;
    this.particles.maxLifeTime = this.config.particleMaxLifetime;
    this.particles.minSize = this.config.particleMinSize;
    this.particles.maxSize = this.config.particleMaxSize;
    this.particles.minScaleX = 0.82;
    this.particles.maxScaleX = 1;
    this.particles.minScaleY = 1;
    this.particles.maxScaleY = 1.35;
    this.particles.minAngularSpeed = -0.4;
    this.particles.maxAngularSpeed = 0.4;
    this.particles.emitRate = 0;
    this.particles.manualEmitCount = 0;
    this.particles.gravity.set(0, 0.06, 0);
    this.particles.color1 = new Color4(1, 0.998, 0.975, 0.72);
    this.particles.color2 = new Color4(0.82, 0.93, 1, 0.58);
    this.particles.colorDead = new Color4(0.72, 0.86, 1, 0);
    this.particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.particles.updateSpeed = 0.012;
    this.particles.renderingGroupId = 1;
    this.particles.disposeOnStop = false;
    this.particles.applyFog = false;

    this.hideMeshes();
    this.scene.onBeforeRenderObservable.add(this.update);
  }

  /** Restarts the authored cue without allocating meshes, materials, or particles. */
  public play() {
    if (this.disposed) return;
    this.updateTorsoPosition();
    this.configureIncomingPath();
    this.elapsed = 0;
    this.playing = true;
    this.residualEmitted = false;
    this.incomingOrb.setEnabled(true);
    this.glowShell.setEnabled(true);
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.onBeforeRenderObservable.removeCallback(this.update);
    if (this.particlesStarted) this.particles.stop();
    this.particles.dispose(false);
    this.particleTexture.dispose();
    this.incomingOrb.dispose(false, false);
    this.glowShell.dispose(false, false);
    this.coreMaterial.dispose(false, false);
    this.shellMaterial.dispose(false, false);
    this.root.dispose(false, false);
  }

  private readonly update = () => {
    if (!this.playing || this.disposed) return;
    const dt = Math.max(0, Math.min(this.scene.getEngine().getDeltaTime() * 0.001, 0.05));
    this.elapsed += dt;
    this.updateTorsoPosition();

    const travelDuration = Math.max(0.01, this.config.orbTravelDuration);
    if (this.elapsed < travelDuration) {
      this.updateIncomingOrb(this.elapsed / travelDuration);
      return;
    }

    if (!this.residualEmitted) this.emitResidualMotes();
    this.incomingOrb.setEnabled(false);
    const flashProgress = (this.elapsed - travelDuration) /
      Math.max(0.01, this.config.flashDuration);
    if (flashProgress < 1) {
      this.updateImpactFlash(flashProgress);
      return;
    }

    this.hideMeshes();
    this.playing = false;
  };

  private updateTorsoPosition() {
    this.target.getGroundPositionToRef(this.torsoPosition);
    this.torsoPosition.y += this.config.torsoHeight;
    this.root.position.copyFrom(this.torsoPosition);
  }

  private configureIncomingPath() {
    const cameraPosition = this.scene.activeCamera?.globalPosition;
    let viewX = cameraPosition ? this.torsoPosition.x - cameraPosition.x : 0;
    let viewZ = cameraPosition ? this.torsoPosition.z - cameraPosition.z : 1;
    const viewLength = Math.hypot(viewX, viewZ);
    if (viewLength > 0.0001) {
      viewX /= viewLength;
      viewZ /= viewLength;
    } else {
      viewX = 0;
      viewZ = 1;
    }
    const rightX = viewZ;
    const rightZ = -viewX;
    const distance = this.config.orbStartDistance;
    this.startOffset.set(
      rightX * distance - viewX * 0.08,
      this.config.orbStartVerticalOffset,
      rightZ * distance - viewZ * 0.08
    );
    this.controlOffset.set(
      rightX * distance * 0.42 - viewX * 0.03,
      this.config.orbArcHeight,
      rightZ * distance * 0.42 - viewZ * 0.03
    );
  }

  private updateIncomingOrb(rawProgress: number) {
    const progress = smoothstep01(rawProgress);
    const inverse = 1 - progress;
    const startWeight = inverse * inverse;
    const controlWeight = 2 * inverse * progress;
    this.incomingOrb.position.set(
      this.startOffset.x * startWeight + this.controlOffset.x * controlWeight,
      this.startOffset.y * startWeight + this.controlOffset.y * controlWeight,
      this.startOffset.z * startWeight + this.controlOffset.z * controlWeight
    );
    this.glowShell.position.copyFrom(this.incomingOrb.position);

    const pulse = 1 + Math.sin(this.elapsed * 31) * 0.055;
    const arrivalFade = 1 - smoothstep01((rawProgress - 0.8) / 0.2) * 0.28;
    const coreScale = this.config.orbSize * pulse;
    const shellScale = coreScale * this.config.orbHaloScale;
    this.incomingOrb.scaling.setAll(coreScale);
    this.glowShell.scaling.setAll(shellScale);
    this.coreMaterial.setFloat("intensity", 0.86 * arrivalFade);
    this.shellMaterial.setFloat("intensity", 0.64 * arrivalFade);
  }

  private updateImpactFlash(rawProgress: number) {
    const progress = clamp01(rawProgress);
    const easedExpansion = 1 - Math.pow(1 - progress, 3);
    const envelope = Math.pow(1 - progress, 1.7);
    const diameter = this.config.orbSize * 1.4 +
      (this.config.flashRadius - this.config.orbSize * 1.4) * easedExpansion;
    this.glowShell.position.set(0, 0, 0);
    this.glowShell.scaling.setAll(diameter);
    this.glowShell.setEnabled(true);
    this.shellMaterial.setFloat(
      "intensity",
      this.config.flashIntensity * envelope
    );
  }

  private emitResidualMotes() {
    this.residualEmitted = true;
    this.particleOrigin.copyFrom(this.torsoPosition);
    this.particleOrigin.y -= 0.05;
    this.particles.manualEmitCount = Math.max(0, Math.round(this.config.particleCount));
    if (!this.particlesStarted) {
      this.particles.start();
      this.particlesStarted = true;
    }
  }

  private configureMesh(mesh: Mesh, alphaIndex: number) {
    mesh.isPickable = false;
    mesh.applyFog = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = 1;
    mesh.alphaIndex = alphaIndex;
  }

  private hideMeshes() {
    this.incomingOrb.setEnabled(false);
    this.glowShell.setEnabled(false);
  }
}
