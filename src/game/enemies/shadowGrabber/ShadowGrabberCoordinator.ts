import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ShadowGrabberController } from "./ShadowGrabberController";

export enum ShadowGrabberRole {
  Pressure = "pressure",
  Interceptor = "interceptor",
  Flanker = "flanker",
  Gatekeeper = "gatekeeper",
}

type GroupMember = {
  controller: ShadowGrabberController;
  role: ShadowGrabberRole;
};

type ShadowGrabberGroup = {
  members: Map<string, GroupMember>;
  target: Vector3 | null;
  attackOwnerId: string | null;
  reassignmentElapsed: number;
  reassignmentSeconds: number;
};

const ROLE_ORDER = [
  ShadowGrabberRole.Pressure,
  ShadowGrabberRole.Interceptor,
  ShadowGrabberRole.Flanker,
  ShadowGrabberRole.Gatekeeper,
] as const;

/** Cheap group-level coordination: stable roles, shared target and one attack token. */
export class ShadowGrabberCoordinator {
  private readonly groups = new Map<string, ShadowGrabberGroup>();

  public constructor(private readonly maxConcurrentAttacks = 1) {}

  public register(
    groupId: string,
    controller: ShadowGrabberController,
    reassignmentSeconds: number
  ) {
    const group = this.getOrCreateGroup(groupId, reassignmentSeconds);
    group.members.set(controller.id, {
      controller,
      role: ShadowGrabberRole.Pressure,
    });
    this.assignRoles(group);
  }

  public unregister(groupId: string, enemyId: string) {
    const group = this.groups.get(groupId);
    if (!group) return;
    group.members.delete(enemyId);
    if (group.attackOwnerId === enemyId) group.attackOwnerId = null;
    if (group.members.size === 0) {
      this.groups.delete(groupId);
      return;
    }
    this.assignRoles(group);
  }

  public update(deltaTimeSeconds: number) {
    for (const group of this.groups.values()) {
      group.reassignmentElapsed += deltaTimeSeconds;
      if (group.reassignmentElapsed < group.reassignmentSeconds) continue;
      group.reassignmentElapsed %= group.reassignmentSeconds;
      this.assignRoles(group);
    }
  }

  public setTarget(groupId: string, target: Vector3) {
    const group = this.groups.get(groupId);
    if (!group) return;
    if (group.target) group.target.copyFrom(target);
    else group.target = target.clone();
  }

  public getRole(groupId: string, enemyId: string) {
    return this.groups.get(groupId)?.members.get(enemyId)?.role ?? ShadowGrabberRole.Pressure;
  }

  public getNeighbors(groupId: string, enemyId: string) {
    const group = this.groups.get(groupId);
    if (!group) return [];
    const neighbors: ShadowGrabberController[] = [];
    for (const [id, member] of group.members) {
      if (id !== enemyId && member.controller.enabled) neighbors.push(member.controller);
    }
    return neighbors;
  }

  public tryReserveAttack(groupId: string, enemyId: string) {
    const group = this.groups.get(groupId);
    if (!group) return false;
    if (group.attackOwnerId === enemyId) return true;
    if (this.maxConcurrentAttacks <= 0 || group.attackOwnerId !== null) return false;
    group.attackOwnerId = enemyId;
    return true;
  }

  public releaseAttack(groupId: string, enemyId: string) {
    const group = this.groups.get(groupId);
    if (group?.attackOwnerId === enemyId) group.attackOwnerId = null;
  }

  public getAttackOwner(groupId: string) {
    return this.groups.get(groupId)?.attackOwnerId ?? null;
  }

  private getOrCreateGroup(groupId: string, reassignmentSeconds: number) {
    let group = this.groups.get(groupId);
    if (!group) {
      group = {
        members: new Map(),
        target: null,
        attackOwnerId: null,
        reassignmentElapsed: 0,
        reassignmentSeconds: Math.max(0.5, reassignmentSeconds),
      };
      this.groups.set(groupId, group);
    }
    return group;
  }

  private assignRoles(group: ShadowGrabberGroup) {
    // IDs are authored in encounter order, making role assignment deterministic
    // while still remaining stable between the deliberately infrequent refreshes.
    const members = [...group.members.values()].sort((a, b) =>
      a.controller.id.localeCompare(b.controller.id)
    );
    members.forEach((member, index) => {
      member.role = ROLE_ORDER[index % ROLE_ORDER.length];
    });
  }
}
