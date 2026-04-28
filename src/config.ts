import { randomUUID } from "node:crypto";
import type {
  CloudBrokerConfig,
  HouseholdSnapshot,
  LocalTransportConfig,
  SceneDefinition,
  SceneOffBehavior,
  SceneSource,
  SceneSourceKind,
  ScenesPlatformConfig,
  SonosCloudConfig,
  SonosPlayer,
  SonosTransport,
  TopologySnapshot,
  ValidationResult,
  VirtualRoomChannel,
  VirtualRoomDefinition,
  VirtualRoomLastActiveBehavior,
  VirtualRoomOffBehavior,
  VirtualRoomOnBehavior,
} from "./types";
import { PLATFORM_NAME } from "./types";

const DEFAULT_TRANSPORT: LocalTransportConfig = {
  kind: "local",
  enableLiveDiscovery: true,
  discoveryTimeoutMs: 2500,
  requestTimeoutMs: 5000,
  allowTvSource: false,
};

const DEFAULT_CLOUD_BROKER: CloudBrokerConfig = {
  timeoutMs: 8000,
  routeFavorites: true,
  routePlaylists: true,
};

const DEFAULT_CLOUD: SonosCloudConfig = {
  mode: "local_only",
  broker: { ...DEFAULT_CLOUD_BROKER },
};

export function createDefaultPlatformConfig(): ScenesPlatformConfig {
  return {
    platform: PLATFORM_NAME,
    name: "Sonos Scenes",
    logLevel: "info",
    transport: { ...DEFAULT_TRANSPORT },
    cloud: {
      mode: DEFAULT_CLOUD.mode,
      broker: { ...DEFAULT_CLOUD.broker },
    },
    scenes: [],
    virtualRooms: [],
  };
}

function slugify(value: string, prefix: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `${prefix}-${randomUUID().slice(0, 8)}`;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function clampVolume(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeOffBehavior(value: unknown): SceneOffBehavior {
  if (typeof value === "object" && value !== null && "kind" in value) {
    const kind = (value as { kind?: string }).kind;
    if (kind === "pause" || kind === "stop" || kind === "ungroup") {
      return { kind };
    }
  }

  return { kind: "none" };
}

function normalizeSource(value: unknown): SceneSource | undefined {
  if (!value || typeof value !== "object" || !("kind" in value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  if (input.kind === "favorite") {
    const favoriteId = String(input.favoriteId ?? "").trim();
    if (!favoriteId) {
      return undefined;
    }

    return {
      kind: "favorite",
      favoriteId,
      favoriteName: typeof input.favoriteName === "string" ? input.favoriteName : undefined,
    };
  }

  if (input.kind === "line_in") {
    const deviceId = String(input.deviceId ?? "").trim();
    if (!deviceId) {
      return undefined;
    }

    return {
      kind: "line_in",
      deviceId,
      deviceName: typeof input.deviceName === "string" ? input.deviceName : undefined,
      playOnCompletion: input.playOnCompletion !== false,
    };
  }

  if (input.kind === "tv") {
    const deviceId = String(input.deviceId ?? "").trim();
    if (!deviceId) {
      return undefined;
    }

    return {
      kind: "tv",
      deviceId,
      deviceName: typeof input.deviceName === "string" ? input.deviceName : undefined,
      playOnCompletion: input.playOnCompletion !== false,
    };
  }

  return undefined;
}

export function normalizeScene(scene: Partial<SceneDefinition>): SceneDefinition {
  const sceneName = String(scene.name ?? "New Scene").trim() || "New Scene";

  return {
    id: String(scene.id ?? "").trim() || slugify(sceneName, "scene"),
    name: sceneName,
    householdId: String(scene.householdId ?? "").trim(),
    coordinatorPlayerId: String(scene.coordinatorPlayerId ?? "").trim(),
    memberPlayerIds: Array.isArray(scene.memberPlayerIds)
      ? scene.memberPlayerIds.map((playerId) => String(playerId).trim()).filter(Boolean)
      : [],
    source: normalizeSource(scene.source),
    coordinatorVolume: clampVolume(
      scene.coordinatorVolume === undefined ? undefined : asNumber(scene.coordinatorVolume, 0),
    ),
    playerVolumes: Array.isArray(scene.playerVolumes)
      ? Array.from(
          new Map(
            scene.playerVolumes
              .filter((volume) => volume && typeof volume.playerId === "string")
              .map((volume) => [
                volume.playerId,
                {
                  playerId: String(volume.playerId).trim(),
                  volume: Math.max(0, Math.min(100, Math.round(asNumber(volume.volume, 0)))),
                },
              ]),
          ).values(),
        ).filter((volume) => volume.playerId.length > 0)
      : [],
    offBehavior: normalizeOffBehavior(scene.offBehavior),
    settleMs: Math.max(0, asNumber(scene.settleMs, 750)),
    retryCount: Math.max(0, asNumber(scene.retryCount, 3)),
    retryDelayMs: Math.max(0, asNumber(scene.retryDelayMs, 750)),
    autoResetMs: Math.max(0, asNumber(scene.autoResetMs, 0)),
  };
}

function normalizeVirtualRoomChannel(value: unknown): VirtualRoomChannel {
  return value === "right" ? "right" : "left";
}

function normalizeVirtualRoomOnBehavior(value: unknown): VirtualRoomOnBehavior {
  if (typeof value === "object" && value !== null && "kind" in value) {
    const kind = (value as { kind?: string }).kind;
    if (kind === "default_volume") {
      return { kind: "default_volume" };
    }
  }

  return { kind: "restore_last" };
}

function normalizeVirtualRoomOffBehavior(value: unknown): VirtualRoomOffBehavior {
  if (typeof value === "object" && value !== null && "kind" in value) {
    const kind = (value as { kind?: string }).kind;
    if (kind === "volume_zero") {
      return { kind: "volume_zero" };
    }
  }

  return { kind: "mute" };
}

function normalizeVirtualRoomLastActiveBehavior(value: unknown): VirtualRoomLastActiveBehavior {
  if (typeof value === "object" && value !== null && "kind" in value) {
    const kind = (value as { kind?: string }).kind;
    if (kind === "pause" || kind === "stop" || kind === "mute_master") {
      return { kind };
    }
  }

  return { kind: "none" };
}

export function normalizeVirtualRoom(room: Partial<VirtualRoomDefinition>): VirtualRoomDefinition {
  const roomName = String(room.name ?? "New Virtual Room").trim() || "New Virtual Room";
  const maxVolume = Math.max(0, Math.min(100, Math.round(asNumber(room.maxVolume, 100))));

  return {
    id: String(room.id ?? "").trim() || slugify(roomName, "virtual-room"),
    name: roomName,
    householdId: String(room.householdId ?? "").trim(),
    ampPlayerId: String(room.ampPlayerId ?? "").trim(),
    channel: normalizeVirtualRoomChannel(room.channel),
    defaultVolume: Math.max(0, Math.min(100, Math.round(asNumber(room.defaultVolume, 30)))),
    maxVolume,
    onBehavior: normalizeVirtualRoomOnBehavior(room.onBehavior),
    offBehavior: normalizeVirtualRoomOffBehavior(room.offBehavior),
    lastActiveBehavior: normalizeVirtualRoomLastActiveBehavior(room.lastActiveBehavior),
  };
}

export function normalizePlatformConfig(config: Partial<ScenesPlatformConfig> | undefined): ScenesPlatformConfig {
  const defaults = createDefaultPlatformConfig();
  const transport = {
    ...DEFAULT_TRANSPORT,
    ...(config?.transport ?? {}),
    kind: "local" as const,
  };
  const cloud: SonosCloudConfig = {
    mode: config?.cloud?.mode === "local_plus_cloud" ? "local_plus_cloud" : "local_only",
    broker: {
      ...DEFAULT_CLOUD_BROKER,
      ...(config?.cloud?.broker ?? {}),
      url: typeof config?.cloud?.broker?.url === "string" ? config.cloud.broker.url.trim() : undefined,
      apiKey: typeof config?.cloud?.broker?.apiKey === "string" ? config.cloud.broker.apiKey.trim() : undefined,
      timeoutMs: Math.max(1000, asNumber(config?.cloud?.broker?.timeoutMs, DEFAULT_CLOUD_BROKER.timeoutMs)),
      routeFavorites:
        typeof config?.cloud?.broker?.routeFavorites === "boolean"
          ? config.cloud.broker.routeFavorites
          : DEFAULT_CLOUD_BROKER.routeFavorites,
      routePlaylists:
        typeof config?.cloud?.broker?.routePlaylists === "boolean"
          ? config.cloud.broker.routePlaylists
          : DEFAULT_CLOUD_BROKER.routePlaylists,
    },
  };

  return {
    ...defaults,
    ...config,
    platform: PLATFORM_NAME,
    name: String(config?.name ?? defaults.name).trim() || defaults.name,
    logLevel:
      config?.logLevel === "debug" ||
      config?.logLevel === "info" ||
      config?.logLevel === "warn" ||
      config?.logLevel === "error"
        ? config.logLevel
        : defaults.logLevel,
    defaultHouseholdId: typeof config?.defaultHouseholdId === "string" ? config.defaultHouseholdId : undefined,
    transport,
    cloud,
    scenes: Array.isArray(config?.scenes) ? config.scenes.map((scene) => normalizeScene(scene)) : [],
    virtualRooms: Array.isArray(config?.virtualRooms)
      ? config.virtualRooms.map((room) => normalizeVirtualRoom(room))
      : [],
  };
}

export function findHousehold(snapshot: TopologySnapshot, householdId: string): HouseholdSnapshot | undefined {
  return snapshot.households.find((household) => household.id === householdId);
}

function playerName(household: HouseholdSnapshot, playerId: string): string {
  return household.players.find((player) => player.id === playerId)?.name ?? playerId;
}

function validateVolumes(scene: SceneDefinition, household: HouseholdSnapshot, result: ValidationResult): void {
  const referenced = new Set(household.players.map((player) => player.id));

  if (scene.coordinatorVolume !== undefined && (scene.coordinatorVolume < 0 || scene.coordinatorVolume > 100)) {
    result.errors.push("Coordinator volume must be between 0 and 100.");
  }

  for (const item of scene.playerVolumes) {
    if (!referenced.has(item.playerId)) {
      result.errors.push(`Per-room volume references an unknown player: ${item.playerId}.`);
    }
    if (item.volume < 0 || item.volume > 100) {
      result.errors.push(`Volume for ${item.playerId} must be between 0 and 100.`);
    }
  }
}

function validateSource(
  scene: SceneDefinition,
  household: HouseholdSnapshot,
  transport: SonosTransport,
  result: ValidationResult,
): void {
  const source = scene.source;
  if (!source) {
    return;
  }

  if (!transport.supportsSource(source.kind)) {
    result.errors.push(`The active transport does not support source kind "${source.kind}".`);
    return;
  }

  if (source.kind === "favorite") {
    const favorite = household.favorites.find((item) => item.id === source.favoriteId);
    if (!favorite) {
      result.errors.push(`Favorite "${source.favoriteId}" was not found in household "${household.displayName}".`);
      return;
    }

    if (favorite.playable === false) {
      result.errors.push(
        favorite.unsupportedReason
        ?? `Favorite "${favorite.name}" is not playable through the active local transport. Use Local Only scenes for line-in and directly playable favorites, or add a Sonos cloud broker in a future Local + Cloud setup.`,
      );
    }
    return;
  }

  const device = household.players.find((player) => player.id === source.deviceId);
  if (!device) {
    result.errors.push(`Source device "${source.deviceId}" was not found in household "${household.displayName}".`);
    return;
  }

  if (!device.sourceOptions.includes(source.kind)) {
    result.errors.push(`${device.name} does not advertise ${source.kind} as an available source.`);
  }
}

export function validateSceneDefinition(
  sceneInput: Partial<SceneDefinition>,
  snapshot: TopologySnapshot,
  transport: SonosTransport,
): ValidationResult {
  const scene = normalizeScene(sceneInput);
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  if (!scene.name.trim()) {
    result.errors.push("Scene name is required.");
  }

  if (!scene.householdId.trim()) {
    result.errors.push("Household selection is required.");
  }

  const household = findHousehold(snapshot, scene.householdId);
  if (!household) {
    result.errors.push(`Household "${scene.householdId}" was not found in the current topology.`);
  }

  if (!scene.coordinatorPlayerId.trim()) {
    result.errors.push("Coordinator player selection is required.");
  }

  const duplicateMembers = scene.memberPlayerIds.filter((playerId, index, values) => values.indexOf(playerId) !== index);
  if (duplicateMembers.length > 0) {
    result.errors.push(`Scene members contain duplicates: ${Array.from(new Set(duplicateMembers)).join(", ")}.`);
  }

  if (scene.memberPlayerIds.includes(scene.coordinatorPlayerId)) {
    result.errors.push("The coordinator cannot also appear in the grouped member list.");
  }

  if (household) {
    const coordinator = household.players.find((player) => player.id === scene.coordinatorPlayerId);
    if (!coordinator) {
      result.errors.push(`Coordinator "${scene.coordinatorPlayerId}" was not found in "${household.displayName}".`);
    }

    for (const playerId of scene.memberPlayerIds) {
      if (!household.players.some((player) => player.id === playerId)) {
        result.errors.push(`Member "${playerId}" was not found in "${household.displayName}".`);
      }
    }

    validateVolumes(scene, household, result);
    validateSource(scene, household, transport, result);

    if (scene.memberPlayerIds.length === 0) {
      result.warnings.push("The scene has no member rooms selected, so only the coordinator room will be targeted.");
    }

    if (scene.offBehavior.kind === "ungroup" && scene.memberPlayerIds.length === 0) {
      result.warnings.push("Off behavior is set to ungroup, but the scene does not include any grouped members.");
    }

    if (scene.autoResetMs > 0 && scene.offBehavior.kind !== "none") {
      result.warnings.push(
        "Auto Reset is ignored while Off Behavior is enabled. The HomeKit switch will stay on until you turn it off manually, which is what triggers ungroup or other off actions.",
      );
    }

    if (scene.coordinatorVolume === undefined && scene.playerVolumes.length === 0) {
      result.warnings.push("No volume changes are configured. The scene will only affect grouping and source selection.");
    }

    if (scene.playerVolumes.some((volume) => volume.playerId === scene.coordinatorPlayerId)) {
      result.warnings.push(
        `Per-room volume includes the coordinator (${playerName(household, scene.coordinatorPlayerId)}). Coordinator volume already has its own field.`,
      );
    }
  }

  result.valid = result.errors.length === 0;
  return result;
}

function playerLooksLikeAmp(player: SonosPlayer): boolean {
  return /amp/i.test(player.model ?? "");
}

export function validateVirtualRoomDefinition(
  roomInput: Partial<VirtualRoomDefinition>,
  snapshot: TopologySnapshot,
  siblingRoomInputs: Array<Partial<VirtualRoomDefinition>> = [],
): ValidationResult {
  const room = normalizeVirtualRoom(roomInput);
  const siblingRooms = siblingRoomInputs.map((item) => normalizeVirtualRoom(item));
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  if (!room.name.trim()) {
    result.errors.push("Virtual room name is required.");
  }

  if (!room.householdId.trim()) {
    result.errors.push("Household selection is required.");
  }

  if (!room.ampPlayerId.trim()) {
    result.errors.push("Amp player selection is required.");
  }

  const household = findHousehold(snapshot, room.householdId);
  if (!household) {
    result.errors.push(`Household "${room.householdId}" was not found in the current topology.`);
  }

  if (room.defaultVolume > room.maxVolume) {
    result.errors.push("Default volume cannot be greater than max volume.");
  }

  const ampSiblings = siblingRooms.filter((item) => item.ampPlayerId === room.ampPlayerId);
  if (ampSiblings.some((item) => item.channel === room.channel)) {
    result.errors.push(`Only one ${room.channel} virtual room can exist for amp "${room.ampPlayerId}".`);
  }

  if (ampSiblings.some((item) => item.householdId !== room.householdId)) {
    result.errors.push("All virtual rooms for the same amp must belong to the same household.");
  }

  if (ampSiblings.some((item) => item.lastActiveBehavior.kind !== room.lastActiveBehavior.kind)) {
    result.errors.push("All virtual rooms for the same amp must use the same last-active behavior.");
  }

  if (household) {
    const player = household.players.find((item) => item.id === room.ampPlayerId);
    if (!player) {
      result.errors.push(`Amp player "${room.ampPlayerId}" was not found in "${household.displayName}".`);
    } else {
      if (!playerLooksLikeAmp(player)) {
        result.warnings.push(
          `${player.name} is modeled as "${player.model ?? "Unknown"}". Virtual rooms are currently intended for Sonos Amp-style channel-addressable devices.`,
        );
      }

      if (player.fixedVolume) {
        result.warnings.push(`${player.name} reports fixed volume, so virtual room volume control may not behave as expected.`);
      }
    }
  }

  result.valid = result.errors.length === 0;
  return result;
}

export function validateVirtualRoomDefinitions(
  roomInputs: Array<Partial<VirtualRoomDefinition>>,
  snapshot: TopologySnapshot,
): ValidationResult {
  const rooms = roomInputs.map((item) => normalizeVirtualRoom(item));
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };
  const seenIds = new Set<string>();

  for (const room of rooms) {
    if (seenIds.has(room.id)) {
      result.errors.push(`Virtual room ids must be unique. Duplicate id: "${room.id}".`);
      continue;
    }
    seenIds.add(room.id);
  }

  rooms.forEach((room, index) => {
    const siblings = rooms.filter((_, siblingIndex) => siblingIndex !== index);
    const validation = validateVirtualRoomDefinition(room, snapshot, siblings);
    const label = room.name || room.id || `Virtual Room ${index + 1}`;

    result.errors.push(...validation.errors.map((message) => `${label}: ${message}`));
    result.warnings.push(...validation.warnings.map((message) => `${label}: ${message}`));
  });

  result.valid = result.errors.length === 0;
  return result;
}

export function transportSourceKinds(transport: SonosTransport): SceneSourceKind[] {
  return ["favorite", "line_in", "tv"].filter((kind) => transport.supportsSource(kind as SceneSourceKind)) as SceneSourceKind[];
}
