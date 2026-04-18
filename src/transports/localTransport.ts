import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AsyncDeviceDiscovery,
  Sonos,
  type SonosBrowseResponse,
  type SonosBrowseResult,
  type SonosDeviceDescription,
  type SonosGroup as RawSonosGroup,
  type SonosZoneAttrs,
  type SonosZoneInfo,
} from "sonos";
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
} from "../types";

interface LivePlayerRecord {
  device: Sonos;
  host: string;
  port: number;
  householdId: string;
  zoneAttrs?: SonosZoneAttrs;
  zoneInfo?: SonosZoneInfo;
  description?: SonosDeviceDescription;
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

export function buildFavoriteTransportUri(favorite: Pick<SonosFavorite, "uri" | "metadata">): string | undefined {
  if (favorite.uri?.trim()) {
    return decodeXmlEntities(favorite.uri).trim();
  }

  if (!favorite.metadata?.trim()) {
    return undefined;
  }

  return buildFavoriteContainerUri(favorite.metadata);
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

  return normalized;
}

function fallbackFavoritesFromBrowseResult(result: SonosBrowseResult): SonosFavorite[] {
  return (result.items ?? []).map((favorite) =>
    normalizeFavorite({
      id: favorite.id ?? favorite.title ?? favorite.uri ?? randomString(),
      name: favorite.title ?? favorite.id ?? "Favorite",
      uri: favorite.uri,
    }),
  );
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

function extractFirstString(input: unknown): string | undefined {
  if (typeof input === "string" && input.trim()) {
    return input.trim();
  }

  if (!input || typeof input !== "object") {
    return undefined;
  }

  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function normalizeFixtureSnapshot(input: TopologySnapshot): TopologySnapshot {
  return {
    ...clone(input),
    capturedAt: new Date().toISOString(),
    origin: "fixture",
  };
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function hasService(description: SonosDeviceDescription | undefined, fragment: string): boolean {
  const services = description?.serviceList?.service;
  const list = Array.isArray(services) ? services : services ? [services] : [];
  return list.some((service) => `${service.serviceType ?? ""} ${service.serviceId ?? ""}`.toLowerCase().includes(fragment.toLowerCase()));
}

function modelLooksTvCapable(description: SonosDeviceDescription | undefined): boolean {
  const model = `${description?.modelName ?? ""} ${description?.displayName ?? ""}`.toLowerCase();
  return /(arc|beam|playbar|playbase|ray|amp)/.test(model);
}

function detectSourceOptions(description: SonosDeviceDescription | undefined, allowTvSource: boolean): SceneSourceKind[] {
  const sourceOptions: SceneSourceKind[] = ["favorite"];

  if (hasService(description, "AudioIn")) {
    sourceOptions.push("line_in");
  }

  if (allowTvSource && modelLooksTvCapable(description)) {
    sourceOptions.push("tv");
  }

  return unique(sourceOptions);
}

function detectCapabilities(description: SonosDeviceDescription | undefined, allowTvSource: boolean): string[] {
  const capabilities = ["PLAYBACK"];
  if (hasService(description, "AudioIn")) {
    capabilities.push("LINE_IN");
  }
  if (allowTvSource && modelLooksTvCapable(description)) {
    capabilities.push("TV");
  }
  if (!hasService(description, "ZoneGroupTopology")) {
    capabilities.push("AIRPLAY");
  } else {
    capabilities.push("AIRPLAY");
  }
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

function maybeHostFromLocation(location: string | undefined): { host: string; port: number } | undefined {
  if (!location) {
    return undefined;
  }

  try {
    const url = new URL(location);
    return {
      host: url.hostname,
      port: Number(url.port || 1400),
    };
  } catch {
    return undefined;
  }
}

export class LocalSonosTransport implements SonosTransport {
  public readonly kind = "local";
  private livePlayers = new Map<string, LivePlayerRecord>();
  private fixtureState = normalizeFixtureSnapshot(sampleTopology);
  private fixtureLoaded = false;
  private householdRoots = new Map<string, Sonos>();
  private lastSnapshot = normalizeFixtureSnapshot(sampleTopology);

  constructor(private readonly config: LocalTransportConfig) {}

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
    const liveSnapshot = this.config.enableLiveDiscovery ? await this.tryLiveDiscovery() : undefined;
    if (liveSnapshot) {
      this.lastSnapshot = liveSnapshot;
      return clone(liveSnapshot);
    }

    const fixtureSnapshot = await this.loadFixtureSnapshot();
    this.lastSnapshot = fixtureSnapshot;
    return clone(fixtureSnapshot);
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
      await playerRecord.device.joinGroup(coordinator.name);
    }

    for (const playerId of membersToRemove) {
      if (playerId === coordinatorPlayerId) {
        continue;
      }
      this.requirePlayer(household, playerId);
      const playerRecord = this.requireLiveRecord(playerId);
      await playerRecord.device.leaveGroup();
    }

    this.householdRoots.set(householdId, coordinatorRecord.device);
  }

  async loadLineIn(
    householdId: string,
    coordinatorPlayerId: string,
    deviceId: string,
    playOnCompletion = true,
  ): Promise<void> {
    if (this.livePlayers.size === 0) {
      this.touchFixture(householdId);
      return;
    }

    this.requireHousehold(await this.discoverTopology(), householdId);
    const coordinator = this.requireLiveRecord(coordinatorPlayerId);
    await coordinator.device.setAVTransportURI({
      uri: `x-rincon-stream:${deviceId}`,
      metadata: "",
      onlySetUri: !playOnCompletion,
    });
  }

  async loadFavorite(householdId: string, coordinatorPlayerId: string, favoriteId: string): Promise<void> {
    if (this.livePlayers.size === 0) {
      this.touchFixture(householdId);
      return;
    }

    const coordinator = this.requireLiveRecord(coordinatorPlayerId);
    const favorite = await this.findFavorite(householdId, favoriteId);
    const transportUri = favorite.transportUri ?? buildFavoriteTransportUri(favorite);
    if (!transportUri) {
      throw new Error(`Favorite "${favorite.name}" does not expose enough metadata to build a playable local URI.`);
    }
    await coordinator.device.setAVTransportURI({
      uri: transportUri,
      metadata: favorite.metadata ?? "",
    });
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
      this.touchFixture(householdId);
      return;
    }

    const coordinator = this.requireLiveRecord(coordinatorPlayerId);
    await coordinator.device.setAVTransportURI({
      uri: `x-sonos-htastream:${deviceId}:spdif`,
      metadata: "",
      onlySetUri: !playOnCompletion,
    });
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

    for (const playerId of group.playerIds) {
      await this.setPlayerVolume(householdId, playerId, volume);
    }
  }

  async setPlayerVolume(householdId: string, playerId: string, volume: number): Promise<void> {
    if (this.livePlayers.size === 0) {
      this.touchFixture(householdId);
      return;
    }

    this.requireHousehold(await this.discoverTopology(), householdId);
    const player = this.requireLiveRecord(playerId);
    await player.device.setVolume(Math.max(0, Math.min(100, Math.round(volume))));
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
      await player.device.leaveGroup();
    }
  }

  private async tryLiveDiscovery(): Promise<TopologySnapshot | undefined> {
    try {
      const discovery = new AsyncDeviceDiscovery();
      const devices = await discovery.discoverMultiple({ timeout: this.config.discoveryTimeoutMs });
      if (!devices.length) {
        return undefined;
      }

      const uniqueDevices = Array.from(
        new Map(devices.map((device) => [`${device.host}:${device.port}`, device])).values(),
      );

      const records = await Promise.all(
        uniqueDevices.map(async (device): Promise<LivePlayerRecord> => {
          const [zoneAttrs, zoneInfo, description, householdResponse] = await Promise.allSettled([
            device.getZoneAttrs(),
            device.getZoneInfo(),
            device.deviceDescription(),
            device.devicePropertiesService().GetHouseholdID({}),
          ]);

          return {
            device,
            host: device.host,
            port: device.port,
            householdId:
              extractFirstString(householdResponse.status === "fulfilled" ? householdResponse.value : undefined)
              ?? "local-household",
            zoneAttrs: zoneAttrs.status === "fulfilled" ? zoneAttrs.value : undefined,
            zoneInfo: zoneInfo.status === "fulfilled" ? zoneInfo.value : undefined,
            description: description.status === "fulfilled" ? description.value : undefined,
          };
        }),
      );

      const rootsByHousehold = new Map<string, Sonos>();
      for (const record of records) {
        if (!rootsByHousehold.has(record.householdId)) {
          rootsByHousehold.set(record.householdId, record.device);
        }
      }

      const households: HouseholdSnapshot[] = [];
      const livePlayers = new Map<string, LivePlayerRecord>();

      for (const [householdId, root] of rootsByHousehold) {
        const rawGroups = await root.getAllGroups().catch(() => [] as RawSonosGroup[]);
        const householdRecords = records.filter((record) => record.householdId === householdId);
        const householdByHost = new Map(householdRecords.map((record) => [record.host, record]));
        const players: SonosPlayer[] = [];
        const groups: SonosGroup[] = [];

        for (const rawGroup of rawGroups) {
          const groupId = rawGroup.ID ?? `group-${rawGroup.Coordinator ?? Math.random().toString(16).slice(2)}`;
          const playerIds: string[] = [];
          const groupMembers = Array.isArray(rawGroup.ZoneGroupMember) ? rawGroup.ZoneGroupMember : [rawGroup.ZoneGroupMember];

          for (const member of groupMembers) {
            const location = maybeHostFromLocation(member.Location);
            const record = location ? householdByHost.get(location.host) : undefined;
            const playerId = member.UUID ?? record?.zoneInfo?.SerialNumber ?? record?.host ?? `player-${players.length}`;
            playerIds.push(playerId);

            if (!players.some((player) => player.id === playerId)) {
              const sourceOptions = detectSourceOptions(record?.description, this.config.allowTvSource);
              const player: SonosPlayer = {
                id: playerId,
                name: member.ZoneName ?? record?.zoneAttrs?.CurrentZoneName ?? record?.host ?? playerId,
                model: record?.description?.modelName ?? record?.description?.displayName,
                capabilities: detectCapabilities(record?.description, this.config.allowTvSource),
                deviceIds: unique([playerId]),
                groupId,
                isCoordinator: rawGroup.Coordinator === playerId,
                fixedVolume: false,
                sourceOptions,
              };
              players.push(player);
            } else {
              const existing = players.find((player) => player.id === playerId);
              if (existing) {
                existing.groupId = groupId;
                existing.isCoordinator = rawGroup.Coordinator === playerId;
              }
            }

            if (record) {
              livePlayers.set(playerId, record);
            }
          }

          groups.push({
            id: groupId,
            name: rawGroup.Name ?? players.find((player) => player.id === rawGroup.Coordinator)?.name ?? groupId,
            coordinatorId: rawGroup.Coordinator ?? playerIds[0],
            playerIds,
            playbackState: "PLAYBACK_STATE_UNKNOWN",
          });
        }

        for (const record of householdRecords) {
          const existingPlayer = players.find(
            (player) => player.name === record.zoneAttrs?.CurrentZoneName || player.id === record.zoneInfo?.SerialNumber,
          );
          if (existingPlayer) {
            continue;
          }

          const fallbackId = record.zoneInfo?.SerialNumber ?? `${record.host}:${record.port}`;
          const sourceOptions = detectSourceOptions(record.description, this.config.allowTvSource);
          players.push({
            id: fallbackId,
            name: record.zoneAttrs?.CurrentZoneName ?? record.host,
            model: record.description?.modelName ?? record.description?.displayName,
            capabilities: detectCapabilities(record.description, this.config.allowTvSource),
            deviceIds: [fallbackId],
            groupId: `standalone-${fallbackId}`,
            isCoordinator: true,
            fixedVolume: false,
            sourceOptions,
          });
          groups.push({
            id: `standalone-${fallbackId}`,
            name: record.zoneAttrs?.CurrentZoneName ?? record.host,
            coordinatorId: fallbackId,
            playerIds: [fallbackId],
            playbackState: "PLAYBACK_STATE_UNKNOWN",
          });
          livePlayers.set(fallbackId, record);
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

  private async loadFixtureSnapshot(): Promise<TopologySnapshot> {
    if (this.fixtureLoaded) {
      this.touchFixture("");
      return clone(this.fixtureState);
    }

    const resolvedFixturePath = resolveFixturePath(this.config.fixturePath);
    if (!resolvedFixturePath) {
      this.fixtureState = normalizeFixtureSnapshot(this.fixtureState);
      this.fixtureLoaded = true;
      return clone(this.fixtureState);
    }

    try {
      const raw = await readFile(resolvedFixturePath, "utf8");
      const parsed = JSON.parse(raw) as TopologySnapshot;
      this.fixtureState = normalizeFixtureSnapshot(parsed);
      this.fixtureLoaded = true;
      return clone(this.fixtureState);
    } catch {
      this.fixtureState = normalizeFixtureSnapshot(sampleTopology);
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
      throw new Error(`Live Sonos record for "${playerId}" is unavailable. Refresh discovery and try again.`);
    }
    return record;
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

  private async fetchFavorites(root: Sonos): Promise<SonosFavorite[]> {
    const browseResponse = await root.contentDirectoryService().Browse({
      BrowseFlag: "BrowseDirectChildren",
      Filter: "*",
      StartingIndex: "0",
      RequestedCount: "100",
      SortCriteria: "",
      ObjectID: "FV:2",
    }).catch(() => undefined as SonosBrowseResponse | undefined);

    const browseFavorites = typeof browseResponse?.Result === "string" ? parseFavoriteBrowseXml(browseResponse.Result) : [];
    if (browseFavorites.length > 0) {
      return browseFavorites;
    }

    const fallbackResult = await root.getFavorites().catch(
      () =>
        ({
          items: [],
          returned: "0",
          total: "0",
          updateID: "0",
        }) satisfies SonosBrowseResult,
    );

    return fallbackFavoritesFromBrowseResult(fallbackResult);
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
}

function randomString(): string {
  return Math.random().toString(16).slice(2);
}
