import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import type { VirtualRoomDefinition, VirtualRoomState } from "../types";
import type { SonosScenesPlatform } from "../platform";

export class VirtualRoomSpeakerAccessory {
  private service: Service;
  private room: VirtualRoomDefinition;
  private readonly logger;
  private lastKnownVolume: number;
  private lastKnownActiveVolume: number;
  private lastKnownMuted = true;
  private lastKnownOn = false;
  private activeMutations = 0;
  private latestMutationId = 0;
  private refreshInFlight?: Promise<void>;

  constructor(
    private readonly platform: SonosScenesPlatform,
    private readonly accessory: PlatformAccessory,
    room: VirtualRoomDefinition,
  ) {
    this.room = room;
    this.logger = this.platform.createScopedLogger(`virtual-room:${room.id}`);
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
    const previousName = this.room.name;
    this.room = room;
    this.accessory.context.virtualRoomId = room.id;
    this.accessory.context.kind = "virtual-room";
    this.accessory.displayName = room.name;
    this.service.setCharacteristic(this.platform.Characteristic.Name, room.name);
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.lastKnownOn);
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.lastKnownVolume);
    if (previousName !== room.name) {
      this.logger.info(`Renamed virtual room accessory from "${previousName}" to "${room.name}".`);
    }
  }

  private handleBrightnessGet(): CharacteristicValue {
    this.queueRefresh();
    return this.lastKnownVolume;
  }

  private async handleBrightnessSet(value: CharacteristicValue): Promise<void> {
    const nextVolume = Math.max(0, Math.min(this.room.maxVolume, Math.round(Number(value))));
    const mutationId = this.beginMutation();
    this.logger.info(`HomeKit requested brightness=${nextVolume} for "${this.room.name}".`);
    try {
      if (nextVolume > 0) {
        this.lastKnownActiveVolume = nextVolume;
        if (this.applyMutationState(
          await this.platform.setVirtualRoomVolume(this.room.id, nextVolume),
          mutationId,
          `brightness=${nextVolume}`,
        )) {
          this.logger.info(
            `Applied brightness change for "${this.room.name}": on=${this.lastKnownOn}, volume=${this.lastKnownVolume}, muted=${this.lastKnownMuted}.`,
          );
        }
        return;
      }

      if (this.lastKnownVolume > 0) {
        this.lastKnownActiveVolume = this.lastKnownVolume;
      }
      if (this.applyMutationState(
        await this.platform.setVirtualRoomVolume(this.room.id, 0),
        mutationId,
        `brightness=${nextVolume}`,
      )) {
        this.logger.info(
          `Applied brightness change for "${this.room.name}": on=${this.lastKnownOn}, volume=${this.lastKnownVolume}, muted=${this.lastKnownMuted}.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to set brightness for "${this.room.name}": ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      this.endMutation();
    }
  }

  private handleOnGet(): CharacteristicValue {
    this.queueRefresh();
    return this.lastKnownOn;
  }

  private async handleOnSet(value: CharacteristicValue): Promise<void> {
    const nextOn = value === true;
    const mutationId = this.beginMutation();
    this.logger.info(`HomeKit requested on=${nextOn} for "${this.room.name}".`);
    try {
      if (nextOn) {
        if (this.applyMutationState(
          await this.platform.activateVirtualRoom(this.room.id, this.lastKnownActiveVolume),
          mutationId,
          `on=${nextOn}`,
        )) {
          this.logger.info(
            `Applied on-state change for "${this.room.name}": on=${this.lastKnownOn}, volume=${this.lastKnownVolume}, muted=${this.lastKnownMuted}.`,
          );
        }
        return;
      }

      if (this.lastKnownVolume > 0) {
        this.lastKnownActiveVolume = this.lastKnownVolume;
      }
      if (this.applyMutationState(
        await this.platform.deactivateVirtualRoom(this.room.id),
        mutationId,
        `on=${nextOn}`,
      )) {
        this.logger.info(
          `Applied on-state change for "${this.room.name}": on=${this.lastKnownOn}, volume=${this.lastKnownVolume}, muted=${this.lastKnownMuted}.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to set on=${nextOn} for "${this.room.name}": ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      this.endMutation();
    }
  }

  private queueRefresh(): void {
    if (!this.platform.isInitialDiscoveryComplete() || this.refreshInFlight || this.activeMutations > 0) {
      return;
    }

    this.refreshInFlight = this.refreshFromPlatform()
      .catch((error) => {
        this.logger.warn(
          `State refresh failed for "${this.room.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      })
      .finally(() => {
        this.refreshInFlight = undefined;
      });
  }

  private async refreshFromPlatform(): Promise<void> {
    this.applyState(await this.platform.getVirtualRoomState(this.room.id));
    this.logger.debug(
      `Refreshed "${this.room.name}" state: on=${this.lastKnownOn}, volume=${this.lastKnownVolume}, muted=${this.lastKnownMuted}.`,
    );
  }

  private beginMutation(): number {
    this.activeMutations += 1;
    this.latestMutationId += 1;
    return this.latestMutationId;
  }

  private endMutation(): void {
    this.activeMutations = Math.max(0, this.activeMutations - 1);
  }

  private applyMutationState(state: VirtualRoomState, mutationId: number, label: string): boolean {
    if (mutationId !== this.latestMutationId) {
      this.logger.debug(`Ignoring stale "${label}" result for "${this.room.name}".`);
      return false;
    }

    this.applyState(state);
    return true;
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
