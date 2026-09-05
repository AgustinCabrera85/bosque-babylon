import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGrabberBehaviorDebug } from "./ShadowGrabberBehavior";
import type { ShadowGrabberController } from "./ShadowGrabberController";

function makeMaterial(scene: Scene, name: string, color: Color3) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor.copyFrom(color);
  material.emissiveColor.copyFrom(color);
  material.specularColor.setAll(0);
  material.disableLighting = true;
  material.alpha = 0.78;
  material.wireframe = true;
  return material;
}

/** Development-only geometry. No meshes or textures exist when debug is disabled. */
export class ShadowGrabberDebugView {
  private readonly root: TransformNode;
  private readonly anchor: Mesh;
  private readonly tacticalTarget: Mesh;
  private readonly grabTarget: Mesh;
  private readonly detectionRange: Mesh;
  private readonly attackRange: Mesh;
  private readonly lightAvoidanceRange: Mesh;
  private readonly modelForward: LinesMesh;
  private readonly attackForward: LinesMesh;
  private readonly grabLine: LinesMesh;
  private readonly label: Mesh;
  private readonly materials: StandardMaterial[];
  private readonly labelTexture: DynamicTexture;
  private lastLabel = "";

  public constructor(
    scene: Scene,
    private readonly controller: ShadowGrabberController
  ) {
    this.root = new TransformNode(`shadowGrabberDebug:${controller.id}`, scene);
    const green = makeMaterial(scene, `${this.root.name}:anchorMat`, new Color3(0.2, 1, 0.35));
    const yellow = makeMaterial(scene, `${this.root.name}:targetMat`, new Color3(1, 0.78, 0.1));
    const red = makeMaterial(scene, `${this.root.name}:grabMat`, new Color3(1, 0.16, 0.12));
    const cyan = makeMaterial(scene, `${this.root.name}:detectionMat`, new Color3(0.12, 0.75, 1));
    const magenta = makeMaterial(scene, `${this.root.name}:attackMat`, new Color3(1, 0.2, 0.82));
    const orange = makeMaterial(scene, `${this.root.name}:lightMat`, new Color3(1, 0.42, 0.08));
    this.materials = [green, yellow, red, cyan, magenta, orange];

    this.anchor = this.makeMarker("anchor", 0.18, green);
    this.tacticalTarget = this.makeMarker("target", 0.22, yellow);
    this.grabTarget = this.makeMarker("grabTarget", 0.16, red);
    this.detectionRange = this.makeRing(
      "detectionRange",
      controller.config.activationRange + controller.config.runningDetectionBonus,
      cyan
    );
    this.attackRange = this.makeRing("attackRange", controller.config.attackRange, magenta);
    this.lightAvoidanceRange = this.makeRing(
      "lightAvoidanceRange",
      controller.config.hardLightAvoidanceRadius,
      orange
    );
    this.modelForward = MeshBuilder.CreateLines(
      `${this.root.name}:modelForward`,
      { points: [Vector3.Zero(), new Vector3(0, 0, 2.4)], updatable: true },
      scene
    );
    this.modelForward.parent = this.root;
    this.modelForward.color = new Color3(0.2, 0.65, 1);
    this.modelForward.isPickable = false;
    this.attackForward = MeshBuilder.CreateLines(
      `${this.root.name}:attackForward`,
      { points: [Vector3.Zero(), new Vector3(0, 0, 3.2)], updatable: true },
      scene
    );
    this.attackForward.parent = this.root;
    this.attackForward.color = new Color3(1, 0.94, 0.75);
    this.attackForward.isPickable = false;
    this.grabLine = MeshBuilder.CreateLines(
      `${this.root.name}:grabLine`,
      { points: [Vector3.Zero(), new Vector3(0, 0, 1)], updatable: true },
      scene
    );
    this.grabLine.parent = this.root;
    this.grabLine.color = new Color3(1, 0.16, 0.12);
    this.grabLine.isPickable = false;

    this.labelTexture = new DynamicTexture(
      `${this.root.name}:labelTexture`,
      { width: 512, height: 144 },
      scene,
      false
    );
    const labelMaterial = new StandardMaterial(`${this.root.name}:labelMat`, scene);
    labelMaterial.diffuseTexture = this.labelTexture;
    labelMaterial.emissiveTexture = this.labelTexture;
    labelMaterial.opacityTexture = this.labelTexture;
    labelMaterial.disableLighting = true;
    labelMaterial.backFaceCulling = false;
    this.materials.push(labelMaterial);
    this.label = MeshBuilder.CreatePlane(
      `${this.root.name}:label`,
      { width: 2.3, height: 0.64 },
      scene
    );
    this.label.parent = this.root;
    this.label.material = labelMaterial;
    this.label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.label.isPickable = false;
  }

  public update(snapshot: ShadowGrabberBehaviorDebug) {
    this.anchor.position.copyFrom(snapshot.anchor);
    this.anchor.position.y += 0.08;
    this.tacticalTarget.position.copyFrom(snapshot.tacticalTarget);
    this.tacticalTarget.position.y += 0.12;
    this.grabTarget.position.copyFrom(snapshot.grabTarget);
    const modelAngle = snapshot.rootRotationY;
    const attackLocalAngle = Math.atan2(
      this.controller.config.attackForwardAxis[0],
      this.controller.config.attackForwardAxis[1]
    );
    this.updateDirectionLine(
      this.modelForward,
      snapshot.portalPosition,
      modelAngle,
      2.4
    );
    this.updateDirectionLine(
      this.attackForward,
      snapshot.portalPosition,
      modelAngle + attackLocalAngle,
      3.2
    );
    this.updateLineBetween(this.grabLine, snapshot.portalPosition, snapshot.grabTarget);

    const groundY = snapshot.anchor.y + 0.04;
    this.detectionRange.position.set(
      this.controller.root.position.x,
      groundY,
      this.controller.root.position.z
    );
    this.attackRange.position.copyFrom(this.detectionRange.position);
    if (snapshot.nearestFixedLight) {
      this.lightAvoidanceRange.setEnabled(true);
      this.lightAvoidanceRange.position.copyFrom(snapshot.nearestFixedLight);
      this.lightAvoidanceRange.position.y = groundY + 0.02;
    } else {
      this.lightAvoidanceRange.setEnabled(false);
    }
    this.label.position.set(
      snapshot.portalPosition.x,
      snapshot.portalPosition.y + 1.65,
      snapshot.portalPosition.z
    );
    const camera = this.label.getScene().activeCamera;
    const labelDistance = camera
      ? Vector3.Distance(camera.globalPosition, this.label.position)
      : 14;
    const labelScale = Math.max(0.22, Math.min(0.85, labelDistance / 16));
    this.label.scaling.set(labelScale, labelScale, labelScale);

    const slot = snapshot.attackSlotOwner === snapshot.id ? "OWN" : snapshot.attackSlotOwner ? "BUSY" : "FREE";
    const label = [
      `${snapshot.role} | ${snapshot.state} | ${snapshot.currentAnimation ?? "-"}`,
      `v ${snapshot.currentSpeed.toFixed(2)}/${snapshot.targetSpeed.toFixed(2)}  cd ${snapshot.attackCooldownRemaining.toFixed(1)}  slot ${slot}`,
      `dark ${Math.round(snapshot.darknessPressure * 100)}%  safe ${snapshot.playerInHardLight ? "YES" : "NO"}`,
    ].join("\n");
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      const context = this.labelTexture.getContext() as unknown as CanvasRenderingContext2D;
      context.clearRect(0, 0, 512, 144);
      context.fillStyle = "rgba(0, 0, 0, 0.76)";
      context.fillRect(0, 0, 512, 144);
      context.font = "bold 20px monospace";
      context.fillStyle = "white";
      context.textAlign = "center";
      context.textBaseline = "middle";
      label.split("\n").forEach((line, index) => {
        context.fillText(line, 256, 34 + index * 38);
      });
      this.labelTexture.update(false);
    }
  }

  public dispose() {
    this.root.dispose(false, false);
    this.labelTexture.dispose();
    for (const material of this.materials) material.dispose(false, false);
  }

  private makeMarker(name: string, diameter: number, material: StandardMaterial) {
    const mesh = MeshBuilder.CreateSphere(
      `${this.root.name}:${name}`,
      { diameter, segments: 8 },
      this.root.getScene()
    );
    mesh.parent = this.root;
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }

  private makeRing(name: string, radius: number, material: StandardMaterial) {
    const mesh = MeshBuilder.CreateTorus(
      `${this.root.name}:${name}`,
      { diameter: radius * 2, thickness: 0.035, tessellation: 48 },
      this.root.getScene()
    );
    mesh.parent = this.root;
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }

  private updateDirectionLine(
    line: LinesMesh,
    origin: Vector3,
    angle: number,
    length: number
  ) {
    MeshBuilder.CreateLines(
      line.name,
      {
        points: [
          origin,
          new Vector3(
            origin.x + Math.sin(angle) * length,
            origin.y,
            origin.z + Math.cos(angle) * length
          ),
        ],
        instance: line,
      },
      line.getScene()
    );
  }

  private updateLineBetween(line: LinesMesh, start: Vector3, end: Vector3) {
    MeshBuilder.CreateLines(
      line.name,
      { points: [start, end], instance: line },
      line.getScene()
    );
  }
}
