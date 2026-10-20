import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { createRinaStadiumGrassMaterial } from "./RinaStadiumGrassMaterial";
import { RINA_LEVEL_QUALITY, RINA_STADIUM } from "./RinaLevelConfig";

function standard(
  scene: Scene,
  name: string,
  diffuse: Color3,
  emissive = Color3.Black()
) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = diffuse;
  material.emissiveColor = emissive;
  material.specularColor = Color3.Black();
  return material;
}

export function createRinaStadiumGeometry(
  scene: Scene,
  performanceTier: "desktop" | "mobile"
) {
  const quality = RINA_LEVEL_QUALITY[performanceTier];
  const grass = createRinaStadiumGrassMaterial(scene, performanceTier);
  const concrete = standard(
    scene,
    "rinaStadiumConcrete",
    new Color3(0.115, 0.12, 0.14)
  );
  const darkConcrete = standard(
    scene,
    "rinaStadiumDarkConcrete",
    new Color3(0.045, 0.05, 0.06)
  );
  const aisle = standard(
    scene,
    "rinaStadiumAisle",
    new Color3(0.14, 0.145, 0.16)
  );
  const ledRibbon = standard(
    scene,
    "rinaStadiumLedRibbon",
    new Color3(0.05, 0.02, 0.08),
    new Color3(0.32, 0.045, 0.42)
  );
  const lineMaterial = standard(
    scene,
    "rinaPitchLine",
    new Color3(0.82, 0.86, 0.8),
    new Color3(0.08, 0.09, 0.08)
  );

  const pitch = MeshBuilder.CreateGround(
    "rinaPitch",
    {
      width: RINA_STADIUM.pitchWidth,
      height: RINA_STADIUM.pitchLength,
      subdivisions: 2,
    },
    scene
  );
  pitch.material = grass;
  pitch.receiveShadows = true;

  const centerLine = MeshBuilder.CreateBox(
    "rinaPitchCenterLine",
    {
      width: RINA_STADIUM.pitchWidth - 1,
      height: 0.018,
      depth: 0.11,
    },
    scene
  );
  centerLine.position.y = 0.018;
  centerLine.material = lineMaterial;

  const centerCircle = MeshBuilder.CreateTorus(
    "rinaPitchCenterCircle",
    { diameter: 18.3, thickness: 0.1, tessellation: 64 },
    scene
  );
  centerCircle.rotation.x = Math.PI / 2;
  centerCircle.position.y = 0.035;
  centerCircle.material = lineMaterial;

  const sideLineX = RINA_STADIUM.pitchWidth / 2 - 0.35;
  for (const side of [-1, 1]) {
    const sideline = MeshBuilder.CreateBox(
      `rinaPitchSideline_${side}`,
      {
        width: 0.1,
        height: 0.018,
        depth: RINA_STADIUM.pitchLength - 1,
      },
      scene
    );
    sideline.position.set(side * sideLineX, 0.018, 0);
    sideline.material = lineMaterial;
  }

  const endLineZ = RINA_STADIUM.pitchLength / 2 - 0.35;
  for (const side of [-1, 1]) {
    const endline = MeshBuilder.CreateBox(
      `rinaPitchEndline_${side}`,
      {
        width: RINA_STADIUM.pitchWidth - 1,
        height: 0.018,
        depth: 0.1,
      },
      scene
    );
    endline.position.set(0, 0.018, side * endLineZ);
    endline.material = lineMaterial;
  }

  const sideTierDepth = 4.6;
  const tierRise = 1.65;
  const baseSideX = RINA_STADIUM.pitchWidth / 2 + 7.5;

  for (const side of [-1, 1]) {
    for (let tier = 0; tier < quality.standTiers; tier += 1) {
      const terrace = MeshBuilder.CreateBox(
        `rinaSideStand_${side}_${tier}`,
        {
          width: sideTierDepth,
          height: tierRise + 0.25,
          depth: RINA_STADIUM.pitchLength + 24,
        },
        scene
      );
      terrace.position.set(
        side * (baseSideX + tier * sideTierDepth),
        0.65 + tier * tierRise,
        0
      );
      terrace.material = tier % 3 === 0 ? aisle : concrete;
    }
  }

  const southBaseZ = -(RINA_STADIUM.pitchLength / 2 + 7);
  const wallWidth = 1.25;
  for (let tier = 0; tier < quality.standTiers; tier += 1) {
    const totalWidth = RINA_STADIUM.pitchWidth + 36;
    const gapHalfWidth = RINA_STADIUM.exitTunnel.halfWidth + wallWidth;
    const sections = tier === 0 ? [-1, 1] : [0];
    for (const side of sections) {
      const width = side === 0 ? totalWidth : totalWidth / 2 - gapHalfWidth;
      const terrace = MeshBuilder.CreateBox(
        `rinaSouthStand_${tier}_${side}`,
        { width, height: tierRise + 0.25, depth: sideTierDepth },
        scene
      );
      terrace.position.set(
        side === 0 ? 0 : side * (gapHalfWidth + width / 2),
        0.65 + tier * tierRise,
        southBaseZ - tier * sideTierDepth
      );
      terrace.material = tier % 3 === 0 ? aisle : concrete;
    }
  }

  // Upper tiers behind the stage. The lower north stand is visually occupied
  // by the production/stage footprint.
  const northUpperBaseZ = RINA_STADIUM.pitchLength / 2 + 7;
  for (let tier = 4; tier < quality.standTiers + 3; tier += 1) {
    const terrace = MeshBuilder.CreateBox(
      `rinaNorthUpperStand_${tier}`,
      {
        width: RINA_STADIUM.pitchWidth + 38,
        height: tierRise + 0.25,
        depth: sideTierDepth,
      },
      scene
    );
    terrace.position.set(
      0,
      0.65 + tier * tierRise,
      northUpperBaseZ + (tier - 4) * sideTierDepth
    );
    terrace.material = tier % 3 === 0 ? aisle : darkConcrete;
  }

  for (const side of [-1, 1]) {
    const ribbon = MeshBuilder.CreateBox(
      `rinaLedRibbonSide_${side}`,
      {
        width: 0.28,
        height: 0.42,
        depth: RINA_STADIUM.pitchLength + 20,
      },
      scene
    );
    ribbon.position.set(side * (baseSideX - 2.4), 6.7, 0);
    ribbon.material = ledRibbon;
  }

  const tunnelDepth =
    RINA_STADIUM.exitTunnel.endZ - RINA_STADIUM.exitTunnel.startZ + 5;
  const tunnelCenterZ =
    (RINA_STADIUM.exitTunnel.startZ + RINA_STADIUM.exitTunnel.endZ) * 0.5;

  for (const side of [-1, 1]) {
    const wall = MeshBuilder.CreateBox(
      `rinaExitTunnelWall_${side}`,
      { width: wallWidth, height: 4.8, depth: tunnelDepth },
      scene
    );
    wall.position.set(
      side * (RINA_STADIUM.exitTunnel.halfWidth + wallWidth / 2),
      2.4,
      tunnelCenterZ
    );
    wall.material = darkConcrete;
  }

  const tunnelRoof = MeshBuilder.CreateBox(
    "rinaExitTunnelRoof",
    {
      width: RINA_STADIUM.exitTunnel.halfWidth * 2 + wallWidth * 2,
      height: 0.55,
      depth: tunnelDepth,
    },
    scene
  );
  tunnelRoof.position.set(0, 4.75, tunnelCenterZ);
  tunnelRoof.material = darkConcrete;

  return { pitch };
}
