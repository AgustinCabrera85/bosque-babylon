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
import { createSanctuaryShadowHands } from "./SanctuaryShadowHands";
import {
  readSanctuaryProgress,
  SANCTUARY_CONFIG as CFG,
  SANCTUARY_ASCENT as ASCENT,
  SANCTUARY_STOPS,
  getSanctuaryAscentHeight,
  getSanctuaryStairSurface,
  type SanctuaryStop,
} from "./SanctuaryLayout";

type VoyageState = "sailing" | "moored" | "ashore";
type RoutePoint = { x: number; z: number };
const BOAT_START: RoutePoint = { x: 0, z: CFG.boatStartZ };
const boatDockX = (stop: SanctuaryStop) => stop.x - stop.side * 16;
const ROUTE: RoutePoint[] = [
  ...SANCTUARY_STOPS.map((stop) => ({ x: boatDockX(stop), z: stop.z })),
  { x: 0, z: CFG.gateStopZ },
];
const isFinalStop = (index: number) => index === SANCTUARY_STOPS.length;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Just enough ground logic to use the actual game locomotion at each landing. */
function createDockWorld(getStage: () => { index: number; state: VoyageState }): PlayerWorldQuery {
  const dockX = (stop: SanctuaryStop) => stop.x + stop.side * 27;
  const parapetInnerX = ASCENT.stairWidth / 2;
  const playerStoneClearance = 1.25;
  function finalAllowed(x: number, z: number, clearance = 0) {
    if (z < ASCENT.lowerPlatformStartZ || z > ASCENT.portalApproachEndZ) return false;
    const halfWidth = z >= ASCENT.wallFrontZ ? CFG.gateWidth / 2 - 8
      : z <= ASCENT.stairEndZ
        ? parapetInnerX : ASCENT.platformWidth / 2;
    return Math.abs(x) <= halfWidth - Math.max(clearance, playerStoneClearance);
  }
  function dockAllowed(x: number, z: number, stop: SanctuaryStop, clearance = 0) {
    return Math.abs(x - dockX(stop)) <= 26 - clearance &&
      Math.abs(z - stop.z) <= 27 - clearance;
  }
  return {
    getTerrainHeight(x, z) { return this.getWalkableSurfaceHeight(x, z); },
    getWalkableSurfaceHeight(x, z) {
      const { index } = getStage();
      if (isFinalStop(index)) return finalAllowed(x, z) ? getSanctuaryAscentHeight(z) : CFG.riverY;
      const stop = SANCTUARY_STOPS[index];
      return stop && dockAllowed(x, z, stop) ? 2.05 : CFG.riverY;
    },
    isColliding(x, z, clearance = 0) {
      const { index, state } = getStage();
      if (state !== "ashore") return false;
      if (isFinalStop(index)) return !finalAllowed(x, z, clearance);
      const stop = SANCTUARY_STOPS[index];
      return !stop || !dockAllowed(x, z, stop, clearance);
    },
    resolveCameraPosition(origin: Vector3, desired: Vector3) {
      if (isFinalStop(getStage().index) && getStage().state === "ashore") {
        // Keep the third-person camera on the same side of the solid parapet
        // as the player when its sight line crosses either inner stone face.
        const innerCameraX = parapetInnerX - .75;
        for (const side of [-1, 1]) {
          const boundary = side * innerCameraX;
          const travel = desired.x - origin.x;
          if (Math.abs(origin.x) >= innerCameraX || travel * side <= 0 ||
            (desired.x - boundary) * side <= 0) continue;
          const t = (boundary - origin.x) / travel;
          const crossingZ = origin.z + (desired.z - origin.z) * t;
          const crossingY = origin.y + (desired.y - origin.y) * t;
          if (crossingZ < ASCENT.lowerPlatformStartZ || crossingZ > ASCENT.stairEndZ ||
            crossingY > getSanctuaryAscentHeight(crossingZ) + 13) continue;
          return Vector3.Lerp(origin, desired, t);
        }
      }
      return desired.clone();
    },
    getStairSurfaceInfo(x, z) {
      return isFinalStop(getStage().index) && finalAllowed(x, z) ? getSanctuaryStairSurface(z) : null;
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
    const geometry = await createSanctuaryGeometry(scene, progress, context.performanceTier === "mobile");
    const shadowHands = await createSanctuaryShadowHands(scene).catch((error: unknown) => {
      console.warn("Sanctuary shadow hands unavailable", error);
      return null;
    });
    if (shadowHands) cleanup.push(shadowHands.dispose);
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
    const playerWorld = createDockWorld(() => ({ index: targetIndex, state }));

    const player = new PlayerController(scene, context.canvas, context.input, {
      eyeHeight: CFG.eyeHeight,
      walkSpeed: 3.5,
      runSpeed: 6.2,
      jumpSpeed: 5,
      gravity: -18,
      jumpingEnabled: false,
      runningEnabled: true,
      horizontalWorldLimit: null,
    }, context.selectedCharacter);
    const raftRiderZ = -1.2; // Stand in the open floor space between the cross seats.
    player.position.set(0, geometry.boatRoot.position.y + CFG.boatDeckY + CFG.eyeHeight,
      CFG.boatStartZ + raftRiderZ);
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
        geometry.boatRoot.position.z + raftRiderZ);
    };
    const updateAboardCamera = () => {
      if (!context.input.isGameplayInputEnabled()) return;
      const look = context.input.getLook();
      if (look.x !== 0 || look.y !== 0) player.applyLookDelta(look.x, look.y);
      if (context.input.wasPressed("changeCamera")) player.toggleViewMode();
    };
    const embark = () => {
      if (isFinalStop(targetIndex)) return false;
      const previous = ROUTE[targetIndex];
      targetIndex += 1;
      boatFrom = { x: previous.x, z: previous.z };
      const next = ROUTE[targetIndex];
      routeT = 0;
      routeDuration = Math.max(1, Math.hypot(next.x - previous.x, next.z - previous.z) / CFG.boatSpeed);
      state = "sailing";
      player.settleLocomotionToIdle();
      return true;
    };
    const disembark = () => {
      if (isFinalStop(targetIndex)) {
        player.position.set(0, ASCENT.lowerY + CFG.eyeHeight, CFG.gateLandingZ + 3);
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
        geometry.update(dt, elapsed, progress);
        movePlayerOntoBoat();
        updateAboardCamera();
        hud.setText("El río conduce la balsa entre los pilares de sombra...");
        if (routeT >= 1) state = "moored";
      } else if (state === "moored") {
        geometry.update(dt, elapsed, progress);
        movePlayerOntoBoat();
        updateAboardCamera();
        const name = isFinalStop(targetIndex)
          ? "El umbral del Santuario"
          : SANCTUARY_STOPS[targetIndex].title;
        hud.setText(`${name}  ·  ${context.input.getActionBindingLabel("interact") ?? "E"}: desembarcar`);
        if (context.input.wasPressed("interact")) disembark();
      } else {
        let embarked = false;
        player.update(dt, playerWorld);
        const atGate = isFinalStop(targetIndex);
        const stop = atGate ? null : SANCTUARY_STOPS[targetIndex];
        const nearPortal = stop && closeEnoughToPortal(stop);
        if (atGate) {
          hud.setText("El portal del Santuario permanece sellado. El desenlace se implementará más adelante.");
        } else if (nearPortal) {
          hud.setText(`${stop.title}  ·  El portal aún no responde.`);
        } else {
          hud.setText(`${stop?.title ?? ""}  ·  ${context.input.getActionBindingLabel("interact") ?? "E"}: volver a la balsa`);
        }
        if (context.input.wasPressed("interact") && !nearPortal) embarked = embark();
        geometry.update(dt, elapsed, progress);
        if (embarked) movePlayerOntoBoat();
      }
      shadowHands?.update(elapsed);
      context.musicPlayer?.updateListenerPosition(player.position);
    };
    context.onProgress(1, "Santuario disponible (prototipo)");

    return {
      id: "sanctuary",
      scene,
      enter() {
        const musicPlayer = context.musicPlayer;
        if (!musicPlayer) return;
        scene.onAfterRenderObservable.addOnce(() => {
          const startMusicTimer = window.setTimeout(() => {
            if (scene.isDisposed) return;
            musicPlayer.configureLevelAudio({
              backgroundTrack: "assets/audio/music/Sobre_Rios_de_Sangre_y_Sombras.mp3",
              ambientTrack: null,
              waterfallArea: null,
            });
          }, 0);
          cleanup.push(() => window.clearTimeout(startMusicTimer));
        });
      },
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
