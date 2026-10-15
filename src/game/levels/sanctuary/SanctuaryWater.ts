import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Effect } from "@babylonjs/core/Materials/effect";
import type { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { WaterMaterial } from "@babylonjs/materials/water/waterMaterial";

const WATER_NORMAL_PATH = "/assets/textures/sanctuary/river_normals_512.png";
const WATER_BLOOD_PATH = "/assets/textures/sanctuary/river_blood_512.png";

// WaterMaterial's vertex shader uses waveCount / 2 as its spatial frequency
// and advances its own time in units of elapsed seconds / 100. The two moving
// normal-map samples provide smaller-scale relief under the tinted surface film.
const REFLECTIVE_WAVES = {
  amplitude: 0.10,
  phaseSpeed: 42,
  largeWaveCount: 0.28,
  mediumNormalTiling: 240,
  normalWaveLength: 0.72,
  normalStrength: 0.28,
  normalDrift: 1.4,
  directionX: 0.75,
  directionZ: 0.40,
  reflectionTint: 0.65,
} as const;

export type SanctuaryWaterQuality = "reflective" | "lightweight";
export interface SanctuaryWaterHandle {
  material: Material;
  readonly quality: SanctuaryWaterQuality;
  addReflectors(meshes: readonly AbstractMesh[]): void;
  addSurfaceDetail(surface: Mesh): void;
  sampleHeight(x: number, z: number, t: number): number;
  update(seconds: number): void;
}

// The lightweight shader stays flat and keeps its original gentle raft motion.
function sampleGentleSwell(x: number, z: number, seconds: number) {
  return 0.085 * Math.sin(x * 0.035 + z * 0.019 - seconds * 0.67) +
         0.045 * Math.sin(x * 0.067 - z * 0.041 - seconds * 0.49);
}

// Mirrors the dominant terms of Babylon's WaterMaterial vertex displacement.
// Its internal clock is independent of the level clock, so this is deliberately
// an approximation, not exact physical buoyancy.
function sampleReflectiveSwell(x: number, z: number, seconds: number) {
  const spatialFrequency = REFLECTIVE_WAVES.largeWaveCount * 0.5;
  const phase = seconds * REFLECTIVE_WAVES.phaseSpeed * 0.01;
  const xWave = Math.sin(x * spatialFrequency + phase) * REFLECTIVE_WAVES.directionX;
  const zWave = Math.cos(z * spatialFrequency + phase) * REFLECTIVE_WAVES.directionZ;
  return Math.abs(xWave + zWave) * REFLECTIVE_WAVES.amplitude * 5;
}

// Two differently paced samples and a changing UV warp make the heavy surface
// fold and stretch without reading as a single scrolling texture.
const BLOOD_PATTERN = `
  uniform sampler2D uBlood;
  vec4 bloodFilm(vec2 worldXZ, float seconds) {
    vec2 uv = worldXZ * .0055;
    vec2 warp = vec2(
      sin(uv.y * 17.0 + seconds * .17) + .5 * sin(uv.x * 11.0 - seconds * .11),
      cos(uv.x * 13.0 - seconds * .13) + .5 * sin(uv.y * 9.0 + seconds * .08)
    ) * .008;
    vec3 slow = texture2D(uBlood, uv + vec2(seconds * .00035, -seconds * .0014) + warp).rgb;
    vec3 fold = texture2D(uBlood, uv * 1.67 + vec2(.37, .21)
      + vec2(-seconds * .0006, seconds * .0008) - warp * .6).rgb;
    float thickness = clamp((mix(slow.r, fold.r, .32) - .22) * 2.4 + .5, 0.0, 1.0);
    float sheen = pow(smoothstep(.21, .34, slow.r), 3.0) * (.4 + .6 * fold.r);
    vec3 color = mix(vec3(.018, .0005, .003), vec3(.27, .016, .022), thickness);
    color += vec3(.07, .014, .011) * sheen;
    return vec4(color, .29 + .18 * thickness);
  }
`;

const createBloodTexture = (scene: Scene) => {
  const texture = new Texture(WATER_BLOOD_PATH, scene, true, false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
};

/** Default desktop renderer: actual water reflection/refraction RTTs and normal-driven ripples. */
export function createSanctuaryWater(scene: Scene, mobile: boolean): SanctuaryWaterHandle {
  if (!mobile) {
    const material = new WaterMaterial("sanctuaryRiverReflected", scene, new Vector2(512, 512));
    const blood = createBloodTexture(scene);
    const bump = new Texture(WATER_NORMAL_PATH, scene, true, false);
    // The lake mesh spans kilometres: tile the normal map to keep near-boat
    // waves at human scale instead of stretching a single bump across it.
    bump.uScale = REFLECTIVE_WAVES.mediumNormalTiling;
    bump.vScale = REFLECTIVE_WAVES.mediumNormalTiling;
    material.bumpTexture = bump;
    material.bumpHeight = REFLECTIVE_WAVES.normalStrength;
    material.bumpAffectsReflection = true;
    material.bumpSuperimpose = true;
    material.windForce = REFLECTIVE_WAVES.normalDrift;
    material.windDirection = new Vector2(REFLECTIVE_WAVES.directionX, REFLECTIVE_WAVES.directionZ);
    material.useWorldCoordinatesForWaveDeformation = true;
    material.waveHeight = REFLECTIVE_WAVES.amplitude;
    material.waveSpeed = REFLECTIVE_WAVES.phaseSpeed;
    material.waveLength = REFLECTIVE_WAVES.normalWaveLength;
    material.waveCount = REFLECTIVE_WAVES.largeWaveCount;
    material.waterColor = new Color3(0.13, 0.004, 0.010);
    material.waterColor2 = new Color3(0.055, 0.001, 0.006);
    material.colorBlendFactor = 0.66;
    material.colorBlendFactor2 = REFLECTIVE_WAVES.reflectionTint;
    material.fresnelSeparate = true;
    material.specularColor = new Color3(0.44, 0.09, 0.09);
    material.specularPower = 34;
    material.backFaceCulling = false;
    Effect.ShadersStore.sanctuaryBloodFilmVertexShader = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 world;
      uniform mat4 viewProjection;
      uniform float uTime;
      varying vec3 vWorld;
      void main(void) {
        vec3 p = (world * vec4(position, 1.0)).xyz;
        float phase = uTime * ${(REFLECTIVE_WAVES.phaseSpeed * .01).toFixed(4)};
        float wave = sin(p.x * ${(REFLECTIVE_WAVES.largeWaveCount * .5).toFixed(4)} + phase)
          * ${(REFLECTIVE_WAVES.amplitude * REFLECTIVE_WAVES.directionX * 5).toFixed(4)}
          + cos(p.z * ${(REFLECTIVE_WAVES.largeWaveCount * .5).toFixed(4)} + phase)
          * ${(REFLECTIVE_WAVES.amplitude * REFLECTIVE_WAVES.directionZ * 5).toFixed(4)};
        p.y += abs(wave) + .055;
        vWorld = p;
        gl_Position = viewProjection * vec4(p, 1.0);
      }
    `;
    Effect.ShadersStore.sanctuaryBloodFilmFragmentShader = `
      precision highp float;
      varying vec3 vWorld;
      uniform float uTime;
      uniform float uFogDensity;
      uniform vec3 uCameraPosition;
      ${BLOOD_PATTERN}
      void main(void) {
        vec4 film = bloodFilm(vWorld.xz, uTime);
        float distanceToEye = length(vWorld - uCameraPosition);
        float visibility = exp(-pow(distanceToEye * uFogDensity, 2.0));
        gl_FragColor = vec4(film.rgb, film.a * visibility);
      }
    `;
    const filmMaterial = new ShaderMaterial("sanctuaryBloodFilm", scene, "sanctuaryBloodFilm", {
      attributes: ["position"],
      uniforms: ["world", "viewProjection", "uTime", "uFogDensity", "uCameraPosition"],
      samplers: ["uBlood"],
      needAlphaBlending: true,
    });
    filmMaterial.backFaceCulling = false;
    filmMaterial.disableDepthWrite = true;
    filmMaterial.setTexture("uBlood", blood);
    filmMaterial.setFloat("uFogDensity", scene.fogDensity);
    filmMaterial.setFloat("uTime", 0);
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
      addSurfaceDetail(surface) {
        const film = surface.clone("sanctuaryBloodSurface");
        if (!film) throw new Error("Could not create the sanctuary water detail surface.");
        film.material = filmMaterial;
        film.isPickable = false;
        film.checkCollisions = false;
        film.receiveShadows = false;
      },
      sampleHeight: sampleReflectiveSwell,
      update(seconds) {
        filmMaterial.setFloat("uTime", seconds);
        filmMaterial.setVector3("uCameraPosition", scene.activeCamera?.globalPosition ?? Vector3.Zero());
      },
    };
  }

  // Mobile/WebGL fallback. No additional RTTs or ocean FFT computations.
  const blood = createBloodTexture(scene);
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
    ${BLOOD_PATTERN}
    void main(void) {
      vec4 film = bloodFilm(vWorld.xz, uTime);
      vec3 color = mix(vec3(.045, .001, .005), film.rgb, .86);
      gl_FragColor = vec4(color, 1.0);
    }
  `;
  const material = new ShaderMaterial("sanctuaryRiverLiteV2", scene, "sanctuaryRiverLiteV2", {
    attributes: ["position"],
    uniforms: ["world", "worldViewProjection", "uTime"],
    samplers: ["uBlood"],
    needAlphaBlending: false,
  });
  material.backFaceCulling = false;
  material.setTexture("uBlood", blood);
  material.setFloat("uTime", 0);
  return {
    material,
    quality: "lightweight",
    addReflectors() {},
    addSurfaceDetail() {},
    sampleHeight: sampleGentleSwell,
    update(seconds) { material.setFloat("uTime", seconds); },
  };
}
