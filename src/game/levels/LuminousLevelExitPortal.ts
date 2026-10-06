import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { VolumetricLightScatteringPostProcess } from "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess";
import type { Scene } from "@babylonjs/core/scene";

export type LuminousLevelExitPortalState =
  | "hidden"
  | "opening"
  | "active"
  | "entered";

export type LuminousLevelExitPortalOptions = {
  position: Vector3;
  forward: Vector3;
  getPlayerPosition: () => Vector3;
  onEntered: () => void;
  camera?: Camera;
  quality?: "low" | "high";
  width?: number;
  height?: number;
  litMeshes?: readonly AbstractMesh[];
};

export type LuminousLevelExitPortalSnapshot = {
  state: LuminousLevelExitPortalState;
  reveal: number;
  playerDepth: number | null;
};

const PORTAL_VERTEX_SHADER = `
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

const PORTAL_FRAGMENT_SHADER = `
precision highp float;

uniform float time;
uniform float reveal;
varying vec2 vUV;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

void main(void) {
  vec2 p = (vUV - 0.5) * 2.0;
  // Bend the aperture very slightly so it reads as a tear instead of a
  // manufactured ellipse. The high frequencies remain almost static: the
  // edge flickers, but never wobbles like a cartoon outline.
  p.x += sin(p.y * 4.7 + 0.8) * 0.026;
  p.x += sin(p.y * 11.3 - 1.1) * 0.009;

  float radius = length(p);
  float angle = atan(p.y, p.x);
  float edgeNoise = sin(angle * 7.0 + 0.4) * 0.026;
  edgeNoise += sin(angle * 17.0 - 1.2) * 0.012;
  edgeNoise += sin(angle * 31.0 + time * 0.14) * 0.005;
  edgeNoise += (valueNoise(vec2(angle * 3.1, 2.7)) - 0.5) * 0.026;
  float boundary = 0.91 + edgeNoise;
  float edgeDistance = boundary - radius;

  float interior = smoothstep(-0.012, 0.024, edgeDistance);
  float hairline = exp(-abs(edgeDistance) * 118.0);
  float edgeAura = exp(-abs(edgeDistance) * 25.0);

  float branchWaveA = abs(sin(angle * 9.0 + radius * 19.0 + 0.7));
  float branchWaveB = abs(sin(angle * 15.0 - radius * 28.0 - 1.4));
  float branchA = 1.0 - smoothstep(0.0, 0.075, branchWaveA);
  float branchB = 1.0 - smoothstep(0.0, 0.052, branchWaveB);
  float branchBand = smoothstep(boundary - 0.22, boundary - 0.08, radius) *
    (1.0 - smoothstep(boundary + 0.018, boundary + 0.065, radius));
  float branches = max(branchA, branchB * 0.72) * branchBand;

  if (interior < 0.002 && edgeAura < 0.025 && branches < 0.025) discard;

  float normalizedRadius = radius / max(0.2, boundary);
  float twist = angle * 7.0 - time * 2.5 + normalizedRadius * 18.0;
  float counterTwist = -angle * 12.0 + time * 3.6 + normalizedRadius * 28.0;
  float filaments = pow(0.5 + 0.5 * sin(twist), 5.0) * 0.56;
  filaments += pow(0.5 + 0.5 * sin(counterTwist), 8.0) * 0.34;
  float grain = valueNoise(p * 36.0 + vec2(time * 0.22, -time * 0.13));
  float center = 1.0 - smoothstep(0.02, 0.78, normalizedRadius);
  float pulse = 0.94 + 0.06 * sin(time * 3.1 + normalizedRadius * 10.0);

  vec3 color = mix(vec3(0.055, 0.27, 0.58), vec3(0.72, 0.91, 1.0), center);
  color += vec3(0.56, 0.82, 1.0) * filaments * (0.3 + center * 0.68);
  color += vec3(0.2, 0.49, 0.9) * grain * 0.045;
  color *= interior * pulse;
  color += vec3(0.83, 0.95, 1.0) * hairline * 2.15;
  color += vec3(0.3, 0.66, 1.0) * edgeAura * 0.34;
  color += vec3(0.76, 0.92, 1.0) * branches * 1.42;

  float interiorAlpha = interior * (0.73 + center * 0.22 + filaments * 0.07);
  float fractureAlpha = max(hairline * 0.98, branches * 0.86);
  float alpha = max(interiorAlpha, max(edgeAura * 0.24, fractureAlpha)) * reveal;
  gl_FragColor = vec4(color * (0.74 + reveal * 0.34), alpha);
}
`;

const TAU = Math.PI * 2;
const OPEN_DURATION_SECONDS = 2.35;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/**
 * Pure crossing predicate used by every level portal. A valid entry must move
 * from the front half-space through the aperture and remain inside its ellipse.
 */
export function hasCrossedLuminousLevelExitPortal(
  previousDepth: number,
  currentDepth: number,
  lateralOffset: number,
  verticalOffset: number,
  width: number,
  height: number
) {
  if (previousDepth >= 0 || currentDepth < 0) return false;
  const horizontal = lateralOffset / Math.max(0.1, width * 0.46);
  const vertical = verticalOffset / Math.max(0.1, height * 0.48);
  return horizontal * horizontal + vertical * vertical <= 1;
}

function createSoftParticleTexture(
  scene: Scene,
  name: string,
  innerColor: string,
  middleColor: string
) {
  const texture = new DynamicTexture(name, { width: 64, height: 64 }, scene, false);
  const context = texture.getContext();
  const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(0.34, middleColor);
  gradient.addColorStop(1, "rgba(30, 70, 120, 0)");
  context.clearRect(0, 0, 64, 64);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  texture.hasAlpha = true;
  texture.update(false);
  return texture;
}

function configureAdditiveMaterial(material: ShaderMaterial) {
  material.alphaMode = Engine.ALPHA_ADD;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.needDepthPrePass = false;
}

/** A reusable, player-crossed luminous exit inspired by Babylon's portal demo. */
export class LuminousLevelExitPortal {
  private readonly root: TransformNode;
  private readonly particleAnchor: Mesh;
  private readonly core: Mesh;
  private readonly coreMaterial: ShaderMaterial;
  private readonly lightSource: Mesh;
  private readonly lightSourceMaterial: StandardMaterial;
  private readonly portalLight: PointLight;
  private readonly smokeTexture: DynamicTexture;
  private readonly sparkTexture: DynamicTexture;
  private readonly smoke: ParticleSystem;
  private readonly sparks: ParticleSystem;
  private readonly forward: Vector3;
  private readonly right: Vector3;
  private readonly getPlayerPosition: () => Vector3;
  private readonly onEntered: () => void;
  private readonly camera?: Camera;
  private readonly volumetricOccluders: readonly AbstractMesh[];
  private readonly quality: "low" | "high";
  private readonly width: number;
  private readonly height: number;
  private volumetricLight: VolumetricLightScatteringPostProcess | null = null;
  private elapsed = 0;
  private reveal = 0;
  private previousPlayerDepth: number | null = null;
  private currentPlayerDepth: number | null = null;
  private disposed = false;
  private smokeStarted = false;
  private sparksStarted = false;
  public state: LuminousLevelExitPortalState = "hidden";

  public constructor(scene: Scene, options: LuminousLevelExitPortalOptions) {
    this.getPlayerPosition = options.getPlayerPosition;
    this.onEntered = options.onEntered;
    this.camera = options.camera;
    this.volumetricOccluders = [...new Set(options.litMeshes ?? [])];
    this.quality = options.quality ?? "high";
    this.width = options.width ?? 4.9;
    this.height = options.height ?? 6.3;

    this.forward = options.forward.clone();
    this.forward.y = 0;
    if (this.forward.lengthSquared() < 0.0001) this.forward.set(0, 0, 1);
    this.forward.normalize();
    this.right = new Vector3(this.forward.z, 0, -this.forward.x);

    this.root = new TransformNode("luminousLevelExitPortal", scene);
    this.root.position.copyFrom(options.position);
    this.root.rotation.y = Math.atan2(this.forward.x, this.forward.z);
    this.root.scaling.setAll(0.04);

    this.coreMaterial = new ShaderMaterial(
      "luminousLevelExitPortalCoreMaterial",
      scene,
      { vertexSource: PORTAL_VERTEX_SHADER, fragmentSource: PORTAL_FRAGMENT_SHADER },
      {
        attributes: ["position", "uv"],
        uniforms: ["worldViewProjection", "time", "reveal"],
        needAlphaBlending: true,
      }
    );
    configureAdditiveMaterial(this.coreMaterial);
    this.coreMaterial.setFloat("time", 0);
    this.coreMaterial.setFloat("reveal", 0);

    this.core = MeshBuilder.CreateDisc(
      "luminousLevelExitPortalCore",
      {
        radius: 0.5,
        tessellation: this.quality === "high" ? 72 : 44,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene
    );
    this.core.parent = this.root;
    this.core.scaling.set(this.width, this.height, 1);
    this.core.material = this.coreMaterial;
    this.configureVisualMesh(this.core, 1);

    this.lightSourceMaterial = new StandardMaterial(
      "luminousLevelExitPortalLightSourceMaterial",
      scene
    );
    this.lightSourceMaterial.disableLighting = true;
    this.lightSourceMaterial.diffuseColor = new Color3(0.7, 0.9, 1);
    this.lightSourceMaterial.emissiveColor = new Color3(0.95, 0.99, 1);
    this.lightSourceMaterial.specularColor = Color3.Black();

    this.lightSource = MeshBuilder.CreateSphere(
      "luminousLevelExitPortalLightSource",
      { diameter: 0.24, segments: 10 },
      scene
    );
    this.lightSource.parent = this.root;
    this.lightSource.position.z = 0.08;
    this.lightSource.material = this.lightSourceMaterial;
    this.configureVisualMesh(this.lightSource, 2);

    this.particleAnchor = new Mesh("luminousLevelExitPortalParticleAnchor", scene);
    this.particleAnchor.parent = this.root;
    this.particleAnchor.isVisible = false;
    this.particleAnchor.isPickable = false;

    this.smokeTexture = createSoftParticleTexture(
      scene,
      "luminousLevelExitPortalSmokeTexture",
      "rgba(235, 250, 255, 0.72)",
      "rgba(92, 162, 232, 0.36)"
    );
    this.sparkTexture = createSoftParticleTexture(
      scene,
      "luminousLevelExitPortalSparkTexture",
      "rgba(255, 255, 255, 1)",
      "rgba(155, 218, 255, 0.76)"
    );
    this.smoke = this.createSmoke(scene);
    this.sparks = this.createSparks(scene);

    this.portalLight = new PointLight(
      "luminousLevelExitPortalLight",
      options.position.clone(),
      scene
    );
    this.portalLight.diffuse = new Color3(0.55, 0.78, 1);
    this.portalLight.specular = new Color3(0.28, 0.5, 0.8);
    this.portalLight.range = 13;
    this.portalLight.intensity = 0;
    this.portalLight.renderPriority = 4;
    for (const mesh of new Set(options.litMeshes ?? [])) {
      this.portalLight.includedOnlyMeshes.push(mesh);
    }

    this.root.setEnabled(false);
    this.portalLight.setEnabled(false);
  }

  public activate() {
    if (this.disposed || this.state !== "hidden") return false;
    this.state = "opening";
    this.elapsed = 0;
    this.reveal = 0;
    this.root.setEnabled(true);
    this.portalLight.setEnabled(true);
    this.previousPlayerDepth = this.getPlayerCoordinates().depth;
    this.currentPlayerDepth = this.previousPlayerDepth;
    this.smoke.start();
    this.smokeStarted = true;
    this.sparks.start();
    this.sparksStarted = true;
    this.createVolumetricLight();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("bosque:level-exit-portal-opened"));
    }
    return true;
  }

  public update(deltaTime: number) {
    if (this.disposed || this.state === "hidden" || this.state === "entered") return;
    const dt = Math.max(0, Math.min(deltaTime, 0.05));
    this.elapsed += dt;
    const linearReveal = clamp01(this.elapsed / OPEN_DURATION_SECONDS);
    this.reveal = smoothstep01(linearReveal);
    if (linearReveal >= 1 && this.state === "opening") this.state = "active";

    const openingScale = 0.04 + this.reveal * 0.96;
    const pulse = this.state === "active" ? 1 + Math.sin(this.elapsed * 2.7) * 0.012 : 1;
    this.root.scaling.set(openingScale * pulse, openingScale * pulse, openingScale);
    this.coreMaterial.setFloat("time", this.elapsed);
    this.coreMaterial.setFloat("reveal", this.reveal);
    this.lightSource.scaling.setAll(0.12 + this.reveal * 0.88);
    this.portalLight.intensity = this.reveal *
      (1.05 + Math.sin(this.elapsed * 3.1) * 0.08);
    if (this.volumetricLight) {
      this.volumetricLight.exposure = this.reveal * 0.1;
    }

    const coordinates = this.getPlayerCoordinates();
    this.currentPlayerDepth = coordinates.depth;
    if (
      this.reveal >= 0.82 &&
      this.previousPlayerDepth !== null &&
      hasCrossedLuminousLevelExitPortal(
        this.previousPlayerDepth,
        coordinates.depth,
        coordinates.lateral,
        coordinates.vertical,
        this.width,
        this.height
      )
    ) {
      this.enter();
      return;
    }
    this.previousPlayerDepth = coordinates.depth;
  }

  public getDebugSnapshot(): LuminousLevelExitPortalSnapshot {
    return {
      state: this.state,
      reveal: this.reveal,
      playerDepth: this.currentPlayerDepth,
    };
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.smokeStarted) this.smoke.stop();
    if (this.sparksStarted) this.sparks.stop();
    if (this.volumetricLight && this.camera) {
      this.volumetricLight.dispose(this.camera);
    }
    this.volumetricLight = null;
    this.smoke.dispose(false);
    this.sparks.dispose(false);
    this.smokeTexture.dispose();
    this.sparkTexture.dispose();
    this.core.dispose(false, false);
    this.lightSource.dispose(false, false);
    this.particleAnchor.dispose(false, false);
    this.coreMaterial.dispose(false, false);
    this.lightSourceMaterial.dispose(false, false);
    this.portalLight.dispose();
    this.root.dispose(false, false);
  }

  private configureVisualMesh(mesh: Mesh, renderingGroupId: number) {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.applyFog = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = renderingGroupId;
  }

  private createSmoke(scene: Scene) {
    const smoke = new ParticleSystem(
      "luminousLevelExitPortalSmoke",
      this.quality === "high" ? 220 : 110,
      scene
    );
    smoke.particleTexture = this.smokeTexture;
    smoke.emitter = this.particleAnchor;
    smoke.isLocal = true;
    smoke.startPositionFunction = (_worldMatrix, positionToUpdate) => {
      const angle = Math.random() * TAU;
      const radius = 0.455 + (Math.random() - 0.5) * 0.038;
      positionToUpdate.set(
        Math.cos(angle) * this.width * radius,
        Math.sin(angle) * this.height * radius,
        (Math.random() - 0.5) * 0.24
      );
    };
    smoke.startDirectionFunction = (_worldMatrix, directionToUpdate, particle) => {
      const radialX = particle.position.x / Math.max(0.1, this.width);
      const radialY = particle.position.y / Math.max(0.1, this.height);
      directionToUpdate.set(
        radialX * 0.76 - radialY * 0.34,
        radialY * 0.76 + radialX * 0.34,
        (Math.random() - 0.5) * 0.18
      );
      directionToUpdate.normalize();
    };
    smoke.minEmitPower = 0.08;
    smoke.maxEmitPower = 0.24;
    smoke.minLifeTime = 1.1;
    smoke.maxLifeTime = 1.9;
    smoke.emitRate = this.quality === "high" ? 46 : 22;
    smoke.minAngularSpeed = -0.65;
    smoke.maxAngularSpeed = 0.65;
    smoke.gravity.set(0, 0.04, 0);
    smoke.minScaleX = 0.42;
    smoke.maxScaleX = 0.72;
    smoke.minScaleY = 1.2;
    smoke.maxScaleY = 2.1;
    smoke.color1 = new Color4(0.42, 0.7, 1, 0.16);
    smoke.color2 = new Color4(0.7, 0.88, 1, 0.1);
    smoke.colorDead = new Color4(0.14, 0.28, 0.5, 0);
    smoke.addSizeGradient(0, 0.16, 0.25);
    smoke.addSizeGradient(0.48, 0.42, 0.62);
    smoke.addSizeGradient(1, 0.62, 0.84);
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    smoke.renderingGroupId = 1;
    smoke.applyFog = false;
    smoke.disposeOnStop = false;
    return smoke;
  }

  private createSparks(scene: Scene) {
    const sparks = new ParticleSystem(
      "luminousLevelExitPortalSparks",
      this.quality === "high" ? 150 : 72,
      scene
    );
    sparks.particleTexture = this.sparkTexture;
    sparks.emitter = this.particleAnchor;
    sparks.isLocal = true;
    sparks.startPositionFunction = (_worldMatrix, positionToUpdate) => {
      const angle = Math.random() * TAU;
      const radius = 0.43 + Math.random() * 0.035;
      positionToUpdate.set(
        Math.cos(angle) * this.width * radius,
        Math.sin(angle) * this.height * radius,
        (Math.random() - 0.5) * 0.18
      );
    };
    sparks.startDirectionFunction = (_worldMatrix, directionToUpdate, particle) => {
      const radialX = particle.position.x / Math.max(0.1, this.width);
      const radialY = particle.position.y / Math.max(0.1, this.height);
      directionToUpdate.set(radialX, radialY + 0.08, (Math.random() - 0.5) * 0.08);
      directionToUpdate.normalize();
    };
    sparks.minEmitPower = 2.2;
    sparks.maxEmitPower = 4.4;
    sparks.minLifeTime = 0.24;
    sparks.maxLifeTime = 0.68;
    sparks.emitRate = this.quality === "high" ? 28 : 14;
    sparks.minSize = 0.035;
    sparks.maxSize = 0.095;
    sparks.minScaleX = 0.42;
    sparks.maxScaleX = 0.8;
    sparks.minScaleY = 2.4;
    sparks.maxScaleY = 5.2;
    sparks.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    sparks.color1 = new Color4(0.92, 0.98, 1, 0.98);
    sparks.color2 = new Color4(0.38, 0.72, 1, 0.78);
    sparks.colorDead = new Color4(0.2, 0.46, 0.9, 0);
    sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
    sparks.renderingGroupId = 2;
    sparks.applyFog = false;
    sparks.disposeOnStop = false;
    return sparks;
  }

  private createVolumetricLight() {
    if (this.quality !== "high" || !this.camera || this.volumetricLight) return;
    this.volumetricLight = new VolumetricLightScatteringPostProcess(
      "luminousLevelExitPortalGodRays",
      {
        // Keep the final composition at camera resolution. Only the occlusion
        // pass needs to be small, otherwise Babylon upscales the whole scene.
        postProcessRatio: 1,
        passRatio: 0.25,
      },
      this.camera,
      this.lightSource,
      8,
      undefined,
      undefined,
      false,
      this.root.getScene()
    );
    this.volumetricLight.exposure = 0;
    this.volumetricLight.decay = 0.965;
    this.volumetricLight.weight = 0.78;
    this.volumetricLight.density = 0.88;
    this.volumetricLight.includedMeshes.push(
      this.lightSource,
      ...this.volumetricOccluders.filter((mesh) => !mesh.isDisposed())
    );
    const pass = this.volumetricLight.getPass();
    pass.renderParticles = false;
    pass.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES;
  }

  private getPlayerCoordinates() {
    const relative = this.getPlayerPosition().subtract(this.root.position);
    return {
      depth: Vector3.Dot(relative, this.forward),
      lateral: Vector3.Dot(relative, this.right),
      vertical: relative.y,
    };
  }

  private enter() {
    if (this.state === "entered") return;
    this.state = "entered";
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("bosque:level-exit-portal-entered"));
    }
    this.onEntered();
  }
}
