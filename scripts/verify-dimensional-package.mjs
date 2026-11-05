import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const fx = resolve(root, 'src/vfx/dimensional');
const manifest = JSON.parse(readFileSync(resolve(root, 'dimensional-source-manifest.json'), 'utf8'));
for (const source of manifest.sources) {
  const file = resolve(fx, source.path);
  assert.ok(existsSync(file), `Missing shader: ${source.path}`);
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(hash, source.sha256, `Modified shader: ${source.path}`);
}
assert.equal(manifest.catalogCount, 20);
assert.equal(manifest.cataloguedShadertoyCount, 17);
assert.equal(manifest.userApprovedAtLastAudit, 16);
for (const required of ['catalog.ts', 'source.ts', 'controllers.ts', 'DimensionalFXRuntime.ts', 'WarpConnectionFX.ts', 'EtherealMeshFX.ts', 'RorschachTextFX.ts', 'index.ts']) {
  assert.ok(existsSync(resolve(fx, required)), `Missing runtime module ${required}`);
}
for (const id of manifest.ids) {
  assert.ok(existsSync(resolve(fx, 'shaders', `${id}.frag.glsl`)), `Missing ${id}`);
}
const shaderBodies = readdirSync(resolve(fx, 'shaders')).filter(name => name.endsWith('.frag.glsl'));
assert.equal(shaderBodies.length, 17);
console.log(`Dimensional FX package OK: ${manifest.sources.length} GLSL assets, ${manifest.catalogCount} effect entries, 16 user approvals preserved`);
