import { validateSceneDefinition } from "./config";
import { DiscoveryService } from "./discoveryService";
import { MemoryLogCollector, StructuredLogger } from "./logger";
import type {
  SceneDefinition,
  SceneLogEntry,
  SceneRunResult,
  SceneTrigger,
  SonosTransport,
  TopologySnapshot,
} from "./types";

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SceneRunner {
  private queues = new Map<string, Promise<SceneRunResult>>();

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly transport: SonosTransport,
    private readonly logger: StructuredLogger,
  ) {}

  runOn(scene: SceneDefinition): Promise<SceneRunResult> {
    return this.enqueue(scene, "on");
  }

  runOff(scene: SceneDefinition): Promise<SceneRunResult> {
    return this.enqueue(scene, "off");
  }

  runTest(scene: SceneDefinition): Promise<SceneRunResult> {
    return this.enqueue(scene, "test");
  }

  private enqueue(scene: SceneDefinition, trigger: SceneTrigger): Promise<SceneRunResult> {
    const queueKey = `${scene.householdId}:${scene.coordinatorPlayerId || scene.id}`;
    const previous = this.queues.get(queueKey) ?? Promise.resolve({
      ok: true,
      sceneId: scene.id,
      trigger,
      logs: [],
      errors: [],
    } satisfies SceneRunResult);

    const next = previous
      .catch(() => undefined)
      .then(() => this.execute(scene, trigger))
      .finally(() => {
        if (this.queues.get(queueKey) === next) {
          this.queues.delete(queueKey);
        }
      });

    this.queues.set(queueKey, next);
    return next;
  }

  private async execute(scene: SceneDefinition, trigger: SceneTrigger): Promise<SceneRunResult> {
    const collector = new MemoryLogCollector();
    const logger = this.logger.child(scene.id);
    const scopedLogger = new StructuredLogger(`scene:${scene.id}`, "debug", undefined, collector);
    const errors: string[] = [];

    const log = (level: "debug" | "info" | "warn" | "error", message: string): void => {
      scopedLogger[level](message);
      logger[level](message);
    };

    log("info", `Running scene "${scene.name}" (${trigger}).`);

    try {
      const snapshot = await this.discoveryService.refresh();
      const validation = validateSceneDefinition(scene, snapshot, this.transport);
      if (!validation.valid) {
        throw new Error(validation.errors.join(" "));
      }

      if (validation.warnings.length > 0) {
        for (const warning of validation.warnings) {
          log("warn", warning);
        }
      }

      if (trigger === "off") {
        await this.executeOff(scene, log);
        log("info", `Scene "${scene.name}" off action complete.`);
        return this.result(true, scene.id, trigger, collector.entries, errors, snapshot);
      }

      await this.executeOn(scene, log);
      log("info", `Scene "${scene.name}" complete.`);
      return this.result(true, scene.id, trigger, collector.entries, errors, snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      log("error", message);
      return this.result(false, scene.id, trigger, collector.entries, errors);
    }
  }

  private result(
    ok: boolean,
    sceneId: string,
    trigger: SceneTrigger,
    logs: SceneLogEntry[],
    errors: string[],
    snapshot?: TopologySnapshot,
  ): SceneRunResult {
    return {
      ok,
      sceneId,
      trigger,
      logs,
      errors,
      snapshot,
    };
  }

  private async executeOn(
    scene: SceneDefinition,
    log: (level: "debug" | "info" | "warn" | "error", message: string) => void,
  ): Promise<void> {
    log("info", `Resolved coordinator: ${scene.coordinatorPlayerId}`);
    await this.withRetry(scene, "group members", () =>
      this.transport.setGroupMembers(scene.householdId, scene.coordinatorPlayerId, scene.memberPlayerIds),
    );
    log("info", `Grouped members: ${scene.memberPlayerIds.join(", ") || "none"}`);

    await sleep(scene.settleMs);

    if (scene.source?.kind === "favorite") {
      const source = scene.source;
      await this.withRetry(scene, `load favorite ${source.favoriteId}`, () =>
        this.transport.loadFavorite(scene.householdId, scene.coordinatorPlayerId, source.favoriteId),
      );
      log("info", `Selected favorite: ${source.favoriteId}`);
      await sleep(scene.settleMs);
    }

    if (scene.source?.kind === "line_in") {
      const source = scene.source;
      await this.withRetry(scene, `load line-in ${scene.source.deviceId}`, () =>
        this.transport.loadLineIn(
          scene.householdId,
          scene.coordinatorPlayerId,
          source.deviceId,
          source.playOnCompletion,
        ),
      );
      log("info", `Selected source: line_in (${source.deviceId})`);
      await sleep(scene.settleMs);
    }

    if (scene.source?.kind === "tv") {
      const source = scene.source;
      if (!this.transport.loadTv) {
        throw new Error("The active transport does not implement TV source loading.");
      }
      await this.withRetry(scene, `load TV ${scene.source.deviceId}`, () =>
        this.transport.loadTv!(
          scene.householdId,
          scene.coordinatorPlayerId,
          source.deviceId,
          source.playOnCompletion,
        ),
      );
      log("info", `Selected source: tv (${source.deviceId})`);
      await sleep(scene.settleMs);
    }

    const requestedVolumes = new Map<string, number>();
    if (scene.coordinatorVolume !== undefined) {
      requestedVolumes.set(scene.coordinatorPlayerId, scene.coordinatorVolume);
    }
    for (const volume of scene.playerVolumes) {
      requestedVolumes.set(volume.playerId, volume.volume);
    }

    await Promise.all(
      Array.from(requestedVolumes.entries()).map(async ([playerId, volume]) => {
        const label = playerId === scene.coordinatorPlayerId && scene.coordinatorVolume !== undefined
          ? `set coordinator volume ${volume}`
          : `set room volume ${playerId}=${volume}`;
        await this.withRetry(scene, label, () =>
          this.transport.setPlayerVolume(scene.householdId, playerId, volume),
        );
        if (playerId === scene.coordinatorPlayerId && scene.coordinatorVolume !== undefined) {
          log("info", `Set coordinator volume: ${playerId}=${volume}`);
        } else {
          log("info", `Set volume: ${playerId}=${volume}`);
        }
      }),
    );
  }

  private async executeOff(
    scene: SceneDefinition,
    log: (level: "debug" | "info" | "warn" | "error", message: string) => void,
  ): Promise<void> {
    if (scene.offBehavior.kind === "none") {
      log("info", "Off behavior is set to none; nothing to do.");
      return;
    }

    if (scene.offBehavior.kind === "ungroup") {
      await this.withRetry(scene, "stop playback", () =>
        this.transport.stopPlayback(scene.householdId, scene.coordinatorPlayerId),
      );
      log("info", `Stopped playback: ${scene.coordinatorPlayerId}`);

      await this.withRetry(scene, "ungroup members", () =>
        this.transport.ungroup(scene.householdId, scene.coordinatorPlayerId, scene.memberPlayerIds),
      );
      log("info", `Ungrouped members: ${scene.memberPlayerIds.join(", ") || "none"}`);
    }
  }

  private async withRetry(scene: SceneDefinition, label: string, action: () => Promise<void>): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= scene.retryCount; attempt++) {
      try {
        await action();
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= scene.retryCount) {
          break;
        }
        await sleep(scene.retryDelayMs);
      }
    }

    throw new Error(
      `${label} failed after ${scene.retryCount + 1} attempt(s): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}
