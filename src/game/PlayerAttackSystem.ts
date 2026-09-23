import { Engine } from "@babylonjs/core/Engines/engine";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { PlayerController } from "./PlayerController";
import type { PlayerStatsSystem } from "./PlayerStatsSystem";
import { PlayerLightRechargeVFX } from "./PlayerLightRechargeVFX";
import type { EnemyController } from "./enemies/core/EnemyTypes";
import type { EnemyManager } from "./enemies/core/EnemyManager";

const MAX_CHARGE_SECONDS = 1.5;
const MIN_LAUNCH_SPEED = 16;
const MAX_LAUNCH_SPEED = 48;
const PROJECTILE_GRAVITY = 13.5;
const PROJECTILE_RADIUS = 0.2;
const PROJECTILE_LIFETIME_SECONDS = 4;
const PROJECTILE_DAMAGE = 1;
const RECHARGE_RADIUS = 3.6;
const RECHARGE_SECONDS_PER_ORB = 0.9;
const RECHARGE_DELAY_AFTER_SHOT = 0.65;
const AIM_ASSIST_ANGLE_RADIANS = (13 * Math.PI) / 180;
const AIM_ASSIST_MAX_DISTANCE = 130;
const FREE_AIM_CONVERGENCE_DISTANCE = 120;
const TRAJECTORY_POINT_COUNT = 41;
const TRAJECTORY_STEP_SECONDS = 0.1;
const TRAJECTORY_TARGET_COLOR = new Color3(0.42, 0.95, 1);
const TRAJECTORY_FREE_COLOR = new Color3(0.62, 0.78, 1);

// Visual-only tuning. The shell stays close to the core so it reads as a
// membrane instead of a second, blue sphere.
const HELD_CORE_DIAMETER = PROJECTILE_RADIUS * 1.8;
const HELD_SHELL_DIAMETER = PROJECTILE_RADIUS * 2.28;
const PROJECTILE_CORE_DIAMETER = PROJECTILE_RADIUS * 2;
const PROJECTILE_SHELL_DIAMETER = PROJECTILE_RADIUS * 2.5;
const IMPACT_DURATION_SECONDS = 0.34;
// Group 1 preserves the opaque world's depth in createScene, so transparent
// orb VFX are correctly occluded by the player and environment.
const LIGHT_ORB_RENDERING_GROUP = 1;

const LIGHT_ORB_VERTEX_SHADER = `
  precision highp float;

  attribute vec3 position;
  attribute vec3 normal;

  uniform mat4 world;
  uniform mat4 worldViewProjection;

  varying vec3 vLocalDirection;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main(void) {
    vec4 worldPosition = world * vec4(position, 1.0);
    vLocalDirection = normalize(position);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize((world * vec4(normal, 0.0)).xyz);
    gl_Position = worldViewProjection * vec4(position, 1.0);
  }
`;

const LIGHT_ORB_CORE_FRAGMENT_SHADER = `
  precision highp float;

  varying vec3 vLocalDirection;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  uniform vec3 cameraPosition;
  uniform float time;
  uniform float charge;
  uniform float motionBoost;
  uniform float opacity;
  uniform float burstProgress;
  uniform float burstStrength;

  float filament(float wave, float width) {
    return 1.0 - smoothstep(width, width + 0.05, abs(sin(wave)));
  }

  void main(void) {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float facing = abs(dot(normalize(vWorldNormal), viewDirection));
    float speed = mix(0.62, 1.42, charge) * motionBoost;
    float t = time * speed;
    vec3 p = normalize(vLocalDirection);

    // A smooth, animated domain bend keeps the lines coherent while making
    // junctions drift, separate and reconnect instead of reading as a texture.
    vec3 warp = vec3(
      sin(p.y * 5.1 + t * 0.91) + sin(p.z * 8.3 - t * 0.47),
      sin(p.z * 5.7 - t * 0.76) + sin(p.x * 7.2 + t * 0.58),
      sin(p.x * 6.4 + t * 0.69) + sin(p.y * 8.7 - t * 0.52)
    ) * mix(0.085, 0.145, charge);
    vec3 q = p + warp;
    float width = mix(0.034, 0.072, charge);

    // Three inexpensive curved wave fields provide the dense vein network.
    // Their intersections become brighter branch points and imply depth.
    float strandA = filament(
      q.x * 9.2 + q.z * 3.1 + sin(q.y * 6.1 - t * 0.82) * 1.36,
      width
    );
    float strandB = filament(
      q.y * 10.4 - q.x * 2.7 + sin(q.z * 7.4 + t * 0.71) * 1.24,
      width * 0.9
    );
    float strandC = filament(
      (q.x + q.y - q.z) * 7.1 + sin((q.x - q.y) * 5.6 - t) * 1.18,
      width * 0.78
    );
    float filaments = max(strandA, max(strandB * 0.92, strandC * 0.82));
    float junctions = min(1.0, strandA * strandB + strandB * strandC + strandC * strandA);

    // Front-facing fragments form the compressed center mass. Back-facing
    // filaments still contribute through additive blending, suggesting layers
    // suspended inside the sphere rather than paint on its surface.
    float centerProfile = smoothstep(mix(0.12, 0.28, charge), 1.0, facing);
    float hotCenterProfile = smoothstep(mix(0.52, 0.62, charge), 1.0, facing);
    float centerMass = pow(centerProfile, mix(3.2, 4.6, charge));
    float hotCenter = pow(hotCenterProfile, mix(3.8, 6.5, charge));
    float depthFade = smoothstep(0.035, 0.72, facing);
    filaments *= mix(0.28, 1.0, depthFade);

    float fullCharge = smoothstep(0.76, 1.0, charge);
    float surge = fullCharge * (
      0.5 + 0.5 * sin(t * 4.9 + sin(t * 1.7) * 1.4)
    );
    float burstBand = 1.0 - smoothstep(
      0.025,
      0.15,
      abs(facing - mix(0.98, 0.12, burstProgress))
    );
    float burstEnvelope = sin(burstProgress * 3.14159265) * burstStrength;
    float impactFlash = (1.0 - smoothstep(0.0, 0.38, burstProgress)) * burstStrength;

    vec3 coolWhite = vec3(0.76, 0.91, 1.0);
    vec3 warmWhite = vec3(1.0, 0.985, 0.93);
    vec3 color = mix(coolWhite, warmWhite, 0.48 + hotCenter * 0.52);
    float energy = 0.1 + centerMass * mix(0.3, 0.48, charge);
    energy += filaments * mix(1.55, 2.25, charge);
    energy += junctions * (0.55 + charge * 0.4);
    energy += hotCenter * (1.65 + charge * 0.7);
    energy += surge * (filaments * 0.42 + hotCenter * 0.28);
    energy += hotCenter * impactFlash * 1.45;
    energy += burstBand * burstEnvelope * 1.7;
    energy += filaments * burstEnvelope * 0.44;

    // Keep clear space between structures. Brightness now comes from local
    // filament/center intensity instead of a nearly opaque sphere-wide floor.
    float alpha = opacity * (
      0.026 +
      centerMass * mix(0.08, 0.13, charge) +
      filaments * mix(0.32, 0.44, charge) +
      junctions * 0.16 +
      hotCenter * 0.58 +
      hotCenter * impactFlash * 0.16 +
      burstBand * burstEnvelope * 0.18
    );
    alpha *= 1.0 - burstProgress * 0.32;
    gl_FragColor = vec4(color * energy, clamp(alpha, 0.0, 1.0));
  }
`;

const LIGHT_ORB_SHELL_FRAGMENT_SHADER = `
  precision highp float;

  varying vec3 vLocalDirection;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  uniform vec3 cameraPosition;
  uniform float time;
  uniform float charge;
  uniform float motionBoost;
  uniform float opacity;
  uniform float burstProgress;
  uniform float burstStrength;
  uniform float haloStrength;

  void main(void) {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float facing = abs(dot(normalize(vWorldNormal), viewDirection));
    float fresnel = pow(1.0 - facing, 3.2);
    float t = time * mix(0.48, 1.12, charge) * motionBoost;
    vec3 p = normalize(vLocalDirection);

    float broadFlow = sin(p.x * 5.2 + p.y * 3.7 - p.z * 4.4 + t);
    broadFlow += sin(p.y * 8.1 - p.x * 2.8 + t * 0.63) * 0.5;
    float irregularity = 0.78 + broadFlow * 0.085;
    float traceWave = abs(sin(
      p.x * 7.4 - p.z * 5.8 + sin(p.y * 6.3 + t) * 1.15 - t * 0.72
    ));
    float outerTrace = 1.0 - smoothstep(0.07, 0.19, traceWave);

    float fullCharge = smoothstep(0.78, 1.0, charge);
    float surge = fullCharge * (0.5 + 0.5 * sin(t * 5.7));
    float shell = fresnel * (0.56 + charge * 0.2);
    shell += outerTrace * fresnel * (0.13 + charge * 0.13);
    shell += surge * fresnel * 0.08;
    shell *= irregularity;

    // The held-orb halo reuses this same aura mesh. Its broader Fresnel makes
    // a soft external corona, while pulse and shimmer keep it organic rather
    // than reading as a flat HUD ring.
    float haloFresnel = pow(1.0 - facing, 1.55);
    float haloPulse = 0.5 + 0.5 * sin(t * (3.2 + charge * 1.8) + broadFlow * 0.72);
    float haloShimmer = 0.5 + 0.5 * sin(
      p.x * 8.7 + p.y * 6.2 - p.z * 7.5 - t * 1.28
    );
    float corona = haloFresnel * haloStrength * (
      0.1 +
      haloPulse * (0.08 + charge * 0.06) +
      haloShimmer * 0.04 +
      surge * 0.05
    );

    // During impact the same membrane becomes a clean, expanding shock shell.
    float shock = sin(burstProgress * 3.14159265) * burstStrength;
    shell += fresnel * shock * 0.72;
    shell += outerTrace * fresnel * shock * 0.16;

    vec3 paleCyan = vec3(0.68, 0.88, 1.0);
    vec3 sacredWhite = vec3(1.0, 0.99, 0.96);
    vec3 color = mix(paleCyan, sacredWhite, 0.68 + facing * 0.22);
    float alpha = opacity * (0.008 + shell + corona);
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(
      color * (0.82 + shell * 1.38 + corona * 1.12),
      clamp(alpha, 0.0, 0.82)
    );
  }
`;

type AttackSystemOptions = {
  canvas: HTMLCanvasElement;
  desktopInputEnabled: boolean;
  stats: PlayerStatsSystem;
  getLightSourcePositions: () => readonly Vector3[];
  getGroundHeight: (x: number, z: number) => number;
  isBlocked: (x: number, z: number) => boolean;
};

type AttackDom = {
  root: HTMLElement | null;
  ammo: HTMLElement | null;
  status: HTMLElement | null;
  artworks: HTMLObjectElement[];
};

type AttackHudArtwork = {
  spheres: SVGGElement[];
  representativeOrb: SVGGElement | null;
  count: SVGTextElement | null;
  status: SVGTextElement | null;
  progress: SVGRectElement | null;
  progressMaxWidth: number;
  progressMaxHeight: number;
  progressBaseline: number;
  progressGlint: SVGPathElement | null;
};

type AimSolution = {
  origin: Vector3;
  aimPoint: Vector3;
  direction: Vector3;
  speed: number;
  target: EnemyController | null;
  power: number;
};

type HeldLightOrb = {
  root: TransformNode;
  core: Mesh;
  aura: Mesh;
  coreMaterial: ShaderMaterial;
  auraMaterial: ShaderMaterial;
};

type LightProjectile = {
  root: TransformNode;
  core: Mesh;
  aura: Mesh;
  coreMaterial: ShaderMaterial;
  auraMaterial: ShaderMaterial;
  velocity: Vector3;
  age: number;
  power: number;
};

type ImpactBurst = {
  root: TransformNode;
  inner: Mesh;
  outer: Mesh;
  innerMaterial: ShaderMaterial;
  outerMaterial: ShaderMaterial;
  elapsed: number;
  strength: number;
};

type EnemySegmentHit = {
  enemy: EnemyController;
  point: Vector3;
  fraction: number;
};

type WorldSegmentHit = {
  point: Vector3;
  fraction: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export class PlayerAttackSystem {
  private readonly dom: AttackDom;
  private readonly trajectory: LinesMesh;
  private readonly trajectoryEnd: Mesh;
  private readonly trajectoryEndMaterial: StandardMaterial;
  private readonly heldOrb: HeldLightOrb;
  private readonly lightRechargeVfx: PlayerLightRechargeVFX;
  private readonly abortController = new AbortController();
  private readonly hudArtworks = new Map<HTMLObjectElement, AttackHudArtwork>();
  private readonly projectiles: LightProjectile[] = [];
  private readonly impactBursts: ImpactBurst[] = [];
  private unsubscribeStats: (() => void) | null = null;
  private charging = false;
  private chargeElapsed = 0;
  private heldOrbElapsed = 0;
  private heldOrbPower = 0.18;
  private projectilePending = false;
  private rechargeProgress = 0;
  private rechargeSourcePosition: Vector3 | null = null;
  private rechargeCompletedThisFrame = false;
  private timeSinceShot = Number.POSITIVE_INFINITY;
  private desktopOrbMode = false;
  private desktopChargeMouseActive = false;
  private message = "";
  private messageTimer = 0;
  private renderedAmmo = -1;
  private disposed = false;

  public constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    private readonly enemyManager: EnemyManager,
    private readonly options: AttackSystemOptions
  ) {
    this.dom = {
      root: document.getElementById("attackHud"),
      ammo: document.getElementById("attackAmmo"),
      status: document.getElementById("attackStatus"),
      artworks: Array.from(document.querySelectorAll<HTMLObjectElement>(".attack-hud-art")),
    };
    this.message = this.getIdleMessage();

    const trajectoryPoints = Array.from(
      { length: TRAJECTORY_POINT_COUNT },
      () => Vector3.Zero()
    );
    this.trajectory = MeshBuilder.CreateDashedLines(
      "playerAttackTrajectory",
      {
        points: trajectoryPoints,
        dashNb: 26,
        dashSize: 2.4,
        gapSize: 1.35,
        updatable: true,
      },
      scene
    );
    this.trajectory.color = new Color3(0.56, 0.86, 1);
    this.trajectory.alpha = 0.72;
    this.trajectory.isPickable = false;
    this.trajectory.alwaysSelectAsActiveMesh = true;
    this.trajectory.renderingGroupId = 2;
    this.trajectory.setEnabled(false);

    this.trajectoryEndMaterial = this.createLightMaterial(
      "playerAttackTrajectoryEndMaterial",
      new Color3(0.4, 0.82, 1),
      0.58
    );
    this.trajectoryEnd = MeshBuilder.CreateSphere(
      "playerAttackTrajectoryEnd",
      { diameter: 0.36, segments: 10 },
      scene
    );
    this.trajectoryEnd.material = this.trajectoryEndMaterial;
    this.trajectoryEnd.isPickable = false;
    this.trajectoryEnd.alwaysSelectAsActiveMesh = true;
    this.trajectoryEnd.renderingGroupId = 2;
    this.trajectoryEnd.setEnabled(false);
    this.heldOrb = this.createHeldLightOrb();
    this.lightRechargeVfx = new PlayerLightRechargeVFX(scene, {
      getGroundPositionToRef: (result) => player.getGroundContactPositionToRef(result),
      getGroundSurfaceHeightAt: options.getGroundHeight,
    });

    const signal = this.abortController.signal;
    if (options.desktopInputEnabled) {
      // Mouse events are intentional here: unlike pointerdown, mousedown also
      // fires for the second button in a right + left button chord.
      options.canvas.addEventListener("mousedown", this.onDesktopMouseDown, {
        capture: true,
        signal,
      });
      options.canvas.addEventListener("contextmenu", this.onDesktopContextMenu, {
        signal,
      });
      window.addEventListener("mouseup", this.onDesktopMouseUp, { signal });
    }
    window.addEventListener("blur", this.cancelCharge, { signal });
    document.addEventListener("pointerlockchange", this.onPointerLockChange, { signal });
    window.addEventListener("bosque:pause", this.onPause, { signal });
    for (const artwork of this.dom.artworks) {
      artwork.addEventListener("load", () => this.bindHudArtwork(artwork), { signal });
      this.bindHudArtwork(artwork);
    }
    this.unsubscribeStats = options.stats.onChange(() => {
      this.renderedAmmo = -1;
      this.renderHud();
    });
    scene.onDisposeObservable.addOnce(() => this.dispose());
    this.renderHud();
  }

  public startCharging = (mobile = false) => {
    if (this.disposed || this.charging) return false;
    if (!mobile && (!this.options.desktopInputEnabled || !this.desktopOrbMode)) return false;
    if (this.ammo <= 0) {
      this.showMessage("Sin luz: acercate a una llama", 1.8);
      return false;
    }
    if (!this.player.beginChargedThrow()) {
      this.showMessage("Espera a terminar la accion actual", 0.9);
      return false;
    }
    this.options.stats.cancelLightAbsorption("attack");

    this.charging = true;
    this.chargeElapsed = 0;
    this.heldOrbElapsed = 0;
    this.heldOrbPower = this.getChargePower();
    this.projectilePending = false;
    this.rechargeProgress = 0;
    this.heldOrb.root.setEnabled(true);
    this.updateHeldOrb(0);
    document.body.classList.add("attack-aiming");
    this.dom.root?.classList.add("charging");
    this.showMessage("Apuntando...", 0);
    this.renderHud();
    return true;
  };

  public releaseCharge = () => {
    if (!this.charging || this.disposed) return false;

    const charge = this.getChargePower();
    const speed = MIN_LAUNCH_SPEED + (MAX_LAUNCH_SPEED - MIN_LAUNCH_SPEED) * charge;
    const aim = this.createAimSolution(speed, charge);
    this.heldOrbPower = charge;
    this.projectilePending = true;
    const accepted = this.player.releaseChargedThrow(() => {
      this.projectilePending = false;
      this.heldOrb.root.setEnabled(false);
      this.spawnProjectile(aim);
    });
    if (!accepted) {
      this.projectilePending = false;
      this.cancelCharge();
      return false;
    }
    if (!this.consumeAmmo()) {
      this.projectilePending = false;
      this.cancelCharge();
      return false;
    }

    this.charging = false;
    this.chargeElapsed = 0;
    this.timeSinceShot = 0;
    this.hideTrajectory();
    document.body.classList.remove("attack-aiming");
    this.dom.root?.classList.remove("charging");
    this.showMessage(aim.target ? "Objetivo fijado" : "Esfera lanzada", 0.75);
    this.renderHud();
    return true;
  };

  public cancelCharge = () => {
    const hadDesktopOrbMode = this.desktopOrbMode;
    this.desktopOrbMode = false;
    this.desktopChargeMouseActive = false;
    document.body.classList.remove("desktop-orb-mode");
    this.dom.root?.classList.remove("orb-mode");
    if (!this.charging) {
      if (hadDesktopOrbMode) {
        this.showMessage(this.getIdleMessage(), 0);
        this.renderHud();
      }
      return;
    }
    this.charging = false;
    this.chargeElapsed = 0;
    this.player.cancelChargedThrow();
    this.projectilePending = false;
    this.heldOrb.root.setEnabled(false);
    this.hideTrajectory();
    document.body.classList.remove("attack-aiming");
    this.dom.root?.classList.remove("charging");
    this.showMessage(this.getIdleMessage(), 0);
    this.renderHud();
  };

  public update(deltaTimeSeconds: number) {
    if (this.disposed) return;
    const delta = Math.max(0, Math.min(deltaTimeSeconds, 0.05));
    this.timeSinceShot += delta;
    if (this.messageTimer > 0) {
      this.messageTimer = Math.max(0, this.messageTimer - delta);
      if (this.messageTimer === 0) this.message = this.getIdleMessage();
    }

    if (this.charging || this.projectilePending) {
      this.updateHeldOrb(delta);
    }
    if (this.charging) {
      this.chargeElapsed = Math.min(MAX_CHARGE_SECONDS, this.chargeElapsed + delta);
      this.updateTrajectory();
    }
    this.updateProjectiles(delta);
    this.updateImpactBursts(delta);
    const recharging = this.updateRecharge(delta);
    this.lightRechargeVfx.update(delta, {
      active: recharging,
      progress: this.rechargeProgress / RECHARGE_SECONDS_PER_ORB,
      sourcePosition: this.rechargeSourcePosition,
      completed: this.rechargeCompletedThisFrame,
    });
    this.renderHud();
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelCharge();
    this.abortController.abort();
    this.unsubscribeStats?.();
    this.unsubscribeStats = null;
    for (const projectile of this.projectiles) this.disposeProjectile(projectile);
    this.projectiles.length = 0;
    for (const burst of this.impactBursts) this.disposeImpactBurst(burst);
    this.impactBursts.length = 0;
    this.trajectory.dispose(false, false);
    this.trajectoryEnd.dispose(false, false);
    this.trajectoryEndMaterial.dispose();
    this.heldOrb.root.dispose(false, false);
    this.heldOrb.coreMaterial.dispose();
    this.heldOrb.auraMaterial.dispose();
    this.lightRechargeVfx.dispose();
  }

  private readonly onDesktopMouseDown = (event: MouseEvent) => {
    if (event.button === 2) {
      event.preventDefault();
      if (this.desktopOrbMode) return;

      // Pointer lock is useful for aiming, but it must not be a prerequisite
      // for entering orb mode because browsers grant it asynchronously.
      if (document.pointerLockElement !== this.options.canvas) {
        this.options.canvas.requestPointerLock?.().catch(() => {
          // Orb mode still works; only relative mouse aiming remains unavailable.
        });
      }

      this.desktopOrbMode = true;
      document.body.classList.add("desktop-orb-mode");
      this.dom.root?.classList.add("orb-mode");
      this.showMessage(
        this.ammo > 0 ? this.getIdleMessage() : "Sin luz: acercate a una llama",
        0
      );
      this.renderHud();
      return;
    }

    if (event.button !== 0 || !this.desktopOrbMode || this.desktopChargeMouseActive) return;
    event.preventDefault();
    if (!this.startCharging(false)) return;
    this.desktopChargeMouseActive = true;
  };

  private readonly onDesktopMouseUp = (event: MouseEvent) => {
    if (event.button === 2) {
      if (!this.desktopOrbMode) return;
      event.preventDefault();
      this.cancelCharge();
      return;
    }
    if (event.button !== 0 || !this.desktopChargeMouseActive) return;
    this.desktopChargeMouseActive = false;
    this.releaseCharge();
  };

  private readonly onDesktopContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private readonly onPointerLockChange = () => {
    if (document.pointerLockElement !== this.options.canvas) this.cancelCharge();
  };

  private readonly onPause = (event: Event) => {
    if ((event as CustomEvent<{ paused?: boolean }>).detail?.paused) this.cancelCharge();
  };

  private getIdleMessage() {
    if (!this.options.desktopInputEnabled) return "Mantene L para apuntar";
    return this.desktopOrbMode
      ? "Mantene clic para cargar"
      : "Clic derecho: modo orbe";
  }

  private getChargePower() {
    return 0.18 + smoothstep01(this.chargeElapsed / MAX_CHARGE_SECONDS) * 0.82;
  }

  private createAimSolution(speed: number, power = this.getChargePower()): AimSolution {
    const look = this.player.getAttackAimRay();
    const origin = this.getThrowOrigin(look.direction);
    const target = this.findAimTarget(look.origin, look.direction);
    const aimPoint = look.origin.add(
      look.direction.scale(FREE_AIM_CONVERGENCE_DISTANCE)
    );
    let direction = aimPoint.subtract(origin);

    if (target) {
      target.getAttackTargetPositionToRef(aimPoint);
      direction = this.solveBallisticDirection(origin, aimPoint, speed) ?? direction;
    }
    if (direction.lengthSquared() <= 0.000001) direction.copyFromFloats(0, 0.05, 1);
    direction.normalize();
    return { origin, aimPoint, direction, speed, target, power };
  }

  private getThrowOrigin(lookDirection: Vector3) {
    if (this.player.currentViewMode === "first") {
      return this.player.camera.globalPosition
        .clone()
        .addInPlace(lookDirection.scale(0.62))
        .addInPlaceFromFloats(0, -0.1, 0);
    }

    const handPosition = Vector3.Zero();
    if (this.player.getThrowHandWorldPositionToRef(handPosition)) {
      return handPosition;
    }

    this.player.root.computeWorldMatrix(true);
    const world = this.player.root.getWorldMatrix();
    const forward = Vector3.TransformNormal(Vector3.Forward(), world).normalize();
    const right = Vector3.TransformNormal(new Vector3(1, 0, 0), world).normalize();
    return this.player.root
      .getAbsolutePosition()
      .add(forward.scale(0.9))
      .add(right.scale(0.42))
      .add(new Vector3(0, -0.22, 0));
  }

  private findAimTarget(origin: Vector3, direction: Vector3) {
    const normalizedDirection = direction.normalizeToNew();
    const minimumDot = Math.cos(AIM_ASSIST_ANGLE_RADIANS);
    const targetPosition = Vector3.Zero();
    let best: EnemyController | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const enemy of this.enemyManager.getAll()) {
      if (!enemy.enabled) continue;
      enemy.getAttackTargetPositionToRef(targetPosition);
      const toTarget = targetPosition.subtract(origin);
      const distance = toTarget.length();
      if (distance < 1 || distance > AIM_ASSIST_MAX_DISTANCE) continue;
      const dot = Vector3.Dot(toTarget.scale(1 / distance), normalizedDirection);
      if (dot < minimumDot) continue;
      const score = (1 - dot) * 100 + distance * 0.0025;
      if (score >= bestScore) continue;
      bestScore = score;
      best = enemy;
    }
    return best;
  }

  private solveBallisticDirection(origin: Vector3, target: Vector3, speed: number) {
    const delta = target.subtract(origin);
    const horizontal = new Vector3(delta.x, 0, delta.z);
    const horizontalDistance = horizontal.length();
    if (horizontalDistance < 0.001) return delta.normalize();

    const speedSquared = speed * speed;
    const discriminant =
      speedSquared * speedSquared -
      PROJECTILE_GRAVITY *
        (PROJECTILE_GRAVITY * horizontalDistance * horizontalDistance +
          2 * delta.y * speedSquared);
    if (discriminant < 0) return null;

    const tangent =
      (speedSquared - Math.sqrt(discriminant)) /
      (PROJECTILE_GRAVITY * horizontalDistance);
    const cosine = 1 / Math.sqrt(1 + tangent * tangent);
    const sine = tangent * cosine;
    return horizontal.normalize().scale(cosine).add(Vector3.Up().scale(sine));
  }

  private updateTrajectory() {
    const charge = this.getChargePower();
    const speed = MIN_LAUNCH_SPEED + (MAX_LAUNCH_SPEED - MIN_LAUNCH_SPEED) * charge;
    const aim = this.createAimSolution(speed);
    const points = this.predictTrajectory(aim);
    const finalPoint = points[points.length - 1];

    MeshBuilder.CreateDashedLines(
      "playerAttackTrajectory",
      { points, dashNb: 26, dashSize: 2.4, gapSize: 1.35, instance: this.trajectory },
      this.scene
    );
    this.trajectory.color.copyFrom(
      aim.target ? TRAJECTORY_TARGET_COLOR : TRAJECTORY_FREE_COLOR
    );
    this.trajectory.alpha = 0.7 + charge * 0.28;
    this.trajectory.setEnabled(true);
    this.trajectoryEnd.position.copyFrom(finalPoint);
    this.trajectoryEnd.scaling.setAll(0.9 + charge * 0.7);
    this.trajectoryEndMaterial.alpha = 0.68 + charge * 0.3;
    this.trajectoryEnd.setEnabled(true);
    this.message = aim.target ? `Objetivo: ${aim.target.type}` : "Trayectoria libre";
  }

  private predictTrajectory(aim: AimSolution) {
    const points: Vector3[] = [aim.origin.clone()];
    const velocity = aim.direction.scale(aim.speed);
    let position = aim.origin.clone();
    let ended = false;

    for (let index = 1; index < TRAJECTORY_POINT_COUNT; index++) {
      if (!ended) {
        const previous = position;
        velocity.y -= PROJECTILE_GRAVITY * TRAJECTORY_STEP_SECONDS;
        position = position.add(velocity.scale(TRAJECTORY_STEP_SECONDS));
        const enemyHit = this.findEnemySegmentHit(previous, position);
        const worldHit = this.findWorldSegmentHit(previous, position);
        if (enemyHit && (!worldHit || enemyHit.fraction <= worldHit.fraction)) {
          position = enemyHit.point;
          ended = true;
        } else if (worldHit) {
          position = worldHit.point;
          ended = true;
        }
      }
      points.push(position.clone());
    }
    return points;
  }

  private hideTrajectory() {
    this.trajectory.setEnabled(false);
    this.trajectoryEnd.setEnabled(false);
  }

  private spawnProjectile(aim: AimSolution) {
    if (this.disposed) return;
    const launchOrigin = this.getThrowOrigin(aim.direction);
    let launchDirection = aim.aimPoint.subtract(launchOrigin);
    if (aim.target?.enabled) {
      const liveTargetPosition = Vector3.Zero();
      aim.target.getAttackTargetPositionToRef(liveTargetPosition);
      launchDirection =
        this.solveBallisticDirection(launchOrigin, liveTargetPosition, aim.speed) ??
        launchDirection;
    }
    if (launchDirection.lengthSquared() <= 0.000001) {
      launchDirection.copyFrom(aim.direction);
    }
    launchDirection.normalize();

    const root = new TransformNode(`lightProjectile:${performance.now()}`, this.scene);
    root.position.copyFrom(launchOrigin);

    const coreMaterial = this.createOrbCoreMaterial(`${root.name}:coreMaterial`, {
      charge: aim.power,
      motionBoost: 1.24,
      opacity: 0.58 + aim.power * 0.09,
    });
    const auraMaterial = this.createOrbShellMaterial(`${root.name}:auraMaterial`, {
      charge: aim.power,
      motionBoost: 1.28,
      opacity: 0.42 + aim.power * 0.18,
    });

    const core = MeshBuilder.CreateSphere(
      `${root.name}:core`,
      { diameter: PROJECTILE_CORE_DIAMETER, segments: 12 },
      this.scene
    );
    core.parent = root;
    core.material = coreMaterial;
    core.isPickable = false;
    core.applyFog = false;
    core.alwaysSelectAsActiveMesh = true;
    core.renderingGroupId = LIGHT_ORB_RENDERING_GROUP;
    core.alphaIndex = 0;

    const aura = MeshBuilder.CreateSphere(
      `${root.name}:aura`,
      { diameter: PROJECTILE_SHELL_DIAMETER, segments: 12 },
      this.scene
    );
    aura.parent = root;
    aura.material = auraMaterial;
    aura.isPickable = false;
    aura.applyFog = false;
    aura.alwaysSelectAsActiveMesh = true;
    aura.renderingGroupId = LIGHT_ORB_RENDERING_GROUP;
    aura.alphaIndex = 1;

    this.projectiles.push({
      root,
      core,
      aura,
      coreMaterial,
      auraMaterial,
      velocity: launchDirection.scale(aim.speed),
      age: 0,
      power: aim.power,
    });
    window.dispatchEvent(
      new CustomEvent("bosque:light-orb-thrown", {
        detail: { power: aim.power, targetId: aim.target?.id ?? null },
      })
    );
  }

  private updateProjectiles(delta: number) {
    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      const projectile = this.projectiles[index];
      projectile.age += delta;
      const previous = projectile.root.position.clone();
      projectile.velocity.y -= PROJECTILE_GRAVITY * delta;
      const next = previous.add(projectile.velocity.scale(delta));
      const enemyHit = this.findEnemySegmentHit(previous, next);
      const worldHit = this.findWorldSegmentHit(previous, next);

      if (enemyHit && (!worldHit || enemyHit.fraction <= worldHit.fraction)) {
        const direction = projectile.velocity.normalizeToNew();
        enemyHit.enemy.receiveAttack({
          // Durability is measured in whole light orbs, independent of sanity.
          damage: PROJECTILE_DAMAGE,
          point: enemyHit.point,
          direction,
        });
        this.createImpactBurst(enemyHit.point, true);
        this.disposeProjectile(projectile);
        this.projectiles.splice(index, 1);
        continue;
      }

      if (worldHit || projectile.age >= PROJECTILE_LIFETIME_SECONDS) {
        if (worldHit) this.createImpactBurst(worldHit.point, false);
        this.disposeProjectile(projectile);
        this.projectiles.splice(index, 1);
        continue;
      }

      projectile.root.position.copyFrom(next);
      projectile.root.rotation.y += delta * 8;
      projectile.coreMaterial.setFloat("time", projectile.age);
      projectile.auraMaterial.setFloat("time", projectile.age);
      const pulse = 1 + Math.sin(projectile.age * 17) * 0.035;
      projectile.aura.scaling.setAll(pulse);
      projectile.auraMaterial.setFloat(
        "opacity",
        0.34 + projectile.power * 0.14 + Math.sin(projectile.age * 13) * 0.035
      );
    }
  }

  private findEnemySegmentHit(from: Vector3, to: Vector3): EnemySegmentHit | null {
    const segment = to.subtract(from);
    const lengthSquared = segment.lengthSquared();
    let best: EnemySegmentHit | null = null;

    for (const enemy of this.enemyManager.getAll()) {
      if (!enemy.enabled) continue;
      for (const mesh of enemy.getAttackHitMeshes()) {
        if (!mesh.isEnabled() || mesh.getTotalVertices() <= 0) continue;
        mesh.computeWorldMatrix(true);
        const sphere = mesh.getBoundingInfo().boundingSphere;
        const toCenter = sphere.centerWorld.subtract(from);
        const fraction =
          lengthSquared > 0
            ? clamp01(Vector3.Dot(toCenter, segment) / lengthSquared)
            : 0;
        if (best && fraction >= best.fraction) continue;
        const closest = from.add(segment.scale(fraction));
        const collisionRadius = sphere.radiusWorld + PROJECTILE_RADIUS;
        if (Vector3.DistanceSquared(closest, sphere.centerWorld) > collisionRadius ** 2) {
          continue;
        }
        best = { enemy, point: closest, fraction };
      }
    }
    return best;
  }

  private findWorldSegmentHit(from: Vector3, to: Vector3): WorldSegmentHit | null {
    const segmentLength = Vector3.Distance(from, to);
    const steps = Math.max(1, Math.ceil(segmentLength / 0.35));
    for (let step = 1; step <= steps; step++) {
      const fraction = step / steps;
      const point = Vector3.Lerp(from, to, fraction);
      const groundHeight = this.options.getGroundHeight(point.x, point.z);
      const hitGround = point.y <= groundHeight + PROJECTILE_RADIUS;
      if (!hitGround && !this.options.isBlocked(point.x, point.z)) continue;
      if (hitGround) point.y = groundHeight + PROJECTILE_RADIUS;
      return { point, fraction };
    }
    return null;
  }

  private createImpactBurst(position: Vector3, hitEnemy: boolean) {
    const root = new TransformNode(`lightImpact:${performance.now()}`, this.scene);
    root.position.copyFrom(position);
    const strength = hitEnemy ? 1 : 0.78;
    const impactCharge = hitEnemy ? 1 : 0.82;
    const innerMaterial = this.createOrbCoreMaterial(`${root.name}:innerMaterial`, {
      charge: impactCharge,
      motionBoost: 2.35,
      opacity: 0.94,
      burstStrength: strength,
    });
    const outerMaterial = this.createOrbShellMaterial(`${root.name}:outerMaterial`, {
      charge: impactCharge,
      motionBoost: 1.9,
      opacity: 0.72,
      burstStrength: strength,
    });
    const inner = MeshBuilder.CreateSphere(
      `${root.name}:inner`,
      { diameter: 0.32, segments: 12 },
      this.scene
    );
    const outer = MeshBuilder.CreateSphere(
      `${root.name}:outer`,
      { diameter: 0.44, segments: 12 },
      this.scene
    );
    inner.parent = root;
    outer.parent = root;
    inner.material = innerMaterial;
    outer.material = outerMaterial;
    inner.isPickable = false;
    outer.isPickable = false;
    inner.applyFog = false;
    outer.applyFog = false;
    inner.renderingGroupId = LIGHT_ORB_RENDERING_GROUP;
    outer.renderingGroupId = LIGHT_ORB_RENDERING_GROUP;
    inner.alphaIndex = 0;
    outer.alphaIndex = 1;
    this.impactBursts.push({
      root,
      inner,
      outer,
      innerMaterial,
      outerMaterial,
      elapsed: 0,
      strength,
    });
  }

  private updateImpactBursts(delta: number) {
    for (let index = this.impactBursts.length - 1; index >= 0; index--) {
      const burst = this.impactBursts[index];
      burst.elapsed += delta;
      const progress = clamp01(burst.elapsed / IMPACT_DURATION_SECONDS);
      const remaining = 1 - progress;
      const expansion = 1 - Math.pow(remaining, 2.4);
      const shockEnvelope = Math.sin(progress * Math.PI) * Math.pow(remaining, 0.58);
      burst.root.rotation.y += delta * (7 + burst.strength * 4);
      burst.root.rotation.x -= delta * (2.5 + burst.strength * 1.5);
      burst.inner.scaling.setAll(
        0.56 + expansion * (1.45 + burst.strength * 0.35)
      );
      burst.outer.scaling.setAll(
        0.5 + expansion * (2.8 + burst.strength * 0.55)
      );
      burst.innerMaterial.setFloat("time", burst.elapsed);
      burst.innerMaterial.setFloat("burstProgress", progress);
      burst.innerMaterial.setFloat(
        "opacity",
        Math.pow(remaining, 2.05) * (0.72 + burst.strength * 0.28)
      );
      burst.outerMaterial.setFloat("time", burst.elapsed);
      burst.outerMaterial.setFloat("burstProgress", progress);
      burst.outerMaterial.setFloat(
        "opacity",
        shockEnvelope * (0.46 + burst.strength * 0.26)
      );
      if (progress < 1) continue;
      this.disposeImpactBurst(burst);
      this.impactBursts.splice(index, 1);
    }
  }

  private updateRecharge(delta: number) {
    this.rechargeSourcePosition = null;
    this.rechargeCompletedThisFrame = false;
    if (
      this.charging ||
      this.ammo >= this.options.stats.maxLightOrbs ||
      this.timeSinceShot < RECHARGE_DELAY_AFTER_SHOT
    ) {
      if (this.ammo >= this.options.stats.maxLightOrbs) this.rechargeProgress = 0;
      return false;
    }

    const playerPosition = this.player.position;
    const radiusSquared = RECHARGE_RADIUS * RECHARGE_RADIUS;
    const nearLight = this.options.getLightSourcePositions().some((position) => {
      const dx = position.x - playerPosition.x;
      const dz = position.z - playerPosition.z;
      const inRange =
        dx * dx + dz * dz <= radiusSquared &&
        Math.abs(position.y - playerPosition.y) < 5;
      if (inRange) this.rechargeSourcePosition = position;
      return inRange;
    });

    if (!nearLight) {
      this.rechargeProgress = Math.max(0, this.rechargeProgress - delta * 1.4);
      if (this.messageTimer <= 0) this.message = "Mantene clic para apuntar";
      return false;
    }

    this.rechargeProgress += delta;
    if (this.messageTimer <= 0) this.message = "Absorbiendo luz...";
    if (this.rechargeProgress < RECHARGE_SECONDS_PER_ORB) return true;
    this.rechargeProgress -= RECHARGE_SECONDS_PER_ORB;
    this.options.stats.addLightOrbs(1, "light-recharge");
    this.rechargeCompletedThisFrame = true;
    this.showMessage(
      this.ammo >= this.options.stats.maxLightOrbs
        ? "Luz completa"
        : "+1 esfera de luz",
      0.8
    );
    return true;
  }

  private consumeAmmo() {
    return this.options.stats.consumeLightOrb("light-orb-attack");
  }

  private showMessage(message: string, durationSeconds: number) {
    this.message = message;
    this.messageTimer = Math.max(0, durationSeconds);
  }

  private renderHud() {
    if (this.dom.ammo) {
      this.dom.ammo.textContent = `${this.ammo} de ${this.options.stats.maxLightOrbs} esferas de luz.`;
    }
    if (this.dom.status) {
      this.dom.status.textContent = this.message;
    }
    if (this.renderedAmmo !== this.ammo) {
      for (const artwork of this.hudArtworks.values()) {
        this.renderHudArtworkAmmo(artwork);
      }
      this.renderedAmmo = this.ammo;
    }
    const power = this.charging
      ? this.getChargePower()
      : clamp01(this.rechargeProgress / RECHARGE_SECONDS_PER_ORB);
    for (const artwork of this.hudArtworks.values()) {
      if (artwork.status) artwork.status.textContent = this.message.toLocaleUpperCase("es-AR");
      if (artwork.progress) {
        if (artwork.progressMaxHeight > 0) {
          const height = artwork.progressMaxHeight * power;
          const y = artwork.progressBaseline - height;
          artwork.progress.setAttribute("height", height.toFixed(2));
          artwork.progress.setAttribute("y", y.toFixed(2));
          if (artwork.progressGlint) {
            artwork.progressGlint.setAttribute("d", `M175 ${(y + 0.5).toFixed(2)}H185`);
            artwork.progressGlint.style.opacity = power > 0 ? ".82" : "0";
          }
        } else {
          artwork.progress.setAttribute("width", (artwork.progressMaxWidth * power).toFixed(2));
        }
      }
    }
    this.dom.root?.classList.toggle(
      "recharging",
      !this.charging &&
        this.rechargeProgress > 0 &&
        this.ammo < this.options.stats.maxLightOrbs
    );
    this.dom.root?.classList.toggle("empty", this.ammo <= 0);
    this.dom.root?.classList.toggle(
      "depleted",
      this.ammo <= 0 && this.rechargeProgress <= 0
    );
  }

  private bindHudArtwork(element: HTMLObjectElement) {
    const svg = element.contentDocument;
    if (!svg?.documentElement) return;
    const progress = svg.querySelector<SVGRectElement>("#charge-fill, #recharge-fill");
    const artwork: AttackHudArtwork = {
      spheres: Array.from(svg.querySelectorAll<SVGGElement>(".sphere")),
      representativeOrb: svg.querySelector<SVGGElement>("#orb-indicator"),
      count: svg.querySelector<SVGTextElement>("#label-count, #ammo-count"),
      status: svg.querySelector<SVGTextElement>("#label-help"),
      progress,
      progressMaxWidth: Number(progress?.dataset.maxWidth ?? 0),
      progressMaxHeight: Number(progress?.dataset.maxHeight ?? 0),
      progressBaseline: Number(progress?.dataset.baseline ?? 0),
      progressGlint: svg.querySelector<SVGPathElement>("#recharge-glint"),
    };
    this.hudArtworks.set(element, artwork);
    this.renderHudArtworkAmmo(artwork);
  }

  private renderHudArtworkAmmo(artwork: AttackHudArtwork) {
    artwork.spheres.forEach((sphere, index) => {
      const filled = index < this.ammo;
      sphere.classList.toggle("active", filled);
      sphere.classList.toggle("depleted", !filled);
    });
    artwork.representativeOrb?.classList.toggle("unavailable", this.ammo <= 0);
    if (artwork.count) {
      artwork.count.textContent = artwork.representativeOrb
        ? String(this.ammo).padStart(2, "0")
        : `${this.ammo} / ${this.options.stats.maxLightOrbs}`;
    }
  }

  private get ammo() {
    return this.options.stats.lightOrbs;
  }

  private createHeldLightOrb(): HeldLightOrb {
    const root = new TransformNode("playerHeldLightOrb", this.scene);
    const coreMaterial = this.createOrbCoreMaterial("playerHeldLightOrb:coreMaterial", {
      charge: this.heldOrbPower,
      opacity: 0.9,
    });
    const auraMaterial = this.createOrbShellMaterial("playerHeldLightOrb:auraMaterial", {
      charge: this.heldOrbPower,
      opacity: 0.4,
    });

    const core = MeshBuilder.CreateSphere(
      "playerHeldLightOrb:core",
      { diameter: HELD_CORE_DIAMETER, segments: 12 },
      this.scene
    );
    const aura = MeshBuilder.CreateSphere(
      "playerHeldLightOrb:aura",
      { diameter: HELD_SHELL_DIAMETER, segments: 12 },
      this.scene
    );
    core.parent = root;
    aura.parent = root;
    core.material = coreMaterial;
    aura.material = auraMaterial;
    core.isPickable = false;
    aura.isPickable = false;
    core.applyFog = false;
    aura.applyFog = false;
    core.alwaysSelectAsActiveMesh = true;
    aura.alwaysSelectAsActiveMesh = true;
    core.renderingGroupId = LIGHT_ORB_RENDERING_GROUP;
    aura.renderingGroupId = LIGHT_ORB_RENDERING_GROUP;
    core.alphaIndex = 0;
    aura.alphaIndex = 1;
    root.setEnabled(false);
    return { root, core, aura, coreMaterial, auraMaterial };
  }

  private updateHeldOrb(delta: number) {
    this.heldOrbElapsed += delta;
    const look = this.player.getAttackAimRay();
    this.heldOrb.root.position.copyFrom(this.getThrowOrigin(look.direction));
    this.heldOrb.root.setEnabled(true);

    const power = this.charging ? this.getChargePower() : this.heldOrbPower;
    const pulsePhase = Math.sin(this.heldOrbElapsed * (6.8 + power * 3.8));
    const pulse = pulsePhase * (0.008 + power * 0.02);
    const haloStrength =
      0.08 + power * 0.62 + Math.max(0, pulsePhase) * (0.04 + power * 0.08);
    this.heldOrb.core.scaling.setAll(0.88 + power * 0.12);
    this.heldOrb.aura.scaling.setAll(0.88 + power * 0.24 + pulse);
    this.heldOrb.coreMaterial.setFloat("time", this.heldOrbElapsed);
    this.heldOrb.coreMaterial.setFloat("charge", power);
    this.heldOrb.coreMaterial.setFloat("opacity", 0.52 + power * 0.12);
    this.heldOrb.auraMaterial.setFloat("time", this.heldOrbElapsed);
    this.heldOrb.auraMaterial.setFloat("charge", power);
    this.heldOrb.auraMaterial.setFloat("haloStrength", haloStrength);
    this.heldOrb.auraMaterial.setFloat(
      "opacity",
      0.25 + power * 0.17 + pulse * 0.48
    );
  }

  private createOrbCoreMaterial(
    name: string,
    options: {
      charge?: number;
      motionBoost?: number;
      opacity?: number;
      burstProgress?: number;
      burstStrength?: number;
    } = {}
  ) {
    const material = new ShaderMaterial(
      name,
      this.scene,
      {
        vertexSource: LIGHT_ORB_VERTEX_SHADER,
        fragmentSource: LIGHT_ORB_CORE_FRAGMENT_SHADER,
      },
      {
        attributes: ["position", "normal"],
        uniforms: [
          "world",
          "worldViewProjection",
          "cameraPosition",
          "time",
          "charge",
          "motionBoost",
          "opacity",
          "burstProgress",
          "burstStrength",
        ],
        needAlphaBlending: true,
      }
    );
    material.setFloat("time", 0);
    material.setFloat("charge", options.charge ?? 0.18);
    material.setFloat("motionBoost", options.motionBoost ?? 1);
    material.setFloat("opacity", options.opacity ?? 0.62);
    material.setFloat("burstProgress", options.burstProgress ?? 0);
    material.setFloat("burstStrength", options.burstStrength ?? 0);
    this.configureOrbShader(material);
    return material;
  }

  private createOrbShellMaterial(
    name: string,
    options: {
      charge?: number;
      motionBoost?: number;
      opacity?: number;
      burstProgress?: number;
      burstStrength?: number;
      haloStrength?: number;
    } = {}
  ) {
    const material = new ShaderMaterial(
      name,
      this.scene,
      {
        vertexSource: LIGHT_ORB_VERTEX_SHADER,
        fragmentSource: LIGHT_ORB_SHELL_FRAGMENT_SHADER,
      },
      {
        attributes: ["position", "normal"],
        uniforms: [
          "world",
          "worldViewProjection",
          "cameraPosition",
          "time",
          "charge",
          "motionBoost",
          "opacity",
          "burstProgress",
          "burstStrength",
          "haloStrength",
        ],
        needAlphaBlending: true,
      }
    );
    material.setFloat("time", 0);
    material.setFloat("charge", options.charge ?? 0.18);
    material.setFloat("motionBoost", options.motionBoost ?? 1);
    material.setFloat("opacity", options.opacity ?? 0.42);
    material.setFloat("burstProgress", options.burstProgress ?? 0);
    material.setFloat("burstStrength", options.burstStrength ?? 0);
    material.setFloat("haloStrength", options.haloStrength ?? 0);
    this.configureOrbShader(material);
    return material;
  }

  private configureOrbShader(material: ShaderMaterial) {
    material.alphaMode = Engine.ALPHA_ADD;
    material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.needDepthPrePass = false;
  }

  private createLightMaterial(name: string, color: Color3, alpha: number) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor.copyFrom(color);
    material.emissiveColor.copyFrom(color);
    material.specularColor.setAll(0);
    material.alpha = alpha;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
    return material;
  }

  private disposeProjectile(projectile: LightProjectile) {
    projectile.root.dispose(false, false);
    projectile.coreMaterial.dispose();
    projectile.auraMaterial.dispose();
  }

  private disposeImpactBurst(burst: ImpactBurst) {
    burst.root.dispose(false, false);
    burst.innerMaterial.dispose();
    burst.outerMaterial.dispose();
  }
}
