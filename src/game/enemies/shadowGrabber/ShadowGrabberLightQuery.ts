import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export type FlashlightGameplayState = {
  enabled: boolean;
  origin: Vector3;
  direction: Vector3;
};

export type FixedLightSample = {
  nearestPosition: Vector3 | null;
  distance: number;
  hardAvoidance: boolean;
  softInfluence: number;
};

/** Gameplay-only light field; it never scans or modifies Babylon scene lights. */
export class ShadowGrabberLightQuery {
  private readonly fixedSafeLights: Vector3[];
  private readonly flashlightState: FlashlightGameplayState = {
    enabled: false,
    origin: Vector3.Zero(),
    direction: Vector3.Forward(),
  };

  public constructor(
    safeLightPositions: readonly Vector3[],
    private readonly getFlashlight: () => FlashlightGameplayState
  ) {
    this.fixedSafeLights = safeLightPositions.map((position) => position.clone());
  }

  public updateFlashlightState() {
    const source = this.getFlashlight();
    this.flashlightState.enabled = source.enabled;
    this.flashlightState.origin.copyFrom(source.origin);
    this.flashlightState.direction.copyFrom(source.direction);
  }

  public sampleFixed(position: Vector3, hardRadius: number, softRadius: number): FixedLightSample {
    let nearestPosition: Vector3 | null = null;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const light of this.fixedSafeLights) {
      const dx = position.x - light.x;
      const dz = position.z - light.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= nearestDistanceSquared) continue;
      nearestDistanceSquared = distanceSquared;
      nearestPosition = light;
    }

    if (!nearestPosition) {
      return {
        nearestPosition: null,
        distance: Number.POSITIVE_INFINITY,
        hardAvoidance: false,
        softInfluence: 0,
      };
    }
    const distance = Math.sqrt(nearestDistanceSquared);
    const softWidth = Math.max(0.001, softRadius - hardRadius);
    return {
      nearestPosition,
      distance,
      hardAvoidance: distance < hardRadius,
      softInfluence: Math.max(0, Math.min(1, (softRadius - distance) / softWidth)),
    };
  }

  public sampleFlashlight(
    position: Vector3,
    range: number,
    outerAngle: number,
    sanity: number
  ) {
    if (!this.flashlightState.enabled) return 0;

    const toEnemy = position.subtractToRef(
      this.flashlightState.origin,
      ShadowGrabberLightQuery.scratchToEnemy
    );
    const distance = toEnemy.length();
    if (distance <= 0.001 || distance >= range) return 0;
    toEnemy.scaleInPlace(1 / distance);
    const direction = this.flashlightState.direction;
    const directionLength = direction.length();
    if (directionLength <= 0.001) return 0;
    const cosine = Vector3.Dot(toEnemy, direction) / directionLength;
    const outerCosine = Math.cos(outerAngle * 0.5);
    if (cosine <= outerCosine) return 0;

    const cone = Math.min(1, (cosine - outerCosine) / Math.max(0.001, 1 - outerCosine));
    const falloff = 1 - distance / range;
    // High sanity helps a little without changing the encounter's slow movement identity.
    const sanityEfficacy = 0.9 + Math.max(0, Math.min(1, sanity)) * 0.2;
    return Math.max(0, Math.min(1, cone * falloff * sanityEfficacy));
  }

  public getNearestSafeLight(position: Vector3) {
    let nearest: Vector3 | null = null;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const light of this.fixedSafeLights) {
      const dx = position.x - light.x;
      const dz = position.z - light.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= nearestDistanceSquared) continue;
      nearestDistanceSquared = distanceSquared;
      nearest = light;
    }
    return nearest;
  }

  private static readonly scratchToEnemy = Vector3.Zero();
}
