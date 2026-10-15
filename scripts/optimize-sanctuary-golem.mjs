import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "public/assets/models/sanctuary/Golem_Guardian.glb");
const sourcePath = process.argv[2];

if (!sourcePath || path.resolve(sourcePath) === outputPath) {
  throw new Error("Usage: node scripts/optimize-sanctuary-golem.mjs <original Golem_Guardian.glb>");
}

const align4 = (value) => (value + 3) & ~3;

function parseGlb(data) {
  if (data.readUInt32LE(0) !== GLB_MAGIC || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) {
    throw new Error("Source is not a valid glTF 2.0 binary");
  }
  let json;
  let binary;
  for (let offset = 12; offset < data.length;) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(chunk.toString("utf8").trimEnd());
    if (type === BIN_CHUNK) binary = chunk;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error("Source is missing its JSON or BIN chunk");
  return { json, binary };
}

function buildGlb(json, binary) {
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const paddedJsonLength = align4(jsonBytes.length);
  const paddedBinaryLength = align4(binary.length);
  const output = Buffer.alloc(12 + 8 + paddedJsonLength + 8 + paddedBinaryLength);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(paddedJsonLength, 12);
  output.writeUInt32LE(JSON_CHUNK, 16);
  output.fill(0x20, 20, 20 + paddedJsonLength);
  jsonBytes.copy(output, 20);
  const binHeader = 20 + paddedJsonLength;
  output.writeUInt32LE(paddedBinaryLength, binHeader);
  output.writeUInt32LE(BIN_CHUNK, binHeader + 4);
  binary.copy(output, binHeader + 8);
  return output;
}

const source = await readFile(sourcePath);
const { json, binary } = parseGlb(source);
if (json.buffers?.length !== 1 || json.images?.length !== 1 || json.images[0].mimeType !== "image/png") {
  throw new Error("Expected one embedded PNG image and one binary buffer");
}
const imageViewIndex = json.images[0].bufferView;
const imageView = json.bufferViews[imageViewIndex];
if (!imageView || imageView.buffer !== 0) throw new Error("PNG image is not in the binary buffer");
const png = binary.subarray(imageView.byteOffset, imageView.byteOffset + imageView.byteLength);
const { channels } = await sharp(png).stats();
if (channels.length !== 4 || channels[3].min !== 255) {
  throw new Error("The texture has transparency and cannot be converted to JPEG");
}

// Keep the full 4096px texture and color detail; only its lossless PNG encoding changes.
const jpeg = await sharp(png).removeAlpha().jpeg({
  quality: 95,
  mozjpeg: true,
  chromaSubsampling: "4:4:4",
}).toBuffer();
const chunks = [];
let length = 0;
for (let index = 0; index < json.bufferViews.length; index++) {
  const view = json.bufferViews[index];
  if (view.buffer !== 0) throw new Error("Unexpected external bufferView");
  const bytes = index === imageViewIndex
    ? jpeg
    : binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  if (bytes.length !== (index === imageViewIndex ? jpeg.length : view.byteLength)) {
    throw new Error(`Invalid bufferView ${index}`);
  }
  length = align4(length);
  view.byteOffset = length;
  view.byteLength = bytes.length;
  chunks.push({ bytes, offset: length });
  length += bytes.length;
}
const packed = Buffer.alloc(align4(length));
for (const { bytes, offset } of chunks) bytes.copy(packed, offset);
json.buffers[0].byteLength = packed.length;
json.images[0].mimeType = "image/jpeg";
const optimized = buildGlb(json, packed);
await writeFile(outputPath, optimized);
console.log(`${path.basename(outputPath)}: ${source.length} -> ${optimized.length} bytes (${((1 - optimized.length / source.length) * 100).toFixed(1)}% smaller)`);
