import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import type { VirtualRoomDefinition, VirtualRoomState } from "../types";
import type { SonosScenesPlatform } from "../platform";

export class VirtualRoomSpeakerAccessory {
  private service: Service;
  private room: VirtualRoomDefinition;
  private lastKnownVolume: number;
  private lastKnownActiveVolume: number;
  private lastKnownMuted = true;
  private lastKnownOn = false;
  private refreshInFlight?: Promise<void>;

  constructor(
    private readonly platform: SonosScenesPlatform,
    private readonly accessory: PlatformAccessory,
    room: VirtualRoomDefinition,
  ) {
    this.room = room;
    this.lastKnownVolume = room.defaultVolume;
    this.lastKnownActiveVolume = room.defaultVolume > 0 ? room.defaultVolume : 30;
    this.accessory.context.virtualRoomId = room.id;
    this.accessory.context.kind = "virtual-room";
    this.accessory.displayName = room.name;
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

    this.service.setCharacteristic(this.platform.Characteristic.Name, room.name);
    this.service.setCharacteristic(this.platform.Characteristic.On, this.lastKnownOn);
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
      .setCharacteristic(this.platform.Characteristic.Model, "Sonos Virtual Room")
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `${room.id}:virtual-room`);
  }

  updateVirtualRoom(room: VirtualRoomDefinition): void {
    this.room = room;
    this.accessory.context.virtualRoomId = room.id;
    this.accessory.context.kind = "virtual-room";
    this.accessory.displayName = room.name;
    this.service.setCharacteristic(this.platform.Characteristic.Name, room.name);
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.lastKnownOn);
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.lastKnownVolume);
  }

  private handleBrightnessGet(): CharacteristicValue {
    this.queueRefresh();
    return this.lastKnownVolume;
  }

  private async handleBrightnessSet(value: CharacteristicValue): Promise<void> {
    const nextVolume = Math.max(0, Math.min(this.room.maxVolume, Math.round(Number(value))));
    if (nextVolume > 0) {
      this.lastKnownActiveVolume = nextVolume;
      this.applyState(await this.platform.setVirtualRoomVolume(this.room.id, nextVolume));
      return;
    }

    if (this.lastKnownVolume > 0) {
      this.lastKnownActiveVolume = this.lastKnownVolume;
    }
    this.applyState(await this.platform.setVirtualRoomVolume(this.room.id, 0));
  }

  private handleOnGet(): CharacteristicValue {
    this.queueRefresh();
    return this.lastKnownOn;
  }

  private async handleOnSet(value: CharacteristicValue): Promise<void> {
    const nextOn = value === true;
    if (nextOn) {
      this.applyState(await this.platform.activateVirtualRoom(this.room.id, this.lastKnownActiveVolume));
      return;
    }

    if (this.lastKnownVolume > 0) {
      this.lastKnownActiveVolume = this.lastKnownVolume;
    }
    this.applyState(await this.platform.deactivateVirtualRoom(this.room.id));
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
    this.applyState(await this.platform.getVirtualRoomState(this.room.id));
  }

  private applyState(state: VirtualRoomState): void {
    this.lastKnownVolume = state.volume;
    this.lastKnownMuted = state.muted;
    this.lastKnownOn = state.on;
    if (state.volume > 0) {
      this.lastKnownActiveVolume = state.volume;
    }
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.lastKnownOn);
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.lastKnownVolume);
  }
}
