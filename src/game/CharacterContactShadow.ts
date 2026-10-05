import { Engine } from "@babylonjs/core/Engines/engine";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

export type CharacterContactShadowTarget = {
  root: TransformNode;
  getGroundHeight: (x: number, z: number) => number;
  getFootPositionToRef?: (result: Vector3) => void;
};

export type CharacterContactShadowOptions = {
  name: string;
  radiusX: number;
  radiusZ: number;
  opacity: number;
  maxDistance?: number;
  surfaceBias?: number;
};

const CONTACT_SHADOW_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 viewProjection;

varying vec2 vUV;

void main(void) {
  vUV = uv;
  gl_Position = viewProjection * world * vec4(position, 1.0);
}
`;

const CONTACT_SHADOW_FRAGMENT_SHADER = `
precision highp float;

uniform float opacity;

varying vec2 vUV;

void main(void) {
  vec2 point = vUV * 2.0 - 1.0;
  float radiusSquared = dot(point, point);
  float feather = 1.0 - smoothstep(0.12, 1.0, radiusSquared);
  float contact = 1.0 - smoothstep(0.0, 0.34, radiusSquared);
  float alpha = (feather * 0.64 + contact * 0.36) * opacity;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(vec3(0.004, 0.005, 0.007), alpha);
}
`;

/**
 * A small ambient-occlusion style shadow that grounds a character even when
 * no dynamic light happens to cast toward their feet.
 */
export class CharacterContactShadow {
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly basePositions: Float32Array;
  private readonly positions: Float32Array;
  private readonly footPosition = Vector3.Zero();
  private readonly updateObserver: Observer<Scene>;
  private readonly disposeObserver: Observer<Scene>;
  private visible = true;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly target: CharacterContactShadowTarget,
    private readonly options: CharacterContactShadowOptions
  ) {
    this.material = new ShaderMaterial(
      `${options.name}ContactShadowMaterial`,
      scene,
      {
        vertexSource: CONTACT_SHADOW_VERTEX_SHADER,
        fragmentSource: CONTACT_SHADOW_FRAGMENT_SHADER,
      },
      {
        attributes: ["position", "uv"],
        uniforms: ["world", "viewProjection", "opacity"],
        needAlphaBlending: true,
      }
    );
    this.material.setFloat("opacity", Math.max(0, Math.min(1, options.opacity)));
    this.material.alphaMode = Engine.ALPHA_COMBINE;
    this.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;

    this.mesh = MeshBuilder.CreateGround(
      `${options.name}ContactShadow`,
      {
        width: 2,
        height: 2,
        subdivisions: 4,
        updatable: true,
      },
      scene
    );
    const meshPositions = this.mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
    this.basePositions = Float32Array.from(meshPositions);
    this.positions = Float32Array.from(meshPositions);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.renderingGroupId = 0;
    this.mesh.setEnabled(false);

    this.updateObserver = scene.onBeforeRenderObservable.add(() => this.update());
    this.disposeObserver = scene.onDisposeObservable.add(() => this.dispose());
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) this.mesh.setEnabled(false);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.onBeforeRenderObservable.remove(this.updateObserver);
    this.scene.onDisposeObservable.remove(this.disposeObserver);
    this.mesh.dispose(false, false);
    this.material.dispose(false, false);
  }

  private update() {
    if (this.disposed) return;
    if (!this.visible || !this.target.root.isEnabled() || !this.isWithinDistance()) {
      this.mesh.setEnabled(false);
      return;
    }

    this.target.root.computeWorldMatrix(true);
    if (this.target.getFootPositionToRef) {
      this.target.getFootPositionToRef(this.footPosition);
    } else {
      this.footPosition.copyFrom(this.target.root.getAbsolutePosition());
    }

    const yaw = this.target.root.rotation.y;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const radiusX = Math.max(0.01, this.options.radiusX);
    const radiusZ = Math.max(0.01, this.options.radiusZ);
    const surfaceBias = this.options.surfaceBias ?? 0.018;

    for (let index = 0; index < this.basePositions.length; index += 3) {
      const localX = this.basePositions[index] * radiusX;
      const localZ = this.basePositions[index + 2] * radiusZ;
      const x = this.footPosition.x + localX * cosYaw + localZ * sinYaw;
      const z = this.footPosition.z - localX * sinYaw + localZ * cosYaw;
      const sampledHeight = this.target.getGroundHeight(x, z);

      this.positions[index] = x;
      this.positions[index + 1] =
        (Number.isFinite(sampledHeight) ? sampledHeight : this.footPosition.y) + surfaceBias;
      this.positions[index + 2] = z;
    }

    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, true);
    this.mesh.setEnabled(true);
  }

  private isWithinDistance() {
    const maxDistance = this.options.maxDistance;
    const camera = this.scene.activeCamera;
    if (maxDistance === undefined || !camera) return true;
    return (
      Vector3.DistanceSquared(camera.globalPosition, this.target.root.getAbsolutePosition()) <=
      maxDistance * maxDistance
    );
  }
}
