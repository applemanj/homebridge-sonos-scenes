import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from "homebridge";
import { normalizePlatformConfig } from "./config";
import { DiscoveryService } from "./discoveryService";
import { StructuredLogger } from "./logger";
import { SceneRunner } from "./sceneRunner";
import { SceneSpeakerAccessory } from "./accessories/sceneSpeaker";
import { SceneSwitchAccessory } from "./accessories/sceneSwitch";
import { createTransport } from "./transports";
import type { SceneDefinition, SceneRunResult, SceneTrigger, ScenesPlatformConfig } from "./types";
import { PLATFORM_NAME, PLUGIN_NAME } from "./types";

export { PLATFORM_NAME, PLUGIN_NAME };

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

  constructor(
    public readonly log: Logger,
    private readonly rawConfig: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.config = normalizePlatformConfig(rawConfig as Partial<ScenesPlatformConfig>);
    this.transport = createTransport(this.config);
    this.logger = new StructuredLogger("platform", this.config.logLevel, this.log);
    this.discoveryService = new DiscoveryService(this.transport);
    this.sceneRunner = new SceneRunner(this.discoveryService, this.transport, this.logger);

    this.api.on("didFinishLaunching", () => {
      void this.syncAccessories();
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

  private async syncAccessories(): Promise<void> {
    this.logger.info(`Syncing ${this.config.scenes.length} configured Sonos scene accessory(s).`);
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

  private pruneWrapperMaps(): void {
    const activeSceneIds = new Set(this.config.scenes.map((scene) => scene.id));

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
}
