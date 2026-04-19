import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import type { SceneDefinition } from "../types";
import type { SonosScenesPlatform } from "../platform";

export class SceneSwitchAccessory {
  private service: Service;
  private scene: SceneDefinition;
  private onState = false;
  private resetTimer?: NodeJS.Timeout;

  constructor(
    private readonly platform: SonosScenesPlatform,
    private readonly accessory: PlatformAccessory,
    scene: SceneDefinition,
  ) {
    this.scene = scene;
    this.accessory.context.sceneId = scene.id;
    this.accessory.displayName = scene.name;

    this.service =
      this.accessory.getService(this.platform.Service.Switch) ?? this.accessory.addService(this.platform.Service.Switch);
    this.service.setCharacteristic(this.platform.Characteristic.Name, scene.name);
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));

    const accessoryInformation =
      this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?? this.accessory.addService(this.platform.Service.AccessoryInformation);

    accessoryInformation
      .setCharacteristic(this.platform.Characteristic.Manufacturer, "homebridge-sonos-scenes")
      .setCharacteristic(this.platform.Characteristic.Model, "Sonos Scene Switch")
      .setCharacteristic(this.platform.Characteristic.SerialNumber, scene.id);
  }

  updateScene(scene: SceneDefinition): void {
    this.scene = scene;
    this.accessory.context.sceneId = scene.id;
    this.accessory.displayName = scene.name;
    this.service.setCharacteristic(this.platform.Characteristic.Name, scene.name);
  }

  private handleOnGet(): CharacteristicValue {
    return this.onState;
  }

  private async handleOnSet(value: CharacteristicValue): Promise<void> {
    const nextState = value === true;
    if (nextState) {
      const result = await this.platform.runScene(this.scene.id, "on");
      if (!result.ok) {
        this.onState = false;
        this.service.updateCharacteristic(this.platform.Characteristic.On, false);
        throw new Error(result.errors.join(" "));
      }

      this.onState = true;
      this.service.updateCharacteristic(this.platform.Characteristic.On, true);
      this.armAutoReset();
      return;
    }

    const result = await this.platform.runScene(this.scene.id, "off");
    if (!result.ok) {
      throw new Error(result.errors.join(" "));
    }

    this.clearAutoReset();
    this.onState = false;
    this.service.updateCharacteristic(this.platform.Characteristic.On, false);
  }

  private armAutoReset(): void {
    this.clearAutoReset();
    if (this.scene.autoResetMs <= 0) {
      return;
    }

    // When the scene has an explicit off action, keep the switch state stable
    // so HomeKit can be used to trigger that off behavior manually.
    if (this.scene.offBehavior.kind !== "none") {
      return;
    }

    this.resetTimer = setTimeout(() => {
      this.onState = false;
      this.service.updateCharacteristic(this.platform.Characteristic.On, false);
      this.resetTimer = undefined;
    }, this.scene.autoResetMs);
  }

  private clearAutoReset(): void {
    if (!this.resetTimer) {
      return;
    }

    clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
  }
}
