import type { SceneDefinition, TopologySnapshot } from "./types";

export interface SceneStateMatch {
  active: boolean;
  reason?: string;
}

function sameMembers(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  const actualSet = new Set(actual);
  return expected.every((playerId) => actualSet.has(playerId));
}

export function expectedScenePlayerIds(scene: SceneDefinition): string[] {
  return Array.from(new Set([scene.coordinatorPlayerId, ...scene.memberPlayerIds].filter(Boolean)));
}

export function matchSceneTopology(scene: SceneDefinition, snapshot: TopologySnapshot): SceneStateMatch {
  const household = snapshot.households.find((item) => item.id === scene.householdId);
  if (!household) {
    return {
      active: false,
      reason: `household "${scene.householdId}" is no longer present`,
    };
  }

  const expectedPlayerIds = expectedScenePlayerIds(scene);
  const missingPlayers = expectedPlayerIds.filter((playerId) => !household.players.some((player) => player.id === playerId));
  if (missingPlayers.length > 0) {
    return {
      active: false,
      reason: `player(s) missing from household: ${missingPlayers.join(", ")}`,
    };
  }

  const coordinatorGroup = household.groups.find((group) => group.playerIds.includes(scene.coordinatorPlayerId));
  if (!coordinatorGroup) {
    return {
      active: false,
      reason: `lead room "${scene.coordinatorPlayerId}" is not in a discovered group`,
    };
  }

  if (!sameMembers(coordinatorGroup.playerIds, expectedPlayerIds)) {
    return {
      active: false,
      reason: `group "${coordinatorGroup.name}" now has [${coordinatorGroup.playerIds.join(", ")}] instead of [${expectedPlayerIds.join(", ")}]`,
    };
  }

  return { active: true };
}
