import {
  Color3, Constants, Effect, Mesh, MeshBuilder, PointLight,
  Scene, ShaderMaterial, Vector3,
} from "@babylonjs/core";

const FOG_SHADER = "sanctuaryPortalOutflowFog";
const RIM_SHADER = "sanctuaryPortalMouthRim";
const FLOOR_SHADER = "sanctuaryPortalFloorSpill";
const SIDE_SHADER = "sanctuaryPortalSideGlow";
const CONTACT_SHADER = "sanctuaryPortalContactGlow";

Effect.ShadersStore[`${FOG_SHADER}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec2 vUV;
varying vec3 vWorld;
void main() {
  vUV = uv;
  vWorld = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

Effect.ShadersStore[`${FOG_SHADER}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorld;
uniform float uTime;
uniform float uMouthZ;
uniform float uReach;
uniform float uCenterX;
uniform float uDensity;
uniform float uLayer;
uniform float uPulse;
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // The flow opens outward across the landing and vanishes before the stairs.
  float travel = (uMouthZ - vWorld.z) / uReach;
  if (travel < 0.0 || travel > 1.0) discard;
  float halfWidth = mix(18.0, 36.0, travel);
  float lateral = abs(vWorld.x - uCenterX) / halfWidth;
  float fan = 1.0 - smoothstep(0.62, 1.0, lateral);
  float sourceFade = smoothstep(0.0, 0.14, travel);
  float stairFade = 1.0 - smoothstep(0.60, 0.94, travel);
  vec2 p = vec2((vWorld.x - uCenterX) * 0.080 + uTime * 0.065 + uLayer * 3.7,
    (uMouthZ - vWorld.z) * 0.090 - uTime * 0.20 + uLayer * 2.1);
  float broad = noise2(p);
  float detail = noise2(p * 2.15 + vec2(-uTime * 0.035, uTime * 0.045));
  float tendrils = smoothstep(0.42, 0.69, broad * 0.68 + detail * 0.32);
  float alpha = tendrils * fan * sourceFade * stairFade * uDensity
    * (0.92 + 0.08 * uPulse);
  if (alpha < 0.008) discard;
  vec3 color = mix(vec3(0.14, 0.20, 0.27), vec3(0.25, 0.34, 0.43),
    broad * 0.55 + detail * 0.25);
  gl_FragColor = vec4(color, alpha);
}
`;

Effect.ShadersStore[`${RIM_SHADER}VertexShader`] = Effect.ShadersStore[`${FOG_SHADER}VertexShader`];
Effect.ShadersStore[`${RIM_SHADER}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform float uPulse;
uniform float uDistanceBoost;
void main() {
  float side = min(vUV.x, 1.0 - vUV.x);
  float top = 1.0 - vUV.y;
  float innerShadow = exp(-abs(side - 0.075) * 38.0) * 0.08;
  float edgeLight = exp(-side * 38.0) * (0.08 + 0.09 * uPulse)
    + exp(-side * 14.0) * 0.13 * (uDistanceBoost - 1.0);
  float crown = exp(-top * 38.0) * 0.13 * uDistanceBoost;
  float travelling = pow(max(0.0, sin(vUV.y * 27.0 - uTime * 3.1)), 12.0);
  edgeLight += exp(-side * 68.0) * travelling * 0.09;
  float alpha = clamp(innerShadow + edgeLight + crown, 0.0, 0.54);
  if (alpha < 0.005) discard;
  float glow = (edgeLight + crown) / max(alpha, 0.001);
  vec3 color = mix(vec3(0.015, 0.025, 0.045), vec3(0.48, 0.70, 0.94), glow);
  gl_FragColor = vec4(color, alpha);
}
`;

Effect.ShadersStore[`${SIDE_SHADER}VertexShader`] = Effect.ShadersStore[`${FOG_SHADER}VertexShader`];
Effect.ShadersStore[`${SIDE_SHADER}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorld;
uniform float uTime;
uniform float uPulse;
uniform float uSourceZ;
uniform float uMouthZ;
void main() {
  // The contact edge at the portal is the source; the light recedes to the mouth.
  float distance = clamp((uSourceZ - vWorld.z) / (uSourceZ - uMouthZ), 0.0, 1.0);
  float depthFalloff = 0.27 + 0.73 * pow(1.0 - distance, 0.9);
  float contactGlow = exp(-distance * 8.0);
  float heightFade = 0.72 + 0.28 * smoothstep(0.0, 0.05, vUV.y)
    * (1.0 - smoothstep(0.95, 1.0, vUV.y));
  float wave = 0.5 + 0.5 * sin(vUV.y * 10.0 - uTime * 1.4 + distance * 1.7);
  float broadBeam = smoothstep(0.12, 0.86, wave);
  float alpha = heightFade * depthFalloff
    * (0.15 + 0.16 * uPulse + 0.13 * broadBeam + 0.11 * contactGlow);
  float footGlow = 1.0 - smoothstep(0.025, 0.11, vUV.y);
  alpha += footGlow * (0.16 + 0.09 * contactGlow);
  if (alpha < 0.005) discard;
  vec3 color = mix(vec3(0.24, 0.39, 0.57), vec3(0.64, 0.82, 1.0),
    0.42 * contactGlow + 0.48 * broadBeam);
  gl_FragColor = vec4(color, alpha);
}
`;

Effect.ShadersStore[`${CONTACT_SHADER}VertexShader`] = Effect.ShadersStore[`${FOG_SHADER}VertexShader`];
Effect.ShadersStore[`${CONTACT_SHADER}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform float uPulse;
void main() {
  float side = min(vUV.x, 1.0 - vUV.x);
  float halo = exp(-side * 22.0);
  float seam = exp(-side * 85.0);
  float sweep = 0.84 + 0.16 * sin(vUV.y * 10.0 - uTime * 1.4);
  float alpha = (0.32 * halo + 0.25 * seam) * sweep
    * (0.84 + 0.16 * uPulse);
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(0.54, 0.74, 1.0, alpha);
}
`;

Effect.ShadersStore[`${FLOOR_SHADER}VertexShader`] = Effect.ShadersStore[`${FOG_SHADER}VertexShader`];
Effect.ShadersStore[`${FLOOR_SHADER}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorld;
uniform float uTime;
uniform float uPulse;
uniform float uSourceZ;
uniform float uMouthZ;
void main() {
  float distance = clamp((uSourceZ - vWorld.z) / (uSourceZ - uMouthZ), 0.0, 1.0);
  float widthFade = 1.0 - smoothstep(0.30, 1.0, abs(vUV.x - 0.5) * 2.0);
  float sourceGlow = exp(-distance * 4.0);
  float movingShadow = 0.76 + 0.24
    * sin(vUV.x * 16.0 - uTime * 0.43)
    * sin(vUV.y * 12.0 + uTime * 0.31);
  float alpha = widthFade * movingShadow * (0.12 + 0.15 * sourceGlow)
    * (0.82 + 0.18 * uPulse);
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(0.34, 0.52, 0.77, alpha);
}
`;

type FogLayer = { mesh: Mesh; material: ShaderMaterial };

export function createSanctuaryPortalThreshold(
  scene: Scene,
  portalCenter: Vector3,
  portalHalf: Vector3,
  mouthZ: number,
  mobile: boolean,
) {
  const floorY = portalCenter.y - portalHalf.y;
  // Just in front of the shader's approach-facing surface.
  const sourceZ = portalCenter.z - portalHalf.z - 0.7;
  const fogReach = 46;
  const edgeLights: PointLight[] = [];
  for (const direction of [-1, 1]) {
    const light = new PointLight(`sanctuaryPortalEdgeLight_${direction}`, new Vector3(
      portalCenter.x + direction * (portalHalf.x - 3), portalCenter.y, sourceZ - 8,
    ), scene);
    light.diffuse = new Color3(0.50, 0.72, 1.0);
    light.specular = new Color3(0.31, 0.49, 0.74);
    light.range = mobile ? 145 : 160;
    light.intensity = 0;
    edgeLights.push(light);
  }

  const rimMaterial = new ShaderMaterial("sanctuaryPortalMouthRim", scene, RIM_SHADER, {
    attributes: ["position", "uv"],
    uniforms: ["worldViewProjection", "uTime", "uPulse", "uDistanceBoost"],
    needAlphaBlending: true,
  });
  rimMaterial.backFaceCulling = false;
  rimMaterial.disableDepthWrite = true;
  rimMaterial.fogEnabled = false;
  rimMaterial.alphaMode = Constants.ALPHA_COMBINE;
  rimMaterial.setFloat("uTime", 0);
  rimMaterial.setFloat("uPulse", 0.75);
  rimMaterial.setFloat("uDistanceBoost", 1);
  const rim = MeshBuilder.CreatePlane("sanctuaryPortalMouthGlow", {
    width: portalHalf.x * 2, height: portalHalf.y * 2, sideOrientation: Mesh.FRONTSIDE,
  }, scene);
  rim.position.set(portalCenter.x, portalCenter.y, mouthZ - 3);
  rim.material = rimMaterial;
  rim.alphaIndex = 1020;
  rim.isPickable = false;
  rim.checkCollisions = false;

  const floorMaterial = new ShaderMaterial("sanctuaryPortalFloorSpill", scene, FLOOR_SHADER, {
    attributes: ["position", "uv"],
    uniforms: ["world", "worldViewProjection", "uTime", "uPulse", "uSourceZ", "uMouthZ"],
    needAlphaBlending: true,
  });
  floorMaterial.backFaceCulling = false;
  floorMaterial.disableDepthWrite = true;
  floorMaterial.fogEnabled = false;
  floorMaterial.alphaMode = Constants.ALPHA_ADD;
  floorMaterial.setFloat("uTime", 0);
  floorMaterial.setFloat("uPulse", 0.75);
  floorMaterial.setFloat("uSourceZ", sourceZ);
  floorMaterial.setFloat("uMouthZ", mouthZ);
  const floorSpill = MeshBuilder.CreateGround("sanctuaryPortalFloorGlow", {
    width: portalHalf.x * 2, height: sourceZ - mouthZ, subdivisions: 1,
  }, scene);
  floorSpill.position.set(portalCenter.x, floorY + 0.12, (sourceZ + mouthZ) * 0.5);
  floorSpill.material = floorMaterial;
  floorSpill.alphaIndex = 1010;
  floorSpill.isPickable = false;
  floorSpill.checkCollisions = false;

  // The jambs run through the deep tunnel, so glow on their inner faces joins
  // the light at the mouth to the bright fissure at the back.
  const sideMaterial = new ShaderMaterial("sanctuaryPortalSideGlow", scene, SIDE_SHADER, {
    attributes: ["position", "uv"],
    uniforms: ["world", "worldViewProjection", "uTime", "uPulse", "uSourceZ", "uMouthZ"],
    needAlphaBlending: true,
  });
  sideMaterial.backFaceCulling = false;
  sideMaterial.disableDepthWrite = true;
  sideMaterial.fogEnabled = false;
  sideMaterial.alphaMode = Constants.ALPHA_ADD;
  sideMaterial.setFloat("uTime", 0);
  sideMaterial.setFloat("uPulse", 0.8);
  sideMaterial.setFloat("uSourceZ", sourceZ);
  sideMaterial.setFloat("uMouthZ", mouthZ);
  const sides: Mesh[] = [];
  for (const direction of [-1, 1]) {
    const side = MeshBuilder.CreatePlane(`sanctuaryPortalSideGlow_${direction}`, {
      width: sourceZ - mouthZ, height: portalHalf.y * 2 + 26,
      sideOrientation: Mesh.FRONTSIDE,
    }, scene);
    side.position.set(portalCenter.x + direction * (portalHalf.x + 0.08),
      portalCenter.y + 6, (sourceZ + mouthZ) * 0.5);
    side.rotation.y = Math.PI * 0.5;
    side.material = sideMaterial;
    side.alphaIndex = 1015;
    side.isPickable = false;
    side.checkCollisions = false;
    sides.push(side);
  }

  // A soft, continuous seam joins the luminous passage to the image plane.
  const contactMaterial = new ShaderMaterial("sanctuaryPortalContactGlow", scene, CONTACT_SHADER, {
    attributes: ["position", "uv"],
    uniforms: ["worldViewProjection", "uTime", "uPulse"],
    needAlphaBlending: true,
  });
  contactMaterial.backFaceCulling = false;
  contactMaterial.disableDepthWrite = true;
  contactMaterial.fogEnabled = false;
  contactMaterial.alphaMode = Constants.ALPHA_ADD;
  contactMaterial.setFloat("uTime", 0);
  contactMaterial.setFloat("uPulse", 0.8);
  const contact = MeshBuilder.CreatePlane("sanctuaryPortalContactRim", {
    width: portalHalf.x * 2, height: portalHalf.y * 2,
    sideOrientation: Mesh.FRONTSIDE,
  }, scene);
  contact.position.set(portalCenter.x, portalCenter.y, sourceZ - 0.08);
  contact.material = contactMaterial;
  contact.alphaIndex = 1018;
  contact.isPickable = false;
  contact.checkCollisions = false;

  // Two shallow, translucent surfaces keep the mist on the stone. The shader
  // widens its footprint and fades it before the first stair tread.
  const layers: FogLayer[] = [];
  for (let i = 0; i < (mobile ? 1 : 2); i++) {
    const material = new ShaderMaterial(`sanctuaryPortalGroundFog_${i}`, scene, FOG_SHADER, {
      attributes: ["position", "uv"],
      uniforms: ["world", "worldViewProjection", "uTime", "uMouthZ", "uReach",
        "uCenterX", "uDensity", "uLayer", "uPulse"],
      needAlphaBlending: true,
    });
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.fogEnabled = false;
    material.alphaMode = Constants.ALPHA_COMBINE;
    material.setFloat("uTime", 0);
    material.setFloat("uMouthZ", mouthZ);
    material.setFloat("uReach", fogReach);
    material.setFloat("uCenterX", portalCenter.x);
    material.setFloat("uDensity", i === 0 ? 0.18 : 0.07);
    material.setFloat("uLayer", i);
    material.setFloat("uPulse", 0.8);
    const mesh = MeshBuilder.CreateGround(`sanctuaryPortalGroundFog_${i}`, {
      width: portalHalf.x * 2.8, height: fogReach + 6, subdivisions: 8,
    }, scene);
    mesh.position.set(portalCenter.x, floorY + 0.10 + i * 0.18,
      mouthZ - fogReach * 0.5 + 2);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = false;
    mesh.alphaIndex = 1030 + i;
    layers.push({ mesh, material });
  }

  let disposed = false;
  return {
    update(time: number) {
      if (disposed) return;
      const pulse = 0.80 + 0.20 * Math.sin(time * 1.7) + 0.09 * Math.sin(time * 2.9);
      for (const light of edgeLights) light.intensity = (mobile ? 3.0 : 4.2) * pulse;
      rimMaterial.setFloat("uTime", time);
      rimMaterial.setFloat("uPulse", pulse);
      const cameraDistance = scene.activeCamera
        ? Vector3.Distance(scene.activeCamera.globalPosition, rim.position) : 0;
      rimMaterial.setFloat("uDistanceBoost", 1 + 1.4
        * Math.min(1, Math.max(0, (cameraDistance - 300) / 1100)));
      floorMaterial.setFloat("uTime", time);
      floorMaterial.setFloat("uPulse", pulse);
      sideMaterial.setFloat("uTime", time);
      sideMaterial.setFloat("uPulse", pulse);
      contactMaterial.setFloat("uTime", time);
      contactMaterial.setFloat("uPulse", pulse);
      for (const { material } of layers) {
        material.setFloat("uTime", time);
        material.setFloat("uPulse", pulse);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { mesh, material } of layers) {
        mesh.dispose();
        material.dispose();
      }
      for (const side of sides) side.dispose();
      sideMaterial.dispose();
      contact.dispose();
      contactMaterial.dispose();
      rim.dispose();
      rimMaterial.dispose();
      floorSpill.dispose();
      floorMaterial.dispose();
      for (const light of edgeLights) light.dispose();
    },
  };
}
