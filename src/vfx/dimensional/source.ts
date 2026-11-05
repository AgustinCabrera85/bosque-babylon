import type { DimensionalFXId } from './catalog';

/** Vite lazy imports: no GLSL is downloaded/evaluated unless requested. */
const shaderModules = import.meta.glob('./shaders/*.frag.glsl', { query: '?raw', import: 'default' });
const sourceCache = new Map<string, Promise<string>>();

const glslHeader = `precision highp float;
varying vec2 vUV;
uniform float uTime,uIntensity,uScale,uSpeed,uProgress,uAspect,uBranchWidth,uBranchDensity,uGrowthSpread,uGridSpeed,uReflection,uSunGlow,uSunGlowRadius,uSunRimWidth;
uniform vec3 uColorA,uColorB,uSunTopColor,uSunBottomColor,uSunHaloColor;
uniform vec2 uResolution,uVoidCenter,uDarkCenter;
uniform float uVoidRadius,uVoidOpen,uVoidSoftness,uVoidPhase,uVoidWobble,uDarkRadius,uDarkOpen,uDarkSoftness,uDarkPhase,uDarkWobble;
uniform sampler2D textureSampler;
`;
let sharedPromise: Promise<string> | undefined;
const shared = () => sharedPromise ??= import('./shaders/common.glsl?raw').then(m=>m.default);
const legacyCosmic = () => import('./shaders/legacy/4t2cR1.v0.10.frag.glsl?raw').then(m=>m.default);
const legacyDarkness = () => import('./shaders/legacy/4XVBzK.v0.12.frag.glsl?raw').then(m=>m.default);
export type CosmicQuality = 'eco' | 'balanced' | 'high' | 'original';
export type DarknessVariant = 'controlled' | 'original';
export interface SourceVariant { cosmicQuality?: CosmicQuality; darknessVariant?: DarknessVariant; }

export async function loadDimensionalSource(id: DimensionalFXId, variant: SourceVariant = {}): Promise<string> {
  const quality=id==='4t2cR1' ? variant.cosmicQuality??'balanced' : '-';
  const darkness=id==='4XVBzK' ? variant.darknessVariant??'controlled' : '-';
  const cacheKey=`${id}_${quality}_${darkness}`;
  let promise=sourceCache.get(cacheKey);
  if(!promise) {
    promise=Promise.all([
      shared(),
      id==='4t2cR1' && quality==='original' ? legacyCosmic() :
      id==='4XVBzK' && darkness==='original' ? legacyDarkness() :
      (shaderModules[`./shaders/${id}.frag.glsl`]?.() as Promise<string> | undefined ?? Promise.reject(new Error(`No GLSL for ${id}`)))
    ]).then(([common,body])=>{
      const steps=id==='4t2cR1'&&quality!=='original' ? `#define DFX_COSMIC_STEPS ${{eco:12,balanced:20,high:28}[quality as 'eco'|'balanced'|'high']}\n` : '';
      return `${glslHeader}\n${steps}${common}\n${body}\nvoid main(void){gl_FragColor=renderEffect(vUV);}`;
    });
    sourceCache.set(cacheKey,promise);
  }
  return promise;
}
