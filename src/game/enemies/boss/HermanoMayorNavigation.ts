import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export type HermanoMayorNavigationOptions = {
  isBlocked: (x: number, z: number) => boolean;
};

type OpenNode = {
  key: string;
  x: number;
  z: number;
  cost: number;
  score: number;
};

const CELL_SIZE = 1.15;
const DIRECT_PATH_SAMPLE_STEP = 0.52;
const WAYPOINT_REACHED_DISTANCE = 0.68;
const TARGET_REPLAN_DISTANCE = 1.6;
const REPLAN_INTERVAL_SECONDS = 0.42;
const FAILED_RETRY_SECONDS = 0.28;
const SEARCH_MARGIN = 14;
const MAX_EXPANDED_NODES = 6500;
const SQRT_TWO = Math.SQRT2;
const NEIGHBORS = [
  { x: 1, z: 0, cost: 1 },
  { x: -1, z: 0, cost: 1 },
  { x: 0, z: 1, cost: 1 },
  { x: 0, z: -1, cost: 1 },
  { x: 1, z: 1, cost: SQRT_TWO },
  { x: 1, z: -1, cost: SQRT_TWO },
  { x: -1, z: 1, cost: SQRT_TWO },
  { x: -1, z: -1, cost: SQRT_TWO },
] as const;

function planarDistanceSquared(a: Vector3, b: Vector3) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function cellKey(x: number, z: number) {
  return `${x}:${z}`;
}

function parseCellKey(key: string) {
  const separator = key.indexOf(":");
  return {
    x: Number(key.slice(0, separator)),
    z: Number(key.slice(separator + 1)),
  };
}

function octileDistance(x: number, z: number, goalX: number, goalZ: number) {
  const dx = Math.abs(goalX - x);
  const dz = Math.abs(goalZ - z);
  return Math.max(dx, dz) + (SQRT_TWO - 1) * Math.min(dx, dz);
}

class OpenNodeHeap {
  private readonly nodes: OpenNode[] = [];

  public get size() {
    return this.nodes.length;
  }

  public push(node: OpenNode) {
    this.nodes.push(node);
    let index = this.nodes.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) * 0.5);
      if (this.nodes[parent].score <= node.score) break;
      this.nodes[index] = this.nodes[parent];
      index = parent;
    }
    this.nodes[index] = node;
  }

  public pop() {
    const first = this.nodes[0];
    const last = this.nodes.pop();
    if (!first || !last || this.nodes.length === 0) return first ?? null;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.nodes.length) break;
      const child =
        right < this.nodes.length && this.nodes[right].score < this.nodes[left].score
          ? right
          : left;
      if (this.nodes[child].score >= last.score) break;
      this.nodes[index] = this.nodes[child];
      index = child;
    }
    this.nodes[index] = last;
    return first;
  }
}

/**
 * Lightweight boss-only A* navigator. It finds doors and routes around authored
 * props while keeping movement deterministic and independent from player logic.
 */
export class HermanoMayorNavigation {
  private waypoints: Vector3[] = [];
  private readonly plannedGoal = Vector3.Zero();
  private hasPlannedGoal = false;
  private replanElapsed = Number.POSITIVE_INFINITY;
  private retryDelay = 0;

  public constructor(private readonly options: HermanoMayorNavigationOptions) {}

  public clear() {
    this.waypoints.length = 0;
    this.hasPlannedGoal = false;
    this.replanElapsed = Number.POSITIVE_INFINITY;
    this.retryDelay = 0;
  }

  public getSteeringTarget(
    origin: Vector3,
    requestedTarget: Vector3,
    deltaSeconds: number
  ) {
    const dt = Math.max(0, deltaSeconds);
    this.replanElapsed += dt;
    this.retryDelay = Math.max(0, this.retryDelay - dt);

    const goal = this.resolveWalkableGoal(origin, requestedTarget);
    if (!goal) {
      this.waypoints.length = 0;
      return null;
    }

    while (
      this.waypoints.length > 0 &&
      planarDistanceSquared(origin, this.waypoints[0]) <=
        WAYPOINT_REACHED_DISTANCE * WAYPOINT_REACHED_DISTANCE
    ) {
      this.waypoints.shift();
    }

    const goalMoved =
      !this.hasPlannedGoal ||
      planarDistanceSquared(goal, this.plannedGoal) >=
        TARGET_REPLAN_DISTANCE * TARGET_REPLAN_DISTANCE;
    const nextWaypointBlocked =
      this.waypoints.length > 0 &&
      !this.hasClearPath(origin, this.waypoints[0]);
    const shouldReplan =
      goalMoved ||
      nextWaypointBlocked ||
      this.replanElapsed >= REPLAN_INTERVAL_SECONDS ||
      (!this.waypoints.length && this.retryDelay <= 0);

    if (shouldReplan && this.retryDelay <= 0) {
      this.waypoints = this.hasClearPath(origin, goal)
        ? [goal]
        : this.findPath(origin, goal);
      this.plannedGoal.copyFrom(goal);
      this.hasPlannedGoal = true;
      this.replanElapsed = 0;
      if (!this.waypoints.length) this.retryDelay = FAILED_RETRY_SECONDS;
    }

    return this.waypoints[0] ?? null;
  }

  private resolveWalkableGoal(origin: Vector3, target: Vector3) {
    if (!this.options.isBlocked(target.x, target.z)) return target.clone();

    const dx = origin.x - target.x;
    const dz = origin.z - target.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.001) return null;
    const directionX = dx / distance;
    const directionZ = dz / distance;
    for (let offset = CELL_SIZE * 0.5; offset <= distance; offset += CELL_SIZE * 0.5) {
      const x = target.x + directionX * offset;
      const z = target.z + directionZ * offset;
      if (!this.options.isBlocked(x, z)) return new Vector3(x, target.y, z);
    }
    return null;
  }

  private hasClearPath(from: Vector3, to: Vector3) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.001) return true;
    const steps = Math.max(1, Math.ceil(distance / DIRECT_PATH_SAMPLE_STEP));
    for (let step = 1; step <= steps; step++) {
      const amount = step / steps;
      if (this.options.isBlocked(from.x + dx * amount, from.z + dz * amount)) {
        return false;
      }
    }
    return true;
  }

  private findPath(origin: Vector3, goal: Vector3) {
    const startX = Math.round(origin.x / CELL_SIZE);
    const startZ = Math.round(origin.z / CELL_SIZE);
    const requestedGoalX = Math.round(goal.x / CELL_SIZE);
    const requestedGoalZ = Math.round(goal.z / CELL_SIZE);
    const resolvedGoal = this.findOpenGoalCell(requestedGoalX, requestedGoalZ, goal);
    if (!resolvedGoal) return [];
    const goalX = resolvedGoal.x;
    const goalZ = resolvedGoal.z;
    const startKey = cellKey(startX, startZ);
    const goalKey = cellKey(goalX, goalZ);
    if (startKey === goalKey) return [goal];

    const marginCells = Math.ceil(SEARCH_MARGIN / CELL_SIZE);
    const minX = Math.min(startX, goalX) - marginCells;
    const maxX = Math.max(startX, goalX) + marginCells;
    const minZ = Math.min(startZ, goalZ) - marginCells;
    const maxZ = Math.max(startZ, goalZ) + marginCells;
    const blockedCache = new Map<string, boolean>();
    const isCellBlocked = (x: number, z: number) => {
      const key = cellKey(x, z);
      if (key === startKey) return false;
      const cached = blockedCache.get(key);
      if (cached !== undefined) return cached;
      const blocked = this.options.isBlocked(x * CELL_SIZE, z * CELL_SIZE);
      blockedCache.set(key, blocked);
      return blocked;
    };

    const open = new OpenNodeHeap();
    const costs = new Map<string, number>([[startKey, 0]]);
    const previous = new Map<string, string>();
    open.push({
      key: startKey,
      x: startX,
      z: startZ,
      cost: 0,
      score: octileDistance(startX, startZ, goalX, goalZ),
    });

    let expanded = 0;
    let found = false;
    while (open.size > 0 && expanded < MAX_EXPANDED_NODES) {
      const current = open.pop();
      if (!current) break;
      if (current.cost !== costs.get(current.key)) continue;
      if (current.key === goalKey) {
        found = true;
        break;
      }
      expanded += 1;

      for (const neighbor of NEIGHBORS) {
        const x = current.x + neighbor.x;
        const z = current.z + neighbor.z;
        if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
        if (isCellBlocked(x, z)) continue;
        if (
          neighbor.x !== 0 &&
          neighbor.z !== 0 &&
          (isCellBlocked(current.x + neighbor.x, current.z) ||
            isCellBlocked(current.x, current.z + neighbor.z))
        ) continue;

        const key = cellKey(x, z);
        const cost = current.cost + neighbor.cost;
        if (cost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) continue;
        costs.set(key, cost);
        previous.set(key, current.key);
        open.push({
          key,
          x,
          z,
          cost,
          score: cost + octileDistance(x, z, goalX, goalZ),
        });
      }
    }
    if (!found) return [];

    const reversedKeys: string[] = [];
    let cursor = goalKey;
    while (cursor !== startKey) {
      reversedKeys.push(cursor);
      const parent = previous.get(cursor);
      if (!parent) return [];
      cursor = parent;
    }
    reversedKeys.reverse();
    const rawWaypoints = reversedKeys.map((key) => {
      const cell = parseCellKey(key);
      return new Vector3(cell.x * CELL_SIZE, goal.y, cell.z * CELL_SIZE);
    });
    const lastGridWaypoint = rawWaypoints[rawWaypoints.length - 1] ?? origin;
    if (
      planarDistanceSquared(lastGridWaypoint, goal) > 0.04 &&
      this.hasClearPath(lastGridWaypoint, goal)
    ) {
      rawWaypoints.push(goal);
    }
    return this.simplifyPath(origin, rawWaypoints);
  }

  private findOpenGoalCell(x: number, z: number, exactGoal: Vector3) {
    if (!this.options.isBlocked(x * CELL_SIZE, z * CELL_SIZE)) return { x, z };
    let best: { x: number; z: number; distance: number } | null = null;
    for (let ring = 1; ring <= 5; ring++) {
      for (let offsetX = -ring; offsetX <= ring; offsetX++) {
        for (const offsetZ of [-ring, ring]) {
          best = this.selectOpenGoalCandidate(
            x + offsetX,
            z + offsetZ,
            exactGoal,
            best
          );
        }
      }
      for (let offsetZ = -ring + 1; offsetZ < ring; offsetZ++) {
        for (const offsetX of [-ring, ring]) {
          best = this.selectOpenGoalCandidate(
            x + offsetX,
            z + offsetZ,
            exactGoal,
            best
          );
        }
      }
      if (best) return { x: best.x, z: best.z };
    }
    return null;
  }

  private selectOpenGoalCandidate(
    x: number,
    z: number,
    exactGoal: Vector3,
    current: { x: number; z: number; distance: number } | null
  ) {
    const worldX = x * CELL_SIZE;
    const worldZ = z * CELL_SIZE;
    if (this.options.isBlocked(worldX, worldZ)) return current;
    const distance = (worldX - exactGoal.x) ** 2 + (worldZ - exactGoal.z) ** 2;
    if (current && current.distance <= distance) return current;
    return { x, z, distance };
  }

  private simplifyPath(origin: Vector3, rawWaypoints: Vector3[]) {
    const simplified: Vector3[] = [];
    let anchor = origin;
    let index = 0;
    while (index < rawWaypoints.length) {
      let selected = index;
      for (let candidate = rawWaypoints.length - 1; candidate > index; candidate--) {
        if (!this.hasClearPath(anchor, rawWaypoints[candidate])) continue;
        selected = candidate;
        break;
      }
      const waypoint = rawWaypoints[selected];
      simplified.push(waypoint);
      anchor = waypoint;
      index = selected + 1;
    }
    return simplified;
  }
}
