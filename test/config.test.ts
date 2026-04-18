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
  assert.equal(config.scenes[0].name, "Kitchen Favorite");
  assert.deepEqual(config.scenes[0].memberPlayerIds, ["player-2", "player-2"]);
  assert.equal(config.scenes[0].retryCount, 3);
  assert.equal(config.scenes[0].autoResetMs, 1000);
});
