import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { EnemyHealthHud } from "../src/game/EnemyHealthHud.ts";
import { BaseEnemyController } from "../src/game/enemies/core/EnemyController.ts";
import { getDeferredSceneDisposalStats } from "../src/game/enemies/core/DeferredSceneDisposal.ts";
import { HermanoMayorGrabAttack } from "../src/game/enemies/boss/HermanoMayorGrabAttack.ts";
import {
  createHermanoMayorAxeHandle,
  createHermanoMayorHandGripSocket,
  HERMANO_MAYOR_AXE_APPROACH_DISTANCE_FROM_GRIP,
  HERMANO_MAYOR_AXE_GRIP_LOWER_METERS,
  HERMANO_MAYOR_AXE_GRIP_TOWARD_THUMB_METERS,
  HERMANO_MAYOR_AXE_WORLD_LENGTH,
} from "../src/game/enemies/boss/HermanoMayorAxe.ts";
import {
  HERMANO_MAYOR_AXE_PICKUP_ANIMATION,
  HERMANO_MAYOR_AXE_PICKUP_TIMING,
  HERMANO_MAYOR_AXE_READY_WRIST_ROLL_DEGREES,
} from "../src/game/enemies/boss/HermanoMayorAxePickupAction.ts";
import {
  HERMANO_MAYOR_AXE_PICKUP_TRIGGER_RADIUS,
  HermanoMayorBehavior,
} from "../src/game/enemies/boss/HermanoMayorBehavior.ts";
import {
  EnemyLifecycleState,
  type EnemyControllerContext,
} from "../src/game/enemies/core/EnemyTypes.ts";
import { createSkyEyeConfig, SKY_EYE_TYPE } from "../src/game/enemies/skyEye/SkyEyeConfig.ts";
import { SkyEyeController } from "../src/game/enemies/skyEye/SkyEyeController.ts";
import { getSkyEyePortalDeathProgress } from "../src/game/enemies/skyEye/SkyEyeFxController.ts";
import { getSkyEyePresentationProgress } from "../src/game/levels/TerminalSkyEyeEncounter.ts";
import {
  ShadowGrabberBehavior,
  ShadowGrabberBehaviorState,
  type ShadowGrabberGameplayEvent,
} from "../src/game/enemies/shadowGrabber/ShadowGrabberBehavior.ts";
import { ShadowGrabberCoordinator } from "../src/game/enemies/shadowGrabber/ShadowGrabberCoordinator.ts";
import { DEFAULT_SHADOW_GRABBER_CONFIG } from "../src/game/enemies/shadowGrabber/ShadowGrabberConfig.ts";
import { ShadowGrabberLightQuery } from "../src/game/enemies/shadowGrabber/ShadowGrabberLightQuery.ts";

// The boss systems emit browser events and own audio elements. Lightweight
// EventTarget-backed doubles are enough for deterministic NullEngine checks.
const playedAudioSources: string[] = [];
class TestAudio extends EventTarget {
  loop = false;
  preload = "";
  currentTime = 0;
  volume = 1;
  muted = false;

  constructor(public readonly src = "") {
    super();
  }

  play() {
    playedAudioSources.push(this.src);
    return Promise.resolve();
  }

  pause() {}
}

Object.assign(globalThis, {
  window: new EventTarget(),
  Audio: TestAudio,
});

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
  const axeRoot = new TransformNode("test-axe-root", scene);
  axeRoot.position.set(4, 1, 9);
  const axeMesh = MeshBuilder.CreateBox(
    "test-axe-mesh",
    { width: 0.1, height: 2, depth: 0.1 },
    scene
  );
  axeMesh.parent = axeRoot;
  const disposedPickupEffects: string[] = [];
  const pickupSurfaceCenter = new Vector3(4, 1, 10);
  const axe = createHermanoMayorAxeHandle({
    scene,
    root: axeRoot,
    meshes: [axeMesh],
    sourceBounds: {
      min: new Vector3(-0.05, -1, -0.05),
      max: new Vector3(0.05, 1, 0.05),
    },
    pickupSurfaceCenter,
    interaction: { dispose: () => disposedPickupEffects.push("interaction") },
    pickupLight: { dispose: () => disposedPickupEffects.push("light") },
    pickupFlare: { dispose: () => disposedPickupEffects.push("flare") },
  });
  const axeGripBeforePickup = Vector3.Zero();
  const axeApproachBeforePickup = Vector3.Zero();
  const axeTableCenterBeforePickup = Vector3.Zero();
  assert.equal(axe.getGripWorldPositionToRef(axeGripBeforePickup), true);
  assert.equal(
    axe.getPickupTableCenterWorldPositionToRef(axeTableCenterBeforePickup),
    true
  );
  assert.deepEqual(
    axeTableCenterBeforePickup.asArray(),
    pickupSurfaceCenter.asArray()
  );
  assert.equal(
    axe.getPickupApproachWorldPositionToRef(axeApproachBeforePickup),
    true
  );
  assert.ok(
    Math.abs(
      Math.hypot(
        axeApproachBeforePickup.x - axeGripBeforePickup.x,
        axeApproachBeforePickup.z - axeGripBeforePickup.z
      ) - HERMANO_MAYOR_AXE_APPROACH_DISTANCE_FROM_GRIP
    ) < 0.000001,
    "the authored table approach must sit at a fixed distance beyond the handle base"
  );
  assert.ok(
    Vector3.Dot(
      axeApproachBeforePickup.subtract(axeGripBeforePickup),
      axeGripBeforePickup.subtract(pickupSurfaceCenter)
    ) > 0,
    "the table approach must extend outward from the tabletop center"
  );
  const handSocket = new TransformNode("test-hand-socket", scene);
  handSocket.position.set(3, 2, 1);
  // Reproduce the negative determinant introduced by the boss GLB root.
  handSocket.scaling.set(0.75, 0.75, -0.75);
  axeMesh.computeWorldMatrix(true);
  const axeDeterminantBeforePickup = axeMesh.getWorldMatrix().determinant();
  assert.equal(axe.attachToHandSocket(handSocket), true);
  assert.equal(axe.attached, true);
  assert.deepEqual(disposedPickupEffects.sort(), ["flare", "interaction", "light"]);
  const axeGrip = Vector3.Zero();
  axe.getGripWorldPositionToRef(axeGrip);
  handSocket.computeWorldMatrix(true);
  assert.ok(
    Vector3.Distance(
      axeGrip,
      handSocket.getAbsolutePosition().add(
        new Vector3(0, -HERMANO_MAYOR_AXE_GRIP_LOWER_METERS, 0)
      ).add(
        Vector3.TransformNormal(Vector3.Right(), handSocket.getWorldMatrix())
          .normalize()
          .scale(HERMANO_MAYOR_AXE_GRIP_TOWARD_THUMB_METERS)
      )
    ) < 0.000001,
    "the axe grip must sit just below the palm socket"
  );
  axeRoot.computeWorldMatrix(true);
  const axeWorldLength = Vector3.Distance(
    Vector3.TransformCoordinates(new Vector3(0, -1, 0), axeRoot.getWorldMatrix()),
    Vector3.TransformCoordinates(new Vector3(0, 1, 0), axeRoot.getWorldMatrix())
  );
  assert.ok(
    Math.abs(axeWorldLength - HERMANO_MAYOR_AXE_WORLD_LENGTH) < 0.000001,
    "the equipped axe must retain its length at any angle"
  );
  assert.equal(
    Math.sign(axeMesh.getWorldMatrix().determinant()),
    Math.sign(axeDeterminantBeforePickup),
    "the attachment bridge must preserve the visible axe handedness"
  );
  assert.equal(
    axe.getAttachmentDebugSnapshot(handSocket).lastAttachment
      ?.handednessCompensated,
    true,
    "a mirrored hand hierarchy must activate the handedness bridge"
  );
  assert.equal(
    HERMANO_MAYOR_AXE_PICKUP_ANIMATION.timeline.at(-1)?.time,
    HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd
  );
  assert.ok(
    HERMANO_MAYOR_AXE_PICKUP_TIMING.settleEnd >= 4.5,
    "the pickup cinematic must leave time to read hand contact, grip and lift"
  );
  assert.ok(
    HERMANO_MAYOR_AXE_PICKUP_TIMING.gripEnd -
      HERMANO_MAYOR_AXE_PICKUP_TIMING.palmContactAt >=
      0.75,
    "the fingers must visibly close after the palm reaches the handle"
  );
  assert.equal(
    HERMANO_MAYOR_AXE_READY_WRIST_ROLL_DEGREES,
    45,
    "the equipped wrist must hold the index-thumb line at a forty-five-degree carry angle"
  );
  assert.ok(
    Object.keys(HERMANO_MAYOR_AXE_PICKUP_ANIMATION.poses["axe-grip"].bones)
      .filter((bone) => bone.includes("RightHand"))
      .length >= 16,
    "the grip pose must curl the hand and every right-hand finger chain"
  );
  const rightHand = new TransformNode("test-right-hand", scene);
  const fingerBases = [
    [3.758, 10.071, -0.678],
    [1.224, 9.739, -0.994],
    [-0.921, 9.879, -0.095],
    [-2.793, 9.564, 0.414],
  ].map(([x, y, z], index) => {
    const fingerBase = new TransformNode(`test-finger-base-${index}`, scene);
    fingerBase.parent = rightHand;
    fingerBase.position.set(x, y, z);
    return fingerBase;
  });
  const anatomicalGripSocket = createHermanoMayorHandGripSocket(
    scene,
    rightHand,
    fingerBases
  );
  assert.ok(
    anatomicalGripSocket.position.x > 2 &&
      anatomicalGripSocket.position.x < 2.25,
    "the handle must enter through the index-thumb web instead of the finger center"
  );
  assert.ok(
    anatomicalGripSocket.position.z > 1 &&
      anatomicalGripSocket.position.z < 1.5,
    "the handle must sit inside the thumb web instead of floating in front of the palm"
  );
  assert.ok(
    HERMANO_MAYOR_AXE_PICKUP_ANIMATION.poses["axe-grip"].bones[
      "mixamorig:RightHandThumb1"
    ].rotationOffset[2] < 0,
    "the thumb must close across the handle instead of opening away from it"
  );
  for (const finger of ["Index", "Middle", "Ring", "Pinky"]) {
    for (const phalanx of [1, 2, 3]) {
      const bone = `mixamorig:RightHand${finger}${phalanx}`;
      assert.ok(
        HERMANO_MAYOR_AXE_PICKUP_ANIMATION.poses["axe-grip"].bones[
          bone
        ].rotationOffset[0] > 0,
        `${bone} must curl toward the palm on positive local X`
      );
    }
  }
  const readyWristRotation =
    HERMANO_MAYOR_AXE_PICKUP_ANIMATION.poses["axe-ready"].bones[
      "mixamorig:RightHand"
    ].rotationOffset;
  rightHand.rotationQuaternion = new Quaternion(...readyWristRotation);
  // Reconstruct the boss's actual rest hierarchy and ready pose. This catches
  // an axe that points forward on a neutral test hand but backward on the GLB.
  const bossGlb = readFileSync(
    "public/assets/models/enemies/boss/Hermano_mayor_Final_NLA.glb"
  );
  const bossGltf = JSON.parse(
    bossGlb.subarray(20, 20 + bossGlb.readUInt32LE(12)).toString()
  ) as {
    nodes: {
      name?: string;
      translation?: number[];
      rotation?: number[];
      scale?: number[];
      children?: number[];
    }[];
  };
  const bossNodes = bossGltf.nodes.map((source, index) => {
    const node = new TransformNode(source.name ?? `boss-rest-${index}`, scene);
    node.position.copyFrom(Vector3.FromArray(source.translation ?? [0, 0, 0]));
    node.rotationQuaternion = Quaternion.FromArray(
      source.rotation ?? [0, 0, 0, 1]
    );
    node.scaling.copyFrom(Vector3.FromArray(source.scale ?? [1, 1, 1]));
    return node;
  });
  bossGltf.nodes.forEach((source, index) => {
    for (const child of source.children ?? []) bossNodes[child].parent = bossNodes[index];
  });
  const mirroredImportRoot = new TransformNode("boss-test-import-root", scene);
  mirroredImportRoot.scaling.z = -1;
  bossNodes.find((node) => node.name === "HermanoMayor_Armature")!.parent =
    mirroredImportRoot;
  for (const [boneName, bonePose] of Object.entries(
    HERMANO_MAYOR_AXE_PICKUP_ANIMATION.poses["axe-ready"].bones
  )) {
    const node = bossNodes.find((candidate) => candidate.name === boneName);
    if (!node) continue;
    node.rotationQuaternion = node.rotationQuaternion!.multiply(
      new Quaternion(...bonePose.rotationOffset)
    );
  }
  const bossHand = bossNodes.find(
    (node) => node.name === "mixamorig:RightHand"
  )!;
  const bossHandSocket = createHermanoMayorHandGripSocket(scene, bossHand);
  const wristRotationBeforeAttachment = bossHand.rotationQuaternion!.clone();
  const forwardAxeRoot = new TransformNode("test-forward-axe-root", scene);
  const forwardAxeMesh = MeshBuilder.CreateBox(
    "test-forward-axe-mesh",
    { width: 0.1, height: 2, depth: 0.1 },
    scene
  );
  forwardAxeMesh.parent = forwardAxeRoot;
  const forwardAxe = createHermanoMayorAxeHandle({
    scene,
    root: forwardAxeRoot,
    meshes: [forwardAxeMesh],
    sourceBounds: {
      min: new Vector3(-0.05, -1, -0.05),
      max: new Vector3(0.05, 1, 0.05),
    },
  });
  assert.equal(forwardAxe.attachToHandSocket(bossHandSocket), true);
  assert.ok(
    Math.abs(Quaternion.Dot(wristRotationBeforeAttachment, bossHand.rotationQuaternion!)) >
      0.999999,
    "turning the axe must not rotate the boss's wrist"
  );
  const metalDirection = Vector3.Zero();
  assert.equal(
    forwardAxe.getGripWorldAxesToRef(Vector3.Zero(), metalDirection, Vector3.Zero()),
    true
  );
  assert.ok(
    metalDirection.normalize().z < -0.65,
    "the metal head must point toward the imported character's visible front"
  );
  assert.ok(
    metalDirection.y < -0.45,
    "the metal head must descend from the grip"
  );
  const bossGripPosition = Vector3.Zero();
  forwardAxe.getGripWorldPositionToRef(bossGripPosition);
  bossHandSocket.computeWorldMatrix(true);
  assert.ok(
    Vector3.Distance(
      bossGripPosition,
      bossHandSocket.getAbsolutePosition().add(
        new Vector3(0, -HERMANO_MAYOR_AXE_GRIP_LOWER_METERS, 0)
      ).add(
        Vector3.TransformNormal(Vector3.Right(), bossHandSocket.getWorldMatrix())
          .normalize()
          .scale(HERMANO_MAYOR_AXE_GRIP_TOWARD_THUMB_METERS)
      )
    ) < 0.000001,
    "the wooden grip must sit just below the boss's palm"
  );

  const pickupRoot = new TransformNode("test-axe-pickup-root", scene);
  const pickupApproach = new Vector3(2, 0, 3);
  const pickupGrip = new Vector3(2, 1, 4);
  const pickupTableCenter = new Vector3(2, 0, 4);
  let pickupState: "unarmed" | "picking-up" = "unarmed";
  let cinematicStartCount = 0;
  const pickupActor = {
    root: pickupRoot,
    meshes: [],
    hasAxe: false,
    hasAxePickupTarget: true,
    playLocomotion: () => {},
    setLookTargetProvider: () => {},
    setNeckGrabPose: () => {},
    getNeckGrabDebugSnapshot: () => null,
    getAxePickupState: () => pickupState,
    getAxeApproachPositionToRef: (result: Vector3) => {
      result.copyFrom(pickupApproach);
      return true;
    },
    getAxeGripPositionToRef: (result: Vector3) => {
      result.copyFrom(pickupGrip);
      return true;
    },
    getAxePickupTableCenterPositionToRef: (result: Vector3) => {
      result.copyFrom(pickupTableCenter);
      return true;
    },
    startAxePickup: () => {
      pickupState = "picking-up";
      return true;
    },
    cancelAxePickup: () => {
      pickupState = "unarmed";
      return true;
    },
    getAxePickupDebugSnapshot: () => ({ state: pickupState }),
  } as never;
  const pickupBehavior = new HermanoMayorBehavior({
    actor: pickupActor,
    playerPosition: () => new Vector3(8, 0, 8),
    playerNeckPosition: () => new Vector3(8, 1.6, 8),
    houseBounds: { min: new Vector3(-1, -1, -1), max: new Vector3(1, 1, 1) },
    visionRange: 30,
    getGroundHeight: () => 0,
    isBlocked: () => false,
    hasLineOfSight: () => true,
    isVisibleToPlayer: () => true,
    canGrabPlayer: () => true,
    wasGrabEscapePressed: () => false,
    setGrabVictimPose: () => {},
    setGrabEscapeHud: () => {},
    onGrabStarted: () => {},
    onGrabDamage: () => {},
    beginAxePickupCinematic: () => {
      cinematicStartCount += 1;
      return true;
    },
  });
  playedAudioSources.length = 0;
  pickupBehavior.playNearbyUnseenCue();
  assert.ok(
    playedAudioSources.some((source) =>
      source.endsWith("HermanoMayor_cercano_no_visible.mp3")
    ),
    "the authored forest sighting must play the nearby/off-camera boss cue"
  );
  assert.equal(
    pickupBehavior.forceAxePickup(),
    true,
    "reaching the axe table must start pickup even when the boss arrives misaligned"
  );
  assert.equal(cinematicStartCount, 1);
  assert.equal(pickupState, "picking-up");
  assert.ok(
    Math.abs(pickupRoot.rotation.y - Math.atan2(0, 1)) < 0.000001,
    "the table transition must align the boss exactly toward the axe"
  );
  pickupBehavior.dispose();

  const pursuitRoot = new TransformNode("test-player-first-axe-pickup-root", scene);
  pursuitRoot.position.set(0, 0, 0);
  pursuitRoot.rotation.y = 0;
  const pursuitTableCenter = new Vector3(0, 0, 4);
  const pursuitAxeGrip = new Vector3(0, 1, 4);
  const pursuitAxeApproach = new Vector3(0, 0, 2.95);
  let pursuitPlayerPosition = Vector3.Zero();
  let pursuitPickupState: "unarmed" | "picking-up" = "unarmed";
  let pursuitCinematicStarts = 0;
  let axeLineOfSightOpen = true;
  const pursuitBehavior = new HermanoMayorBehavior({
    actor: {
      root: pursuitRoot,
      meshes: [],
      hasAxe: false,
      hasAxePickupTarget: true,
      playLocomotion: () => {},
      setLookTargetProvider: () => {},
      setNeckGrabPose: () => {},
      getNeckGrabDebugSnapshot: () => null,
      getAxePickupState: () => pursuitPickupState,
      getAxeApproachPositionToRef: (result: Vector3) => {
        result.copyFrom(pursuitAxeApproach);
        return true;
      },
      getAxeGripPositionToRef: (result: Vector3) => {
        result.copyFrom(pursuitAxeGrip);
        return true;
      },
      getAxePickupTableCenterPositionToRef: (result: Vector3) => {
        result.copyFrom(pursuitTableCenter);
        return true;
      },
      startAxePickup: () => {
        pursuitPickupState = "picking-up";
        return true;
      },
      cancelAxePickup: () => {
        pursuitPickupState = "unarmed";
        return true;
      },
      getAxePickupDebugSnapshot: () => ({ state: pursuitPickupState }),
    } as never,
    playerPosition: () => pursuitPlayerPosition,
    playerNeckPosition: () =>
      pursuitPlayerPosition.add(new Vector3(0, 1.6, 0)),
    houseBounds: { min: new Vector3(-1, -1, -1), max: new Vector3(1, 1, 1) },
    visionRange: 30,
    getGroundHeight: () => 0,
    isBlocked: () => false,
    hasLineOfSight: (_origin, target) =>
      target.z < pursuitTableCenter.z - 0.5 || axeLineOfSightOpen,
    isVisibleToPlayer: () => true,
    canGrabPlayer: () => true,
    wasGrabEscapePressed: () => false,
    setGrabVictimPose: () => {},
    setGrabEscapeHud: () => {},
    onGrabStarted: () => {},
    onGrabDamage: () => {},
    beginAxePickupCinematic: () => {
      pursuitCinematicStarts += 1;
      return true;
    },
  });

  pursuitBehavior.update(0.05);
  pursuitPlayerPosition = new Vector3(4, 0, 0);
  pursuitBehavior.update(0.05);
  assert.equal(pursuitBehavior.currentState, "following");
  assert.ok(
    pursuitRoot.position.x > 0,
    "leaving the house must make the unarmed boss pursue the player, not the axe"
  );
  assert.equal(pursuitPickupState, "unarmed");
  assert.equal(pursuitCinematicStarts, 0);

  pursuitRoot.position.set(
    0,
    0,
    pursuitTableCenter.z - HERMANO_MAYOR_AXE_PICKUP_TRIGGER_RADIUS + 0.1
  );
  pursuitRoot.rotation.y = Math.PI;
  pursuitPlayerPosition = new Vector3(0, 0, -4);
  pursuitBehavior.update(0.05);
  assert.equal(
    pursuitPickupState,
    "unarmed",
    "being inside the table radius must not count when the axe is behind the boss"
  );

  pursuitRoot.position.set(0, 0, 1.6);
  pursuitRoot.rotation.y = 0;
  axeLineOfSightOpen = false;
  pursuitBehavior.update(0.05);
  assert.equal(
    pursuitPickupState,
    "unarmed",
    "the table radius must not bypass an occluded axe"
  );

  pursuitRoot.position.set(0, 0, 1.6);
  pursuitRoot.rotation.y = 0;
  pursuitPlayerPosition = new Vector3(0, 0, 2.8);
  axeLineOfSightOpen = true;
  assert.equal(pursuitBehavior.forceGrab(), true);
  pursuitBehavior.update(0.05);
  assert.equal(pursuitBehavior.currentState, "grabbing");
  assert.equal(
    pursuitPickupState,
    "unarmed",
    "a reachable player must keep grab priority over the visible axe"
  );
  assert.equal(pursuitCinematicStarts, 0);

  pursuitBehavior.stun(0.05);
  pursuitRoot.position.set(0, 0, 1.6);
  pursuitRoot.rotation.y = 0;
  pursuitPlayerPosition = new Vector3(0, 0, -4);
  axeLineOfSightOpen = true;
  pursuitBehavior.update(0.05);
  assert.equal(pursuitPickupState, "picking-up");
  assert.equal(pursuitCinematicStarts, 1);
  assert.deepEqual(pursuitRoot.position.asArray(), pursuitAxeApproach.asArray());
  pursuitBehavior.dispose();

  const recoveryRoot = new TransformNode("test-boss-navigation-recovery-root", scene);
  recoveryRoot.position.set(0, 0, 0);
  recoveryRoot.rotation.y = 0;
  let recoveryPlayerPosition = Vector3.Zero();
  const recoveryBehavior = new HermanoMayorBehavior({
    actor: {
      root: recoveryRoot,
      meshes: [],
      hasAxe: false,
      hasAxePickupTarget: false,
      playLocomotion: () => {},
      setLookTargetProvider: () => {},
      setNeckGrabPose: () => {},
      getNeckGrabDebugSnapshot: () => null,
      getAxePickupState: () => "unarmed",
      getAxeApproachPositionToRef: () => false,
      getAxeGripPositionToRef: () => false,
      getAxePickupTableCenterPositionToRef: () => false,
      startAxePickup: () => false,
      cancelAxePickup: () => false,
      getAxePickupDebugSnapshot: () => ({ state: "unarmed" }),
    } as never,
    playerPosition: () => recoveryPlayerPosition,
    playerNeckPosition: () =>
      recoveryPlayerPosition.add(new Vector3(0, 1.6, 0)),
    houseBounds: { min: new Vector3(-1, -1, -1), max: new Vector3(1, 1, 1) },
    visionRange: 30,
    getGroundHeight: () => 0,
    // A narrow collision seam falls between the navigator's regular samples.
    // Movement detects it, reports the stall and must force a lateral detour.
    isBlocked: (x, z) => x >= 0.26 && x <= 0.39 && Math.abs(z) <= 0.5,
    hasLineOfSight: () => false,
    isVisibleToPlayer: () => true,
    canGrabPlayer: () => true,
    wasGrabEscapePressed: () => false,
    setGrabVictimPose: () => {},
    setGrabEscapeHud: () => {},
    onGrabStarted: () => {},
    onGrabDamage: () => {},
  });
  recoveryBehavior.update(0.05);
  recoveryPlayerPosition = new Vector3(4, 0, 0);
  let maximumRecoveryDetour = 0;
  for (let step = 0; step < 240 && recoveryRoot.position.x < 2; step++) {
    recoveryBehavior.update(0.05);
    maximumRecoveryDetour = Math.max(
      maximumRecoveryDetour,
      Math.abs(recoveryRoot.position.z)
    );
  }
  const recoveryDebug = recoveryBehavior.getGrabDebugSnapshot().navigation;
  assert.ok(
    recoveryDebug.recoveryCount >= 1,
    "a sustained collision must invalidate the stuck route"
  );
  assert.ok(
    maximumRecoveryDetour > 0.5,
    "the recalculated route must leave the invisible collision seam laterally"
  );
  assert.ok(
    recoveryRoot.position.x >= 2,
    "the boss must resume progress toward the player after replanning"
  );
  recoveryBehavior.dispose();

  const grabberRoot = {
    position: Vector3.Zero(),
    rotation: Vector3.Zero(),
  };
  const grabTarget = new Vector3(0, 0, 1.7);
  const grabTargetNeck = new Vector3(0, 1.62, 1.7);
  let latestGrabPose: { shake: number } | null = null;
  let victimRestrained = false;
  const grabDamageFractions: number[] = [];
  const neckGrab = new HermanoMayorGrabAttack({
    actor: {
      root: grabberRoot,
      setNeckGrabPose: (pose: { shake: number } | null) => {
        latestGrabPose = pose ? { shake: pose.shake } : null;
      },
      getNeckGrabDebugSnapshot: () => null,
    } as never,
    playerPosition: () => grabTarget,
    playerNeckPosition: () => grabTargetNeck,
    canCapturePlayer: () => true,
    wasEscapePressed: () => false,
    setVictimPose: (active) => {
      victimRestrained = active;
    },
    setEscapeHud: () => {},
    onGrabStarted: () => {},
    onGrabDamage: (fractionOfMaxHealth) => {
      grabDamageFractions.push(fractionOfMaxHealth);
    },
  });
  for (let step = 0; step < 25; step++) neckGrab.update(0.05, true, 1.7);
  assert.equal(
    neckGrab.currentState,
    "idle",
    "the neck grab must not start from the old oversized range"
  );
  grabTarget.z = 1.55;
  grabTargetNeck.z = 1.55;
  neckGrab.update(0.05, true, 1.55);
  assert.equal(neckGrab.currentState, "windup");
  for (let step = 0; step < 10; step++) {
    grabTarget.z = grabberRoot.position.z + 2;
    grabTargetNeck.z = grabTarget.z;
    neckGrab.update(0.05, true, 2);
  }
  assert.equal(
    neckGrab.currentState,
    "windup",
    "the attack must not capture while the neck remains outside contact range"
  );
  assert.equal(victimRestrained, false);
  grabTarget.z = grabberRoot.position.z + 1;
  grabTargetNeck.z = grabTarget.z;
  neckGrab.update(0.05, true, 1);
  assert.equal(neckGrab.currentState, "lifting");
  assert.ok(
    Math.abs(grabTarget.z - grabberRoot.position.z) <= 1.03,
    "the attacker must close to neck-grab distance before restraining the player"
  );
  assert.equal(victimRestrained, true);
  neckGrab.update(0.05, true, 1.55);
  assert.ok(
    (latestGrabPose?.shake ?? 0) > 0,
    "the attacker shake must begin during the lift"
  );
  assert.deepEqual(
    grabDamageFractions,
    [0.05],
    "capture starts with five percent max-health damage"
  );
  neckGrab.simulateEscapePress();
  neckGrab.update(0.05, true, 1);
  const progressAfterPress = neckGrab.getDebugSnapshot().escapeProgress;
  for (let step = 0; step < 8; step++) neckGrab.update(0.05, true, 1);
  assert.ok(
    neckGrab.getDebugSnapshot().escapeProgress < progressAfterPress,
    "escape progress must drain while the player stops pressing"
  );
  for (let press = 0; press < 12 && neckGrab.isRestrainingPlayer; press++) {
    neckGrab.simulateEscapePress();
    neckGrab.update(0.05, true, 1);
  }
  assert.equal(
    neckGrab.currentState,
    "releasing",
    "a sustained fast input cadence must release the player"
  );
  neckGrab.dispose();

  const damageRoot = {
    position: Vector3.Zero(),
    rotation: Vector3.Zero(),
  };
  const damageFractions: number[] = [];
  let damageVictimRestrained = false;
  const damageGrab = new HermanoMayorGrabAttack({
    actor: {
      root: damageRoot,
      setNeckGrabPose: () => {},
      getNeckGrabDebugSnapshot: () => null,
    } as never,
    playerPosition: () => new Vector3(0, 0, 1),
    playerNeckPosition: () => new Vector3(0, 1.62, 1),
    canCapturePlayer: () => true,
    wasEscapePressed: () => false,
    setVictimPose: (active) => {
      damageVictimRestrained = active;
    },
    setEscapeHud: () => {},
    onGrabStarted: () => {},
    onGrabDamage: (fractionOfMaxHealth) => {
      damageFractions.push(fractionOfMaxHealth);
    },
  });
  damageGrab.forceGrab();
  for (let step = 0; step < 180; step++) damageGrab.update(0.05, true, 1);
  assert.ok(damageVictimRestrained);
  assert.ok(
    Math.abs(damageFractions.reduce((sum, damage) => sum + damage, 0) - 0.4) <
      0.000001,
    "one neck grab must never remove more than forty percent max health"
  );
  assert.equal(damageGrab.getDebugSnapshot().grabDamageFraction, 0.4);
  damageGrab.interrupt("stunned");
  assert.equal(
    damageVictimRestrained,
    false,
    "a stun must interrupt the active grab"
  );
  damageGrab.dispose();

  const candleLights = [
    {
      id: "test-candle",
      position: new Vector3(3, 0, 0),
      lit: true,
      extinguishable: true,
    },
  ];
  let extinguishedCandleId: string | null = null;
  const candleLightQuery = new ShadowGrabberLightQuery(
    [],
    () => candleLights,
    (id) => {
      const candle = candleLights.find((light) => light.id === id && light.lit);
      if (!candle) return false;
      candle.lit = false;
      extinguishedCandleId = id;
      return true;
    },
    () => ({
      enabled: false,
      origin: Vector3.Zero(),
      direction: Vector3.Forward(),
    })
  );
  candleLightQuery.updateCandleLightState();
  candleLightQuery.updateFlashlightState();
  assert.equal(candleLightQuery.sampleFixed(new Vector3(3, 0, 0), 7, 13).hardAvoidance, true);

  const candleHuntEvents: ShadowGrabberGameplayEvent[] = [];
  const candleHunterRoot = {
    position: Vector3.Zero(),
    rotation: Vector3.Zero(),
    scaling: Vector3.One(),
  };
  const candleHunter = new ShadowGrabberBehavior(
    {
      id: "candle-hunter",
      config: DEFAULT_SHADOW_GRABBER_CONFIG,
      enabled: true,
      root: candleHunterRoot,
      getAnchorPosition: () => Vector3.Zero(),
      setAnchorPosition: () => {},
      setPortalCenterWorldPosition: () => {},
      getPortalCenterWorldPositionToRef: (result: Vector3) => {
        result.copyFrom(candleHunterRoot.position);
        return true;
      },
      setState: () => {},
      setFxState: () => {},
      turnToward: () => {},
      getCurrentAnimation: () => "idle",
    } as never,
    {
      groupId: "candle-hunt-test",
      anchorPosition: Vector3.Zero(),
      coordinator: new ShadowGrabberCoordinator(),
      lightQuery: candleLightQuery,
      navigation: {
        getGroundHeight: () => 0,
        isBlocked: () => false,
      },
      applySanityDrain: () => {},
      onEvent: (_id, event) => candleHuntEvents.push(event),
    }
  );
  const candleHuntTarget = {
    position: new Vector3(15, 0, 0),
    groundPosition: new Vector3(15, 0, 0),
    horizontalVelocity: Vector3.Zero(),
    collisionHeight: 1.7,
    sanity: 1,
  };
  for (let step = 0; step < 80 && candleLights[0].lit; step++) {
    candleHunter.update(0.05, candleHuntTarget);
  }
  assert.equal(extinguishedCandleId, "test-candle");
  assert.equal(candleLights[0].lit, false);
  assert.ok(candleHuntEvents.includes("extinguishLight"));
  assert.equal(
    candleLightQuery.sampleFixed(new Vector3(3, 0, 0), 7, 13).hardAvoidance,
    false,
    "an extinguished candle must stop protecting the player"
  );
  candleLights[0].lit = true;
  assert.equal(
    candleLightQuery.sampleFixed(new Vector3(3, 0, 0), 7, 13).hardAvoidance,
    true,
    "relighting a candle must restore its safe-light field"
  );
  candleHunter.dispose();

  const interruptedCaptureEvents: ShadowGrabberGameplayEvent[] = [];
  const interruptedCaptureBehavior = new ShadowGrabberBehavior(
    {
      id: "interrupted-capture",
      config: {
        hoverHeightMin: 1,
        hoverHeightMax: 1,
        roleReassignmentIntervalIdle: 1,
        roleReassignmentIntervalActive: 1,
        roleActivityHysteresisSeconds: 0,
        maxConcurrentAttacks: 1,
      },
      setAnchorPosition: () => {},
      setPortalCenterWorldPosition: () => {},
      setState: () => {},
      setFxState: () => {},
    } as never,
    {
      groupId: "capture-lifecycle-test",
      anchorPosition: Vector3.Zero(),
      coordinator: new ShadowGrabberCoordinator(),
      lightQuery: null as never,
      navigation: {
        getGroundHeight: () => 0,
        isBlocked: () => false,
      },
      applySanityDrain: () => {},
      onEvent: (_id, event) => interruptedCaptureEvents.push(event),
    }
  );
  (
    interruptedCaptureBehavior as unknown as {
      transition: (state: ShadowGrabberBehaviorState) => void;
    }
  ).transition(ShadowGrabberBehaviorState.Grabbing);
  assert.deepEqual(interruptedCaptureEvents, ["grab"]);
  interruptedCaptureBehavior.dispose();
  interruptedCaptureBehavior.dispose();
  assert.deepEqual(
    interruptedCaptureEvents,
    ["grab", "retract"],
    "disposing an active grab must release it exactly once"
  );

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
  const disposalStats = getDeferredSceneDisposalStats(scene);
  assert.equal(
    disposalStats.observerActive,
    true,
    "all defeated enemies share one deferred-disposal observer"
  );
  assert.ok(disposalStats.pendingTasks > 0);
  for (let frame = 0; frame < 64; frame++) {
    scene.onAfterRenderObservable.notifyObservers(scene);
    if (!getDeferredSceneDisposalStats(scene).observerActive) break;
  }
  assert.deepEqual(getDeferredSceneDisposalStats(scene), {
    pendingTasks: 0,
    observerActive: false,
  });

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

  console.log(
    "Enemy combat: collision-stall recovery, player-first pursuit, visible 2.5m table-radius axe pickup, exact axe grip, dynamic grab escape, 40% cap, candle hunting, 2/18 hits, gray-to-ash death and SVG HUD OK"
  );
}

await verify();
