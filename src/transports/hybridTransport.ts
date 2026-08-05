import type {
  CloudBrokerConfig,
  SceneSourceKind,
  SonosHouseholdSummary,
  SonosTransport,
  TopologySnapshot,
  VirtualRoomChannel,
} from "../types";
import type { StructuredLogger } from "../logger";
import { CloudBrokerClient } from "../cloud/brokerClient";

/**
 * Hybrid transport that delegates all local operations (grouping, volume,
 * line-in, TV, playback control) to the local transport, but routes
 * favorite/playlist loading through the cloud broker when the local path
 * cannot handle a source.
 *
 * This is the transport used in `local_plus_cloud` mode.
 */
export class HybridSonosTransport implements SonosTransport {
  readonly kind = "local_plus_cloud";

  private readonly brokerClient: CloudBrokerClient;
  private readonly logger?: StructuredLogger;

  constructor(
    private readonly localTransport: SonosTransport,
    brokerConfig: CloudBrokerConfig,
    logger?: StructuredLogger,
  ) {
    this.brokerClient = new CloudBrokerClient(brokerConfig);
    this.logger = logger?.child("hybrid");
  }

  supportsSource(kind: SceneSourceKind): boolean {
    // In cloud mode, all source kinds are supported — the broker handles
    // favorites/playlists that the local path cannot play.
    return this.localTransport.supportsSource(kind) || kind === "favorite";
  }

  // -- Discovery (always local) --

  discoverHouseholds(): Promise<SonosHouseholdSummary[]> {
    return this.localTransport.discoverHouseholds();
  }

  discoverTopology(): Promise<TopologySnapshot> {
    return this.localTransport.discoverTopology();
  }

  // -- Grouping (always local) --

  setGroupMembers(
    householdId: string,
    coordinatorPlayerId: string,
    memberPlayerIds: string[],
  ): Promise<void> {
    return this.localTransport.setGroupMembers(householdId, coordinatorPlayerId, memberPlayerIds);
  }

  modifyGroupMembers(
    householdId: string,
    coordinatorPlayerId: string,
    membersToAdd: string[],
    membersToRemove: string[],
  ): Promise<void> {
    return this.localTransport.modifyGroupMembers(
      householdId,
      coordinatorPlayerId,
      membersToAdd,
      membersToRemove,
    );
  }

  // -- Source loading --

  loadLineIn(
    householdId: string,
    coordinatorPlayerId: string,
    deviceId: string,
    playOnCompletion?: boolean,
  ): Promise<void> {
    return this.localTransport.loadLineIn(householdId, coordinatorPlayerId, deviceId, playOnCompletion);
  }

  async loadFavorite(householdId: string, coordinatorPlayerId: string, favoriteId: string): Promise<void> {
    if (!this.brokerClient.configured) {
      this.logger?.warn("Cloud broker is not configured, falling back to local favorite load");
      return this.localTransport.loadFavorite(householdId, coordinatorPlayerId, favoriteId);
    }

    try {
      // Resolve the group ID for the coordinator player
      const topology = await this.localTransport.discoverTopology();
      const household = topology.households.find((h) => h.id === householdId);
      if (!household) {
        throw new Error(`Household ${householdId} not found in topology`);
      }

      const group = household.groups.find((g) =>
        g.coordinatorId === coordinatorPlayerId || g.playerIds.includes(coordinatorPlayerId),
      );
      if (!group) {
        throw new Error(`No group found for coordinator ${coordinatorPlayerId}`);
      }

      this.logger?.info(
        `Loading favorite ${favoriteId} via cloud broker on group ${group.id}`,
      );

      await this.brokerClient.loadFavorite(group.id, favoriteId);
    } catch (error) {
      this.logger?.warn(
        `Cloud broker favorite load failed, falling back to local: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.localTransport.loadFavorite(householdId, coordinatorPlayerId, favoriteId);
    }
  }

  loadTv?(
    householdId: string,
    coordinatorPlayerId: string,
    deviceId: string,
    playOnCompletion?: boolean,
  ): Promise<void> {
    return this.localTransport.loadTv!(householdId, coordinatorPlayerId, deviceId, playOnCompletion);
  }

  // -- Volume (always local) --

  getGroupVolume(householdId: string, coordinatorPlayerId: string): Promise<number> {
    return this.localTransport.getGroupVolume(householdId, coordinatorPlayerId);
  }

  setGroupVolume(householdId: string, coordinatorPlayerId: string, volume: number): Promise<void> {
    return this.localTransport.setGroupVolume(householdId, coordinatorPlayerId, volume);
  }

  getPlayerVolume(householdId: string, playerId: string): Promise<number> {
    return this.localTransport.getPlayerVolume(householdId, playerId);
  }

  setPlayerVolume(householdId: string, playerId: string, volume: number): Promise<void> {
    return this.localTransport.setPlayerVolume(householdId, playerId, volume);
  }

  getPlayerChannelVolume(
    householdId: string,
    playerId: string,
    channel: VirtualRoomChannel,
  ): Promise<number> {
    return this.localTransport.getPlayerChannelVolume(householdId, playerId, channel);
  }

  setPlayerChannelVolume(
    householdId: string,
    playerId: string,
    channel: VirtualRoomChannel,
    volume: number,
  ): Promise<void> {
    return this.localTransport.setPlayerChannelVolume(householdId, playerId, channel, volume);
  }

  // -- Mute (always local) --

  getGroupMuted(householdId: string, coordinatorPlayerId: string): Promise<boolean> {
    return this.localTransport.getGroupMuted(householdId, coordinatorPlayerId);
  }

  setGroupMuted(householdId: string, coordinatorPlayerId: string, muted: boolean): Promise<void> {
    return this.localTransport.setGroupMuted(householdId, coordinatorPlayerId, muted);
  }

  getPlayerMuted(householdId: string, playerId: string): Promise<boolean> {
    return this.localTransport.getPlayerMuted(householdId, playerId);
  }

  setPlayerMuted(householdId: string, playerId: string, muted: boolean): Promise<void> {
    return this.localTransport.setPlayerMuted(householdId, playerId, muted);
  }

  getPlayerChannelMuted(
    householdId: string,
    playerId: string,
    channel: VirtualRoomChannel,
  ): Promise<boolean> {
    return this.localTransport.getPlayerChannelMuted(householdId, playerId, channel);
  }

  setPlayerChannelMuted(
    householdId: string,
    playerId: string,
    channel: VirtualRoomChannel,
    muted: boolean,
  ): Promise<void> {
    return this.localTransport.setPlayerChannelMuted(householdId, playerId, channel, muted);
  }

  // -- Playback control (always local) --

  pausePlayback(householdId: string, coordinatorPlayerId: string): Promise<void> {
    return this.localTransport.pausePlayback(householdId, coordinatorPlayerId);
  }

  stopPlayback(householdId: string, coordinatorPlayerId: string): Promise<void> {
    return this.localTransport.stopPlayback(householdId, coordinatorPlayerId);
  }

  ungroup(householdId: string, coordinatorPlayerId: string, memberPlayerIds?: string[]): Promise<void> {
    return this.localTransport.ungroup(householdId, coordinatorPlayerId, memberPlayerIds);
  }

  // -- Subscription (always local) --

  subscribe?(
    listener: (snapshot: TopologySnapshot) => void,
  ): Promise<() => Promise<void> | void> {
    return this.localTransport.subscribe!(listener);
  }
}
