import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Effect } from "@babylonjs/core/Materials/effect";
import type { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { WaterMaterial } from "@babylonjs/materials/water/waterMaterial";

const WATER_NORMAL_PATH = "/assets/textures/sanctuary/river_normals_512.png";

export type SanctuaryWaterQuality = "reflective" | "lightweight";
export interface SanctuaryWaterHandle {
  material: Material;
  readonly quality: SanctuaryWaterQuality;
  addReflectors(meshes: readonly AbstractMesh[]): void;
  sampleHeight(x: number, z: number, t: number): number;
  update(seconds: number): void;
}

// Time-scaled analytic height is used ONLY for raft bobbing. Babylon WaterMaterial
// computes the displayed waves separately; this is not exact hydrodynamic buoyancy.
function sampleGentleSwell(x: number, z: number, seconds: number) {
  return 0.085 * Math.sin(x * 0.035 + z * 0.019 - seconds * 0.67) +
         0.045 * Math.sin(x * 0.067 - z * 0.041 - seconds * 0.49);
}

/** Default desktop renderer: actual water reflection/refraction RTTs and normal-driven ripples. */
export function createSanctuaryWater(scene: Scene, mobile: boolean): SanctuaryWaterHandle {
  if (!mobile) {
    const material = new WaterMaterial("sanctuaryRiverReflected", scene, new Vector2(512, 512));
    const bump = new Texture(WATER_NORMAL_PATH, scene, true, false);
    // The lake mesh spans kilometres: tile the normal map to keep near-boat
    // waves at human scale instead of stretching a single bump across it.
    bump.uScale = 80;
    bump.vScale = 80;
    material.bumpTexture = bump;
    material.bumpHeight = 0.17;
    material.bumpAffectsReflection = true;
    material.bumpSuperimpose = true;
    material.windForce = 1.5;
    material.windDirection = new Vector2(0.7, 0.3);
    material.waveHeight = 0.16;
    material.waveSpeed = 0.17;
    material.waveLength = 0.65;
    material.waveCount = 7;
    material.waterColor = new Color3(0.18, 0.007, 0.016);
    material.waterColor2 = new Color3(0.085, 0.003, 0.010);
    material.colorBlendFactor = 0.58;
    material.colorBlendFactor2 = 0.72;
    material.fresnelSeparate = true;
    material.specularColor = new Color3(0.75, 0.22, 0.20);
    material.specularPower = 70;
    material.backFaceCulling = false;
    return {
      material,
      quality: "reflective",
      addReflectors(meshes) {
        // Do NOT reflect the water itself (feedback loop) or the moving sky dome:
        // its main-camera raymarch would be inaccurate from the mirror camera.
        for (const mesh of meshes) {
          if (!mesh.isDisposed()) material.addToRenderList(mesh);
        }
      },
      sampleHeight: sampleGentleSwell,
      update() { /* WaterMaterial advances its internal time through the Babylon engine. */ },
    };
  }

  // Mobile/WebGL fallback. No additional RTTs or ocean FFT computations.
  Effect.ShadersStore.sanctuaryRiverLiteV2VertexShader = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 world;
    uniform mat4 worldViewProjection;
    varying vec3 vWorld;
    void main(void) {
      vWorld = (world * vec4(position, 1.0)).xyz;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;
  Effect.ShadersStore.sanctuaryRiverLiteV2FragmentShader = `
    precision highp float;
    varying vec3 vWorld;
    uniform float uTime;
    void main(void) {
      vec2 p = vWorld.xz;
      float a = sin(p.x * .075 + p.y * .024 - uTime * .36);
      float b = sin(p.y * .10 - p.x * .034 - uTime * .24);
      float c = sin(p.x * .14 + p.y * .064 + uTime * .18);
      float glint = pow(clamp(a * b * .5 + c * .3 + .55, 0.0, 1.0), 12.0);
      vec3 dark = vec3(.055,.002,.008);
      vec3 ruby = vec3(.19,.014,.021);
      vec3 col = mix(dark, ruby, clamp(.45 + a*.20 + b*.12, 0.0, 1.0));
      col += vec3(.22,.045,.03) * glint;
      gl_FragColor = vec4(col, 1.0);
    }
  `;
  const material = new ShaderMaterial("sanctuaryRiverLiteV2", scene, "sanctuaryRiverLiteV2", {
    attributes: ["position"],
    uniforms: ["world", "worldViewProjection", "uTime"],
    needAlphaBlending: false,
  });
  material.backFaceCulling = false;
  material.setFloat("uTime", 0);
  return {
    material,
    quality: "lightweight",
    addReflectors() {},
    sampleHeight: sampleGentleSwell,
    update(seconds) { material.setFloat("uTime", seconds); },
  };
}
