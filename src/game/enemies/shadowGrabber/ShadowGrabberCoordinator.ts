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
  active: boolean;
};

export type ShadowGrabberCoordinationConfig = {
  reassignmentIntervalIdle: number;
  reassignmentIntervalActive: number;
  activityHysteresisSeconds: number;
  maxConcurrentAttacks: number;
};

type ShadowGrabberGroup = {
  members: Map<string, GroupMember>;
  target: Vector3 | null;
  attackOwnerIds: Set<string>;
  groupAttackCooldownRemaining: number;
  reassignmentElapsed: number;
  reassignmentIntervalIdle: number;
  reassignmentIntervalActive: number;
  activityHysteresisSeconds: number;
  activeHysteresisRemaining: number;
  maxConcurrentAttacks: number;
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

  public register(
    groupId: string,
    controller: ShadowGrabberController,
    config: ShadowGrabberCoordinationConfig
  ) {
    const group = this.getOrCreateGroup(groupId, config);
    group.members.set(controller.id, {
      controller,
      role: ShadowGrabberRole.Pressure,
      active: false,
    });
    this.assignRoles(group);
  }

  public unregister(groupId: string, enemyId: string) {
    const group = this.groups.get(groupId);
    if (!group) return;
    group.members.delete(enemyId);
    group.attackOwnerIds.delete(enemyId);
    if (group.members.size === 0) {
      this.groups.delete(groupId);
      return;
    }
    this.assignRoles(group);
  }

  public update(deltaTimeSeconds: number) {
    for (const group of this.groups.values()) {
      group.groupAttackCooldownRemaining = Math.max(
        0,
        group.groupAttackCooldownRemaining - deltaTimeSeconds
      );
      const hasActiveMember = [...group.members.values()].some((member) => member.active);
      if (hasActiveMember) {
        group.activeHysteresisRemaining = group.activityHysteresisSeconds;
      } else {
        group.activeHysteresisRemaining = Math.max(
          0,
          group.activeHysteresisRemaining - deltaTimeSeconds
        );
      }
      const reassignmentInterval =
        hasActiveMember || group.activeHysteresisRemaining > 0
          ? group.reassignmentIntervalActive
          : group.reassignmentIntervalIdle;
      group.reassignmentElapsed += deltaTimeSeconds;
      if (group.reassignmentElapsed < reassignmentInterval) continue;
      group.reassignmentElapsed %= reassignmentInterval;
      this.assignRoles(group);
    }
  }

  public setMemberActive(groupId: string, enemyId: string, active: boolean) {
    const member = this.groups.get(groupId)?.members.get(enemyId);
    if (member) member.active = active;
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
    if (group.attackOwnerIds.has(enemyId)) return true;
    if (
      group.maxConcurrentAttacks <= 0 ||
      group.groupAttackCooldownRemaining > 0 ||
      group.attackOwnerIds.size >= group.maxConcurrentAttacks
    ) {
      return false;
    }
    group.attackOwnerIds.add(enemyId);
    return true;
  }

  public releaseAttack(groupId: string, enemyId: string, cooldownSeconds = 0) {
    const group = this.groups.get(groupId);
    if (!group?.attackOwnerIds.delete(enemyId)) return;
    group.groupAttackCooldownRemaining = Math.max(
      group.groupAttackCooldownRemaining,
      cooldownSeconds
    );
  }

  public getAttackOwner(groupId: string) {
    const owners = this.groups.get(groupId)?.attackOwnerIds;
    return owners?.values().next().value ?? null;
  }

  public getGroupAttackCooldown(groupId: string) {
    return this.groups.get(groupId)?.groupAttackCooldownRemaining ?? 0;
  }

  private getOrCreateGroup(groupId: string, config: ShadowGrabberCoordinationConfig) {
    let group = this.groups.get(groupId);
    if (!group) {
      group = {
        members: new Map(),
        target: null,
        attackOwnerIds: new Set(),
        groupAttackCooldownRemaining: 0,
        reassignmentElapsed: 0,
        reassignmentIntervalIdle: Math.max(0.5, config.reassignmentIntervalIdle),
        reassignmentIntervalActive: Math.max(0.5, config.reassignmentIntervalActive),
        activityHysteresisSeconds: Math.max(0, config.activityHysteresisSeconds),
        activeHysteresisRemaining: 0,
        maxConcurrentAttacks: Math.max(0, Math.floor(config.maxConcurrentAttacks)),
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
