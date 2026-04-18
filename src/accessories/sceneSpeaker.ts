import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import type { SceneDefinition } from "../types";
import type { SonosScenesPlatform } from "../platform";

export class SceneSpeakerAccessory {
  private service: Service;
  private scene: SceneDefinition;
  private lastKnownVolume: number;
  private lastKnownMuted = false;

  constructor(
    private readonly platform: SonosScenesPlatform,
    private readonly accessory: PlatformAccessory,
    scene: SceneDefinition,
  ) {
    this.scene = scene;
    this.lastKnownVolume = scene.coordinatorVolume ?? 0;
    this.accessory.context.sceneId = scene.id;
    this.accessory.context.kind = "speaker";
    this.accessory.displayName = this.displayNameFor(scene);
    this.accessory.category = this.platform.api.hap.Categories.SPEAKER;

    this.service =
      this.accessory.getService(this.platform.Service.Speaker)
      ?? this.accessory.addService(this.platform.Service.Speaker);

    if (!this.service.testCharacteristic(this.platform.Characteristic.Volume)) {
      this.service.addCharacteristic(this.platform.Characteristic.Volume);
    }

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.displayNameFor(scene));
    this.service.getCharacteristic(this.platform.Characteristic.Mute)
      .onGet(this.handleMuteGet.bind(this))
      .onSet(this.handleMuteSet.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.Volume)
      .onGet(this.handleVolumeGet.bind(this))
      .onSet(this.handleVolumeSet.bind(this));

    const accessoryInformation =
      this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?? this.accessory.addService(this.platform.Service.AccessoryInformation);

    accessoryInformation
      .setCharacteristic(this.platform.Characteristic.Manufacturer, "homebridge-sonos-scenes")
      .setCharacteristic(this.platform.Characteristic.Model, "Sonos Scene Speaker")
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `${scene.id}:speaker`);
  }

  updateScene(scene: SceneDefinition): void {
    this.scene = scene;
    this.lastKnownVolume = scene.coordinatorVolume ?? this.lastKnownVolume;
    this.accessory.context.sceneId = scene.id;
    this.accessory.context.kind = "speaker";
    this.accessory.displayName = this.displayNameFor(scene);
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.displayNameFor(scene));
  }

  private displayNameFor(scene: SceneDefinition): string {
    return `${scene.name} Volume`;
  }

  private async handleVolumeGet(): Promise<CharacteristicValue> {
    try {
      this.lastKnownVolume = await this.platform.getSceneVolume(this.scene.id);
    } catch {
      void 0;
    }

    return this.lastKnownVolume;
  }

  private async handleVolumeSet(value: CharacteristicValue): Promise<void> {
    const nextVolume = Math.max(0, Math.min(100, Math.round(Number(value))));
    await this.platform.setSceneVolume(this.scene.id, nextVolume);
    this.lastKnownVolume = nextVolume;
    this.service.updateCharacteristic(this.platform.Characteristic.Volume, nextVolume);
  }

  private async handleMuteGet(): Promise<CharacteristicValue> {
    try {
      this.lastKnownMuted = await this.platform.getSceneMuted(this.scene.id);
    } catch {
      void 0;
    }

    return this.lastKnownMuted;
  }

  private async handleMuteSet(value: CharacteristicValue): Promise<void> {
    const nextMuted = value === true;
    await this.platform.setSceneMuted(this.scene.id, nextMuted);
    this.lastKnownMuted = nextMuted;
    this.service.updateCharacteristic(this.platform.Characteristic.Mute, nextMuted);
  }
}
