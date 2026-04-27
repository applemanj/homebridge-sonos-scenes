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
