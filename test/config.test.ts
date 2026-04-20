import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlatformConfig } from "../src/config";

test("normalizePlatformConfig applies defaults and normalizes scenes", () => {
  const config = normalizePlatformConfig({
    name: "Custom Sonos Scenes",
    transport: {
      kind: "local",
      enableLiveDiscovery: false,
      discoveryTimeoutMs: 1000,
      requestTimeoutMs: 2000,
      allowTvSource: true,
    },
    scenes: [
      {
        name: "Kitchen Favorite",
        householdId: "household-1",
        coordinatorPlayerId: "player-1",
        memberPlayerIds: ["player-2", "player-2"],
        source: {
          kind: "favorite",
          favoriteId: "favorite-1",
        },
        playerVolumes: [
          {
            playerId: "player-2",
            volume: 24,
          },
        ],
        offBehavior: {
          kind: "ungroup",
        },
      } as any,
    ],
  });

  assert.equal(config.platform, "SonosScenes");
  assert.equal(config.name, "Custom Sonos Scenes");
  assert.equal(config.transport.allowTvSource, true);
  assert.equal(config.cloud.mode, "local_only");
  assert.equal(config.cloud.broker.timeoutMs, 8000);
  assert.equal(config.scenes[0].name, "Kitchen Favorite");
  assert.deepEqual(config.scenes[0].memberPlayerIds, ["player-2", "player-2"]);
  assert.equal(config.scenes[0].retryCount, 3);
  assert.equal(config.scenes[0].autoResetMs, 0);
});

test("normalizePlatformConfig preserves future self-hosted broker settings", () => {
  const config = normalizePlatformConfig({
    cloud: {
      mode: "local_plus_cloud",
      broker: {
        url: "https://broker.example.com/",
        apiKey: " test-token ",
        timeoutMs: 12000,
        routeFavorites: true,
        routePlaylists: false,
      },
    },
  });

  assert.equal(config.cloud.mode, "local_plus_cloud");
  assert.equal(config.cloud.broker.url, "https://broker.example.com/");
  assert.equal(config.cloud.broker.apiKey, "test-token");
  assert.equal(config.cloud.broker.timeoutMs, 12000);
  assert.equal(config.cloud.broker.routeFavorites, true);
  assert.equal(config.cloud.broker.routePlaylists, false);
});

test("normalizePlatformConfig normalizes virtual room defaults", () => {
  const config = normalizePlatformConfig({
    virtualRooms: [
      {
        name: "Primary Bedroom Ceiling",
        householdId: "local-household",
        ampPlayerId: "RINCON_AMP_UPSTAIRS",
        channel: "right",
        defaultVolume: 42,
        onBehavior: {
          kind: "default_volume",
        },
      } as any,
    ],
  });

  assert.equal(config.virtualRooms.length, 1);
  assert.equal(config.virtualRooms[0].id, "primary-bedroom-ceiling");
  assert.equal(config.virtualRooms[0].channel, "right");
  assert.equal(config.virtualRooms[0].defaultVolume, 42);
  assert.equal(config.virtualRooms[0].maxVolume, 100);
  assert.equal(config.virtualRooms[0].offBehavior.kind, "mute");
  assert.equal(config.virtualRooms[0].lastActiveBehavior.kind, "none");
});
