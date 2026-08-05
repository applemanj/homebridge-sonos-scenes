import assert from "node:assert/strict";
import test from "node:test";
import { CloudBrokerClient } from "../src/cloud/brokerClient";
import { HybridSonosTransport } from "../src/transports/hybridTransport";
import { LocalSonosTransport } from "../src/transports/localTransport";
import { createTransport } from "../src/transports";
import type { CloudBrokerConfig, SonosTransport, TopologySnapshot } from "../src/types";

// -- CloudBrokerClient tests --

test("CloudBrokerClient reports configured when URL is set", () => {
  const client = new CloudBrokerClient({
    url: "http://localhost:8787",
    timeoutMs: 5000,
    routeFavorites: true,
    routePlaylists: true,
  });
  assert.equal(client.configured, true);
  assert.equal(client.baseUrl, "http://localhost:8787");
});

test("CloudBrokerClient reports unconfigured when URL is missing", () => {
  const client = new CloudBrokerClient({
    timeoutMs: 5000,
    routeFavorites: true,
    routePlaylists: true,
  });
  assert.equal(client.configured, false);
  assert.equal(client.baseUrl, undefined);
});

test("CloudBrokerClient trims trailing slashes from URL", () => {
  const client = new CloudBrokerClient({
    url: "http://broker:8787///",
    timeoutMs: 5000,
    routeFavorites: true,
    routePlaylists: true,
  });
  assert.equal(client.baseUrl, "http://broker:8787");
});

// -- Transport factory tests --

test("createTransport returns LocalSonosTransport in local_only mode", () => {
  const transport = createTransport({
    transport: {
      kind: "local",
      enableLiveDiscovery: false,
      discoveryTimeoutMs: 1000,
      requestTimeoutMs: 2000,
      allowTvSource: false,
    },
    cloud: {
      mode: "local_only",
      broker: {
        timeoutMs: 5000,
        routeFavorites: true,
        routePlaylists: true,
      },
    },
  });
  assert.equal(transport.kind, "local");
});

test("createTransport returns HybridSonosTransport in local_plus_cloud mode", () => {
  const transport = createTransport({
    transport: {
      kind: "local",
      enableLiveDiscovery: false,
      discoveryTimeoutMs: 1000,
      requestTimeoutMs: 2000,
      allowTvSource: false,
    },
    cloud: {
      mode: "local_plus_cloud",
      broker: {
        url: "http://localhost:8787",
        apiKey: "test-key",
        timeoutMs: 5000,
        routeFavorites: true,
        routePlaylists: true,
      },
    },
  });
  assert.equal(transport.kind, "local_plus_cloud");
});

// -- HybridSonosTransport tests --

function createMockLocalTransport(): SonosTransport {
  return {
    kind: "local",
    supportsSource: (kind) => kind === "favorite" || kind === "line_in" || kind === "tv",
    discoverHouseholds: async () => [{ id: "hh-1", displayName: "My Home" }],
    discoverTopology: async () => ({
      households: [{
        id: "hh-1",
        displayName: "My Home",
        groups: [{
          id: "group-1",
          coordinatorId: "player-1",
          playerIds: ["player-1", "player-2"],
          players: [],
        }],
        players: [],
      }],
    } as unknown as TopologySnapshot),
    setGroupMembers: async () => {},
    modifyGroupMembers: async () => {},
    loadLineIn: async () => {},
    loadFavorite: async () => { throw new Error("Local favorite load not supported"); },
    loadTv: async () => {},
    getGroupVolume: async () => 50,
    setGroupVolume: async () => {},
    getPlayerVolume: async () => 50,
    setPlayerVolume: async () => {},
    getPlayerChannelVolume: async () => 50,
    setPlayerChannelVolume: async () => {},
    getGroupMuted: async () => false,
    setGroupMuted: async () => {},
    getPlayerMuted: async () => false,
    setPlayerMuted: async () => {},
    getPlayerChannelMuted: async () => false,
    setPlayerChannelMuted: async () => {},
    pausePlayback: async () => {},
    stopPlayback: async () => {},
    ungroup: async () => {},
  };
}

test("HybridSonosTransport delegates discoverHouseholds to local transport", async () => {
  const local = createMockLocalTransport();
  const hybrid = new HybridSonosTransport(local, {
    url: "http://localhost:8787",
    timeoutMs: 5000,
    routeFavorites: true,
    routePlaylists: true,
  });

  const households = await hybrid.discoverHouseholds();
  assert.equal(households.length, 1);
  assert.equal(households[0].id, "hh-1");
});

test("HybridSonosTransport delegates volume operations to local transport", async () => {
  const local = createMockLocalTransport();
  const hybrid = new HybridSonosTransport(local, {
    url: "http://localhost:8787",
    timeoutMs: 5000,
    routeFavorites: true,
    routePlaylists: true,
  });

  const volume = await hybrid.getGroupVolume("hh-1", "player-1");
  assert.equal(volume, 50);
});

test("HybridSonosTransport falls back to local when broker is not configured", async () => {
  const local = createMockLocalTransport();
  let localFavoriteLoaded = false;
  local.loadFavorite = async () => { localFavoriteLoaded = true; };

  const hybrid = new HybridSonosTransport(local, {
    timeoutMs: 5000,
    routeFavorites: true,
    routePlaylists: true,
  });

  await hybrid.loadFavorite("hh-1", "player-1", "fav-1");
  assert.equal(localFavoriteLoaded, true);
});

test("HybridSonosTransport supports favorite source even when local does", async () => {
  const local = createMockLocalTransport();
  const hybrid = new HybridSonosTransport(local, {
    url: "http://localhost:8787",
    timeoutMs: 5000,
    routeFavorites: true,
    routePlaylists: true,
  });

  assert.equal(hybrid.supportsSource("favorite"), true);
});
