import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { PlayerWorldQuery } from "../../PlayerWorldQuery";
import { PlayerController } from "../../PlayerController";
import { setupPlayerViewControls } from "../../PlayerViewControls";
import { setupMobileControls } from "../../MobileControls";
import type { GameLevel, LevelCreateContext } from "../../runtime/LevelTypes";
import { createSanctuaryGeometry } from "./SanctuaryGeometry";
import {
  readSanctuaryProgress,
  SANCTUARY_CONFIG as CFG,
  SANCTUARY_STOPS,
  type SanctuaryStop,
} from "./SanctuaryLayout";

type VoyageState = "sailing" | "moored" | "ashore";
type RoutePoint = { x: number; z: number };
const BOAT_START: RoutePoint = { x: 0, z: CFG.boatStartZ };
const ROUTE: RoutePoint[] = [
  ...SANCTUARY_STOPS.map(({ x, z }) => ({ x, z })),
  { x: 0, z: CFG.gateStopZ },
];
const isFinalStop = (index: number) => index === SANCTUARY_STOPS.length;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Just enough ground logic to use the actual game locomotion at each landing. */
function createDockWorld(getStage: () => { index: number; state: VoyageState }): PlayerWorldQuery {
  const dockX = (stop: SanctuaryStop) => stop.x + stop.side * 27;
  const finalStepStart = 1220;
  const riseAt = (z: number) =>
    z <= finalStepStart ? 1.55 : 1.55 + Math.min(27, Math.floor((z - finalStepStart) / 12.4)) * .66;
  function finalAllowed(x: number, z: number) {
    return Math.abs(x) <= 52 && z >= CFG.gateLandingZ - 34 && z <= CFG.gateWallZ - 10;
  }
  function dockAllowed(x: number, z: number, stop: SanctuaryStop, clearance = 0) {
    return Math.abs(x - dockX(stop)) <= 26 - clearance &&
      Math.abs(z - stop.z) <= 27 - clearance;
  }
  return {
    getTerrainHeight(x, z) { return this.getWalkableSurfaceHeight(x, z); },
    getWalkableSurfaceHeight(_x, z) {
      const { index } = getStage();
      return isFinalStop(index) ? riseAt(z) : 2.05;
    },
    isColliding(x, z, clearance = 0) {
      const { index, state } = getStage();
      if (state !== "ashore") return false;
      if (isFinalStop(index)) return !finalAllowed(x, z);
      const stop = SANCTUARY_STOPS[index];
      return !stop || !dockAllowed(x, z, stop, clearance);
    },
    resolveCameraPosition(origin: Vector3, desired: Vector3) {
      // Avoid camera ejection by the simple placeholder dock boundary.
      // A raycast resolver can replace this when finished collision meshes exist.
      return desired.clone();
    },
  };
}

function createSanctuaryHud() {
  const root = document.createElement("div");
  root.id = "sanctuaryPrototypeHud";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "off");
  root.style.cssText = [
    "position:fixed", "bottom:7vh", "left:50%", "transform:translateX(-50%)",
    "z-index:30", "pointer-events:none", "max-width:min(640px,90vw)",
    "padding:12px 21px", "border:1px solid rgba(225,145,124,.20)",
    "border-radius:9px", "background:rgba(10,6,11,.70)",
    "color:#e6d5cb", "font:14px/1.5 Georgia,serif", "letter-spacing:.035em",
    "text-align:center", "text-shadow:0 2px 5px #000", "backdrop-filter:blur(8px)",
  ].join(";");
  document.body.appendChild(root);
  return {
    setText(next: string) { if (root.textContent !== next) root.textContent = next; },
    dispose() { root.remove(); },
  };
}

/**
 * PROTOTYPE INTEGRATION POINT
 * - Owns a new Scene; never mutates the existing forest/theatre scenes.
 * - Uses the existing InputManager, PlayerController, MobileControls and LevelManager.
 * - Does not alter the opening voiceover, existing stories or boss progression.
 */
export async function createSanctuaryLevel(context: LevelCreateContext): Promise<GameLevel> {
  const scene = new Scene(context.engine);
  let disposed = false;
  const cleanup: Array<() => void> = [];
  scene.onDisposeObservable.addOnce(() => {
    while (cleanup.length) {
      try { cleanup.pop()?.(); } catch (error) { console.error("Sanctuary cleanup", error); }
    }
  });
  try {
    context.onProgress(.08, "Atravesando la niebla roja...");
    scene.clearColor = new Color4(.19, .033, .037, 1);
    scene.ambientColor = new Color3(.13,.039,.043);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(.26,.05,.055);
    scene.fogDensity = context.performanceTier === "mobile" ? .0007 : .00058;

    const ambient = new HemisphericLight("sanctuaryAmbient", new Vector3(0, 1, 0), scene);
    ambient.intensity = .55;
    ambient.diffuse = new Color3(.78,.30,.28);
    ambient.groundColor = new Color3(.11,.025,.035);
    const upperRed = new DirectionalLight("sanctuaryRedSkyLight", new Vector3(.15,-.9,.2), scene);
    upperRed.diffuse = new Color3(.66,.22,.16);
    upperRed.intensity = .7;

    let progress = readSanctuaryProgress();
    const geometry = createSanctuaryGeometry(scene, progress, context.performanceTier === "mobile");
    context.onProgress(.62, "Reconociendo las columnas cautivas...");
    const hud = createSanctuaryHud();
    cleanup.push(hud.dispose);

    let targetIndex = 0;
    let state: VoyageState = "sailing";
    let boatFrom: RoutePoint = BOAT_START;
    let routeT = 0;
    let routeDuration = Math.hypot(ROUTE[0].x - BOAT_START.x, ROUTE[0].z - BOAT_START.z) / CFG.boatSpeed;
    let elapsed = 0;
    let refreshProgressSeconds = 0;
    let transitionQueued = false;
    const playerWorld = createDockWorld(() => ({ index: targetIndex, state }));

    const player = new PlayerController(scene, context.canvas, context.input, {
      eyeHeight: CFG.eyeHeight,
      walkSpeed: 3.5,
      runSpeed: 6.2,
      jumpSpeed: 5,
      gravity: -18,
      jumpingEnabled: false,
      runningEnabled: true,
    }, context.selectedCharacter);
    player.position.set(0, CFG.boatDeckY + CFG.eyeHeight, CFG.boatStartZ - 1.6);
    player.camera.maxZ = 14500;
    await player.loadCharacter();
    cleanup.push(setupPlayerViewControls(player));
    cleanup.push(setupMobileControls(player, context.input));
    scene.metadata ??= {};
    scene.metadata.playerWorld = playerWorld;
    scene.metadata.playerStats = context.playerStats;
    scene.metadata.sanctuary = { prototype: true, routeLength: ROUTE.length, clouds: geometry.cloudMode, water: geometry.waterMode, version: "0.2" };

    const movePlayerOntoBoat = () => {
      player.position.set(geometry.boatRoot.position.x,
        geometry.boatRoot.position.y + CFG.boatDeckY + CFG.eyeHeight,
        geometry.boatRoot.position.z - 1.6);
    };
    const embark = () => {
      if (isFinalStop(targetIndex)) return;
      const previous = ROUTE[targetIndex];
      targetIndex += 1;
      boatFrom = { x: previous.x, z: previous.z };
      const next = ROUTE[targetIndex];
      routeT = 0;
      routeDuration = Math.max(1, Math.hypot(next.x - previous.x, next.z - previous.z) / CFG.boatSpeed);
      state = "sailing";
      movePlayerOntoBoat();
    };
    const disembark = () => {
      if (isFinalStop(targetIndex)) {
        player.position.set(0, 1.55 + CFG.eyeHeight, CFG.gateLandingZ + 3);
      } else {
        const stop = SANCTUARY_STOPS[targetIndex];
        player.position.set(stop.x + stop.side * 24, 2.05 + CFG.eyeHeight, stop.z - 10);
      }
      state = "ashore";
    };
    const portalPoint = (stop: SanctuaryStop) =>
      new Vector3(stop.x + stop.side * 49, 2, stop.z + 8);
    const closeEnoughToPortal = (stop: SanctuaryStop) => {
      const p = portalPoint(stop);
      return Math.hypot(player.position.x - p.x, player.position.z - p.z) < 13;
    };

    const update = (unclampedDt: number) => {
      const dt = Math.min(.05, Math.max(0, unclampedDt));
      elapsed += dt;
      refreshProgressSeconds += dt;
      if (refreshProgressSeconds > 1.5) {
        progress = readSanctuaryProgress();
        refreshProgressSeconds = 0;
      }
      if (state === "sailing") {
        routeT = clamp01(routeT + dt / routeDuration);
        // Smooth passage makes the stops feel ceremonial instead of like a waypoint jump.
        const t = routeT * routeT * (3 - 2 * routeT);
        const next = ROUTE[targetIndex];
        geometry.boatRoot.position.x = boatFrom.x + (next.x - boatFrom.x) * t;
        geometry.boatRoot.position.z = boatFrom.z + (next.z - boatFrom.z) * t;
        movePlayerOntoBoat();
        hud.setText("El río conduce la balsa entre los pilares de sombra...");
        if (routeT >= 1) state = "moored";
      } else if (state === "moored") {
        movePlayerOntoBoat();
        const name = isFinalStop(targetIndex)
          ? "El umbral del Santuario"
          : SANCTUARY_STOPS[targetIndex].title;
        hud.setText(`${name}  ·  ${context.input.getActionBindingLabel("interact") ?? "E"}: desembarcar`);
        if (context.input.wasPressed("interact")) disembark();
      } else {
        player.update(dt, playerWorld);
        const atGate = isFinalStop(targetIndex);
        const stop = atGate ? null : SANCTUARY_STOPS[targetIndex];
        const nearPortal = stop && closeEnoughToPortal(stop);
        if (atGate) {
          hud.setText("El portal del Santuario permanece sellado. El desenlace se implementará más adelante.");
        } else if (nearPortal) {
          const action = stop.destination ? `entrar a «${stop.title}»` : "explorar (pendiente de creación)";
          hud.setText(`${stop.title}  ·  ${context.input.getActionBindingLabel("interact") ?? "E"}: ${action}`);
        } else {
          hud.setText(`${stop?.title ?? ""}  ·  ${context.input.getActionBindingLabel("interact") ?? "E"}: volver a la balsa`);
        }
        if (context.input.wasPressed("interact") && !transitionQueued) {
          if (nearPortal && stop?.destination) {
            transitionQueued = true;
            // Defer disposal-triggering transitions outside this scene update frame.
            queueMicrotask(() => context.requestLevelTransition(stop.destination!, "sanctuary-pillar"));
          } else if (!nearPortal) {
            embark();
          }
        }
      }
      geometry.update(dt, elapsed, progress);
      context.musicPlayer?.updateListenerPosition(player.position);
    };
    context.onProgress(1, "Santuario disponible (prototipo)");

    return {
      id: "sanctuary",
      scene,
      update,
      dispose() {
        if (disposed) return;
        disposed = true;
        if (!scene.isDisposed) scene.dispose();
      },
    };
  } catch (error) {
    if (!scene.isDisposed) scene.dispose();
    throw error;
  }
}
