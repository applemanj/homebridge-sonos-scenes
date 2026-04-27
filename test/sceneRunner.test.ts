import assert from "node:assert/strict";
import test from "node:test";
import { DiscoveryService } from "../src/discoveryService";
import { StructuredLogger } from "../src/logger";
import { sampleTopology } from "../src/sampleTopology";
import { SceneRunner } from "../src/sceneRunner";
import type { SceneDefinition, SceneSourceKind, SonosTransport, TopologySnapshot, VirtualRoomChannel } from "../src/types";

class FakeTransport implements SonosTransport {
  readonly kind = "fake";
  readonly calls: string[] = [];
  discoverCalls = 0;
  private topology: TopologySnapshot = JSON.parse(JSON.stringify(sampleTopology));
  private failSetGroupMembersOnce = true;
  failPlayerVolumeFor?: string;

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
    this.discoverCalls += 1;
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

  async getGroupVolume(): Promise<number> {
    return 0;
  }

  async setGroupVolume(): Promise<void> {}

  async getPlayerVolume(): Promise<number> {
    return 0;
  }

  async setPlayerVolume(_householdId: string, playerId: string, volume: number): Promise<void> {
    this.calls.push(`setPlayerVolume:${playerId}:${volume}`);
    if (this.failPlayerVolumeFor === playerId) {
      throw new Error(`volume write failed for ${playerId}`);
    }
  }

  async getPlayerChannelVolume(_householdId: string, _playerId: string, _channel: VirtualRoomChannel): Promise<number> {
    return 0;
  }

  async setPlayerChannelVolume(): Promise<void> {}

  async getGroupMuted(): Promise<boolean> {
    return false;
  }

  async setGroupMuted(): Promise<void> {}

  async getPlayerMuted(): Promise<boolean> {
    return false;
  }

  async setPlayerMuted(_householdId: string, playerId: string, muted: boolean): Promise<void> {
    this.calls.push(`setPlayerMuted:${playerId}:${muted}`);
  }

  async getPlayerChannelMuted(_householdId: string, _playerId: string, _channel: VirtualRoomChannel): Promise<boolean> {
    return false;
  }

  async setPlayerChannelMuted(): Promise<void> {}

  async pausePlayback(): Promise<void> {}

  async stopPlayback(_householdId: string, coordinatorPlayerId: string): Promise<void> {
    this.calls.push(`stopPlayback:${coordinatorPlayerId}`);
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
  assert.deepEqual(transport.calls.slice(0, 3), [
    "setGroupMembers:RINCON_UPPER_LEVEL:RINCON_PRIMARY_BEDROOM",
    "setGroupMembers:RINCON_UPPER_LEVEL:RINCON_PRIMARY_BEDROOM",
    "loadLineIn:RINCON_UPPER_LEVEL:RINCON_UPPER_LEVEL",
  ]);
  assert.deepEqual(
    new Set(transport.calls.slice(3)),
    new Set([
      "setPlayerVolume:RINCON_UPPER_LEVEL:20",
      "setPlayerMuted:RINCON_UPPER_LEVEL:false",
      "setPlayerVolume:RINCON_PRIMARY_BEDROOM:16",
      "setPlayerMuted:RINCON_PRIMARY_BEDROOM:false",
    ]),
  );
  assert.ok(
    transport.calls.indexOf("setPlayerVolume:RINCON_UPPER_LEVEL:20")
      < transport.calls.indexOf("setPlayerMuted:RINCON_UPPER_LEVEL:false"),
  );
  assert.ok(
    transport.calls.indexOf("setPlayerVolume:RINCON_PRIMARY_BEDROOM:16")
      < transport.calls.indexOf("setPlayerMuted:RINCON_PRIMARY_BEDROOM:false"),
  );
  assert.equal(transport.discoverCalls, 1);
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
  assert.deepEqual(transport.calls, [
    "stopPlayback:RINCON_UPPER_LEVEL",
    "ungroup:RINCON_UPPER_LEVEL:RINCON_PRIMARY_BEDROOM",
  ]);
  assert.equal(transport.discoverCalls, 1);
});

test("SceneRunner surfaces partial failure when one parallel room volume write fails", async () => {
  const transport = new FakeTransport();
  (transport as any).failSetGroupMembersOnce = false;
  transport.failPlayerVolumeFor = "RINCON_PRIMARY_BEDROOM";
  const discovery = new DiscoveryService(transport);
  const runner = new SceneRunner(discovery, transport, new StructuredLogger("test", "debug"));

  const scene: SceneDefinition = {
    id: "scene-partial-failure",
    name: "Parallel Volume Failure",
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
      kind: "none",
    },
    settleMs: 0,
    retryCount: 0,
    retryDelayMs: 0,
    autoResetMs: 0,
  };

  const result = await runner.runOn(scene);
  assert.equal(result.ok, false);
  assert.match(result.errors[0] ?? "", /volume write failed for RINCON_PRIMARY_BEDROOM/);
  assert.deepEqual(
    new Set(transport.calls.filter((call) => call.startsWith("setPlayerVolume:"))),
    new Set([
      "setPlayerVolume:RINCON_UPPER_LEVEL:20",
      "setPlayerVolume:RINCON_PRIMARY_BEDROOM:16",
    ]),
  );
});

test("SceneRunner unmutes selected rooms even when they do not have volume overrides", async () => {
  const transport = new FakeTransport();
  (transport as any).failSetGroupMembersOnce = false;
  const discovery = new DiscoveryService(transport);
  const runner = new SceneRunner(discovery, transport, new StructuredLogger("test", "debug"));

  const scene: SceneDefinition = {
    id: "scene-unmute-without-volume",
    name: "Unmute Without Volume",
    householdId: "local-household",
    coordinatorPlayerId: "RINCON_UPPER_LEVEL",
    memberPlayerIds: ["RINCON_PRIMARY_BEDROOM"],
    source: {
      kind: "line_in",
      deviceId: "RINCON_UPPER_LEVEL",
      playOnCompletion: true,
    },
    playerVolumes: [],
    offBehavior: {
      kind: "none",
    },
    settleMs: 0,
    retryCount: 0,
    retryDelayMs: 0,
    autoResetMs: 0,
  };

  const result = await runner.runOn(scene);
  assert.equal(result.ok, true);
  assert.deepEqual(
    new Set(transport.calls.filter((call) => call.startsWith("setPlayerMuted:"))),
    new Set([
      "setPlayerMuted:RINCON_UPPER_LEVEL:false",
      "setPlayerMuted:RINCON_PRIMARY_BEDROOM:false",
    ]),
  );
});
