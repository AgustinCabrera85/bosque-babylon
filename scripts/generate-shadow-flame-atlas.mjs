import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import sharp from "sharp";

const CELL_WIDTH = 128;
const CELL_HEIGHT = 256;
const ATLAS_WIDTH = CELL_WIDTH * 3;
const OUTPUT_PATH = resolve("public/assets/vfx/shadow-flames/shadow-flame-atlas.png");
const SVG_PATHS = ["a", "b", "c"].map((suffix) =>
  resolve(`public/assets/vfx/shadow-flames/shadow-flame-${suffix}.svg`)
);

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function whiteMask(input, width, height, fit) {
  const { data, info } = await sharp(input, { density: 288 })
    .resize({ width, height, fit, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // The supplied artwork contributes only alpha. Keeping transparent pixels at
  // alpha 0 prevents the physical particle quad from becoming a visible card.
  for (let offset = 0; offset < data.length; offset += info.channels) {
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer();
}

async function fromIndividualMasks() {
  const masks = await Promise.all(
    SVG_PATHS.map((path) => whiteMask(path, CELL_WIDTH, CELL_HEIGHT, "contain"))
  );
  return sharp({
    create: {
      width: ATLAS_WIDTH,
      height: CELL_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(masks.map((input, index) => ({ input, left: index * CELL_WIDTH, top: 0 })))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function fromExistingAtlas(path) {
  return whiteMask(path, ATLAS_WIDTH, CELL_HEIGHT, "fill");
}

const sourceAtlas = readOption("--source-atlas");
const outputPath = resolve(readOption("--output") ?? OUTPUT_PATH);
const hasAllSvgMasks = (await Promise.all(SVG_PATHS.map(exists))).every(Boolean);

if (!sourceAtlas && !hasAllSvgMasks) {
  throw new Error(
    "Missing shadow-flame-a.svg, shadow-flame-b.svg and shadow-flame-c.svg. " +
      "Provide them in public/assets/vfx/shadow-flames or pass --source-atlas <png>."
  );
}

const atlas = sourceAtlas
  ? await fromExistingAtlas(resolve(sourceAtlas))
  : await fromIndividualMasks();

await mkdir(dirname(outputPath), { recursive: true });
await sharp(atlas).png({ compressionLevel: 9 }).toFile(outputPath);
console.log(`Generated ${ATLAS_WIDTH}x${CELL_HEIGHT} shadow flame atlas at ${outputPath}`);
