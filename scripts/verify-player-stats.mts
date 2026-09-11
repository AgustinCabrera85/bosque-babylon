import assert from "node:assert/strict";
import {
  PlayerStatsSystem,
  getEyeGazeDrainRate,
  type PlayerStatsConfig,
} from "../src/game/PlayerStatsSystem.ts";

type UpdateContext = Parameters<PlayerStatsSystem["update"]>[1];

function createStats(config: Partial<PlayerStatsConfig> = {}) {
  return new PlayerStatsSystem({
    restore: false,
    storage: null,
    config,
  });
}

function advance(
  stats: PlayerStatsSystem,
  seconds: number,
  context: UpdateContext = {}
) {
  let remaining = seconds;
  while (remaining > 0.000001) {
    const step = Math.min(0.1, remaining);
    stats.update(step, context);
    remaining -= step;
  }
}

function close(actual: number, expected: number, epsilon = 0.001) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

const tests: Array<[string, () => void]> = [
  ["1. deteccion enemiga no drena Cordura", () => {
    const stats = createStats();
    stats.noteEnemyAwareness("detected");
    assert.equal(stats.sanity, 100);
  }],
  ["2. persecucion enemiga no drena Cordura", () => {
    const stats = createStats();
    stats.noteEnemyAwareness("chase-started");
    assert.equal(stats.sanity, 100);
  }],
  ["3. oscuridad drena sin depender de enemigos", () => {
    const stats = createStats();
    advance(stats, 1, { darknessDrainPerSecond: 1.2 });
    close(stats.sanity, 98.8);
  }],
  ["4. detectar al Ojo no activa drenaje", () => {
    const stats = createStats();
    advance(stats, 1, { threatDrainPerSecond: getEyeGazeDrainRate(0) });
    assert.equal(stats.sanity, 100);
  }],
  ["5. mirada activa sostenida drena por escalones", () => {
    assert.equal(getEyeGazeDrainRate(0.5), 0.5);
    assert.equal(getEyeGazeDrainRate(1.5), 1);
    assert.equal(getEyeGazeDrainRate(2.5), 2);
    const stats = createStats();
    advance(stats, 1, { threatDrainPerSecond: getEyeGazeDrainRate(1.5) });
    close(stats.sanity, 99);
  }],
  ["6. agarre aplica impacto inicial una sola vez por captura", () => {
    const stats = createStats();
    assert.equal(stats.beginShadowGrabberCapture("a"), true);
    const afterFirst = stats.snapshot;
    assert.equal(stats.beginShadowGrabberCapture("a"), false);
    assert.deepEqual(stats.snapshot, afterFirst);
  }],
  ["7. fuentes continuas combinadas respetan 2.5/s", () => {
    const stats = createStats();
    stats.queueContinuousSanityDrain("grab", 1);
    stats.update(0.1, {
      darknessDrainPerSecond: 2,
      environmentDrainPerSecond: 2,
      threatDrainPerSecond: 2,
    });
    close(stats.sanity, 99.75);
  }],
  ["8. recuperacion natural respeta caps 60/75/100", () => {
    const weak = createStats({ initialSanity: 50 });
    advance(weak, 200, { recoveryMode: "weak-light" });
    close(weak.sanity, 60);
    const path = createStats({ initialSanity: 50 });
    advance(path, 100, { recoveryMode: "lit-path" });
    close(path.sanity, 75);
    const sanctuary = createStats({ initialSanity: 50 });
    advance(sanctuary, 60, { recoveryMode: "sanctuary" });
    close(sanctuary.sanity, 100);
  }],
  ["9. absorcion de una esfera recupera 10", () => {
    const stats = createStats({ initialSanity: 50 });
    assert.equal(stats.startLightAbsorption(), true);
    advance(stats, 0.81);
    stats.releaseLightAbsorption();
    close(stats.sanity, 60);
    assert.equal(stats.lightOrbs, 2);
  }],
  ["10. absorcion de dos esferas recupera 20", () => {
    const stats = createStats({ initialSanity: 50 });
    stats.startLightAbsorption();
    advance(stats, 1.61);
    stats.releaseLightAbsorption();
    close(stats.sanity, 70);
    assert.equal(stats.lightOrbs, 1);
  }],
  ["11. absorcion se limita a tres esferas y 30", () => {
    const stats = createStats({ initialSanity: 40, initialLightOrbs: 6 });
    stats.startLightAbsorption();
    advance(stats, 3);
    close(stats.sanity, 70);
    assert.equal(stats.lightOrbs, 3);
    assert.equal(stats.isAbsorbingLight, false);
  }],
  ["12. interrupcion conserva la esfera cuyo intervalo no termino", () => {
    const stats = createStats({ initialSanity: 50 });
    stats.startLightAbsorption();
    advance(stats, 0.79);
    stats.cancelLightAbsorption("damage");
    assert.equal(stats.lightOrbs, 3);
    close(stats.sanity, 50);
  }],
  ["13. Cordura casi llena no consume esferas extra", () => {
    const stats = createStats({ initialSanity: 95 });
    stats.startLightAbsorption();
    advance(stats, 2);
    close(stats.sanity, 100);
    assert.equal(stats.lightOrbs, 2);
  }],
  ["14. Vida regenera solo sobre 55 y despues de 5s", () => {
    const low = createStats({ initialHealth: 50, initialSanity: 55 });
    advance(low, 10, { canRegenerateHealth: true });
    close(low.health, 50);
    const high = createStats({ initialHealth: 80, initialSanity: 70 });
    high.takeDamage(1, { type: "scripted", ignoreSanityModifier: true });
    const damaged = high.health;
    advance(high, 4.9, { canRegenerateHealth: true });
    close(high.health, damaged);
    advance(high, 0.2, { canRegenerateHealth: true });
    assert.ok(high.health > damaged);
  }],
  ["15. recibir dano interrumpe la regeneracion", () => {
    const stats = createStats({ initialHealth: 70, initialSanity: 90 });
    advance(stats, 0.2, { canRegenerateHealth: true });
    assert.equal(stats.isRegeneratingHealth, true);
    stats.takeDamage(1, { type: "scripted", ignoreSanityModifier: true });
    assert.equal(stats.isRegeneratingHealth, false);
  }],
  ["16. multiplicadores se calculan y aplican una vez", () => {
    const high = createStats();
    close(high.getOutgoingDamageMultiplier(), 1.15);
    close(high.getIncomingDamageMultiplier(), 0.88);
    const applied = high.takeDamage(10, { type: "scripted" });
    close(applied, 8.8);
    close(high.health, 91.2);
    const crisis = createStats({ initialSanity: 0 });
    close(crisis.getOutgoingDamageMultiplier(), 0.75);
    close(crisis.getIncomingDamageMultiplier(), 1.4);
  }],
  ["17. valores quedan clampeados e inputs invalidos se ignoran", () => {
    const stats = createStats();
    stats.setSanity(-1000);
    assert.equal(stats.sanity, 0);
    stats.setSanity(1000);
    assert.equal(stats.sanity, 100);
    stats.addLightOrbs(1000);
    assert.equal(stats.lightOrbs, 6);
    assert.equal(stats.takeDamage(Number.NaN, { type: "physical" }), 0);
    assert.equal(stats.health, 100);
  }],
  ["18. pausa/carga detienen drenajes, regen y progreso", () => {
    const stats = createStats({ initialHealth: 70, initialSanity: 50 });
    stats.startLightAbsorption();
    const before = stats.snapshot;
    advance(stats, 10, {
      active: false,
      darknessDrainPerSecond: 2.5,
      recoveryMode: "sanctuary",
      canRegenerateHealth: true,
    });
    assert.deepEqual(stats.snapshot, before);
  }],
  ["19. dispose impide observers/timers residuales al reiniciar", () => {
    const stats = createStats({ initialSanity: 50 });
    let events = 0;
    stats.onChange(() => events++);
    stats.dispose();
    const before = events;
    advance(stats, 10, { darknessDrainPerSecond: 2.5 });
    assert.equal(events, before);
    close(stats.sanity, 50);
    const restarted = createStats({ initialSanity: 50 });
    advance(restarted, 1, { darknessDrainPerSecond: 1 });
    close(restarted.sanity, 49);
  }],
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}
console.log(`PlayerStats: ${tests.length}/${tests.length} verificaciones correctas.`);
