import { Engine } from "@babylonjs/core/Engines/engine";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { InspectableItem } from "./ItemInspector";
import type { InventoryHandle } from "./Inventory";
import type { PlayerController } from "./PlayerController";
import type { EnemyController } from "./enemies/core/EnemyTypes";
import type { EnemyManager } from "./enemies/core/EnemyManager";

const LIGHT_ORB_ITEM: InspectableItem = {
  id: "light-orb-ammo",
  name: "Esfera de luz",
  typeLabel: "Municion",
  description:
    "Luz concentrada que puede arrojarse contra las criaturas del bosque. Se recupera cerca de velas y antorchas.",
};

const MAX_AMMO = 6;
const INITIAL_AMMO = 3;
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

type AttackSystemOptions = {
  canvas: HTMLCanvasElement;
  desktopInputEnabled: boolean;
  inventory?: InventoryHandle;
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
  coreMaterial: StandardMaterial;
  auraMaterial: StandardMaterial;
};

type LightProjectile = {
  root: TransformNode;
  core: Mesh;
  aura: Mesh;
  coreMaterial: StandardMaterial;
  auraMaterial: StandardMaterial;
  velocity: Vector3;
  age: number;
};

type ImpactBurst = {
  root: TransformNode;
  inner: Mesh;
  outer: Mesh;
  innerMaterial: StandardMaterial;
  outerMaterial: StandardMaterial;
  elapsed: number;
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
  private readonly abortController = new AbortController();
  private readonly hudArtworks = new Map<HTMLObjectElement, AttackHudArtwork>();
  private readonly projectiles: LightProjectile[] = [];
  private readonly impactBursts: ImpactBurst[] = [];
  private ammo: number;
  private charging = false;
  private chargeElapsed = 0;
  private heldOrbElapsed = 0;
  private heldOrbPower = 0.18;
  private projectilePending = false;
  private rechargeProgress = 0;
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
    this.ammo = options.inventory?.hasItem(LIGHT_ORB_ITEM.id)
      ? options.inventory.getItemCount(LIGHT_ORB_ITEM.id)
      : INITIAL_AMMO;
    this.ammo = Math.min(MAX_AMMO, this.ammo);
    this.syncInventory();
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
    this.refreshAmmoFromInventory();
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
    this.updateRecharge(delta);
    this.renderHud();
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelCharge();
    this.abortController.abort();
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

    const coreMaterial = this.createLightMaterial(
      `${root.name}:coreMaterial`,
      new Color3(0.82, 0.94, 1),
      1
    );
    const auraMaterial = this.createLightMaterial(
      `${root.name}:auraMaterial`,
      new Color3(0.3, 0.68, 1),
      0.2
    );
    auraMaterial.alphaMode = Engine.ALPHA_ADD;

    const core = MeshBuilder.CreateSphere(
      `${root.name}:core`,
      { diameter: PROJECTILE_RADIUS * 2, segments: 12 },
      this.scene
    );
    core.parent = root;
    core.material = coreMaterial;
    core.isPickable = false;
    core.applyFog = false;
    core.alwaysSelectAsActiveMesh = true;
    core.renderingGroupId = 2;

    const aura = MeshBuilder.CreateSphere(
      `${root.name}:aura`,
      { diameter: PROJECTILE_RADIUS * 4.2, segments: 10 },
      this.scene
    );
    aura.parent = root;
    aura.material = auraMaterial;
    aura.isPickable = false;
    aura.applyFog = false;
    aura.alwaysSelectAsActiveMesh = true;
    aura.renderingGroupId = 2;

    this.projectiles.push({
      root,
      core,
      aura,
      coreMaterial,
      auraMaterial,
      velocity: launchDirection.scale(aim.speed),
      age: 0,
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
      const pulse = 1 + Math.sin(projectile.age * 24) * 0.1;
      projectile.aura.scaling.setAll(pulse);
      projectile.auraMaterial.alpha = 0.16 + Math.sin(projectile.age * 18) * 0.045;
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
    const innerMaterial = this.createLightMaterial(
      `${root.name}:innerMaterial`,
      hitEnemy ? new Color3(0.62, 0.95, 1) : new Color3(0.8, 0.9, 1),
      0.9
    );
    const outerMaterial = this.createLightMaterial(
      `${root.name}:outerMaterial`,
      new Color3(0.25, 0.58, 1),
      0.34
    );
    outerMaterial.alphaMode = Engine.ALPHA_ADD;
    const inner = MeshBuilder.CreateSphere(
      `${root.name}:inner`,
      { diameter: 0.32, segments: 10 },
      this.scene
    );
    const outer = MeshBuilder.CreateSphere(
      `${root.name}:outer`,
      { diameter: 0.52, segments: 10 },
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
    inner.renderingGroupId = 2;
    outer.renderingGroupId = 2;
    this.impactBursts.push({
      root,
      inner,
      outer,
      innerMaterial,
      outerMaterial,
      elapsed: 0,
    });
  }

  private updateImpactBursts(delta: number) {
    const duration = 0.36;
    for (let index = this.impactBursts.length - 1; index >= 0; index--) {
      const burst = this.impactBursts[index];
      burst.elapsed += delta;
      const progress = clamp01(burst.elapsed / duration);
      burst.inner.scaling.setAll(0.65 + progress * 1.8);
      burst.outer.scaling.setAll(0.45 + progress * 4.2);
      burst.innerMaterial.alpha = (1 - progress) * 0.9;
      burst.outerMaterial.alpha = (1 - progress) * 0.34;
      if (progress < 1) continue;
      this.disposeImpactBurst(burst);
      this.impactBursts.splice(index, 1);
    }
  }

  private updateRecharge(delta: number) {
    if (
      this.charging ||
      this.ammo >= MAX_AMMO ||
      this.timeSinceShot < RECHARGE_DELAY_AFTER_SHOT
    ) {
      if (this.ammo >= MAX_AMMO) this.rechargeProgress = 0;
      return;
    }

    const playerPosition = this.player.position;
    const radiusSquared = RECHARGE_RADIUS * RECHARGE_RADIUS;
    const nearLight = this.options.getLightSourcePositions().some((position) => {
      const dx = position.x - playerPosition.x;
      const dz = position.z - playerPosition.z;
      return dx * dx + dz * dz <= radiusSquared && Math.abs(position.y - playerPosition.y) < 5;
    });

    if (!nearLight) {
      this.rechargeProgress = Math.max(0, this.rechargeProgress - delta * 1.4);
      if (this.messageTimer <= 0) this.message = "Mantene clic para apuntar";
      return;
    }

    this.rechargeProgress += delta;
    if (this.messageTimer <= 0) this.message = "Absorbiendo luz...";
    if (this.rechargeProgress < RECHARGE_SECONDS_PER_ORB) return;
    this.rechargeProgress -= RECHARGE_SECONDS_PER_ORB;
    this.ammo = Math.min(MAX_AMMO, this.ammo + 1);
    this.syncInventory();
    this.showMessage(
      this.ammo >= MAX_AMMO ? "Luz completa" : "+1 esfera de luz",
      0.8
    );
  }

  private consumeAmmo() {
    if (this.ammo <= 0) return false;
    if (this.options.inventory) {
      if (!this.options.inventory.consumeItem(LIGHT_ORB_ITEM.id)) return false;
      this.ammo = this.options.inventory.getItemCount(LIGHT_ORB_ITEM.id);
    } else {
      this.ammo -= 1;
    }
    return true;
  }

  private syncInventory() {
    this.options.inventory?.setItemCount(LIGHT_ORB_ITEM, this.ammo);
  }

  private refreshAmmoFromInventory() {
    const inventory = this.options.inventory;
    if (!inventory) return;
    const storedAmmo = inventory.getItemCount(LIGHT_ORB_ITEM.id);
    const clampedAmmo = Math.min(MAX_AMMO, Math.max(0, storedAmmo));
    if (storedAmmo !== clampedAmmo) inventory.setItemCount(LIGHT_ORB_ITEM, clampedAmmo);
    this.ammo = clampedAmmo;
  }

  private showMessage(message: string, durationSeconds: number) {
    this.message = message;
    this.messageTimer = Math.max(0, durationSeconds);
  }

  private renderHud() {
    if (this.dom.ammo) {
      this.dom.ammo.textContent = `${this.ammo} de ${MAX_AMMO} esferas de luz.`;
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
      !this.charging && this.rechargeProgress > 0 && this.ammo < MAX_AMMO
    );
    this.dom.root?.classList.toggle("empty", this.ammo <= 0);
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
        : `${this.ammo} / ${MAX_AMMO}`;
    }
  }

  private createHeldLightOrb(): HeldLightOrb {
    const root = new TransformNode("playerHeldLightOrb", this.scene);
    const coreMaterial = this.createLightMaterial(
      "playerHeldLightOrb:coreMaterial",
      new Color3(0.86, 0.97, 1),
      1
    );
    const auraMaterial = this.createLightMaterial(
      "playerHeldLightOrb:auraMaterial",
      new Color3(0.32, 0.72, 1),
      0.24
    );
    auraMaterial.alphaMode = Engine.ALPHA_ADD;

    const core = MeshBuilder.CreateSphere(
      "playerHeldLightOrb:core",
      { diameter: PROJECTILE_RADIUS * 1.8, segments: 12 },
      this.scene
    );
    const aura = MeshBuilder.CreateSphere(
      "playerHeldLightOrb:aura",
      { diameter: PROJECTILE_RADIUS * 4, segments: 10 },
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
    core.renderingGroupId = 2;
    aura.renderingGroupId = 2;
    root.setEnabled(false);
    return { root, core, aura, coreMaterial, auraMaterial };
  }

  private updateHeldOrb(delta: number) {
    this.heldOrbElapsed += delta;
    const look = this.player.getAttackAimRay();
    this.heldOrb.root.position.copyFrom(this.getThrowOrigin(look.direction));
    this.heldOrb.root.setEnabled(true);

    const power = this.charging ? this.getChargePower() : this.heldOrbPower;
    const pulse = Math.sin(this.heldOrbElapsed * 12) * 0.08;
    this.heldOrb.core.scaling.setAll(0.82 + power * 0.2);
    this.heldOrb.aura.scaling.setAll(0.84 + power * 0.38 + pulse);
    this.heldOrb.auraMaterial.alpha = 0.16 + power * 0.12 + pulse * 0.18;
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
