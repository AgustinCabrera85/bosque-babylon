import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const PUBLIC_ASSETS = path.join(ROOT, "public", "assets");
const MODELS = path.join(PUBLIC_ASSETS, "models");
const SHARED_TEXTURES = path.join(MODELS, "vegetation", "shared-runtime");

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const sharedTextureSizes = new Map();

const glbs = [
  ...["tree_00", "tree_01", "tree_02", "tree_03", "tree_04", "tree_05", "tree_07"].map(
    (name) => ({
      source: path.join(MODELS, "vegetation", `${name}.glb`),
      output: path.join(MODELS, "vegetation", `${name}_runtime.glb`),
    })
  ),
  ...["rock_01", "rock_02", "rock_03", "rock_04", "rock_05", "rock_06"].map(
    (name) => ({
      source: path.join(MODELS, "vegetation", `${name}.glb`),
      output: path.join(MODELS, "vegetation", `${name}_runtime.glb`),
    })
  ),
  {
    source: path.join(MODELS, "blockers", "tree_08.glb"),
    // Babylon rejects parent-directory image URIs inside glTF for security.
    // Keep the runtime blocker beside the vegetation GLBs so it can reuse the
    // exact same shared bark URLs without a second GPU texture allocation.
    output: path.join(MODELS, "vegetation", "tree_08_runtime.glb"),
  },
];

function align4(value) {
  return (value + 3) & ~3;
}

function parseGlb(data, filePath) {
  if (data.readUInt32LE(0) !== GLB_MAGIC || data.readUInt32LE(4) !== 2) {
    throw new Error(`${filePath} is not a glTF 2.0 binary`);
  }

  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= data.length) {
    const byteLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + byteLength);
    if (chunkType === JSON_CHUNK) {
      json = JSON.parse(chunk.toString("utf8").trimEnd());
    } else if (chunkType === BIN_CHUNK) {
      binary = chunk;
    }
    offset += 8 + byteLength;
  }

  if (!json || !binary) throw new Error(`${filePath} has no JSON or BIN chunk`);
  return { json, binary };
}

function imageExtension(image, bytes) {
  if (image.mimeType === "image/png" || bytes.readUInt32BE(0) === 0x89504e47) return "png";
  if (image.mimeType === "image/webp" || bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return "jpg";
}

function remapBufferViews(value, remap) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "bufferView" && typeof child === "number") {
      const mapped = remap.get(child);
      if (mapped === undefined) throw new Error(`Referenced bufferView ${child} was removed`);
      value[key] = mapped;
    } else {
      remapBufferViews(child, remap);
    }
  }
}

function buildGlb(json, binary) {
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const paddedJsonLength = align4(jsonBytes.length);
  const paddedBinaryLength = align4(binary.length);
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinaryLength;
  const output = Buffer.alloc(totalLength);

  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(paddedJsonLength, 12);
  output.writeUInt32LE(JSON_CHUNK, 16);
  jsonBytes.copy(output, 20);
  output.fill(0x20, 20 + jsonBytes.length, 20 + paddedJsonLength);

  const binaryHeader = 20 + paddedJsonLength;
  output.writeUInt32LE(paddedBinaryLength, binaryHeader);
  output.writeUInt32LE(BIN_CHUNK, binaryHeader + 4);
  binary.copy(output, binaryHeader + 8);
  return output;
}

async function externalizeEmbeddedImages(source, output) {
  const sourceData = await readFile(source);
  const { json, binary } = parseGlb(sourceData, source);
  const imageBufferViews = new Set();

  for (const image of json.images ?? []) {
    if (image.bufferView === undefined) continue;
    const view = json.bufferViews[image.bufferView];
    if (!view || (view.buffer ?? 0) !== 0) {
      throw new Error(`${source} contains an unsupported image buffer`);
    }

    const start = view.byteOffset ?? 0;
    const bytes = binary.subarray(start, start + view.byteLength);
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const extension = imageExtension(image, bytes);
    const texturePath = path.join(SHARED_TEXTURES, `${digest}.${extension}`);
    if (!sharedTextureSizes.has(texturePath)) {
      await writeFile(texturePath, bytes);
      sharedTextureSizes.set(texturePath, bytes.length);
    }

    imageBufferViews.add(image.bufferView);
    image.uri = path.relative(path.dirname(output), texturePath).split(path.sep).join("/");
    delete image.bufferView;
    delete image.mimeType;
  }

  const remap = new Map();
  const rebuiltViews = [];
  const binaryParts = [];
  let binaryLength = 0;

  for (let oldIndex = 0; oldIndex < (json.bufferViews ?? []).length; oldIndex++) {
    if (imageBufferViews.has(oldIndex)) continue;
    const sourceView = json.bufferViews[oldIndex];
    if ((sourceView.buffer ?? 0) !== 0) throw new Error(`${source} uses multiple buffers`);

    const alignedOffset = align4(binaryLength);
    if (alignedOffset > binaryLength) binaryParts.push(Buffer.alloc(alignedOffset - binaryLength));
    const start = sourceView.byteOffset ?? 0;
    const bytes = binary.subarray(start, start + sourceView.byteLength);
    binaryParts.push(bytes);

    const rebuilt = { ...sourceView, byteOffset: alignedOffset };
    remap.set(oldIndex, rebuiltViews.length);
    rebuiltViews.push(rebuilt);
    binaryLength = alignedOffset + bytes.length;
  }

  json.bufferViews = rebuiltViews;
  remapBufferViews(json, remap);
  const rebuiltBinary = Buffer.concat(binaryParts);
  if (json.buffers?.[0]) json.buffers[0].byteLength = rebuiltBinary.length;
  await writeFile(output, buildGlb(json, rebuiltBinary));

  return {
    sourceBytes: sourceData.length,
    outputBytes: (await readFile(output)).length,
  };
}

async function optimizeSky() {
  const source = path.join(PUBLIC_ASSETS, "hdr", "forest_night_8k.jpg");
  const output = path.join(PUBLIC_ASSETS, "hdr", "forest_night_4k.jpg");
  await sharp(source)
    .resize(4096, 2048, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(output);
  return output;
}

await mkdir(SHARED_TEXTURES, { recursive: true });
let sourceBytes = 0;
let outputBytes = 0;
for (const glb of glbs) {
  const result = await externalizeEmbeddedImages(glb.source, glb.output);
  sourceBytes += result.sourceBytes;
  outputBytes += result.outputBytes;
}
await optimizeSky();

const sharedTextureBytes = [...sharedTextureSizes.values()].reduce((sum, value) => sum + value, 0);
const saved = (sourceBytes - outputBytes - sharedTextureBytes) / 1024 / 1024;
console.log(`Runtime GLBs generated; shared payload is ${saved.toFixed(1)} MiB smaller.`);
console.log("Shared image bytes remain identical to the source assets; the 8K sky has a 4K runtime copy.");
