import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from "homebridge";
import { normalizePlatformConfig } from "./config";
import { DiscoveryService } from "./discoveryService";
import { StructuredLogger } from "./logger";
import { SceneRunner } from "./sceneRunner";
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
  private readonly sceneAccessories = new Map<string, SceneSwitchAccessory>();

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

  private async syncAccessories(): Promise<void> {
    this.logger.info(`Syncing ${this.config.scenes.length} configured Sonos scene accessory(s).`);
    const activeAccessoryIds = new Set<string>();

    for (const scene of this.config.scenes) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${scene.id}`);
      activeAccessoryIds.add(uuid);
      let accessory = this.cachedAccessories.get(uuid);

      if (!accessory) {
        accessory = new this.api.platformAccessory(scene.name, uuid);
        this.cachedAccessories.set(uuid, accessory);
        const wrapper = new SceneSwitchAccessory(this, accessory, scene);
        this.sceneAccessories.set(scene.id, wrapper);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        continue;
      }

      const wrapper = this.sceneAccessories.get(scene.id) ?? new SceneSwitchAccessory(this, accessory, scene);
      wrapper.updateScene(scene);
      this.sceneAccessories.set(scene.id, wrapper);
      this.api.updatePlatformAccessories([accessory]);
    }

    const staleAccessories = Array.from(this.cachedAccessories.entries())
      .filter(([uuid]) => !activeAccessoryIds.has(uuid))
      .map(([, accessory]) => accessory);

    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
      for (const accessory of staleAccessories) {
        this.cachedAccessories.delete(accessory.UUID);
      }
      for (const [sceneId, wrapper] of this.sceneAccessories.entries()) {
        if (!this.config.scenes.some((scene) => scene.id === sceneId)) {
          void wrapper;
          this.sceneAccessories.delete(sceneId);
        }
      }
    }

    try {
      const snapshot = await this.discoveryService.refresh();
      this.logger.info(`Discovery complete: ${snapshot.households.length} household(s) available.`);
    } catch (error) {
      this.logger.warn(`Initial discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
