import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import type { TerrainHandle } from "./Terrain";
import type { Segments } from "./Segments";

type Settings = {
  eyeHeight: number;
  walkSpeed: number;
  runSpeed: number;
  jumpSpeed: number;
  gravity: number;
};

export class PlayerController {
  public readonly root: TransformNode;
  public readonly camera: UniversalCamera;

  private keys = new Set<string>();
  private velY = 0;
  private grounded = false;
  private mobileEnabled = false;
  private mobileMoveX = 0;
  private mobileMoveY = 0;
  private mobileRun = false;
  private jumpQueued = false;
  private pitch = 0;
  private yaw = 0;

  constructor(private scene: Scene, private canvas: HTMLCanvasElement, private settings: Settings) {
    this.root = new TransformNode("playerRoot", scene);
    this.root.position = new Vector3(0, settings.eyeHeight, 5);

    this.camera = new UniversalCamera("playerCam", new Vector3(0, 0, 0), scene);
    this.camera.parent = this.root;
    this.camera.minZ = 0.1;
    this.camera.fov = 0.9;
    this.camera.angularSensibility = 8000;

    this.yaw = this.root.rotation.y;
    this.pitch = this.camera.rotation.x;

    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("#mobileControls")) return;
      if (this.mobileEnabled) return;
      canvas.requestPointerLock?.();
    });

    window.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.applyLook(event.movementX * 0.0012, event.movementY * 0.001);
    });

    document.addEventListener("pointerlockchange", () => {
      const help = document.getElementById("help");
      const locked = document.pointerLockElement === canvas;
      if (help) help.style.display = locked || this.mobileEnabled ? "none" : "block";
    });

    scene.onKeyboardObservable.add((kb) => {
      if (kb.type === KeyboardEventTypes.KEYDOWN) this.keys.add(kb.event.code);
      if (kb.type === KeyboardEventTypes.KEYUP) this.keys.delete(kb.event.code);
    });
  }

  get position() {
    return this.root.position;
  }

  setMobileEnabled(enabled: boolean) {
    this.mobileEnabled = enabled;
    const help = document.getElementById("help");
    if (help) help.style.display = enabled ? "none" : "block";
  }

  setMobileMove(x: number, y: number) {
    this.mobileMoveX = Math.max(-1, Math.min(1, x));
    this.mobileMoveY = Math.max(-1, Math.min(1, y));
  }

  setMobileRun(running: boolean) {
    this.mobileRun = running;
  }

  queueJump() {
    this.jumpQueued = true;
  }

  addMobileLook(deltaX: number, deltaY: number) {
    this.applyLook(deltaX * 0.0032, deltaY * 0.0027);
  }

  private applyLook(deltaYaw: number, deltaPitch: number) {
    this.yaw += deltaYaw;
    this.pitch += deltaPitch;

    if (this.pitch < -1.45) this.pitch = -1.45;
    if (this.pitch > 1.45) this.pitch = 1.45;

    this.root.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }

  update(dt: number, terrain: TerrainHandle, segments: Segments) {
    const active = this.mobileEnabled || document.pointerLockElement === this.canvas;
    if (!active) return;

    const forward = this.camera.getDirection(Vector3.Forward());
    forward.y = 0;
    if (forward.lengthSquared() > 0) forward.normalize();

    const right = Vector3.Cross(Vector3.Up(), forward);
    if (right.lengthSquared() > 0) right.normalize();

    const move = new Vector3(0, 0, 0);
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) move.addInPlace(forward);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) move.subtractInPlace(forward);
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) move.addInPlace(right);
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) move.subtractInPlace(right);

    if (this.mobileEnabled) {
      move.addInPlace(forward.scale(this.mobileMoveY));
      move.addInPlace(right.scale(this.mobileMoveX));
    }

    const running = this.mobileRun || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const speed = running ? this.settings.runSpeed : this.settings.walkSpeed;

    if (move.lengthSquared() > 0) {
      move.normalize().scaleInPlace(speed * dt);

      const px = this.root.position.x;
      const pz = this.root.position.z;

      const tryX = px + move.x;
      if (!segments.isColliding(tryX, pz)) this.root.position.x = tryX;

      const tryZ = pz + move.z;
      if (!segments.isColliding(this.root.position.x, tryZ)) this.root.position.z = tryZ;
    }

    const maxX = 60;
    const margin = 0.25;
    if (this.root.position.x > maxX - margin) this.root.position.x = maxX - margin;
    if (this.root.position.x < -maxX + margin) this.root.position.x = -maxX + margin;

    const groundY = terrain.getHeightAt(this.root.position.x, this.root.position.z);
    const targetY = groundY + this.settings.eyeHeight;

    if (this.root.position.y <= targetY + 0.02) {
      this.root.position.y = targetY;
      this.velY = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    if ((this.keys.has("Space") || this.jumpQueued) && this.grounded) {
      this.velY = this.settings.jumpSpeed;
      this.grounded = false;
    }
    this.jumpQueued = false;

    this.velY += this.settings.gravity * dt;
    this.root.position.y += this.velY * dt;

    if (this.root.position.y < targetY) {
      this.root.position.y = targetY;
      this.velY = 0;
      this.grounded = true;
    }
  }
}
