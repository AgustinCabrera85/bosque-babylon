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
import { getSkyEyePortalDeathProgress } from "../src/game/enemies/skyEye/SkyEyeFxController.ts";
import { getSkyEyePresentationProgress } from "../src/game/levels/TerminalSkyEyeEncounter.ts";

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
  const skyEyePortal = createSkyEyeConfig();
  const coreDiameter =
    skyEyePortal.portalVisualScale *
    0.92 *
    skyEyePortal.portalFx.coreDiscScale;
  const smokeOuterDiameter =
    skyEyePortal.portalVisualScale *
    skyEyePortal.portalFx.smokeTorusScale *
    (0.78 * skyEyePortal.portalFx.smokeRadiusScale +
      Math.max(
        0.28,
        Math.min(0.82, skyEyePortal.portalFx.smokeTubeThickness)
      ));
  assert.ok(
    coreDiameter >= 3,
    "the Sky Eye portal background must remain clearly wider than the eye"
  );
  assert.ok(
    Math.abs(coreDiameter - smokeOuterDiameter) <= 0.02,
    "the Sky Eye smoke torus must meet the dark outer edge of the portal disc"
  );
  assert.deepEqual(getSkyEyePresentationProgress(0.31), {
    disc: 1,
    smoke: 0,
    tendrils: 0,
    eye: 0,
  });
  assert.deepEqual(getSkyEyePresentationProgress(0.53), {
    disc: 1,
    smoke: 1,
    tendrils: 0,
    eye: 0,
  });
  assert.deepEqual(getSkyEyePresentationProgress(0.73), {
    disc: 1,
    smoke: 1,
    tendrils: 1,
    eye: 0,
  });
  assert.deepEqual(getSkyEyePresentationProgress(1), {
    disc: 1,
    smoke: 1,
    tendrils: 1,
    eye: 1,
  });
  assert.equal(getSkyEyePortalDeathProgress(0, 0), 0);
  assert.equal(getSkyEyePortalDeathProgress(1, 0), 0.28);
  assert.equal(getSkyEyePortalDeathProgress(1, 0.5), 0.64);
  assert.equal(getSkyEyePortalDeathProgress(1, 1), 1);

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
    "bossEnemyHealthArtPortrait",
    "bossEnemyHealthArtLandscape",
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
  const svgConfigs = [
    { id: "bossEnemyHealthArt", x: 145, width: 990 },
    { id: "bossEnemyHealthArtPortrait", x: 43, width: 394 },
    { id: "bossEnemyHealthArtLandscape", x: 54, width: 652 },
  ];
  const artworks = svgConfigs.map(({ id, x, width }) => {
    const art = elements.get(id)! as ReturnType<typeof fakeElement> & {
      contentDocument?: { querySelector: (selector: string) => unknown };
    };
    const root = fakeElement();
    const fill = fakeElement();
    const flash = fakeElement();
    const fullBar = fakeElement();
    fill.setAttribute("x", String(x));
    fullBar.setAttribute("width", String(width));
    let flashCount = 0;
    const svgElements = new Map([
      ["#boss-hud", root],
      ["#boss-health-fill", fill],
      ["#boss-health-red", fullBar],
      ["#boss-damage-flash", flash],
    ]);
    const document = {
      querySelector: (selector: string) => selector === "#boss-damage-flash-animation"
        ? { beginElement: () => flashCount++ }
        : svgElements.get(selector) ?? null,
    };
    art.contentDocument = document;
    return { art, root, fill, flash, document, x, width, get flashCount() { return flashCount; } };
  });
  Object.assign(globalThis, {
    document: { getElementById: (id: string) => elements.get(id) ?? null },
  });
  const hud = new EnemyHealthHud("boss");
  const minorHud = elements.get("minorEnemyHealthHud")!;
  const minorFill = elements.get("minorEnemyHealthFill")!;
  const bossHud = elements.get("bossEnemyHealthHud")!;
  assert.equal(minorHud.classList.contains("visible"), false);
  for (const artwork of artworks) {
    assert.equal(artwork.fill.getAttribute("width"), String(artwork.width), "each SVG preview must load at full health");
  }
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
  for (const artwork of artworks) {
    assert.equal(artwork.fill.getAttribute("width"), String(Math.round(artwork.width * 17 / 18 * 100) / 100));
    assert.equal(artwork.flash.getAttribute("x"), String(Math.round((artwork.x + artwork.width * 17 / 18) * 100) / 100));
    assert.equal(artwork.flash.getAttribute("width"), String(Math.round(artwork.width / 18 * 100) / 100));
    assert.equal(artwork.flashCount, 1);
  }
  window.dispatchEvent(new CustomEvent("bosque:enemy-hit", {
    detail: { id: "boss", health: 16, maxHealth: 18 },
  }));
  for (const artwork of artworks) {
    assert.equal(artwork.fill.getAttribute("width"), String(Math.round(artwork.width * 16 / 18 * 100) / 100));
    assert.equal(artwork.flashCount, 2, "each hit restarts the damage flash in every layout");
    assert.equal(artwork.root.classList.contains("taking-damage"), true);
  }
  window.dispatchEvent(new CustomEvent("bosque:enemy-hit", {
    detail: { id: "boss", health: 0, maxHealth: 18 },
  }));
  hud.update(0, false, 0, 18);
  assert.equal(bossHud.classList.contains("visible"), true, "the final hit stays visible briefly");
  for (const artwork of artworks) assert.equal(artwork.root.classList.contains("defeated"), true);
  assert.equal(bossHud.getAttribute("aria-valuenow"), "0");
  hud.update(1.2, false, 0, 18);
  assert.equal(bossHud.classList.contains("visible"), false);
  hud.dispose();

  for (const artwork of artworks) artwork.art.contentDocument = undefined;
  const lateHud = new EnemyHealthHud("boss");
  lateHud.update(0, true, 18, 18);
  window.dispatchEvent(new CustomEvent("bosque:enemy-hit", {
    detail: { id: "boss", health: 17, maxHealth: 18 },
  }));
  for (const artwork of artworks) {
    const flashesBeforeLoad = artwork.flashCount;
    artwork.art.contentDocument = artwork.document;
    artwork.art.dispatchEvent(new Event("load"));
    assert.equal(artwork.fill.getAttribute("width"), String(Math.round(artwork.width * 17 / 18 * 100) / 100), "late SVG load must catch up with current health");
    assert.equal(artwork.flashCount, flashesBeforeLoad + 1, "damage before SVG load must still flash");
  }
  lateHud.dispose();

  console.log("Enemy combat: 2/18 hits, gray-to-ash boss death and SVG HUD OK");
}

await verify();
