import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import type { Scene } from "@babylonjs/core/scene";

/** Short, self-contained ash cloud that remains after the enemy mesh vanishes. */
export class EnemyAshEffect {
  private readonly texture: RawTexture;
  private readonly particles: ParticleSystem;

  public constructor(
    scene: Scene,
    id: string,
    minimum: Vector3,
    maximum: Vector3,
    boss: boolean
  ) {
    this.texture = RawTexture.CreateRGBATexture(
      new Uint8Array([
        255, 255, 255, 0, 255, 255, 255, 75, 255, 255, 255, 75, 255, 255, 255, 0,
        255, 255, 255, 75, 255, 255, 255, 210, 255, 255, 255, 210, 255, 255, 255, 75,
        255, 255, 255, 75, 255, 255, 255, 210, 255, 255, 255, 210, 255, 255, 255, 75,
        255, 255, 255, 0, 255, 255, 255, 75, 255, 255, 255, 75, 255, 255, 255, 0,
      ]),
      4,
      4,
      scene,
      false,
      false
    );
    this.texture.hasAlpha = true;
    this.particles = new ParticleSystem(`${id}:ashes`, boss ? 360 : 140, scene);
    this.particles.particleTexture = this.texture;
    const center = Vector3.Center(minimum, maximum);
    this.particles.emitter = center;
    this.particles.createBoxEmitter(
      new Vector3(-0.8, 0.35, -0.8),
      new Vector3(0.8, 1.6, 0.8),
      minimum.subtract(center),
      maximum.subtract(center)
    );
    this.particles.minEmitPower = boss ? 1.3 : 0.55;
    this.particles.maxEmitPower = boss ? 2.8 : 1.6;
    this.particles.minLifeTime = 0.6;
    this.particles.maxLifeTime = 1.35;
    this.particles.minSize = boss ? 0.09 : 0.045;
    this.particles.maxSize = boss ? 0.28 : 0.15;
    this.particles.emitRate = boss ? 500 : 210;
    this.particles.targetStopDuration = 0.55;
    this.particles.gravity = new Vector3(0, -0.85, 0);
    this.particles.color1 = new Color4(0.55, 0.52, 0.49, 0.9);
    this.particles.color2 = new Color4(0.32, 0.31, 0.33, 0.75);
    this.particles.colorDead = new Color4(0.16, 0.16, 0.17, 0);
    this.particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.particles.applyFog = false;
    this.particles.start();
  }

  public dispose() {
    this.particles.dispose();
    this.texture.dispose();
  }
}
