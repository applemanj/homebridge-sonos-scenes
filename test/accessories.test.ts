import assert from "node:assert/strict";
import test from "node:test";
import { SceneSpeakerAccessory } from "../src/accessories/sceneSpeaker";
import { SceneSwitchAccessory } from "../src/accessories/sceneSwitch";
import { VirtualRoomSpeakerAccessory } from "../src/accessories/virtualRoomSpeaker";
import { SonosScenesPlatform } from "../src/platform";
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
  isInitialDiscoveryComplete: () => false,
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

async function waitForAsyncHandlers(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
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

test("SceneSwitchAccessory can be marked off by topology reconciliation", async () => {
  const accessory = new FakeAccessory();
  const scene = buildScene("Office Bedtime");
  const platform = {
    ...fakePlatform,
    runScene: async () => ({
      ok: true,
      sceneId: scene.id,
      trigger: "on",
      logs: [],
      errors: [],
    }),
  } as any;
  const wrapper = new SceneSwitchAccessory(platform, accessory as any, scene);
  const service = accessory.getService(fakePlatform.Service.Switch)!;

  await service.getCharacteristic(fakePlatform.Characteristic.On).invokeSet(true);
  assert.equal(wrapper.isOn(), true);

  wrapper.markOffFromReconciliation("group changed");

  assert.equal(wrapper.isOn(), false);
  assert.equal(service.values.get(fakePlatform.Characteristic.On), false);
});

test("SceneSwitchAccessory reports on immediately while a scene run is pending", async () => {
  const accessory = new FakeAccessory();
  const scene = buildScene("Office Bedtime");
  const run = createDeferred<any>();
  const platform = {
    ...fakePlatform,
    runScene: async () => run.promise,
  } as any;
  const wrapper = new SceneSwitchAccessory(platform, accessory as any, scene);
  const service = accessory.getService(fakePlatform.Service.Switch)!;

  service.getCharacteristic(fakePlatform.Characteristic.On).invokeSet(true);

  assert.equal(wrapper.isOn(), true);
  assert.equal(service.values.get(fakePlatform.Characteristic.On), true);

  run.resolve({
    ok: true,
    sceneId: scene.id,
    trigger: "on",
    logs: [],
    errors: [],
  });
  await waitForAsyncHandlers();

  assert.equal(wrapper.isOn(), true);
  assert.equal(service.values.get(fakePlatform.Characteristic.On), true);
});

test("SceneSwitchAccessory exposes settling state while a scene run is pending", async () => {
  const accessory = new FakeAccessory();
  const scene = buildScene("Office Bedtime");
  const run = createDeferred<any>();
  const platform = {
    ...fakePlatform,
    runScene: async () => run.promise,
  } as any;
  const wrapper = new SceneSwitchAccessory(platform, accessory as any, scene);
  const service = accessory.getService(fakePlatform.Service.Switch)!;

  service.getCharacteristic(fakePlatform.Characteristic.On).invokeSet(true);

  assert.equal(wrapper.isSettling(), true);

  run.resolve({
    ok: true,
    sceneId: scene.id,
    trigger: "on",
    logs: [],
    errors: [],
  });
  await waitForAsyncHandlers();

  assert.equal(wrapper.isSettling(), false);
});

test("SceneSwitchAccessory ignores stale on completion after the switch is turned off", async () => {
  const accessory = new FakeAccessory();
  const scene = buildScene("Office Bedtime");
  const runs: Array<{ trigger: string; deferred: ReturnType<typeof createDeferred<any>> }> = [];
  const platform = {
    ...fakePlatform,
    runScene: async (_sceneId: string, trigger: string) => {
      const deferred = createDeferred<any>();
      runs.push({ trigger, deferred });
      return deferred.promise;
    },
  } as any;
  const wrapper = new SceneSwitchAccessory(platform, accessory as any, scene);
  const service = accessory.getService(fakePlatform.Service.Switch)!;

  service.getCharacteristic(fakePlatform.Characteristic.On).invokeSet(true);
  service.getCharacteristic(fakePlatform.Characteristic.On).invokeSet(false);

  assert.deepEqual(runs.map((run) => run.trigger), ["on", "off"]);
  assert.equal(wrapper.isOn(), false);
  assert.equal(service.values.get(fakePlatform.Characteristic.On), false);

  runs[0].deferred.resolve({
    ok: true,
    sceneId: scene.id,
    trigger: "on",
    logs: [],
    errors: [],
  });
  await waitForAsyncHandlers();

  assert.equal(wrapper.isOn(), false);
  assert.equal(service.values.get(fakePlatform.Characteristic.On), false);

  runs[1].deferred.resolve({
    ok: true,
    sceneId: scene.id,
    trigger: "off",
    logs: [],
    errors: [],
  });
  await waitForAsyncHandlers();

  assert.equal(wrapper.isOn(), false);
  assert.equal(service.values.get(fakePlatform.Characteristic.On), false);
});

test("SonosScenesPlatform skips reconciliation for scene switches that are still settling", async () => {
  const scene = buildScene("Office Bedtime");
  let refreshed = false;
  let markedOff = false;
  const platform = {
    switchAccessories: new Map([
      [
        scene.id,
        {
          isOn: () => true,
          isSettling: () => true,
          markOffFromReconciliation: () => {
            markedOff = true;
          },
        },
      ],
    ]),
    sceneReconciliationRunning: false,
    discoveryService: {
      refresh: async () => {
        refreshed = true;
        return { capturedAt: new Date().toISOString(), origin: "fixture", households: [] };
      },
    },
    getScene: () => scene,
    logger: {
      info: () => undefined,
      warn: () => undefined,
    },
  };

  await (SonosScenesPlatform.prototype as any).reconcileSceneSwitchStates.call(platform);

  assert.equal(refreshed, false);
  assert.equal(markedOff, false);
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

test("VirtualRoomSpeakerAccessory coalesces overlapping brightness requests to the latest target", async () => {
  const accessory = new FakeAccessory();
  const room = buildVirtualRoom("Kitchen");
  const first = createDeferred<VirtualRoomState>();
  const second = createDeferred<VirtualRoomState>();
  const secondCallFired = createDeferred<void>();
  const callTargets: number[] = [];
  const platform = {
    ...fakePlatform,
    setVirtualRoomVolume: async (_roomId: string, volume: number) => {
      callTargets.push(volume);
      if (callTargets.length === 1) {
        return first.promise;
      }

      secondCallFired.resolve();
      return second.promise;
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

  assert.equal(service.values.get(fakePlatform.Characteristic.Brightness), 57);
  assert.deepEqual(callTargets, [39]);

  first.resolve({ on: true, volume: 39, muted: false });
  await secondCallFired.promise;
  assert.deepEqual(callTargets, [39, 57]);

  second.resolve({ on: true, volume: 57, muted: false });
  await Promise.all([firstSet, secondSet]);
  assert.equal(service.values.get(fakePlatform.Characteristic.Brightness), 57);
});

test("SonosScenesPlatform raises master volume when setting a virtual room above the current master", async () => {
  const room = buildVirtualRoom("Kitchen");
  const calls: string[] = [];
  const fakePlatform = {
    getRequiredVirtualRoom: () => room,
    readVirtualRoomState: async () => ({ on: true, volume: 65, muted: false }),
    prepareVirtualRoomPlayback: (SonosScenesPlatform.prototype as any).prepareVirtualRoomPlayback,
    transport: {
      getPlayerVolume: async () => 12,
      setPlayerVolume: async (_householdId: string, _playerId: string, volume: number) => {
        calls.push(`setPlayerVolume:${volume}`);
      },
      setPlayerChannelVolume: async (
        _householdId: string,
        _playerId: string,
        channel: string,
        volume: number,
      ) => {
        calls.push(`setPlayerChannelVolume:${channel}:${volume}`);
      },
      setPlayerMuted: async (_householdId: string, _playerId: string, muted: boolean) => {
        calls.push(`setPlayerMuted:${muted}`);
      },
      setPlayerChannelMuted: async (
        _householdId: string,
        _playerId: string,
        channel: string,
        muted: boolean,
      ) => {
        calls.push(`setPlayerChannelMuted:${channel}:${muted}`);
      },
    },
  } as any;

  const result = await SonosScenesPlatform.prototype.setVirtualRoomVolume.call(fakePlatform, room.id, 65);

  assert.deepEqual(result, { on: true, volume: 65, muted: false });
  assert.equal(calls.includes("setPlayerVolume:65"), true);
  assert.equal(calls.includes("setPlayerChannelVolume:left:65"), true);
  assert.equal(calls.includes("setPlayerMuted:false"), true);
  assert.equal(calls.includes("setPlayerChannelMuted:left:false"), true);
});

test("SonosScenesPlatform reports effective virtual room volume using the lower of master and channel", async () => {
  const room = buildVirtualRoom("Kitchen");
  const fakePlatform = {
    transport: {
      getPlayerMuted: async () => false,
      getPlayerVolume: async () => 12,
      getPlayerChannelMuted: async () => false,
      getPlayerChannelVolume: async () => 65,
    },
  } as any;

  const state = await (SonosScenesPlatform.prototype as any).readVirtualRoomState.call(fakePlatform, room);

  assert.deepEqual(state, { on: true, volume: 12, muted: false });
});

test("SonosScenesPlatform restores the configured split trim when muting a virtual room off", async () => {
  const room = buildVirtualRoom("Kitchen");
  const calls: string[] = [];
  const fakePlatform = {
    getRequiredVirtualRoom: () => room,
    applyLastActiveBehavior: async () => undefined,
    readVirtualRoomState: async () => ({ on: false, volume: room.defaultVolume, muted: true }),
    transport: {
      setPlayerChannelMuted: async (
        _householdId: string,
        _playerId: string,
        channel: string,
        muted: boolean,
      ) => {
        calls.push(`setPlayerChannelMuted:${channel}:${muted}`);
      },
      setPlayerChannelVolume: async (
        _householdId: string,
        _playerId: string,
        channel: string,
        volume: number,
      ) => {
        calls.push(`setPlayerChannelVolume:${channel}:${volume}`);
      },
    },
  } as any;

  const result = await SonosScenesPlatform.prototype.deactivateVirtualRoom.call(fakePlatform, room.id);

  assert.deepEqual(result, { on: false, volume: room.defaultVolume, muted: true });
  assert.equal(calls.includes("setPlayerChannelMuted:left:true"), true);
  assert.equal(calls.includes(`setPlayerChannelVolume:left:${room.defaultVolume}`), true);
});

test("SonosScenesPlatform restore-last activation prefers the cached fallback when the channel is muted", async () => {
  const room = buildVirtualRoom("Kitchen");
  const calls: string[] = [];
  const fakePlatform = {
    getRequiredVirtualRoom: () => room,
    readVirtualRoomState: async () => ({ on: true, volume: 41, muted: false }),
    prepareVirtualRoomPlayback: async (
      selectedRoom: VirtualRoomDefinition,
      targetVolume: number,
      currentMasterVolume: number,
    ) => {
      calls.push(`prepare:${selectedRoom.id}:${targetVolume}:${currentMasterVolume}`);
    },
    transport: {
      getPlayerChannelVolume: async () => room.defaultVolume,
      getPlayerVolume: async () => 20,
      getPlayerChannelMuted: async () => true,
    },
  } as any;

  const result = await SonosScenesPlatform.prototype.activateVirtualRoom.call(fakePlatform, room.id, 41);

  assert.deepEqual(result, { on: true, volume: 41, muted: false });
  assert.equal(calls.includes(`prepare:${room.id}:41:20`), true);
});
