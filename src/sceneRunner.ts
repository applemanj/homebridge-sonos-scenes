import { validateSceneDefinition } from "./config";
import { DiscoveryService } from "./discoveryService";
import { MemoryLogCollector, StructuredLogger } from "./logger";
import type {
  SceneDefinition,
  SceneLogEntry,
  SceneRunResult,
  SceneTrigger,
  SonosGroup,
  SonosTransport,
  TopologySnapshot,
} from "./types";

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PreviousPlayerAudioState {
  playerId: string;
  volume: number;
  muted: boolean;
}

interface PreviousGroupState {
  coordinatorPlayerId: string;
  playerIds: string[];
}

interface PreviousSceneState {
  householdId: string;
  groups: PreviousGroupState[];
  players: PreviousPlayerAudioState[];
}

export class SceneRunner {
  private queues = new Map<string, Promise<SceneRunResult>>();
  private previousSceneStates = new Map<string, PreviousSceneState>();

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

      if (trigger === "on" && scene.offBehavior.kind === "restore_previous") {
        await this.capturePreviousSceneState(scene, snapshot, log);
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

    const selectedPlayerIds = new Set([scene.coordinatorPlayerId, ...scene.memberPlayerIds, ...requestedVolumes.keys()]);

    await Promise.all(
      Array.from(selectedPlayerIds).map(async (playerId) => {
        const volume = requestedVolumes.get(playerId);
        if (volume === undefined) {
          await this.withRetry(scene, `unmute room ${playerId}`, () =>
            this.transport.setPlayerMuted(scene.householdId, playerId, false),
          );
          log("info", `Unmuted room: ${playerId}`);
          return;
        }

        const label = playerId === scene.coordinatorPlayerId && scene.coordinatorVolume !== undefined
          ? `set coordinator volume ${volume}`
          : `set room volume ${playerId}=${volume}`;
        await this.withRetry(scene, label, async () => {
          await this.transport.setPlayerVolume(scene.householdId, playerId, volume);
          await this.transport.setPlayerMuted(scene.householdId, playerId, false);
        });
        if (playerId === scene.coordinatorPlayerId && scene.coordinatorVolume !== undefined) {
          log("info", `Set coordinator volume and unmuted: ${playerId}=${volume}`);
        } else {
          log("info", `Set volume and unmuted: ${playerId}=${volume}`);
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

    if (scene.offBehavior.kind === "pause") {
      await this.withRetry(scene, "pause playback", () =>
        this.transport.pausePlayback(scene.householdId, scene.coordinatorPlayerId),
      );
      log("info", `Paused playback: ${scene.coordinatorPlayerId}`);
      return;
    }

    if (scene.offBehavior.kind === "stop") {
      await this.withRetry(scene, "stop playback", () =>
        this.transport.stopPlayback(scene.householdId, scene.coordinatorPlayerId),
      );
      log("info", `Stopped playback: ${scene.coordinatorPlayerId}`);
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
      return;
    }

    if (scene.offBehavior.kind === "restore_previous") {
      await this.restorePreviousSceneState(scene, log);
    }
  }

  private async capturePreviousSceneState(
    scene: SceneDefinition,
    snapshot: TopologySnapshot,
    log: (level: "debug" | "info" | "warn" | "error", message: string) => void,
  ): Promise<void> {
    const selectedPlayerIds = this.scenePlayerIds(scene);
    const household = snapshot.households.find((item) => item.id === scene.householdId);
    if (!household) {
      log("warn", "Could not capture previous state because the household was not found.");
      return;
    }

    const groups = this.groupsTouchingPlayers(household.groups, selectedPlayerIds).map((group) => ({
      coordinatorPlayerId: group.coordinatorId,
      playerIds: group.playerIds,
    }));

    const playerResults = await Promise.allSettled(
      selectedPlayerIds.map(async (playerId): Promise<PreviousPlayerAudioState> => ({
        playerId,
        volume: await this.transport.getPlayerVolume(scene.householdId, playerId),
        muted: await this.transport.getPlayerMuted(scene.householdId, playerId),
      })),
    );

    const players: PreviousPlayerAudioState[] = [];
    for (const [index, result] of playerResults.entries()) {
      if (result.status === "fulfilled") {
        players.push(result.value);
        continue;
      }

      log(
        "warn",
        `Could not capture previous volume state for ${selectedPlayerIds[index]}: ${
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        }`,
      );
    }

    this.previousSceneStates.set(scene.id, {
      householdId: scene.householdId,
      groups,
      players,
    });
    log(
      "info",
      `Captured previous state for restore: ${groups.length} group(s), ${players.length} volume/mute value(s).`,
    );
  }

  private async restorePreviousSceneState(
    scene: SceneDefinition,
    log: (level: "debug" | "info" | "warn" | "error", message: string) => void,
  ): Promise<void> {
    const previous = this.previousSceneStates.get(scene.id);

    await this.withRetry(scene, "stop playback", () =>
      this.transport.stopPlayback(scene.householdId, scene.coordinatorPlayerId),
    );
    log("info", `Stopped playback: ${scene.coordinatorPlayerId}`);

    if (!previous) {
      log("warn", "No previous state was captured for this scene. Stopped playback, but could not restore grouping or volume.");
      return;
    }

    for (const group of previous.groups) {
      const memberPlayerIds = group.playerIds.filter((playerId) => playerId !== group.coordinatorPlayerId);
      await this.withRetry(scene, `restore group ${group.coordinatorPlayerId}`, () =>
        this.transport.setGroupMembers(previous.householdId, group.coordinatorPlayerId, memberPlayerIds),
      );
      log("info", `Restored group: ${group.coordinatorPlayerId} with ${memberPlayerIds.join(", ") || "no members"}`);
    }

    await Promise.all(
      previous.players.map(async (player) => {
        await this.withRetry(scene, `restore volume ${player.playerId}`, async () => {
          await this.transport.setPlayerVolume(previous.householdId, player.playerId, player.volume);
          await this.transport.setPlayerMuted(previous.householdId, player.playerId, player.muted);
        });
        log("info", `Restored volume and mute: ${player.playerId}=${player.volume}, muted=${player.muted}`);
      }),
    );

    this.previousSceneStates.delete(scene.id);
  }

  private scenePlayerIds(scene: SceneDefinition): string[] {
    return Array.from(new Set([
      scene.coordinatorPlayerId,
      ...scene.memberPlayerIds,
      ...scene.playerVolumes.map((item) => item.playerId),
    ].filter(Boolean)));
  }

  private groupsTouchingPlayers(groups: SonosGroup[], playerIds: string[]): SonosGroup[] {
    const selected = new Set(playerIds);
    const restoredGroupIds = new Set<string>();
    const matched: SonosGroup[] = [];

    for (const group of groups) {
      if (!group.playerIds.some((playerId) => selected.has(playerId)) || restoredGroupIds.has(group.id)) {
        continue;
      }

      restoredGroupIds.add(group.id);
      matched.push(group);
    }

    return matched;
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
