import assert from "node:assert/strict";
import test from "node:test";
import { matchSceneTopology } from "../src/sceneStateReconciler";
import { sampleTopology } from "../src/sampleTopology";
import type { SceneDefinition, TopologySnapshot } from "../src/types";

function buildScene(): SceneDefinition {
  return {
    id: "scene-upper-bedroom",
    name: "Upper Bedroom",
    householdId: "local-household",
    coordinatorPlayerId: "RINCON_UPPER_LEVEL",
    memberPlayerIds: ["RINCON_PRIMARY_BEDROOM"],
    playerVolumes: [],
    offBehavior: { kind: "ungroup" },
    settleMs: 0,
    retryCount: 0,
    retryDelayMs: 0,
    autoResetMs: 0,
  };
}

function buildLineInScene(): SceneDefinition {
  return {
    ...buildScene(),
    source: {
      kind: "line_in",
      deviceId: "RINCON_UPPER_LEVEL",
      playOnCompletion: true,
    },
  };
}

function buildFavoriteScene(favoriteId: string): SceneDefinition {
  return {
    ...buildScene(),
    source: {
      kind: "favorite",
      favoriteId,
    },
  };
}

function cloneTopology(): TopologySnapshot {
  return JSON.parse(JSON.stringify(sampleTopology)) as TopologySnapshot;
}

test("matchSceneTopology treats the scene as active when the expected players share one group", () => {
  const scene = buildScene();
  const snapshot = cloneTopology();
  const household = snapshot.households[0];
  household.groups = [
    {
      id: "GROUP_UPPER_LEVEL",
      name: "Upper Level",
      coordinatorId: "RINCON_UPPER_LEVEL",
      playerIds: ["RINCON_UPPER_LEVEL", "RINCON_PRIMARY_BEDROOM"],
      playbackState: "PLAYBACK_STATE_PLAYING",
    },
  ];

  assert.deepEqual(matchSceneTopology(scene, snapshot), { active: true });
});

test("matchSceneTopology turns inactive when an expected member was externally ungrouped", () => {
  const scene = buildScene();
  const snapshot = cloneTopology();

  const match = matchSceneTopology(scene, snapshot);

  assert.equal(match.active, false);
  assert.match(match.reason ?? "", /instead of/);
});

test("matchSceneTopology allows Sonos to change the group coordinator when membership still matches", () => {
  const scene = buildScene();
  const snapshot = cloneTopology();
  const household = snapshot.households[0];
  household.groups = [
    {
      id: "GROUP_PRIMARY_BEDROOM",
      name: "Primary Bedroom",
      coordinatorId: "RINCON_PRIMARY_BEDROOM",
      playerIds: ["RINCON_PRIMARY_BEDROOM", "RINCON_UPPER_LEVEL"],
      playbackState: "PLAYBACK_STATE_PLAYING",
    },
  ];

  assert.deepEqual(matchSceneTopology(scene, snapshot), { active: true });
});

test("matchSceneTopology turns inactive when another room joins the scene group", () => {
  const scene = buildScene();
  const snapshot = cloneTopology();
  const household = snapshot.households[0];
  household.players.push({
    id: "RINCON_OFFICE",
    name: "Office",
    model: "Sonos One",
    capabilities: ["PLAYBACK"],
    deviceIds: ["RINCON_OFFICE"],
    groupId: "GROUP_UPPER_LEVEL",
    isCoordinator: false,
    fixedVolume: false,
    sourceOptions: ["favorite"],
  });
  household.groups = [
    {
      id: "GROUP_UPPER_LEVEL",
      name: "Upper Level",
      coordinatorId: "RINCON_UPPER_LEVEL",
      playerIds: ["RINCON_UPPER_LEVEL", "RINCON_PRIMARY_BEDROOM", "RINCON_OFFICE"],
      playbackState: "PLAYBACK_STATE_PLAYING",
    },
  ];

  const match = matchSceneTopology(scene, snapshot);

  assert.equal(match.active, false);
  assert.match(match.reason ?? "", /RINCON_OFFICE/);
});

test("matchSceneTopology keeps a source scene active when source and playback still match", () => {
  const scene = buildLineInScene();
  const snapshot = cloneTopology();
  const household = snapshot.households[0];
  household.groups = [
    {
      id: "GROUP_UPPER_LEVEL",
      name: "Upper Level",
      coordinatorId: "RINCON_UPPER_LEVEL",
      playerIds: ["RINCON_UPPER_LEVEL", "RINCON_PRIMARY_BEDROOM"],
      playbackState: "PLAYBACK_STATE_PLAYING",
      currentSourceUri: "x-rincon-stream:RINCON_UPPER_LEVEL",
    },
  ];

  assert.deepEqual(matchSceneTopology(scene, snapshot), { active: true });
});

test("matchSceneTopology turns inactive when source scene playback has stopped", () => {
  const scene = buildLineInScene();
  const snapshot = cloneTopology();
  const household = snapshot.households[0];
  household.groups = [
    {
      id: "GROUP_UPPER_LEVEL",
      name: "Upper Level",
      coordinatorId: "RINCON_UPPER_LEVEL",
      playerIds: ["RINCON_UPPER_LEVEL", "RINCON_PRIMARY_BEDROOM"],
      playbackState: "PLAYBACK_STATE_IDLE",
      currentSourceUri: "x-rincon-stream:RINCON_UPPER_LEVEL",
    },
  ];

  const match = matchSceneTopology(scene, snapshot);

  assert.equal(match.active, false);
  assert.match(match.reason ?? "", /playback state/i);
});

test("matchSceneTopology turns inactive when the source changed outside the plugin", () => {
  const scene = buildLineInScene();
  const snapshot = cloneTopology();
  const household = snapshot.households[0];
  household.groups = [
    {
      id: "GROUP_UPPER_LEVEL",
      name: "Upper Level",
      coordinatorId: "RINCON_UPPER_LEVEL",
      playerIds: ["RINCON_UPPER_LEVEL", "RINCON_PRIMARY_BEDROOM"],
      playbackState: "PLAYBACK_STATE_PLAYING",
      currentSourceUri: "x-rincon-stream:RINCON_OTHER_SOURCE",
    },
  ];

  const match = matchSceneTopology(scene, snapshot);

  assert.equal(match.active, false);
  assert.match(match.reason ?? "", /source/i);
});

test("matchSceneTopology does not turn source scenes off when Sonos omits source details", () => {
  const scene = buildLineInScene();
  const snapshot = cloneTopology();
  const household = snapshot.households[0];
  household.groups = [
    {
      id: "GROUP_UPPER_LEVEL",
      name: "Upper Level",
      coordinatorId: "RINCON_UPPER_LEVEL",
      playerIds: ["RINCON_UPPER_LEVEL", "RINCON_PRIMARY_BEDROOM"],
      playbackState: "PLAYBACK_STATE_PLAYING",
    },
  ];

  assert.deepEqual(matchSceneTopology(scene, snapshot), { active: true });
});

test("matchSceneTopology does not require active playback when line-in is only staged", () => {
  const scene: SceneDefinition = {
    ...buildLineInScene(),
    source: {
      kind: "line_in",
      deviceId: "RINCON_UPPER_LEVEL",
      playOnCompletion: false,
    },
  };
  const snapshot = cloneTopology();
  const household = snapshot.households[0];
  household.groups = [
    {
      id: "GROUP_UPPER_LEVEL",
      name: "Upper Level",
      coordinatorId: "RINCON_UPPER_LEVEL",
      playerIds: ["RINCON_UPPER_LEVEL", "RINCON_PRIMARY_BEDROOM"],
      playbackState: "PLAYBACK_STATE_IDLE",
      currentSourceUri: "x-rincon-stream:RINCON_UPPER_LEVEL",
    },
  ];

  assert.deepEqual(matchSceneTopology(scene, snapshot), { active: true });
});

test("matchSceneTopology matches favorite source URIs despite case and query-string differences", () => {
  const scene = buildFavoriteScene("2/13");
  const snapshot = cloneTopology();
  const household = snapshot.households[0];
  household.favorites = [
    {
      id: "2/13",
      name: "Lo-Fi Sunday",
      transportUri: "x-rincon-cpcontainer:1006206cplaylist%3Apl.7525e7e5e04f44269ce48ae05d39d209?sid=204&flags=8300",
      playable: true,
    },
  ];
  household.groups = [
    {
      id: "GROUP_UPPER_LEVEL",
      name: "Upper Level",
      coordinatorId: "RINCON_UPPER_LEVEL",
      playerIds: ["RINCON_UPPER_LEVEL", "RINCON_PRIMARY_BEDROOM"],
      playbackState: "PLAYBACK_STATE_PLAYING",
      currentSourceUri: "x-rincon-cpcontainer:1006206cplaylist%3apl.7525e7e5e04f44269ce48ae05d39d209",
    },
  ];

  assert.deepEqual(matchSceneTopology(scene, snapshot), { active: true });
});
