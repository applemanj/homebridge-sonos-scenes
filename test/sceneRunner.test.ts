import assert from "node:assert/strict";
import test from "node:test";
import { DiscoveryService } from "../src/discoveryService";
import { StructuredLogger } from "../src/logger";
import { sampleTopology } from "../src/sampleTopology";
import { SceneRunner } from "../src/sceneRunner";
import type { SceneDefinition, SceneSourceKind, SonosTransport, TopologySnapshot } from "../src/types";

class FakeTransport implements SonosTransport {
  readonly kind = "fake";
  readonly calls: string[] = [];
  private topology: TopologySnapshot = JSON.parse(JSON.stringify(sampleTopology));
  private failSetGroupMembersOnce = true;

  supportsSource(kind: SceneSourceKind): boolean {
    return kind !== "tv";
  }

  async discoverHouseholds() {
    return this.topology.households.map((household) => ({
      id: household.id,
      displayName: household.displayName,
    }));
  }

  async discoverTopology(): Promise<TopologySnapshot> {
    return JSON.parse(JSON.stringify(this.topology));
  }

  async setGroupMembers(_householdId: string, coordinatorPlayerId: string, memberPlayerIds: string[]): Promise<void> {
    this.calls.push(`setGroupMembers:${coordinatorPlayerId}:${memberPlayerIds.join(",")}`);
    if (this.failSetGroupMembersOnce) {
      this.failSetGroupMembersOnce = false;
      throw new Error("temporary group failure");
    }
  }

  async modifyGroupMembers(): Promise<void> {}

  async loadLineIn(_householdId: string, coordinatorPlayerId: string, deviceId: string): Promise<void> {
    this.calls.push(`loadLineIn:${coordinatorPlayerId}:${deviceId}`);
  }

  async loadFavorite(_householdId: string, coordinatorPlayerId: string, favoriteId: string): Promise<void> {
    this.calls.push(`loadFavorite:${coordinatorPlayerId}:${favoriteId}`);
  }

  async setGroupVolume(): Promise<void> {}

  async setPlayerVolume(_householdId: string, playerId: string, volume: number): Promise<void> {
    this.calls.push(`setPlayerVolume:${playerId}:${volume}`);
  }

  async ungroup(_householdId: string, coordinatorPlayerId: string, memberPlayerIds?: string[]): Promise<void> {
    this.calls.push(`ungroup:${coordinatorPlayerId}:${(memberPlayerIds ?? []).join(",")}`);
  }
}

test("SceneRunner executes scene actions in order and retries transient failures", async () => {
  const transport = new FakeTransport();
  const discovery = new DiscoveryService(transport);
  const runner = new SceneRunner(discovery, transport, new StructuredLogger("test", "debug"));

  const scene: SceneDefinition = {
    id: "scene-line-in",
    name: "Upper Level Line In",
    householdId: "local-household",
    coordinatorPlayerId: "RINCON_UPPER_LEVEL",
    memberPlayerIds: ["RINCON_PRIMARY_BEDROOM"],
    source: {
      kind: "line_in",
      deviceId: "RINCON_UPPER_LEVEL",
      playOnCompletion: true,
    },
    coordinatorVolume: 20,
    playerVolumes: [
      {
        playerId: "RINCON_PRIMARY_BEDROOM",
        volume: 16,
      },
    ],
    offBehavior: {
      kind: "ungroup",
    },
    settleMs: 0,
    retryCount: 1,
    retryDelayMs: 0,
    autoResetMs: 0,
  };

  const result = await runner.runOn(scene);
  assert.equal(result.ok, true);
  assert.deepEqual(transport.calls, [
    "setGroupMembers:RINCON_UPPER_LEVEL:RINCON_PRIMARY_BEDROOM",
    "setGroupMembers:RINCON_UPPER_LEVEL:RINCON_PRIMARY_BEDROOM",
    "loadLineIn:RINCON_UPPER_LEVEL:RINCON_UPPER_LEVEL",
    "setPlayerVolume:RINCON_UPPER_LEVEL:20",
    "setPlayerVolume:RINCON_PRIMARY_BEDROOM:16",
  ]);
});

test("SceneRunner executes the off ungroup action", async () => {
  const transport = new FakeTransport();
  const discovery = new DiscoveryService(transport);
  const runner = new SceneRunner(discovery, transport, new StructuredLogger("test", "debug"));

  const scene: SceneDefinition = {
    id: "scene-off",
    name: "Ungroup Scene",
    householdId: "local-household",
    coordinatorPlayerId: "RINCON_UPPER_LEVEL",
    memberPlayerIds: ["RINCON_PRIMARY_BEDROOM"],
    playerVolumes: [],
    offBehavior: {
      kind: "ungroup",
    },
    settleMs: 0,
    retryCount: 0,
    retryDelayMs: 0,
    autoResetMs: 0,
  };

  const result = await runner.runOff(scene);
  assert.equal(result.ok, true);
  assert.deepEqual(transport.calls, ["ungroup:RINCON_UPPER_LEVEL:RINCON_PRIMARY_BEDROOM"]);
});
