import "@babylonjs/loaders/glTF";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { SkeletonViewer } from "@babylonjs/core/Debug/skeletonViewer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { LAUTARO_VISUAL_SCALE } from "../../game/CharacterPresentation";
import type { ProceduralAnimationDefinition } from "../../game/animation/ProceduralAnimationDefinition";
import {
  ProceduralLayerStack,
  type ProceduralLayerConfig,
} from "../../game/animation/ProceduralLayerStack";
import {
  HERMANO_MAYOR_MODEL_FILE,
  HERMANO_MAYOR_MODEL_ROOT_URL,
  HERMANO_MAYOR_VISUAL_SCALE,
} from "../../game/enemies/boss/HermanoMayor";
import { HERMANO_MAYOR_AXE_PICKUP_ANIMATION } from "../../game/enemies/boss/HermanoMayorAxePickupAction";
import { BonePoseController } from "./BonePoseController";
import { PoseEditor } from "./PoseEditor";

type LabModelDefinition = {
  id: string;
  displayName: string;
  rootUrl: string;
  fileName: string;
  scale: number;
  preferredAnimation: string;
};

type LoadedLabModel = {
  definition: LabModelDefinition;
  root: TransformNode;
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  controller: BonePoseController;
  skeletonViewer: SkeletonViewer | null;
};

const LAB_MODELS: readonly LabModelDefinition[] = [
  {
    id: "hermanoMayor",
    displayName: "Hermano Mayor",
    rootUrl: HERMANO_MAYOR_MODEL_ROOT_URL,
    fileName: HERMANO_MAYOR_MODEL_FILE,
    scale: HERMANO_MAYOR_VISUAL_SCALE,
    preferredAnimation: "Walk_InPlace",
  },
  {
    id: "lautaro",
    displayName: "Lautaro",
    rootUrl: "/assets/models/character/",
    fileName: "Lautaro_Animated.glb",
    scale: LAUTARO_VISUAL_SCALE,
    preferredAnimation: "Walk_InPlace",
  },
];

const PREVIEW_LAYER_ID = "__timeline_preview__";

export class ProceduralAnimationLab {
  public readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly editor: PoseEditor;
  private loadedModel: LoadedLabModel | null = null;
  private animation: AnimationGroup | null = null;
  private layerStack: ProceduralLayerStack | null = null;
  private authoredLayers: ProceduralLayerConfig[] = [];
  private previewDefinition: ProceduralAnimationDefinition | null = null;
  private loop = true;
  private speed = 1;
  private proceduralLoop = false;
  private proceduralSpeed = 1;
  private animationFps = 30;
  private loadGeneration = 0;
  private disposed = false;

  public static async create(engine: Engine, canvas: HTMLCanvasElement) {
    const lab = new ProceduralAnimationLab(engine, canvas);
    await lab.loadModel(LAB_MODELS[0].id);
    return lab;
  }

  private constructor(
    private readonly engine: Engine,
    private readonly canvas: HTMLCanvasElement
  ) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.025, 0.04, 0.033, 1);
    this.scene.ambientColor = new Color3(0.22, 0.25, 0.23);

    this.camera = new ArcRotateCamera(
      "proceduralAnimationLabCamera",
      Math.PI / 2,
      Math.PI / 2.35,
      4,
      new Vector3(0, 1, 0),
      this.scene
    );
    this.camera.minZ = 0.01;
    this.camera.lowerRadiusLimit = 0.4;
    this.camera.upperRadiusLimit = 30;
    this.camera.wheelDeltaPercentage = 0.01;
    this.camera.attachControl(canvas, true);
    this.scene.activeCamera = this.camera;

    const fill = new HemisphericLight(
      "proceduralAnimationLabFill",
      new Vector3(0, 1, 0),
      this.scene
    );
    fill.intensity = 1.25;
    fill.diffuse = new Color3(0.78, 0.86, 0.82);
    fill.groundColor = new Color3(0.12, 0.13, 0.12);

    const key = new DirectionalLight(
      "proceduralAnimationLabKey",
      new Vector3(-0.45, -0.8, -0.35),
      this.scene
    );
    key.position.set(4, 7, 4);
    key.intensity = 1.1;
    key.diffuse = new Color3(1, 0.9, 0.76);

    const ground = MeshBuilder.CreateGround(
      "proceduralAnimationLabGround",
      { width: 12, height: 12 },
      this.scene
    );
    const groundMaterial = new StandardMaterial(
      "proceduralAnimationLabGroundMaterial",
      this.scene
    );
    groundMaterial.diffuseColor = new Color3(0.075, 0.105, 0.09);
    groundMaterial.specularColor.setAll(0.04);
    ground.material = groundMaterial;
    ground.isPickable = false;

    this.editor = new PoseEditor(this.scene, {
      loadModel: (id) => this.loadModel(id),
      selectAnimation: (name) => this.selectAnimation(name),
      play: () => this.play(),
      pause: () => this.pause(),
      stop: () => this.stop(),
      setLoop: (loop) => this.setLoop(loop),
      setSpeed: (speed) => this.setSpeed(speed),
      scrub: (frame) => this.scrub(frame),
      getSource: () => this.getAuthoringSource(),
      showSkeleton: (show) => this.showSkeleton(show),
      playProcedural: (definition) => this.playProcedural(definition),
      pauseProcedural: () => this.pauseProcedural(),
      resumeProcedural: () => this.resumeProcedural(),
      stopProcedural: () => this.stopProcedural(),
      seekProcedural: (time) => this.seekProcedural(time),
      setProceduralLoop: (loop) => this.setProceduralLoop(loop),
      setProceduralSpeed: (speed) => this.setProceduralSpeed(speed),
      refreshProcedural: () => this.layerStack?.refresh(),
      setProceduralLayers: (layers) => this.setProceduralLayers(layers),
    });
    this.editor.setModels(
      LAB_MODELS.map(({ id, displayName }) => ({ id, displayName })),
      LAB_MODELS[0].id
    );

    this.scene.onDisposeObservable.addOnce(() => this.disposeResources());
  }

  public async loadModel(id: string) {
    const definition = LAB_MODELS.find((candidate) => candidate.id === id);
    if (!definition) throw new Error(`Unknown lab model '${id}'.`);
    const generation = ++this.loadGeneration;
    this.editor.setModelLoading(true);

    let importedRoot: TransformNode | null = null;
    try {
      const result = await SceneLoader.ImportMeshAsync(
        null,
        definition.rootUrl,
        definition.fileName,
        this.scene
      );
      if (generation !== this.loadGeneration || this.disposed) {
        for (const group of result.animationGroups) group.dispose();
        for (const mesh of result.meshes) mesh.dispose(false, true);
        return;
      }

      importedRoot = new TransformNode(`poseLab_${definition.id}_root`, this.scene);
      for (const node of [...result.meshes, ...result.transformNodes]) {
        if (!node.parent) node.parent = importedRoot;
      }
      importedRoot.scaling.setAll(definition.scale);

      const meshes = result.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
      for (const mesh of meshes) {
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        mesh.alwaysSelectAsActiveMesh = true;
      }
      for (const group of result.animationGroups) group.stop();

      const skeletonMesh = [...meshes]
        .filter((mesh) => mesh.skeleton)
        .sort(
          (left, right) =>
            (right.skeleton?.bones.length ?? 0) -
            (left.skeleton?.bones.length ?? 0)
        )[0];
      const skeleton = skeletonMesh?.skeleton;
      if (!skeletonMesh || !skeleton) {
        throw new Error(`${definition.displayName} has no authorable skeleton.`);
      }

      groundAndFrameModel(importedRoot, meshes, this.camera);
      const controller = new BonePoseController(
        this.scene,
        skeleton,
        skeletonMesh,
        importedRoot
      );
      const nextModel: LoadedLabModel = {
        definition,
        root: importedRoot,
        meshes,
        animationGroups: result.animationGroups,
        controller,
        skeletonViewer: null,
      };
      importedRoot = null;

      this.disposeLoadedModel();
      this.loadedModel = nextModel;
      this.layerStack = new ProceduralLayerStack(controller);
      this.editor.bindController(controller);
      if (definition.id === "hermanoMayor") {
        this.editor.loadProceduralDefinition(
          HERMANO_MAYOR_AXE_PICKUP_ANIMATION
        );
      }
      this.syncLayerStack();
      this.editor.setModels(
        LAB_MODELS.map(({ id: modelId, displayName }) => ({
          id: modelId,
          displayName,
        })),
        definition.id
      );

      const animationNames = result.animationGroups.map((group) => group.name);
      const preferred = result.animationGroups.find(
        (group) => group.name === definition.preferredAnimation
      )?.name ?? result.animationGroups[0]?.name ?? null;
      this.editor.setAnimations(animationNames, preferred);
      if (preferred) this.selectAnimation(preferred);
      else this.animation = null;
      this.editor.setStatus(
        `Loaded ${definition.displayName}: ${controller.getBones().length} bones.`
      );
    } catch (error) {
      importedRoot?.dispose(false, true);
      throw error;
    } finally {
      if (generation === this.loadGeneration) this.editor.setModelLoading(false);
    }
  }

  public selectAnimation(name: string) {
    const model = this.loadedModel;
    if (!model) return;
    const next = model.animationGroups.find((group) => group.name === name);
    if (!next) return;
    for (const group of model.animationGroups) group.stop();
    this.animation = next;
    this.animationFps =
      next.targetedAnimations[0]?.animation.framePerSecond || 30;
    next.start(this.loop, this.speed, next.from, next.to);
    next.pause();
    next.goToFrame(next.from);
    this.editor.setPlaybackRange(next.from, next.to, this.animationFps);
    this.editor.updatePlayback(next.from, false);
  }

  public play() {
    const animation = this.animation;
    if (!animation) return;
    if (!animation.isStarted) {
      animation.start(
        this.loop,
        this.speed,
        animation.from,
        animation.to
      );
    } else {
      animation.play(this.loop);
    }
    animation.speedRatio = this.speed;
  }

  public pause() {
    this.animation?.pause();
  }

  public stop() {
    const animation = this.animation;
    if (!animation) return;
    animation.stop();
    animation.start(
      this.loop,
      this.speed,
      animation.from,
      animation.to
    );
    animation.pause();
    animation.goToFrame(animation.from);
  }

  public setLoop(loop: boolean) {
    this.loop = loop;
    if (this.animation) this.animation.loopAnimation = loop;
  }

  public setSpeed(speed: number) {
    this.speed = Math.max(0.01, speed);
    if (this.animation) this.animation.speedRatio = this.speed;
  }

  public scrub(frame: number) {
    const animation = this.animation;
    if (!animation) return;
    if (!animation.isStarted) {
      animation.start(
        this.loop,
        this.speed,
        animation.from,
        animation.to
      );
    }
    animation.pause();
    animation.goToFrame(
      Math.max(animation.from, Math.min(animation.to, frame))
    );
  }

  public showSkeleton(show: boolean) {
    const model = this.loadedModel;
    if (!model) return;
    if (!model.skeletonViewer && show) {
      model.skeletonViewer = new SkeletonViewer(
        model.controller.skeleton,
        model.controller.mesh,
        this.scene,
        true,
        2,
        { displayMode: SkeletonViewer.DISPLAY_LINES }
      );
      model.skeletonViewer.color = new Color3(0.35, 1, 0.67);
    }
    if (model.skeletonViewer) model.skeletonViewer.isEnabled = show;
  }

  public playProcedural(definition: ProceduralAnimationDefinition) {
    this.previewDefinition = definition;
    this.syncLayerStack();
    const layer = this.layerStack?.getLayer(PREVIEW_LAYER_ID);
    const player = layer?.getAnimationPlayer();
    player?.setLoop(this.proceduralLoop);
    player?.setSpeedRatio(this.proceduralSpeed);
    layer?.playAnimation();
  }

  public pauseProcedural() {
    this.getProceduralPlayer()?.pause();
  }

  public resumeProcedural() {
    this.getProceduralPlayer()?.resume();
  }

  public stopProcedural() {
    this.layerStack?.getLayer(PREVIEW_LAYER_ID)?.stop();
    this.layerStack?.refresh();
  }

  public seekProcedural(time: number) {
    this.getProceduralPlayer()?.seek(time);
    this.layerStack?.refresh();
  }

  public setProceduralLoop(loop: boolean) {
    this.proceduralLoop = loop;
    this.getProceduralPlayer()?.setLoop(loop);
  }

  public setProceduralSpeed(speed: number) {
    this.proceduralSpeed = Math.max(0.01, speed);
    this.getProceduralPlayer()?.setSpeedRatio(this.proceduralSpeed);
  }

  public setProceduralLayers(layers: readonly ProceduralLayerConfig[]) {
    this.authoredLayers = [...layers];
    this.syncLayerStack();
  }

  public render() {
    if (this.disposed) return;
    this.layerStack?.update(this.engine.getDeltaTime() / 1000);
    this.scene.render();
    const animation = this.animation;
    if (animation) {
      this.editor.updatePlayback(
        animation.getCurrentFrame(),
        animation.isPlaying
      );
    }
    const proceduralState = this.getProceduralPlayer()?.getState();
    if (proceduralState) {
      this.editor.updateProceduralPlayback(proceduralState);
    }
  }

  public getPoseController() {
    return this.loadedModel?.controller ?? null;
  }

  public getActiveAnimation() {
    return this.animation;
  }

  public getActiveModelId() {
    return this.loadedModel?.definition.id ?? null;
  }

  public getProceduralPlayer() {
    return this.layerStack
      ?.getLayer(PREVIEW_LAYER_ID)
      ?.getAnimationPlayer() ?? null;
  }

  public getLayerStack() {
    return this.layerStack;
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.stopRenderLoop();
    this.scene.dispose();
  }

  private getAuthoringSource() {
    const animation = this.animation;
    const frame = animation?.getCurrentFrame() ?? 0;
    return {
      model: this.loadedModel?.definition.id,
      animation: animation?.name,
      time: animation
        ? Math.round(
            (Math.max(0, frame - animation.from) / this.animationFps) *
              1_000_000
          ) / 1_000_000
        : undefined,
    };
  }

  private disposeLoadedModel() {
    const model = this.loadedModel;
    if (!model) return;
    this.animation = null;
    this.layerStack?.clear();
    this.layerStack = null;
    this.previewDefinition = null;
    this.editor.bindController(null);
    model.skeletonViewer?.dispose();
    model.controller.dispose();
    for (const group of model.animationGroups) group.dispose();
    model.root.dispose(false, true);
    this.loadedModel = null;
  }

  private syncLayerStack() {
    const stack = this.layerStack;
    if (!stack) return;
    const layers: ProceduralLayerConfig[] = [];
    if (this.previewDefinition) {
      layers.push({
        id: PREVIEW_LAYER_ID,
        enabled: true,
        weight: 1,
        source: {
          type: "animation",
          id: this.previewDefinition.id,
          definition: this.previewDefinition,
        },
        animationLoop: this.proceduralLoop,
        animationSpeedRatio: this.proceduralSpeed,
      });
    }
    layers.push(...this.authoredLayers);
    stack.setLayers(layers);
  }

  private disposeResources() {
    if (!this.disposed) this.disposed = true;
    this.disposeLoadedModel();
    this.editor.dispose();
    this.camera.detachControl();
  }
}

function groundAndFrameModel(
  root: TransformNode,
  meshes: readonly AbstractMesh[],
  camera: ArcRotateCamera
) {
  root.computeWorldMatrix(true);
  for (const mesh of meshes) mesh.computeWorldMatrix(true);
  let bounds = getBounds(meshes);
  if (!bounds) return;

  root.position.y -= bounds.minimum.y;
  root.computeWorldMatrix(true);
  for (const mesh of meshes) mesh.computeWorldMatrix(true);
  bounds = getBounds(meshes);
  if (!bounds) return;

  const size = bounds.maximum.subtract(bounds.minimum);
  const center = bounds.minimum.add(size.scale(0.5));
  camera.setTarget(new Vector3(center.x, bounds.minimum.y + size.y * 0.52, center.z));
  camera.radius = Math.max(1.8, size.y * 1.15, Math.max(size.x, size.z) * 1.8);
  camera.lowerRadiusLimit = Math.max(0.25, camera.radius * 0.18);
  camera.upperRadiusLimit = Math.max(12, camera.radius * 5);
}

function getBounds(meshes: readonly AbstractMesh[]) {
  if (meshes.length === 0) return null;
  const minimum = new Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY
  );
  const maximum = new Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  );
  let found = false;
  for (const mesh of meshes) {
    const box = mesh.getBoundingInfo().boundingBox;
    minimum.minimizeInPlace(box.minimumWorld);
    maximum.maximizeInPlace(box.maximumWorld);
    found = true;
  }
  return found ? { minimum, maximum } : null;
}
