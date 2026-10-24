import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { MusicPlaybackState } from "../../MusicPlayer";
import { loadRinaStandsSpriteAssets, type StandsSpriteAssets } from "./crowd/RinaStandsSpriteAtlas";
import { createRinaStandsSpritePlacements, type SpritePlacement,
  type StandsSector } from "./crowd/RinaStandsSpritePlacements";
import {
  getRinaFieldCrowdClipPools, getRinaFieldCrowdCue,
  RINA_FIELD_CROWD_BEAT_ORIGIN, RINA_FIELD_CROWD_BEAT_PERIOD,
} from "./RinaFieldCrowdMusic";

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 spriteClip;
attribute vec4 spriteMotion;
attribute vec4 spriteColor;
uniform mat4 world;
uniform mat4 viewProjection;
uniform vec3 cameraLocal;
uniform vec2 atlasGrid;
uniform float elapsedTime;
uniform float playbackSpeed;
uniform float chorusLevel;
uniform float songTime;
uniform float beatPulse;
uniform float jumpHeight;
varying vec2 vAtlasUv;
varying vec4 vColor;
void main(void) {
  mat4 instanceWorld = mat4(world0, world1, world2, world3);
  vec3 center = (instanceWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 facing = cameraLocal - center;
  float facingLength = max(length(facing.xz), 0.0001);
  vec3 right = vec3(facing.z / facingLength, 0.0, -facing.x / facingLength);
  float width = length(world0.xyz);
  float height = length(world1.xyz);
  vec3 localPosition = center + right * position.x * width + vec3(0.0, position.y * height, 0.0);
  if (chorusLevel > 0.001) {
    float beatPhase = fract((songTime - ${RINA_FIELD_CROWD_BEAT_ORIGIN.toFixed(5)}) /
      ${RINA_FIELD_CROWD_BEAT_PERIOD.toFixed(8)} + fract(spriteMotion.y * 0.618034));
    float jumpArc = pow(max(0.0, sin(3.14159265 * beatPhase)), 1.35);
    float jumpVariation = 0.84 + 0.16 * fract(spriteMotion.x * 17.23 + spriteMotion.y * 0.23);
    localPosition.y += jumpArc * chorusLevel * jumpVariation * jumpHeight *
      (0.9 + 0.1 * clamp(beatPulse, 0.0, 1.0));
  }
  gl_Position = viewProjection * world * vec4(localPosition, 1.0);

  float energetic = step(0.55, chorusLevel);
  vec4 activeClip = vec4(mix(spriteClip.x, spriteMotion.z, energetic),
    spriteClip.y, mix(spriteClip.z, spriteMotion.w, energetic), spriteClip.w);
  float speed = playbackSpeed * mix(1.0, 1.22, chorusLevel);
  float frame = mod(floor(elapsedTime * activeClip.z * speed * spriteMotion.x
    + spriteMotion.y), activeClip.y);
  float cell = activeClip.x + activeClip.w * activeClip.y + frame;
  float column = mod(cell, atlasGrid.x);
  float row = floor(cell / atlasGrid.x);
  // With Babylon's invertY upload, each source cell is bottom-up in UV space.
  // One pixel of inset plus bilinear sampling prevents adjacent cells from bleeding.
  vec2 cellUv = vec2(0.5 + position.x, position.y);
  cellUv = mix(vec2(0.006), vec2(0.994), cellUv);
  vAtlasUv = (vec2(column, row) + cellUv) / atlasGrid;
  vColor = spriteColor;
}`;

const FRAGMENT = `
precision highp float;
uniform sampler2D atlasTexture;
varying vec2 vAtlasUv;
varying vec4 vColor;
void main(void) {
  vec4 sampleColor = texture2D(atlasTexture, vAtlasUv);
  if (sampleColor.a * vColor.a < 0.48) discard;
  gl_FragColor = vec4(sampleColor.rgb * vColor.rgb * 0.65, 1.0);
}`;

export type RinaStandsSpriteDiagnostics = {
  spectatorsBySector: Record<StandsSector, number>;
  textureCount: number;
  drawCallsApproximate: number;
  atlasBytesEstimated: number;
  updateMillisecondsAverage: number;
};

export type RinaStandsSpriteCrowdHandle = {
  root: TransformNode;
  diagnostics: RinaStandsSpriteDiagnostics;
  update(dt: number, beatPulse: number, music: MusicPlaybackState | null): void;
  dispose(): void;
};

function makeQuad(scene: Scene, name: string): Mesh {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
  data.indices = [0, 1, 2, 0, 2, 3];
  data.applyToMesh(mesh, true);
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = false;
  return mesh;
}

function makeMaterial(scene: Scene, atlas: StandsSpriteAssets["atlases"][number], index: number,
    playbackSpeed: number, jumpHeight: number): ShaderMaterial {
  const material = new ShaderMaterial(`rinaStandsSpriteAtlas_${index}`, scene,
    { vertexSource: VERTEX, fragmentSource: FRAGMENT }, {
      attributes: ["position", "spriteClip", "spriteMotion", "spriteColor"],
      uniforms: ["world", "viewProjection", "cameraLocal", "atlasGrid", "elapsedTime",
        "playbackSpeed", "chorusLevel", "songTime", "beatPulse", "jumpHeight"],
      samplers: ["atlasTexture"],
      needAlphaBlending: false,
      needAlphaTesting: true,
    });
  material.backFaceCulling = false;
  material.disableDepthWrite = false;
  material.setTexture("atlasTexture", atlas.texture);
  material.setVector2("atlasGrid", { x: atlas.columns, y: atlas.rows });
  material.setFloat("playbackSpeed", playbackSpeed);
  material.setFloat("chorusLevel", 0);
  material.setFloat("songTime", 0);
  material.setFloat("beatPulse", 0);
  material.setFloat("jumpHeight", jumpHeight);
  return material;
}

function fillBatch(mesh: Mesh, placements: readonly SpritePlacement[], assets: StandsSpriteAssets,
    clipPools: readonly ReturnType<typeof getRinaFieldCrowdClipPools>[] | null): void {
  const count = placements.length;
  const matrices = new Float32Array(count * 16);
  const clips = new Float32Array(count * 4);
  const motion = new Float32Array(count * 4);
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const p = placements[i];
    const m = i * 16;
    matrices[m] = p.width;
    matrices[m + 5] = p.height;
    matrices[m + 10] = 1;
    matrices[m + 12] = p.x;
    matrices[m + 13] = p.y;
    matrices[m + 14] = p.z;
    matrices[m + 15] = 1;
    const atlas = assets.atlases[p.spectator.atlasIndex];
    let calm = atlas.clips[p.spectator.clipIndex];
    let chorus = calm;
    if (clipPools) {
      const pools = clipPools[p.spectator.atlasIndex];
      const seedValue = Math.sin(p.x * 12.9898 + p.y * 37.719 + p.z * 78.233) * 43758.5453;
      const seed = seedValue - Math.floor(seedValue);
      const variant = Math.floor(seed * 65536);
      const calmOptions = pools.calm.filter(index =>
        atlas.clips[index].views > p.spectator.viewIndex);
      calm = atlas.clips[calmOptions.length
        ? calmOptions[variant % calmOptions.length] : p.spectator.clipIndex];
      const chorusOptions = pools.chorus.filter(index =>
        atlas.clips[index].views > p.spectator.viewIndex &&
        atlas.clips[index].frames === calm.frames);
      chorus = chorusOptions.length
        ? atlas.clips[chorusOptions[(variant * 7 + 3) % chorusOptions.length]] : calm;
    }
    const a = i * 4;
    clips.set([calm.startCell, calm.frames, calm.playbackFps, p.spectator.viewIndex], a);
    motion.set([p.spectator.speed, p.spectator.frameOffset,
      chorus.startCell, chorus.playbackFps], a);
    const [r, g, b, alpha] = p.spectator.color;
    colors[a] = r * p.brightness;
    colors[a + 1] = g * p.brightness;
    colors[a + 2] = b * p.brightness;
    colors[a + 3] = alpha;
  }
  mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
  mesh.thinInstanceSetBuffer("spriteClip", clips, 4, true);
  mesh.thinInstanceSetBuffer("spriteMotion", motion, 4, true);
  mesh.thinInstanceSetBuffer("spriteColor", colors, 4, true);
  // Bounds are static within a spatial batch and include thin instance transforms.
  mesh.thinInstanceRefreshBoundingInfo(true);
}

export async function createRinaStandsSpriteCrowd(scene: Scene,
    tier: "desktop" | "mobile"): Promise<RinaStandsSpriteCrowdHandle> {
  const assets = await loadRinaStandsSpriteAssets(scene);
  const root = new TransformNode("rinaStandsSpriteCrowdRoot", scene);
  const materials: ShaderMaterial[] = [];
  const meshes: Mesh[] = [];
  try {
    const placements = createRinaStandsSpritePlacements(tier, assets.spectators);
    const clipPools = tier === "desktop" ? assets.atlases.map(atlas =>
      getRinaFieldCrowdClipPools(atlas.clips.map(clip => clip.name))) : null;
    const groups = new Map<string, SpritePlacement[]>();
    const spectatorsBySector = {
      "rear-lower": 0, "rear-upper": 0,
      "side-left-lower": 0, "side-left-upper": 0,
      "side-right-lower": 0, "side-right-upper": 0,
    } satisfies Record<StandsSector, number>;
    placements.forEach(p => {
      spectatorsBySector[p.sector]++;
      const key = `${p.batch}/${p.spectator.atlasIndex}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    });
    assets.atlases.forEach((atlas, i) => materials.push(makeMaterial(
      scene, atlas, i, assets.playbackSpeed, tier === "desktop" ? 0.15 : 0)));
    for (const [key, members] of groups) {
      const atlasIndex = members[0].spectator.atlasIndex;
      const mesh = makeQuad(scene, `rinaStandsSprite_${key.replace("/", "_")}`);
      mesh.material = materials[atlasIndex];
      mesh.parent = root;
      fillBatch(mesh, members, assets, clipPools);
      meshes.push(mesh);
    }
    const diagnostics: RinaStandsSpriteDiagnostics = {
      spectatorsBySector, textureCount: assets.atlases.length,
      drawCallsApproximate: groups.size,
      atlasBytesEstimated: assets.atlases.reduce((n, a) => n + a.width * a.height * 4, 0),
      updateMillisecondsAverage: 0,
    };
    console.info("Rina stands sprite crowd", diagnostics);
    let elapsed = 0;
    let frames = 0;
    let disposed = false;
    const inverse = root.getWorldMatrix().clone();
    return {
      root, diagnostics,
      update(dt, beatPulse, music) {
        if (disposed) return;
        const start = performance.now();
        elapsed += Math.max(0, dt);
        const cue = tier === "desktop" ? getRinaFieldCrowdCue(music) : null;
        root.computeWorldMatrix(true);
        inverse.copyFrom(root.getWorldMatrix()).invert();
        const cameraLocal = scene.activeCamera
          ? Vector3.TransformCoordinates(scene.activeCamera.globalPosition, inverse)
          : Vector3.Zero();
        materials.forEach(material => {
          material.setFloat("elapsedTime", elapsed);
          if (cue) {
            material.setFloat("chorusLevel", cue.chorus);
            material.setFloat("songTime", cue.songTime);
            material.setFloat("beatPulse", beatPulse);
          }
          material.setVector3("cameraLocal", cameraLocal);
        });
        diagnostics.updateMillisecondsAverage += (performance.now() - start
          - diagnostics.updateMillisecondsAverage) / ++frames;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        meshes.forEach(mesh => mesh.dispose());
        materials.forEach(material => material.dispose(false, false));
        assets.dispose();
        root.dispose();
      },
    };
  } catch (error) {
    meshes.forEach(mesh => mesh.dispose());
    materials.forEach(material => material.dispose(false, false));
    assets.dispose();
    root.dispose();
    throw error;
  }
}
