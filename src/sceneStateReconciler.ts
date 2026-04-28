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

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeUri(value: string | undefined): string | undefined {
  const normalized = value ? decodeXmlEntities(value).trim() : "";
  return normalized ? normalized : undefined;
}

function comparableSourceUri(value: string | undefined): string | undefined {
  const normalized = normalizeUri(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return normalized.split("?")[0];
}

function normalizePlaybackState(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function playbackStateIsKnown(value: string | undefined): boolean {
  const normalized = normalizePlaybackState(value);
  return Boolean(normalized && !normalized.includes("unknown"));
}

function playbackStateIsActive(value: string | undefined): boolean {
  const normalized = normalizePlaybackState(value);
  return Boolean(normalized && (normalized.includes("playing") || normalized.includes("transitioning")));
}

function sceneSourceStartsPlayback(scene: SceneDefinition): boolean {
  if (!scene.source) {
    return false;
  }

  if (scene.source.kind === "line_in" || scene.source.kind === "tv") {
    return scene.source.playOnCompletion !== false;
  }

  return true;
}

function sourceUriMatches(currentSourceUri: string | undefined, expectedSourceUris: string[]): boolean {
  const currentComparable = comparableSourceUri(currentSourceUri);
  if (!currentComparable) {
    return true;
  }

  return expectedSourceUris
    .map(comparableSourceUri)
    .filter(Boolean)
    .some((expectedComparable) => expectedComparable === currentComparable);
}

function expectedSceneSourceUris(scene: SceneDefinition, snapshot: TopologySnapshot): string[] {
  if (!scene.source) {
    return [];
  }

  if (scene.source.kind === "line_in") {
    return [`x-rincon-stream:${scene.source.deviceId}`];
  }

  if (scene.source.kind === "tv") {
    return [`x-sonos-htastream:${scene.source.deviceId}:spdif`];
  }

  const source = scene.source;
  const household = snapshot.households.find((item) => item.id === scene.householdId);
  const favorite = household?.favorites.find(
    (item) => item.id === source.favoriteId || item.name === source.favoriteId,
  );
  return [favorite?.transportUri, favorite?.uri].map(normalizeUri).filter(Boolean) as string[];
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

  if (
    scene.source
    && sceneSourceStartsPlayback(scene)
    && playbackStateIsKnown(coordinatorGroup.playbackState)
    && !playbackStateIsActive(coordinatorGroup.playbackState)
  ) {
    return {
      active: false,
      reason: `group "${coordinatorGroup.name}" playback state is "${coordinatorGroup.playbackState}"`,
    };
  }

  const expectedSourceUris = expectedSceneSourceUris(scene, snapshot);
  const currentSourceUri = normalizeUri(coordinatorGroup.currentSourceUri);
  if (expectedSourceUris.length > 0 && currentSourceUri && !sourceUriMatches(currentSourceUri, expectedSourceUris)) {
    return {
      active: false,
      reason: `group "${coordinatorGroup.name}" source is "${currentSourceUri}" instead of "${expectedSourceUris.join(" or ")}"`,
    };
  }

  return { active: true };
}
