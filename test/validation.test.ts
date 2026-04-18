import assert from "node:assert/strict";
import test from "node:test";
import { validateSceneDefinition } from "../src/config";
import { sampleTopology } from "../src/sampleTopology";
import type { SceneSourceKind, SonosTransport } from "../src/types";

const fakeTransport: SonosTransport = {
  kind: "fake",
  supportsSource(kind: SceneSourceKind) {
    return kind !== "tv";
  },
  async discoverHouseholds() {
    return [];
  },
  async discoverTopology() {
    return sampleTopology;
  },
  async setGroupMembers() {},
  async modifyGroupMembers() {},
  async loadLineIn() {},
  async loadFavorite() {},
  async setGroupVolume() {},
  async setPlayerVolume() {},
  async ungroup() {},
};

test("validateSceneDefinition rejects duplicate members and unknown favorite", () => {
  const validation = validateSceneDefinition(
    {
      id: "scene-1",
      name: "Invalid Scene",
      householdId: "local-household",
      coordinatorPlayerId: "RINCON_UPPER_LEVEL",
      memberPlayerIds: ["RINCON_PRIMARY_BEDROOM", "RINCON_PRIMARY_BEDROOM"],
      source: {
        kind: "favorite",
        favoriteId: "missing-favorite",
      },
      playerVolumes: [],
      offBehavior: {
        kind: "ungroup",
      },
      settleMs: 750,
      retryCount: 1,
      retryDelayMs: 0,
      autoResetMs: 0,
    },
    sampleTopology,
    fakeTransport,
  );

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /duplicates/i);
  assert.match(validation.errors.join(" "), /missing-favorite/i);
});

test("validateSceneDefinition rejects unsupported tv source", () => {
  const validation = validateSceneDefinition(
    {
      id: "scene-tv",
      name: "TV Scene",
      householdId: "local-household",
      coordinatorPlayerId: "RINCON_UPPER_LEVEL",
      memberPlayerIds: [],
      source: {
        kind: "tv",
        deviceId: "RINCON_PRIMARY_BEDROOM",
      },
      playerVolumes: [],
      offBehavior: {
        kind: "none",
      },
      settleMs: 750,
      retryCount: 1,
      retryDelayMs: 0,
      autoResetMs: 0,
    },
    sampleTopology,
    fakeTransport,
  );

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /does not support source kind "tv"/i);
});

test("validateSceneDefinition rejects favorites the local transport cannot play", () => {
  const snapshot = JSON.parse(JSON.stringify(sampleTopology));
  snapshot.households[0].favorites.push({
    id: "favorite-artist-shortcut",
    name: "The Hipster Orchestra",
    playbackType: "shortcut",
    playable: false,
    unsupportedReason: "Favorite artist shortcuts are not playable through the local transport.",
  });

  const validation = validateSceneDefinition(
    {
      id: "scene-favorite-shortcut",
      name: "Invalid Favorite",
      householdId: "local-household",
      coordinatorPlayerId: "RINCON_UPPER_LEVEL",
      memberPlayerIds: [],
      source: {
        kind: "favorite",
        favoriteId: "favorite-artist-shortcut",
      },
      playerVolumes: [],
      offBehavior: {
        kind: "none",
      },
      settleMs: 750,
      retryCount: 1,
      retryDelayMs: 0,
      autoResetMs: 0,
    },
    snapshot,
    fakeTransport,
  );

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /not playable through the local transport/i);
});
