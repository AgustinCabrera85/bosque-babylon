import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Material as Mat } from "@babylonjs/core/Materials/material";

type TreeTemplate = {
  name: string;
  root: TransformNode;
  trunkMeshes: Mesh[];
  foliageMeshes: Mesh[];
};

function isLikelyFoliage(mesh: AbstractMesh): boolean {
  const mat = mesh.material as any;
  const n = (mesh.name + " " + (mat?.name ?? "")).toLowerCase();

  const byName =
    n.includes("leaf") ||
    n.includes("leaves") ||
    n.includes("foliage") ||
    n.includes("crown") ||
    n.includes("needle") ||
    n.includes("needles");

  if (!mat) return byName;

  const hasOpacityTex = !!mat.opacityTexture;
  const hasAlphaFromDiffuse = !!mat.diffuseTexture?.hasAlpha;
  const hasBaseColorAlpha = !!mat.albedoTexture?.hasAlpha;
  const alphaMode = mat.alphaMode ?? mat.transparencyMode;

  const byAlpha =
    hasOpacityTex ||
    hasAlphaFromDiffuse ||
    hasBaseColorAlpha ||
    alphaMode === Mat.MATERIAL_ALPHATEST ||
    alphaMode === Mat.MATERIAL_ALPHABLEND;

  return byAlpha || byName;
}

/**
 * Patch de foliage:
 * - ALPHATEST (nunca blend)
 * - depth write + prepass (evita ver cosas "a través")
 * - En ultra: backFaceCulling = true (barato)
 */
function patchFoliage(mesh: AbstractMesh, ultra: boolean) {
  const mat = mesh.material as Material | null;
  if (!mat) return;
  if (!isLikelyFoliage(mesh)) return;

  const cloned = mat.clone(`${mat.name}_foliageClone`) as Material;
  mesh.material = cloned;

  // ayuda a evitar estados raros de alpha heredados
  (mesh as any).hasVertexAlpha = false;
  (mesh as any).alphaIndex = 0;

  // --- PBR ---
  if (cloned instanceof PBRMaterial) {
    cloned.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    cloned.alphaCutOff = 0.7;

    // 🔥 esto evita el “foliage transparente”
    cloned.forceDepthWrite = true;
    cloned.needDepthPrePass = true;

    // ultra: culling ON (si vamos a billboarding, no hace falta doble lado)
    cloned.backFaceCulling = ultra ? true : false;

    cloned.useAlphaFromAlbedoTexture = true;
    cloned.specularIntensity = 0.0;

    // por compatibilidad con assets raros
    (cloned as any).alphaMode = Mat.MATERIAL_ALPHATEST;
    (cloned as any).alpha = 1.0;
  }

  // --- Standard ---
  if (cloned instanceof StandardMaterial) {
    cloned.alphaMode = Mat.MATERIAL_ALPHATEST;
    cloned.alphaCutOff = 0.7;

    cloned.forceDepthWrite = true;
    (cloned as any).needDepthPrePass = true;

    cloned.backFaceCulling = ultra ? true : false;

    (cloned as any).alpha = 1.0;
  }
}

export class TreeLibrary {
  private templates: TreeTemplate[] = [];

  /**
   * Ultra foliage:
   * - backface culling ON
   * - billboard ON en instancias de foliage (para que no se note el culling)
   */
  constructor(private ultraFoliage: boolean = true) {}

  async load(scene: Scene) {
    const files = [
      "tree_00.glb",
      "tree_01.glb",
      "tree_02.glb",
      "tree_03.glb",
      "tree_04.glb",
      "tree_05.glb",
      "tree_06.glb",
      "tree_07.glb",
    ];

for (const file of files) {
  try {
    const res = await SceneLoader.ImportMeshAsync(
      null,
      "/assets/models/vegetation/",
      file,
      scene
    );

  const root = new TransformNode(`treeRoot_${file}`, scene);

  const trunkMeshes: Mesh[] = [];
  const foliageMeshes: Mesh[] = [];

  // 🔽 escondemos el template completo bajo el mundo
  root.position.set(0, -10000, 0);

  for (const m of res.meshes) {
    if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;

    // Parent al root escondido
    m.setParent(root);

    // ✅ IMPORTANTÍSIMO: NO deshabilitar, solo ocultar
    m.setEnabled(true);
    m.isVisible = false;
    m.isPickable = false;

    // Clasificar y parchear
    if (isLikelyFoliage(m)) {
      patchFoliage(m, this.ultraFoliage);
      foliageMeshes.push(m);
    } else {
      trunkMeshes.push(m);
    }
  }

  if (!trunkMeshes.length && !foliageMeshes.length) {
    console.warn(`[TreeLibrary] ${file}: no encontré meshes renderizables`);
    root.dispose();
    continue;
  }

    this.templates.push({ name: file, root, trunkMeshes, foliageMeshes });
  } catch (error) {
    console.warn(`[TreeLibrary] Could not load ${file}`, error);
  }
}


    if (!this.templates.length) {
      console.warn("[TreeLibrary] No se cargaron árboles. Revisá /public/assets/models/vegetation/");
    }
  }

  /**
   * LOD:
   * - 0: tronco + hojas (máxima)
   * - 1: tronco + hojas (optimizada)
   * - 2: solo tronco
   */
  instantiateByIndex(
    instanceName: string,
    scene: Scene,
    templateIndex: number,
    lod: 0 | 1 | 2
  ): TransformNode {
    if (!this.templates.length) {
      console.warn("[TreeLibrary] No tree templates available.");
      return new TransformNode(instanceName, scene);
    }
    const tpl = this.templates[templateIndex % this.templates.length];
    const instRoot = new TransformNode(instanceName, scene);

    // ===== Tronco SIEMPRE =====
    for (const src of tpl.trunkMeshes) {
      const inst = src.createInstance(`${instanceName}_${src.name}`);
      inst.setEnabled(true);
      inst.isPickable = false;
      inst.receiveShadows = lod === 0;

      inst.position.copyFrom(src.position);
      if (src.rotationQuaternion) inst.rotationQuaternion = src.rotationQuaternion.clone();
      else inst.rotation.copyFrom(src.rotation);
      inst.scaling.copyFrom(src.scaling);

      inst.setParent(instRoot);
    }

    // ===== Follaje SOLO si lod <= 1 =====
    if (lod <= 1) {
      for (const src of tpl.foliageMeshes) {
        const inst = src.createInstance(`${instanceName}_${src.name}`);
        inst.setEnabled(true);
        inst.isPickable = false;
        inst.receiveShadows = lod === 0;

        inst.position.copyFrom(src.position);
        if (src.rotationQuaternion) inst.rotationQuaternion = src.rotationQuaternion.clone();
        else inst.rotation.copyFrom(src.rotation);
        inst.scaling.copyFrom(src.scaling);

        // ✅ Ultra: foliage mirando a cámara para poder cullar backfaces
        if (this.ultraFoliage) {
          // FULL billboard suele verse raro; Y-only mantiene vertical (mejor para hojas/cards)
          inst.billboardMode = Mesh.BILLBOARDMODE_Y;
        }

        inst.setParent(instRoot);
      }
    }

    return instRoot;
  }
}
