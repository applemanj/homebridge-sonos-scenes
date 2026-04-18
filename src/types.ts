import type { PlatformConfig } from "homebridge";

export const PLUGIN_NAME = "homebridge-sonos-scenes";
export const PLATFORM_NAME = "SonosScenes";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type SceneSourceKind = "favorite" | "line_in" | "tv";
export type SceneTrigger = "on" | "off" | "test";

export interface FavoriteSource {
  kind: "favorite";
  favoriteId: string;
  favoriteName?: string;
}

export interface LineInSource {
  kind: "line_in";
  deviceId: string;
  deviceName?: string;
  playOnCompletion?: boolean;
}

export interface TvSource {
  kind: "tv";
  deviceId: string;
  deviceName?: string;
  playOnCompletion?: boolean;
}

export type SceneSource = FavoriteSource | LineInSource | TvSource;

export interface SceneVolume {
  playerId: string;
  volume: number;
}

export interface OffBehaviorNone {
  kind: "none";
}

export interface OffBehaviorUngroup {
  kind: "ungroup";
}

export type SceneOffBehavior = OffBehaviorNone | OffBehaviorUngroup;

export interface SceneDefinition {
  id: string;
  name: string;
  householdId: string;
  coordinatorPlayerId: string;
  memberPlayerIds: string[];
  source?: SceneSource;
  coordinatorVolume?: number;
  playerVolumes: SceneVolume[];
  offBehavior: SceneOffBehavior;
  settleMs: number;
  retryCount: number;
  retryDelayMs: number;
  autoResetMs: number;
}

export interface LocalTransportConfig {
  kind: "local";
  fixturePath?: string;
  enableLiveDiscovery: boolean;
  discoveryTimeoutMs: number;
  requestTimeoutMs: number;
  allowTvSource: boolean;
}

export interface ScenesPlatformConfig extends PlatformConfig {
  platform: typeof PLATFORM_NAME;
  name: string;
  logLevel: LogLevel;
  defaultHouseholdId?: string;
  transport: LocalTransportConfig;
  scenes: SceneDefinition[];
}

export interface SonosHouseholdSummary {
  id: string;
  displayName: string;
}

export interface SonosFavorite {
  id: string;
  name: string;
  uri?: string;
  transportUri?: string;
  metadata?: string;
  description?: string;
  playbackType?: string;
  playable?: boolean;
  unsupportedReason?: string;
}

export interface SonosPlayer {
  id: string;
  name: string;
  model?: string;
  capabilities: string[];
  deviceIds: string[];
  groupId?: string;
  isCoordinator: boolean;
  fixedVolume: boolean;
  sourceOptions: SceneSourceKind[];
}

export interface SonosGroup {
  id: string;
  name: string;
  coordinatorId: string;
  playerIds: string[];
  playbackState?: string;
}

export interface HouseholdSnapshot {
  id: string;
  displayName: string;
  players: SonosPlayer[];
  groups: SonosGroup[];
  favorites: SonosFavorite[];
}

export interface TopologySnapshot {
  capturedAt: string;
  origin: "live" | "fixture";
  households: HouseholdSnapshot[];
}

export interface SceneLogEntry {
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  sceneId?: string;
  trigger?: SceneTrigger;
}

export interface SceneRunResult {
  ok: boolean;
  sceneId: string;
  trigger: SceneTrigger;
  logs: SceneLogEntry[];
  errors: string[];
  snapshot?: TopologySnapshot;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SonosTransport {
  readonly kind: string;
  supportsSource(kind: SceneSourceKind): boolean;
  discoverHouseholds(): Promise<SonosHouseholdSummary[]>;
  discoverTopology(): Promise<TopologySnapshot>;
  setGroupMembers(
    householdId: string,
    coordinatorPlayerId: string,
    memberPlayerIds: string[],
  ): Promise<void>;
  modifyGroupMembers(
    householdId: string,
    coordinatorPlayerId: string,
    membersToAdd: string[],
    membersToRemove: string[],
  ): Promise<void>;
  loadLineIn(
    householdId: string,
    coordinatorPlayerId: string,
    deviceId: string,
    playOnCompletion?: boolean,
  ): Promise<void>;
  loadFavorite(householdId: string, coordinatorPlayerId: string, favoriteId: string): Promise<void>;
  loadTv?(
    householdId: string,
    coordinatorPlayerId: string,
    deviceId: string,
    playOnCompletion?: boolean,
  ): Promise<void>;
  setGroupVolume(householdId: string, coordinatorPlayerId: string, volume: number): Promise<void>;
  setPlayerVolume(householdId: string, playerId: string, volume: number): Promise<void>;
  ungroup(householdId: string, coordinatorPlayerId: string, memberPlayerIds?: string[]): Promise<void>;
  subscribe?(
    listener: (snapshot: TopologySnapshot) => void,
  ): Promise<() => Promise<void> | void>;
}
