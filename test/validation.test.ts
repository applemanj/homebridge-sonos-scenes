import assert from "node:assert/strict";
import test from "node:test";
import { validateSceneDefinition, validateVirtualRoomDefinition, validateVirtualRoomDefinitions } from "../src/config";
import { sampleTopology } from "../src/sampleTopology";
import type { SceneSourceKind, SonosTransport, VirtualRoomChannel } from "../src/types";

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
  async getGroupVolume() { return 0; },
  async setGroupVolume() {},
  async getPlayerVolume() { return 0; },
  async setPlayerVolume() {},
  async getPlayerChannelVolume(_householdId: string, _playerId: string, _channel: VirtualRoomChannel) { return 0; },
  async setPlayerChannelVolume() {},
  async getGroupMuted() { return false; },
  async setGroupMuted() {},
  async getPlayerMuted() { return false; },
  async setPlayerMuted() {},
  async getPlayerChannelMuted(_householdId: string, _playerId: string, _channel: VirtualRoomChannel) { return false; },
  async setPlayerChannelMuted() {},
  async pausePlayback() {},
  async stopPlayback() {},
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

test("validateSceneDefinition allows line-in source devices outside the playback group", () => {
  const validation = validateSceneDefinition(
    {
      id: "scene-remote-line-in",
      name: "Office Remote Line In",
      householdId: "local-household",
      coordinatorPlayerId: "RINCON_PRIMARY_BEDROOM",
      memberPlayerIds: [],
      source: {
        kind: "line_in",
        deviceId: "RINCON_UPPER_LEVEL",
      },
      coordinatorVolume: 30,
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

  assert.equal(validation.valid, true);
});

test("validateSceneDefinition warns when auto reset is ignored by off behavior", () => {
  const validation = validateSceneDefinition(
    {
      id: "scene-auto-reset-warning",
      name: "Auto Reset Warning",
      householdId: "local-household",
      coordinatorPlayerId: "RINCON_UPPER_LEVEL",
      memberPlayerIds: ["RINCON_PRIMARY_BEDROOM"],
      source: {
        kind: "favorite",
        favoriteId: "favorite-kexp",
      },
      playerVolumes: [],
      offBehavior: {
        kind: "ungroup",
      },
      settleMs: 750,
      retryCount: 1,
      retryDelayMs: 0,
      autoResetMs: 10000,
    },
    sampleTopology,
    fakeTransport,
  );

  assert.equal(validation.valid, true);
  assert.match(validation.warnings.join(" "), /auto reset/i);
  assert.match(validation.warnings.join(" "), /ignored while off behavior is enabled/i);
});

test("validateVirtualRoomDefinition rejects duplicate channels on the same amp", () => {
  const validation = validateVirtualRoomDefinition(
    {
      id: "primary-bedroom-ceiling",
      name: "Primary Bedroom Ceiling",
      householdId: "local-household",
      ampPlayerId: "RINCON_UPPER_LEVEL",
      channel: "left",
      defaultVolume: 60,
      maxVolume: 50,
      onBehavior: {
        kind: "restore_last",
      },
      offBehavior: {
        kind: "mute",
      },
      lastActiveBehavior: {
        kind: "pause",
      },
    },
    sampleTopology,
    [
      {
        id: "primary-bathroom-ceiling",
        name: "Primary Bathroom Ceiling",
        householdId: "local-household",
        ampPlayerId: "RINCON_UPPER_LEVEL",
        channel: "left",
        defaultVolume: 20,
        maxVolume: 40,
        onBehavior: {
          kind: "restore_last",
        },
        offBehavior: {
          kind: "mute",
        },
        lastActiveBehavior: {
          kind: "pause",
        },
      },
    ],
  );

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /only one left virtual room/i);
  assert.match(validation.errors.join(" "), /default volume cannot be greater than max volume/i);
});

test("validateVirtualRoomDefinition warns when the selected player is not an amp", () => {
  const validation = validateVirtualRoomDefinition(
    {
      id: "beam-room",
      name: "Beam Room",
      householdId: "local-household",
      ampPlayerId: "RINCON_PRIMARY_BEDROOM",
      channel: "right",
      defaultVolume: 25,
      maxVolume: 50,
      onBehavior: {
        kind: "restore_last",
      },
      offBehavior: {
        kind: "mute",
      },
      lastActiveBehavior: {
        kind: "none",
      },
    },
    sampleTopology,
  );

  assert.equal(validation.valid, true);
  assert.match(validation.warnings.join(" "), /intended for Sonos Amp/i);
});

test("validateVirtualRoomDefinitions rejects duplicate ids and mixed last-active policies", () => {
  const validation = validateVirtualRoomDefinitions(
    [
      {
        id: "upstairs-amp-left",
        name: "Bedroom Ceiling",
        householdId: "local-household",
        ampPlayerId: "RINCON_UPPER_LEVEL",
        channel: "left",
        defaultVolume: 25,
        maxVolume: 50,
        onBehavior: {
          kind: "restore_last",
        },
        offBehavior: {
          kind: "mute",
        },
        lastActiveBehavior: {
          kind: "pause",
        },
      },
      {
        id: "upstairs-amp-left",
        name: "Bathroom Ceiling",
        householdId: "local-household",
        ampPlayerId: "RINCON_UPPER_LEVEL",
        channel: "right",
        defaultVolume: 25,
        maxVolume: 50,
        onBehavior: {
          kind: "restore_last",
        },
        offBehavior: {
          kind: "mute",
        },
        lastActiveBehavior: {
          kind: "none",
        },
      },
    ],
    sampleTopology,
  );

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /duplicate id/i);
  assert.match(validation.errors.join(" "), /same amp must use the same last-active behavior/i);
});
