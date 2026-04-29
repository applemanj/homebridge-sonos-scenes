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
  readonly playerVolumes = new Map<string, number>([
    ["RINCON_UPPER_LEVEL", 0],
    ["RINCON_PRIMARY_BEDROOM", 0],
  ]);
  readonly playerMutes = new Map<string, boolean>([
    ["RINCON_UPPER_LEVEL", false],
    ["RINCON_PRIMARY_BEDROOM", false],
  ]);

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

  async getPlayerVolume(_householdId: string, playerId: string): Promise<number> {
    return this.playerVolumes.get(playerId) ?? 0;
  }

  async setPlayerVolume(_householdId: string, playerId: string, volume: number): Promise<void> {
    this.calls.push(`setPlayerVolume:${playerId}:${volume}`);
    if (this.failPlayerVolumeFor === playerId) {
      throw new Error(`volume write failed for ${playerId}`);
    }
    this.playerVolumes.set(playerId, volume);
  }

  async getPlayerChannelVolume(_householdId: string, _playerId: string, _channel: VirtualRoomChannel): Promise<number> {
    return 0;
  }

  async setPlayerChannelVolume(): Promise<void> {}

  async getGroupMuted(): Promise<boolean> {
    return false;
  }

  async setGroupMuted(): Promise<void> {}

  async getPlayerMuted(_householdId: string, playerId: string): Promise<boolean> {
    return this.playerMutes.get(playerId) ?? false;
  }

  async setPlayerMuted(_householdId: string, playerId: string, muted: boolean): Promise<void> {
    this.calls.push(`setPlayerMuted:${playerId}:${muted}`);
    this.playerMutes.set(playerId, muted);
  }

  async getPlayerChannelMuted(_householdId: string, _playerId: string, _channel: VirtualRoomChannel): Promise<boolean> {
    return false;
  }

  async setPlayerChannelMuted(): Promise<void> {}

  async pausePlayback(_householdId: string, coordinatorPlayerId: string): Promise<void> {
    this.calls.push(`pausePlayback:${coordinatorPlayerId}`);
  }

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

test("SceneRunner executes the off pause action", async () => {
  const transport = new FakeTransport();
  const discovery = new DiscoveryService(transport);
  const runner = new SceneRunner(discovery, transport, new StructuredLogger("test", "debug"));

  const scene: SceneDefinition = {
    id: "scene-off-pause",
    name: "Pause Scene",
    householdId: "local-household",
    coordinatorPlayerId: "RINCON_UPPER_LEVEL",
    memberPlayerIds: [],
    playerVolumes: [],
    offBehavior: {
      kind: "pause",
    },
    settleMs: 0,
    retryCount: 0,
    retryDelayMs: 0,
    autoResetMs: 0,
  };

  const result = await runner.runOff(scene);
  assert.equal(result.ok, true);
  assert.deepEqual(transport.calls, ["pausePlayback:RINCON_UPPER_LEVEL"]);
  assert.equal(transport.discoverCalls, 1);
});

test("SceneRunner executes the off stop action", async () => {
  const transport = new FakeTransport();
  const discovery = new DiscoveryService(transport);
  const runner = new SceneRunner(discovery, transport, new StructuredLogger("test", "debug"));

  const scene: SceneDefinition = {
    id: "scene-off-stop",
    name: "Stop Scene",
    householdId: "local-household",
    coordinatorPlayerId: "RINCON_UPPER_LEVEL",
    memberPlayerIds: [],
    playerVolumes: [],
    offBehavior: {
      kind: "stop",
    },
    settleMs: 0,
    retryCount: 0,
    retryDelayMs: 0,
    autoResetMs: 0,
  };

  const result = await runner.runOff(scene);
  assert.equal(result.ok, true);
  assert.deepEqual(transport.calls, ["stopPlayback:RINCON_UPPER_LEVEL"]);
  assert.equal(transport.discoverCalls, 1);
});

test("SceneRunner restores captured grouping and volume state on off", async () => {
  const transport = new FakeTransport();
  (transport as any).failSetGroupMembersOnce = false;
  transport.playerVolumes.set("RINCON_UPPER_LEVEL", 12);
  transport.playerMutes.set("RINCON_UPPER_LEVEL", true);
  transport.playerVolumes.set("RINCON_PRIMARY_BEDROOM", 34);
  transport.playerMutes.set("RINCON_PRIMARY_BEDROOM", false);
  const discovery = new DiscoveryService(transport);
  const runner = new SceneRunner(discovery, transport, new StructuredLogger("test", "debug"));

  const scene: SceneDefinition = {
    id: "scene-restore-previous",
    name: "Restore Previous Scene",
    householdId: "local-household",
    coordinatorPlayerId: "RINCON_UPPER_LEVEL",
    memberPlayerIds: ["RINCON_PRIMARY_BEDROOM"],
    coordinatorVolume: 20,
    playerVolumes: [
      {
        playerId: "RINCON_PRIMARY_BEDROOM",
        volume: 16,
      },
    ],
    offBehavior: {
      kind: "restore_previous",
    },
    settleMs: 0,
    retryCount: 0,
    retryDelayMs: 0,
    autoResetMs: 0,
  };

  const onResult = await runner.runOn(scene);
  assert.equal(onResult.ok, true);
  assert.equal(transport.playerVolumes.get("RINCON_UPPER_LEVEL"), 20);
  assert.equal(transport.playerVolumes.get("RINCON_PRIMARY_BEDROOM"), 16);

  transport.calls.length = 0;

  const offResult = await runner.runOff(scene);

  assert.equal(offResult.ok, true);
  assert.deepEqual(
    new Set(transport.calls),
    new Set([
      "stopPlayback:RINCON_UPPER_LEVEL",
      "setGroupMembers:RINCON_UPPER_LEVEL:",
      "setGroupMembers:RINCON_PRIMARY_BEDROOM:",
      "setPlayerVolume:RINCON_UPPER_LEVEL:12",
      "setPlayerMuted:RINCON_UPPER_LEVEL:true",
      "setPlayerVolume:RINCON_PRIMARY_BEDROOM:34",
      "setPlayerMuted:RINCON_PRIMARY_BEDROOM:false",
    ]),
  );
  assert.equal(transport.playerVolumes.get("RINCON_UPPER_LEVEL"), 12);
  assert.equal(transport.playerMutes.get("RINCON_UPPER_LEVEL"), true);
  assert.equal(transport.playerVolumes.get("RINCON_PRIMARY_BEDROOM"), 34);
  assert.equal(transport.playerMutes.get("RINCON_PRIMARY_BEDROOM"), false);
});

test("SceneRunner can load a line-in source from a room that is not in the playback group", async () => {
  const transport = new FakeTransport();
  (transport as any).failSetGroupMembersOnce = false;
  const discovery = new DiscoveryService(transport);
  const runner = new SceneRunner(discovery, transport, new StructuredLogger("test", "debug"));

  const scene: SceneDefinition = {
    id: "scene-remote-line-in",
    name: "Office Remote Line In",
    householdId: "local-household",
    coordinatorPlayerId: "RINCON_PRIMARY_BEDROOM",
    memberPlayerIds: [],
    source: {
      kind: "line_in",
      deviceId: "RINCON_UPPER_LEVEL",
      playOnCompletion: true,
    },
    coordinatorVolume: 30,
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
  assert.deepEqual(transport.calls, [
    "setGroupMembers:RINCON_PRIMARY_BEDROOM:",
    "loadLineIn:RINCON_PRIMARY_BEDROOM:RINCON_UPPER_LEVEL",
    "setPlayerVolume:RINCON_PRIMARY_BEDROOM:30",
    "setPlayerMuted:RINCON_PRIMARY_BEDROOM:false",
  ]);
});

test("SceneRunner ramps configured volume overrides when a ramp duration is set", async () => {
  const transport = new FakeTransport();
  (transport as any).failSetGroupMembersOnce = false;
  transport.playerVolumes.set("RINCON_UPPER_LEVEL", 10);
  const discovery = new DiscoveryService(transport);
  const runner = new SceneRunner(discovery, transport, new StructuredLogger("test", "debug"));

  const scene: SceneDefinition = {
    id: "scene-ramped-volume",
    name: "Ramped Volume",
    householdId: "local-household",
    coordinatorPlayerId: "RINCON_UPPER_LEVEL",
    memberPlayerIds: [],
    coordinatorVolume: 14,
    playerVolumes: [],
    volumeRampMs: 2,
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
  assert.deepEqual(transport.calls, [
    "setGroupMembers:RINCON_UPPER_LEVEL:",
    "setPlayerMuted:RINCON_UPPER_LEVEL:false",
    "setPlayerVolume:RINCON_UPPER_LEVEL:12",
    "setPlayerVolume:RINCON_UPPER_LEVEL:14",
  ]);
  assert.equal(transport.playerVolumes.get("RINCON_UPPER_LEVEL"), 14);
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
