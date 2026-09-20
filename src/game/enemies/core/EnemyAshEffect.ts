import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import type { Scene } from "@babylonjs/core/scene";

const PREWARMED_MINOR_SYSTEMS = 3;
const PREWARMED_BOSS_SYSTEMS = 1;

type PooledAshSystem = {
  particles: ParticleSystem;
  boss: boolean;
  inUse: boolean;
  poolName: string;
};

type SceneAshPool = {
  texture: RawTexture;
  systems: PooledAshSystem[];
  disposed: boolean;
  warmupScheduled: boolean;
};

const sceneAshPools = new WeakMap<Scene, SceneAshPool>();

function createAshTexture(scene: Scene) {
  const texture = RawTexture.CreateRGBATexture(
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
  texture.hasAlpha = true;
  return texture;
}

function getAshPool(scene: Scene) {
  const existing = sceneAshPools.get(scene);
  if (existing) return existing;

  const pool: SceneAshPool = {
    texture: createAshTexture(scene),
    systems: [],
    disposed: false,
    warmupScheduled: false,
  };
  sceneAshPools.set(scene, pool);
  scene.onDisposeObservable.addOnce(() => {
    pool.disposed = true;
    for (const entry of pool.systems) {
      if (!entry.particles.isDisposed) entry.particles.dispose(false);
    }
    pool.systems.length = 0;
    pool.texture.dispose();
    sceneAshPools.delete(scene);
  });
  return pool;
}

function createPooledSystem(scene: Scene, pool: SceneAshPool, boss: boolean) {
  const variant = boss ? "boss" : "minor";
  const poolName = `enemyAshPool:${variant}:${pool.systems.length + 1}`;
  const particles = new ParticleSystem(poolName, boss ? 360 : 140, scene);
  particles.particleTexture = pool.texture;
  particles.minEmitPower = boss ? 1.3 : 0.55;
  particles.maxEmitPower = boss ? 2.8 : 1.6;
  particles.minLifeTime = 0.6;
  particles.maxLifeTime = 1.35;
  particles.minSize = boss ? 0.09 : 0.045;
  particles.maxSize = boss ? 0.28 : 0.15;
  particles.emitRate = boss ? 500 : 210;
  particles.targetStopDuration = 0.55;
  particles.gravity = new Vector3(0, -0.85, 0);
  particles.color1 = new Color4(0.55, 0.52, 0.49, 0.9);
  particles.color2 = new Color4(0.32, 0.31, 0.33, 0.75);
  particles.colorDead = new Color4(0.16, 0.16, 0.17, 0);
  particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  particles.applyFog = false;
  particles.emitter = Vector3.Zero();
  particles.createBoxEmitter(Vector3.Up(), Vector3.Up(), Vector3.Zero(), Vector3.Zero());

  const entry: PooledAshSystem = { particles, boss, inUse: false, poolName };
  pool.systems.push(entry);
  return entry;
}

function acquirePooledSystem(scene: Scene, boss: boolean) {
  const pool = getAshPool(scene);
  const entry =
    pool.systems.find((candidate) => candidate.boss === boss && !candidate.inUse) ??
    createPooledSystem(scene, pool, boss);
  entry.inUse = true;
  return { pool, entry };
}

/** Short, self-contained ash cloud that remains after the enemy mesh vanishes. */
export class EnemyAshEffect {
  private readonly pool: SceneAshPool;
  private readonly entry: PooledAshSystem;
  private disposed = false;

  /** Allocates the usual systems while the level is loading, outside combat. */
  public static prewarm(scene: Scene) {
    const pool = getAshPool(scene);
    while (pool.systems.filter((entry) => !entry.boss).length < PREWARMED_MINOR_SYSTEMS) {
      createPooledSystem(scene, pool, false);
    }
    while (pool.systems.filter((entry) => entry.boss).length < PREWARMED_BOSS_SYSTEMS) {
      createPooledSystem(scene, pool, true);
    }
    if (!pool.warmupScheduled) {
      pool.warmupScheduled = true;
      let attempts = 0;
      const observer = scene.onBeforeRenderObservable.add(() => {
        attempts += 1;
        const ready = pool.systems.every((entry) => entry.particles.isReady());
        if (ready || attempts >= 4 || pool.disposed) {
          scene.onBeforeRenderObservable.remove(observer);
        }
      });
    }
  }

  public constructor(
    scene: Scene,
    id: string,
    minimum: Vector3,
    maximum: Vector3,
    boss: boolean
  ) {
    const acquired = acquirePooledSystem(scene, boss);
    this.pool = acquired.pool;
    this.entry = acquired.entry;
    const particles = this.entry.particles;
    particles.name = `${id}:ashes`;
    particles.reset();
    const center = Vector3.Center(minimum, maximum);
    particles.emitter = center;
    particles.createBoxEmitter(
      new Vector3(-0.8, 0.35, -0.8),
      new Vector3(0.8, 1.6, 0.8),
      minimum.subtract(center),
      maximum.subtract(center)
    );
    particles.start();
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const particles = this.entry.particles;
    if (!particles.isDisposed) {
      particles.stop();
      particles.reset();
      particles.name = this.entry.poolName;
    }
    if (!this.pool.disposed) this.entry.inUse = false;
  }
}
