import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLogCollector, StructuredLogger } from "../src/logger";
import { buildFavoriteTransportUri, LocalSonosTransport, parseFavoriteBrowseXml } from "../src/transports/localTransport";

const rawFavoriteBrowseXml = `
  <DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
    <item id="FV:2/11" parentID="FV:2" restricted="false">
      <dc:title>Audio Component: Upper Level</dc:title>
      <upnp:class>object.itemobject.item.sonos-favorite</upnp:class>
      <res protocolInfo="x-rincon-stream:*:*:*">x-rincon-stream:RINCON_347E5C07C5F901400</res>
      <r:type>instantPlay</r:type>
      <r:description>Line-In</r:description>
      <r:resMD>&lt;DIDL-Lite xmlns:dc=&quot;http://purl.org/dc/elements/1.1/&quot; xmlns:upnp=&quot;urn:schemas-upnp-org:metadata-1-0/upnp/&quot; xmlns:r=&quot;urn:schemas-rinconnetworks-com:metadata-1-0/&quot; xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/&quot;&gt;&lt;item id=&quot;RINCON_347E5C07C5F901400&quot; parentID=&quot;&quot; restricted=&quot;true&quot;&gt;&lt;dc:title&gt;Audio Component: Upper Level&lt;/dc:title&gt;&lt;upnp:class&gt;object.item.audioItem.linein&lt;/upnp:class&gt;&lt;desc id=&quot;cdudn&quot; nameSpace=&quot;urn:schemas-rinconnetworks-com:metadata-1-0/&quot;&gt;&lt;/desc&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</r:resMD>
    </item>
    <item id="FV:2/9" parentID="FV:2" restricted="false">
      <dc:title>The Hipster Orchestra</dc:title>
      <upnp:class>object.itemobject.item.sonos-favorite</upnp:class>
      <res></res>
      <r:type>shortcut</r:type>
      <r:description>Artist</r:description>
      <r:resMD>&lt;DIDL-Lite xmlns:dc=&quot;http://purl.org/dc/elements/1.1/&quot; xmlns:upnp=&quot;urn:schemas-upnp-org:metadata-1-0/upnp/&quot; xmlns:r=&quot;urn:schemas-rinconnetworks-com:metadata-1-0/&quot; xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/&quot;&gt;&lt;item id=&quot;10052064artist%3a1314005644&quot; parentID=&quot;10052064artist%3a1314005644&quot; restricted=&quot;true&quot;&gt;&lt;dc:title&gt;The Hipster Orchestra&lt;/dc:title&gt;&lt;upnp:class&gt;object.container.person.musicArtist&lt;/upnp:class&gt;&lt;desc id=&quot;cdudn&quot; nameSpace=&quot;urn:schemas-rinconnetworks-com:metadata-1-0/&quot;&gt;SA_RINCON52231_X_#Svc52231-0-Token&lt;/desc&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</r:resMD>
    </item>
    <item id="FV:2/13" parentID="FV:2" restricted="false">
      <dc:title>Lo-Fi Sunday</dc:title>
      <upnp:class>object.itemobject.item.sonos-favorite</upnp:class>
      <res protocolInfo="x-rincon-cpcontainer:*:*:*">x-rincon-cpcontainer:1006206cplaylist%3Apl.7525e7e5e04f44269ce48ae05d39d209?sid=204&amp;flags=8300&amp;sn=18</res>
      <r:type>instantPlay</r:type>
      <r:description>Apple Music</r:description>
      <r:resMD>&lt;DIDL-Lite xmlns:dc=&quot;http://purl.org/dc/elements/1.1/&quot; xmlns:upnp=&quot;urn:schemas-upnp-org:metadata-1-0/upnp/&quot; xmlns:r=&quot;urn:schemas-rinconnetworks-com:metadata-1-0/&quot; xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/&quot;&gt;&lt;item id=&quot;1006206cplaylist%3Apl.7525e7e5e04f44269ce48ae05d39d209&quot; parentID=&quot;1006206cplaylist%3Apl.7525e7e5e04f44269ce48ae05d39d209&quot; restricted=&quot;true&quot;&gt;&lt;dc:title&gt;Lo-Fi Sunday&lt;/dc:title&gt;&lt;upnp:class&gt;object.container.playlistContainer&lt;/upnp:class&gt;&lt;desc id=&quot;cdudn&quot; nameSpace=&quot;urn:schemas-rinconnetworks-com:metadata-1-0/&quot;&gt;SA_RINCON52231_X_#Svc52231-323b073d-Token&lt;/desc&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</r:resMD>
    </item>
  </DIDL-Lite>
`;

test("parseFavoriteBrowseXml preserves direct favorite URIs and metadata", () => {
  const favorites = parseFavoriteBrowseXml(rawFavoriteBrowseXml);
  const directFavorite = favorites.find((favorite) => favorite.id === "2/11");

  assert.ok(directFavorite);
  assert.equal(directFavorite.name, "Audio Component: Upper Level");
  assert.equal(directFavorite.description, "Line-In");
  assert.equal(directFavorite.playbackType, "instantPlay");
  assert.equal(directFavorite.uri, "x-rincon-stream:RINCON_347E5C07C5F901400");
  assert.equal(directFavorite.transportUri, "x-rincon-stream:RINCON_347E5C07C5F901400");
  assert.match(directFavorite.metadata ?? "", /Audio Component: Upper Level/);
});

test("buildFavoriteTransportUri derives container URIs for shortcut favorites", () => {
  const favorites = parseFavoriteBrowseXml(rawFavoriteBrowseXml);
  const shortcutFavorite = favorites.find((favorite) => favorite.id === "2/9");

  assert.ok(shortcutFavorite);
  assert.equal(shortcutFavorite.name, "The Hipster Orchestra");
  assert.equal(shortcutFavorite.description, "Artist");
  assert.equal(shortcutFavorite.playbackType, "shortcut");
  assert.equal(shortcutFavorite.uri, undefined);
  assert.equal(shortcutFavorite.playable, false);
  assert.match(shortcutFavorite.unsupportedReason ?? "", /not playable through the local transport/i);
  assert.equal(
    buildFavoriteTransportUri(shortcutFavorite),
    "x-rincon-cpcontainer:10052064artist%3a1314005644",
  );
  assert.equal(shortcutFavorite.transportUri, "x-rincon-cpcontainer:10052064artist%3a1314005644");
  assert.match(shortcutFavorite.metadata ?? "", /object\.container\.person\.musicArtist/);
});

test("parseFavoriteBrowseXml marks playlist-container favorites as not playable locally", () => {
  const favorites = parseFavoriteBrowseXml(rawFavoriteBrowseXml);
  const playlistFavorite = favorites.find((favorite) => favorite.id === "2/13");

  assert.ok(playlistFavorite);
  assert.equal(playlistFavorite.name, "Lo-Fi Sunday");
  assert.equal(playlistFavorite.description, "Apple Music");
  assert.equal(playlistFavorite.playbackType, "instantPlay");
  assert.equal(playlistFavorite.playable, false);
  assert.match(playlistFavorite.unsupportedReason ?? "", /not playable through the local transport yet/i);
  assert.match(playlistFavorite.metadata ?? "", /object\.container\.playlistContainer/);
});

test("LocalSonosTransport tracks channel volume and mute separately in fixture mode", async () => {
  const transport = new LocalSonosTransport({
    kind: "local",
    enableLiveDiscovery: false,
    discoveryTimeoutMs: 2500,
    requestTimeoutMs: 5000,
    allowTvSource: false,
  });

  assert.equal(await transport.getPlayerVolume("local-household", "RINCON_UPPER_LEVEL"), 0);
  assert.equal(await transport.getPlayerChannelVolume("local-household", "RINCON_UPPER_LEVEL", "left"), 0);

  await transport.setPlayerVolume("local-household", "RINCON_UPPER_LEVEL", 27);
  await transport.setPlayerChannelVolume("local-household", "RINCON_UPPER_LEVEL", "left", 31);
  await transport.setPlayerChannelMuted("local-household", "RINCON_UPPER_LEVEL", "left", true);

  assert.equal(await transport.getPlayerVolume("local-household", "RINCON_UPPER_LEVEL"), 27);
  assert.equal(await transport.getPlayerMuted("local-household", "RINCON_UPPER_LEVEL"), false);
  assert.equal(await transport.getPlayerChannelVolume("local-household", "RINCON_UPPER_LEVEL", "left"), 31);
  assert.equal(await transport.getPlayerChannelVolume("local-household", "RINCON_UPPER_LEVEL", "right"), 0);
  assert.equal(await transport.getPlayerChannelMuted("local-household", "RINCON_UPPER_LEVEL", "left"), true);
  assert.equal(await transport.getPlayerChannelMuted("local-household", "RINCON_UPPER_LEVEL", "right"), false);
});

test("LocalSonosTransport updates fixture playback state for pause and stop", async () => {
  const transport = new LocalSonosTransport({
    kind: "local",
    enableLiveDiscovery: false,
    discoveryTimeoutMs: 2500,
    requestTimeoutMs: 5000,
    allowTvSource: false,
  });

  await transport.pausePlayback("local-household", "RINCON_UPPER_LEVEL");
  let snapshot = await transport.discoverTopology();
  let group = snapshot.households[0].groups.find((item) => item.coordinatorId === "RINCON_UPPER_LEVEL");
  assert.equal(group?.playbackState, "PLAYBACK_STATE_PAUSED_PLAYBACK");

  await transport.stopPlayback("local-household", "RINCON_UPPER_LEVEL");
  snapshot = await transport.discoverTopology();
  group = snapshot.households[0].groups.find((item) => item.coordinatorId === "RINCON_UPPER_LEVEL");
  assert.equal(group?.playbackState, "PLAYBACK_STATE_IDLE");
});

test("LocalSonosTransport reads live channel state from rendering control instead of master values", async () => {
  const householdId = "local-household";
  const playerId = "RINCON_UPPER_LEVEL";
  const calls: string[] = [];
  const transport = new LocalSonosTransport({
    kind: "local",
    enableLiveDiscovery: false,
    discoveryTimeoutMs: 2500,
    requestTimeoutMs: 5000,
    allowTvSource: false,
  });

  const fakeDevice = {
    getVolume: async () => 88,
    getMuted: async () => false,
    renderingControlService: () => ({
      GetVolume: async (channel = "Master") => {
        calls.push(`GetVolume:${channel}`);
        return channel === "LF" ? 23 : 61;
      },
      GetMute: async (channel = "Master") => {
        calls.push(`GetMute:${channel}`);
        return channel === "LF";
      },
    }),
  };

  (transport as unknown as {
    livePlayers: Map<string, unknown>;
    discoverTopology: () => Promise<unknown>;
  }).livePlayers = new Map([
    [playerId, { device: fakeDevice, host: "127.0.0.1", port: 1400, householdId }],
  ]);

  (transport as unknown as {
    discoverTopology: () => Promise<unknown>;
  }).discoverTopology = async () => ({
    capturedAt: new Date().toISOString(),
    origin: "live",
    households: [
      {
        id: householdId,
        displayName: "Sonos Household",
        players: [
          {
            id: playerId,
            name: "Upper Level",
            model: "Sonos Amp",
            capabilities: ["PLAYBACK", "LINE_IN"],
            deviceIds: [playerId],
            isCoordinator: true,
            fixedVolume: false,
            sourceOptions: ["favorite", "line_in"],
          },
        ],
        groups: [
          {
            id: "group-upper-level",
            name: "Upper Level",
            coordinatorId: playerId,
            playerIds: [playerId],
            playbackState: "PLAYBACK_STATE_IDLE",
          },
        ],
        favorites: [],
      },
    ],
  });

  assert.equal(await transport.getPlayerChannelVolume(householdId, playerId, "left"), 23);
  assert.equal(await transport.getPlayerChannelVolume(householdId, playerId, "right"), 61);
  assert.equal(await transport.getPlayerChannelMuted(householdId, playerId, "left"), true);
  assert.equal(await transport.getPlayerChannelMuted(householdId, playerId, "right"), false);
  assert.deepEqual(calls, ["GetVolume:LF", "GetVolume:RF", "GetMute:LF", "GetMute:RF"]);
});

test("LocalSonosTransport emits transport logs for live channel volume requests and returns", async () => {
  const householdId = "local-household";
  const playerId = "RINCON_UPPER_LEVEL";
  const setVolumeCalls: string[] = [];
  const collector = new MemoryLogCollector();
  const logger = new StructuredLogger("test", "info", undefined, collector);
  const transport = new LocalSonosTransport(
    {
      kind: "local",
      enableLiveDiscovery: false,
      discoveryTimeoutMs: 2500,
      requestTimeoutMs: 5000,
      allowTvSource: false,
    },
    logger,
  );

  const fakeDevice = {
    setVolume: async (volume: number, channel?: string) => {
      setVolumeCalls.push(`setVolume:${channel ?? "Master"}:${volume}`);
    },
    renderingControlService: () => ({
      GetVolume: async (channel = "Master") => (channel === "LF" ? 27 : 61),
      GetMute: async () => false,
    }),
  };

  (transport as unknown as {
    livePlayers: Map<string, unknown>;
    discoverTopology: () => Promise<unknown>;
  }).livePlayers = new Map([
    [
      playerId,
      {
        device: fakeDevice,
        host: "127.0.0.1",
        port: 1400,
        householdId,
        zoneAttrs: { CurrentZoneName: "Upper Level" },
      },
    ],
  ]);

  (transport as unknown as {
    discoverTopology: () => Promise<unknown>;
  }).discoverTopology = async () => ({
    capturedAt: new Date().toISOString(),
    origin: "live",
    households: [
      {
        id: householdId,
        displayName: "Sonos Household",
        players: [
          {
            id: playerId,
            name: "Upper Level",
            model: "Sonos Amp",
            capabilities: ["PLAYBACK", "LINE_IN"],
            deviceIds: [playerId],
            isCoordinator: true,
            fixedVolume: false,
            sourceOptions: ["favorite", "line_in"],
          },
        ],
        groups: [
          {
            id: "group-upper-level",
            name: "Upper Level",
            coordinatorId: playerId,
            playerIds: [playerId],
            playbackState: "PLAYBACK_STATE_IDLE",
          },
        ],
        favorites: [],
      },
    ],
  });

  await transport.setPlayerChannelVolume(householdId, playerId, "left", 27);
  assert.equal(await transport.getPlayerChannelVolume(householdId, playerId, "left"), 27);

  assert.deepEqual(setVolumeCalls, ["setVolume:LF:27"]);
  assert.equal(
    collector.entries.some((entry) => entry.message.includes("Sending Sonos set channel volume request: player=Upper Level")),
    true,
  );
  assert.equal(
    collector.entries.some((entry) => entry.message.includes("Sonos set channel volume completed: player=Upper Level")),
    true,
  );
  assert.equal(
    collector.entries.some((entry) => entry.message.includes("Sonos get channel volume returned: player=Upper Level")),
    true,
  );
});
