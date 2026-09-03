import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem.js";
import { ConvertToNodeParticleSystemSetAsync } from "@babylonjs/core/Particles/Node/nodeParticleSystemSet.helper.js";
import { ParticleTextureSourceBlock } from "@babylonjs/core/Particles/Node/Blocks/particleSourceTextureBlock.js";
import { Scene } from "@babylonjs/core/scene.js";

const OUTPUT_ROOT = resolve("src/vfx/shadow");
const ATLAS_URL = "/assets/vfx/shadow-flames/shadow-flame-atlas.png";
const ATLAS_CELL_WIDTH = 128;
const ATLAS_CELL_HEIGHT = 256;

function configureSpriteAtlas(system) {
  system.startSpriteCellID = 0;
  system.endSpriteCellID = 2;
  system.spriteCellWidth = ATLAS_CELL_WIDTH;
  system.spriteCellHeight = ATLAS_CELL_HEIGHT;
  system.spriteCellChangeSpeed = 0;
  system.spriteCellLoop = false;
  system.spriteRandomStartCell = true;
}

function createLivingFlamePrototype(scene) {
  const system = new ParticleSystem("LivingBlackFlames", 24, scene, null, true);
  system.emitRate = 12;
  system.minLifeTime = 0.45;
  system.maxLifeTime = 1.15;
  system.minEmitPower = 0.15;
  system.maxEmitPower = 0.45;
  system.minSize = 0.26;
  system.maxSize = 0.46;
  system.minScaleX = 0.7;
  system.maxScaleX = 0.92;
  system.minScaleY = 1.35;
  system.maxScaleY = 1.9;
  system.minInitialRotation = -Math.PI / 18;
  system.maxInitialRotation = Math.PI / 18;
  system.minAngularSpeed = -0.12;
  system.maxAngularSpeed = 0.12;
  system.colorDead = new Color4(0.004, 0.004, 0.008, 0);
  system.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  system.isBillboardBased = true;
  system.billboardMode = ParticleSystem.BILLBOARDMODE_ALL;
  system.isLocal = false;
  system.renderingGroupId = 0;
  system.updateSpeed = 1 / 60;
  system.createBoxEmitter(
    new Vector3(-0.04, 0.15, -0.04),
    new Vector3(0.04, 0.45, 0.04),
    new Vector3(-0.025, -0.015, -0.025),
    new Vector3(0.025, 0.025, 0.025)
  );

  system.addColorGradient(0, new Color4(0.004, 0.004, 0.008, 0));
  system.addColorGradient(0.1, new Color4(0.012, 0.008, 0.016, 0.55));
  system.addColorGradient(0.3, new Color4(0.024, 0.016, 0.031, 0.8));
  system.addColorGradient(0.7, new Color4(0.012, 0.008, 0.016, 0.65));
  system.addColorGradient(1, new Color4(0.004, 0.004, 0.008, 0));

  // NPE's UpdateSizeBlock writes an absolute size. The paired values retain
  // per-particle variation while following the desired form/stretch/dissolve curve.
  system.addSizeGradient(0, 0.06, 0.1);
  system.addSizeGradient(0.15, 0.2, 0.32);
  system.addSizeGradient(0.4, 0.28, 0.44);
  system.addSizeGradient(0.75, 0.23, 0.36);
  system.addSizeGradient(1, 0.05, 0.09);
  system.addVelocityGradient(0, 0.85);
  system.addVelocityGradient(0.65, 1);
  system.addVelocityGradient(1, 0.5);
  configureSpriteAtlas(system);
  return system;
}

function createDetachedFragmentPrototype(scene) {
  const system = new ParticleSystem("DetachedShadowFragments", 6, scene, null, true);
  system.emitRate = 0;
  system.minLifeTime = 0.65;
  system.maxLifeTime = 1.15;
  system.minEmitPower = 0.35;
  system.maxEmitPower = 0.75;
  system.minSize = 0.14;
  system.maxSize = 0.28;
  system.minScaleX = 0.55;
  system.maxScaleX = 0.82;
  system.minScaleY = 0.9;
  system.maxScaleY = 1.25;
  system.minInitialRotation = -Math.PI / 12;
  system.maxInitialRotation = Math.PI / 12;
  system.minAngularSpeed = -0.28;
  system.maxAngularSpeed = 0.28;
  system.colorDead = new Color4(0.004, 0.004, 0.008, 0);
  system.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  system.isBillboardBased = true;
  system.billboardMode = ParticleSystem.BILLBOARDMODE_ALL;
  system.isLocal = false;
  system.renderingGroupId = 0;
  system.updateSpeed = 1 / 60;
  system.createBoxEmitter(
    new Vector3(-0.35, 0.15, -0.12),
    new Vector3(0.35, 0.5, 0.12),
    new Vector3(-0.02, -0.02, -0.02),
    new Vector3(0.02, 0.02, 0.02)
  );

  system.addColorGradient(0, new Color4(0.004, 0.004, 0.008, 0));
  system.addColorGradient(0.15, new Color4(0.012, 0.008, 0.016, 0.42));
  system.addColorGradient(0.55, new Color4(0.024, 0.016, 0.031, 0.5));
  system.addColorGradient(1, new Color4(0.004, 0.004, 0.008, 0));
  system.addSizeGradient(0, 0.05, 0.08);
  system.addSizeGradient(0.35, 0.14, 0.28);
  system.addSizeGradient(1, 0.025, 0.05);
  system.addVelocityGradient(0, 1);
  system.addVelocityGradient(1, 0.35);
  configureSpriteAtlas(system);
  return system;
}

async function convertAndWrite(system, name, fileName) {
  const nodeSet = await ConvertToNodeParticleSystemSetAsync(name, [system]);
  if (!nodeSet) throw new Error(`Could not convert ${name} to an NPE graph.`);

  const systemBlock = nodeSet.systemBlocks[0];
  systemBlock.capacity = system.getCapacity();
  systemBlock.doNoStart = false;
  const textureBlock = new ParticleTextureSourceBlock("Shadow Flame Atlas");
  textureBlock.url = ATLAS_URL;
  textureBlock.invertY = true;
  textureBlock.textureOutput.connectTo(systemBlock.texture);
  nodeSet.comment = "Local production NPE graph for Bosque Babylon's living shadow VFX.";

  // Populate attachedBlocks before serialization without building a runtime scene.
  nodeSet._initializeBlock(systemBlock);
  const outputPath = resolve(OUTPUT_ROOT, fileName);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(nodeSet.serialize(), null, 2)}\n`, "utf8");
  nodeSet.dispose();
}

const engine = new NullEngine({ renderWidth: 64, renderHeight: 64 });
const scene = new Scene(engine);
const flames = createLivingFlamePrototype(scene);
const fragments = createDetachedFragmentPrototype(scene);

try {
  await convertAndWrite(flames, "LivingBlackFlames", "LivingBlackFlames.npe.json");
  await convertAndWrite(fragments, "DetachedShadowFragments", "DetachedShadowFragments.npe.json");
  console.log(`Generated local NPE graphs in ${OUTPUT_ROOT}`);
} finally {
  flames.dispose();
  fragments.dispose();
  scene.dispose();
  engine.dispose();
}
