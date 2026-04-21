import assert from "node:assert/strict";
import test from "node:test";
import { SceneSpeakerAccessory } from "../src/accessories/sceneSpeaker";
import { SceneSwitchAccessory } from "../src/accessories/sceneSwitch";
import type { SceneDefinition } from "../src/types";

class FakeCharacteristicHandle {
  onGet(_handler: () => unknown): this {
    return this;
  }

  onSet(_handler: (value: unknown) => unknown): this {
    return this;
  }
}

class FakeService {
  readonly values = new Map<unknown, unknown>();
  private readonly characteristics = new Map<unknown, FakeCharacteristicHandle>();

  setCharacteristic(key: unknown, value: unknown): this {
    this.values.set(key, value);
    if (!this.characteristics.has(key)) {
      this.characteristics.set(key, new FakeCharacteristicHandle());
    }
    return this;
  }

  updateCharacteristic(key: unknown, value: unknown): this {
    return this.setCharacteristic(key, value);
  }

  getCharacteristic(key: unknown): FakeCharacteristicHandle {
    if (!this.characteristics.has(key)) {
      this.characteristics.set(key, new FakeCharacteristicHandle());
    }

    return this.characteristics.get(key)!;
  }

  testCharacteristic(key: unknown): boolean {
    return this.characteristics.has(key);
  }

  addCharacteristic(key: unknown): this {
    this.characteristics.set(key, new FakeCharacteristicHandle());
    return this;
  }
}

class FakeAccessory {
  readonly context: Record<string, unknown> = {};
  readonly services = new Map<unknown, FakeService>();
  displayName = "";
  category?: number;

  getService(key: unknown): FakeService | undefined {
    return this.services.get(key);
  }

  addService(key: unknown): FakeService {
    const service = new FakeService();
    this.services.set(key, service);
    return service;
  }

  removeService(service: FakeService): void {
    for (const [key, entry] of this.services.entries()) {
      if (entry === service) {
        this.services.delete(key);
      }
    }
  }
}

const fakePlatform = {
  Service: {
    Switch: "switch",
    Speaker: "speaker",
    Lightbulb: "lightbulb",
    AccessoryInformation: "accessory-information",
  },
  Characteristic: {
    Name: "name",
    ConfiguredName: "configured-name",
    On: "on",
    Brightness: "brightness",
    Manufacturer: "manufacturer",
    Model: "model",
    SerialNumber: "serial-number",
  },
  api: {
    hap: {
      Categories: {
        LIGHTBULB: 5,
      },
    },
  },
  createScopedLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
} as any;

function buildScene(name: string): SceneDefinition {
  return {
    id: `scene-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    householdId: "household-1",
    coordinatorPlayerId: "player-1",
    memberPlayerIds: [],
    playerVolumes: [],
    offBehavior: { kind: "none" },
    settleMs: 750,
    retryCount: 3,
    retryDelayMs: 750,
    autoResetMs: 0,
  };
}

test("SceneSwitchAccessory keeps HomeKit name fields in sync when a scene is renamed", () => {
  const accessory = new FakeAccessory();
  const initialScene = buildScene("Office Bedtime");
  const wrapper = new SceneSwitchAccessory(fakePlatform, accessory as any, initialScene);
  const renamedScene = { ...initialScene, name: "Office Sleep" };

  wrapper.updateScene(renamedScene);

  const service = accessory.getService(fakePlatform.Service.Switch)!;
  assert.equal(accessory.displayName, "Office Sleep");
  assert.equal(service.values.get(fakePlatform.Characteristic.Name), "Office Sleep");
  assert.equal(service.values.get(fakePlatform.Characteristic.ConfiguredName), "Office Sleep");
});

test("SceneSpeakerAccessory keeps HomeKit name fields in sync when a scene is renamed", () => {
  const accessory = new FakeAccessory();
  const initialScene = buildScene("Office Bedtime");
  const wrapper = new SceneSpeakerAccessory(fakePlatform, accessory as any, initialScene);
  const renamedScene = { ...initialScene, name: "Office Sleep" };

  wrapper.updateScene(renamedScene);

  const service = accessory.getService(fakePlatform.Service.Lightbulb)!;
  assert.equal(accessory.displayName, "Office Sleep Volume");
  assert.equal(service.values.get(fakePlatform.Characteristic.Name), "Office Sleep Volume");
  assert.equal(service.values.get(fakePlatform.Characteristic.ConfiguredName), "Office Sleep Volume");
});
