import { Engine } from "@babylonjs/core/Engines/engine";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { LoadedLightningVariant } from "./LightningVariantLibrary";

// The approved v1 geodesic reveal and color calculation are preserved here.
const SHADER = "lroStormLightningGrowV1";
const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main(void) {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;
const FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform sampler2D boltSampler;
uniform sampler2D growthSampler;
uniform sampler2D haloSampler;
uniform float uProgress;
uniform float uFeather;
uniform float uTime;
uniform float uFade;
uniform float uIntensity;
uniform float uFlash;
uniform float uFrontWidth;
uniform float uPass;
uniform float uRootSoftness;
uniform vec3 uTint;

void main(void) {
  // Red channel encodes distance along the BRANCHING skeleton (not just Y).
  float distanceOnBranches = texture2D(growthSampler, vUV).r;
  float visible = 1.0 - smoothstep(
    clamp(uProgress - uFeather, 0.0, 1.0),
    clamp(uProgress + uFeather, 0.00001, 1.01),
    distanceOnBranches
  );
  // Force the extreme end to appear when progress reaches 1.
  if (uProgress > 0.9999) visible = 1.0;

  float twinkle = 0.94 + 0.06 * sin(uTime * 86.0 + vUV.y * 33.0)
                      * sin(uTime * 137.0 - vUV.x * 51.0);
  float fade = clamp(uFade, 0.0, 1.0);
  float energy = max(uIntensity, 0.0) * twinkle;
  float cloudRootFade = uRootSoftness > 0.0
    ? smoothstep(0.0, uRootSoftness, distanceOnBranches) : 1.0;

  if (uPass > 0.5) {
    // A separately blurred alpha texture produces the peripheral pink glow.
    // Lighting on meshes comes from PointLights in the JS controller.
    vec4 halo = texture2D(haloSampler, vUV);
    float ha = halo.a * visible * fade * cloudRootFade * (0.5 + 0.5 * uFlash);
    if (ha < 0.003) discard;
    gl_FragColor = vec4(halo.rgb * uTint * (0.45 + energy * 0.7), ha);
  } else {
    vec4 bolt = texture2D(boltSampler, vUV);
    float alpha = bolt.a * visible * fade * cloudRootFade;
    if (alpha < 0.003) discard;

    // Moving pulse illuminates the leading edge before branches remain lit.
    float leadingPulse = exp(-pow(
      (distanceOnBranches - uProgress) / max(uFrontWidth, 0.0001), 2.0
    ));
    float whiteAmount = clamp(0.17 + 0.65 * leadingPulse + 0.35 * uFlash, 0.0, 1.0);
    vec3 coreColor = mix(bolt.rgb, vec3(1.0, 0.97, 1.0), whiteAmount);
    float radiance = energy * (0.74 + 1.55 * leadingPulse + 1.2 * uFlash);
    gl_FragColor = vec4(coreColor * uTint * radiance, alpha);
  }
}`;

export interface LightningTiming {
  growDuration: number;
  holdDuration: number;
  fadeDuration: number;
  intensity: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** One reusable bolt plane. The variant library owns its three textures. */
export class LightningSpriteEffectV2 {
  readonly mesh: Mesh;
  readonly haloMesh: Mesh;
  readonly material: ShaderMaterial;
  readonly haloMaterial: ShaderMaterial;
  readonly variant: LoadedLightningVariant;
  timing: LightningTiming = { growDuration: 0.14, holdDuration: 0.12, fadeDuration: 0.4, intensity: 2.5 };
  progress = 0;
  fade = 0;
  flash = 0;
  isPlaying = false;
  reducedFlashes = false;
  private elapsed = 0;
  private disposed = false;

  constructor(scene: Scene, variant: LoadedLightningVariant) {
    this.variant = variant;
    Effect.ShadersStore[`${SHADER}VertexShader`] = VERTEX;
    Effect.ShadersStore[`${SHADER}FragmentShader`] = FRAGMENT;
    const createMaterial = (name: string, pass: number) => {
      const material = new ShaderMaterial(name, scene, SHADER, {
        attributes: ["position", "uv"],
        uniforms: ["worldViewProjection", "uProgress", "uFeather", "uTime", "uFade",
          "uIntensity", "uFlash", "uFrontWidth", "uPass", "uRootSoftness", "uTint"],
        samplers: ["boltSampler", "growthSampler", "haloSampler"],
        needAlphaBlending: true,
      });
      material.backFaceCulling = false;
      material.disableDepthWrite = true;
      material.alphaMode = pass ? Engine.ALPHA_ADD : Engine.ALPHA_COMBINE;
      material.setFloat("uPass", pass);
      material.setFloat("uRootSoftness", 0);
      material.setFloat("uFeather", 0.015);
      material.setFloat("uFrontWidth", 0.055);
      material.setColor3("uTint", Color3.White());
      material.setTexture("boltSampler", variant.bolt);
      material.setTexture("growthSampler", variant.growth);
      material.setTexture("haloSampler", variant.halo);
      return material;
    };
    this.material = createMaterial("stormLightningCoreShader", 0);
    this.haloMaterial = createMaterial("stormLightningHaloShader", 1);
    this.mesh = MeshBuilder.CreatePlane("stormLightningCorePlane", { size: 1 }, scene);
    this.haloMesh = MeshBuilder.CreatePlane("stormLightningHaloPlane", { size: 1 }, scene);
    this.mesh.material = this.material;
    this.haloMesh.material = this.haloMaterial;
    this.haloMesh.parent = this.mesh;
    this.haloMesh.position.z = -0.005;
    this.mesh.isPickable = this.haloMesh.isPickable = false;
    this.mesh.renderingGroupId = this.haloMesh.renderingGroupId = 2;
    this.mesh.setEnabled(false);
    this.applyUniforms();
  }

  /** Align the actual root and main-trunk tip UV with two world positions. */
  setEndpoints(rootWorld: Vector3, targetWorld: Vector3, cameraWorld: Vector3): void {
    const rootUv = this.variant.headPath.rootUv;
    const endUv = this.variant.headPath.samples.at(-1)!;
    const du = endUv.u - rootUv.u;
    const dv = endUv.v - rootUv.v;
    const pathLength = Math.hypot(du * this.variant.aspect, dv);
    if (pathLength < 0.1) throw new Error("La ruta de la punta es demasiado corta");
    const delta = targetWorld.subtract(rootWorld);
    const distance = delta.length();
    if (distance < 0.1) throw new Error("Origen y destino del rayo están demasiado cerca");
    const upward = delta.scale(-1 / distance);
    let normal = cameraWorld.subtract(rootWorld);
    normal = normal.subtract(upward.scale(Vector3.Dot(normal, upward)));
    if (normal.lengthSquared() < 0.01) normal = new Vector3(0, 0, 1);
    normal.normalize();
    const right = Vector3.Cross(upward, normal).normalize();
    normal = Vector3.Cross(right, upward).normalize();
    const angle = -Math.atan2(du * this.variant.aspect, dv);
    const xAxis = right.scale(Math.cos(angle)).add(upward.scale(Math.sin(angle)));
    const yAxis = upward.scale(Math.cos(angle)).subtract(right.scale(Math.sin(angle)));
    const frame = Matrix.Identity();
    Matrix.FromXYZAxesToRef(xAxis, yAxis, normal, frame);
    const height = distance / pathLength;
    const width = height * this.variant.aspect;
    this.mesh.rotationQuaternion = Quaternion.FromRotationMatrix(frame);
    this.mesh.scaling.set(width, height, 1);
    const rootOffset = xAxis.scale((rootUv.u - 0.5) * width)
      .add(yAxis.scale((0.5 - rootUv.v) * height));
    this.mesh.position.copyFrom(rootWorld.subtract(rootOffset));
    this.mesh.computeWorldMatrix(true);
  }

  headWorld(progress = this.progress): Vector3 {
    const samples = this.variant.headPath.samples;
    const t = clamp01(progress) * (samples.length - 1);
    const i = Math.floor(t);
    const a = samples[i], b = samples[Math.min(i + 1, samples.length - 1)];
    const u = a.u + (b.u - a.u) * (t - i);
    const v = a.v + (b.v - a.v) * (t - i);
    return Vector3.TransformCoordinates(new Vector3(u - 0.5, 0.5 - v, 0),
      this.mesh.computeWorldMatrix(true));
  }

  start(): void {
    this.elapsed = 0;
    this.isPlaying = true;
    this.mesh.setEnabled(true);
    this.progress = 0;
    this.fade = 0;
    this.flash = 0;
    this.applyUniforms();
  }
  pause(): void { this.isPlaying = false; }
  resume(): void { if (!this.disposed) this.isPlaying = true; }
  scrub(progress: number, fade = 1): void {
    this.pause();
    this.progress = clamp01(progress);
    this.elapsed = this.progress * this.timing.growDuration;
    this.fade = clamp01(fade);
    this.flash = 0;
    this.mesh.setEnabled(this.fade > 0);
    this.applyUniforms();
  }
  setHaloVisible(visible: boolean): void { this.haloMesh.setEnabled(visible); }
  /** Fade the first part of a bolt into a dark cloud; zero preserves lab art. */
  setCloudRootSoftness(value: number): void {
    for (const material of [this.material, this.haloMaterial]) {
      material.setFloat("uRootSoftness", Math.max(0, Math.min(0.25, value)));
    }
  }

  update(dt: number): void {
    if (!this.isPlaying || this.disposed) return;
    this.elapsed += Math.max(0, Math.min(dt, 0.12));
    const { growDuration, holdDuration, fadeDuration } = this.timing;
    const active = growDuration + holdDuration + fadeDuration;
    const growth = clamp01(this.elapsed / Math.max(0.001, growDuration));
    this.progress = Math.pow(growth, 0.84);
    const after = clamp01((this.elapsed - growDuration - holdDuration) /
      Math.max(0.001, fadeDuration));
    this.fade = this.elapsed < growDuration + holdDuration ? 1 : Math.pow(1 - after, 1.6);
    this.flash = Math.exp(-Math.pow((this.elapsed - growDuration) / 0.085, 2));
    if (this.reducedFlashes) this.flash *= 0.2;
    if (this.elapsed >= active) { this.isPlaying = false; this.fade = 0; }
    this.applyUniforms();
    if (!this.isPlaying) this.mesh.setEnabled(false);
  }

  private applyUniforms(): void {
    for (const material of [this.material, this.haloMaterial]) {
      material.setFloat("uProgress", this.progress);
      material.setFloat("uFade", this.fade);
      material.setFloat("uFlash", this.flash);
      material.setFloat("uTime", this.reducedFlashes ? 0 : this.elapsed);
      material.setFloat("uIntensity", this.timing.intensity);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.haloMesh.dispose();
    this.mesh.dispose();
    this.material.dispose(false, false);
    this.haloMaterial.dispose(false, false);
  }
}
