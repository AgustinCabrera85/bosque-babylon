import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";

const NAME = "lroStormMidnightSky";
const VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDirection;
void main(void) {
  vDirection = normalize(position);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;
const FRAGMENT = `
precision highp float;
varying vec3 vDirection;
uniform float uSkyFlash;
void main(void) {
  float horizon = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 low = vec3(0.008, 0.012, 0.022);
  vec3 high = vec3(0.004, 0.006, 0.018);
  vec3 color = mix(low, high, smoothstep(0.23, 0.85, horizon));
  float layer = sin(vDirection.x * 19.0 + vDirection.z * 11.0)
              * sin(vDirection.z * 31.0 - vDirection.x * 7.0);
  color += vec3(0.004, 0.004, 0.008) * (0.5 + 0.5 * layer)
    * smoothstep(0.34, 0.61, horizon) * (1.0 - smoothstep(0.75, 0.9, horizon));
  color += vec3(0.085, 0.095, 0.16) * clamp(uSkyFlash, 0.0, 1.0);
  gl_FragColor = vec4(color, 1.0);
}`;

/** Procedural fallback. Its flash is independent from Babylon PointLights. */
export class StormSky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private disposed = false;

  constructor(scene: Scene) {
    Effect.ShadersStore[`${NAME}VertexShader`] = VERTEX;
    Effect.ShadersStore[`${NAME}FragmentShader`] = FRAGMENT;
    this.material = new ShaderMaterial("stormMidnightSkyMaterial", scene, NAME, {
      attributes: ["position"], uniforms: ["worldViewProjection", "uSkyFlash"],
    });
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.setFloat("uSkyFlash", 0);
    this.mesh = MeshBuilder.CreateSphere("stormMidnightSky", { diameter: 180, segments: 24 }, scene);
    this.mesh.material = this.material;
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = 0;
  }

  setFlash(value: number): void {
    this.material.setFloat("uSkyFlash", Math.max(0, Math.min(1, value)));
  }
  setEnabled(enabled: boolean): void { this.mesh.setEnabled(enabled); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.dispose();
    this.material.dispose();
  }
}
