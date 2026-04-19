import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import type { SceneDefinition } from "../types";
import type { SonosScenesPlatform } from "../platform";

export class SceneSpeakerAccessory {
  private service: Service;
  private scene: SceneDefinition;
  private lastKnownVolume: number;
  private lastKnownActiveVolume: number;
  private lastKnownMuted = false;
  private refreshInFlight?: Promise<void>;

  constructor(
    private readonly platform: SonosScenesPlatform,
    private readonly accessory: PlatformAccessory,
    scene: SceneDefinition,
  ) {
    this.scene = scene;
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

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.displayNameFor(scene));
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
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.displayNameFor(scene));
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.isOn());
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.lastKnownVolume);
  }

  private displayNameFor(scene: SceneDefinition): string {
    return `${scene.name} Volume`;
  }

  private handleBrightnessGet(): CharacteristicValue {
    this.queueRefresh();
    return this.lastKnownVolume;
  }

  private async handleBrightnessSet(value: CharacteristicValue): Promise<void> {
    const nextVolume = Math.max(0, Math.min(100, Math.round(Number(value))));
    await this.platform.setSceneVolume(this.scene.id, nextVolume);
    this.lastKnownVolume = nextVolume;
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, nextVolume);

    if (nextVolume > 0) {
      this.lastKnownActiveVolume = nextVolume;
      if (this.lastKnownMuted) {
        await this.platform.setSceneMuted(this.scene.id, false);
        this.lastKnownMuted = false;
      }
      this.service.updateCharacteristic(this.platform.Characteristic.On, this.isOn());
      return;
    }

    await this.platform.setSceneMuted(this.scene.id, true);
    this.lastKnownMuted = true;
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.isOn());
  }

  private handleOnGet(): CharacteristicValue {
    this.queueRefresh();
    return this.isOn();
  }

  private async handleOnSet(value: CharacteristicValue): Promise<void> {
    const nextOn = value === true;
    if (nextOn) {
      const restoredVolume = this.lastKnownVolume > 0 ? this.lastKnownVolume : this.lastKnownActiveVolume;
      if (this.lastKnownVolume <= 0 && restoredVolume > 0) {
        await this.platform.setSceneVolume(this.scene.id, restoredVolume);
        this.lastKnownVolume = restoredVolume;
        this.service.updateCharacteristic(this.platform.Characteristic.Brightness, restoredVolume);
      }
      await this.platform.setSceneMuted(this.scene.id, false);
      this.lastKnownMuted = false;
      this.service.updateCharacteristic(this.platform.Characteristic.On, this.isOn());
      return;
    }

    if (this.lastKnownVolume > 0) {
      this.lastKnownActiveVolume = this.lastKnownVolume;
    }
    await this.platform.setSceneMuted(this.scene.id, true);
    this.lastKnownMuted = true;
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.isOn());
  }

  private isOn(): boolean {
    return !this.lastKnownMuted && this.lastKnownVolume > 0;
  }

  private queueRefresh(): void {
    if (this.refreshInFlight) {
      return;
    }

    this.refreshInFlight = this.refreshFromPlatform()
      .catch(() => undefined)
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
    } catch {
      void 0;
    }
  }
}
