import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Shaders/postprocess.vertex";

const SHADER_NAME = "rinaStrobeMonochrome";

Effect.ShadersStore[`${SHADER_NAME}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float strobeStrength;
void main(void) {
  vec4 source = texture2D(textureSampler, vUV);
  float luminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
  float monochrome = clamp((luminance - 0.5) * 1.08 + 0.5, 0.0, 1.0);
  float flash = min(0.48, strobeStrength * 1.15);
  gl_FragColor = vec4(mix(source.rgb, vec3(monochrome), flash), source.a);
}`;

export function createRinaStrobePostProcess(scene: Scene, camera: Camera) {
  const postProcess = new PostProcess(
    "rinaStrobeMonochrome",
    SHADER_NAME,
    ["strobeStrength"],
    null,
    1,
    null,
    Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    scene.getEngine(),
    false
  );
  let strength = 0;
  postProcess.onApplyObservable.add((effect) => {
    effect.setFloat("strobeStrength", strength);
  });
  camera.attachPostProcess(postProcess);
  return {
    update(strobe: number) {
      strength = Math.max(0, Math.min(1, strobe));
    },
    dispose() {
      camera.detachPostProcess(postProcess);
      postProcess.dispose();
    },
  };
}
