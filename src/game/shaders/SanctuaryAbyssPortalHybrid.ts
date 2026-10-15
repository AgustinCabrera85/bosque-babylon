/**
 * LRLO / Santuario Nexo — texture-atlas overlay for SanctuaryAbyssPortal.ts.
 *
 * Does not replace the shader, alter gateRedVoid, or touch the wall/guardians.
 * Mount only on the existing gateRedVoid box, on its approach-facing (-Z) face.
 * Original procedural base is retained while textures are loading or if they fail.
 *
 * The atlas and composition JSON are in public/assets/textures/sanctuary/abyss_portal.
 * User-visible bypass: ?sanctuaryPortalHybrid=off
 */
import {
  AbstractMesh, Constants, Effect, Mesh, MeshBuilder, Scene,
  ShaderMaterial, Texture, Vector2, Vector3, VertexBuffer,
} from "@babylonjs/core";
import { asset } from "../../utils/asset";
import { createSanctuaryAbyssPortal } from "./SanctuaryAbyssPortal";
import { createSanctuaryPortalThreshold } from "./SanctuaryPortalThreshold";

const ASSET_DIRECTORY = "assets/textures/sanctuary/abyss_portal/";

interface Rect { x: number; y: number; width: number; height: number }
interface SpriteDef {
  id: string;
  category: "architecture" | "specter" | "mist" | "debris" | "rift";
  width: number;
  height: number;
  atlas: string;
  rect_px: Rect;
  uv_bottom_origin: { u0: number; v0: number; u1: number; v1: number };
}
interface Manifest { schema: string; atlases: { file: string; width: number; height: number }[]; sprites: SpriteDef[] }
interface Placement {
  id: string; x: number; y: number; height_fraction: number;
  depth: number; opacity: number; motion: "mist" | "specter" | "drift" | "still"; phase: number;
}
interface Composition { schema: string; placements: Placement[] }
interface ElementInstance { mesh: Mesh; baseX: number; baseY: number; depth: number; phase: number; motion: Placement["motion"] }
export interface HybridPortalOptions {
  /** Simpler population on constrained devices, without additional atlas downloads. */
  mobile?: boolean;
  /** 1 retains all of the old angular primitives; 0 replaces old architecture with PNG silhouettes. */
  proceduralStructureMix?: number;
  /** World Z at the visible front of the stone gate. */
  portalMouthZ?: number;
}

Effect.ShadersStore["sanctuaryPortalSpriteVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec2 uv2;
attribute vec4 color;
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform mat4 uPortalInverse;
varying vec2 vAtlasUV;
varying vec2 vSpriteUV;
varying vec2 vPortalXY;
varying vec4 vSpriteData;
void main() {
  vec4 local = vec4(position, 1.0);
  vPortalXY = (uPortalInverse * world * local).xy;
  vAtlasUV = uv;
  vSpriteUV = uv2;
  vSpriteData = color;
  gl_Position = worldViewProjection * local;
}
`;

Effect.ShadersStore["sanctuaryPortalSpriteFragmentShader"] = `
precision highp float;
varying vec2 vAtlasUV;
varying vec2 vSpriteUV;
varying vec2 vPortalXY;
varying vec4 vSpriteData;
uniform sampler2D uAtlas;
uniform vec2 uApertureHalfSize;
uniform float uTime;
void main() {
  // Hard aperture scissor in the gate's own local coordinates — never draw over
  // the monolithic wall, the portal frame, or either guardian.
  if (abs(vPortalXY.x) > uApertureHalfSize.x || abs(vPortalXY.y) > uApertureHalfSize.y) discard;
  vec4 texel = texture2D(uAtlas, vAtlasUV);
  if (texel.a < 0.006) discard;
  // vSpriteData: r=kind (0=solid, .5=rift, 1=mist), g=depth,
  // b=per-sprite phase, a=opacity. The fog changes shape across each sprite.
  float mist = step(0.75, vSpriteData.r);
  float rift = step(0.375, vSpriteData.r) * (1.0 - mist);
  vec2 portalUV = vPortalXY / max(uApertureHalfSize, vec2(0.001));
  float flow = 0.70
    + 0.18 * sin(portalUV.x * 7.0 - uTime * 0.75 + vSpriteData.b * 6.28)
    + 0.12 * sin(portalUV.y * 11.0 + portalUV.x * 4.0 + uTime * 0.52);
  float smokeHeight = (portalUV.y + 1.0) * 0.5;
  float smokeTop = 0.17
    + 0.035 * sin(portalUV.x * 13.0 - uTime * 0.34 + vSpriteData.b * 6.28)
    + 0.018 * sin(portalUV.x * 23.0 + uTime * 0.21);
  float lowSmoke = 1.0 - smoothstep(smokeTop - 0.055, smokeTop + 0.045, smokeHeight);
  float softSides = smoothstep(0.0, 0.16, vSpriteUV.x)
    * (1.0 - smoothstep(0.84, 1.0, vSpriteUV.x));
  float softTop = 1.0 - smoothstep(0.78, 1.0, vSpriteUV.y);
  float softBottom = smoothstep(0.0, 0.05, vSpriteUV.y);
  texel.a *= vSpriteData.a * mix(1.0, flow * lowSmoke
    * softSides * softTop * softBottom, mist);
  float riftPulse = 0.80 + 0.20 * sin(uTime * 1.7)
    + 0.09 * sin(uTime * 2.9)
    + 0.16 * pow(max(0.0, sin(portalUV.y * 27.0 - uTime * 3.1)), 10.0);
  texel.rgb *= mix(1.0, riftPulse, rift);
  float distanceHaze = (1.0 - vSpriteData.g) * 0.26;
  texel.rgb = mix(texel.rgb, vec3(0.052, 0.069, 0.094), distanceHaze + 0.10 * mist);
  gl_FragColor = vec4(texel.rgb, texel.a);
}
`;

// A thin, moving light pass sits in front of the atlas. The photographed rift
// remains visible underneath it while energy travels up the opening.
Effect.ShadersStore["sanctuaryPortalEnergyVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform mat4 uPortalInverse;
varying vec2 vUV;
varying vec2 vPortalXY;
void main() {
  vec4 local = vec4(position, 1.0);
  vUV = uv;
  vPortalXY = (uPortalInverse * world * local).xy;
  gl_Position = worldViewProjection * local;
}
`;

Effect.ShadersStore["sanctuaryPortalEnergyFragmentShader"] = `
precision highp float;
varying vec2 vUV;
varying vec2 vPortalXY;
uniform vec2 uApertureHalfSize;
uniform float uTime;
void main() {
  if (abs(vPortalXY.x) > uApertureHalfSize.x || abs(vPortalXY.y) > uApertureHalfSize.y) discard;
  float t = uTime;
  float center = 0.50 + 0.013 * sin(vUV.y * 15.0 - t * 1.1)
    + 0.006 * sin(vUV.y * 37.0 + t * 1.9);
  float distanceToRift = abs(vUV.x - center);
  float core = exp(-distanceToRift * 135.0);
  float halo = exp(-distanceToRift * 24.0);
  float travelling = pow(max(0.0, sin(vUV.y * 27.0 - t * 3.1)), 10.0);
  float pulse = 0.80 + 0.20 * sin(t * 1.7) + 0.09 * sin(t * 2.9);
  float light = (core * (0.38 + travelling * 0.56) + halo * 0.14) * pulse;

  // Low, translucent wisps cross the foreground without washing out the ruins.
  float lower = 1.0 - smoothstep(0.04, 0.27, vUV.y);
  float ribbons = 0.65 * sin(vUV.x * 15.0 - t * 0.62 + sin(vUV.y * 13.0 + t * 0.27))
    + 0.35 * sin(vUV.x * 27.0 + vUV.y * 9.0 + t * 0.39);
  float fog = lower * smoothstep(0.25, 0.82, ribbons) * 0.10;
  float alpha = clamp(light + fog, 0.0, 0.82);
  if (alpha < 0.005) discard;
  vec3 color = mix(vec3(0.23, 0.32, 0.43), vec3(0.70, 0.84, 1.0),
    clamp(light / max(alpha, 0.001), 0.0, 1.0));
  gl_FragColor = vec4(color, alpha);
}
`;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const validPath = (name: unknown) => typeof name === "string" && /^[a-zA-Z0-9_-]+\.(?:webp|png)$/.test(name);

async function loadJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return await res.json() as T;
}

function loadAtlas(file: string, scene: Scene): Promise<Texture> {
  return new Promise((resolve, reject) => {
    let texture: Texture | null = null;
    let failedBeforeAssign = false;
    const onLoad = () => { if (texture) resolve(texture); /* synchronous load is not expected */ };
    const onError = (message?: string, exception?: any) => {
      failedBeforeAssign = true;
      if (texture) texture.dispose();
      reject(new Error(`Atlas ${file}: ${message ?? String(exception ?? "unknown error")}`));
    };
    texture = new Texture(
      asset(ASSET_DIRECTORY + file), scene,
      false, /* build mipmaps */
      true,  /* invertY: converts top-origin atlas pixels to bottom-origin UVs */
      Texture.TRILINEAR_SAMPLINGMODE, onLoad, onError,
    );
    texture.hasAlpha = true;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    if (failedBeforeAssign) texture.dispose();
  });
}

export function createSanctuaryAbyssPortalHybrid(
  scene: Scene,
  surface: AbstractMesh,
  options: HybridPortalOptions = {},
) {
  const base = createSanctuaryAbyssPortal(scene, surface);
  const disabled = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("sanctuaryPortalHybrid") === "off";
  if (disabled) return base;

  const half = surface.getBoundingInfo().boundingBox.extendSize.clone();
  // The avatar approaches from world -Z on the sanctuary's ascending stairs.
  // gateRedVoid is a box: front face is at -half.z in its local space.
  const frontZ = -half.z - 0.025;
  const inversePortal = surface.computeWorldMatrix(true).clone().invert();
  const clipHalf = new Vector2(Math.max(0.1, half.x - .45), Math.max(0.1, half.y - .45));
  const cameraInPortal = Vector3.Zero();
  const abort = new AbortController();
  const instances: ElementInstance[] = [];
  const materials: ShaderMaterial[] = [];
  const textures: Texture[] = [];
  let energyMesh: Mesh | null = null;
  let threshold: ReturnType<typeof createSanctuaryPortalThreshold> | null = null;
  let isDisposed = false;
  let seconds = 0;
  let loaded = false;
  let viewX = 0;
  let viewY = 0;
  let viewDistance = 240;
  let viewReady = false;

  const observer = scene.onBeforeRenderObservable.add(() => {
    if (!loaded || isDisposed) return;
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.075);
    seconds += dt;
    const camera = scene.activeCamera;
    if (camera) {
      Vector3.TransformCoordinatesToRef(camera.globalPosition, inversePortal, cameraInPortal);
      // Treat the image layers as if they were several metres behind the gate.
      // Smooth camera movement without delaying the first visible frame.
      const targetY = cameraInPortal.y + half.y - 1.7;
      const targetDistance = Math.max(12, -cameraInPortal.z);
      if (!viewReady) {
        viewX = cameraInPortal.x;
        viewY = targetY;
        viewDistance = targetDistance;
        viewReady = true;
      } else {
        const follow = 1 - Math.exp(-dt * 8);
        viewX += (cameraInPortal.x - viewX) * follow;
        viewY += (targetY - viewY) * follow;
        viewDistance += (targetDistance - viewDistance) * follow;
      }
    }
    for (const inst of instances) {
      const virtualDepth = 4 + 70 * inst.depth * inst.depth;
      const perspective = virtualDepth / (viewDistance + virtualDepth);
      const shiftX = clamp(-viewX * perspective, -half.x * 0.32, half.x * 0.32);
      const shiftY = clamp(-viewY * perspective * 0.08,
        -half.y * 0.045, half.y * 0.045);
      const swayX = inst.motion === "mist" ? 0.055 : inst.motion === "specter" ? 0.018 : inst.motion === "drift" ? 0.024 : 0;
      const swayY = inst.motion === "mist" ? 0.025 : inst.motion === "specter" ? 0.025 : inst.motion === "drift" ? 0.015 : 0;
      inst.mesh.position.x = inst.baseX + shiftX
        + Math.sin(seconds * 0.52 + inst.phase) * half.x * swayX;
      inst.mesh.position.y = inst.baseY + shiftY
        + Math.cos(seconds * 0.39 + inst.phase * 1.3) * half.y * swayY;
    }
    for (const mat of materials) mat.setFloat("uTime", seconds);
    threshold?.update(seconds);
  });

  function dispose() {
    if (isDisposed) return;
    isDisposed = true;
    abort.abort();
    scene.onBeforeRenderObservable.remove(observer);
    for (const item of instances) item.mesh.dispose();
    energyMesh?.dispose();
    threshold?.dispose();
    for (const mat of materials) mat.dispose();
    for (const texture of textures) texture.dispose();
    base.dispose();
  }

  void (async () => {
    try {
      const [manifest, composition] = await Promise.all([
        loadJson<Manifest>(asset(ASSET_DIRECTORY + "portal_manifest.json"), abort.signal),
        loadJson<Composition>(asset(ASSET_DIRECTORY + "portal_composition.json"), abort.signal),
      ]);
      if (isDisposed || scene.isDisposed) return;
      if (manifest.schema !== "lrlo.sanctuary.abyss_portal.atlas.v1" ||
          composition.schema !== "lrlo.sanctuary.abyss_portal.composition.v1" ||
          !Array.isArray(manifest.sprites) || !Array.isArray(manifest.atlases) ||
          !Array.isArray(composition.placements)) {
        throw new Error("Invalid portal atlas or composition JSON schema");
      }
      const byId = new Map(manifest.sprites.map(s => [s.id, s]));
      const chosen = composition.placements.filter((p, i) =>
        (!options.mobile || i < 17 || p.motion === "mist") &&
        typeof p.id === "string" && byId.has(p.id) &&
        finite(p.x) && finite(p.y) && finite(p.height_fraction) &&
        finite(p.depth) && finite(p.opacity) && finite(p.phase)
      );
      // Decode only the atlas pages referenced by selected visible pieces.
      const needed = [...new Set(chosen.map(p => byId.get(p.id)!.atlas))];
      const atlasMap = new Map<string, Texture>();
      // Serial atlas loading makes early disposal predictable if the level changes
      // in the middle of a decode and avoids leaving half-loaded GPU textures.
      for (const name of needed) {
        if (!validPath(name) || !manifest.atlases.some(a => a.file === name))
          throw new Error(`Unrecognized atlas ${name}`);
        const texture = await loadAtlas(name, scene);
        if (isDisposed || scene.isDisposed) { texture.dispose(); return; }
        atlasMap.set(name, texture);
        textures.push(texture);
      }
      const shaderByAtlas = new Map<string, ShaderMaterial>();
      for (const name of needed) {
        const mat = new ShaderMaterial(`sanctuaryPortal_${name}`, scene,
          { vertex: "sanctuaryPortalSprite", fragment: "sanctuaryPortalSprite" },
          { attributes: ["position", "uv", "uv2", "color"],
            uniforms: ["world", "worldViewProjection", "uPortalInverse", "uApertureHalfSize", "uTime"],
            samplers: ["uAtlas"], needAlphaBlending: true });
        mat.setTexture("uAtlas", atlasMap.get(name)!);
        mat.setMatrix("uPortalInverse", inversePortal);
        mat.setVector2("uApertureHalfSize", clipHalf);
        mat.setFloat("uTime", 0);
        mat.backFaceCulling = false;
        mat.alphaMode = Constants.ALPHA_COMBINE;
        mat.disableDepthWrite = true;
        mat.fogEnabled = false;
        materials.push(mat);
        shaderByAtlas.set(name, mat);
      }
      for (const p of chosen) {
        const sprite = byId.get(p.id)!;
        if (!(sprite.width > 0 && sprite.height > 0)) continue;
        const fullHeight = clamp(p.height_fraction, 0.02, 1.3) * half.y * 2;
        const height = fullHeight * (sprite.category === "mist" ? 0.64 : 1);
        const width = height * sprite.width / sprite.height;
        const cx = p.x * half.x * 2;
        const cy = p.y * half.y * 2 - (fullHeight - height) * 0.5;
        const left = cx - width / 2, right = cx + width / 2;
        const bottom = cy - height / 2, top = cy + height / 2;
        // Keep hidden sprite margins so a moving viewpoint can reveal them.
        // The fragment shader still clips every pixel to the stone opening.
        const l = Math.max(left, -clipHalf.x - half.x * 0.40);
        const r = Math.min(right, clipHalf.x + half.x * 0.40);
        const b = Math.max(bottom, -clipHalf.y - half.y * 0.10);
        const t = Math.min(top, clipHalf.y + half.y * 0.10);
        if (r - l < 0.02 || t - b < 0.02) continue;
        const quad = MeshBuilder.CreatePlane(`sanctuaryPortalAsset_${p.id}`, {
          width: r - l, height: t - b, sideOrientation: Mesh.FRONTSIDE,
        }, scene);
        quad.parent = surface;
        quad.position.set((l + r) * .5, (b + t) * .5,
          frontZ - 0.025 - clamp(p.depth, 0, 1) * 0.37);
        quad.isPickable = false;
        quad.checkCollisions = false;
        quad.receiveShadows = false;
        quad.renderingGroupId = 0;
        quad.alphaIndex = Math.floor(p.depth * 1000);
        // Map crop in the aperture directly to the logical sprite within its atlas.
        // Plane UV coordinates can be read instead of guessing Babylon's vertex order.
        const orig = quad.getVerticesData(VertexBuffer.UVKind);
        if (!orig) { quad.dispose(); continue; }
        quad.setVerticesData(VertexBuffer.UV2Kind, orig);
        const tc = new Float32Array(orig.length);
        const uv = sprite.uv_bottom_origin;
        const minU = (l - left) / width, maxU = (r - left) / width;
        const minV = (b - bottom) / height, maxV = (t - bottom) / height;
        for (let i = 0; i < orig.length; i += 2) {
          tc[i] = uv.u0 + (minU + (maxU - minU) * orig[i]) * (uv.u1 - uv.u0);
          tc[i + 1] = uv.v0 + (minV + (maxV - minV) * orig[i + 1]) * (uv.v1 - uv.v0);
        }
        quad.setVerticesData(VertexBuffer.UVKind, tc);
        const vertexCount = quad.getVerticesData(VertexBuffer.PositionKind)!.length / 3;
        const data = new Float32Array(vertexCount * 4);
        for (let i = 0; i < vertexCount; i++) {
          data[i*4] = sprite.category === "mist" ? 1 : sprite.category === "rift" ? 0.5 : 0;
          data[i*4+1] = clamp(p.depth,0,1);
          data[i*4+2] = ((p.phase % 6.283) + 6.283) % 6.283 / 6.283;
          data[i*4+3] = clamp(p.opacity,0,1);
        }
        quad.setVerticesData(VertexBuffer.ColorKind, data);
        quad.material = shaderByAtlas.get(sprite.atlas)!;
        instances.push({ mesh: quad, baseX: quad.position.x, baseY: quad.position.y,
          depth: clamp(p.depth,0,1), phase: p.phase, motion: p.motion });
      }
      if (isDisposed || scene.isDisposed) return;
      loaded = instances.length > 0;
      // The underlying animation remains active, but old angular architecture is
      // suppressed so the photographic textures become the dominant silhouettes.
      if (loaded) {
        const energy = new ShaderMaterial("sanctuaryPortalEnergy", scene,
          { vertex: "sanctuaryPortalEnergy", fragment: "sanctuaryPortalEnergy" },
          { attributes: ["position", "uv"],
            uniforms: ["world", "worldViewProjection", "uPortalInverse", "uApertureHalfSize", "uTime"],
            needAlphaBlending: true });
        energy.setMatrix("uPortalInverse", inversePortal);
        energy.setVector2("uApertureHalfSize", clipHalf);
        energy.setFloat("uTime", 0);
        energy.backFaceCulling = false;
        energy.alphaMode = Constants.ALPHA_COMBINE;
        energy.disableDepthWrite = true;
        energy.fogEnabled = false;
        materials.push(energy);

        energyMesh = MeshBuilder.CreatePlane("sanctuaryPortalMovingLight", {
          width: clipHalf.x * 2, height: clipHalf.y * 2, sideOrientation: Mesh.FRONTSIDE,
        }, scene);
        energyMesh.parent = surface;
        energyMesh.position.z = frontZ - 0.43;
        energyMesh.isPickable = false;
        energyMesh.checkCollisions = false;
        energyMesh.renderingGroupId = 0;
        energyMesh.alphaIndex = 1001;
        energyMesh.material = energy;
        if (typeof options.portalMouthZ === "number" && Number.isFinite(options.portalMouthZ)) {
          threshold = createSanctuaryPortalThreshold(scene,
            surface.getAbsolutePosition().clone(), half, options.portalMouthZ, !!options.mobile);
        }
        base.material.setFloat("uGeometryMix", options.proceduralStructureMix ?? 0.07);
      }
    } catch (error) {
      if (!isDisposed && !abort.signal.aborted) {
        // Keep the existing procedural shader as fallback; don't leak partial atlas loads.
        for (const mesh of instances) mesh.mesh.dispose();
        instances.length = 0;
        energyMesh?.dispose();
        energyMesh = null;
        threshold?.dispose();
        threshold = null;
        for (const mat of materials) mat.dispose();
        materials.length = 0;
        for (const texture of textures) texture.dispose();
        textures.length = 0;
        loaded = false;
        console.warn("Sanctuary portal texture overlay unavailable, keeping procedural fallback:", error);
      }
    }
  })();

  return { material: base.material, dispose };
}
