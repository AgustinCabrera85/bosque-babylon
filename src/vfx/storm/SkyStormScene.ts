import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Scene } from "@babylonjs/core/scene";
import { CloudEmitterSystem } from "./CloudEmitterSystem";
import { LightningManager } from "./LightningManager";
import { LightningSpriteEffectV2 } from "./LightningSpriteEffectV2";
import { LightningVariantLibrary } from "./LightningVariantLibrary";
import { StormLightPool } from "./StormLightPool";
import { StormSky } from "./StormSky";

export interface SkyStormLab {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  manager: LightningManager;
  library: LightningVariantLibrary;
  setBloom(enabled: boolean): void;
  setHalo(enabled: boolean): void;
  setMovingSphere(enabled: boolean): void;
  metrics(): { fps: number; drawCalls: number; lights: number; meshes: number };
  dispose(): void;
}

export async function createSkyStormScene(canvas: HTMLCanvasElement): Promise<SkyStormLab> {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.005, 0.006, 0.014, 1);
  const camera = new ArcRotateCamera("stormLabCamera", -Math.PI / 2, 1.23, 25,
    new Vector3(0, 4.5, 0), scene);
  camera.lowerRadiusLimit = 12;
  camera.upperRadiusLimit = 55;
  camera.attachControl(canvas, true);
  scene.activeCamera = camera;

  const ground = MeshBuilder.CreateGround("stormTestGround", { width: 90, height: 90 }, scene);
  const groundMat = new StandardMaterial("stormTestGroundMat", scene);
  groundMat.diffuseColor = new Color3(0.035, 0.04, 0.055);
  groundMat.specularColor = new Color3(0.12, 0.13, 0.18);
  ground.material = groundMat;

  const tower = MeshBuilder.CreateBox("stormTestStructure", { width: 1.3, height: 5.6, depth: 1.3 }, scene);
  tower.position.set(5.7, 2.8, 1.2);
  const towerMat = new StandardMaterial("stormTestStructureMat", scene);
  towerMat.diffuseColor = new Color3(0.11, 0.12, 0.15);
  towerMat.specularColor = new Color3(0.3, 0.31, 0.38);
  tower.material = towerMat;
  const sphere = MeshBuilder.CreateSphere("stormMovingReference", { diameter: 1.7 }, scene);
  sphere.position.set(-4, 1.6, 0);
  const sphereMat = new StandardMaterial("stormSphereMat", scene);
  sphereMat.diffuseColor = new Color3(0.2, 0.2, 0.22);
  sphereMat.specularColor = new Color3(0.46, 0.46, 0.5);
  sphere.material = sphereMat;

  const ambient = new HemisphericLight("stormLabDimAmbient", new Vector3(0, 1, 0), scene);
  ambient.diffuse = new Color3(0.13, 0.16, 0.23);
  ambient.groundColor = new Color3(0.025, 0.025, 0.035);
  ambient.intensity = 0.2;

  const library = new LightningVariantLibrary(scene);
  try {
    const variant = await library.load("LGT_01");
    const clouds = new CloudEmitterSystem(scene);
    const sky = new StormSky(scene);
    const lights = new StormLightPool(scene, [ground, tower, sphere]);
    const effect = new LightningSpriteEffectV2(scene, variant);
    const manager = new LightningManager(effect, clouds, sky, lights, camera);
    const pipeline = new DefaultRenderingPipeline("stormLabPipeline", true, scene, [camera]);
    pipeline.bloomEnabled = false;
    pipeline.fxaaEnabled = true;
    const instrumentation = new SceneInstrumentation(scene);
    let movingSphere = false;
    let elapsed = 0;
    const beforeRender = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.1, engine.getDeltaTime() / 1000);
      elapsed += dt;
      if (movingSphere) sphere.position.x = -4 + Math.sin(elapsed * 0.8) * 4.5;
      manager.update(dt);
    });
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    engine.runRenderLoop(() => scene.render());
    let disposed = false;
    return {
      engine, scene, camera, manager, library,
      setBloom(enabled) { pipeline.bloomEnabled = enabled; },
      setHalo(enabled) { effect.setHaloVisible(enabled); },
      setMovingSphere(enabled) { movingSphere = enabled; },
      metrics() {
        return {
          fps: Math.round(engine.getFps()),
          drawCalls: instrumentation.drawCallsCounter.current,
          lights: scene.lights.length,
          meshes: scene.meshes.length,
        };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        window.removeEventListener("resize", resize);
        engine.stopRenderLoop();
        scene.onBeforeRenderObservable.remove(beforeRender);
        manager.dispose();
        library.dispose();
        instrumentation.dispose();
        pipeline.dispose();
        scene.dispose();
        engine.dispose();
      },
    };
  } catch (error) {
    library.dispose();
    scene.dispose();
    engine.dispose();
    throw error;
  }
}
