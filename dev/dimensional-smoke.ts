import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DIMENSIONAL_FX_CATALOG, DIMENSIONAL_SHADER_IDS, createDimensionalSurface,
  createDimensionalPostProcess, createDimensionalProjection, WarpConnectionFX,
  EtherealMeshFX, RorschachTextFX, INK_PRESETS } from '../src/vfx/dimensional';
import { loadDimensionalSource } from '../src/vfx/dimensional/source';
import { evaluateAperture, COSMIC_APERTURE, DARKNESS_APERTURE } from '../src/vfx/dimensional/controllers';
import '@babylonjs/loaders/glTF';

type Check = { name: string; ok: boolean; detail?: string };
declare global { interface Window { __dimensionalSmoke?: { done: boolean; checks: Check[]; gpu: string; fps: number } } }

const canvas = document.querySelector<HTMLCanvasElement>('#render')!;
const results = document.querySelector<HTMLElement>('#results')!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const camera = new FreeCamera('smokeCamera', new Vector3(0, 0, -8), scene);
camera.setTarget(Vector3.Zero());
scene.activeCamera = camera;
new HemisphericLight('smokeLight', new Vector3(0, 1, -1), scene);
const quad = MeshBuilder.CreatePlane('smokeQuad', { size: 3 }, scene);
const checks: Check[] = [];
const gl = engine._gl;
const gpuExtension = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = gpuExtension ? String(gl.getParameter(gpuExtension.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
const frame = async () => { scene.render(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); scene.render(); };
async function ready(name: string, test: () => boolean, compilationError: () => string | undefined) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (test()) return;
    const error = compilationError();
    if (error) throw Error(`${name}: ${error}`);
    await new Promise(resolve => setTimeout(resolve, 25));
    scene.render();
  }
  throw Error(`${name}: timed out waiting for shader`);
}
async function check(name: string, run: () => Promise<void> | void) {
  try { await run(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, detail: String(error) }); }
  results.textContent = JSON.stringify({ gpu, checks }, null, 2);
}
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

async function run() {
  await check('catalogue', () => {
    assert(DIMENSIONAL_FX_CATALOG.length === 20, '20 entries expected');
    assert(DIMENSIONAL_SHADER_IDS.length === 17, '17 shader IDs expected');
    assert(DIMENSIONAL_FX_CATALOG.filter(entry => entry.approved).length === 16, '16 approvals expected');
    for (const entry of DIMENSIONAL_FX_CATALOG) assert(entry.reference.startsWith('https://www.shadertoy.com/view/'), entry.id);
  });
  await check('variant sources', async () => {
    const variants = [
      ...(['eco', 'balanced', 'high', 'original'] as const).map(cosmicQuality => ({ id: '4t2cR1' as const, options: { cosmicQuality } })),
      ...(['controlled', 'original'] as const).map(darknessVariant => ({ id: '4XVBzK' as const, options: { darknessVariant } })),
    ];
    const sources = await Promise.all(variants.map(v => loadDimensionalSource(v.id, v.options)));
    assert(new Set(sources.slice(0, 4)).size === 4, 'cosmic variants not distinct');
    assert(sources[4] !== sources[5], 'darkness variants not distinct');
    for (const source of sources) assert(source.includes('void main(void)'), 'missing shader main');
  });
  await check('aperture controllers', () => {
    const cosmic = { ...COSMIC_APERTURE, playback: 'manual' as const, manualOpen: 0.25 };
    const dark = { ...DARKNESS_APERTURE, playback: 'manual' as const, manualOpen: 0.75 };
    assert(evaluateAperture(cosmic, 0).open === evaluateAperture(cosmic, 20).open, 'cosmic drift');
    assert(evaluateAperture(dark, 0).open === evaluateAperture(dark, 20).open, 'darkness drift');
  });
  for (const entry of DIMENSIONAL_FX_CATALOG.filter(e => e.kind === 'surface')) {
    await check(`surface ${entry.id}`, async () => {
      const fx = await createDimensionalSurface(scene, entry.id);
      try {
        quad.material = fx.value;
        await frame();
        await ready(entry.id, () => fx.value.isReady(quad), () => quad.subMeshes?.[0]?.effect?.getCompilationError());
        fx.update({ intensity: 0.7 });
        await frame();
      } finally { quad.material = null; fx.dispose(); fx.dispose(); }
    });
  }
  for (const cosmicQuality of ['eco', 'balanced', 'high', 'original'] as const) {
    await check(`cosmic ${cosmicQuality}`, async () => {
      const fx = await createDimensionalSurface(scene, '4t2cR1', { cosmicQuality });
      try { quad.material = fx.value; await frame(); await ready(`cosmic ${cosmicQuality}`, () => fx.value.isReady(quad), () => quad.subMeshes?.[0]?.effect?.getCompilationError()); }
      finally { quad.material = null; fx.dispose(); }
    });
  }
  for (const darknessVariant of ['controlled', 'original'] as const) {
    await check(`darkness ${darknessVariant}`, async () => {
      const fx = await createDimensionalSurface(scene, '4XVBzK', { darknessVariant });
      try { quad.material = fx.value; await frame(); await ready(`darkness ${darknessVariant}`, () => fx.value.isReady(quad), () => quad.subMeshes?.[0]?.effect?.getCompilationError()); }
      finally { quad.material = null; fx.dispose(); }
    });
  }
  for (const entry of DIMENSIONAL_FX_CATALOG.filter(e => e.kind === 'postprocess')) {
    await check(`postprocess ${entry.id}`, async () => {
      const fx = await createDimensionalPostProcess(scene, camera, entry.id, { resolutionRatio: 0.5 });
      try { await frame(); await ready(entry.id, () => !!fx.value.getEffect()?.isReady(), () => fx.value.getEffect()?.getCompilationError()); fx.update({ intensity: 0.5 }); }
      finally { fx.dispose(); fx.dispose(); }
    });
  }
  await check('warp moving endpoints', async () => {
    const fx = new WarpConnectionFX(scene);
    try {
      fx.setEndpoints(new Vector3(-2, 0, 0), new Vector3(2, 0, 0));
      await frame();
      fx.setEndpoints(new Vector3(-1, 1, 0), new Vector3(3, -1, 0));
      await frame();
      for (const material of fx.materials) await ready('warp', () => material.isReady(), () => material.getEffect()?.getCompilationError());
      assert(fx.shells[0].position.x === 1, 'moving endpoint transform');
    } finally { fx.dispose(); fx.dispose(); }
  });
  await check('editable Rorschach text', async () => {
    const fx = new RorschachTextFX(scene, { width: 512, height: 288, settings: INK_PRESETS.note });
    try {
      fx.setContent('Prueba de tinta viva', 'Nota'); fx.revealCharacters(10);
      await frame();
      fx.setContent('Texto editado', 'Nota'); await frame();
      await ready('text', () => fx.renderer.material.isReady(fx.renderer.plane), () => fx.renderer.plane.subMeshes?.[0]?.effect?.getCompilationError());
    } finally { fx.dispose(); fx.dispose(); }
  });
  await check('rigged PBR GLB and projection', async () => {
    const glb = await SceneLoader.ImportMeshAsync('', '/assets/models/enemies/', 'shadow_grabber.glb', scene);
    const meshes = glb.meshes;
    assert(glb.skeletons.length > 0 && glb.animationGroups.length > 0, 'GLB rig/animation missing');
    const materialMesh = meshes.find(mesh => mesh.material instanceof PBRMaterial && mesh.getTotalVertices() > 0);
    assert(materialMesh, 'PBR mesh missing');
    const original = materialMesh.material;
    const fx = new EtherealMeshFX(scene, meshes, { dissolve: 0.25 });
    try {
      fx.update({ dissolve: 0.6 }); await frame();
      assert(materialMesh.material !== original, 'ethereal material not cloned');
      await ready('ethereal', () => !!materialMesh.material?.isReady(materialMesh), () => materialMesh.subMeshes?.[0]?.effect?.getCompilationError());
    } finally { fx.dispose(); fx.dispose(); }
    assert(materialMesh.material === original, 'ethereal material not restored');
    const projection = await createDimensionalProjection(scene, 'ldK3RW', meshes);
    try { projection.update({ progress: 0.7 }); await frame(); await ready('projection', () => projection.value.texture.isReady(), () => undefined); }
    finally { projection.dispose(); projection.dispose(); }
    assert(materialMesh.material === original, 'projection material not restored');
    meshes.forEach(mesh => mesh.dispose());
  });
  await frame();
  window.__dimensionalSmoke = { done: true, checks, gpu, fps: engine.getFps() };
  results.textContent = JSON.stringify(window.__dimensionalSmoke, null, 2);
  scene.dispose(); engine.dispose();
}
void run().catch(error => {
  checks.push({ name: 'fatal', ok: false, detail: String(error) });
  window.__dimensionalSmoke = { done: true, checks, gpu, fps: engine.getFps() };
  results.textContent = JSON.stringify(window.__dimensionalSmoke, null, 2);
  scene.dispose(); engine.dispose();
});
