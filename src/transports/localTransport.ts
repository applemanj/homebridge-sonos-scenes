import { readFile } from "node:fs/promises";
import path from "node:path";
import { SonosDevice, SonosDeviceDiscovery } from "@svrooij/sonos";
import type { StructuredLogger } from "../logger";
import { sampleTopology } from "../sampleTopology";
import type {
  HouseholdSnapshot,
  LocalTransportConfig,
  SceneSourceKind,
  SonosFavorite,
  SonosGroup,
  SonosPlayer,
  SonosTransport,
  TopologySnapshot,
  VirtualRoomChannel,
} from "../types";

interface LivePlayerRecord {
  device: SonosDevice;
  host: string;
  port: number;
  householdId: string;
  zoneName?: string;
  description?: ParsedDeviceDescription;
}

// Parsed from the raw /xml/device_description.xml because the sonos-ts
// GetDeviceDescription() helper does not expose the UPnP serviceList, which is
// the only reliable way to detect a physical line-in (AudioIn service).
interface ParsedDeviceDescription {
  modelName?: string;
  displayName?: string;
  hasAudioIn: boolean;
}

interface ChannelAudioState {
  volume: number;
  muted: boolean;
}

interface FixtureAudioState {
  master: ChannelAudioState;
  left: ChannelAudioState;
  right: ChannelAudioState;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripNamespacePrefix(input: string): string {
  const separatorIndex = input.indexOf(":");
  return separatorIndex >= 0 ? input.slice(separatorIndex + 1) : input;
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function extractAttributeValue(xml: string, tagName: string, attributeName: string): string | undefined {
  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*\\b${escapeRegExp(attributeName)}="([^"]+)"`, "i");
  const match = pattern.exec(xml);
  const value = match?.[1] ? decodeXmlEntities(match[1]).trim() : "";
  return value || undefined;
}

function extractTagValue(xml: string, tagName: string): string | undefined {
  const pattern = new RegExp(
    `<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`,
    "i",
  );
  const match = pattern.exec(xml);
  const value = match?.[1] ? decodeXmlEntities(match[1]).trim() : "";
  return value || undefined;
}

function buildFavoriteContainerUri(metadata: string): string | undefined {
  const metadataItemId = extractAttributeValue(metadata, "item", "id");
  if (!metadataItemId) {
    return undefined;
  }

  const itemClass = extractTagValue(metadata, "upnp:class")?.toLowerCase();
  if (metadataItemId.startsWith("RINCON_") || itemClass?.includes("linein")) {
    return `x-rincon-stream:${metadataItemId}`;
  }

  return `x-rincon-cpcontainer:${metadataItemId}`;
}

function favoriteMetadataClass(metadata: string | undefined): string | undefined {
  return metadata ? extractTagValue(metadata, "upnp:class")?.toLowerCase() : undefined;
}

export function buildFavoriteTransportUri(favorite: Pick<SonosFavorite, "uri" | "metadata">): string | undefined {
  if (favorite.uri?.trim()) {
    return decodeXmlEntities(favorite.uri).trim();
  }

  if (!favorite.metadata?.trim()) {
    return undefined;
  }

  return buildFavoriteContainerUri(favorite.metadata);
}

function favoriteUnsupportedReason(
  favorite: Pick<SonosFavorite, "uri" | "metadata" | "playbackType" | "description">,
): string | undefined {
  const metadataClass = favoriteMetadataClass(favorite.metadata);

  if (metadataClass?.includes("playlistcontainer")) {
    return `Favorite "${favorite.description?.toLowerCase() || "playlist"}" playlists are not playable through the local transport yet. Pick line-in or a directly playable favorite instead.`;
  }

  if (favorite.uri?.trim()) {
    return undefined;
  }

  if (favorite.playbackType?.toLowerCase() === "shortcut") {
    const description = favorite.description?.toLowerCase() || "shortcut";
    return `Favorite "${description}" shortcuts are not playable through the local transport. Pick a station, playlist, track, or line-in favorite instead.`;
  }

  return "This favorite does not expose a direct local playback URI for the local transport.";
}

function normalizeFavorite(favorite: SonosFavorite): SonosFavorite {
  const normalized: SonosFavorite = {
    ...favorite,
    id: favorite.id.trim(),
    name: favorite.name.trim() || favorite.id.trim(),
  };

  if (favorite.uri?.trim()) {
    normalized.uri = decodeXmlEntities(favorite.uri).trim();
  }

  if (favorite.metadata?.trim()) {
    normalized.metadata = decodeXmlEntities(favorite.metadata).trim();
  }

  const transportUri = favorite.transportUri?.trim() || buildFavoriteTransportUri(normalized);
  if (transportUri) {
    normalized.transportUri = transportUri;
  }

  const unsupportedReason = favorite.unsupportedReason?.trim() || favoriteUnsupportedReason(normalized);
  if (unsupportedReason) {
    normalized.unsupportedReason = unsupportedReason;
    normalized.playable = false;
  } else {
    normalized.playable = true;
  }

  return normalized;
}

export function parseFavoriteBrowseXml(xml: string): SonosFavorite[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  return items.map((itemXml) =>
    normalizeFavorite({
      id: stripNamespacePrefix(extractAttributeValue(itemXml, "item", "id") ?? randomString()),
      name: extractTagValue(itemXml, "dc:title") ?? "Favorite",
      uri: extractTagValue(itemXml, "res"),
      metadata: extractTagValue(itemXml, "r:resMD"),
      description: extractTagValue(itemXml, "r:description"),
      playbackType: extractTagValue(itemXml, "r:type"),
    }),
  );
}

function formatHouseholdDisplayName(householdIndex: number, householdCount: number): string {
  if (householdCount <= 1) {
    return "Sonos Household";
  }

  return `Sonos Household ${householdIndex + 1}`;
}

function normalizeFixtureSnapshot(input: TopologySnapshot): TopologySnapshot {
  return {
    ...clone(input),
    capturedAt: new Date().toISOString(),
    origin: "fixture",
  };
}

function buildFixtureAudioState(snapshot: TopologySnapshot): Map<string, FixtureAudioState> {
  return new Map(
    snapshot.households.flatMap((household) =>
      household.players.map((player) => [
        player.id,
        {
          master: emptyChannelState(),
          left: emptyChannelState(),
          right: emptyChannelState(),
        } satisfies FixtureAudioState,
      ] as const),
    ),
  );
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function channelToken(channel: VirtualRoomChannel): "LF" | "RF" {
  return channel === "right" ? "RF" : "LF";
}

function modelLooksTvCapable(description: ParsedDeviceDescription | undefined): boolean {
  const model = `${description?.modelName ?? ""} ${description?.displayName ?? ""}`.toLowerCase();
  return /(arc|beam|playbar|playbase|ray|amp)/.test(model);
}

function detectSourceOptions(description: ParsedDeviceDescription | undefined, allowTvSource: boolean): SceneSourceKind[] {
  const sourceOptions: SceneSourceKind[] = ["favorite"];

  if (description?.hasAudioIn) {
    sourceOptions.push("line_in");
  }

  if (allowTvSource && modelLooksTvCapable(description)) {
    sourceOptions.push("tv");
  }

  return unique(sourceOptions);
}

function detectCapabilities(description: ParsedDeviceDescription | undefined, allowTvSource: boolean): string[] {
  const capabilities = ["PLAYBACK"];
  if (description?.hasAudioIn) {
    capabilities.push("LINE_IN");
  }
  if (allowTvSource && modelLooksTvCapable(description)) {
    capabilities.push("TV");
  }
  capabilities.push("AIRPLAY");
  return capabilities;
}

function resolveFixturePath(fixturePath: string | undefined): string | undefined {
  if (!fixturePath) {
    return undefined;
  }

  if (path.isAbsolute(fixturePath)) {
    return fixturePath;
  }

  return path.resolve(process.cwd(), fixturePath);
}

function emptyChannelState(): ChannelAudioState {
  return {
    volume: 0,
    muted: false,
  };
}

function normalizeSonosPlaybackState(value: unknown): string {
  const normalized = normalizedString(value)?.toLowerCase();
  if (!normalized) {
    return "PLAYBACK_STATE_UNKNOWN";
  }

  if (normalized === "playing" || normalized.includes("playback_state_playing")) {
    return "PLAYBACK_STATE_PLAYING";
  }

  if (normalized === "paused" || normalized.includes("paused")) {
    return "PLAYBACK_STATE_PAUSED_PLAYBACK";
  }

  if (normalized === "stopped" || normalized.includes("stopped") || normalized.includes("idle") || normalized.includes("no_media")) {
    return "PLAYBACK_STATE_IDLE";
  }

  if (normalized === "transitioning" || normalized.includes("transitioning")) {
    return "PLAYBACK_STATE_TRANSITIONING";
  }

  return "PLAYBACK_STATE_UNKNOWN";
}

const LIVE_DISCOVERY_TTL_MS = 5_000;
const LIVE_RUNTIME_STATE_TIMEOUT_MS = 1_500;

export class LocalSonosTransport implements SonosTransport {
  public readonly kind = "local";
  private livePlayers = new Map<string, LivePlayerRecord>();
  private fixtureState = normalizeFixtureSnapshot(sampleTopology);
  private fixturePlayerAudio = buildFixtureAudioState(this.fixtureState);
  private fixtureLoaded = false;
  private householdRoots = new Map<string, SonosDevice>();
  private lastSnapshot = normalizeFixtureSnapshot(sampleTopology);
  private liveSnapshotCache?: { snapshot: TopologySnapshot; expiresAt: number };
  private liveDiscoveryInFlight?: Promise<TopologySnapshot | undefined>;

  constructor(
    private readonly config: LocalTransportConfig,
    private readonly logger?: StructuredLogger,
  ) {}

  private invalidateTopologyCache(): void {
    this.liveSnapshotCache = undefined;
  }

  supportsSource(kind: SceneSourceKind): boolean {
    if (kind === "tv") {
      return this.config.allowTvSource;
    }

    return true;
  }

  async discoverHouseholds() {
    const snapshot = await this.discoverTopology();
    return snapshot.households.map((household) => ({
      id: household.id,
      displayName: household.displayName,
    }));
  }

  async discoverTopology(): Promise<TopologySnapshot> {
    const liveSnapshot = this.config.enableLiveDiscovery ? await this.getLiveTopology() : undefined;
    if (liveSnapshot) {
      this.lastSnapshot = liveSnapshot;
      return clone(liveSnapshot);
    }

    const fixtureSnapshot = await this.loadFixtureSnapshot();
    this.lastSnapshot = fixtureSnapshot;
    return clone(fixtureSnapshot);
  }

  private async getLiveTopology(): Promise<TopologySnapshot | undefined> {
    const now = Date.now();
    if (this.liveSnapshotCache && this.liveSnapshotCache.expiresAt > now) {
      return this.liveSnapshotCache.snapshot;
    }

    if (this.liveDiscoveryInFlight) {
      return this.liveDiscoveryInFlight;
    }

    this.liveDiscoveryInFlight = this.tryLiveDiscovery()
      .then((snapshot) => {
        if (snapshot) {
          this.liveSnapshotCache = {
            snapshot,
            expiresAt: Date.now() + LIVE_DISCOVERY_TTL_MS,
          };
        }
        return snapshot;
      })
      .finally(() => {
        this.liveDiscoveryInFlight = undefined;
      });

    return this.liveDiscoveryInFlight;
  }

  async setGroupMembers(householdId: string, coordinatorPlayerId: string, memberPlayerIds: string[]): Promise<void> {
    const desired = unique([coordinatorPlayerId, ...memberPlayerIds.filter((playerId) => playerId !== coordinatorPlayerId)]);
    if (this.livePlayers.size === 0) {
      this.setFixtureGroupMembers(householdId, coordinatorPlayerId, desired);
      return;
    }

    const snapshot = await this.discoverTopology();
    const household = this.requireHousehold(snapshot, householdId);
    const coordinator = this.requirePlayer(household, coordinatorPlayerId);
    const coordinatorGroup = household.groups.find((group) => group.coordinatorId === coordinatorPlayerId)
      ?? household.groups.find((group) => group.playerIds.includes(coordinatorPlayerId));

    const currentMembers = new Set(coordinatorGroup?.playerIds ?? [coordinatorPlayerId]);
    const desiredMembers = new Set(desired);

    const membersToAdd = desired.filter((playerId) => !currentMembers.has(playerId) && playerId !== coordinatorPlayerId);
    const membersToRemove = Array.from(currentMembers).filter(
      (playerId) => playerId !== coordinatorPlayerId && !desiredMembers.has(playerId),
    );

    await this.modifyGroupMembers(householdId, coordinatorPlayerId, membersToAdd, membersToRemove);

    if (!coordinator.id) {
      throw new Error("Coordinator resolution failed.");
    }
  }

  async modifyGroupMembers(
    householdId: string,
    coordinatorPlayerId: string,
    membersToAdd: string[],
    membersToRemove: string[],
  ): Promise<void> {
    if (this.livePlayers.size === 0) {
      const snapshot = await this.loadFixtureSnapshot();
      const household = this.requireHousehold(snapshot, householdId);
      const currentGroup = household.groups.find((group) => group.coordinatorId === coordinatorPlayerId)
        ?? household.groups.find((group) => group.playerIds.includes(coordinatorPlayerId));
      const desiredMembers = new Set(currentGroup?.playerIds ?? [coordinatorPlayerId]);
      for (const playerId of membersToAdd) {
        desiredMembers.add(playerId);
      }
      for (const playerId of membersToRemove) {
        desiredMembers.delete(playerId);
      }
      this.setFixtureGroupMembers(householdId, coordinatorPlayerId, Array.from(desiredMembers));
      return;
    }

    const snapshot = await this.discoverTopology();
    const household = this.requireHousehold(snapshot, householdId);
    const coordinator = this.requirePlayer(household, coordinatorPlayerId);
    const coordinatorRecord = this.requireLiveRecord(coordinatorPlayerId);

    for (const playerId of membersToAdd) {
      if (playerId === coordinatorPlayerId) {
        continue;
      }
      this.requirePlayer(household, playerId);
      const playerRecord = this.requireLiveRecord(playerId);
      // Joining a group is setting the member's transport to the coordinator's RINCON URI.
      await playerRecord.device.AVTransportService.SetAVTransportURI({
        InstanceID: 0,
        CurrentURI: `x-rincon:${coordinatorPlayerId}`,
        CurrentURIMetaData: "",
      });
    }

    for (const playerId of membersToRemove) {
      if (playerId === coordinatorPlayerId) {
        continue;
      }
      this.requirePlayer(household, playerId);
      const playerRecord = this.requireLiveRecord(playerId);
      await playerRecord.device.AVTransportService.BecomeCoordinatorOfStandaloneGroup();
    }

    this.householdRoots.set(householdId, coordinatorRecord.device);
    this.invalidateTopologyCache();
  }

  async loadLineIn(
    householdId: string,
    coordinatorPlayerId: string,
    deviceId: string,
    playOnCompletion = true,
  ): Promise<void> {
    if (this.livePlayers.size === 0) {
      await this.loadFixtureSnapshot();
      this.setFixtureGroupRuntime(householdId, coordinatorPlayerId, {
        playbackState: playOnCompletion ? "PLAYBACK_STATE_PLAYING" : "PLAYBACK_STATE_IDLE",
        currentSourceUri: `x-rincon-stream:${deviceId}`,
      });
      this.touchFixture(householdId);
      return;
    }

    this.requireHousehold(await this.discoverTopology(), householdId);
    const coordinator = this.requireLiveRecord(coordinatorPlayerId);
    this.logger?.info(
      `Sending Sonos line-in load request: household=${householdId}, coordinator=${this.playerLogLabel(coordinatorPlayerId)}, sourceDevice=${deviceId}, playOnCompletion=${playOnCompletion}.`,
    );
    await this.setCoordinatorTransportUri(coordinator, `x-rincon-stream:${deviceId}`, "", playOnCompletion);
    this.invalidateTopologyCache();
    this.logger?.info(
      `Sonos line-in load completed: household=${householdId}, coordinator=${this.playerLogLabel(coordinatorPlayerId)}, sourceDevice=${deviceId}.`,
    );
  }

  async loadFavorite(householdId: string, coordinatorPlayerId: string, favoriteId: string): Promise<void> {
    if (this.livePlayers.size === 0) {
      await this.loadFixtureSnapshot();
      const household = this.requireHousehold(this.fixtureState, householdId);
      const favorite = household.favorites.find((item) => item.id === favoriteId || item.name === favoriteId);
      this.setFixtureGroupRuntime(householdId, coordinatorPlayerId, {
        playbackState: "PLAYBACK_STATE_PLAYING",
        currentSourceUri: favorite ? favorite.transportUri ?? buildFavoriteTransportUri(favorite) ?? favorite.uri : undefined,
      });
      this.touchFixture(householdId);
      return;
    }

    const coordinator = this.requireLiveRecord(coordinatorPlayerId);
    const favorite = await this.findFavorite(householdId, favoriteId);
    if (favorite.playable === false) {
      throw new Error(favorite.unsupportedReason ?? `Favorite "${favorite.name}" is not playable through the local transport.`);
    }
    const transportUri = favorite.transportUri ?? buildFavoriteTransportUri(favorite);
    if (!transportUri) {
      throw new Error(`Favorite "${favorite.name}" does not expose enough metadata to build a playable local URI.`);
    }
    this.logger?.info(
      `Sending Sonos favorite load request: household=${householdId}, coordinator=${this.playerLogLabel(coordinatorPlayerId)}, favorite="${favorite.name}" (${favoriteId}), transportUri=${transportUri}.`,
    );
    await this.setCoordinatorTransportUri(coordinator, transportUri, favorite.metadata ?? "", true);
    this.invalidateTopologyCache();
    this.logger?.info(
      `Sonos favorite load completed: household=${householdId}, coordinator=${this.playerLogLabel(coordinatorPlayerId)}, favorite="${favorite.name}" (${favoriteId}).`,
    );
  }

  async loadTv(
    householdId: string,
    coordinatorPlayerId: string,
    deviceId: string,
    playOnCompletion = true,
  ): Promise<void> {
    if (!this.config.allowTvSource) {
      throw new Error("TV source loading is disabled for this transport.");
    }

    if (this.livePlayers.size === 0) {
      await this.loadFixtureSnapshot();
      this.setFixtureGroupRuntime(householdId, coordinatorPlayerId, {
        playbackState: playOnCompletion ? "PLAYBACK_STATE_PLAYING" : "PLAYBACK_STATE_IDLE",
        currentSourceUri: `x-sonos-htastream:${deviceId}:spdif`,
      });
      this.touchFixture(householdId);
      return;
    }

    const coordinator = this.requireLiveRecord(coordinatorPlayerId);
    this.logger?.info(
      `Sending Sonos TV load request: household=${householdId}, coordinator=${this.playerLogLabel(coordinatorPlayerId)}, sourceDevice=${deviceId}, playOnCompletion=${playOnCompletion}.`,
    );
    await this.setCoordinatorTransportUri(coordinator, `x-sonos-htastream:${deviceId}:spdif`, "", playOnCompletion);
    this.invalidateTopologyCache();
    this.logger?.info(
      `Sonos TV load completed: household=${householdId}, coordinator=${this.playerLogLabel(coordinatorPlayerId)}, sourceDevice=${deviceId}.`,
    );
  }

  async setGroupVolume(householdId: string, coordinatorPlayerId: string, volume: number): Promise<void> {
    const snapshot = await this.discoverTopology();
    const household = this.requireHousehold(snapshot, householdId);
    const group = household.groups.find((item) => item.coordinatorId === coordinatorPlayerId)
      ?? household.groups.find((item) => item.playerIds.includes(coordinatorPlayerId));

    if (!group) {
      await this.setPlayerVolume(householdId, coordinatorPlayerId, volume);
      return;
    }

    const normalizedVolume = Math.max(0, Math.min(100, Math.round(volume)));
    if (this.livePlayers.size === 0) {
      for (const playerId of group.playerIds) {
        this.fixtureAudioState(playerId).master.volume = normalizedVolume;
      }
      this.touchFixture(householdId);
      return;
    }

    await Promise.all(group.playerIds.map((playerId) => this.setLivePlayerVolume(playerId, normalizedVolume)));
  }

  async getGroupVolume(householdId: string, coordinatorPlayerId: string): Promise<number> {
    const snapshot = await this.discoverTopology();
    const household = this.requireHousehold(snapshot, householdId);
    const group = household.groups.find((item) => item.coordinatorId === coordinatorPlayerId)
      ?? household.groups.find((item) => item.playerIds.includes(coordinatorPlayerId));

    if (!group) {
      return this.getPlayerVolume(householdId, coordinatorPlayerId);
    }

    const volumes = this.livePlayers.size === 0
      ? group.playerIds.map((playerId) => this.fixtureAudioState(playerId).master.volume)
      : await Promise.all(group.playerIds.map((playerId) => this.getLivePlayerVolume(playerId)));
    if (volumes.length === 0) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(volumes.reduce((sum, value) => sum + value, 0) / volumes.length)));
  }

  async getPlayerVolume(householdId: string, playerId: string): Promise<number> {
    if (this.livePlayers.size === 0) {
      this.requireHousehold(await this.loadFixtureSnapshot(), householdId);
      return this.fixtureAudioState(playerId).master.volume;
    }

    this.requireLiveRecordInHousehold(playerId, householdId);
    return this.getLivePlayerVolume(playerId);
  }

  async setPlayerVolume(householdId: string, playerId: string, volume: number): Promise<void> {
    if (this.livePlayers.size === 0) {
      this.requireHousehold(await this.loadFixtureSnapshot(), householdId);
      this.fixtureAudioState(playerId).master.volume = Math.max(0, Math.min(100, Math.round(volume)));
      this.touchFixture(householdId);
      return;
    }

    this.requireLiveRecordInHousehold(playerId, householdId);
    await this.setLivePlayerVolume(playerId, volume);
  }

  async getPlayerChannelVolume(householdId: string, playerId: string, channel: VirtualRoomChannel): Promise<number> {
    if (this.livePlayers.size === 0) {
      this.requireHousehold(await this.loadFixtureSnapshot(), householdId);
      return this.fixtureChannelAudioState(playerId, channel).volume;
    }

    this.requireLiveRecordInHousehold(playerId, householdId);
    return this.getLivePlayerChannelVolume(playerId, channel);
  }

  async setPlayerChannelVolume(
    householdId: string,
    playerId: string,
    channel: VirtualRoomChannel,
    volume: number,
  ): Promise<void> {
    if (this.livePlayers.size === 0) {
      this.requireHousehold(await this.loadFixtureSnapshot(), householdId);
      this.fixtureChannelAudioState(playerId, channel).volume = Math.max(0, Math.min(100, Math.round(volume)));
      this.touchFixture(householdId);
      return;
    }

    this.requireLiveRecordInHousehold(playerId, householdId);
    await this.setLivePlayerChannelVolume(playerId, channel, volume);
  }

  async getGroupMuted(householdId: string, coordinatorPlayerId: string): Promise<boolean> {
    const snapshot = await this.discoverTopology();
    const household = this.requireHousehold(snapshot, householdId);
    const group = household.groups.find((item) => item.coordinatorId === coordinatorPlayerId)
      ?? household.groups.find((item) => item.playerIds.includes(coordinatorPlayerId));

    if (!group) {
      return this.getPlayerMuted(householdId, coordinatorPlayerId);
    }

    const states = this.livePlayers.size === 0
      ? group.playerIds.map((playerId) => this.fixtureAudioState(playerId).master.muted)
      : await Promise.all(group.playerIds.map((playerId) => this.getLivePlayerMuted(playerId)));
    return states.length > 0 && states.every(Boolean);
  }

  async setGroupMuted(householdId: string, coordinatorPlayerId: string, muted: boolean): Promise<void> {
    const snapshot = await this.discoverTopology();
    const household = this.requireHousehold(snapshot, householdId);
    const group = household.groups.find((item) => item.coordinatorId === coordinatorPlayerId)
      ?? household.groups.find((item) => item.playerIds.includes(coordinatorPlayerId));

    if (!group) {
      await this.setPlayerMuted(householdId, coordinatorPlayerId, muted);
      return;
    }

    if (this.livePlayers.size === 0) {
      for (const playerId of group.playerIds) {
        this.fixtureAudioState(playerId).master.muted = muted;
      }
      this.touchFixture(householdId);
      return;
    }

    await Promise.all(group.playerIds.map((playerId) => this.setLivePlayerMuted(playerId, muted)));
  }

  async getPlayerMuted(householdId: string, playerId: string): Promise<boolean> {
    if (this.livePlayers.size === 0) {
      this.requireHousehold(await this.loadFixtureSnapshot(), householdId);
      return this.fixtureAudioState(playerId).master.muted;
    }

    this.requireLiveRecordInHousehold(playerId, householdId);
    return this.getLivePlayerMuted(playerId);
  }

  async setPlayerMuted(householdId: string, playerId: string, muted: boolean): Promise<void> {
    if (this.livePlayers.size === 0) {
      this.requireHousehold(await this.loadFixtureSnapshot(), householdId);
      this.fixtureAudioState(playerId).master.muted = muted;
      this.touchFixture(householdId);
      return;
    }

    this.requireLiveRecordInHousehold(playerId, householdId);
    await this.setLivePlayerMuted(playerId, muted);
  }

  async getPlayerChannelMuted(householdId: string, playerId: string, channel: VirtualRoomChannel): Promise<boolean> {
    if (this.livePlayers.size === 0) {
      this.requireHousehold(await this.loadFixtureSnapshot(), householdId);
      return this.fixtureChannelAudioState(playerId, channel).muted;
    }

    this.requireLiveRecordInHousehold(playerId, householdId);
    return this.getLivePlayerChannelMuted(playerId, channel);
  }

  async setPlayerChannelMuted(
    householdId: string,
    playerId: string,
    channel: VirtualRoomChannel,
    muted: boolean,
  ): Promise<void> {
    if (this.livePlayers.size === 0) {
      this.requireHousehold(await this.loadFixtureSnapshot(), householdId);
      this.fixtureChannelAudioState(playerId, channel).muted = muted;
      this.touchFixture(householdId);
      return;
    }

    this.requireLiveRecordInHousehold(playerId, householdId);
    await this.setLivePlayerChannelMuted(playerId, channel, muted);
  }

  async pausePlayback(householdId: string, coordinatorPlayerId: string): Promise<void> {
    if (this.livePlayers.size === 0) {
      await this.loadFixtureSnapshot();
      const household = this.requireHousehold(this.fixtureState, householdId);
      const group = household.groups.find((item) => item.coordinatorId === coordinatorPlayerId)
        ?? household.groups.find((item) => item.playerIds.includes(coordinatorPlayerId));
      if (group) {
        group.playbackState = "PLAYBACK_STATE_PAUSED_PLAYBACK";
      }
      this.touchFixture(householdId);
      return;
    }

    const snapshot = await this.discoverTopology();
    this.requireHousehold(snapshot, householdId);
    const coordinator = this.requireLiveRecord(coordinatorPlayerId);
    await coordinator.device.AVTransportService.Pause();
    this.invalidateTopologyCache();
  }

  async stopPlayback(householdId: string, coordinatorPlayerId: string): Promise<void> {
    if (this.livePlayers.size === 0) {
      await this.loadFixtureSnapshot();
      const household = this.requireHousehold(this.fixtureState, householdId);
      const group = household.groups.find((item) => item.coordinatorId === coordinatorPlayerId)
        ?? household.groups.find((item) => item.playerIds.includes(coordinatorPlayerId));
      if (group) {
        group.playbackState = "PLAYBACK_STATE_IDLE";
      }
      this.touchFixture(householdId);
      return;
    }

    const snapshot = await this.discoverTopology();
    this.requireHousehold(snapshot, householdId);
    const coordinator = this.requireLiveRecord(coordinatorPlayerId);
    await coordinator.device.AVTransportService.Stop();
    this.invalidateTopologyCache();
  }

  async ungroup(householdId: string, coordinatorPlayerId: string, memberPlayerIds?: string[]): Promise<void> {
    const snapshot = await this.discoverTopology();
    const household = this.requireHousehold(snapshot, householdId);
    const group = household.groups.find((item) => item.coordinatorId === coordinatorPlayerId)
      ?? household.groups.find((item) => item.playerIds.includes(coordinatorPlayerId));

    if (!group) {
      return;
    }

    const members = memberPlayerIds && memberPlayerIds.length > 0
      ? memberPlayerIds
      : group.playerIds.filter((playerId) => playerId !== coordinatorPlayerId);

    if (this.livePlayers.size === 0) {
      this.setFixtureGroupMembers(householdId, coordinatorPlayerId, [coordinatorPlayerId]);
      for (const memberPlayerId of members) {
        this.setFixtureGroupMembers(householdId, memberPlayerId, [memberPlayerId]);
      }
      return;
    }

    for (const playerId of members) {
      if (playerId === coordinatorPlayerId) {
        continue;
      }
      const player = this.requireLiveRecord(playerId);
      await player.device.AVTransportService.BecomeCoordinatorOfStandaloneGroup();
    }

    this.invalidateTopologyCache();
  }

  private async tryLiveDiscovery(): Promise<TopologySnapshot | undefined> {
    try {
      const discovery = new SonosDeviceDiscovery();
      const timeoutSeconds = Math.max(1, Math.ceil(this.config.discoveryTimeoutMs / 1000));
      const foundDevices = await discovery.Search(timeoutSeconds);
      if (!foundDevices.length) {
        return undefined;
      }

      const uniqueHosts = Array.from(new Map(foundDevices.map((found) => [found.host, found])).values());

      const hostRecords = await Promise.all(
        uniqueHosts.map(async (found) => {
          const device = new SonosDevice(found.host, found.port);
          const householdId = await device.DevicePropertiesService.GetHouseholdID()
            .then((response) => normalizedString(response.CurrentHouseholdID))
            .catch(() => undefined);
          return {
            host: found.host,
            port: found.port,
            device,
            householdId: householdId ?? "local-household",
          };
        }),
      );

      const rootsByHousehold = new Map<string, (typeof hostRecords)[number]>();
      for (const hostRecord of hostRecords) {
        if (!rootsByHousehold.has(hostRecord.householdId)) {
          rootsByHousehold.set(hostRecord.householdId, hostRecord);
        }
      }

      const households: HouseholdSnapshot[] = [];
      const livePlayers = new Map<string, LivePlayerRecord>();

      for (const [householdId, rootRecord] of rootsByHousehold) {
        const root = rootRecord.device;
        const zoneGroups = await root.ZoneGroupTopologyService.GetParsedZoneGroupState().catch(() => []);
        const players: SonosPlayer[] = [];
        const groups: SonosGroup[] = [];

        const memberHosts = new Map<string, number>();
        for (const zoneGroup of zoneGroups) {
          for (const member of zoneGroup.members) {
            memberHosts.set(member.host, member.port);
          }
        }
        const descriptionsByHost = new Map(
          await Promise.all(
            Array.from(memberHosts).map(
              async ([host, port]) => [host, await this.fetchParsedDeviceDescription(host, port)] as const,
            ),
          ),
        );

        for (const zoneGroup of zoneGroups) {
          const groupId = zoneGroup.groupId || `group-${zoneGroup.coordinator.uuid}`;
          const playerIds: string[] = [];

          for (const member of zoneGroup.members) {
            const playerId = member.uuid;
            playerIds.push(playerId);
            const description = descriptionsByHost.get(member.host);

            if (!players.some((player) => player.id === playerId)) {
              players.push({
                id: playerId,
                name: member.name,
                model: description?.modelName ?? description?.displayName,
                capabilities: detectCapabilities(description, this.config.allowTvSource),
                deviceIds: unique([playerId]),
                groupId,
                isCoordinator: zoneGroup.coordinator.uuid === playerId,
                fixedVolume: false,
                sourceOptions: detectSourceOptions(description, this.config.allowTvSource),
              });
            }

            if (!livePlayers.has(playerId)) {
              livePlayers.set(playerId, {
                device: new SonosDevice(member.host, member.port, member.uuid),
                host: member.host,
                port: member.port,
                householdId,
                zoneName: member.name,
                description,
              });
            }
          }

          const runtimeState = await this.getLiveGroupRuntimeState(livePlayers.get(zoneGroup.coordinator.uuid));

          groups.push({
            id: groupId,
            name: zoneGroup.name || zoneGroup.coordinator.name || groupId,
            coordinatorId: zoneGroup.coordinator.uuid,
            playerIds,
            ...runtimeState,
          });
        }

        // Devices found over SSDP for this household but missing from its zone
        // group state still get a standalone entry, like the previous transport.
        for (const hostRecord of hostRecords) {
          if (hostRecord.householdId !== householdId || memberHosts.has(hostRecord.host)) {
            continue;
          }

          const [zoneAttrs, zoneInfo] = await Promise.allSettled([
            hostRecord.device.DevicePropertiesService.GetZoneAttributes(),
            hostRecord.device.DevicePropertiesService.GetZoneInfo(),
          ]);
          const zoneName = zoneAttrs.status === "fulfilled" ? normalizedString(zoneAttrs.value.CurrentZoneName) : undefined;
          const serialNumber = zoneInfo.status === "fulfilled" ? normalizedString(zoneInfo.value.SerialNumber) : undefined;
          const fallbackId = serialNumber ?? `${hostRecord.host}:${hostRecord.port}`;
          if (players.some((player) => player.id === fallbackId || (zoneName !== undefined && player.name === zoneName))) {
            continue;
          }

          const description = await this.fetchParsedDeviceDescription(hostRecord.host, hostRecord.port);
          players.push({
            id: fallbackId,
            name: zoneName ?? hostRecord.host,
            model: description?.modelName ?? description?.displayName,
            capabilities: detectCapabilities(description, this.config.allowTvSource),
            deviceIds: [fallbackId],
            groupId: `standalone-${fallbackId}`,
            isCoordinator: true,
            fixedVolume: false,
            sourceOptions: detectSourceOptions(description, this.config.allowTvSource),
          });
          const standaloneRecord: LivePlayerRecord = {
            device: hostRecord.device,
            host: hostRecord.host,
            port: hostRecord.port,
            householdId,
            zoneName,
            description,
          };
          const runtimeState = await this.getLiveGroupRuntimeState(standaloneRecord);
          groups.push({
            id: `standalone-${fallbackId}`,
            name: zoneName ?? hostRecord.host,
            coordinatorId: fallbackId,
            playerIds: [fallbackId],
            ...runtimeState,
          });
          livePlayers.set(fallbackId, standaloneRecord);
        }

        const favorites = await this.fetchFavorites(root);

        households.push({
          id: householdId,
          displayName: formatHouseholdDisplayName(households.length, rootsByHousehold.size),
          players,
          groups,
          favorites,
        });
        this.householdRoots.set(householdId, root);
      }

      if (households.length === 0) {
        return undefined;
      }

      this.livePlayers = livePlayers;
      return {
        capturedAt: new Date().toISOString(),
        origin: "live",
        households,
      };
    } catch {
      return undefined;
    }
  }

  private async fetchParsedDeviceDescription(host: string, port: number): Promise<ParsedDeviceDescription | undefined> {
    try {
      const response = await fetch(`http://${host}:${port}/xml/device_description.xml`, {
        signal: AbortSignal.timeout(Math.max(1_000, this.config.requestTimeoutMs)),
      });
      if (!response.ok) {
        return undefined;
      }
      const xml = await response.text();
      return {
        modelName: extractTagValue(xml, "modelName"),
        displayName: extractTagValue(xml, "displayName"),
        hasAudioIn: /service(?:Id)?:AudioIn/i.test(xml),
      };
    } catch {
      return undefined;
    }
  }

  private async getLiveGroupRuntimeState(
    coordinatorRecord: LivePlayerRecord | undefined,
  ): Promise<Pick<SonosGroup, "playbackState" | "currentSourceUri">> {
    if (!coordinatorRecord) {
      return {
        playbackState: "PLAYBACK_STATE_UNKNOWN",
      };
    }

    const playerLabel = coordinatorRecord.zoneName ?? coordinatorRecord.host;
    const [transportInfo, mediaInfo] = await Promise.all([
      this.readLiveRuntimeValue(
        `${playerLabel} playback state`,
        () => coordinatorRecord.device.AVTransportService.GetTransportInfo(),
      ),
      this.readLiveRuntimeValue(
        `${playerLabel} media info`,
        () => coordinatorRecord.device.AVTransportService.GetMediaInfo(),
      ),
    ]);

    return {
      playbackState: normalizeSonosPlaybackState(transportInfo?.CurrentTransportState),
      currentSourceUri: normalizedString(mediaInfo?.CurrentURI),
    };
  }

  private async readLiveRuntimeValue<T>(
    label: string,
    readValue: () => Promise<T> | T | undefined,
  ): Promise<T | undefined> {
    const timeoutMs = Math.max(250, Math.min(this.config.requestTimeoutMs, LIVE_RUNTIME_STATE_TIMEOUT_MS));
    let timeout: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        Promise.resolve().then(readValue),
        new Promise<undefined>((resolve) => {
          timeout = setTimeout(() => resolve(undefined), timeoutMs);
        }),
      ]);
    } catch (error) {
      this.logger?.debug(
        `Sonos runtime state read skipped for ${label}: ${error instanceof Error ? error.message : String(error)}.`,
      );
      return undefined;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async loadFixtureSnapshot(): Promise<TopologySnapshot> {
    if (this.fixtureLoaded) {
      this.touchFixture("");
      return clone(this.fixtureState);
    }

    const resolvedFixturePath = resolveFixturePath(this.config.fixturePath);
    if (!resolvedFixturePath) {
      this.fixtureState = normalizeFixtureSnapshot(this.fixtureState);
      this.fixturePlayerAudio = buildFixtureAudioState(this.fixtureState);
      this.fixtureLoaded = true;
      return clone(this.fixtureState);
    }

    try {
      const raw = await readFile(resolvedFixturePath, "utf8");
      const parsed = JSON.parse(raw) as TopologySnapshot;
      this.fixtureState = normalizeFixtureSnapshot(parsed);
      this.fixturePlayerAudio = buildFixtureAudioState(this.fixtureState);
      this.fixtureLoaded = true;
      return clone(this.fixtureState);
    } catch {
      this.fixtureState = normalizeFixtureSnapshot(sampleTopology);
      this.fixturePlayerAudio = buildFixtureAudioState(this.fixtureState);
      this.fixtureLoaded = true;
      return clone(this.fixtureState);
    }
  }

  private requireHousehold(snapshot: TopologySnapshot, householdId: string): HouseholdSnapshot {
    const household = snapshot.households.find((item) => item.id === householdId);
    if (!household) {
      throw new Error(`Household "${householdId}" was not found.`);
    }
    return household;
  }

  private requirePlayer(household: HouseholdSnapshot, playerId: string): SonosPlayer {
    const player = household.players.find((item) => item.id === playerId);
    if (!player) {
      throw new Error(`Player "${playerId}" was not found in household "${household.displayName}".`);
    }
    return player;
  }

  private requireLiveRecord(playerId: string): LivePlayerRecord {
    const record = this.livePlayers.get(playerId);
    if (!record) {
      this.invalidateTopologyCache();
      throw new Error(`Live Sonos record for "${playerId}" is unavailable. Refresh discovery and try again.`);
    }
    return record;
  }

  private requireLiveRecordInHousehold(playerId: string, householdId: string): LivePlayerRecord {
    const record = this.requireLiveRecord(playerId);
    if (record.householdId !== householdId) {
      this.invalidateTopologyCache();
      throw new Error(`Player "${playerId}" is not part of household "${householdId}".`);
    }
    return record;
  }

  private async setCoordinatorTransportUri(
    coordinator: LivePlayerRecord,
    uri: string,
    metadata: string,
    playOnCompletion: boolean,
  ): Promise<void> {
    await coordinator.device.AVTransportService.SetAVTransportURI({
      InstanceID: 0,
      CurrentURI: uri,
      CurrentURIMetaData: metadata,
    });
    if (playOnCompletion) {
      await coordinator.device.AVTransportService.Play({ InstanceID: 0, Speed: "1" });
    }
  }

  private async getLivePlayerVolume(playerId: string): Promise<number> {
    return this.getLiveChannelVolume(playerId, "Master");
  }

  private async setLivePlayerVolume(playerId: string, volume: number): Promise<void> {
    await this.setLiveChannelVolume(playerId, "Master", volume);
  }

  private async getLivePlayerChannelVolume(playerId: string, channel: VirtualRoomChannel): Promise<number> {
    return this.getLiveChannelVolume(playerId, channelToken(channel));
  }

  private async setLivePlayerChannelVolume(
    playerId: string,
    channel: VirtualRoomChannel,
    volume: number,
  ): Promise<void> {
    await this.setLiveChannelVolume(playerId, channelToken(channel), volume);
  }

  private async getLivePlayerMuted(playerId: string): Promise<boolean> {
    return this.getLiveChannelMuted(playerId, "Master");
  }

  private async setLivePlayerMuted(playerId: string, muted: boolean): Promise<void> {
    await this.setLiveChannelMuted(playerId, "Master", muted);
  }

  private async getLivePlayerChannelMuted(playerId: string, channel: VirtualRoomChannel): Promise<boolean> {
    return this.getLiveChannelMuted(playerId, channelToken(channel));
  }

  private async setLivePlayerChannelMuted(
    playerId: string,
    channel: VirtualRoomChannel,
    muted: boolean,
  ): Promise<void> {
    await this.setLiveChannelMuted(playerId, channelToken(channel), muted);
  }

  private async getLiveChannelVolume(playerId: string, channel: string): Promise<number> {
    const player = this.requireLiveRecord(playerId);
    const response = await player.device.RenderingControlService.GetVolume({ InstanceID: 0, Channel: channel });
    const volume = Math.max(0, Math.min(100, Math.round(response.CurrentVolume)));
    this.logger?.debug(
      `Sonos get volume returned: player=${this.playerLogLabel(playerId)}, channel=${channel}, volume=${volume}.`,
    );
    return volume;
  }

  private async setLiveChannelVolume(playerId: string, channel: string, volume: number): Promise<void> {
    const player = this.requireLiveRecord(playerId);
    const normalizedVolume = Math.max(0, Math.min(100, Math.round(volume)));
    this.logger?.info(
      `Sending Sonos set volume request: player=${this.playerLogLabel(playerId)}, channel=${channel}, volume=${normalizedVolume}.`,
    );
    await player.device.RenderingControlService.SetVolume({
      InstanceID: 0,
      Channel: channel,
      DesiredVolume: normalizedVolume,
    });
    this.logger?.info(
      `Sonos set volume completed: player=${this.playerLogLabel(playerId)}, channel=${channel}, volume=${normalizedVolume}.`,
    );
  }

  private async getLiveChannelMuted(playerId: string, channel: string): Promise<boolean> {
    const player = this.requireLiveRecord(playerId);
    const response = await player.device.RenderingControlService.GetMute({ InstanceID: 0, Channel: channel });
    const muted = response.CurrentMute === true;
    this.logger?.debug(
      `Sonos get mute returned: player=${this.playerLogLabel(playerId)}, channel=${channel}, muted=${muted}.`,
    );
    return muted;
  }

  private async setLiveChannelMuted(playerId: string, channel: string, muted: boolean): Promise<void> {
    const player = this.requireLiveRecord(playerId);
    this.logger?.info(
      `Sending Sonos set mute request: player=${this.playerLogLabel(playerId)}, channel=${channel}, muted=${muted}.`,
    );
    await player.device.RenderingControlService.SetMute({
      InstanceID: 0,
      Channel: channel,
      DesiredMute: muted,
    });
    this.logger?.info(
      `Sonos set mute completed: player=${this.playerLogLabel(playerId)}, channel=${channel}, muted=${muted}.`,
    );
  }

  private async findFavorite(householdId: string, favoriteId: string): Promise<SonosFavorite> {
    const root = this.householdRoots.get(householdId);
    if (!root) {
      throw new Error(`No discovered Sonos root is available for household "${householdId}".`);
    }

    const favorites = await this.fetchFavorites(root);
    const favorite = favorites.find((item) => item.id === favoriteId || item.name === favoriteId);
    if (!favorite) {
      throw new Error(`Favorite "${favoriteId}" was not found.`);
    }

    return favorite;
  }

  private async fetchFavorites(root: SonosDevice): Promise<SonosFavorite[]> {
    // The raw Browse call (not BrowseParsed) returns the favorite DIDL-Lite XML
    // untouched, which is required to keep r:resMD/r:description/r:type metadata
    // for container favorites; sonos-ts's parsed Track model drops those fields.
    const browseResponse = await root.ContentDirectoryService.Browse({
      ObjectID: "FV:2",
      BrowseFlag: "BrowseDirectChildren",
      Filter: "*",
      StartingIndex: 0,
      RequestedCount: 100,
      SortCriteria: "",
    }).catch(() => undefined);

    const browseFavorites = typeof browseResponse?.Result === "string" ? parseFavoriteBrowseXml(browseResponse.Result) : [];
    if (browseFavorites.length > 0) {
      return browseFavorites;
    }

    const fallbackResponse = await root.GetFavorites().catch(() => undefined);
    const fallbackTracks = Array.isArray(fallbackResponse?.Result) ? fallbackResponse.Result : [];
    return fallbackTracks.map((track) =>
      normalizeFavorite({
        id: track.ItemId ?? track.Title ?? track.TrackUri ?? randomString(),
        name: track.Title ?? track.ItemId ?? "Favorite",
        uri: track.TrackUri,
      }),
    );
  }

  private setFixtureGroupRuntime(
    householdId: string,
    coordinatorPlayerId: string,
    runtime: Pick<SonosGroup, "playbackState" | "currentSourceUri">,
  ): void {
    const household = this.requireHousehold(this.fixtureState, householdId);
    const group = household.groups.find((item) => item.coordinatorId === coordinatorPlayerId)
      ?? household.groups.find((item) => item.playerIds.includes(coordinatorPlayerId));
    if (!group) {
      return;
    }

    group.playbackState = runtime.playbackState;
    group.currentSourceUri = runtime.currentSourceUri;
  }

  private setFixtureGroupMembers(householdId: string, coordinatorPlayerId: string, desiredMembers: string[]): void {
    const household = this.requireHousehold(this.fixtureState, householdId);
    const coordinator = this.requirePlayer(household, coordinatorPlayerId);
    const desiredSet = new Set(desiredMembers);

    const coordinatorGroup = household.groups.find((group) => group.coordinatorId === coordinator.id)
      ?? household.groups.find((group) => group.playerIds.includes(coordinator.id));

    if (coordinatorGroup) {
      coordinatorGroup.playerIds = Array.from(desiredSet);
      coordinatorGroup.name = coordinator.name;
      coordinatorGroup.coordinatorId = coordinator.id;
    } else {
      household.groups.push({
        id: `group-${coordinator.id}`,
        name: coordinator.name,
        coordinatorId: coordinator.id,
        playerIds: Array.from(desiredSet),
        playbackState: "PLAYBACK_STATE_IDLE",
      });
    }

    for (const group of household.groups) {
      if (group.coordinatorId === coordinator.id) {
        continue;
      }
      group.playerIds = group.playerIds.filter((playerId) => !desiredSet.has(playerId));
    }

    household.groups = household.groups.filter((group) => group.playerIds.length > 0);

    for (const player of household.players) {
      const group = household.groups.find((item) => item.playerIds.includes(player.id))
        ?? {
          id: `group-${player.id}`,
          name: player.name,
          coordinatorId: player.id,
          playerIds: [player.id],
          playbackState: "PLAYBACK_STATE_IDLE",
        };

      if (!household.groups.some((item) => item.id === group.id)) {
        household.groups.push(group);
      }

      player.groupId = group.id;
      player.isCoordinator = group.coordinatorId === player.id;
    }

    this.touchFixture(householdId);
  }

  private touchFixture(_householdId: string): void {
    this.fixtureState = {
      ...this.fixtureState,
      capturedAt: new Date().toISOString(),
      origin: "fixture",
    };
    this.lastSnapshot = clone(this.fixtureState);
  }

  private fixtureAudioState(playerId: string): FixtureAudioState {
    const existing = this.fixturePlayerAudio.get(playerId);
    if (existing) {
      return existing;
    }

    const state: FixtureAudioState = {
      master: emptyChannelState(),
      left: emptyChannelState(),
      right: emptyChannelState(),
    };
    this.fixturePlayerAudio.set(playerId, state);
    return state;
  }

  private fixtureChannelAudioState(playerId: string, channel: VirtualRoomChannel): ChannelAudioState {
    const state = this.fixtureAudioState(playerId);
    return channel === "right" ? state.right : state.left;
  }

  private playerLogLabel(playerId: string): string {
    const record = this.livePlayers.get(playerId);
    const playerName = record?.zoneName?.trim();
    return playerName ? `${playerName} (${playerId})` : playerId;
  }
}

function randomString(): string {
  return Math.random().toString(16).slice(2);
}
