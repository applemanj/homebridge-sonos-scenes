import assert from "node:assert/strict";
import test from "node:test";
import { SceneSpeakerAccessory } from "../src/accessories/sceneSpeaker";
import { SceneSwitchAccessory } from "../src/accessories/sceneSwitch";
import { VirtualRoomSpeakerAccessory } from "../src/accessories/virtualRoomSpeaker";
import type { SceneDefinition, VirtualRoomDefinition, VirtualRoomState } from "../src/types";

class FakeCharacteristicHandle {
  private getHandler?: () => unknown;
  private setHandler?: (value: unknown) => unknown;

  onGet(handler: () => unknown): this {
    this.getHandler = handler;
    return this;
  }

  onSet(handler: (value: unknown) => unknown): this {
    this.setHandler = handler;
    return this;
  }

  invokeGet(): unknown {
    return this.getHandler?.();
  }

  invokeSet(value: unknown): unknown {
    return this.setHandler?.(value);
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

function buildVirtualRoom(name: string): VirtualRoomDefinition {
  return {
    id: `virtual-room-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    householdId: "household-1",
    ampPlayerId: "amp-1",
    channel: "left",
    defaultVolume: 30,
    maxVolume: 100,
    onBehavior: { kind: "restore_last" },
    offBehavior: { kind: "mute" },
    lastActiveBehavior: { kind: "none" },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
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

test("VirtualRoomSpeakerAccessory ignores stale overlapping brightness results", async () => {
  const accessory = new FakeAccessory();
  const room = buildVirtualRoom("Kitchen");
  const first = createDeferred<VirtualRoomState>();
  const second = createDeferred<VirtualRoomState>();
  let callCount = 0;
  const platform = {
    ...fakePlatform,
    setVirtualRoomVolume: async () => {
      callCount += 1;
      return callCount === 1 ? first.promise : second.promise;
    },
    activateVirtualRoom: async () => ({ on: true, volume: 30, muted: false }),
    deactivateVirtualRoom: async () => ({ on: false, volume: 0, muted: true }),
    getVirtualRoomState: async () => ({ on: false, volume: 0, muted: true }),
  } as any;

  const wrapper = new VirtualRoomSpeakerAccessory(platform, accessory as any, room);
  const service = accessory.getService(fakePlatform.Service.Lightbulb)!;
  const brightness = service.getCharacteristic(fakePlatform.Characteristic.Brightness);

  const firstSet = Promise.resolve(brightness.invokeSet(39));
  const secondSet = Promise.resolve(brightness.invokeSet(57));

  second.resolve({ on: true, volume: 57, muted: false });
  await secondSet;
  assert.equal(service.values.get(fakePlatform.Characteristic.Brightness), 57);

  first.resolve({ on: true, volume: 39, muted: false });
  await firstSet;
  assert.equal(service.values.get(fakePlatform.Characteristic.Brightness), 57);
});
