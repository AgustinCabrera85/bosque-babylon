import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { ProceduralAnimationDefinition } from "./ProceduralAnimationDefinition";
import { ProceduralAnimationPlayer } from "./ProceduralAnimationPlayer";
import type { ProceduralBoneMask } from "./ProceduralBoneMask";
import type { ProceduralPose } from "./ProceduralPose";
import {
  ProceduralPosePlayer,
  type ProceduralPoseOffsetTarget,
} from "./ProceduralPosePlayer";

export type ProceduralLayerSource =
  | { type: "pose"; id: string; pose: ProceduralPose }
  | {
      type: "animation";
      id: string;
      definition: ProceduralAnimationDefinition;
    };

export type ProceduralLayerConfig = {
  id: string;
  enabled: boolean;
  weight: number;
  mask?: ProceduralBoneMask;
  source: ProceduralLayerSource;
  animationLoop?: boolean;
  animationSpeedRatio?: number;
};

const IDENTITY = Quaternion.Identity();

export class ProceduralLayer {
  public id: string;
  public enabled: boolean;
  public weight: number;

  private readonly posePlayer = new ProceduralPosePlayer();
  private source: ProceduralLayerSource;
  private mask: ProceduralBoneMask | undefined;
  private maskBones: Set<string> | null = null;
  private animationPlayer: ProceduralAnimationPlayer | null = null;

  public constructor(config: ProceduralLayerConfig) {
    this.id = config.id;
    this.enabled = config.enabled;
    this.weight = clamp01(config.weight);
    this.source = config.source;
    this.setMask(config.mask);
    this.setSource(config.source);
    this.configure(config);
  }

  public configure(config: ProceduralLayerConfig) {
    this.id = config.id;
    this.enabled = config.enabled;
    this.weight = clamp01(config.weight);
    this.setMask(config.mask);
    this.setSource(config.source);
    if (this.animationPlayer) {
      this.animationPlayer.setLoop(config.animationLoop ?? true);
      this.animationPlayer.setSpeedRatio(config.animationSpeedRatio ?? 1);
    }
  }

  public setSource(source: ProceduralLayerSource) {
    if (isSameSource(this.source, source) && this.animationPlayer) return;
    if (
      isSameSource(this.source, source) &&
      source.type === "pose" &&
      !this.animationPlayer
    ) {
      this.posePlayer.setPose(source.pose);
      return;
    }
    this.animationPlayer?.stop();
    this.animationPlayer = null;
    this.posePlayer.clear();
    this.source = source;
    if (source.type === "pose") {
      this.posePlayer.setPose(source.pose);
    } else {
      this.animationPlayer = new ProceduralAnimationPlayer(this.posePlayer);
      this.animationPlayer.setLoop(true);
      this.animationPlayer.play(source.definition);
    }
  }

  public setMask(mask: ProceduralBoneMask | undefined) {
    this.mask = mask;
    this.maskBones = mask ? new Set(mask.bones) : null;
  }

  public update(dt: number) {
    if (this.source.type === "pose") this.posePlayer.setPose(this.source.pose);
    else this.animationPlayer?.update(dt);
  }

  public refresh() {
    if (this.source.type === "pose") this.posePlayer.setPose(this.source.pose);
    else this.animationPlayer?.refresh();
  }

  public playAnimation() {
    if (this.source.type !== "animation") return;
    this.animationPlayer?.play(this.source.definition);
  }

  public stop() {
    this.animationPlayer?.stop();
    this.posePlayer.clear();
  }

  public affectsBone(name: string) {
    return !this.maskBones || this.maskBones.has(name);
  }

  public getOffsets() {
    return this.posePlayer.getOffsets();
  }

  public getSource() {
    return this.source;
  }

  public getMask() {
    return this.mask;
  }

  public getAnimationPlayer() {
    return this.animationPlayer;
  }
}

export class ProceduralLayerStack {
  private readonly layers: ProceduralLayer[] = [];
  private readonly outputOffsets = new Map<string, Quaternion>();
  private readonly outputPool = new Map<string, Quaternion>();
  private readonly weightedOffset = Quaternion.Identity();
  private readonly multipliedOffset = Quaternion.Identity();

  public constructor(private readonly target: ProceduralPoseOffsetTarget) {}

  public setLayers(configs: readonly ProceduralLayerConfig[]) {
    const existing = new Map(this.layers.map((layer) => [layer.id, layer]));
    const next: ProceduralLayer[] = [];
    const ids = new Set<string>();
    for (const config of configs) {
      if (!config.id || ids.has(config.id)) {
        throw new Error(`Procedural layer id must be unique: '${config.id}'.`);
      }
      ids.add(config.id);
      const layer = existing.get(config.id) ?? new ProceduralLayer(config);
      layer.configure(config);
      next.push(layer);
      existing.delete(config.id);
    }
    for (const removed of existing.values()) removed.stop();
    this.layers.splice(0, this.layers.length, ...next);
    this.refresh();
  }

  public addLayer(config: ProceduralLayerConfig) {
    if (this.layers.some((layer) => layer.id === config.id)) {
      throw new Error(`Procedural layer '${config.id}' already exists.`);
    }
    const layer = new ProceduralLayer(config);
    this.layers.push(layer);
    this.compose();
    return layer;
  }

  public removeLayer(id: string) {
    const index = this.layers.findIndex((layer) => layer.id === id);
    if (index < 0) return;
    this.layers[index].stop();
    this.layers.splice(index, 1);
    this.compose();
  }

  public moveLayer(id: string, direction: -1 | 1) {
    const index = this.layers.findIndex((layer) => layer.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= this.layers.length) return;
    const [layer] = this.layers.splice(index, 1);
    this.layers.splice(targetIndex, 0, layer);
    this.compose();
  }

  public update(dt: number) {
    for (const layer of this.layers) layer.update(dt);
    this.compose();
  }

  public refresh() {
    for (const layer of this.layers) layer.refresh();
    this.compose();
  }

  public clear() {
    for (const layer of this.layers) layer.stop();
    this.layers.length = 0;
    this.outputOffsets.clear();
    this.target.setProceduralOffsets(this.outputOffsets);
  }

  public getLayers() {
    return this.layers as readonly ProceduralLayer[];
  }

  public getLayer(id: string) {
    return this.layers.find((layer) => layer.id === id) ?? null;
  }

  public getComposedOffsets() {
    return this.outputOffsets as ReadonlyMap<string, Quaternion>;
  }

  private compose() {
    this.outputOffsets.clear();
    for (const layer of this.layers) {
      if (!layer.enabled || layer.weight <= 0) continue;
      for (const [name, offset] of layer.getOffsets()) {
        if (!layer.affectsBone(name)) continue;
        let composed = this.outputOffsets.get(name);
        if (!composed) {
          composed = this.outputPool.get(name);
          if (!composed) {
            composed = Quaternion.Identity();
            this.outputPool.set(name, composed);
          } else {
            composed.copyFrom(IDENTITY);
          }
          this.outputOffsets.set(name, composed);
        }
        Quaternion.SlerpToRef(
          IDENTITY,
          offset,
          layer.weight,
          this.weightedOffset
        );
        composed.multiplyToRef(this.weightedOffset, this.multipliedOffset);
        composed.copyFrom(this.multipliedOffset).normalize();
      }
    }
    this.target.setProceduralOffsets(this.outputOffsets);
  }
}

function isSameSource(
  current: ProceduralLayerSource,
  next: ProceduralLayerSource
) {
  if (current.type !== next.type || current.id !== next.id) return false;
  return current.type === "pose"
    ? current.pose === (next as Extract<ProceduralLayerSource, { type: "pose" }>).pose
    : current.definition ===
        (next as Extract<ProceduralLayerSource, { type: "animation" }>).definition;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
