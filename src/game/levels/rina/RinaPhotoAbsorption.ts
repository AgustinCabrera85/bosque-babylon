import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { RinaController } from "../../enemies/rina";
import { RinaElectricSurfaceFX } from "../../effects/RinaElectricSurfaceFX";
import { createLightOrbVisual } from "../../PlayerAttackSystem";
import type { RinaFieldPhoneRig } from "./RinaFieldCrowdMazeRenderer";
import { RINA_CROWD_FANS } from "./crowd/RinaCrowdAssetManifest";
import type { RinaSingingPointAction } from "./RinaSingingPointAction";
import { RinaElectricArcLink } from "./RinaElectricArcLink";

const VIOLET = "#A53BFF";
const BLUE = "#189CFF";
const EXPLODE_AT = 4.0;
const RISE_SECONDS = 0.78;

type LightOrb = ReturnType<typeof createLightOrbVisual>;
type Victim = {
  candidate: RinaFieldPhoneRig;
  colorHex: string;
  height: number;
  fx: RinaElectricSurfaceFX | null;
  charging: boolean;
  phase: "charging" | "rising" | "traveling";
  phaseTime: number;
  origin: Vector3;
  riseEnd: Vector3;
  orb: LightOrb | null;
  orbLight: PointLight | null;
  travelSeconds: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** One photographed spectator at a time: charge, burst, rise, and absorption. */
export class RinaPhotoAbsorption {
  private readonly rinaFlash: RinaElectricSurfaceFX;
  private readonly arcLink: RinaElectricArcLink;
  private readonly chest = Vector3.Zero();
  private readonly foot = Vector3.Zero();
  private readonly attacked = new Set<string>();
  private victim: Victim | null = null;
  private orbSerial = 0;
  private absorbedId: string | null = null;
  private absorbedColor: string | null = null;
  private transformationAt = 0;

  constructor(
    private readonly scene: Scene,
    private readonly rina: RinaController,
    private readonly pointing: RinaSingingPointAction,
    private readonly glow: GlowLayer,
    private readonly retirePhone: (id: string) => void,
    rinaMeshes: readonly Mesh[],
  ) {
    this.arcLink = new RinaElectricArcLink(scene);
    this.rinaFlash = new RinaElectricSurfaceFX(scene, {
      regionRadius: 0.58,
      parameters: { emission: 0.75, halo: 0.2,
        lightIntensity: 1.55, lightRange: 1.3 },
    });
    const before = scene.meshes.length;
    this.rinaFlash.attach(rinaMeshes);
    this.excludeNewOverlays(before);
    this.rinaFlash.setImpactProvider(() => this.getRinaChest());
  }

  start(candidate: RinaFieldPhoneRig) {
    if (!this.canStart(candidate)) return false;
    const fan = RINA_CROWD_FANS.find(entry => entry.id === candidate.fanId);
    if (!fan) return false;
    const colorHex = fan.gender === "female" ? VIOLET : BLUE;
    const fx = new RinaElectricSurfaceFX(this.scene, {
      parameters: { colorHex, emission: 0.72, halo: 0.18,
        lightIntensity: 2.3, lightRange: 3.6 },
    });
    const before = this.scene.meshes.length;
    fx.attach([candidate.mesh]);
    this.excludeNewOverlays(before);
    fx.setImpactProvider(() => this.getVictimChest(candidate, fan.targetWorldHeight));
    fx.setStrength(0);
    this.attacked.add(candidate.id);
    this.victim = {
      candidate, colorHex, height: fan.targetWorldHeight, fx,
      charging: false, phase: "charging", phaseTime: 0,
      origin: Vector3.Zero(), riseEnd: Vector3.Zero(),
      orb: null, orbLight: null, travelSeconds: 1.5,
    };
    return true;
  }

  update(dt: number) {
    const step = Math.max(0, Math.min(dt, 0.05));
    this.rinaFlash.update(step);
    const victim = this.victim;
    if (!victim) return;
    if (victim.phase === "charging") {
      const pointingTime = this.pointing.pointingElapsed;
      if (this.pointing.pointing && !victim.charging) {
        victim.fx?.startContinuous();
        victim.charging = true;
      }
      if (victim.charging) {
        const growth = smoothstep(pointingTime / EXPLODE_AT);
        victim.fx?.setStrength(0.08 + growth * 0.92);
        victim.fx?.update(step);
        const hand = this.rina.rig.getJointNode("leftHand");
        if (hand) {
          hand.computeWorldMatrix(true);
          this.arcLink.update(hand.getAbsolutePosition(),
            this.getVictimChest(victim.candidate, victim.height),
            pointingTime, smoothstep(pointingTime / 0.22) * (0.55 + growth * 0.45));
        }
      }
      if (pointingTime >= EXPLODE_AT) this.explode(victim);
      return;
    }

    victim.phaseTime += step;
    victim.orb?.update(victim.phaseTime);
    if (victim.phase === "rising") {
      const t = smoothstep(victim.phaseTime / RISE_SECONDS);
      Vector3.LerpToRef(victim.origin, victim.riseEnd, t, victim.orb!.root.position);
      const burst = clamp01(victim.phaseTime / 0.34);
      victim.orb?.setBurst(burst, (1 - burst) * 1.45);
      victim.orb!.root.scaling.setAll(1 + Math.sin(burst * Math.PI) * 0.7);
      if (victim.orbLight) {
        victim.orbLight.position.copyFrom(victim.orb!.root.position);
        victim.orbLight.intensity = 1.1 + (1 - burst) * 6.2;
      }
      if (victim.phaseTime >= RISE_SECONDS) {
        victim.phase = "traveling";
        victim.phaseTime = 0;
        victim.orb!.root.scaling.setAll(1);
        victim.travelSeconds = Math.max(1.2, Math.min(2.4,
          Vector3.Distance(victim.riseEnd, this.getRinaChest()) / 17));
      }
      return;
    }

    const t = smoothstep(victim.phaseTime / victim.travelSeconds);
    Vector3.LerpToRef(victim.riseEnd, this.getRinaChest(), t,
      victim.orb!.root.position);
    victim.orb!.root.position.y += Math.sin(Math.PI * t) * 0.48;
    if (victim.orbLight) {
      victim.orbLight.position.copyFrom(victim.orb!.root.position);
      victim.orbLight.intensity = 1.15 * (1 - t * 0.55);
    }
    if (victim.phaseTime >= victim.travelSeconds) {
      this.rinaFlash.setParameters({ colorHex: victim.colorHex });
      this.rinaFlash.triggerHit({ growthSeconds: 0.07,
        holdSeconds: 0.27, fadeSeconds: 0.55 });
      this.absorbedId = victim.candidate.id;
      this.absorbedColor = victim.colorHex;
      this.releaseVictim(victim);
    }
  }

  get activeVictimId() { return this.victim?.candidate.id ?? null; }
  canStart(candidate: RinaFieldPhoneRig) {
    return !this.victim && !this.attacked.has(candidate.id);
  }
  get activeColor() { return this.victim?.colorHex ?? null; }
  get chargeElapsed() { return this.victim?.phase === "charging"
    ? this.pointing.pointingElapsed : null; }
  get arcVisible() { return this.arcLink.visible; }
  get arcEndpoints() { return this.arcLink.endpoints; }
  get arcMidpoint() { return this.arcLink.midpoint; }
  get victimTarget() {
    const victim = this.victim;
    return victim?.phase === "charging"
      ? this.getVictimChest(victim.candidate, victim.height).clone() : null;
  }
  get lastTransformationAt() { return this.transformationAt; }
  get phase() { return this.victim?.phase ?? "idle"; }
  get orbPosition() { return this.victim?.orb?.root.position.clone() ?? null; }
  get lastAbsorbedId() { return this.absorbedId; }
  get lastAbsorbedColor() { return this.absorbedColor; }

  dispose() {
    if (this.victim) this.releaseVictim(this.victim);
    this.arcLink.dispose();
    this.rinaFlash.dispose();
  }

  private explode(victim: Victim) {
    this.transformationAt = this.pointing.pointingElapsed;
    this.arcLink.hide();
    victim.origin.copyFrom(this.getVictimChest(victim.candidate, victim.height));
    victim.riseEnd.copyFrom(victim.origin).addInPlaceFromFloats(0, 1.85, 0);
    victim.fx?.dispose();
    victim.fx = null;
    this.retirePhone(victim.candidate.id);
    victim.candidate.retire();
    victim.phase = "rising";
    victim.phaseTime = 0;
    const orb = createLightOrbVisual(this.scene,
      `rinaAbsorbedLight_${++this.orbSerial}`, Color3.FromHexString(victim.colorHex));
    orb.root.position.copyFrom(victim.origin);
    victim.orb = orb;
    const light = new PointLight(`rinaAbsorbedLight_${this.orbSerial}:flash`,
      victim.origin.clone(), this.scene);
    light.diffuse = Color3.FromHexString(victim.colorHex);
    light.specular = Color3.Black();
    light.intensity = 7.3;
    light.range = 4.5;
    light.shadowEnabled = false;
    victim.orbLight = light;
  }

  private releaseVictim(victim: Victim) {
    this.arcLink.hide();
    victim.fx?.dispose();
    victim.orb?.dispose();
    victim.orbLight?.dispose();
    if (this.victim === victim) this.victim = null;
  }

  private getVictimChest(candidate: RinaFieldPhoneRig, height: number) {
    candidate.getWorldFootPositionToRef(this.foot);
    this.chest.copyFrom(this.foot).addInPlaceFromFloats(0, height * 0.53, 0);
    return this.chest;
  }

  private getRinaChest() {
    const spine = this.rina.rig.getJointNode("spine2");
    if (spine) {
      spine.computeWorldMatrix(true);
      this.chest.copyFrom(spine.getAbsolutePosition());
    } else {
      this.chest.copyFrom(this.rina.root.position).addInPlaceFromFloats(0, 1.3, 0);
    }
    return this.chest;
  }

  private excludeNewOverlays(from: number) {
    for (const mesh of this.scene.meshes.slice(from)) {
      if (mesh instanceof Mesh && mesh.name.startsWith("rinaElectricFX_")) {
        this.glow.addExcludedMesh(mesh);
      }
    }
  }
}
