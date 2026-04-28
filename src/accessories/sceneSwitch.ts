import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import type { SceneDefinition } from "../types";
import type { SonosScenesPlatform } from "../platform";

export class SceneSwitchAccessory {
  private service: Service;
  private scene: SceneDefinition;
  private readonly logger;
  private onState = false;
  private resetTimer?: NodeJS.Timeout;
  private operationToken = 0;
  private pendingOperationToken?: number;

  constructor(
    private readonly platform: SonosScenesPlatform,
    private readonly accessory: PlatformAccessory,
    scene: SceneDefinition,
  ) {
    this.scene = scene;
    this.logger = this.platform.createScopedLogger(`scene-switch:${scene.id}`);
    this.accessory.context.sceneId = scene.id;
    this.accessory.displayName = scene.name;

    this.service =
      this.accessory.getService(this.platform.Service.Switch) ?? this.accessory.addService(this.platform.Service.Switch);
    this.syncServiceName(scene.name);
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
    const previousName = this.scene.name;
    this.scene = scene;
    this.accessory.context.sceneId = scene.id;
    this.accessory.displayName = scene.name;
    this.syncServiceName(scene.name);
    if (previousName !== scene.name) {
      this.logger.info(`Renamed scene switch accessory from "${previousName}" to "${scene.name}".`);
    }
  }

  isOn(): boolean {
    return this.onState;
  }

  isSettling(): boolean {
    return this.pendingOperationToken !== undefined;
  }

  markOffFromReconciliation(reason: string): void {
    if (!this.onState) {
      return;
    }

    this.clearAutoReset();
    this.operationToken += 1;
    this.pendingOperationToken = undefined;
    this.onState = false;
    this.service.updateCharacteristic(this.platform.Characteristic.On, false);
    this.logger.info(`Scene "${this.scene.name}" marked off after Sonos state reconciliation: ${reason}.`);
  }

  private syncServiceName(name: string): void {
    this.service.setCharacteristic(this.platform.Characteristic.Name, name);
    this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);
  }

  private handleOnGet(): CharacteristicValue {
    return this.onState;
  }

  private handleOnSet(value: CharacteristicValue): void {
    const nextState = value === true;
    const token = ++this.operationToken;
    this.pendingOperationToken = token;
    this.logger.info(`HomeKit requested on=${nextState} for scene "${this.scene.name}".`);
    if (nextState) {
      this.clearAutoReset();
      this.onState = true;
      this.service.updateCharacteristic(this.platform.Characteristic.On, true);
      void this.finishOnTrigger(token);
      return;
    }

    this.clearAutoReset();
    this.onState = false;
    this.service.updateCharacteristic(this.platform.Characteristic.On, false);
    void this.finishOffTrigger(token);
  }

  private async finishOnTrigger(token: number): Promise<void> {
    try {
      const result = await this.platform.runScene(this.scene.id, "on");
      if (token !== this.operationToken) {
        this.logger.debug(`Ignoring stale on completion for scene "${this.scene.name}".`);
        return;
      }

      if (!result.ok) {
        this.logger.error(`Scene "${this.scene.name}" failed on trigger: ${result.errors.join(" ")}`);
        this.onState = false;
        this.service.updateCharacteristic(this.platform.Characteristic.On, false);
        return;
      }

      this.onState = true;
      this.service.updateCharacteristic(this.platform.Characteristic.On, true);
      this.logger.info(`Scene "${this.scene.name}" completed on trigger successfully.`);
      this.armAutoReset();
    } catch (error) {
      if (token !== this.operationToken) {
        this.logger.debug(`Ignoring stale on error for scene "${this.scene.name}".`);
        return;
      }

      this.logger.error(`Scene "${this.scene.name}" failed on trigger: ${error instanceof Error ? error.message : String(error)}`);
      this.onState = false;
      this.service.updateCharacteristic(this.platform.Characteristic.On, false);
    } finally {
      this.clearPendingOperation(token);
    }
  }

  private async finishOffTrigger(token: number): Promise<void> {
    try {
      const result = await this.platform.runScene(this.scene.id, "off");
      if (token !== this.operationToken) {
        this.logger.debug(`Ignoring stale off completion for scene "${this.scene.name}".`);
        return;
      }

      if (!result.ok) {
        this.logger.error(`Scene "${this.scene.name}" failed off trigger: ${result.errors.join(" ")}`);
        this.onState = true;
        this.service.updateCharacteristic(this.platform.Characteristic.On, true);
        return;
      }

      this.onState = false;
      this.service.updateCharacteristic(this.platform.Characteristic.On, false);
      this.logger.info(`Scene "${this.scene.name}" completed off trigger successfully.`);
    } catch (error) {
      if (token !== this.operationToken) {
        this.logger.debug(`Ignoring stale off error for scene "${this.scene.name}".`);
        return;
      }

      this.logger.error(`Scene "${this.scene.name}" failed off trigger: ${error instanceof Error ? error.message : String(error)}`);
      this.onState = true;
      this.service.updateCharacteristic(this.platform.Characteristic.On, true);
    } finally {
      this.clearPendingOperation(token);
    }
  }

  private clearPendingOperation(token: number): void {
    if (token === this.pendingOperationToken) {
      this.pendingOperationToken = undefined;
    }
  }

  private armAutoReset(): void {
    this.clearAutoReset();
    if (this.scene.autoResetMs <= 0) {
      return;
    }

    // When the scene has an explicit off action, keep the switch state stable
    // so HomeKit can be used to trigger that off behavior manually.
    if (this.scene.offBehavior.kind !== "none") {
      this.logger.debug(`Auto reset skipped for "${this.scene.name}" because off behavior is enabled.`);
      return;
    }

    this.resetTimer = setTimeout(() => {
      this.onState = false;
      this.service.updateCharacteristic(this.platform.Characteristic.On, false);
      this.resetTimer = undefined;
      this.logger.info(`Auto reset cleared scene switch for "${this.scene.name}".`);
    }, this.scene.autoResetMs);
    this.logger.debug(`Armed auto reset for "${this.scene.name}" in ${this.scene.autoResetMs}ms.`);
  }

  private clearAutoReset(): void {
    if (!this.resetTimer) {
      return;
    }

    clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
  }
}
