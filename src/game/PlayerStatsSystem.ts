import type { InventoryHandle } from "./Inventory";
import type { InspectableItem } from "./ItemInspector";

export const LIGHT_ORB_ITEM: InspectableItem = {
  id: "light-orb-ammo",
  name: "Esfera de luz",
  typeLabel: "Municion",
  description:
    "Luz concentrada que puede arrojarse contra las criaturas del bosque o consumirse para recuperar Cordura.",
};

export const PLAYER_STATS_CONFIG = {
  maxHealth: 100,
  maxSanity: 100,
  maxLightOrbs: 6,
  initialHealth: 100,
  initialSanity: 100,
  initialLightOrbs: 3,
  outgoingDamageMin: 0.8,
  outgoingDamageMax: 1.15,
  outgoingDamageCrisis: 0.75,
  incomingDamageMax: 1.3,
  incomingDamageMin: 0.88,
  incomingDamageCrisis: 1.4,
  physicalDamageSanityRatio: 0.2,
  physicalDamageSanityMaxPerHit: 8,
  offLitPathSanityDrainPerSecond: 0.5,
  offLitPathGraceSeconds: 2,
  totalDarknessSanityDrainPerSecond: 1.2,
  darknessRunningMultiplier: 1.25,
  surroundedSanityDrainPerSecond: 0.8,
  maxContinuousSanityDrainPerSecond: 2.5,
  weakLightSanityRecoveryPerSecond: 0.1,
  weakLightSanityRecoveryCap: 60,
  litPathSanityRecoveryPerSecond: 0.35,
  litPathSanityRecoveryCap: 75,
  sanctuarySanityRecoveryPerSecond: 1.2,
  sanctuarySanityRecoveryCap: 100,
  absorptionSecondsPerOrb: 0.8,
  absorptionSanityPerOrb: 10,
  absorptionMaxOrbs: 3,
  healthRegenerationSanityThreshold: 55,
  healthRegenerationDelaySeconds: 5,
  healthRegenerationLowRate: 0.002,
  healthRegenerationMediumRate: 0.0045,
  healthRegenerationHighRate: 0.0075,
  sanctuaryHealthRegenerationMultiplier: 1.25,
  shadowGrabberContactDamage: 8,
  shadowGrabberInitialSanityLoss: 12,
  shadowGrabberHoldSanityDrainPerSecond: 2,
  eyeGazeFirstRate: 0.5,
  eyeGazeSecondRate: 1,
  eyeGazeSustainedRate: 2,
  eyeGazeExposureDecayPerSecond: 2,
  skyEyeRevealSanityLoss: 12,
  lowSanityThreshold: 25,
} as const;

export type PlayerStatsConfig = {
  [Key in keyof typeof PLAYER_STATS_CONFIG]: number;
};

export type PlayerDamageType =
  | "physical"
  | "shadow"
  | "fall"
  | "drowning"
  | "scripted";

export type PlayerDamageContext = {
  type: PlayerDamageType;
  source?: string;
  ignoreSanityModifier?: boolean;
};

export type SanityBand = "lucid" | "uneasy" | "disturbed" | "broken" | "crisis";
export type SanityRecoveryMode = "none" | "weak-light" | "lit-path" | "sanctuary";
export type LightAbsorptionCancelReason =
  | "damage"
  | "running"
  | "attack"
  | "grab"
  | "death"
  | "pause"
  | "controls-locked"
  | "drowning"
  | "disposed";

export type PlayerStatsSnapshot = {
  health: number;
  maxHealth: number;
  sanity: number;
  maxSanity: number;
  lightOrbs: number;
  maxLightOrbs: number;
  lastDamageTime: number;
  isRegeneratingHealth: boolean;
  isAbsorbingLight: boolean;
  absorptionProgress: number;
  absorptionOrbsConsumed: number;
  sanityBand: SanityBand;
  isDead: boolean;
};

export type PlayerStatsEvent = {
  type:
    | "state-changed"
    | "sanity-band-changed"
    | "low-sanity-perception"
    | "health-regeneration-started"
    | "health-regeneration-stopped"
    | "health-regeneration-eligible"
    | "light-absorption-started"
    | "light-absorption-progress"
    | "light-orb-absorbed"
    | "light-absorption-cancelled"
    | "light-absorption-completed"
    | "saved";
  source?: string;
  previousBand?: SanityBand;
  currentBand?: SanityBand;
  reason?: LightAbsorptionCancelReason | "released" | "limit" | "full" | "empty";
  orbsConsumed?: number;
  snapshot: PlayerStatsSnapshot;
};

export type PlayerStatsUpdateContext = {
  active?: boolean;
  darknessDrainPerSecond?: number;
  environmentDrainPerSecond?: number;
  threatDrainPerSecond?: number;
  recoveryMode?: SanityRecoveryMode;
  canRegenerateHealth?: boolean;
  inSanctuary?: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type PlayerStatsOptions = {
  config?: Partial<PlayerStatsConfig>;
  inventory?: Pick<InventoryHandle, "hasItem" | "getItemCount" | "setItemCount">;
  storage?: StorageLike | null;
  storageKey?: string;
  restore?: boolean;
  debug?: boolean;
};

type PersistedPlayerStats = {
  version: 1;
  health: number;
  sanity: number;
  lightOrbs: number;
  narrativeEvents: string[];
};

type ContinuousSanityDrain = {
  source: string;
  amount: number;
};

const DEFAULT_STORAGE_KEY = "bosque:player-stats:v1";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * clamp(amount, 0, 1);
}

export function getSanityBand(sanity: number): SanityBand {
  const value = clamp(safeNumber(sanity), 0, 100);
  if (value <= 0) return "crisis";
  if (value <= 25) return "broken";
  if (value <= 55) return "disturbed";
  if (value <= 75) return "uneasy";
  return "lucid";
}

export function getEyeGazeDrainRate(
  exposureSeconds: number,
  config: Pick<
    PlayerStatsConfig,
    "eyeGazeFirstRate" | "eyeGazeSecondRate" | "eyeGazeSustainedRate"
  > = PLAYER_STATS_CONFIG
) {
  const exposure = Math.max(0, safeNumber(exposureSeconds));
  if (exposure <= 0) return 0;
  if (exposure <= 1) return config.eyeGazeFirstRate;
  if (exposure <= 2) return config.eyeGazeSecondRate;
  return config.eyeGazeSustainedRate;
}

/**
 * Authoritative gameplay state for Vida, Cordura and Esferas de Luz.
 * It owns no timers or render observer: the existing scene loop advances it.
 */
export class PlayerStatsSystem {
  public health: number;
  public readonly maxHealth: number;
  public sanity: number;
  public readonly maxSanity: number;
  public lightOrbs: number;
  public readonly maxLightOrbs: number;
  public lastDamageTime = Number.NEGATIVE_INFINITY;
  public isRegeneratingHealth = false;
  public isAbsorbingLight = false;

  public readonly config: PlayerStatsConfig;

  private readonly listeners = new Set<(event: PlayerStatsEvent) => void>();
  private readonly pendingContinuousDrains: ContinuousSanityDrain[] = [];
  private readonly activeShadowGrabberCaptures = new Set<string>();
  private readonly narrativeEvents = new Set<string>();
  private readonly inventory?: PlayerStatsOptions["inventory"];
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private readonly debug: boolean;
  private elapsed = 0;
  private absorptionElapsed = 0;
  private absorptionOrbsConsumed = 0;
  private currentSanityBand: SanityBand;
  private disposed = false;

  public constructor(options: PlayerStatsOptions = {}) {
    this.config = { ...PLAYER_STATS_CONFIG, ...options.config };
    this.maxHealth = Math.max(1, this.config.maxHealth);
    this.maxSanity = Math.max(1, this.config.maxSanity);
    this.maxLightOrbs = Math.max(0, Math.floor(this.config.maxLightOrbs));
    this.inventory = options.inventory;
    this.storage =
      options.storage === undefined
        ? typeof localStorage === "undefined"
          ? null
          : localStorage
        : options.storage;
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.debug = options.debug ?? false;

    const inventoryOrbs = this.inventory?.hasItem(LIGHT_ORB_ITEM.id)
      ? this.inventory.getItemCount(LIGHT_ORB_ITEM.id)
      : this.config.initialLightOrbs;
    this.health = clamp(this.config.initialHealth, 0, this.maxHealth);
    this.sanity = clamp(this.config.initialSanity, 0, this.maxSanity);
    this.lightOrbs = clamp(Math.floor(inventoryOrbs), 0, this.maxLightOrbs);

    if (options.restore !== false) this.restore();
    this.currentSanityBand = getSanityBand((this.sanity / this.maxSanity) * 100);
    this.syncInventory();
  }

  public get isDead() {
    return this.health <= 0;
  }

  public get normalizedHealth() {
    return this.health / this.maxHealth;
  }

  public get normalizedSanity() {
    return this.sanity / this.maxSanity;
  }

  public get hasActiveShadowGrabberCapture() {
    return this.activeShadowGrabberCaptures.size > 0;
  }

  public get snapshot(): PlayerStatsSnapshot {
    return {
      health: this.health,
      maxHealth: this.maxHealth,
      sanity: this.sanity,
      maxSanity: this.maxSanity,
      lightOrbs: this.lightOrbs,
      maxLightOrbs: this.maxLightOrbs,
      lastDamageTime: this.lastDamageTime,
      isRegeneratingHealth: this.isRegeneratingHealth,
      isAbsorbingLight: this.isAbsorbingLight,
      absorptionProgress: this.isAbsorbingLight
        ? clamp(this.absorptionElapsed / this.config.absorptionSecondsPerOrb, 0, 1)
        : 0,
      absorptionOrbsConsumed: this.absorptionOrbsConsumed,
      sanityBand: this.currentSanityBand,
      isDead: this.isDead,
    };
  }

  public onChange(listener: (event: PlayerStatsEvent) => void) {
    this.listeners.add(listener);
    listener({ type: "state-changed", source: "initial", snapshot: this.snapshot });
    return () => this.listeners.delete(listener);
  }

  public takeDamage(amount: number, context: PlayerDamageContext) {
    if (this.disposed || this.isDead) return 0;
    const requested = Math.max(0, safeNumber(amount));
    if (requested <= 0) return 0;
    const multiplier = context.ignoreSanityModifier
      ? 1
      : this.getIncomingDamageMultiplier();
    const applied = Math.min(this.health, requested * multiplier);
    this.health = clamp(this.health - applied, 0, this.maxHealth);
    this.lastDamageTime = this.elapsed;
    this.setHealthRegeneration(false);
    this.cancelLightAbsorption(this.health <= 0 ? "death" : "damage");

    if (context.type === "physical") {
      const sanityLoss = Math.min(
        this.config.physicalDamageSanityMaxPerHit,
        applied * this.config.physicalDamageSanityRatio
      );
      this.modifySanity(-sanityLoss, `${context.source ?? "physical"}:damage`);
    }
    this.emit("state-changed", context.source ?? context.type);
    return applied;
  }

  public heal(amount: number, source = "heal") {
    if (this.disposed || this.isDead) return 0;
    const applied = Math.min(
      this.maxHealth - this.health,
      Math.max(0, safeNumber(amount))
    );
    if (applied <= 0) return 0;
    this.health += applied;
    this.emit("state-changed", source);
    return applied;
  }

  public modifySanity(amount: number, source = "sanity") {
    return this.setSanity(this.sanity + safeNumber(amount), source);
  }

  public setSanity(value: number, source = "sanity") {
    if (this.disposed) return 0;
    const previous = this.sanity;
    const previousBand = this.currentSanityBand;
    this.sanity = clamp(safeNumber(value, previous), 0, this.maxSanity);
    if (this.sanity === previous) return 0;
    this.currentSanityBand = getSanityBand((this.sanity / this.maxSanity) * 100);
    if (previousBand !== this.currentSanityBand) {
      this.emit("sanity-band-changed", source, {
        previousBand,
        currentBand: this.currentSanityBand,
      });
    }
    if (
      previous > this.config.lowSanityThreshold &&
      this.sanity <= this.config.lowSanityThreshold
    ) {
      this.emit("low-sanity-perception", source);
    }
    if (
      previous <= this.config.healthRegenerationSanityThreshold &&
      this.sanity > this.config.healthRegenerationSanityThreshold &&
      this.canPassRegenerationDelay()
    ) {
      this.emit("health-regeneration-eligible", source);
    }
    this.emit("state-changed", source);
    return this.sanity - previous;
  }

  public addLightOrbs(amount = 1, source = "light") {
    if (this.disposed) return 0;
    const requested = Math.max(0, Math.floor(safeNumber(amount)));
    const applied = Math.min(this.maxLightOrbs - this.lightOrbs, requested);
    if (applied <= 0) return 0;
    this.lightOrbs += applied;
    this.syncInventory();
    this.emit("state-changed", source);
    return applied;
  }

  public consumeLightOrb(source = "consume-light-orb") {
    if (this.disposed || this.lightOrbs <= 0) return false;
    this.lightOrbs -= 1;
    this.syncInventory();
    this.emit("state-changed", source);
    return true;
  }

  public startLightAbsorption() {
    if (
      this.disposed ||
      this.isDead ||
      this.isAbsorbingLight ||
      this.lightOrbs <= 0 ||
      this.sanity >= this.maxSanity
    ) {
      return false;
    }
    this.isAbsorbingLight = true;
    this.absorptionElapsed = 0;
    this.absorptionOrbsConsumed = 0;
    this.emit("light-absorption-started", "absorption");
    return true;
  }

  public releaseLightAbsorption() {
    if (!this.isAbsorbingLight) return false;
    this.finishLightAbsorption("released");
    return true;
  }

  public cancelLightAbsorption(reason: LightAbsorptionCancelReason) {
    if (!this.isAbsorbingLight) return false;
    const consumed = this.absorptionOrbsConsumed;
    this.isAbsorbingLight = false;
    this.absorptionElapsed = 0;
    this.emit("light-absorption-cancelled", "absorption", {
      reason,
      orbsConsumed: consumed,
    });
    return true;
  }

  public getOutgoingDamageMultiplier() {
    if (this.sanity <= 0) return this.config.outgoingDamageCrisis;
    return lerp(
      this.config.outgoingDamageMin,
      this.config.outgoingDamageMax,
      this.normalizedSanity
    );
  }

  public getIncomingDamageMultiplier() {
    if (this.sanity <= 0) return this.config.incomingDamageCrisis;
    return lerp(
      this.config.incomingDamageMax,
      this.config.incomingDamageMin,
      this.normalizedSanity
    );
  }

  public noteEnemyAwareness(event: "detected" | "chase-started") {
    this.debugLog(`Enemy awareness '${event}' is sanity-neutral.`);
  }

  public beginShadowGrabberCapture(captureId: string) {
    if (this.isDead || this.activeShadowGrabberCaptures.has(captureId)) return false;
    this.activeShadowGrabberCaptures.add(captureId);
    this.cancelLightAbsorption("grab");
    this.takeDamage(this.config.shadowGrabberContactDamage, {
      type: "physical",
      source: `shadow-grabber:${captureId}`,
    });
    this.modifySanity(
      -this.config.shadowGrabberInitialSanityLoss,
      `shadow-grabber:${captureId}:capture`
    );
    return true;
  }

  public endShadowGrabberCapture(captureId: string) {
    return this.activeShadowGrabberCaptures.delete(captureId);
  }

  public queueContinuousSanityDrain(source: string, amount: number) {
    const safeAmount = Math.max(0, safeNumber(amount));
    if (safeAmount <= 0 || this.disposed) return;
    this.pendingContinuousDrains.push({ source, amount: safeAmount });
  }

  public applyNarrativeSanityImpact(eventId: string, amount: number) {
    const id = eventId.trim();
    if (!id || this.narrativeEvents.has(id)) return false;
    this.narrativeEvents.add(id);
    this.modifySanity(amount, `narrative:${id}`);
    this.save();
    return true;
  }

  public update(deltaTimeSeconds: number, context: PlayerStatsUpdateContext = {}) {
    if (this.disposed) return;
    const dt = clamp(safeNumber(deltaTimeSeconds), 0, 0.1);
    if (dt <= 0) return;
    if (context.active === false) {
      this.pendingContinuousDrains.length = 0;
      this.setHealthRegeneration(false);
      return;
    }
    this.elapsed += dt;

    this.updateLightAbsorption(dt);
    const drains = this.collectContinuousDrain(dt, context);
    if (drains.amount > 0) {
      this.modifySanity(-drains.amount, drains.source);
      this.debugLog(
        `Cordura -${drains.amount.toFixed(3)} (${drains.source}), cap ${this.config.maxContinuousSanityDrainPerSecond}/s.`
      );
    } else {
      this.updateNaturalSanityRecovery(dt, context.recoveryMode ?? "none");
    }
    this.updateHealthRegeneration(dt, context);
  }

  public save() {
    if (!this.storage) return false;
    const state: PersistedPlayerStats = {
      version: 1,
      health: this.health,
      sanity: this.sanity,
      lightOrbs: this.lightOrbs,
      narrativeEvents: [...this.narrativeEvents],
    };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(state));
      this.emit("saved", "manual-save");
      return true;
    } catch {
      return false;
    }
  }

  public dispose() {
    if (this.disposed) return;
    this.cancelLightAbsorption("disposed");
    this.disposed = true;
    this.pendingContinuousDrains.length = 0;
    this.activeShadowGrabberCaptures.clear();
    this.listeners.clear();
  }

  private restore() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const state = JSON.parse(raw) as Partial<PersistedPlayerStats>;
      if (state.version !== 1) return;
      this.health = clamp(safeNumber(state.health, this.health), 0, this.maxHealth);
      this.sanity = clamp(safeNumber(state.sanity, this.sanity), 0, this.maxSanity);
      this.lightOrbs = clamp(
        Math.floor(safeNumber(state.lightOrbs, this.lightOrbs)),
        0,
        this.maxLightOrbs
      );
      for (const id of state.narrativeEvents ?? []) {
        if (typeof id === "string" && id) this.narrativeEvents.add(id);
      }
    } catch {
      // A corrupt or unavailable save must never prevent a new game.
    }
  }

  private updateLightAbsorption(dt: number) {
    if (!this.isAbsorbingLight) return;
    this.absorptionElapsed += dt;
    this.emit("light-absorption-progress", "absorption");
    const interval = Math.max(0.01, this.config.absorptionSecondsPerOrb);
    while (this.isAbsorbingLight && this.absorptionElapsed >= interval) {
      if (this.sanity >= this.maxSanity) {
        this.finishLightAbsorption("full");
        break;
      }
      if (this.lightOrbs <= 0) {
        this.finishLightAbsorption("empty");
        break;
      }
      if (this.absorptionOrbsConsumed >= this.config.absorptionMaxOrbs) {
        this.finishLightAbsorption("limit");
        break;
      }
      this.absorptionElapsed -= interval;
      if (!this.consumeLightOrb("absorption")) {
        this.finishLightAbsorption("empty");
        break;
      }
      this.absorptionOrbsConsumed += 1;
      this.modifySanity(this.config.absorptionSanityPerOrb, "absorption");
      this.emit("light-orb-absorbed", "absorption", {
        orbsConsumed: this.absorptionOrbsConsumed,
      });
      if (this.sanity >= this.maxSanity) this.finishLightAbsorption("full");
      else if (this.lightOrbs <= 0) this.finishLightAbsorption("empty");
      else if (this.absorptionOrbsConsumed >= this.config.absorptionMaxOrbs) {
        this.finishLightAbsorption("limit");
      }
    }
  }

  private finishLightAbsorption(
    reason: "released" | "limit" | "full" | "empty"
  ) {
    const consumed = this.absorptionOrbsConsumed;
    this.isAbsorbingLight = false;
    this.absorptionElapsed = 0;
    this.emit("light-absorption-completed", "absorption", {
      reason,
      orbsConsumed: consumed,
    });
  }

  private collectContinuousDrain(
    dt: number,
    context: PlayerStatsUpdateContext
  ) {
    const sources: string[] = [];
    let requested = 0;
    const addRate = (source: string, rate = 0) => {
      const safeRate = Math.max(0, safeNumber(rate));
      if (safeRate <= 0) return;
      requested += safeRate * dt;
      sources.push(source);
    };
    addRate("darkness", context.darknessDrainPerSecond);
    addRate("environment", context.environmentDrainPerSecond);
    addRate("threat", context.threatDrainPerSecond);
    for (const drain of this.pendingContinuousDrains) {
      requested += drain.amount;
      sources.push(drain.source);
    }
    this.pendingContinuousDrains.length = 0;
    return {
      amount: Math.min(
        requested,
        this.config.maxContinuousSanityDrainPerSecond * dt
      ),
      source: sources.join("+") || "continuous",
    };
  }

  private updateNaturalSanityRecovery(dt: number, mode: SanityRecoveryMode) {
    let rate = 0;
    let cap = 0;
    if (mode === "weak-light") {
      rate = this.config.weakLightSanityRecoveryPerSecond;
      cap = this.config.weakLightSanityRecoveryCap;
    } else if (mode === "lit-path") {
      rate = this.config.litPathSanityRecoveryPerSecond;
      cap = this.config.litPathSanityRecoveryCap;
    } else if (mode === "sanctuary") {
      rate = this.config.sanctuarySanityRecoveryPerSecond;
      cap = this.config.sanctuarySanityRecoveryCap;
    }
    if (rate <= 0 || this.sanity >= Math.min(cap, this.maxSanity)) return;
    this.modifySanity(
      Math.min(rate * dt, Math.min(cap, this.maxSanity) - this.sanity),
      `recovery:${mode}`
    );
  }

  private updateHealthRegeneration(dt: number, context: PlayerStatsUpdateContext) {
    const eligible =
      context.canRegenerateHealth !== false &&
      !this.isDead &&
      this.health < this.maxHealth &&
      this.sanity > this.config.healthRegenerationSanityThreshold &&
      this.canPassRegenerationDelay();
    if (!eligible) {
      this.setHealthRegeneration(false);
      return;
    }
    this.setHealthRegeneration(true);
    let rate = this.config.healthRegenerationLowRate;
    if (this.sanity >= 85) rate = this.config.healthRegenerationHighRate;
    else if (this.sanity >= 70) rate = this.config.healthRegenerationMediumRate;
    if (context.inSanctuary) {
      rate *= this.config.sanctuaryHealthRegenerationMultiplier;
    }
    this.heal(this.maxHealth * rate * dt, "health-regeneration");
  }

  private canPassRegenerationDelay() {
    return (
      this.elapsed - this.lastDamageTime >=
      this.config.healthRegenerationDelaySeconds
    );
  }

  private setHealthRegeneration(active: boolean) {
    if (this.isRegeneratingHealth === active) return;
    this.isRegeneratingHealth = active;
    this.emit(
      active ? "health-regeneration-started" : "health-regeneration-stopped",
      "health-regeneration"
    );
  }

  private syncInventory() {
    this.inventory?.setItemCount(LIGHT_ORB_ITEM, this.lightOrbs);
  }

  private emit(
    type: PlayerStatsEvent["type"],
    source?: string,
    detail: Partial<Omit<PlayerStatsEvent, "type" | "source" | "snapshot">> = {}
  ) {
    if (this.disposed) return;
    const event: PlayerStatsEvent = {
      type,
      source,
      snapshot: this.snapshot,
      ...detail,
    };
    for (const listener of this.listeners) listener(event);
  }

  private debugLog(message: string) {
    if (this.debug) console.debug(`[PlayerStats] ${message}`);
  }
}
