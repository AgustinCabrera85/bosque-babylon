import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";

export const PORTAL_FOG_STYLE = {
  desktopDensity: 0.72,
  mobileDensity: 0.5,
  downwardFlowSpeed: 0.28,
  lateralFlowSpeed: 0.022,
} as const;

const VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute float fogWeight;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec2 vUV;
varying vec3 vWorldPosition;
varying float vFogWeight;
void main(void) {
  vec4 worldPosition = world * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vUV = uv;
  vFogWeight = fogWeight;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorldPosition;
varying float vFogWeight;
uniform float time;
uniform float density;
uniform vec3 fogColor;
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise21(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.55;
  for (int octave = 0; octave < 4; octave++) {
    value += noise21(p) * amplitude;
    p = p * 2.03 + vec2(7.1, 3.7);
    amplitude *= 0.48;
  }
  return value;
}
void main(void) {
  // Adding time to this world-space uphill coordinate makes the pattern move
  // toward decreasing Y/Z: visually, the fog pours down the staircase.
  vec2 flow = vec2(
    vWorldPosition.x * 0.31 + time * ${PORTAL_FOG_STYLE.lateralFlowSpeed.toFixed(3)},
    vWorldPosition.z * 0.095
      + vWorldPosition.y * 0.08
      + time * ${PORTAL_FOG_STYLE.downwardFlowSpeed.toFixed(3)}
  );
  float cloud = smoothstep(0.36, 0.73, fbm(flow));
  float fineWisp = 0.78 + 0.22 * noise21(flow * 3.1 - time * 0.07);
  float lateralFade = smoothstep(0.0, 0.2, vUV.x)
    * (1.0 - smoothstep(0.8, 1.0, vUV.x));
  float longitudinalFade = smoothstep(0.0, 0.055, vUV.y)
    * (1.0 - smoothstep(0.965, 1.0, vUV.y));
  float portalSource = mix(0.4, 1.0, smoothstep(0.05, 0.86, vUV.y));
  float alpha = cloud * fineWisp * lateralFade * longitudinalFade
    * portalSource * density * vFogWeight;
  gl_FragColor = vec4(fogColor, alpha);
}`;

export type PortalSideFogHandle = {
  update(dt: number): void;
  dispose(): void;
};

export function createPortalSideFog(
  scene: Scene,
  startZ: number,
  endZ: number,
  topY: number,
  baseWidth: number,
  topWidth: number,
  mobile: boolean
): PortalSideFogHandle {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const fogWeights: number[] = [];
  const segmentCount = mobile ? 40 : 72;
  const layerHeights = mobile ? [0.2, 0.55] : [0.16, 0.42, 0.72];
  const layerWidths = mobile ? [1.25, 0.9] : [1.5, 1.15, 0.82];
  const blanketLayerHeights = mobile ? [0.58] : [0.48, 0.78];
  const appendQuad = (points: number[], quadUvs: number[], fogWeight: number) => {
    const vertexOffset = positions.length / 3;
    positions.push(...points);
    uvs.push(...quadUvs);
    fogWeights.push(fogWeight, fogWeight, fogWeight, fogWeight);
    indices.push(
      vertexOffset,
      vertexOffset + 1,
      vertexOffset + 2,
      vertexOffset,
      vertexOffset + 2,
      vertexOffset + 3
    );
  };

  for (const side of [-1, 1]) {
    for (let layer = 0; layer < layerHeights.length; layer += 1) {
      const height = layerHeights[layer];
      const bandWidth = layerWidths[layer];
      const lateralGap = 0.14 + layer * 0.1;
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const t0 = segment / segmentCount;
        const t1 = (segment + 1) / segmentCount;
        const z0 = startZ + (endZ - startZ) * t0;
        const z1 = startZ + (endZ - startZ) * t1;
        const y0 = topY * t0 + height;
        const y1 = topY * t1 + height;
        const halfWidth0 = (baseWidth + (topWidth - baseWidth) * t0) * 0.5;
        const halfWidth1 = (baseWidth + (topWidth - baseWidth) * t1) * 0.5;
        const innerX0 = side * (halfWidth0 + lateralGap);
        const outerX0 = side * (halfWidth0 + lateralGap + bandWidth);
        const innerX1 = side * (halfWidth1 + lateralGap);
        const outerX1 = side * (halfWidth1 + lateralGap + bandWidth);
        appendQuad([
          innerX0, y0, z0,
          outerX0, y0, z0,
          outerX1, y1, z1,
          innerX1, y1, z1,
        ], [0, t0, 1, t0, 1, t1, 0, t1], 0.7);
      }
    }
  }

  for (let layer = 0; layer < blanketLayerHeights.length; layer += 1) {
    const height = blanketLayerHeights[layer];
    const edgeOverlap = 0.22 + layer * 0.08;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const t0 = segment / segmentCount;
      const t1 = (segment + 1) / segmentCount;
      const z0 = startZ + (endZ - startZ) * t0;
      const z1 = startZ + (endZ - startZ) * t1;
      const y0 = topY * t0 + height;
      const y1 = topY * t1 + height;
      const halfWidth0 = (baseWidth + (topWidth - baseWidth) * t0) * 0.5;
      const halfWidth1 = (baseWidth + (topWidth - baseWidth) * t1) * 0.5;
      appendQuad([
        -halfWidth0 - edgeOverlap, y0, z0,
        halfWidth0 + edgeOverlap, y0, z0,
        halfWidth1 + edgeOverlap, y1, z1,
        -halfWidth1 - edgeOverlap, y1, z1,
      ], [0, t0, 1, t0, 1, t1, 0, t1], 1);
    }
  }

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.uvs = uvs;
  const mesh = new Mesh("portalSideFogVolume", scene);
  vertexData.applyToMesh(mesh, true);
  mesh.setVerticesData("fogWeight", fogWeights, false, 1);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  const material = new ShaderMaterial(
    "portalSideFogMaterial",
    scene,
    { vertexSource: VERTEX_SHADER, fragmentSource: FRAGMENT_SHADER },
    {
      attributes: ["position", "uv", "fogWeight"],
      uniforms: ["world", "worldViewProjection", "time", "density", "fogColor"],
      needAlphaBlending: true,
    }
  );
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.alphaMode = Constants.ALPHA_COMBINE;
  material.setFloat("time", 0);
  material.setFloat(
    "density",
    mobile ? PORTAL_FOG_STYLE.mobileDensity : PORTAL_FOG_STYLE.desktopDensity
  );
  material.setColor3("fogColor", new Color3(0.28, 0.3, 0.34));
  mesh.material = material;
  let elapsed = 0;
  let disposed = false;
  return {
    update(dt) {
      if (disposed) return;
      elapsed += dt;
      material.setFloat("time", elapsed);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.dispose();
      material.dispose();
    },
  };
}
