import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from "homebridge";
import { normalizePlatformConfig } from "./config";
import { DiscoveryService } from "./discoveryService";
import { StructuredLogger } from "./logger";
import { SceneRunner } from "./sceneRunner";
import { matchSceneTopology } from "./sceneStateReconciler";
import { SceneSpeakerAccessory } from "./accessories/sceneSpeaker";
import { SceneSwitchAccessory } from "./accessories/sceneSwitch";
import { VirtualRoomSpeakerAccessory } from "./accessories/virtualRoomSpeaker";
import { createTransport } from "./transports";
import type {
  SceneDefinition,
  SceneRunResult,
  SceneTrigger,
  ScenesPlatformConfig,
  VirtualRoomDefinition,
  VirtualRoomState,
} from "./types";
import { PLATFORM_NAME, PLUGIN_NAME } from "./types";

export { PLATFORM_NAME, PLUGIN_NAME };

const SCENE_RECONCILIATION_INTERVAL_MS = 30_000;

export class SonosScenesPlatform implements DynamicPlatformPlugin {
  public readonly Service;
  public readonly Characteristic;

  private readonly config: ScenesPlatformConfig;
  private readonly logger: StructuredLogger;
  private readonly discoveryService: DiscoveryService;
  private readonly sceneRunner: SceneRunner;
  private readonly transport;
  private readonly cachedAccessories = new Map<string, PlatformAccessory>();
  private readonly switchAccessories = new Map<string, SceneSwitchAccessory>();
  private readonly speakerAccessories = new Map<string, SceneSpeakerAccessory>();
  private readonly virtualRoomAccessories = new Map<string, VirtualRoomSpeakerAccessory>();
  private initialDiscoveryComplete = false;
  private sceneReconciliationTimer?: NodeJS.Timeout;
  private sceneReconciliationRunning = false;

  constructor(
    public readonly log: Logger,
    private readonly rawConfig: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.config = normalizePlatformConfig(rawConfig as Partial<ScenesPlatformConfig>);
    this.logger = new StructuredLogger("platform", this.config.logLevel, this.log);
    this.transport = createTransport(this.config, this.logger);
    this.discoveryService = new DiscoveryService(this.transport);
    this.sceneRunner = new SceneRunner(this.discoveryService, this.transport, this.logger);

    this.api.on("didFinishLaunching", () => {
      void this.syncAccessories();
    });
    this.api.on("shutdown", () => {
      this.stopSceneReconciliation();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  async runScene(sceneId: string, trigger: SceneTrigger): Promise<SceneRunResult> {
    const scene = this.config.scenes.find((item) => item.id === sceneId);
    if (!scene) {
      return {
        ok: false,
        sceneId,
        trigger,
        logs: [],
        errors: [`Scene "${sceneId}" is not configured.`],
      };
    }

    if (trigger === "off") {
      return this.sceneRunner.runOff(scene);
    }

    if (trigger === "test") {
      return this.sceneRunner.runTest(scene);
    }

    return this.sceneRunner.runOn(scene);
  }

  getScene(sceneId: string): SceneDefinition | undefined {
    return this.config.scenes.find((scene) => scene.id === sceneId);
  }

  async getSceneVolume(sceneId: string): Promise<number> {
    const scene = this.getRequiredScene(sceneId);
    if (this.usesGroupAudio(scene)) {
      return this.transport.getGroupVolume(scene.householdId, scene.coordinatorPlayerId);
    }

    return this.transport.getPlayerVolume(scene.householdId, scene.coordinatorPlayerId);
  }

  async setSceneVolume(sceneId: string, volume: number): Promise<void> {
    const scene = this.getRequiredScene(sceneId);
    if (this.usesGroupAudio(scene)) {
      await this.transport.setGroupVolume(scene.householdId, scene.coordinatorPlayerId, volume);
      return;
    }

    await this.transport.setPlayerVolume(scene.householdId, scene.coordinatorPlayerId, volume);
  }

  async getSceneMuted(sceneId: string): Promise<boolean> {
    const scene = this.getRequiredScene(sceneId);
    if (this.usesGroupAudio(scene)) {
      return this.transport.getGroupMuted(scene.householdId, scene.coordinatorPlayerId);
    }

    return this.transport.getPlayerMuted(scene.householdId, scene.coordinatorPlayerId);
  }

  async setSceneMuted(sceneId: string, muted: boolean): Promise<void> {
    const scene = this.getRequiredScene(sceneId);
    if (this.usesGroupAudio(scene)) {
      await this.transport.setGroupMuted(scene.householdId, scene.coordinatorPlayerId, muted);
      return;
    }

    await this.transport.setPlayerMuted(scene.householdId, scene.coordinatorPlayerId, muted);
  }

  getVirtualRoom(roomId: string): VirtualRoomDefinition | undefined {
    return this.config.virtualRooms.find((room) => room.id === roomId);
  }

  createScopedLogger(scope: string): StructuredLogger {
    return this.logger.child(scope);
  }

  isInitialDiscoveryComplete(): boolean {
    return this.initialDiscoveryComplete;
  }

  async getVirtualRoomState(roomId: string): Promise<VirtualRoomState> {
    const room = this.getRequiredVirtualRoom(roomId);
    return this.readVirtualRoomState(room);
  }

  async activateVirtualRoom(roomId: string, fallbackVolume?: number): Promise<VirtualRoomState> {
    const room = this.getRequiredVirtualRoom(roomId);
    const [currentVolume, currentMasterVolume, channelMuted] = await Promise.all([
      this.transport.getPlayerChannelVolume(room.householdId, room.ampPlayerId, room.channel),
      this.transport.getPlayerVolume(room.householdId, room.ampPlayerId),
      this.transport.getPlayerChannelMuted(room.householdId, room.ampPlayerId, room.channel),
    ]);
    const targetVolume = Math.max(
      0,
      Math.min(
        room.maxVolume,
        Math.round(
          room.onBehavior.kind === "default_volume"
            ? room.defaultVolume
            : !channelMuted && currentVolume > 0
              ? currentVolume
              : fallbackVolume && fallbackVolume > 0
                ? fallbackVolume
                : currentVolume > 0
                  ? currentVolume
                : room.defaultVolume,
        ),
      ),
    );

    if (targetVolume > 0) {
      await this.prepareVirtualRoomPlayback(room, targetVolume, currentMasterVolume);
      return { volume: targetVolume, muted: false, on: true };
    }

    await Promise.all([
      this.transport.setPlayerMuted(room.householdId, room.ampPlayerId, false),
      this.transport.setPlayerChannelMuted(room.householdId, room.ampPlayerId, room.channel, false),
    ]);
    return { volume: 0, muted: false, on: false };
  }

  async setVirtualRoomVolume(roomId: string, volume: number): Promise<VirtualRoomState> {
    const room = this.getRequiredVirtualRoom(roomId);
    const targetVolume = Math.max(0, Math.min(room.maxVolume, Math.round(volume)));

    if (targetVolume > 0) {
      const currentMasterVolume = await this.transport.getPlayerVolume(room.householdId, room.ampPlayerId);
      await this.prepareVirtualRoomPlayback(room, targetVolume, currentMasterVolume);
      return { volume: targetVolume, muted: false, on: true };
    }

    await Promise.all([
      this.transport.setPlayerChannelVolume(room.householdId, room.ampPlayerId, room.channel, 0),
      this.transport.setPlayerChannelMuted(room.householdId, room.ampPlayerId, room.channel, false),
    ]);
    await this.applyLastActiveBehavior(room);
    return { volume: 0, muted: false, on: false };
  }

  async deactivateVirtualRoom(roomId: string, forceVolumeZero = false): Promise<VirtualRoomState> {
    const room = this.getRequiredVirtualRoom(roomId);

    let resultState: VirtualRoomState;
    if (forceVolumeZero || room.offBehavior.kind === "volume_zero") {
      await Promise.all([
        this.transport.setPlayerChannelVolume(room.householdId, room.ampPlayerId, room.channel, 0),
        this.transport.setPlayerChannelMuted(room.householdId, room.ampPlayerId, room.channel, false),
      ]);
      resultState = { volume: 0, muted: false, on: false };
    } else {
      const resetVolume = Math.max(0, Math.min(room.maxVolume, room.defaultVolume));
      await Promise.all([
        this.transport.setPlayerChannelMuted(room.householdId, room.ampPlayerId, room.channel, true),
        this.transport.setPlayerChannelVolume(room.householdId, room.ampPlayerId, room.channel, resetVolume),
      ]);
      resultState = { volume: resetVolume, muted: true, on: false };
    }

    await this.applyLastActiveBehavior(room);
    return resultState;
  }

  private async syncAccessories(): Promise<void> {
    this.logger.info(
      `Syncing ${this.config.scenes.length} scene(s) and ${this.config.virtualRooms.length} virtual room(s).`,
    );
    const activeAccessoryIds = new Set<string>();

    for (const scene of this.config.scenes) {
      const switchUuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${scene.id}:switch`);
      const speakerUuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${scene.id}:speaker`);
      activeAccessoryIds.add(switchUuid);
      activeAccessoryIds.add(speakerUuid);

      const switchAccessory = this.syncSwitchAccessory(scene, switchUuid);
      const speakerAccessory = this.syncSpeakerAccessory(scene, speakerUuid);
      this.api.updatePlatformAccessories([switchAccessory, speakerAccessory]);
    }

    for (const room of this.config.virtualRooms) {
      const roomUuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${room.id}:virtual-room`);
      activeAccessoryIds.add(roomUuid);

      const virtualRoomAccessory = this.syncVirtualRoomAccessory(room, roomUuid);
      this.api.updatePlatformAccessories([virtualRoomAccessory]);
    }

    const staleAccessories = Array.from(this.cachedAccessories.entries())
      .filter(([uuid]) => !activeAccessoryIds.has(uuid))
      .map(([, accessory]) => accessory);

    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
      for (const accessory of staleAccessories) {
        this.cachedAccessories.delete(accessory.UUID);
      }
      this.pruneWrapperMaps();
    }

    try {
      const snapshot = await this.discoveryService.refresh();
      this.logger.info(`Discovery complete: ${snapshot.households.length} household(s) available.`);
    } catch (error) {
      this.logger.warn(`Initial discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.initialDiscoveryComplete = true;
      this.startSceneReconciliation();
    }
  }

  private startSceneReconciliation(): void {
    if (this.sceneReconciliationTimer || this.config.scenes.length === 0) {
      return;
    }

    this.sceneReconciliationTimer = setInterval(() => {
      void this.reconcileSceneSwitchStates();
    }, SCENE_RECONCILIATION_INTERVAL_MS);
    this.sceneReconciliationTimer.unref?.();
    this.logger.debug(`Scene state reconciliation enabled every ${SCENE_RECONCILIATION_INTERVAL_MS}ms.`);
  }

  private stopSceneReconciliation(): void {
    if (!this.sceneReconciliationTimer) {
      return;
    }

    clearInterval(this.sceneReconciliationTimer);
    this.sceneReconciliationTimer = undefined;
  }

  private async reconcileSceneSwitchStates(): Promise<void> {
    const activeSwitches = Array.from(this.switchAccessories.entries()).filter(([, wrapper]) => wrapper.isOn());
    if (activeSwitches.length === 0 || this.sceneReconciliationRunning) {
      return;
    }

    this.sceneReconciliationRunning = true;
    try {
      const snapshot = await this.discoveryService.refresh();

      for (const [sceneId, wrapper] of activeSwitches) {
        const scene = this.getScene(sceneId);
        if (!scene || !wrapper.isOn()) {
          continue;
        }

        const match = matchSceneTopology(scene, snapshot);
        if (!match.active) {
          wrapper.markOffFromReconciliation(match.reason ?? "scene grouping no longer matches");
        }
      }
    } catch (error) {
      this.logger.warn(`Scene state reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.sceneReconciliationRunning = false;
    }
  }

  private syncSwitchAccessory(scene: SceneDefinition, uuid: string): PlatformAccessory {
    let accessory = this.cachedAccessories.get(uuid);

    if (!accessory) {
      accessory = new this.api.platformAccessory(scene.name, uuid);
      this.cachedAccessories.set(uuid, accessory);
      const wrapper = new SceneSwitchAccessory(this, accessory, scene);
      this.switchAccessories.set(scene.id, wrapper);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      return accessory;
    }

    const wrapper = this.switchAccessories.get(scene.id) ?? new SceneSwitchAccessory(this, accessory, scene);
    wrapper.updateScene(scene);
    this.switchAccessories.set(scene.id, wrapper);
    return accessory;
  }

  private syncSpeakerAccessory(scene: SceneDefinition, uuid: string): PlatformAccessory {
    let accessory = this.cachedAccessories.get(uuid);

    if (!accessory) {
      accessory = new this.api.platformAccessory(`${scene.name} Volume`, uuid);
      this.cachedAccessories.set(uuid, accessory);
      const wrapper = new SceneSpeakerAccessory(this, accessory, scene);
      this.speakerAccessories.set(scene.id, wrapper);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      return accessory;
    }

    const wrapper = this.speakerAccessories.get(scene.id) ?? new SceneSpeakerAccessory(this, accessory, scene);
    wrapper.updateScene(scene);
    this.speakerAccessories.set(scene.id, wrapper);
    return accessory;
  }

  private syncVirtualRoomAccessory(room: VirtualRoomDefinition, uuid: string): PlatformAccessory {
    let accessory = this.cachedAccessories.get(uuid);

    if (!accessory) {
      accessory = new this.api.platformAccessory(room.name, uuid);
      this.cachedAccessories.set(uuid, accessory);
      const wrapper = new VirtualRoomSpeakerAccessory(this, accessory, room);
      this.virtualRoomAccessories.set(room.id, wrapper);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      return accessory;
    }

    const wrapper = this.virtualRoomAccessories.get(room.id) ?? new VirtualRoomSpeakerAccessory(this, accessory, room);
    wrapper.updateVirtualRoom(room);
    this.virtualRoomAccessories.set(room.id, wrapper);
    return accessory;
  }

  private pruneWrapperMaps(): void {
    const activeSceneIds = new Set(this.config.scenes.map((scene) => scene.id));
    const activeVirtualRoomIds = new Set(this.config.virtualRooms.map((room) => room.id));

    for (const sceneId of this.switchAccessories.keys()) {
      if (!activeSceneIds.has(sceneId)) {
        this.switchAccessories.delete(sceneId);
      }
    }

    for (const sceneId of this.speakerAccessories.keys()) {
      if (!activeSceneIds.has(sceneId)) {
        this.speakerAccessories.delete(sceneId);
      }
    }

    for (const roomId of this.virtualRoomAccessories.keys()) {
      if (!activeVirtualRoomIds.has(roomId)) {
        this.virtualRoomAccessories.delete(roomId);
      }
    }
  }

  private getRequiredScene(sceneId: string): SceneDefinition {
    const scene = this.getScene(sceneId);
    if (!scene) {
      throw new Error(`Scene "${sceneId}" is not configured.`);
    }

    return scene;
  }

  private usesGroupAudio(scene: SceneDefinition): boolean {
    return scene.memberPlayerIds.length > 0;
  }

  private getRequiredVirtualRoom(roomId: string): VirtualRoomDefinition {
    const room = this.getVirtualRoom(roomId);
    if (!room) {
      throw new Error(`Virtual room "${roomId}" is not configured.`);
    }

    return room;
  }

  private getSiblingVirtualRooms(room: VirtualRoomDefinition): VirtualRoomDefinition[] {
    return this.config.virtualRooms.filter(
      (item) => item.householdId === room.householdId && item.ampPlayerId === room.ampPlayerId,
    );
  }

  private async readVirtualRoomState(room: VirtualRoomDefinition): Promise<VirtualRoomState> {
    const [masterMuted, masterVolume, channelMuted, channelVolume] = await Promise.all([
      this.transport.getPlayerMuted(room.householdId, room.ampPlayerId),
      this.transport.getPlayerVolume(room.householdId, room.ampPlayerId),
      this.transport.getPlayerChannelMuted(room.householdId, room.ampPlayerId, room.channel),
      this.transport.getPlayerChannelVolume(room.householdId, room.ampPlayerId, room.channel),
    ]);
    const effectiveVolume = Math.max(0, Math.min(masterVolume, channelVolume));

    return {
      volume: effectiveVolume,
      muted: masterMuted || channelMuted,
      on: !masterMuted && !channelMuted && effectiveVolume > 0,
    };
  }

  private async prepareVirtualRoomPlayback(
    room: VirtualRoomDefinition,
    targetVolume: number,
    currentMasterVolume: number,
  ): Promise<void> {
    const operations: Array<Promise<void>> = [
      this.transport.setPlayerChannelVolume(room.householdId, room.ampPlayerId, room.channel, targetVolume),
      this.transport.setPlayerMuted(room.householdId, room.ampPlayerId, false),
      this.transport.setPlayerChannelMuted(room.householdId, room.ampPlayerId, room.channel, false),
    ];

    if (currentMasterVolume < targetVolume) {
      operations.push(this.transport.setPlayerVolume(room.householdId, room.ampPlayerId, targetVolume));
    }

    await Promise.all(operations);
  }

  private async applyLastActiveBehavior(room: VirtualRoomDefinition): Promise<void> {
    const states = await Promise.all(this.getSiblingVirtualRooms(room).map((item) => this.readVirtualRoomState(item)));
    if (states.some((state) => state.on)) {
      return;
    }

    if (room.lastActiveBehavior.kind === "pause") {
      await this.transport.pausePlayback(room.householdId, room.ampPlayerId);
      return;
    }

    if (room.lastActiveBehavior.kind === "stop") {
      await this.transport.stopPlayback(room.householdId, room.ampPlayerId);
      return;
    }

    if (room.lastActiveBehavior.kind === "mute_master") {
      await this.transport.setPlayerMuted(room.householdId, room.ampPlayerId, true);
    }
  }
}
