import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const inputArg = args.includes("--input") ? option("--input") : null;
const id = args.includes("--id") ? option("--id") : null;
const verifyOnly = args.includes("--verify-only");
const force = args.includes("--force");

if (!inputArg || (!verifyOnly && (!id || !/^fan_[a-z0-9_]+$/.test(id)))) {
  throw new Error("Usage: npm run assets:optimize-rina-crowd -- --input <fan.glb> --id fan_02 [--out-dir <dir>] [--force] [--verify-only]");
}

const input = path.resolve(inputArg);
const outputDir = args.includes("--out-dir") ? path.resolve(option("--out-dir"))
  : path.join(root, "public", "assets", "models", "rina", "crowd", id ?? "inspect");
const io = new NodeIO();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const exists = async file => { try { await stat(file); return true; } catch { return false; } };

function signature(document) {
  const scene = document.getRoot();
  const primitives = scene.listMeshes().flatMap(mesh => mesh.listPrimitives());
  return {
    vertices: primitives.reduce((n, p) => n + (p.getAttribute("POSITION")?.getCount() ?? 0), 0),
    triangles: primitives.reduce((n, p) => n + Math.floor((p.getIndices()?.getCount() ?? p.getAttribute("POSITION")?.getCount() ?? 0) / 3), 0),
    attributes: primitives.map(p => p.listSemantics().sort().join(",")),
    skins: scene.listSkins().length,
    joints: scene.listSkins().reduce((n, skin) => n + skin.listJoints().length, 0),
    animations: scene.listAnimations().length,
    materials: scene.listMaterials().length,
    textures: scene.listTextures().length,
  };
}

function assertPreserved(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`Rig/geometry/material signature changed: ${JSON.stringify(before)} => ${JSON.stringify(after)}`);
  }
}

async function describe(file) {
  const bytes = await readFile(file);
  const document = await io.read(file);
  const textures = [];
  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const meta = await sharp(image).metadata();
    textures.push({ name: texture.getName(), width: meta.width, height: meta.height, mimeType: texture.getMimeType() });
  }
  return { file, bytes: bytes.length, sha256: hash(bytes), ...signature(document), textures };
}

if (verifyOnly) {
  console.log(JSON.stringify(await describe(input), null, 2));
} else {
  const outputs = [
    { label: "near_2k", maxDimension: 2048, file: path.join(outputDir, `${id}_near_2k.glb`) },
    { label: "mid_1k", maxDimension: 1024, file: path.join(outputDir, `${id}_mid_1k.glb`) },
  ];
  if (outputs.some(o => path.resolve(o.file) === input)) throw new Error("Source and output must differ");
  if (!force && (await Promise.all(outputs.map(o => exists(o.file)))).some(Boolean)) {
    throw new Error("An output exists. Use --force only after reviewing the existing variants.");
  }
  const source = await describe(input);
  const sourceSignature = signature(await io.read(input));
  const results = [];
  for (const output of outputs) {
    const document = await io.read(input);
    const scene = document.getRoot();
    const nonColor = new Set();
    for (const material of scene.listMaterials()) {
      for (const getter of ["getNormalTexture", "getOcclusionTexture", "getMetallicRoughnessTexture", "getEmissiveTexture"]) {
        const texture = material[getter]?.();
        if (texture) nonColor.add(texture);
      }
    }
    const colorTextures = new Set(scene.listMaterials()
      .filter(material => material.getAlphaMode() === "OPAQUE")
      .map(material => material.getBaseColorTexture())
      .filter(texture => texture && !nonColor.has(texture)));
    for (const texture of colorTextures) {
      const image = texture.getImage();
      if (!image) continue;
      const meta = await sharp(image).metadata();
      if (meta.hasAlpha) {
        const stats = await sharp(image).ensureAlpha().stats();
        if (stats.channels.at(-1).min < 255) continue;
      }
      const resized = await sharp(image)
        .resize({ width: output.maxDimension, height: output.maxDimension, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      texture.setImage(resized).setMimeType("image/jpeg");
    }
    assertPreserved(sourceSignature, signature(document));
    const bytes = await io.writeBinary(document);
    // Re-read the serialized GLB to catch serialization errors before publishing it.
    const check = await io.readBinary(bytes);
    assertPreserved(sourceSignature, signature(check));
    await mkdir(outputDir, { recursive: true });
    await writeFile(output.file, bytes, { flag: force ? "w" : "wx" });
    results.push({ ...output, bytes: bytes.length, sha256: hash(bytes),
      reductionPercent: +((1 - bytes.length / source.bytes) * 100).toFixed(1),
      textures: await Promise.all(check.getRoot().listTextures().map(async texture => {
        const image = texture.getImage();
        if (!image) return null;
        const meta = await sharp(image).metadata();
        return { width: meta.width, height: meta.height, mimeType: texture.getMimeType() };
      })) });
  }
  const report = { source, outputs: results };
  const reportFile = path.join(outputDir, `${id}_optimization_report.json`);
  if (force || !(await exists(reportFile))) await writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
