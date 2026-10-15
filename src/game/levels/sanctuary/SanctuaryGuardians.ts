import "@babylonjs/loaders/glTF";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";
import { asset } from "../../../utils/asset";
import { HermanoMayorLookAction } from "../../enemies/boss/HermanoMayorLookAction";
import { SANCTUARY_ASCENT as ASCENT, SANCTUARY_CONFIG as CFG } from "./SanctuaryLayout";
import { SanctuaryDistanceHazePlugin } from "./SanctuaryDistanceHaze";

export type SanctuaryGuardiansHandle = {
  update(playerPosition: Vector3, atFinalGate: boolean): void;
};

/** Darken the rendered stone, including light contributions from the scene. */
class SanctuaryGuardianShadePlugin extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(material, "SanctuaryGuardianShade", 240, {}, true, true);
    this._enable(true);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    return { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "finalColor.rgb *= 0.78;" };
  }
}

function seatGuardianFeet(root: TransformNode, meshes: readonly AbstractMesh[], height: number) {
  const vertex = new Vector3();
  let lowestY = Number.POSITIVE_INFINITY;
  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) continue;
    const world = mesh.computeWorldMatrix(true);
    mesh.skeleton?.prepare(true);
    const positions = mesh.getPositionData(true);
    if (!positions) continue;
    for (let index = 0; index < positions.length; index += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(
        positions[index], positions[index + 1], positions[index + 2], world, vertex);
      lowestY = Math.min(lowestY, vertex.y);
    }
  }
  if (!Number.isFinite(lowestY)) throw new Error("The guardian has no visible foot geometry.");
  // A small overlap hides the seam without burying the boots in the stone.
  const overlap = Math.min(.35, height * .01);
  root.position.y += ASCENT.upperY - overlap - lowestY;
}

/** The two sentries stand on the upper stone wings beside the portal wall. */
export async function createSanctuaryGuardians(
  scene: Scene, portalHeight: number, portalHalfWidth: number
): Promise<SanctuaryGuardiansHandle> {
  const container = await SceneLoader.LoadAssetContainerAsync(
    asset("assets/models/sanctuary/"), "Golem_Guardian.glb", scene);
  if (scene.isDisposed) {
    container.dispose();
    throw new Error("The sanctuary closed while loading its guardians.");
  }

  const roots: TransformNode[] = [];
  const animations: AnimationGroup[] = [];
  const lookActions: HermanoMayorLookAction[] = [];
  const playerTarget = Vector3.Zero();
  try {
    const source = container.rootNodes[0];
    const guardIdle = container.animationGroups.find((group) => group.name === "Guardia_Inactivo");
    if (!source || !guardIdle) throw new Error("The guardian model is missing its guard idle pose.");

    for (const material of container.materials) {
      if (!(material instanceof PBRMaterial)) continue;
      // The GLB declares BLEND even though its base-color texture is fully opaque.
      material.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
      material.alpha = 1;
      material.useAlphaFromAlbedoTexture = false;
      material.forceDepthWrite = true;
      // The export defaults to fully metallic and doubles its specular color.
      // Keep the cracked albedo, but light it as weathered matte stone.
      material.albedoColor = new Color3(.47, .44, .41);
      material.emissiveColor = Color3.Black();
      material.metallic = 0;
      material.roughness = 1;
      material.metallicReflectanceColor = Color3.White();
      material.metallicF0Factor = .25;
      material.specularIntensity = .04;
      material.environmentIntensity = .02;
      material.fogEnabled = false;
      new SanctuaryDistanceHazePlugin(material);
      new SanctuaryGuardianShadePlugin(material);
    }

    for (const side of [-1, 1] as const) {
      const label = side < 0 ? "Left" : "Right";
      const instance = container.instantiateModelsToScene(
        (name) => `sanctuaryGuardian${label}:${name}`, false,
        { doNotInstantiate: true, predicate: (entity) =>
          !(entity instanceof AnimationGroup) || entity === guardIdle });
      const root = new TransformNode(`sanctuaryGuardian${label}`, scene);
      roots.push(root);
      for (const node of instance.rootNodes) node.parent = root;
      const meshes: AbstractMesh[] = [];
      for (const node of instance.rootNodes) {
        for (const mesh of [node, ...node.getDescendants(false)]) {
          if (!(mesh instanceof AbstractMesh)) continue;
          meshes.push(mesh);
          mesh.isPickable = false;
          mesh.checkCollisions = false;
          // The idle skeleton can extend beyond the imported bind-pose bounds.
          // Keep both static sentries in the active list from every camera angle.
          mesh.alwaysSelectAsActiveMesh = true;
        }
      }
      const idle = instance.animationGroups[0];
      if (!idle) throw new Error(`The ${label.toLowerCase()} guardian has no guard idle animation.`);
      animations.push(idle);
      idle.start(true);
      idle.goToFrame(idle.from);

      // Skinned feet and shoulders differ substantially from the GLB bind pose.
      // Measure the guard stance, then restore the original mesh bounds.
      for (const mesh of meshes) {
        if (!(mesh instanceof Mesh)) continue;
        mesh.skeleton?.prepare(true);
        mesh.refreshBoundingInfo(true);
      }
      const bounds = root.getHierarchyBoundingVectors(true);
      for (const mesh of meshes) if (mesh instanceof Mesh) mesh.refreshBoundingInfo(false);
      const modelHeight = bounds.max.y - bounds.min.y;
      if (!(modelHeight > 0)) throw new Error("The guardian guard pose has no measurable height.");
      const scale = (portalHeight / 2) / modelHeight;
      const centerX = (bounds.min.x + bounds.max.x) / 2;
      const guardianHalfWidth = (bounds.max.x - bounds.min.x) * scale / 2;
      const offsetX = portalHalfWidth + guardianHalfWidth + 12;
      // A half-turn reverses local Z. Place the backmost point just in front
      // of the wall, with the full footprint on the flat upper stone wing.
      const z = ASCENT.wallFrontZ - 4 + bounds.min.z * scale;
      root.scaling.setAll(scale);
      root.rotation.y = Math.PI; // Face the player approaching from the river (-Z).
      root.position.set(side * offsetX + centerX * scale,
        ASCENT.upperY - bounds.min.y * scale, z);
      seatGuardianFeet(root, meshes, modelHeight * scale);

      // Reuse the Mixamo spine/neck/head overlay and its bounded gaze. Only
      // the head chain turns; the colossal body stays in Guardia_Inactivo.
      const look = new HermanoMayorLookAction(scene, root, meshes, {}, {
        maxTrackingDistance: 1000,
        allowBodyTurn: false,
      });
      look.setTargetProvider(() => playerTarget);
      lookActions.push(look);
    }
  } catch (error) {
    for (const look of lookActions) look.dispose();
    for (const animation of animations) animation.dispose();
    for (const root of roots) root.dispose(false, false);
    container.dispose();
    throw error;
  }

  scene.onDisposeObservable.addOnce(() => {
    for (const look of lookActions) look.dispose();
    for (const animation of animations) animation.dispose();
    for (const root of roots) root.dispose(false, false);
    container.dispose();
  });

  let awakened = false;
  return {
    update(playerPosition, atFinalGate) {
      // The player's leading foot enters the opening at the wall's front face.
      if (!awakened && atFinalGate &&
          playerPosition.z >= ASCENT.wallFrontZ - 0.7 &&
          Math.abs(playerPosition.x) <= CFG.gateWidth / 2 - 8) {
        awakened = true;
        for (const look of lookActions) look.setEnabled(true);
      }
      if (awakened) playerTarget.copyFrom(playerPosition);
    },
  };
}
