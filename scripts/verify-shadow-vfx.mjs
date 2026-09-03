import "@babylonjs/core/Particles/Node/Blocks/allBlocks.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem.js";
import { NodeParticleSystemSet } from "@babylonjs/core/Particles/Node/nodeParticleSystemSet.js";
import { Scene } from "@babylonjs/core/scene.js";
import sharp from "sharp";

const ROOT = resolve("src/vfx/shadow");
const ATLAS = resolve("public/assets/vfx/shadow-flames/shadow-flame-atlas.png");
const graphs = [
  ["LivingBlackFlames.npe.json", 24],
  ["DetachedShadowFragments.npe.json", 6],
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyAtlas() {
  const image = sharp(ATLAS).ensureAlpha();
  const metadata = await image.metadata();
  assert(metadata.width === 384 && metadata.height === 256, "Atlas must be 384x256.");
  assert(metadata.channels === 4, "Atlas must contain an alpha channel.");
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  let visiblePixels = 0;
  let maximumEdgeAlpha = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha === 0) transparentPixels++;
      else visiblePixels++;
      if (y === 0 || y === info.height - 1 || x % 128 === 0 || x % 128 === 127) {
        maximumEdgeAlpha = Math.max(maximumEdgeAlpha, alpha);
      }
    }
  }
  assert(transparentPixels > 0 && visiblePixels > 0, "Atlas must contain visible masks and transparent space.");
  assert(maximumEdgeAlpha <= 4, "Atlas masks must not touch their cell borders.");
  console.log(`Atlas: ${metadata.width}x${metadata.height}, RGBA, edge alpha <= ${maximumEdgeAlpha}`);
}

const engine = new NullEngine({ renderWidth: 64, renderHeight: 64 });
const scene = new Scene(engine);

try {
  await verifyAtlas();
  for (const [fileName, expectedCapacity] of graphs) {
    const graph = JSON.parse(await readFile(resolve(ROOT, fileName), "utf8"));
    const nodeSet = NodeParticleSystemSet.Parse(graph);
    const particleSet = await nodeSet.buildAsync(scene);
    const system = particleSet.systems[0];
    assert(particleSet.systems.length === 1, `${fileName} must build exactly one particle system.`);
    assert(system instanceof ParticleSystem, `${fileName} must build a CPU ParticleSystem.`);
    assert(system.getCapacity() === expectedCapacity, `${fileName} has an unexpected capacity.`);
    assert(system.blendMode === ParticleSystem.BLENDMODE_STANDARD, `${fileName} must use standard alpha blending.`);
    assert(system.isLocal === false, `${fileName} must simulate in world space.`);
    assert(system.startSpriteCellID === 0 && system.endSpriteCellID === 2, `${fileName} must expose all three atlas cells.`);
    assert(system.spriteRandomStartCell, `${fileName} must randomize its initial atlas cell.`);
    console.log(`${fileName}: CPU, capacity ${system.getCapacity()}, standard alpha, world-space, cells 0..2`);
    nodeSet.dispose();
  }
} finally {
  scene.dispose();
  engine.dispose();
}
