import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { EnemyHealthHud } from "../src/game/EnemyHealthHud.ts";
import { BaseEnemyController } from "../src/game/enemies/core/EnemyController.ts";
import {
  EnemyLifecycleState,
  type EnemyControllerContext,
} from "../src/game/enemies/core/EnemyTypes.ts";
import { createSkyEyeConfig, SKY_EYE_TYPE } from "../src/game/enemies/skyEye/SkyEyeConfig.ts";
import { SkyEyeController } from "../src/game/enemies/skyEye/SkyEyeController.ts";

// The combat controller emits browser events; EventTarget is enough here.
Object.assign(globalThis, { window: new EventTarget() });

class TestEnemy extends BaseEnemyController {
  public grayProgress = 0;
  public fadeProgress = 0;

  constructor(context: EnemyControllerContext, id: string, maxHealth: number, private readonly ashenFade = false) {
    super(context, { id, type: "test", position: Vector3.Zero() }, maxHealth);
  }

  async initialize() {
    this.completeInitialization();
  }

  update() {}

  get visualScale() {
    return this.visualRoot.scaling.x;
  }

  protected override get deathVisualStyle(): "shrink" | "ashenFade" {
    return this.ashenFade ? "ashenFade" : "shrink";
  }

  protected override onDeathProgress(grayProgress: number, fadeProgress: number) {
    this.grayProgress = grayProgress;
    this.fadeProgress = fadeProgress;
  }
}

class TestSkyEye extends SkyEyeController {
  override async initialize() {
    this.completeInitialization();
  }

  get visualScale() {
    return this.visualRoot.scaling.x;
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);

function createEnemy(id: string, maxHealth: number, ashenFade = false) {
  const mesh = MeshBuilder.CreateBox(`${id}:body`, { size: 1 }, scene);
  const enemy = new TestEnemy(
    {
      scene,
      asset: {
        rootNodes: [mesh],
        nodes: [mesh],
        meshes: [mesh],
        skeletons: [],
        animationGroups: [],
        materials: [],
      },
    },
    id,
    maxHealth,
    ashenFade
  );
  return enemy;
}

function hit(enemy: BaseEnemyController, damage = 1) {
  enemy.receiveAttack({
    damage,
    point: Vector3.Zero(),
    direction: Vector3.Forward(),
  });
}

async function verify() {
  const minor = createEnemy("minor", 1.5);
  await minor.initialize();
  assert.equal(minor.maxHealth, 1.5);
  hit(minor);
  assert.equal(minor.health, 0.5);
  assert.equal(minor.lifecycleState, EnemyLifecycleState.Ready);
  assert.equal(scene.getMeshByName("minor:healthBar"), null);
  hit(minor);
  assert.equal(minor.health, 0);
  assert.equal(minor.lifecycleState, EnemyLifecycleState.Dying);
  assert.equal(minor.enabled, false);
  hit(minor);
  assert.equal(minor.health, 0, "dead enemies cannot take another hit");
  minor.updateCombatEffects(0.35);
  assert.ok(minor.visualScale < 1, "minor enemies keep their original death effect");
  minor.updateCombatEffects(1.65);
  assert.equal(minor.lifecycleState, EnemyLifecycleState.Disposed);

  const boss = createEnemy("boss", 18, true);
  await boss.initialize();
  for (let shot = 1; shot < 18; shot++) {
    hit(boss);
    assert.equal(boss.health, 18 - shot);
    assert.equal(boss.lifecycleState, EnemyLifecycleState.Ready);
  }
  hit(boss);
  assert.equal(boss.lifecycleState, EnemyLifecycleState.Dying);
  assert.equal(scene.particleSystems.some((system) => system.name === "boss:ashes"), false);
  boss.updateCombatEffects(0.4);
  assert.equal(boss.visualScale, 1, "boss silhouette must never shrink");
  assert.ok(boss.grayProgress > 0 && boss.grayProgress < 1);
  assert.equal(boss.fadeProgress, 0, "graying precedes the fade");
  assert.equal(scene.particleSystems.some((system) => system.name === "boss:ashes"), false);
  boss.updateCombatEffects(0.3);
  assert.equal(boss.grayProgress, 1);
  assert.ok(boss.fadeProgress > 0);
  assert.equal(boss.visualScale, 1);
  assert.equal(scene.particleSystems.some((system) => system.name === "boss:ashes"), true);
  boss.updateCombatEffects(1);
  assert.equal(boss.root.isEnabled(), false, "boss fades out after ashes start");
  assert.equal(boss.visualScale, 1);
  boss.updateCombatEffects(1.2);
  assert.equal(boss.lifecycleState, EnemyLifecycleState.Disposed);

  const eyeMesh = MeshBuilder.CreateBox("eye:body", { size: 1 }, scene);
  const eyeMaterial = new PBRMaterial("eye:material", scene);
  eyeMaterial.unlit = true;
  eyeMaterial.emissiveIntensity = 3;
  eyeMesh.material = eyeMaterial;
  const skyEye = new TestSkyEye(
    {
      scene,
      asset: {
        rootNodes: [eyeMesh],
        nodes: [eyeMesh],
        meshes: [eyeMesh],
        skeletons: [],
        animationGroups: [],
        materials: [eyeMaterial],
      },
    },
    { id: "eye", type: SKY_EYE_TYPE, position: Vector3.Zero() },
    createSkyEyeConfig({ fxQuality: "off" }),
    () => Vector3.Zero(),
    null as never
  );
  await skyEye.initialize();
  const originalProcessing = eyeMaterial.imageProcessingConfiguration;
  hit(skyEye, 18);
  skyEye.updateCombatEffects(0.55);
  assert.notEqual(eyeMaterial.imageProcessingConfiguration, originalProcessing);
  assert.equal(eyeMaterial.imageProcessingConfiguration.colorCurves?.globalSaturation, -100);
  assert.equal(eyeMaterial.alpha, 1, "the gray silhouette remains solid before fading");
  assert.ok(eyeMaterial.emissiveIntensity < 3);
  skyEye.updateCombatEffects(0.55);
  assert.equal(skyEye.visualScale, 1);
  assert.equal(eyeMaterial.transparencyMode, Material.MATERIAL_ALPHABLEND);
  assert.ok(eyeMaterial.alpha > 0 && eyeMaterial.alpha < 1);
  skyEye.updateCombatEffects(2);
  assert.equal(skyEye.lifecycleState, EnemyLifecycleState.Disposed);

  scene.dispose();
  engine.dispose();

  const elementIds = [
    "minorEnemyHealthHud",
    "minorEnemyHealthTrack",
    "minorEnemyHealthFill",
    "bossEnemyHealthHud",
    "bossEnemyHealthArt",
  ];
  function fakeElement() {
    const events = new EventTarget();
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    return {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        toggle(name: string, visible: boolean) {
          if (visible) classes.add(name);
          else classes.delete(name);
        },
        contains: (name: string) => classes.has(name),
      },
      style: { transform: "" },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      getBoundingClientRect: () => ({}),
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      getAttribute: (name: string) => attributes.get(name),
    };
  }
  const elements = new Map(elementIds.map((id) => [id, fakeElement()]));
  const svgElements = new Map([
    ["#boss-hud", fakeElement()],
    ["#boss-health-fill", fakeElement()],
    ["#boss-damage-flash", fakeElement()],
  ]);
  let flashCount = 0;
  const bossArt = elements.get("bossEnemyHealthArt")! as ReturnType<typeof fakeElement> & {
    contentDocument?: { querySelector: (selector: string) => unknown };
  };
  bossArt.contentDocument = {
    querySelector: (selector: string) => selector === "#boss-damage-flash-animation"
      ? { beginElement: () => flashCount++ }
      : svgElements.get(selector) ?? null,
  };
  Object.assign(globalThis, {
    document: { getElementById: (id: string) => elements.get(id) ?? null },
  });
  const hud = new EnemyHealthHud("boss");
  const minorHud = elements.get("minorEnemyHealthHud")!;
  const minorFill = elements.get("minorEnemyHealthFill")!;
  const bossHud = elements.get("bossEnemyHealthHud")!;
  const bossFill = svgElements.get("#boss-health-fill")!;
  const bossFlash = svgElements.get("#boss-damage-flash")!;
  const bossSvgRoot = svgElements.get("#boss-hud")!;
  assert.equal(minorHud.classList.contains("visible"), false);
  assert.equal(bossFill.getAttribute("width"), "990", "the authored SVG preview must load at full health");
  window.dispatchEvent(new CustomEvent("bosque:enemy-hit", {
    detail: { id: "minor", health: 0.5, maxHealth: 1.5 },
  }));
  assert.equal(minorHud.classList.contains("visible"), true);
  assert.equal(minorFill.style.transform, "scaleX(0.3333333333333333)");
  hud.update(2.5, false, 18, 18);
  assert.equal(minorHud.classList.contains("visible"), false);
  hud.update(0, true, 18, 18);
  assert.equal(bossHud.classList.contains("visible"), true);
  hud.update(0, true, 17, 18);
  assert.equal(bossFill.getAttribute("width"), String(990 * 17 / 18));
  assert.equal(bossFlash.getAttribute("x"), String(145 + 990 * 17 / 18));
  assert.equal(bossFlash.getAttribute("width"), "55");
  assert.equal(flashCount, 1);
  window.dispatchEvent(new CustomEvent("bosque:enemy-hit", {
    detail: { id: "boss", health: 16, maxHealth: 18 },
  }));
  assert.equal(bossFill.getAttribute("width"), "880");
  assert.equal(flashCount, 2, "each hit restarts the damage flash");
  assert.equal(bossSvgRoot.classList.contains("taking-damage"), true);
  window.dispatchEvent(new CustomEvent("bosque:enemy-hit", {
    detail: { id: "boss", health: 0, maxHealth: 18 },
  }));
  hud.update(0, false, 0, 18);
  assert.equal(bossHud.classList.contains("visible"), true, "the final hit stays visible briefly");
  assert.equal(bossSvgRoot.classList.contains("defeated"), true);
  assert.equal(bossHud.getAttribute("aria-valuenow"), "0");
  hud.update(1.2, false, 0, 18);
  assert.equal(bossHud.classList.contains("visible"), false);
  hud.dispose();

  bossArt.contentDocument = undefined;
  const lateHud = new EnemyHealthHud("boss");
  lateHud.update(0, true, 18, 18);
  window.dispatchEvent(new CustomEvent("bosque:enemy-hit", {
    detail: { id: "boss", health: 17, maxHealth: 18 },
  }));
  const flashesBeforeLoad = flashCount;
  bossArt.contentDocument = {
    querySelector: (selector: string) => selector === "#boss-damage-flash-animation"
      ? { beginElement: () => flashCount++ }
      : svgElements.get(selector) ?? null,
  };
  bossArt.dispatchEvent(new Event("load"));
  assert.equal(bossFill.getAttribute("width"), "935", "late SVG load must catch up with current health");
  assert.equal(flashCount, flashesBeforeLoad + 1, "damage before SVG load must still flash");
  lateHud.dispose();

  console.log("Enemy combat: 2/18 hits, gray-to-ash boss death and SVG HUD OK");
}

await verify();
