import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const [source, output] = process.argv.slice(2);
if (!source || !output) {
  throw new Error("Usage: node optimize-runtime-sky.mjs <source> <output>");
}

const optimizedSky = await sharp(source)
  .resize(4096, 2048, { fit: "fill", kernel: sharp.kernel.lanczos3 })
  .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
  .toBuffer();

await writeFile(output, optimizedSky);
