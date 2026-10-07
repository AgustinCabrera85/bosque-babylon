import { Scene } from "@babylonjs/core/scene";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Light } from "@babylonjs/core/Lights/light";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";

const STATIC_WIDTH = 256;
const STATIC_HEIGHT = 192;
const STATIC_FRAME_SECONDS = 1 / 18;
const TV_LIGHT_BASE_INTENSITY = 4.1;
const TV_LIGHT_RANGE = 13;

export type HouseTelevisionStaticHandle = {
  light: SpotLight;
  lightPosition: Vector3;
  setActive(active: boolean): void;
};

/**
 * Gives the imported TV screen its own animated material and uses that screen
 * as a broad, cold light source for the house interior.
 */
export function createHouseTelevisionStatic(
  scene: Scene,
  screen: AbstractMesh,
  body: AbstractMesh
): HouseTelevisionStaticHandle {
  screen.computeWorldMatrix(true);
  body.computeWorldMatrix(true);

  const screenCenter = screen.getBoundingInfo().boundingBox.centerWorld.clone();
  const bodyCenter = body.getBoundingInfo().boundingBox.centerWorld.clone();
  const forward = screenCenter.subtract(bodyCenter);
  if (forward.lengthSquared() < 0.0001) {
    forward.set(0, 0, 1);
  } else {
    forward.normalize();
  }

  const texture = new DynamicTexture(
    "endHouseTvStaticTexture",
    { width: STATIC_WIDTH, height: STATIC_HEIGHT },
    scene,
    false,
    Texture.NEAREST_SAMPLINGMODE
  );
  texture.hasAlpha = false;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 1;

  const material = new StandardMaterial("endHouseTvStaticMaterial", scene);
  material.diffuseColor = Color3.Black();
  material.diffuseTexture = texture;
  material.emissiveColor = new Color3(0.86, 0.91, 1.0);
  material.emissiveTexture = texture;
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.backFaceCulling = screen.material?.backFaceCulling ?? true;
  material.maxSimultaneousLights = 0;
  screen.material = material;
  screen.metadata ??= {};
  screen.metadata.isTelevisionStaticScreen = true;

  const lightPosition = screenCenter.add(forward.scale(0.12));
  const light = new SpotLight(
    "endHouseTelevisionLight",
    lightPosition.clone(),
    forward,
    Math.PI * 0.62,
    1.45,
    scene
  );
  light.innerAngle = Math.PI * 0.34;
  light.falloffType = Light.FALLOFF_STANDARD;
  light.diffuse = new Color3(0.5, 0.68, 0.92);
  light.specular = new Color3(0.08, 0.13, 0.2);
  light.intensity = TV_LIGHT_BASE_INTENSITY;
  light.range = TV_LIGHT_RANGE;
  light.renderPriority = 13;
  light.excludedMeshes.push(screen);

  const context = texture.getContext() as CanvasRenderingContext2D;
  const pixels = context.createImageData(STATIC_WIDTH, STATIC_HEIGHT);
  let frame = 0;
  let elapsed = STATIC_FRAME_SECONDS;
  let lightVariation = 1;
  let active = true;

  const renderStaticFrame = () => {
    frame += 1;
    let randomState = (0x6d2b79f5 ^ Math.imul(frame, 0x9e3779b1)) >>> 0;
    const rollingLine = (frame * 7) % STATIC_HEIGHT;
    const softBandCenter = (frame * 3 + 31) % STATIC_HEIGHT;
    let energy = 0;

    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };

    for (let y = 0; y < STATIC_HEIGHT; y += 1) {
      const scanline = y % 2 === 0 ? 0.95 : 1;
      const rollingBoost = Math.abs(y - rollingLine) <= 1 ? 1.1 : 1;
      const bandDistance = Math.min(
        Math.abs(y - softBandCenter),
        STATIC_HEIGHT - Math.abs(y - softBandCenter)
      );
      const bandShade = 0.96 + Math.min(1, bandDistance / 28) * 0.04;

      for (let x = 0; x < STATIC_WIDTH; x += 1) {
        const polarity = random();
        const detail = random();
        const salt = polarity < 0.5 ? 8 + detail * 78 : 158 + detail * 97;
        const sparkle = random() > 0.992 ? 24 : 0;
        const value = Math.max(
          8,
          Math.min(255, (salt + sparkle) * scanline * rollingBoost * bandShade)
        );
        const offset = (y * STATIC_WIDTH + x) * 4;
        pixels.data[offset] = Math.round(value * 0.88);
        pixels.data[offset + 1] = Math.round(value * 0.94);
        pixels.data[offset + 2] = Math.round(value);
        pixels.data[offset + 3] = 255;
        energy += value;
      }
    }

    context.putImageData(pixels, 0, 0);
    texture.update(false);
    const normalizedEnergy = energy / (STATIC_WIDTH * STATIC_HEIGHT * 255);
    lightVariation = 0.94 + normalizedEnergy * 0.12 + (random() - 0.5) * 0.035;
  };

  renderStaticFrame();
  scene.onBeforeRenderObservable.add(() => {
    if (screen.isDisposed()) {
      light.intensity = 0;
      return;
    }
    if (!active) return;

    elapsed += Math.min(0.1, scene.getEngine().getDeltaTime() * 0.001);
    if (elapsed >= STATIC_FRAME_SECONDS) {
      elapsed %= STATIC_FRAME_SECONDS;
      renderStaticFrame();
    }

    const breathing = Math.sin(frame * 0.37) * 0.025;
    light.intensity = TV_LIGHT_BASE_INTENSITY * (lightVariation + breathing);
  });

  return {
    light,
    lightPosition,
    setActive(nextActive) {
      active = nextActive;
      if (!active) light.intensity = 0;
    },
  };
}
