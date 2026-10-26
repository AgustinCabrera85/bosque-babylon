import { Engine } from "@babylonjs/core/Engines/engine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";

const SEGMENTS = 10;
const VIOLET = Color3.FromHexString("#A53BFF");

type Arc = {
  points: Vector3[];
  core: Mesh;
  halo: Mesh;
  coreMaterial: StandardMaterial;
  haloMaterial: StandardMaterial;
};

function material(scene: Scene, name: string, color: Color3) {
  const result = new StandardMaterial(name, scene);
  result.disableLighting = true;
  result.diffuseColor = Color3.Black();
  result.emissiveColor = color;
  result.specularColor = Color3.Black();
  result.backFaceCulling = false;
  result.disableDepthWrite = true;
  result.alphaMode = Engine.ALPHA_ADD;
  result.transparencyMode = Material.MATERIAL_ALPHABLEND;
  return result;
}

/** Three reusable, depth-tested arcs between Rina's animated hand and the victim. */
export class RinaElectricArcLink {
  private readonly arcs: Arc[] = [];
  private readonly side = Vector3.Zero();
  private readonly up = Vector3.Zero();
  private readonly direction = Vector3.Zero();

  constructor(private readonly scene: Scene) {
    for (let index = 0; index < 3; index++) {
      const points = Array.from({ length: SEGMENTS + 1 },
        (_, point) => new Vector3(0, point * 0.01, 0));
      const radiusFunction = (point: number) =>
        0.32 + 0.68 * Math.sin(Math.PI * point / SEGMENTS);
      const coreMaterial = material(scene, `rinaAttackArcCoreMat_${index}`,
        new Color3(0.94, 0.63, 1));
      const haloMaterial = material(scene, `rinaAttackArcHaloMat_${index}`, VIOLET);
      const core = MeshBuilder.CreateTube(`rinaAttackArcCore_${index}`, {
        path: points, radius: 0.017, tessellation: 5,
        radiusFunction: point => 0.017 * radiusFunction(point), updatable: true,
      }, scene);
      const halo = MeshBuilder.CreateTube(`rinaAttackArcHalo_${index}`, {
        path: points, radius: 0.065, tessellation: 5,
        radiusFunction: point => 0.065 * radiusFunction(point), updatable: true,
      }, scene);
      for (const mesh of [core, halo]) {
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.setEnabled(false);
      }
      core.material = coreMaterial;
      halo.material = haloMaterial;
      this.arcs.push({ points, core, halo, coreMaterial, haloMaterial });
    }
  }

  update(hand: Vector3, chest: Vector3, seconds: number, intensity: number) {
    const active = intensity > 0.015;
    for (const arc of this.arcs) {
      arc.core.setEnabled(active);
      arc.halo.setEnabled(active);
    }
    if (!active) return;

    chest.subtractToRef(hand, this.direction);
    const length = this.direction.length();
    if (length < 0.25) {
      this.hide();
      return;
    }
    this.direction.scaleInPlace(1 / length);
    Vector3.CrossToRef(this.direction, Vector3.Up(), this.side);
    if (this.side.lengthSquared() < 0.001) {
      Vector3.CrossToRef(this.direction, Vector3.Right(), this.side);
    }
    this.side.normalize();
    Vector3.CrossToRef(this.side, this.direction, this.up);
    this.up.normalize();

    for (let index = 0; index < this.arcs.length; index++) {
      const arc = this.arcs[index];
      const branch = index - 1;
      // All filaments land on the same point. The last control point is above
      // the spectator, making the strike visibly fall onto their body.
      const target = chest.subtract(this.direction.scale(0.18));
      const origin = hand.add(this.direction.scale(0.12))
        .addInPlace(this.side.scale(branch * 0.025));
      const groundDelta = target.subtract(origin);
      groundDelta.y = 0;
      const rise = Math.max(2.3, Math.min(6.5, groundDelta.length() * 0.16));
      const control1 = origin.add(groundDelta.scale(0.32))
        .addInPlace(this.side.scale(branch * 0.55));
      control1.y = origin.y + rise * 0.72;
      const control2 = target.subtract(groundDelta.scale(0.09))
        .addInPlace(this.side.scale(branch * 0.28));
      control2.y = target.y + rise + 0.7;
      const amplitude = Math.min(0.33, length * 0.028) * (index === 1 ? 1 : 1.25);
      for (let point = 0; point <= SEGMENTS; point++) {
        const t = point / SEGMENTS;
        const inverse = 1 - t;
        const a = inverse * inverse * inverse;
        const b = 3 * inverse * inverse * t;
        const c = 3 * inverse * t * t;
        const d = t * t * t;
        arc.points[point].set(
          a * origin.x + b * control1.x + c * control2.x + d * target.x,
          a * origin.y + b * control1.y + c * control2.y + d * target.y,
          a * origin.z + b * control1.z + c * control2.z + d * target.z,
        );
        const envelope = Math.sin(Math.PI * t);
        const phase = seconds * (23 + index * 3.1) + point * 2.67 + index * 5.3;
        arc.points[point].addInPlace(this.side.scale(
          Math.sin(phase) * amplitude * envelope));
        arc.points[point].addInPlace(this.up.scale(
          Math.sin(phase * 1.37 + 1.8) * amplitude * 0.7 * envelope));
      }
      const core = MeshBuilder.CreateTube(arc.core.name, {
        path: arc.points, instance: arc.core,
      }, this.scene);
      const halo = MeshBuilder.CreateTube(arc.halo.name, {
        path: arc.points, instance: arc.halo,
      }, this.scene);
      // The meshes keep their own materials; only opacity changes with charge.
      core.isPickable = false;
      halo.isPickable = false;
      const pulse = 0.82 + 0.18 * Math.sin(seconds * 19 + index * 2.4);
      arc.coreMaterial.alpha = Math.min(1, intensity * pulse * (index === 1 ? 1 : 0.85));
      arc.haloMaterial.alpha = Math.min(0.42,
        intensity * (0.22 + 0.12 * Math.sin(seconds * 13 + index * 3)));
    }
  }

  hide() {
    for (const arc of this.arcs) {
      arc.core.setEnabled(false);
      arc.halo.setEnabled(false);
    }
  }

  get visible() { return this.arcs.some(arc => arc.core.isEnabled()); }
  get endpoints() {
    const points = this.arcs[1]?.points;
    return points ? [points[0].clone(), points[SEGMENTS].clone()] : null;
  }
  get midpoint() { return this.arcs[1]?.points[SEGMENTS / 2].clone() ?? null; }

  dispose() {
    for (const arc of this.arcs) {
      arc.core.dispose(false, false);
      arc.halo.dispose(false, false);
      arc.coreMaterial.dispose();
      arc.haloMaterial.dispose();
    }
    this.arcs.length = 0;
  }
}
