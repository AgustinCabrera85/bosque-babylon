import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { RINA_STADIUM, RINA_STADIUM_SCALE } from "./RinaLevelConfig";
import type { RinaFieldCrowdMazeLayout } from "./RinaFieldCrowdMazeLayout";
import { RINA_PLAYER_COLLISION_CLEARANCE_LOCAL, RinaStadiumWorld } from "./RinaStadiumWorld";

type CollisionLayer = "crowd" | "stadium";
type Segment = readonly [number, number, number, number];

const SAMPLE_STEP = 0.55;
const CROWD_TRACE_RADIUS = 6.5;
const GROUND_Y = RINA_STADIUM.fieldY + 0.09;
const OVERHEAD_Y = RINA_STADIUM.fieldY + 2.05;

/** Sample the same player collision query and outline every blocked/open transition. */
function traceCollisionBoundaries(
  world: RinaStadiumWorld,
): Record<CollisionLayer, Segment[]> {
  const minX = -RINA_STADIUM.pitchWidth / 2 - 1.5;
  const maxX = RINA_STADIUM.pitchWidth / 2 + 1.5;
  const minZ = -RINA_STADIUM.pitchLength / 2 - 1.5;
  const maxZ = RINA_STADIUM.stage.frontZ + 2;
  const columns = Math.ceil((maxX - minX) / SAMPLE_STEP);
  const rows = Math.ceil((maxZ - minZ) / SAMPLE_STEP);
  const dx = (maxX - minX) / columns;
  const dz = (maxZ - minZ) / rows;
  const stride = columns + 1;
  const crowd = new Uint8Array(stride * (rows + 1));
  const stadium = new Uint8Array(crowd.length);
  const index = (x: number, z: number) => z * stride + x;
  const classify = (x: number, z: number) => {
    const crowdBlocked = world.crowdBlocksPlayerLocal(
      x, z, RINA_PLAYER_COLLISION_CLEARANCE_LOCAL,
    );
    const blocked = world.isColliding(
      x * RINA_STADIUM_SCALE, z * RINA_STADIUM_SCALE, 0,
      RINA_STADIUM.fieldY * RINA_STADIUM_SCALE,
      (RINA_STADIUM.fieldY + 2) * RINA_STADIUM_SCALE,
    );
    return { crowdBlocked, stadiumBlocked: blocked && !crowdBlocked };
  };
  for (let iz = 0; iz <= rows; iz++) {
    const z = minZ + iz * dz;
    for (let ix = 0; ix <= columns; ix++) {
      const { crowdBlocked, stadiumBlocked } = classify(minX + ix * dx, z);
      crowd[index(ix, iz)] = Number(crowdBlocked);
      stadium[index(ix, iz)] = Number(stadiumBlocked);
    }
  }

  const trace = (layer: Uint8Array, kind: CollisionLayer): Segment[] => {
    const segments: Segment[] = [];
    for (let iz = 0; iz < rows; iz++) for (let ix = 0; ix < columns; ix++) {
      const c = [layer[index(ix, iz)], layer[index(ix + 1, iz)],
        layer[index(ix + 1, iz + 1)], layer[index(ix, iz + 1)]];
      if (c.every(value => value === c[0])) continue;
      const x = minX + ix * dx, z = minZ + iz * dz;
      const edges: readonly [number, number][] = [
        [x + dx / 2, z], [x + dx, z + dz / 2],
        [x + dx / 2, z + dz], [x, z + dz / 2],
      ];
      const crossings = [0, 1, 2, 3].filter(edge => c[edge] !== c[(edge + 1) % 4]);
      if (crossings.length === 2) {
        const a = edges[crossings[0]], b = edges[crossings[1]];
        segments.push([a[0], a[1], b[0], b[1]]);
      } else if (crossings.length === 4) {
        // Resolve diagonal cells using the same collision query at the center.
        const center = classify(x + dx / 2, z + dz / 2);
        const centerBlocked = kind === "crowd" ? center.crowdBlocked : center.stadiumBlocked;
        const pairs = centerBlocked === Boolean(c[0])
          ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
        for (const [first, second] of pairs) {
          const a = edges[first], b = edges[second];
          segments.push([a[0], a[1], b[0], b[1]]);
        }
      }
    }
    return segments;
  };
  return { crowd: trace(crowd, "crowd"), stadium: trace(stadium, "stadium") };
}

function createTrace(
  scene: Scene, parent: TransformNode, name: string,
  segments: readonly Segment[], color: Color3,
): Mesh {
  const lines: Vector3[][] = [];
  for (let i = 0; i < segments.length; i++) {
    const [ax, az, bx, bz] = segments[i];
    lines.push([new Vector3(ax, GROUND_Y, az), new Vector3(bx, GROUND_Y, bz)]);
    lines.push([new Vector3(ax, OVERHEAD_Y, az), new Vector3(bx, OVERHEAD_Y, bz)]);
    if (i % 7 === 0) {
      const x = (ax + bx) / 2, z = (az + bz) / 2;
      lines.push([new Vector3(x, GROUND_Y, z), new Vector3(x, OVERHEAD_Y, z)]);
    }
  }
  const mesh = MeshBuilder.CreateLineSystem(name, { lines }, scene);
  mesh.color = color;
  mesh.parent = parent;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.renderingGroupId = 3;
  return mesh;
}

export function createRinaFieldCollisionDebug(
  scene: Scene,
  stadiumRoot: TransformNode,
  layout: RinaFieldCrowdMazeLayout,
  world: RinaStadiumWorld,
): { update(playerPosition: Vector3): void; dispose(): void } {
  let active = false;
  let traceRoot: TransformNode | null = null;
  let crowdSegments: Segment[] = [];
  let nearbyCrowdTrace: Mesh | null = null;
  let lastTraceX = Infinity, lastTraceZ = Infinity;
  let lastPanelUpdate = 0;
  const panel = document.createElement("div");
  panel.id = "rinaCollisionDebug";
  panel.style.cssText = [
    "position:fixed", "left:16px", "top:300px", "z-index:1000",
    "min-width:250px", "padding:11px 13px", "border:1px solid #66e6ef",
    "border-radius:7px", "background:rgba(4,12,19,.91)",
    "color:#effcff", "font:12px/1.5 monospace", "pointer-events:auto",
  ].join(";");
  const title = document.createElement("div");
  title.textContent = "COLISIONES DEL CAMPO · F8";
  title.style.cssText = "font-weight:700;letter-spacing:.04em;margin-bottom:7px";
  const legend = document.createElement("div");
  legend.innerHTML = '<span style="color:#ff3854">■</span> Público bloqueado<br>' +
    '<span style="color:#42ddeb">■</span> Estadio, pasarela y vallas';
  const status = document.createElement("div");
  status.style.cssText = "margin-top:8px;padding-top:7px;border-top:1px solid #50737a";
  panel.append(title, legend, status);
  document.body.append(panel);

  const setActive = (enabled: boolean) => {
    active = enabled;
    if (active && !traceRoot) {
      const segments = traceCollisionBoundaries(world);
      crowdSegments = segments.crowd;
      traceRoot = new TransformNode("rinaCollisionDebugRoot", scene);
      traceRoot.parent = stadiumRoot;
      createTrace(scene, traceRoot, "rinaCollisionStadiumTrace", segments.stadium,
        new Color3(0.25, 0.87, 0.93));
    }
    traceRoot?.setEnabled(active);
    panel.style.display = active ? "block" : "none";
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "F8" || event.repeat) return;
    event.preventDefault();
    setActive(!active);
  };
  window.addEventListener("keydown", onKeyDown, true);
  const debugParam = new URLSearchParams(window.location.search).get("rinaCollisionDebug");
  setActive(debugParam !== null && debugParam !== "0");

  return {
    update(playerPosition) {
      if (!active) return;
      const x = playerPosition.x / RINA_STADIUM_SCALE;
      const z = playerPosition.z / RINA_STADIUM_SCALE;
      if (Math.hypot(x - lastTraceX, z - lastTraceZ) > 0.7) {
        lastTraceX = x;
        lastTraceZ = z;
        const radiusSquared = CROWD_TRACE_RADIUS ** 2;
        const nearby = crowdSegments.filter(([ax, az, bx, bz]) =>
          (((ax + bx) / 2 - x) ** 2 + ((az + bz) / 2 - z) ** 2) < radiusSquared);
        nearbyCrowdTrace?.dispose();
        nearbyCrowdTrace = null;
        if (nearby.length && traceRoot) {
          nearbyCrowdTrace = createTrace(scene, traceRoot, "rinaCollisionCrowdTrace", nearby,
            new Color3(1, 0.22, 0.33));
        }
      }
      if (performance.now() - lastPanelUpdate < 120) return;
      lastPanelUpdate = performance.now();
      const margin = layout.marginToCrowd(x, z);
      const crowdBlocked = world.crowdBlocksPlayerLocal(
        x, z, RINA_PLAYER_COLLISION_CLEARANCE_LOCAL,
      );
      const blocked = world.isColliding(
        playerPosition.x, playerPosition.z, 0,
        playerPosition.y - RINA_STADIUM.playerEyeHeight,
        playerPosition.y + 0.25,
      );
      status.textContent = `Jugador: X ${x.toFixed(1)} · Z ${z.toFixed(1)}\n` +
        `Público: ${crowdBlocked ? "BLOQUEADO" : "libre"} · margen ${margin.toFixed(2)}\n` +
        `Colisión total: ${blocked ? "SÍ" : "no"}`;
      status.style.whiteSpace = "pre-line";
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown, true);
      panel.remove();
      traceRoot?.dispose(false, true);
    },
  };
}
