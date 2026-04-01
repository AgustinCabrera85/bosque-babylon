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
  gravity: number; // negativo
};

export class PlayerController {
  public readonly root: TransformNode;
  public readonly camera: UniversalCamera;

  private keys = new Set<string>();
  private velY = 0;
  private grounded = false;

  constructor(private scene: Scene, private canvas: HTMLCanvasElement, private settings: Settings) {
    this.root = new TransformNode("playerRoot", scene);
    this.root.position = new Vector3(0, settings.eyeHeight, 5);

    this.camera = new UniversalCamera("playerCam", new Vector3(0, 0, 0), scene);
    this.camera.parent = this.root;
    this.camera.minZ = 0.1;
    this.camera.fov = 0.9;
    this.camera.angularSensibility = 8000; // sensibilidad mouse

    // Mouse look
//    this.camera.attachControl(canvas, true);

    // Pointer lock “click para entrar”
    document.addEventListener("click", () => {
      // si el usuario está interactuando con UI, podés condicionar esto después
      canvas.requestPointerLock?.();
    });

    // --- Mouse look custom (pointer lock) ---
// Ajustá sensibilidad (más chico = más lento)
const SENS_X = 0.0012;
const SENS_Y = 0.0010;

// Clamp de pitch para que no “se dé vuelta”
const PITCH_MIN = -1.45;
const PITCH_MAX =  1.45;

let pitch = 0; // lo aplicamos a la cámara (X)
let yaw = 0;   // lo aplicamos al root (Y)

// Inicializar yaw/pitch desde rotaciones actuales (por si venís de otra config)
yaw = this.root.rotation.y;
pitch = this.camera.rotation.x;

window.addEventListener("mousemove", (e) => {
  // Solo rotar si estamos en pointer lock
  if (document.pointerLockElement !== this.canvas) return;

  yaw += e.movementX * SENS_X;
  pitch += e.movementY * SENS_Y;

  // clamp pitch
  if (pitch < PITCH_MIN) pitch = PITCH_MIN;
  if (pitch > PITCH_MAX) pitch = PITCH_MAX;

  // Aplicar: yaw en el root (gira el cuerpo), pitch en cámara (mira arriba/abajo)
  this.root.rotation.y = yaw;
  this.camera.rotation.x = pitch;

  // Evitar roll
  this.camera.rotation.z = 0;
});


    document.addEventListener("pointerlockchange", () => {
      const help = document.getElementById("help");
      const locked = document.pointerLockElement === canvas;
      if (help) help.style.display = locked ? "none" : "block";
    });

    // Input keyboard
    scene.onKeyboardObservable.add((kb) => {
      if (kb.type === KeyboardEventTypes.KEYDOWN) this.keys.add(kb.event.code);
      if (kb.type === KeyboardEventTypes.KEYUP) this.keys.delete(kb.event.code);
    });
  }

  get position() { return this.root.position; }

  update(dt: number, terrain: TerrainHandle, segments: Segments) {
    const locked = document.pointerLockElement === this.canvas;
    if (!locked) return;

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

    const running = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const speed = running ? this.settings.runSpeed : this.settings.walkSpeed;

    if (move.lengthSquared() > 0) {
      move.normalize().scaleInPlace(speed * dt);

      // Colisión simple 2D con colliders (árboles/props)
      const px = this.root.position.x;
      const pz = this.root.position.z;

      const tryX = px + move.x;
      if (!segments.isColliding(tryX, pz)) this.root.position.x = tryX;

      const tryZ = pz + move.z;
      if (!segments.isColliding(this.root.position.x, tryZ)) this.root.position.z = tryZ;
    }

    // ===========================
    // LIMITE LATERAL DEL BOSQUE
    // ===========================
    const maxX = 60;            // ancho jugable desde el centro (ajustalo)
    const margin = 0.25;        // margen para no “vibrar” en el borde

    if (this.root.position.x > maxX - margin) this.root.position.x = maxX - margin;
    if (this.root.position.x < -maxX + margin) this.root.position.x = -maxX + margin;


    // Gravedad + salto (pegado a terreno)
    const groundY = terrain.getHeightAt(this.root.position.x, this.root.position.z);
    const targetY = groundY + this.settings.eyeHeight;

    // grounded check
    if (this.root.position.y <= targetY + 0.02) {
      this.root.position.y = targetY;
      this.velY = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // salto
    if (this.keys.has("Space") && this.grounded) {
      this.velY = this.settings.jumpSpeed;
      this.grounded = false;
    }

    // integrar gravedad
    this.velY += this.settings.gravity * dt;
    this.root.position.y += this.velY * dt;

    // clamp
    if (this.root.position.y < targetY) {
      this.root.position.y = targetY;
      this.velY = 0;
      this.grounded = true;
    }
  }
}
