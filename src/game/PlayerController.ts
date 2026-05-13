import "@babylonjs/loaders/glTF";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Material as BabylonMaterial } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { TerrainHandle } from "./Terrain";
import type { Segments } from "./Segments";

type Settings = {
  eyeHeight: number;
  walkSpeed: number;
  runSpeed: number;
  jumpSpeed: number;
  gravity: number;
};

export type ViewMode = "first" | "third" | "front";
export type LookRay = { origin: Vector3; direction: Vector3 };

const CHARACTER_ROOT_URL = "/assets/models/character/";
const CHARACTER_FILE = "Lautaro_Animated.glb";
const CHARACTER_VISUAL_SCALE = 2.7;
const CHARACTER_YAW_OFFSET = 0;
const CHARACTER_FOOT_CLEARANCE = 0.03;
const THIRD_PERSON_CAMERA_DISTANCE = 5.2;
const THIRD_PERSON_CAMERA_HEIGHT = 1.25;
const THIRD_PERSON_CAMERA_TARGET_HEIGHT = -0.35;
const THIRD_PERSON_PITCH_MIN = -0.72;
const THIRD_PERSON_PITCH_MAX = 0.82;
const PATH_HALF_WIDTH = 4.5;
const PATH_START_Z = -800;
const PATH_END_Z = 70 * 8 - 8;
const PATH_SURFACE_OFFSET = 0.1;
const ANIMATION_BLEND_TIME = 0.16;
const ACTION_BLEND_TIME = 0.08;

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
  private viewMode: ViewMode = "third";
  private viewModeListeners = new Set<(mode: ViewMode) => void>();
  private avatarRoot: TransformNode | null = null;
  private avatarMeshes: AbstractMesh[] = [];
  private animations = new Map<string, AnimationGroup>();
  private currentAnimation: string | null = null;
  private fadeFromAnimation: AnimationGroup | null = null;
  private fadeToAnimation: AnimationGroup | null = null;
  private fadeElapsed = 0;
  private fadeDuration = ANIMATION_BLEND_TIME;
  private actionPlaying = false;

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
    this.applyCameraRig();

    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("#mobileControls")) return;
      if (target?.closest("#musicControls")) return;
      if (target?.closest("#viewControls")) return;
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
      if (kb.type === KeyboardEventTypes.KEYDOWN) {
        const event = kb.event as KeyboardEvent;
        if (event.code === "KeyV" && !event.repeat) this.toggleViewMode();
        this.keys.add(kb.event.code);
      }
      if (kb.type === KeyboardEventTypes.KEYUP) this.keys.delete(kb.event.code);
    });
  }

  get position() {
    return this.root.position;
  }

  get currentViewMode() {
    return this.viewMode;
  }

  onViewModeChange(listener: (mode: ViewMode) => void) {
    this.viewModeListeners.add(listener);
    listener(this.viewMode);
    return () => this.viewModeListeners.delete(listener);
  }

  setViewMode(mode: ViewMode) {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.clampPitchForView();
    this.applyCameraRig();
    for (const listener of this.viewModeListeners) listener(mode);
  }

  toggleViewMode() {
    if (this.viewMode === "first") this.setViewMode("third");
    else if (this.viewMode === "third") this.setViewMode("front");
    else this.setViewMode("first");
  }

  async loadCharacter(rootUrl = CHARACTER_ROOT_URL, fileName = CHARACTER_FILE) {
    if (this.avatarRoot) return;

    const res = await SceneLoader.ImportMeshAsync(null, rootUrl, fileName, this.scene);
    const avatarRoot = new TransformNode("playerAvatarRoot", this.scene);
    avatarRoot.parent = this.root;
    avatarRoot.position.set(0, -this.settings.eyeHeight, 0);

    const importedNodes = [...res.meshes, ...res.transformNodes];
    for (const node of importedNodes) {
      if (!node.parent) node.parent = avatarRoot;
    }

    this.avatarRoot = avatarRoot;
    this.avatarMeshes = res.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    for (const mesh of this.avatarMeshes) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.visibility = 1;
      (mesh as any).hasVertexAlpha = false;
      (mesh as any).alphaIndex = 0;
      this.patchAvatarMaterial(mesh.material);
    }

    this.animations.clear();
    for (const group of res.animationGroups) {
      group.stop();
      this.animations.set(group.name, group);
    }

    this.normalizeAvatar();
    this.setAvatarVisible(this.viewMode !== "first");
    this.playAnimation("Idle", true);
  }

  playInteractionAction(type?: string) {
    this.playAction(type === "door" ? "OpenDoor" : "PickUpItem");
  }

  getLookRay(): LookRay {
    const direction = this.camera.getDirection(Vector3.Forward());
    if (direction.lengthSquared() > 0) direction.normalize();

    return {
      origin: this.root.getAbsolutePosition().clone(),
      direction,
    };
  }

  getFlashlightRay(): LookRay {
    if (this.viewMode === "first") {
      const look = this.getLookRay();
      return {
        origin: look.origin.add(look.direction.scale(0.45)).add(new Vector3(0, -0.08, 0)),
        direction: look.direction,
      };
    }

    this.root.computeWorldMatrix(true);
    const world = this.root.getWorldMatrix();
    const forward = Vector3.TransformNormal(Vector3.Forward(), world);
    const right = Vector3.TransformNormal(new Vector3(1, 0, 0), world);
    if (forward.lengthSquared() > 0) forward.normalize();
    if (right.lengthSquared() > 0) right.normalize();

    return {
      origin: this.root
        .getAbsolutePosition()
        .add(forward.scale(1.35))
        .add(right.scale(0.35))
        .add(new Vector3(0, -0.18, 0)),
      direction: forward,
    };
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

    this.clampPitchForView();

    this.applyCameraRig();
  }

  private applyCameraRig() {
    this.root.rotation.y = this.yaw;
    if (this.viewMode === "first") {
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.x = this.pitch;
      this.camera.rotation.y = 0;
      this.camera.rotation.z = 0;
    } else {
      this.positionThirdPersonCamera();
    }
    this.setAvatarVisible(this.viewMode !== "first");
  }

  private clampPitchForView() {
    const minPitch = this.viewMode === "first" ? -1.45 : THIRD_PERSON_PITCH_MIN;
    const maxPitch = this.viewMode === "first" ? 1.45 : THIRD_PERSON_PITCH_MAX;
    if (this.pitch < minPitch) this.pitch = minPitch;
    if (this.pitch > maxPitch) this.pitch = maxPitch;
  }

  update(dt: number, terrain: TerrainHandle, segments: Segments) {
    const active = this.mobileEnabled || document.pointerLockElement === this.canvas;
    if (!active) {
      if (!this.actionPlaying) this.playAnimation("Idle", true);
      this.updateAnimationFade(dt);
      this.updateThirdPersonCameraCollision(segments);
      return;
    }

    this.root.computeWorldMatrix(true);
    const forward = Vector3.TransformNormal(Vector3.Forward(), this.root.getWorldMatrix());
    forward.y = 0;
    if (forward.lengthSquared() > 0) forward.normalize();

    const right = Vector3.Cross(Vector3.Up(), forward);
    if (right.lengthSquared() > 0) right.normalize();

    const move = new Vector3(0, 0, 0);
    let moveX = 0;
    let moveY = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) moveY += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) moveY -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) moveX += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) moveX -= 1;

    if (this.mobileEnabled) {
      moveY += this.mobileMoveY;
      moveX += this.mobileMoveX;
    }

    moveX = Math.max(-1, Math.min(1, moveX));
    moveY = Math.max(-1, Math.min(1, moveY));
    move.addInPlace(forward.scale(moveY));
    move.addInPlace(right.scale(moveX));

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

    const groundY = this.getWalkableSurfaceHeight(terrain);
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

    this.updateThirdPersonCameraCollision(segments);
    this.updateAvatarAnimation(moveX, moveY, running);
    this.updateAnimationFade(dt);
  }

  private updateThirdPersonCameraCollision(segments: Segments) {
    if (this.viewMode === "first") return;

    this.positionThirdPersonCamera();
    this.root.computeWorldMatrix(true);
    this.camera.computeWorldMatrix();
    const origin = Vector3.TransformCoordinates(
      this.getThirdPersonTargetLocal(),
      this.root.getWorldMatrix()
    );
    const desired = this.camera.globalPosition.clone();
    const adjusted = segments.resolveCameraPosition(origin, desired);
    const inverse = this.root.getWorldMatrix().clone().invert();
    this.camera.position.copyFrom(Vector3.TransformCoordinates(adjusted, inverse));
    this.lookAtLocal(this.getThirdPersonTargetLocal());
  }

  private positionThirdPersonCamera() {
    const target = this.getThirdPersonTargetLocal();
    const viewSign = this.viewMode === "front" ? 1 : -1;
    const orbitPitch = Math.max(THIRD_PERSON_PITCH_MIN, Math.min(THIRD_PERSON_PITCH_MAX, this.pitch));
    const distance = THIRD_PERSON_CAMERA_DISTANCE;
    const y = target.y + THIRD_PERSON_CAMERA_HEIGHT + Math.sin(orbitPitch) * 2.2;
    const z = viewSign * distance * Math.cos(orbitPitch * 0.45);

    this.camera.position.set(0, y, z);
    this.lookAtLocal(target);
  }

  private getThirdPersonTargetLocal() {
    return new Vector3(0, THIRD_PERSON_CAMERA_TARGET_HEIGHT, 0);
  }

  private lookAtLocal(target: Vector3) {
    const direction = target.subtract(this.camera.position);
    const flatLength = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
    this.camera.rotation.x = Math.atan2(-direction.y, flatLength);
    this.camera.rotation.y = Math.atan2(direction.x, direction.z);
    this.camera.rotation.z = 0;
  }

  private normalizeAvatar() {
    if (!this.avatarRoot) return;
    this.avatarRoot.rotation.y = CHARACTER_YAW_OFFSET;
    this.avatarRoot.scaling.setAll(CHARACTER_VISUAL_SCALE);

    const scaledBounds = this.getAvatarBounds();
    if (!scaledBounds) return;

    const rootWorld = this.root.getAbsolutePosition();
    const groundY = rootWorld.y - this.settings.eyeHeight;
    const centerX = (scaledBounds.min.x + scaledBounds.max.x) * 0.5;
    const centerZ = (scaledBounds.min.z + scaledBounds.max.z) * 0.5;

    this.avatarRoot.position.x -= centerX - rootWorld.x;
    this.avatarRoot.position.y -= scaledBounds.min.y - groundY - CHARACTER_FOOT_CLEARANCE;
    this.avatarRoot.position.z -= centerZ - rootWorld.z;
  }

  private getWalkableSurfaceHeight(terrain: TerrainHandle) {
    const baseHeight = terrain.getHeightAt(this.root.position.x, this.root.position.z);
    const onPath =
      Math.abs(this.root.position.x) <= PATH_HALF_WIDTH &&
      this.root.position.z >= PATH_START_Z &&
      this.root.position.z <= PATH_END_Z;

    return baseHeight + (onPath ? PATH_SURFACE_OFFSET : 0);
  }

  private patchAvatarMaterial(material: BabylonMaterial | null) {
    if (!material) return;

    const materials: BabylonMaterial[] = (material as any).subMaterials?.length
      ? (material as any).subMaterials
      : [material];

    for (const mat of materials) {
      if (!mat) continue;
      mat.alpha = 1;
      mat.alphaMode = BabylonMaterial.MATERIAL_OPAQUE;
      mat.transparencyMode = BabylonMaterial.MATERIAL_OPAQUE;
      mat.backFaceCulling = false;
      (mat as any).forceDepthWrite = true;
      (mat as any).needDepthPrePass = false;

      if (mat instanceof PBRMaterial) {
        mat.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
        mat.useAlphaFromAlbedoTexture = false;
        mat.metallic = Math.min(mat.metallic ?? 0, 0.15);
        mat.roughness = Math.max(mat.roughness ?? 0.65, 0.55);
        mat.environmentIntensity = Math.min(mat.environmentIntensity ?? 0.35, 0.35);
      } else if (mat instanceof StandardMaterial) {
        mat.useAlphaFromDiffuseTexture = false;
      }
    }
  }

  private getAvatarBounds() {
    if (!this.avatarMeshes.length) return null;

    this.avatarRoot?.computeWorldMatrix(true);
    const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (const mesh of this.avatarMeshes) {
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo({});
      const box = mesh.getBoundingInfo().boundingBox;
      min.copyFrom(Vector3.Minimize(min, box.minimumWorld));
      max.copyFrom(Vector3.Maximize(max, box.maximumWorld));
    }

    return { min, max };
  }

  private setAvatarVisible(visible: boolean) {
    for (const mesh of this.avatarMeshes) {
      mesh.visibility = visible ? 1 : 0;
    }
  }

  private updateAvatarAnimation(moveX: number, moveY: number, running: boolean) {
    if (!this.animations.size || this.actionPlaying) return;

    if (!this.grounded) {
      this.playAnimation("Jump_InPlace", false);
      return;
    }

    const absX = Math.abs(moveX);
    const absY = Math.abs(moveY);
    const moving = absX > 0.12 || absY > 0.12;

    if (moving) {
      if (moveY < -0.12 && absY >= absX) {
        this.playAnimation("Walk_Backwards_InPlace", true);
        return;
      }

      if (absX > 0.12) {
        if (moveX < 0) {
          this.playAnimation(running ? "Left_Strafe_Run_InPlace" : "Left_Strafe_Walk_InPlace", true);
        } else {
          this.playAnimation(running ? "Right_Strafe_Run_InPlace" : "Right_Strafe_Walk_InPlace", true);
        }
        return;
      }

      this.playAnimation(running ? "Run_InPlace" : "Walk_InPlace", true);
      return;
    }

    this.playAnimation("Idle", true);
  }

  private playAction(name: string) {
    if (!this.animations.has(name)) return;

    this.actionPlaying = true;
    const group = this.playAnimation(name, false, ACTION_BLEND_TIME);
    if (!group) {
      this.actionPlaying = false;
      return;
    }

    group.onAnimationGroupEndObservable.addOnce(() => {
      if (this.currentAnimation !== name) return;
      this.actionPlaying = false;
      this.currentAnimation = null;
      this.updateAvatarAnimation(0, 0, false);
    });
  }

  private playAnimation(name: string, loop: boolean, blendTime = ANIMATION_BLEND_TIME) {
    const next = this.animations.get(name) ?? this.animations.get("Idle");
    if (!next) return null;
    if (this.currentAnimation === next.name && next.isPlaying) return next;

    const previous = this.currentAnimation ? this.animations.get(this.currentAnimation) : null;
    if (this.fadeFromAnimation && this.fadeFromAnimation !== previous) {
      this.fadeFromAnimation.stop();
      this.fadeFromAnimation = null;
    }

    next.reset();
    next.start(loop);
    this.setAnimationWeight(next, previous && previous !== next ? 0 : 1);

    if (previous && previous !== next && previous.isPlaying) {
      this.fadeFromAnimation = previous;
      this.fadeToAnimation = next;
      this.fadeElapsed = 0;
      this.fadeDuration = Math.max(0.01, blendTime);
      this.setAnimationWeight(previous, 1);
    } else {
      this.fadeFromAnimation = null;
      this.fadeToAnimation = null;
      this.setAnimationWeight(next, 1);
    }

    this.currentAnimation = next.name;
    return next;
  }

  private updateAnimationFade(dt: number) {
    if (!this.fadeFromAnimation || !this.fadeToAnimation) return;

    this.fadeElapsed += dt;
    const rawT = Math.min(1, this.fadeElapsed / this.fadeDuration);
    const t = rawT * rawT * (3 - 2 * rawT);

    this.setAnimationWeight(this.fadeFromAnimation, 1 - t);
    this.setAnimationWeight(this.fadeToAnimation, t);

    if (rawT >= 1) {
      this.fadeFromAnimation.stop();
      this.setAnimationWeight(this.fadeToAnimation, 1);
      this.fadeFromAnimation = null;
      this.fadeToAnimation = null;
    }
  }

  private setAnimationWeight(group: AnimationGroup, weight: number) {
    group.weight = weight;
    group.setWeightForAllAnimatables(weight);
  }
}
