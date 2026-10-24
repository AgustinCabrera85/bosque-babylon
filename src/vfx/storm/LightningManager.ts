import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { CloudEmitterSystem } from "./CloudEmitterSystem";
import type { LightningSpriteEffectV2 } from "./LightningSpriteEffectV2";
import type { LightningEventKind } from "./LightningVariantLibrary";
import type { StormLightPool } from "./StormLightPool";
import type { StormSky } from "./StormSky";

export interface StormTrigger {
  kind: LightningEventKind;
  sourceId: string;
  target?: Vector3;
}
type ActiveStrike = StormTrigger & { age: number; origin: Vector3; destination: Vector3 };

export const approvedV1Demo = Object.freeze({
  growthDuration: 0.14,
  emission: 2.5,
  lightStrength: 10.6,
  halo: true,
  dynamicLights: true,
  bloom: false,
  auto: true,
});

/** Schedules a single reusable strike and synchronizes the sky, clouds and light pool. */
export class LightningManager {
  auto = false;
  paused = false;
  reducedFlashes = false;
  skyFlashEnabled = true;
  cloudFlashEnabled = true;
  dynamicLightsEnabled = true;
  emission = approvedV1Demo.emission;
  lightStrength = approvedV1Demo.lightStrength;
  interval = 2.8;
  seed = 17;
  private randomState = 17;
  private countdown = 0.8;
  private active: ActiveStrike | null = null;
  private lastKind: LightningEventKind | null = null;

  constructor(
    readonly effect: LightningSpriteEffectV2,
    readonly clouds: CloudEmitterSystem,
    readonly sky: StormSky,
    readonly lights: StormLightPool,
    private readonly camera: Camera,
  ) {}

  get currentKind(): LightningEventKind | null { return this.active?.kind ?? this.lastKind; }
  get isActive(): boolean { return this.active !== null; }
  reseed(value: number): void { this.seed = value >>> 0; this.randomState = this.seed || 1; }
  private random(): number {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  trigger(request: StormTrigger): void {
    const source = this.clouds.emitter(request.sourceId) ?? this.clouds.activeEmitters()[0];
    const origin = source.anchorWorld();
    const destination = request.target?.clone() ?? new Vector3(origin.x + 0.8, 0.08, origin.z + 0.5);
    if (request.kind === "cloud_to_cloud") {
      throw new Error("LGT_04 sigue pendiente de arte; no se simula con LGT_01");
    }
    this.active = { ...request, sourceId: source.id, age: 0, origin, destination };
    this.lastKind = request.kind;
    this.effect.timing.intensity = this.emission;
    this.effect.reducedFlashes = this.reducedFlashes;
    this.effect.setEndpoints(origin, destination, this.camera.position);
    this.effect.start();
    this.effect.mesh.setEnabled(false); // The cloud preflash precedes the bolt.
    this.lights.clear();
    this.countdown = this.interval * (0.72 + this.random() * 0.56);
  }

  update(dt: number): void {
    if (this.paused) return;
    dt = Math.max(0, Math.min(dt, 0.1));
    this.clouds.update(dt);
    this.effect.reducedFlashes = this.reducedFlashes;
    this.lights.setEnabled(this.dynamicLightsEnabled);
    if (!this.active) {
      this.sky.setFlash(0);
      this.lights.clear();
      if (this.auto) {
        this.countdown -= dt;
        if (this.countdown <= 0) {
          const emitters = this.clouds.activeEmitters();
          const source = emitters[Math.floor(this.random() * emitters.length)];
          const kind: LightningEventKind = this.random() < 0.18 ? "background_flash" : "cloud_to_ground";
          this.trigger({ kind, sourceId: source.id });
        }
      }
      return;
    }
    const strike = this.active;
    strike.age += dt;
    const preflash = 0.11;
    if (strike.age < preflash) {
      if (this.cloudFlashEnabled) this.clouds.flashEmitter(strike.sourceId, this.reducedFlashes ? 0.08 : 0.33);
      this.sky.setFlash(this.skyFlashEnabled ? (this.reducedFlashes ? 0.03 : 0.12) : 0);
      return;
    }
    if (strike.kind === "background_flash") {
      this.effect.mesh.setEnabled(false);
      const t = strike.age - preflash;
      const pulse = Math.exp(-Math.pow((t - 0.11) / 0.15, 2));
      this.sky.setFlash(this.skyFlashEnabled ? pulse * (this.reducedFlashes ? 0.13 : 0.65) : 0);
      if (this.cloudFlashEnabled) this.clouds.flashEmitter(strike.sourceId, pulse * 0.45);
      if (t > 0.55) { this.effect.pause(); this.active = null; }
      return;
    }
    if (!this.effect.mesh.isEnabled()) this.effect.mesh.setEnabled(true);
    this.effect.update(dt);
    const pulse = this.effect.fade * (0.28 + this.effect.flash * 0.72);
    const restrained = this.reducedFlashes ? 0.24 : 1;
    this.sky.setFlash(this.skyFlashEnabled ? pulse * restrained * 0.67 : 0);
    if (this.cloudFlashEnabled) this.clouds.flashEmitter(strike.sourceId, pulse * restrained * 0.8);
    if (this.dynamicLightsEnabled) {
      this.lights.illuminate(this.effect.headWorld(), strike.destination,
        pulse * restrained * this.lightStrength);
    }
    if (!this.effect.isPlaying) {
      this.active = null;
      this.sky.setFlash(0);
      this.lights.clear();
    }
  }

  scrub(progress: number): void {
    this.active = null;
    this.sky.setFlash(0);
    this.lights.clear();
    this.effect.scrub(progress, progress > 0 ? 1 : 0);
  }
  dispose(): void {
    this.active = null;
    this.effect.dispose();
    this.lights.dispose();
    this.clouds.dispose();
    this.sky.dispose();
  }
}
