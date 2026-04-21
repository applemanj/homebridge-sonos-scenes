import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import type { SceneDefinition } from "../types";
import type { SonosScenesPlatform } from "../platform";

export class SceneSpeakerAccessory {
  private service: Service;
  private scene: SceneDefinition;
  private readonly logger;
  private lastKnownVolume: number;
  private lastKnownActiveVolume: number;
  private lastKnownMuted = false;
  private activeMutations = 0;
  private latestMutationId = 0;
  private refreshInFlight?: Promise<void>;

  constructor(
    private readonly platform: SonosScenesPlatform,
    private readonly accessory: PlatformAccessory,
    scene: SceneDefinition,
  ) {
    this.scene = scene;
    this.logger = this.platform.createScopedLogger(`scene-volume:${scene.id}`);
    this.lastKnownVolume = scene.coordinatorVolume ?? 30;
    this.lastKnownActiveVolume = this.lastKnownVolume > 0 ? this.lastKnownVolume : 30;
    this.accessory.context.sceneId = scene.id;
    this.accessory.context.kind = "volume";
    this.accessory.displayName = this.displayNameFor(scene);
    this.accessory.category = this.platform.api.hap.Categories.LIGHTBULB;

    const legacySpeakerService = this.accessory.getService(this.platform.Service.Speaker);
    if (legacySpeakerService) {
      this.accessory.removeService(legacySpeakerService);
    }

    this.service =
      this.accessory.getService(this.platform.Service.Lightbulb)
      ?? this.accessory.addService(this.platform.Service.Lightbulb);

    if (!this.service.testCharacteristic(this.platform.Characteristic.Brightness)) {
      this.service.addCharacteristic(this.platform.Characteristic.Brightness);
    }

    this.syncServiceName(this.displayNameFor(scene));
    this.service.setCharacteristic(this.platform.Characteristic.On, this.isOn());
    this.service.setCharacteristic(this.platform.Characteristic.Brightness, this.lastKnownVolume);
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.handleBrightnessGet.bind(this))
      .onSet(this.handleBrightnessSet.bind(this));

    const accessoryInformation =
      this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?? this.accessory.addService(this.platform.Service.AccessoryInformation);

    accessoryInformation
      .setCharacteristic(this.platform.Characteristic.Manufacturer, "homebridge-sonos-scenes")
      .setCharacteristic(this.platform.Characteristic.Model, "Sonos Scene Volume Dimmer")
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `${scene.id}:volume`);
  }

  updateScene(scene: SceneDefinition): void {
    const previousName = this.scene.name;
    this.scene = scene;
    const configuredVolume = scene.coordinatorVolume;
    if (configuredVolume !== undefined) {
      this.lastKnownVolume = configuredVolume;
      if (configuredVolume > 0) {
        this.lastKnownActiveVolume = configuredVolume;
      }
    }
    this.accessory.context.sceneId = scene.id;
    this.accessory.context.kind = "volume";
    this.accessory.displayName = this.displayNameFor(scene);
    this.syncServiceName(this.displayNameFor(scene));
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.isOn());
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.lastKnownVolume);
    if (previousName !== scene.name) {
      this.logger.info(`Renamed scene volume accessory from "${previousName}" to "${scene.name}".`);
    }
  }

  private displayNameFor(scene: SceneDefinition): string {
    return `${scene.name} Volume`;
  }

  private syncServiceName(name: string): void {
    this.service.setCharacteristic(this.platform.Characteristic.Name, name);
    this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);
  }

  private handleBrightnessGet(): CharacteristicValue {
    this.queueRefresh();
    return this.lastKnownVolume;
  }

  private async handleBrightnessSet(value: CharacteristicValue): Promise<void> {
    const nextVolume = Math.max(0, Math.min(100, Math.round(Number(value))));
    const mutationId = this.beginMutation();
    this.logger.info(`HomeKit requested brightness=${nextVolume} for "${this.scene.name}" volume accessory.`);
    try {
      await this.platform.setSceneVolume(this.scene.id, nextVolume);
      if (!this.applyVolumeMutation(nextVolume, mutationId, `brightness=${nextVolume}`)) {
        return;
      }

      if (nextVolume > 0) {
        if (this.lastKnownMuted) {
          await this.platform.setSceneMuted(this.scene.id, false);
          if (!this.applyMuteMutation(false, mutationId, `brightness=${nextVolume}`)) {
            return;
          }
        }
        this.logger.info(
          `Applied brightness change for "${this.scene.name}" volume accessory: on=${this.isOn()}, volume=${this.lastKnownVolume}, muted=${this.lastKnownMuted}.`,
        );
        return;
      }

      await this.platform.setSceneMuted(this.scene.id, true);
      if (!this.applyMuteMutation(true, mutationId, `brightness=${nextVolume}`)) {
        return;
      }
      this.logger.info(
        `Applied brightness change for "${this.scene.name}" volume accessory: on=${this.isOn()}, volume=${this.lastKnownVolume}, muted=${this.lastKnownMuted}.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to set brightness for "${this.scene.name}" volume accessory: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      this.endMutation();
    }
  }

  private handleOnGet(): CharacteristicValue {
    this.queueRefresh();
    return this.isOn();
  }

  private async handleOnSet(value: CharacteristicValue): Promise<void> {
    const nextOn = value === true;
    const mutationId = this.beginMutation();
    this.logger.info(`HomeKit requested on=${nextOn} for "${this.scene.name}" volume accessory.`);
    try {
      if (nextOn) {
        const restoredVolume = this.lastKnownVolume > 0 ? this.lastKnownVolume : this.lastKnownActiveVolume;
        if (this.lastKnownVolume <= 0 && restoredVolume > 0) {
          await this.platform.setSceneVolume(this.scene.id, restoredVolume);
          if (!this.applyVolumeMutation(restoredVolume, mutationId, `on=${nextOn}`)) {
            return;
          }
        }
        await this.platform.setSceneMuted(this.scene.id, false);
        if (!this.applyMuteMutation(false, mutationId, `on=${nextOn}`)) {
          return;
        }
        this.logger.info(
          `Applied on-state change for "${this.scene.name}" volume accessory: on=${this.isOn()}, volume=${this.lastKnownVolume}, muted=${this.lastKnownMuted}.`,
        );
        return;
      }

      if (this.lastKnownVolume > 0) {
        this.lastKnownActiveVolume = this.lastKnownVolume;
      }
      await this.platform.setSceneMuted(this.scene.id, true);
      if (!this.applyMuteMutation(true, mutationId, `on=${nextOn}`)) {
        return;
      }
      this.logger.info(
        `Applied on-state change for "${this.scene.name}" volume accessory: on=${this.isOn()}, volume=${this.lastKnownVolume}, muted=${this.lastKnownMuted}.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to set on=${nextOn} for "${this.scene.name}" volume accessory: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      this.endMutation();
    }
  }

  private isOn(): boolean {
    return !this.lastKnownMuted && this.lastKnownVolume > 0;
  }

  private queueRefresh(): void {
    if (!this.platform.isInitialDiscoveryComplete() || this.refreshInFlight || this.activeMutations > 0) {
      return;
    }

    this.refreshInFlight = this.refreshFromPlatform()
      .catch((error) => {
        this.logger.warn(
          `State refresh failed for "${this.scene.name}" volume accessory: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      })
      .finally(() => {
        this.refreshInFlight = undefined;
      });
  }

  private async refreshFromPlatform(): Promise<void> {
    try {
      const [muted, volume] = await Promise.all([
        this.platform.getSceneMuted(this.scene.id),
        this.platform.getSceneVolume(this.scene.id),
      ]);

      this.lastKnownMuted = muted;
      this.lastKnownVolume = volume;
      if (this.lastKnownVolume > 0) {
        this.lastKnownActiveVolume = this.lastKnownVolume;
      }
      this.service.updateCharacteristic(this.platform.Characteristic.On, this.isOn());
      this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.lastKnownVolume);
      this.logger.debug(
        `Refreshed "${this.scene.name}" volume accessory state: on=${this.isOn()}, volume=${this.lastKnownVolume}, muted=${this.lastKnownMuted}.`,
      );
    } catch (error) {
      this.logger.warn(
        `State refresh failed for "${this.scene.name}" volume accessory: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private beginMutation(): number {
    this.activeMutations += 1;
    this.latestMutationId += 1;
    return this.latestMutationId;
  }

  private endMutation(): void {
    this.activeMutations = Math.max(0, this.activeMutations - 1);
  }

  private applyVolumeMutation(volume: number, mutationId: number, label: string): boolean {
    if (mutationId !== this.latestMutationId) {
      this.logger.debug(`Ignoring stale "${label}" result for "${this.scene.name}" volume accessory.`);
      return false;
    }

    this.lastKnownVolume = volume;
    if (volume > 0) {
      this.lastKnownActiveVolume = volume;
    }
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, volume);
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.isOn());
    return true;
  }

  private applyMuteMutation(muted: boolean, mutationId: number, label: string): boolean {
    if (mutationId !== this.latestMutationId) {
      this.logger.debug(`Ignoring stale "${label}" result for "${this.scene.name}" volume accessory.`);
      return false;
    }

    this.lastKnownMuted = muted;
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.isOn());
    return true;
  }
}
