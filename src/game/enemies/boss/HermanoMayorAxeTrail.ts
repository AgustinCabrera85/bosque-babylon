import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";

const SAMPLE_COUNT = 14;
const BLADE_HALO_WIDTH_SCALE = 1.65;

const VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec4 color;

uniform mat4 world;
uniform mat4 viewProjection;

varying vec4 vColor;

void main(void) {
  vColor = color;
  gl_Position = viewProjection * world * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec4 vColor;

void main(void) {
  if (vColor.a < 0.002) discard;
  gl_FragColor = vColor;
}
`;

/** Additive ribbon built from the real cutting-edge history. */
export class HermanoMayorAxeTrail {
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly positions = new Float32Array(SAMPLE_COUNT * 2 * 3);
  private readonly colors = new Float32Array(SAMPLE_COUNT * 2 * 4);
  private primed = false;
  private disposed = false;
  private intensity = 0;

  public constructor(scene: Scene) {
    this.material = new ShaderMaterial(
      "hermanoMayorAxeTrailMaterial",
      scene,
      { vertexSource: VERTEX_SHADER, fragmentSource: FRAGMENT_SHADER },
      {
        attributes: ["position", "color"],
        uniforms: ["world", "viewProjection"],
        needAlphaBlending: true,
      }
    );
    this.material.alphaMode = Engine.ALPHA_ADD;
    this.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.needDepthPrePass = false;

    this.mesh = new Mesh("hermanoMayorAxeTrail", scene);
    const vertexData = new VertexData();
    vertexData.positions = Array.from(this.positions);
    vertexData.colors = Array.from(this.colors);
    vertexData.indices = createRibbonIndices();
    vertexData.applyToMesh(this.mesh, true);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.renderingGroupId = 1;
    this.mesh.setEnabled(false);
  }

  public begin(lower: Vector3, upper: Vector3) {
    if (this.disposed) return;
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      this.writeExpandedEdge(index, lower, upper);
    }
    this.primed = true;
    this.intensity = 0;
    this.updateBuffers();
    this.mesh.setEnabled(false);
  }

  public sample(lower: Vector3, upper: Vector3, intensity: number) {
    if (this.disposed) return;
    if (!this.primed) this.begin(lower, upper);
    this.positions.copyWithin(0, 6);
    this.writeExpandedEdge(SAMPLE_COUNT - 1, lower, upper);
    this.intensity = clamp01(intensity);
    this.updateBuffers();
    this.mesh.setEnabled(this.intensity > 0.001);
  }

  public end() {
    this.primed = false;
    this.intensity = 0;
    this.mesh.setEnabled(false);
  }

  public getDebugSnapshot() {
    return { active: this.mesh.isEnabled(), intensity: this.intensity };
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.dispose(false, false);
    this.material.dispose(false, false);
  }

  private writeExpandedEdge(index: number, lower: Vector3, upper: Vector3) {
    const midpointX = (lower.x + upper.x) * 0.5;
    const midpointY = (lower.y + upper.y) * 0.5;
    const midpointZ = (lower.z + upper.z) * 0.5;
    const halfX = (upper.x - lower.x) * 0.5 * BLADE_HALO_WIDTH_SCALE;
    const halfY = (upper.y - lower.y) * 0.5 * BLADE_HALO_WIDTH_SCALE;
    const halfZ = (upper.z - lower.z) * 0.5 * BLADE_HALO_WIDTH_SCALE;
    const offset = index * 6;
    this.positions[offset] = midpointX - halfX;
    this.positions[offset + 1] = midpointY - halfY;
    this.positions[offset + 2] = midpointZ - halfZ;
    this.positions[offset + 3] = midpointX + halfX;
    this.positions[offset + 4] = midpointY + halfY;
    this.positions[offset + 5] = midpointZ + halfZ;
  }

  private updateBuffers() {
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const age = index / (SAMPLE_COUNT - 1);
      const alpha = Math.pow(age, 1.65) * 0.72 * this.intensity;
      const red = 0.52 + age * 0.48;
      const green = 0.005 + age * 0.025;
      for (let side = 0; side < 2; side += 1) {
        const offset = (index * 2 + side) * 4;
        this.colors[offset] = red;
        this.colors[offset + 1] = green;
        this.colors[offset + 2] = 0.008;
        this.colors[offset + 3] = alpha;
      }
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, true);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false);
  }
}

function createRibbonIndices() {
  const indices: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT - 1; index += 1) {
    const current = index * 2;
    const next = current + 2;
    indices.push(current, next, current + 1, current + 1, next, next + 1);
  }
  return indices;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
