import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { Scene } from "@babylonjs/core/scene";
import { SANCTUARY_CONFIG as CFG, SANCTUARY_STOPS, type SanctuaryPillarId, type SanctuaryProgress } from "./SanctuaryLayout";
import { createSanctuaryWater } from "./SanctuaryWater";
import { createSanctuaryClouds, type SanctuaryCloudMode } from "./SanctuaryClouds";
import { createSanctuaryStoneMaterials } from "./SanctuaryStone";
import { createSanctuaryAtmosphere } from "./SanctuaryAtmosphere";

export type OrbVisual = { sphere: AbstractMesh; halo: AbstractMesh; light: PointLight; home: Vector3 };
export type SanctuaryGeometry = {
  boatRoot: TransformNode;
  orbs: Map<SanctuaryPillarId, OrbVisual>;
  cloudMode: SanctuaryCloudMode;
  waterMode: "reflective" | "lightweight";
  update(dt: number, elapsed: number, progress: SanctuaryProgress): void;
};

function mat(scene: Scene, name: string, color: Color3, glow?: Color3) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = new Color3(0.02, 0.015, 0.013);
  material.emissiveColor = glow ?? Color3.Black();
  return material;
}

function slab(scene: Scene, name: string, width: number, height: number, depth: number,
  xyz: [number, number, number], material: StandardMaterial, parent?: TransformNode) {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position.set(...xyz);
  mesh.material = material;
  if (parent) mesh.parent = parent;
  mesh.isPickable = false;
  return mesh;
}

function createShadowHand(scene: Scene, x: number, z: number, scale: number, shadow: StandardMaterial) {
  const root = new TransformNode(`shadowHand_${x}_${z}`, scene);
  root.position.set(x, CFG.riverY - 3, z);
  root.rotation.y = (x + z) * .029;
  slab(scene, "shadowPalm", 4.0 * scale, 8 * scale, 2.4 * scale, [0, 4 * scale, 0], shadow, root);
  for (let n = 0; n < 4; n++) {
    const finger = MeshBuilder.CreateCylinder(`shadowFinger_${n}`, {
      height: (10 + (n % 2) * 4) * scale,
      diameterTop: .12 * scale,
      diameterBottom: 1.7 * scale,
      tessellation: 5,
    }, scene);
    finger.parent = root;
    finger.position.set((n - 1.5) * 1.2 * scale, (12 + (n % 2) * 2) * scale, 0);
    finger.rotation.z = (n - 1.5) * .24;
    finger.material = shadow;
    finger.isPickable = false;
  }
}

export function createSanctuaryGeometry(scene: Scene, progress: SanctuaryProgress, mobile: boolean): SanctuaryGeometry {
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const skyTest = params?.get("sanctuaryClouds");
  const mode = skyTest === "off" || skyTest === "layered" || skyTest === "volumetric"
    ? skyTest : skyTest === "high" ? "volumetric" : undefined;
  const clouds = createSanctuaryClouds(scene, {
    mobile, mode, quality: skyTest === "high" ? "high" : "standard",
  });
  // The local smoke sheets remain a complementary low-altitude effect.
  const atmosphere = createSanctuaryAtmosphere(scene, mobile, clouds.mode === "volumetric" ? 0.43 : clouds.mode === "off" ? 0 : 1);
  const stone = createSanctuaryStoneMaterials(scene, mobile);
  const reflectors: AbstractMesh[] = [];
  const water = createSanctuaryWater(scene, mobile || params?.get("sanctuaryWater") === "lite");
  const black = mat(scene, "sanctuaryObsidan", new Color3(.017,.018,.022));
  const concrete = stone.pillar;
  const wallMat = stone.wall;
  const stairsMat = stone.stairs;
  const wood = mat(scene, "sanctuaryBoatWood", new Color3(.087,.052,.05));
  const ember = mat(scene, "sanctuaryPortalEmber", new Color3(.42,.045,.031), new Color3(.32,.037,.024));
  const gold = mat(scene, "sanctuaryCagedLight", new Color3(.95,.68,.38), new Color3(.9,.64,.35));
  const freed = mat(scene, "sanctuaryFreedLight", new Color3(.55,.67,.9), new Color3(.27,.39,.69));
  const haloMat = mat(scene, "sanctuaryHalo", new Color3(.87,.33,.19), new Color3(.55,.19,.09));
  haloMat.alpha = .16;
  haloMat.disableLighting = true;
  haloMat.backFaceCulling = false;
  const redWater = MeshBuilder.CreateGround("sanctuaryRedWater", { width: 5000, height: 5000, subdivisions: mobile ? 2 : 96 }, scene);
  redWater.position.z = 320;
  redWater.position.y = CFG.riverY;
  redWater.material = water.material;
  redWater.isPickable = false;

  // Top of wall is geometrically thousands of metres high and swallowed by red atmosphere.
  const wallWidth = 6500;
  const gap = CFG.gateWidth;
  const sideWidth = (wallWidth - gap) / 2;
  const wallHeight = 9000;
  reflectors.push(slab(scene, "wallInfiniteLeft", sideWidth, wallHeight, 105, [-(gap + sideWidth) / 2, wallHeight / 2 - 8, CFG.gateWallZ], wallMat));
  reflectors.push(slab(scene, "wallInfiniteRight", sideWidth, wallHeight, 105, [(gap + sideWidth) / 2, wallHeight / 2 - 8, CFG.gateWallZ], wallMat));
  // An opening cut in the mass, not an artificial rectangular light decal stuck on a solid wall.
  reflectors.push(slab(scene, "wallGateLintel", gap + 4, wallHeight - 240, 105, [0, (wallHeight + 240) / 2 - 8, CFG.gateWallZ], wallMat));
  reflectors.push(slab(scene, "gateRedVoid", gap - 13, 180, 2, [0, 90, CFG.gateWallZ + 49], ember));
  for (const x of [-gap / 2, gap / 2]) {
    slab(scene, "gateJaw", 12, 225, 120, [x, 105, CFG.gateWallZ - 5], black);
  }

  // Stairway unobstructed from the water, central composition pointing to the gate.
  slab(scene, "mainStairFoundation", 123, 5, 385, [0, 0.5, 1378], stairsMat);
  for (let i = 0; i < 28; i++) {
    const rise = i * .66;
    const step = slab(scene, `stair_${i}`, 112 - i * .08, rise + 1.5, 12,
      [0, (rise + 1.5) / 2, 1220 + i * 12.4], stairsMat);
    step.receiveShadows = false;
  }

  // Sparse monumental rectangular pillars: each contains a story level, topped with a trapped orb.
  const orbs = new Map<SanctuaryPillarId, OrbVisual>();
  for (const stop of SANCTUARY_STOPS) {
    const x = stop.x + stop.side * 166;
    const z = stop.z + 54;
    const h = stop.height;
    reflectors.push(slab(scene, `${stop.id}_monolith`, 65, h, 66, [x, h / 2 - 6, z], concrete));
    // Very sparse concrete seams; no Gothic trim, no pointed spires.
    slab(scene, `${stop.id}_ridge`, 65.8, 5.5, 67, [x, h * .28, z], black);
    for (const angle of [0, 1, 2, 3]) {
      const px = x + (angle % 2 ? 22 : -22);
      const pz = z + (angle < 2 ? -22 : 22);
      slab(scene, `${stop.id}_orbPrison_${angle}`, 8, 30, 8, [px, h + 7, pz], black);
    }
    const sphere = MeshBuilder.CreateSphere(`${stop.id}_lightOrb`, { diameter: 15, segments: 12 }, scene);
    sphere.position.set(x, h + 17, z);
    sphere.material = progress[stop.id] ? freed : gold;
    sphere.isPickable = false;
    reflectors.push(sphere);
    const halo = MeshBuilder.CreateSphere(`${stop.id}_halo`, { diameter: 31, segments: 12 }, scene);
    halo.position.copyFrom(sphere.position);
    halo.material = haloMat;
    halo.isPickable = false;
    const light = new PointLight(`${stop.id}_localGlow`, sphere.position.clone(), scene);
    light.diffuse = new Color3(1, .46, .25);
    light.intensity = .6;
    light.range = 85;
    // Only a single near pillar's light is enabled at once in the update loop.
    light.setEnabled(false);
    orbs.set(stop.id, { sphere, halo, light, home: sphere.position.clone() });

    // Reachable landing for future LevelGate interactions.
    const dockX = stop.x + stop.side * 27;
    slab(scene, `${stop.id}_landing`, 55, 2.5, 60, [dockX, .8, stop.z], concrete);
    slab(scene, `${stop.id}_pier`, 45, 1.6, 22, [stop.x + stop.side * 13, .65, stop.z], stairsMat);
    slab(scene, `${stop.id}_doorSlab`, 4, 16, 24, [stop.x + stop.side * 51, 8.5, stop.z + 8], black);
    slab(scene, `${stop.id}_doorGlow`, 1.2, 10, 10, [stop.x + stop.side * 49, 7.5, stop.z + 8], ember);
  }

  // Uncanny, organic shadows: deliberately sparse to keep the entrance and stairway clear.
  [
    [-310, -260, 1.35], [300, -30, 1.6], [-355, 190, 1.4],
    [345, 420, 1.8], [-385, 670, 2.1], [380, 915, 1.4]
  ].forEach(([x, z, s]) => createShadowHand(scene, x, z, s, black));

  // A spare wooden raft with enough space for the existing character model.
  const boatRoot = new TransformNode("sanctuaryBoat", scene);
  slab(scene, "raftDeck", 7.4, .6, 11.3, [0, .35, 0], wood, boatRoot);
  for (const x of [-3.7, 3.7]) {
    slab(scene, "raftRail", .25, .9, 10.5, [x, 1.05, 0], wood, boatRoot);
  }
  for (const z of [-5.1, 5.1]) slab(scene, "raftEnd", 7.5, .4, .5, [0, .74, z], wood, boatRoot);
  boatRoot.position.set(0, CFG.riverY + .05, CFG.boatStartZ);

  // Render-to-texture reflections only include a small, stable scene subset.
  // Excluding the water itself is essential: otherwise it reflects its own RTT.
  water.addReflectors(reflectors);

  const visuals = [...orbs.entries()];
  return {
    boatRoot,
    orbs,
    cloudMode: clouds.mode,
    waterMode: water.quality,
    update(_dt, elapsed, currentProgress) {
      water.update(elapsed);
      atmosphere.update(elapsed);
      const cameraPosition = scene.activeCamera?.globalPosition ?? Vector3.Zero();
      clouds.update(elapsed, cameraPosition);
      const bx = boatRoot.position.x;
      const bz = boatRoot.position.z;
      boatRoot.position.y = CFG.riverY + .10 + water.sampleHeight(bx, bz, elapsed);
      const leftH = water.sampleHeight(bx - 3.7, bz, elapsed);
      const rightH = water.sampleHeight(bx + 3.7, bz, elapsed);
      const frontH = water.sampleHeight(bx, bz + 5.5, elapsed);
      const rearH = water.sampleHeight(bx, bz - 5.5, elapsed);
      boatRoot.rotation.z = Math.atan2(leftH - rightH, 7.4);
      boatRoot.rotation.x = Math.atan2(rearH - frontH, 11);
      const numberFreed = visuals.filter(([id]) => currentProgress[id] === true).length;
      let freedIndex = 0;
      for (const [id, v] of visuals) {
        const isFreed = currentProgress[id] === true;
        v.sphere.material = isFreed ? freed : gold;
        if (isFreed) {
          // The freed lights leave their cages and accompany the raft.
          const angle = (freedIndex++ / Math.max(1, numberFreed)) * Math.PI * 2 + elapsed * .12;
          v.sphere.position.set(
            boatRoot.position.x + Math.cos(angle) * 3,
            boatRoot.position.y + 5.5 + Math.sin(elapsed * .8 + freedIndex) * .4,
            boatRoot.position.z + Math.sin(angle) * 3
          );
        } else {
          v.sphere.position.copyFrom(v.home);
        }
        v.halo.position.copyFrom(v.sphere.position);
        v.light.position.copyFrom(v.sphere.position);
        v.sphere.scaling.setAll(1 + Math.sin(elapsed * .83 + v.home.z) * .045);
        v.halo.scaling.setAll(1 + Math.sin(elapsed * .51 + v.home.x) * .1);
        const dx = v.sphere.position.x - boatRoot.position.x;
        const dz = v.sphere.position.z - boatRoot.position.z;
        const nearby = dx * dx + dz * dz < 160 * 160;
        v.light.setEnabled(nearby);
        if (nearby) v.light.intensity = isFreed ? .15 : .52 + .12 * Math.sin(elapsed * 1.6);
      }
    },
  };
}
