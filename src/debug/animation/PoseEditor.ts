import { GizmoCoordinatesMode } from "@babylonjs/core/Gizmos/gizmo";
import { GizmoManager } from "@babylonjs/core/Gizmos/gizmoManager";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import {
  PROCEDURAL_NEUTRAL_POSE_ID,
  type ProceduralAnimationDefinition,
  type ProceduralAnimationEasing,
  type ProceduralAnimationKey,
} from "../../game/animation/ProceduralAnimationDefinition";
import type { ProceduralAnimationPlaybackState } from "../../game/animation/ProceduralAnimationPlayer";
import {
  resolveMixamoBoneMaskPresets,
  type ProceduralBoneMask,
} from "../../game/animation/ProceduralBoneMask";
import type {
  ProceduralLayerConfig,
  ProceduralLayerSource,
} from "../../game/animation/ProceduralLayerStack";
import type { ProceduralPose } from "../../game/animation/ProceduralPose";
import {
  type AuthoringSource,
  type BonePoseController,
  serializeQuaternion,
} from "./BonePoseController";

export type PoseEditorModelOption = {
  id: string;
  displayName: string;
};

export type PoseEditorActions = {
  loadModel(id: string): Promise<void>;
  selectAnimation(name: string): void;
  play(): void;
  pause(): void;
  stop(): void;
  setLoop(loop: boolean): void;
  setSpeed(speed: number): void;
  scrub(frame: number): void;
  getSource(): AuthoringSource;
  showSkeleton(show: boolean): void;
  playProcedural(definition: ProceduralAnimationDefinition): void;
  pauseProcedural(): void;
  resumeProcedural(): void;
  stopProcedural(): void;
  seekProcedural(time: number): void;
  setProceduralLoop(loop: boolean): void;
  setProceduralSpeed(speed: number): void;
  refreshProcedural(): void;
  setProceduralLayers(layers: readonly ProceduralLayerConfig[]): void;
};

type EditableProceduralKey = ProceduralAnimationKey & { uid: number };

type EditableProceduralLayer = {
  uid: number;
  id: string;
  enabled: boolean;
  weight: number;
  sourceType: ProceduralLayerSource["type"];
  sourceId: string;
  maskId: string;
  customBones: Set<string>;
};

const NO_MASK_ID = "none";
const CUSTOM_MASK_ID = "custom";
const SAVED_MASK_PREFIX = "saved:";

export class PoseEditor {
  private readonly host = document.createElement("div");
  private readonly shadow: ShadowRoot;
  private readonly gizmoManager: GizmoManager;
  private readonly gizmoHandle: TransformNode;
  private readonly savedPoses = new Map<string, ProceduralPose>();
  private readonly proceduralAnimations = new Map<
    string,
    ProceduralAnimationDefinition
  >();
  private readonly presetMasks = new Map<string, ProceduralBoneMask>();
  private readonly savedMasks = new Map<string, ProceduralBoneMask>();
  private readonly proceduralLayers: EditableProceduralLayer[] = [];
  private readonly proceduralKeys: EditableProceduralKey[] = [
    {
      uid: 1,
      time: 0,
      poseId: PROCEDURAL_NEUTRAL_POSE_ID,
      easing: "linear",
    },
  ];
  private controller: BonePoseController | null = null;
  private selectedBone: string | null = null;
  private dragStartHandleRotation = Quaternion.Identity();
  private dragStartOffset = Quaternion.Identity();
  private dragging = false;
  private lastSavedPose: ProceduralPose | null = null;
  private animationFps = 30;
  private nextProceduralKeyUid = 2;
  private nextProceduralLayerUid = 1;
  private selectedLayerUid: number | null = null;
  private proceduralPaused = false;
  private disposed = false;

  private readonly modelSelect: HTMLSelectElement;
  private readonly animationSelect: HTMLSelectElement;
  private readonly playButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly loopInput: HTMLInputElement;
  private readonly speedInput: HTMLInputElement;
  private readonly speedOutput: HTMLOutputElement;
  private readonly timelineInput: HTMLInputElement;
  private readonly timelineOutput: HTMLOutputElement;
  private readonly boneFilter: HTMLInputElement;
  private readonly boneList: HTMLElement;
  private readonly selectedBoneName: HTMLElement;
  private readonly selectedBoneParent: HTMLElement;
  private readonly quaternionOutput: HTMLElement;
  private readonly eulerOutput: HTMLElement;
  private readonly referenceDifferenceOutput: HTMLElement;
  private readonly poseNameInput: HTMLInputElement;
  private readonly referenceStatus: HTMLElement;
  private readonly skeletonInput: HTMLInputElement;
  private readonly poseLibrary: HTMLElement;
  private readonly proceduralAnimationName: HTMLInputElement;
  private readonly proceduralKeyList: HTMLElement;
  private readonly proceduralPauseButton: HTMLButtonElement;
  private readonly proceduralLoopInput: HTMLInputElement;
  private readonly proceduralSpeedInput: HTMLInputElement;
  private readonly proceduralSpeedOutput: HTMLOutputElement;
  private readonly proceduralTimelineInput: HTMLInputElement;
  private readonly proceduralTimelineOutput: HTMLOutputElement;
  private readonly proceduralDiagnostics: HTMLElement;
  private readonly proceduralLayerList: HTMLElement;
  private readonly maskNameInput: HTMLInputElement;
  private readonly maskBoneList: HTMLElement;
  private readonly status: HTMLElement;

  public constructor(
    scene: Scene,
    private readonly actions: PoseEditorActions
  ) {
    this.host.dataset.proceduralAnimationLab = "editor";
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = createEditorMarkup();
    document.body.append(this.host);

    this.modelSelect = this.requireElement("#poseLabModel", HTMLSelectElement);
    this.animationSelect = this.requireElement(
      "#poseLabAnimation",
      HTMLSelectElement
    );
    this.playButton = this.requireElement("#poseLabPlay", HTMLButtonElement);
    this.pauseButton = this.requireElement("#poseLabPause", HTMLButtonElement);
    this.stopButton = this.requireElement("#poseLabStop", HTMLButtonElement);
    this.loopInput = this.requireElement("#poseLabLoop", HTMLInputElement);
    this.speedInput = this.requireElement("#poseLabSpeed", HTMLInputElement);
    this.speedOutput = this.requireElement("#poseLabSpeedValue", HTMLOutputElement);
    this.timelineInput = this.requireElement("#poseLabTimeline", HTMLInputElement);
    this.timelineOutput = this.requireElement(
      "#poseLabTimelineValue",
      HTMLOutputElement
    );
    this.boneFilter = this.requireElement("#poseLabBoneFilter", HTMLInputElement);
    this.boneList = this.requireElement("#poseLabBoneList", HTMLElement);
    this.selectedBoneName = this.requireElement("#poseLabSelectedBone", HTMLElement);
    this.selectedBoneParent = this.requireElement(
      "#poseLabSelectedParent",
      HTMLElement
    );
    this.quaternionOutput = this.requireElement(
      "#poseLabQuaternion",
      HTMLElement
    );
    this.eulerOutput = this.requireElement("#poseLabEuler", HTMLElement);
    this.referenceDifferenceOutput = this.requireElement(
      "#poseLabReferenceDifference",
      HTMLElement
    );
    this.poseNameInput = this.requireElement("#poseLabPoseName", HTMLInputElement);
    this.referenceStatus = this.requireElement(
      "#poseLabReferenceStatus",
      HTMLElement
    );
    this.skeletonInput = this.requireElement(
      "#poseLabShowSkeleton",
      HTMLInputElement
    );
    this.poseLibrary = this.requireElement("#poseLabPoseLibrary", HTMLElement);
    this.proceduralAnimationName = this.requireElement(
      "#poseLabProceduralName",
      HTMLInputElement
    );
    this.proceduralKeyList = this.requireElement(
      "#poseLabProceduralKeys",
      HTMLElement
    );
    this.proceduralPauseButton = this.requireElement(
      "#poseLabProceduralPause",
      HTMLButtonElement
    );
    this.proceduralLoopInput = this.requireElement(
      "#poseLabProceduralLoop",
      HTMLInputElement
    );
    this.proceduralSpeedInput = this.requireElement(
      "#poseLabProceduralSpeed",
      HTMLInputElement
    );
    this.proceduralSpeedOutput = this.requireElement(
      "#poseLabProceduralSpeedValue",
      HTMLOutputElement
    );
    this.proceduralTimelineInput = this.requireElement(
      "#poseLabProceduralTimeline",
      HTMLInputElement
    );
    this.proceduralTimelineOutput = this.requireElement(
      "#poseLabProceduralTimelineValue",
      HTMLOutputElement
    );
    this.proceduralDiagnostics = this.requireElement(
      "#poseLabProceduralDiagnostics",
      HTMLElement
    );
    this.proceduralLayerList = this.requireElement(
      "#poseLabProceduralLayers",
      HTMLElement
    );
    this.maskNameInput = this.requireElement(
      "#poseLabMaskName",
      HTMLInputElement
    );
    this.maskBoneList = this.requireElement(
      "#poseLabMaskBones",
      HTMLElement
    );
    this.status = this.requireElement("#poseLabStatus", HTMLElement);

    this.gizmoHandle = new TransformNode("poseOffsetGizmoHandle", scene);
    this.gizmoHandle.rotationQuaternion = Quaternion.Identity();
    this.gizmoHandle.setEnabled(false);
    this.gizmoManager = new GizmoManager(scene);
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = false;
    this.gizmoManager.rotationGizmoEnabled = true;
    this.gizmoManager.coordinatesMode = GizmoCoordinatesMode.Local;
    this.gizmoManager.scaleRatio = 0.85;
    this.gizmoManager.attachToNode(null);

    const rotationGizmo = this.gizmoManager.gizmos.rotationGizmo;
    rotationGizmo?.onDragStartObservable.add(() => this.beginGizmoDrag());
    rotationGizmo?.onDragObservable.add(() => this.updateGizmoDrag());
    rotationGizmo?.onDragEndObservable.add(() => this.endGizmoDrag());

    this.bindEvents();
    this.renderPoseLibrary();
    this.renderProceduralKeys();
    this.renderProceduralLayers();
    this.renderMaskEditor();
  }

  public setModels(models: readonly PoseEditorModelOption[], selectedId: string) {
    replaceOptions(
      this.modelSelect,
      models.map((model) => ({ value: model.id, label: model.displayName }))
    );
    this.modelSelect.value = selectedId;
  }

  public setModelLoading(loading: boolean) {
    this.modelSelect.disabled = loading;
    this.animationSelect.disabled = loading;
    this.playButton.disabled = loading;
    this.pauseButton.disabled = loading;
    this.stopButton.disabled = loading;
    if (loading) this.setStatus("Loading model...");
  }

  public setAnimations(names: readonly string[], selectedName: string | null) {
    replaceOptions(
      this.animationSelect,
      names.map((name) => ({ value: name, label: name }))
    );
    if (selectedName) this.animationSelect.value = selectedName;
    this.animationSelect.disabled = names.length === 0;
  }

  public setPlaybackRange(from: number, to: number, fps: number) {
    this.animationFps = fps > 0 ? fps : 30;
    this.timelineInput.min = String(from);
    this.timelineInput.max = String(to);
    this.timelineInput.step = "0.01";
    this.timelineInput.value = String(from);
    this.updateTimelineOutput(from);
  }

  public updatePlayback(frame: number, playing: boolean) {
    if (!this.timelineInput.matches(":active")) {
      this.timelineInput.value = String(frame);
    }
    this.updateTimelineOutput(frame);
    this.playButton.dataset.active = String(playing);
    this.pauseButton.dataset.active = String(!playing);
  }

  public updateProceduralPlayback(
    state: Readonly<ProceduralAnimationPlaybackState>
  ) {
    this.proceduralPaused = state.paused;
    this.proceduralPauseButton.textContent = state.paused ? "Resume" : "Pause";
    this.proceduralPauseButton.dataset.active = String(state.paused);
    if (!this.proceduralTimelineInput.matches(":active")) {
      this.proceduralTimelineInput.value = String(state.time);
    }
    this.proceduralTimelineOutput.value = `${state.time.toFixed(3)}s / ${state.duration.toFixed(3)}s`;
    this.proceduralDiagnostics.replaceChildren(
      diagnosticLine("Current", state.animationId ?? "none"),
      diagnosticLine("Time", state.time.toFixed(3)),
      diagnosticLine("From", state.previousPoseId),
      diagnosticLine("To", state.nextPoseId),
      diagnosticLine("Blend", state.blend.toFixed(3))
    );
  }

  public bindController(controller: BonePoseController | null) {
    if (this.controller) {
      this.controller.onPoseApplied = null;
      this.controller.onOffsetsChanged = null;
    }
    this.controller = controller;
    this.selectedBone = null;
    this.skeletonInput.checked = false;
    this.gizmoManager.attachToNode(null);
    this.gizmoHandle.setEnabled(false);
    this.presetMasks.clear();
    if (controller) {
      for (const mask of resolveMixamoBoneMaskPresets(controller.getBones())) {
        this.presetMasks.set(mask.id, mask);
      }
    }
    this.renderProceduralLayers();
    this.renderMaskEditor();
    this.renderBoneList();
    if (!controller) {
      this.syncProceduralLayers();
      this.updateSelectedBoneReadout();
      return;
    }
    controller.onPoseApplied = () => this.onPoseApplied();
    controller.onOffsetsChanged = () => {
      this.renderBoneList();
      this.updateSelectedBoneReadout();
    };
    const initialBone =
      controller.getBones().find((bone) => bone.alias === "Left Arm")?.name ??
      controller.getBones()[0]?.name ??
      null;
    if (initialBone) this.selectBone(initialBone);
    this.syncProceduralLayers();
  }

  public setStatus(message: string, error = false) {
    this.status.textContent = message;
    this.status.dataset.error = String(error);
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.bindController(null);
    this.gizmoManager.dispose();
    this.gizmoHandle.dispose();
    this.host.remove();
  }

  private bindEvents() {
    this.modelSelect.addEventListener("change", () => {
      void this.actions
        .loadModel(this.modelSelect.value)
        .catch((error) => this.reportError(error));
    });
    this.animationSelect.addEventListener("change", () => {
      this.actions.selectAnimation(this.animationSelect.value);
    });
    this.playButton.addEventListener("click", () => this.actions.play());
    this.pauseButton.addEventListener("click", () => this.actions.pause());
    this.stopButton.addEventListener("click", () => this.actions.stop());
    this.loopInput.addEventListener("change", () => {
      this.actions.setLoop(this.loopInput.checked);
    });
    this.speedInput.addEventListener("input", () => {
      const speed = Number(this.speedInput.value);
      this.speedOutput.value = `${speed.toFixed(2)}x`;
      this.actions.setSpeed(speed);
    });
    this.timelineInput.addEventListener("input", () => {
      const frame = Number(this.timelineInput.value);
      this.actions.scrub(frame);
      this.updateTimelineOutput(frame);
    });
    this.boneFilter.addEventListener("input", () => this.renderBoneList());
    this.requireElement("#poseLabResetBone", HTMLButtonElement).addEventListener(
      "click",
      () => {
        if (this.selectedBone) this.controller?.resetBone(this.selectedBone);
      }
    );
    this.requireElement("#poseLabResetAll", HTMLButtonElement).addEventListener(
      "click",
      () => this.controller?.resetAll()
    );
    this.requireElement("#poseLabSave", HTMLButtonElement).addEventListener(
      "click",
      () => this.savePose()
    );
    this.requireElement("#poseLabCopy", HTMLButtonElement).addEventListener(
      "click",
      () => void this.copyLastPose()
    );
    this.requireElement("#poseLabCopyAll", HTMLButtonElement).addEventListener(
      "click",
      () => void this.copyAllPoses()
    );
    this.requireElement(
      "#poseLabCaptureReference",
      HTMLButtonElement
    ).addEventListener("click", () => {
      this.controller?.captureReference(this.actions.getSource());
      this.referenceStatus.textContent = "Reference captured";
      this.updateSelectedBoneReadout();
    });
    this.requireElement(
      "#poseLabClearReference",
      HTMLButtonElement
    ).addEventListener("click", () => {
      this.controller?.clearReference();
      this.referenceStatus.textContent = "No reference";
      this.updateSelectedBoneReadout();
    });
    this.skeletonInput.addEventListener("change", () => {
      this.actions.showSkeleton(this.skeletonInput.checked);
    });
    this.requireElement(
      "#poseLabProceduralAddKey",
      HTMLButtonElement
    ).addEventListener("click", () => {
      const previous = this.proceduralKeys.at(-1);
      this.proceduralKeys.push({
        uid: this.nextProceduralKeyUid++,
        time: (previous?.time ?? -0.3) + 0.3,
        poseId: this.lastSavedPose?.id ?? PROCEDURAL_NEUTRAL_POSE_ID,
        easing: "smooth",
      });
      this.renderProceduralKeys();
    });
    this.proceduralAnimationName.addEventListener("change", () => {
      this.createProceduralDefinition();
      this.renderProceduralLayers();
      this.syncProceduralLayers();
    });
    this.requireElement(
      "#poseLabProceduralPlay",
      HTMLButtonElement
    ).addEventListener("click", () => {
      try {
        const definition = this.createProceduralDefinition();
        this.renderProceduralLayers();
        this.syncProceduralLayers();
        this.actions.playProcedural(definition);
      } catch (error) {
        this.reportError(error);
      }
    });
    this.proceduralPauseButton.addEventListener("click", () => {
      if (this.proceduralPaused) this.actions.resumeProcedural();
      else this.actions.pauseProcedural();
    });
    this.requireElement(
      "#poseLabProceduralStop",
      HTMLButtonElement
    ).addEventListener("click", () => this.actions.stopProcedural());
    this.proceduralLoopInput.addEventListener("change", () => {
      this.actions.setProceduralLoop(this.proceduralLoopInput.checked);
    });
    this.proceduralSpeedInput.addEventListener("input", () => {
      const speed = Number(this.proceduralSpeedInput.value);
      this.proceduralSpeedOutput.value = `${speed.toFixed(2)}x`;
      this.actions.setProceduralSpeed(speed);
    });
    this.proceduralTimelineInput.addEventListener("input", () => {
      this.actions.seekProcedural(Number(this.proceduralTimelineInput.value));
    });
    this.requireElement(
      "#poseLabCopyProcedural",
      HTMLButtonElement
    ).addEventListener("click", () => void this.copyProceduralAnimation(false));
    this.requireElement(
      "#poseLabCopyProceduralWithPoses",
      HTMLButtonElement
    ).addEventListener("click", () => void this.copyProceduralAnimation(true));
    this.requireElement(
      "#poseLabAddLayer",
      HTMLButtonElement
    ).addEventListener("click", () => this.addProceduralLayer());
    this.requireElement(
      "#poseLabSaveMask",
      HTMLButtonElement
    ).addEventListener("click", () => this.saveSelectedMask());
    this.requireElement(
      "#poseLabCopyMask",
      HTMLButtonElement
    ).addEventListener("click", () => void this.copySelectedMask());
    this.requireElement(
      "#poseLabCopyLayerSetup",
      HTMLButtonElement
    ).addEventListener("click", () => void this.copyLayerSetup());
    this.requireElement(
      "#poseLabClearLayers",
      HTMLButtonElement
    ).addEventListener("click", () => {
      this.proceduralLayers.length = 0;
      this.selectedLayerUid = null;
      this.actions.stopProcedural();
      this.syncProceduralLayers();
      this.renderProceduralLayers();
      this.renderMaskEditor();
      this.renderBoneList();
      this.setStatus("Cleared all procedural layers and offsets.");
    });
  }

  private renderBoneList() {
    this.boneList.replaceChildren();
    const controller = this.controller;
    if (!controller) return;
    const editedBones = new Set(controller.getEditedBoneNames());
    const selectedLayer = this.getSelectedLayer();
    const selectedMask = selectedLayer
      ? this.resolveLayerMask(selectedLayer)
      : undefined;
    const maskBones = selectedMask ? new Set(selectedMask.bones) : null;
    const sourceBones = selectedLayer
      ? this.getLayerSourceBones(selectedLayer)
      : new Set<string>();
    const filter = this.boneFilter.value.trim().toLowerCase();
    for (const bone of controller.getBones()) {
      const searchable = `${bone.name} ${bone.alias ?? ""} ${bone.parentName ?? ""}`.toLowerCase();
      if (filter && !searchable.includes(filter)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bone-entry";
      button.dataset.selected = String(bone.name === this.selectedBone);
      button.dataset.edited = String(editedBones.has(bone.name));
      button.dataset.masked = String(
        Boolean(selectedLayer && (!maskBones || maskBones.has(bone.name)))
      );
      button.dataset.source = String(sourceBones.has(bone.name));
      const name = document.createElement("span");
      const markers = selectedLayer
        ? `${!maskBones || maskBones.has(bone.name) ? "[M]" : "   "}${sourceBones.has(bone.name) ? "[P]" : "   "} `
        : "";
      name.textContent = markers +
        (bone.alias ? `${bone.alias} · ${bone.name}` : bone.name);
      const parent = document.createElement("small");
      parent.textContent = `parent: ${bone.parentName ?? "none"}`;
      button.append(name, parent);
      button.addEventListener("click", () => this.selectBone(bone.name));
      this.boneList.append(button);
    }
  }

  private selectBone(name: string) {
    const node = this.controller?.getBoneTransformNode(name);
    if (!node) return;
    this.selectedBone = name;
    this.gizmoHandle.parent = node.parent;
    this.gizmoHandle.position.copyFrom(node.position);
    this.gizmoHandle.scaling.setAll(1);
    this.gizmoHandle.rotationQuaternion!.copyFrom(
      node.rotationQuaternion ?? Quaternion.Identity()
    );
    this.gizmoHandle.setEnabled(true);
    this.gizmoManager.attachToNode(this.gizmoHandle);
    this.renderBoneList();
    this.updateSelectedBoneReadout();
  }

  private onPoseApplied() {
    this.syncGizmoHandle();
    this.updateSelectedBoneReadout();
  }

  private syncGizmoHandle() {
    if (this.dragging || !this.selectedBone || !this.controller) return;
    const node = this.controller.getBoneTransformNode(this.selectedBone);
    if (!node?.rotationQuaternion) return;
    this.gizmoHandle.parent = node.parent;
    this.gizmoHandle.position.copyFrom(node.position);
    this.gizmoHandle.rotationQuaternion!.copyFrom(node.rotationQuaternion);
  }

  private beginGizmoDrag() {
    if (!this.selectedBone || !this.controller) return;
    this.dragging = true;
    this.dragStartHandleRotation.copyFrom(
      this.gizmoHandle.rotationQuaternion ?? Quaternion.Identity()
    );
    this.dragStartOffset.copyFrom(
      this.controller.getRotationOffset(this.selectedBone)
    );
  }

  private updateGizmoDrag() {
    if (!this.dragging || !this.selectedBone || !this.controller) return;
    const handleRotation = this.gizmoHandle.rotationQuaternion;
    if (!handleRotation) return;
    const dragDelta = this.dragStartHandleRotation
      .conjugate()
      .multiply(handleRotation)
      .normalize();
    const offset = this.dragStartOffset.multiply(dragDelta).normalize();
    this.controller.setRotationOffset(this.selectedBone, offset);
  }

  private endGizmoDrag() {
    this.dragging = false;
    this.syncGizmoHandle();
  }

  private updateSelectedBoneReadout() {
    const controller = this.controller;
    const name = this.selectedBone;
    if (!controller || !name) {
      this.selectedBoneName.textContent = "No bone selected";
      this.selectedBoneParent.textContent = "";
      this.quaternionOutput.textContent = "[0, 0, 0, 1]";
      this.eulerOutput.textContent = "X 0.00° · Y 0.00° · Z 0.00°";
      this.referenceDifferenceOutput.textContent = "No reference";
      return;
    }
    const bone = controller.getBones().find((candidate) => candidate.name === name);
    const offset = controller.getRotationOffset(name);
    const euler = offset.toEulerAngles();
    const referenceDifference = controller.getReferenceDifference(name);
    this.selectedBoneName.textContent = bone?.alias
      ? `${bone.alias} · ${name}`
      : name;
    this.selectedBoneParent.textContent = `parent: ${bone?.parentName ?? "none"}`;
    this.quaternionOutput.textContent = JSON.stringify(serializeQuaternion(offset));
    this.eulerOutput.textContent = formatEuler(euler.x, euler.y, euler.z);
    if (referenceDifference) {
      const differenceEuler = referenceDifference.toEulerAngles();
      this.referenceDifferenceOutput.textContent = formatEuler(
        differenceEuler.x,
        differenceEuler.y,
        differenceEuler.z
      );
    } else {
      this.referenceDifferenceOutput.textContent = "No reference";
    }
  }

  private savePose() {
    const controller = this.controller;
    if (!controller) return;
    const enteredName = this.poseNameInput.value.trim();
    const id = enteredName || window.prompt("Key Pose name", "test_pose")?.trim();
    if (!id) return;
    if (id === PROCEDURAL_NEUTRAL_POSE_ID) {
      this.setStatus("'neutral' is reserved for identity offsets.", true);
      return;
    }
    this.poseNameInput.value = id;
    const captured = controller.createPose(id, this.actions.getSource());
    const existing = this.savedPoses.get(id);
    const pose = existing ?? captured;
    if (existing) {
      existing.source = captured.source;
      existing.bones = captured.bones;
    } else {
      this.savedPoses.set(id, pose);
    }
    this.lastSavedPose = pose;
    this.renderPoseLibrary();
    this.renderProceduralKeys();
    this.renderProceduralLayers();
    this.syncProceduralLayers();
    this.actions.refreshProcedural();
    this.setStatus(
      `Saved '${id}' (${Object.keys(pose.bones).length} edited bones).`
    );
  }

  private async copyLastPose() {
    if (!this.lastSavedPose) {
      this.setStatus("Save a Key Pose before copying.", true);
      return;
    }
    await copyJson(this.lastSavedPose);
    this.setStatus(`Copied '${this.lastSavedPose.id}'.`);
  }

  private async copyAllPoses() {
    await copyJson([...this.savedPoses.values()]);
    this.setStatus(`Copied ${this.savedPoses.size} saved poses.`);
  }

  private renderPoseLibrary() {
    this.poseLibrary.replaceChildren();
    if (this.savedPoses.size === 0) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "No saved Key Poses";
      this.poseLibrary.append(empty);
      return;
    }
    for (const pose of this.savedPoses.values()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pose-entry";
      button.textContent = `${pose.id} (${Object.keys(pose.bones).length} bones)`;
      button.addEventListener("click", () => this.loadSavedPose(pose.id));
      this.poseLibrary.append(button);
    }
  }

  private loadSavedPose(poseId: string) {
    const pose =
      poseId === PROCEDURAL_NEUTRAL_POSE_ID
        ? null
        : this.savedPoses.get(poseId) ?? null;
    if (poseId !== PROCEDURAL_NEUTRAL_POSE_ID && !pose) return;
    this.controller?.loadPose(pose);
    this.lastSavedPose = pose;
    this.poseNameInput.value = pose?.id ?? "";
    this.setStatus(
      pose ? `Editing '${pose.id}'. Save with the same id to update it.` : "Editing neutral offsets."
    );
  }

  private renderProceduralKeys() {
    this.proceduralKeys.sort((left, right) => left.time - right.time);
    this.proceduralKeyList.replaceChildren();
    for (const key of this.proceduralKeys) {
      const row = document.createElement("div");
      row.className = "procedural-key";

      const time = document.createElement("input");
      time.type = "number";
      time.min = "0";
      time.step = "0.01";
      time.value = String(key.time);
      time.ariaLabel = "Key time";
      time.addEventListener("change", () => {
        key.time = Math.max(0, Number(time.value) || 0);
        this.renderProceduralKeys();
      });

      const pose = document.createElement("select");
      pose.ariaLabel = "Key Pose";
      replaceOptions(pose, [
        { value: PROCEDURAL_NEUTRAL_POSE_ID, label: "neutral" },
        ...[...this.savedPoses.keys()].map((id) => ({ value: id, label: id })),
      ]);
      pose.value = key.poseId;
      if (!pose.value) {
        key.poseId = PROCEDURAL_NEUTRAL_POSE_ID;
        pose.value = key.poseId;
      }
      pose.addEventListener("change", () => {
        key.poseId = pose.value;
      });

      const easing = document.createElement("select");
      easing.ariaLabel = "Key easing";
      replaceOptions(easing, [
        { value: "linear", label: "linear" },
        { value: "smooth", label: "smooth" },
      ]);
      easing.value = key.easing ?? "linear";
      easing.addEventListener("change", () => {
        key.easing = easing.value as ProceduralAnimationEasing;
      });

      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => this.loadSavedPose(key.poseId));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.ariaLabel = "Remove key";
      remove.addEventListener("click", () => {
        const index = this.proceduralKeys.findIndex(
          (candidate) => candidate.uid === key.uid
        );
        if (index >= 0) this.proceduralKeys.splice(index, 1);
        this.renderProceduralKeys();
      });

      row.append(time, pose, easing, edit, remove);
      this.proceduralKeyList.append(row);
    }
    const duration = this.proceduralKeys.at(-1)?.time ?? 0;
    this.proceduralTimelineInput.max = String(Math.max(0.01, duration));
    this.proceduralTimelineOutput.value = `${Number(this.proceduralTimelineInput.value).toFixed(3)}s / ${duration.toFixed(3)}s`;
  }

  private createProceduralDefinition(): ProceduralAnimationDefinition {
    const timeline = this.proceduralKeys
      .map(({ time, poseId, easing }) => ({ time, poseId, easing }))
      .sort((left, right) => left.time - right.time);
    const poses: Record<string, ProceduralPose> = {};
    for (const key of timeline) {
      if (key.poseId === PROCEDURAL_NEUTRAL_POSE_ID) continue;
      const pose = this.savedPoses.get(key.poseId);
      if (pose) poses[key.poseId] = pose;
    }
    const definition = {
      id: this.proceduralAnimationName.value.trim() || "procedural_test",
      poses,
      timeline,
    };
    this.proceduralAnimations.set(definition.id, definition);
    return definition;
  }

  private async copyProceduralAnimation(includePoses: boolean) {
    try {
      const definition = this.createProceduralDefinition();
      this.renderProceduralLayers();
      this.syncProceduralLayers();
      const value = includePoses
        ? definition
        : { id: definition.id, timeline: definition.timeline };
      await copyJson(value);
      this.setStatus(
        includePoses
          ? `Copied '${definition.id}' with referenced poses.`
          : `Copied '${definition.id}' animation definition.`
      );
    } catch (error) {
      this.reportError(error);
    }
  }

  private addProceduralLayer() {
    const uid = this.nextProceduralLayerUid++;
    const poseId = this.lastSavedPose?.id ?? this.savedPoses.keys().next().value;
    const animation = this.ensureCurrentProceduralAnimation();
    const layer: EditableProceduralLayer = {
      uid,
      id: `layer_${uid}`,
      enabled: true,
      weight: 1,
      sourceType: poseId ? "pose" : "animation",
      sourceId: poseId ?? animation.id,
      maskId: NO_MASK_ID,
      customBones: new Set<string>(),
    };
    this.proceduralLayers.push(layer);
    this.selectedLayerUid = uid;
    this.renderProceduralLayers();
    this.renderMaskEditor();
    this.renderBoneList();
    this.syncProceduralLayers();
  }

  private renderProceduralLayers() {
    this.proceduralLayerList.replaceChildren();
    if (this.proceduralLayers.length === 0) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "No procedural layers";
      this.proceduralLayerList.append(empty);
      return;
    }

    const poseOptions = [...this.savedPoses.keys()].map((id) => ({
      value: id,
      label: id,
    }));
    const currentAnimation = this.ensureCurrentProceduralAnimation();
    const animationOptions = [...this.proceduralAnimations.keys()].map((id) => ({
      value: id,
      label: id,
    }));
    if (animationOptions.length === 0) {
      animationOptions.push({
        value: currentAnimation.id,
        label: currentAnimation.id,
      });
    }

    for (const layer of this.proceduralLayers) {
      const card = document.createElement("div");
      card.className = "layer-card";
      card.dataset.selected = String(layer.uid === this.selectedLayerUid);
      card.addEventListener("click", () => {
        if (this.selectedLayerUid === layer.uid) return;
        this.selectedLayerUid = layer.uid;
        this.renderProceduralLayers();
        this.renderMaskEditor();
        this.renderBoneList();
      });

      const firstRow = document.createElement("div");
      firstRow.className = "layer-row layer-primary";
      const id = document.createElement("input");
      id.type = "text";
      id.value = layer.id;
      id.ariaLabel = "Layer id";
      id.addEventListener("change", () => {
        layer.id = id.value.trim() || `layer_${layer.uid}`;
        this.syncProceduralLayers();
        this.renderProceduralLayers();
      });
      const enabledLabel = document.createElement("label");
      enabledLabel.className = "inline-label";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = layer.enabled;
      enabled.addEventListener("change", () => {
        layer.enabled = enabled.checked;
        this.syncProceduralLayers();
      });
      enabledLabel.append(enabled, "Enabled");
      const weight = document.createElement("input");
      weight.type = "range";
      weight.min = "0";
      weight.max = "1";
      weight.step = "0.01";
      weight.value = String(layer.weight);
      weight.ariaLabel = "Layer weight";
      const weightValue = document.createElement("output");
      weightValue.value = layer.weight.toFixed(2);
      weight.addEventListener("input", () => {
        layer.weight = Number(weight.value);
        weightValue.value = layer.weight.toFixed(2);
        this.syncProceduralLayers();
      });
      firstRow.append(id, enabledLabel, weight, weightValue);

      const secondRow = document.createElement("div");
      secondRow.className = "layer-row layer-source";
      const sourceType = document.createElement("select");
      sourceType.ariaLabel = "Layer source type";
      replaceOptions(sourceType, [
        { value: "pose", label: "Pose" },
        { value: "animation", label: "Procedural Animation" },
      ]);
      sourceType.value = layer.sourceType;
      sourceType.addEventListener("change", () => {
        layer.sourceType = sourceType.value as ProceduralLayerSource["type"];
        const options = layer.sourceType === "pose" ? poseOptions : animationOptions;
        layer.sourceId = options[0]?.value ?? "";
        this.renderProceduralLayers();
        this.renderMaskEditor();
        this.renderBoneList();
        this.syncProceduralLayers();
      });

      const source = document.createElement("select");
      source.ariaLabel = "Layer source";
      const sourceOptions = layer.sourceType === "pose"
        ? poseOptions
        : animationOptions;
      replaceOptions(source, sourceOptions);
      if (!sourceOptions.some((option) => option.value === layer.sourceId)) {
        layer.sourceId = sourceOptions[0]?.value ?? "";
      }
      source.value = layer.sourceId;
      source.addEventListener("change", () => {
        layer.sourceId = source.value;
        this.renderBoneList();
        this.syncProceduralLayers();
      });

      const mask = document.createElement("select");
      mask.ariaLabel = "Layer mask";
      replaceOptions(mask, this.getMaskOptions());
      if (!this.getMaskOptions().some((option) => option.value === layer.maskId)) {
        layer.maskId = NO_MASK_ID;
      }
      mask.value = layer.maskId;
      mask.addEventListener("change", () => {
        layer.maskId = mask.value;
        this.renderMaskEditor();
        this.renderBoneList();
        this.syncProceduralLayers();
      });
      secondRow.append(sourceType, source, mask);

      const actions = document.createElement("div");
      actions.className = "row";
      const index = this.proceduralLayers.indexOf(layer);
      actions.append(
        layerButton("Up", index === 0, () => this.moveProceduralLayer(layer, -1)),
        layerButton(
          "Down",
          index === this.proceduralLayers.length - 1,
          () => this.moveProceduralLayer(layer, 1)
        ),
        layerButton("Delete", false, () => this.deleteProceduralLayer(layer))
      );
      card.append(firstRow, secondRow, actions);
      this.proceduralLayerList.append(card);
    }
  }

  private renderMaskEditor() {
    this.maskBoneList.replaceChildren();
    const layer = this.getSelectedLayer();
    if (!layer) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "Select a layer to inspect its mask";
      this.maskBoneList.append(empty);
      return;
    }
    if (layer.maskId !== CUSTOM_MASK_ID) {
      const summary = document.createElement("span");
      summary.className = "muted";
      const mask = this.resolveLayerMask(layer);
      summary.textContent = mask
        ? `${formatMaskLabel(mask.id)}: ${mask.bones.length} bones`
        : "No mask: all source bones are allowed";
      this.maskBoneList.append(summary);
      return;
    }
    const controller = this.controller;
    if (!controller) return;
    for (const bone of controller.getBones()) {
      const label = document.createElement("label");
      label.className = "mask-bone";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = layer.customBones.has(bone.name);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) layer.customBones.add(bone.name);
        else layer.customBones.delete(bone.name);
        this.renderBoneList();
        this.syncProceduralLayers();
      });
      label.append(checkbox, bone.alias ?? bone.name);
      this.maskBoneList.append(label);
    }
  }

  private moveProceduralLayer(
    layer: EditableProceduralLayer,
    direction: -1 | 1
  ) {
    const index = this.proceduralLayers.indexOf(layer);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.proceduralLayers.length) return;
    this.proceduralLayers.splice(index, 1);
    this.proceduralLayers.splice(target, 0, layer);
    this.renderProceduralLayers();
    this.syncProceduralLayers();
  }

  private deleteProceduralLayer(layer: EditableProceduralLayer) {
    const index = this.proceduralLayers.indexOf(layer);
    if (index < 0) return;
    this.proceduralLayers.splice(index, 1);
    if (this.selectedLayerUid === layer.uid) {
      this.selectedLayerUid = this.proceduralLayers[index]?.uid ??
        this.proceduralLayers[index - 1]?.uid ??
        null;
    }
    this.renderProceduralLayers();
    this.renderMaskEditor();
    this.renderBoneList();
    this.syncProceduralLayers();
  }

  private syncProceduralLayers() {
    const configs: ProceduralLayerConfig[] = [];
    for (const layer of this.proceduralLayers) {
      const source = this.resolveLayerSource(layer);
      if (!source) continue;
      configs.push({
        id: layer.id,
        enabled: layer.enabled,
        weight: layer.weight,
        mask: this.resolveLayerMask(layer),
        source,
        animationLoop: true,
      });
    }
    try {
      this.actions.setProceduralLayers(configs);
    } catch (error) {
      this.reportError(error);
    }
  }

  private getSelectedLayer() {
    return this.proceduralLayers.find(
      (layer) => layer.uid === this.selectedLayerUid
    ) ?? null;
  }

  private resolveLayerSource(
    layer: EditableProceduralLayer
  ): ProceduralLayerSource | null {
    if (layer.sourceType === "pose") {
      const pose = this.savedPoses.get(layer.sourceId);
      return pose
        ? { type: "pose", id: pose.id, pose }
        : null;
    }
    const definition = this.proceduralAnimations.get(layer.sourceId);
    return definition
      ? {
          type: "animation",
          id: definition.id,
          definition,
        }
      : null;
  }

  private resolveLayerMask(layer: EditableProceduralLayer) {
    if (layer.maskId === NO_MASK_ID) return undefined;
    if (layer.maskId === CUSTOM_MASK_ID) {
      return {
        id: `${layer.id}_custom`,
        bones: [...layer.customBones],
      } satisfies ProceduralBoneMask;
    }
    if (layer.maskId.startsWith(SAVED_MASK_PREFIX)) {
      return this.savedMasks.get(layer.maskId.slice(SAVED_MASK_PREFIX.length));
    }
    return this.presetMasks.get(layer.maskId);
  }

  private getLayerSourceBones(layer: EditableProceduralLayer) {
    const result = new Set<string>();
    const source = this.resolveLayerSource(layer);
    if (!source) return result;
    if (source.type === "pose") {
      for (const name in source.pose.bones) result.add(name);
      return result;
    }
    for (const pose of Object.values(source.definition.poses)) {
      for (const name in pose.bones) result.add(name);
    }
    return result;
  }

  private getMaskOptions() {
    return [
      { value: NO_MASK_ID, label: "No Mask" },
      ...[...this.presetMasks.keys()].map((id) => ({
        value: id,
        label: formatMaskLabel(id),
      })),
      ...[...this.savedMasks.keys()].map((id) => ({
        value: `${SAVED_MASK_PREFIX}${id}`,
        label: id,
      })),
      { value: CUSTOM_MASK_ID, label: "Custom" },
    ];
  }

  private ensureCurrentProceduralAnimation() {
    const id = this.proceduralAnimationName.value.trim() || "procedural_test";
    return this.proceduralAnimations.get(id) ??
      this.createProceduralDefinition();
  }

  private saveSelectedMask() {
    const layer = this.getSelectedLayer();
    if (!layer) {
      this.setStatus("Select a layer before saving a mask.", true);
      return;
    }
    const current = this.resolveLayerMask(layer);
    if (!current) {
      this.setStatus("Choose a mask before saving it.", true);
      return;
    }
    const entered = this.maskNameInput.value.trim();
    const id = entered || window.prompt("Mask name", "custom_mask")?.trim();
    if (!id) return;
    const saved = { id, bones: [...current.bones] };
    this.savedMasks.set(id, saved);
    layer.maskId = `${SAVED_MASK_PREFIX}${id}`;
    this.maskNameInput.value = id;
    this.renderProceduralLayers();
    this.renderMaskEditor();
    this.renderBoneList();
    this.syncProceduralLayers();
    this.setStatus(`Saved mask '${id}' (${saved.bones.length} bones).`);
  }

  private async copySelectedMask() {
    const layer = this.getSelectedLayer();
    const mask = layer ? this.resolveLayerMask(layer) : undefined;
    if (!mask) {
      this.setStatus("Select a masked layer before copying.", true);
      return;
    }
    await copyJson(mask);
    this.setStatus(`Copied mask '${mask.id}'.`);
  }

  private async copyLayerSetup() {
    const layers = this.proceduralLayers.map((layer) => ({
      id: layer.id,
      enabled: layer.enabled,
      weight: layer.weight,
      ...(this.resolveLayerMask(layer)
        ? { mask: this.resolveLayerMask(layer)!.id }
        : {}),
      source: { type: layer.sourceType, id: layer.sourceId },
    }));
    await copyJson({ layers });
    this.setStatus(`Copied ${layers.length} procedural layers.`);
  }

  private updateTimelineOutput(frame: number) {
    const from = Number(this.timelineInput.min);
    const to = Number(this.timelineInput.max);
    const currentSeconds = Math.max(0, frame - from) / this.animationFps;
    const durationSeconds = Math.max(0, to - from) / this.animationFps;
    this.timelineOutput.value = `${currentSeconds.toFixed(2)}s / ${durationSeconds.toFixed(2)}s`;
  }

  private reportError(error: unknown) {
    console.error("[ProceduralAnimationLab]", error);
    this.setStatus(error instanceof Error ? error.message : String(error), true);
  }

  private requireElement<T extends typeof Element>(selector: string, type: T) {
    const element = this.shadow.querySelector(selector);
    if (!(element instanceof type)) {
      throw new Error(`Missing Procedural Animation Lab control: ${selector}`);
    }
    return element as InstanceType<T>;
  }
}

function layerButton(
  label: string,
  disabled: boolean,
  onClick: () => void
) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function formatMaskLabel(id: string) {
  const words = id.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function replaceOptions(
  select: HTMLSelectElement,
  options: readonly { value: string; label: string }[]
) {
  select.replaceChildren(
    ...options.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    })
  );
}

function diagnosticLine(label: string, value: string) {
  const line = document.createElement("span");
  line.textContent = `${label}: ${value}`;
  return line;
}

async function copyJson(value: unknown) {
  const json = JSON.stringify(value, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = json;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard copy was rejected by the browser.");
  }
}

function formatEuler(x: number, y: number, z: number) {
  const degrees = 180 / Math.PI;
  return `X ${(x * degrees).toFixed(2)}° · Y ${(y * degrees).toFixed(2)}° · Z ${(z * degrees).toFixed(2)}°`;
}

function createEditorMarkup() {
  return `
    <style>
      :host { color-scheme: dark; }
      .panel {
        position: fixed;
        inset: 12px 12px 12px auto;
        z-index: 2147483000;
        width: min(520px, calc(100vw - 24px));
        overflow: auto;
        box-sizing: border-box;
        padding: 14px;
        border: 1px solid rgba(154, 205, 180, .42);
        border-radius: 8px;
        background: rgba(7, 13, 11, .96);
        box-shadow: 0 16px 48px rgba(0, 0, 0, .58);
        color: #dfece5;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      h1 { margin: 0 0 4px; font-size: 15px; letter-spacing: .07em; }
      .subtitle { margin: 0 0 14px; color: #89aa9a; }
      section { padding-top: 12px; border-top: 1px solid rgba(150, 190, 171, .16); }
      section + section { margin-top: 12px; }
      h2 { margin: 0 0 8px; color: #9fc9b5; font-size: 11px; letter-spacing: .1em; }
      h3 { margin: 4px 0 0; color: #9fc9b5; font-size: 10px; letter-spacing: .08em; }
      label { display: grid; gap: 4px; color: #b9cec4; }
      select, input, button {
        box-sizing: border-box;
        min-height: 30px;
        border: 1px solid rgba(145, 185, 166, .45);
        border-radius: 4px;
        background: #16221d;
        color: #eff8f3;
        font: inherit;
      }
      select, input[type="text"] { width: 100%; padding: 5px 7px; }
      input[type="number"] { width: 100%; padding: 5px; }
      input[type="range"] { width: 100%; border: 0; accent-color: #8fbca7; }
      input[type="checkbox"] { min-height: auto; accent-color: #8fbca7; }
      button { padding: 5px 9px; cursor: pointer; }
      button:hover, button:focus-visible { border-color: #c4e1d2; background: #21332b; outline: none; }
      button:disabled, select:disabled { cursor: wait; opacity: .55; }
      button[data-active="true"] { border-color: #9bd0b7; background: #29483a; }
      .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .between { justify-content: space-between; }
      .stack { display: grid; gap: 7px; }
      .inline-label { display: flex; align-items: center; gap: 6px; }
      .readout { color: #d6e9df; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      .muted { color: #86a092; }
      .bone-list { display: grid; gap: 4px; max-height: 230px; overflow: auto; padding-right: 2px; }
      .bone-entry { display: grid; width: 100%; gap: 2px; text-align: left; }
      .bone-entry small { color: #789184; }
      .bone-entry[data-selected="true"] { border-color: #b8ddca; background: #294438; }
      .bone-entry[data-edited="true"]::after { content: "offset"; color: #e5bd72; font-size: 10px; }
      .selected-card { display: grid; gap: 4px; padding: 8px; border-radius: 4px; background: rgba(124, 165, 145, .08); }
      .selected-card strong { color: #f0faf5; }
      .pose-library { display: flex; flex-wrap: wrap; gap: 5px; }
      .pose-entry { text-align: left; }
      .procedural-key { display: grid; grid-template-columns: 68px minmax(100px, 1fr) 78px auto 30px; gap: 5px; align-items: center; }
      .procedural-key button { padding-inline: 6px; }
      .diagnostics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px 10px; padding: 8px; border-radius: 4px; background: rgba(124, 165, 145, .08); font-variant-numeric: tabular-nums; }
      .layer-card { display: grid; gap: 6px; padding: 8px; border: 1px solid rgba(145, 185, 166, .28); border-radius: 5px; background: rgba(124, 165, 145, .05); }
      .layer-card[data-selected="true"] { border-color: #b8ddca; background: rgba(124, 165, 145, .13); }
      .layer-row { display: grid; gap: 6px; align-items: center; }
      .layer-primary { grid-template-columns: minmax(90px, 1fr) auto minmax(90px, 1fr) 36px; }
      .layer-source { grid-template-columns: 130px minmax(100px, 1fr) minmax(100px, 1fr); }
      .mask-bones { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px 8px; max-height: 180px; overflow: auto; padding: 6px; border-radius: 4px; background: rgba(124, 165, 145, .05); }
      .mask-bone { display: flex; align-items: center; gap: 5px; min-width: 0; }
      output { color: #b8d8c8; font-variant-numeric: tabular-nums; }
      .status { min-height: 1.4em; margin-top: 10px; color: #9fc9b5; }
      .status[data-error="true"] { color: #e7a09a; }
    </style>
    <aside class="panel" aria-label="Procedural Animation Lab">
      <h1>PROCEDURAL ANIMATION LAB</h1>
      <p class="subtitle">Animated base pose + local quaternion offsets</p>

      <section class="stack">
        <h2>MODEL</h2>
        <select id="poseLabModel" aria-label="Model"></select>
      </section>

      <section class="stack">
        <h2>ANIMATION</h2>
        <select id="poseLabAnimation" aria-label="Animation"></select>
        <div class="row">
          <button id="poseLabPlay" type="button">Play</button>
          <button id="poseLabPause" type="button">Pause</button>
          <button id="poseLabStop" type="button">Stop</button>
          <label class="inline-label"><input id="poseLabLoop" type="checkbox" checked /> Loop</label>
        </div>
        <label>Speed
          <input id="poseLabSpeed" type="range" min="0.1" max="2" step="0.05" value="1" />
          <output id="poseLabSpeedValue">1.00x</output>
        </label>
        <label>Timeline
          <input id="poseLabTimeline" type="range" min="0" max="1" step="0.01" value="0" />
          <output id="poseLabTimelineValue">0.00s / 0.00s</output>
        </label>
      </section>

      <section class="stack">
        <div class="row between"><h2>BONES</h2><label class="inline-label"><input id="poseLabShowSkeleton" type="checkbox" /> Show Skeleton</label></div>
        <input id="poseLabBoneFilter" type="text" placeholder="Filter bones" aria-label="Filter bones" />
        <div id="poseLabBoneList" class="bone-list"></div>
      </section>

      <section class="stack">
        <h2>SELECTED BONE OFFSET</h2>
        <div class="selected-card">
          <strong id="poseLabSelectedBone">No bone selected</strong>
          <span id="poseLabSelectedParent" class="muted"></span>
          <span>Quaternion: <span id="poseLabQuaternion" class="readout">[0, 0, 0, 1]</span></span>
          <span>Euler: <span id="poseLabEuler" class="readout">X 0.00° · Y 0.00° · Z 0.00°</span></span>
          <span>From reference: <span id="poseLabReferenceDifference" class="readout">No reference</span></span>
        </div>
        <div class="row">
          <button id="poseLabResetBone" type="button">Reset Selected Bone</button>
          <button id="poseLabResetAll" type="button">Reset All Offsets</button>
        </div>
      </section>

      <section class="stack">
        <h2>REFERENCE POSE</h2>
        <div class="row">
          <button id="poseLabCaptureReference" type="button">Capture Reference</button>
          <button id="poseLabClearReference" type="button">Clear Reference</button>
        </div>
        <span id="poseLabReferenceStatus" class="muted">No reference</span>
      </section>

      <section class="stack">
        <h2>KEY POSE</h2>
        <input id="poseLabPoseName" type="text" placeholder="test_pose" aria-label="Key Pose name" />
        <div class="row">
          <button id="poseLabSave" type="button">Save Key Pose</button>
          <button id="poseLabCopy" type="button">Copy Pose</button>
          <button id="poseLabCopyAll" type="button">Copy All Saved Poses</button>
        </div>
        <div id="poseLabPoseLibrary" class="pose-library"></div>
      </section>

      <section class="stack">
        <h2>PROCEDURAL ANIMATION</h2>
        <input id="poseLabProceduralName" type="text" value="procedural_test" aria-label="Procedural animation name" />
        <div id="poseLabProceduralKeys" class="stack"></div>
        <button id="poseLabProceduralAddKey" type="button">Add Key</button>
        <div class="row">
          <button id="poseLabProceduralPlay" type="button">Play Procedural</button>
          <button id="poseLabProceduralPause" type="button">Pause</button>
          <button id="poseLabProceduralStop" type="button">Stop</button>
          <label class="inline-label"><input id="poseLabProceduralLoop" type="checkbox" /> Loop</label>
        </div>
        <label>Procedural Speed
          <input id="poseLabProceduralSpeed" type="range" min="0.1" max="2" step="0.05" value="1" />
          <output id="poseLabProceduralSpeedValue">1.00x</output>
        </label>
        <label>Procedural Timeline
          <input id="poseLabProceduralTimeline" type="range" min="0" max="0.01" step="0.001" value="0" />
          <output id="poseLabProceduralTimelineValue">0.000s / 0.000s</output>
        </label>
        <div id="poseLabProceduralDiagnostics" class="diagnostics">
          <span>Current: none</span><span>Time: 0.000</span>
          <span>From: neutral</span><span>To: neutral</span>
          <span>Blend: 0.000</span>
        </div>
        <div class="row">
          <button id="poseLabCopyProcedural" type="button">Copy Animation</button>
          <button id="poseLabCopyProceduralWithPoses" type="button">Copy Animation + Poses</button>
        </div>
      </section>

      <section class="stack">
        <div class="row between">
          <h2>PROCEDURAL LAYERS</h2>
          <button id="poseLabAddLayer" type="button">+ Add Layer</button>
        </div>
        <div id="poseLabProceduralLayers" class="stack"></div>
        <h3>MASK</h3>
        <input id="poseLabMaskName" type="text" placeholder="custom_mask" aria-label="Mask name" />
        <div id="poseLabMaskBones" class="mask-bones"></div>
        <div class="row">
          <button id="poseLabSaveMask" type="button">Save Mask</button>
          <button id="poseLabCopyMask" type="button">Copy Mask</button>
        </div>
        <div class="row">
          <button id="poseLabCopyLayerSetup" type="button">Copy Layer Setup</button>
          <button id="poseLabClearLayers" type="button">Stop All / Clear</button>
        </div>
      </section>

      <div id="poseLabStatus" class="status" aria-live="polite"></div>
    </aside>
  `;
}
