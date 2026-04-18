import { normalizePlatformConfig, normalizeScene, validateSceneDefinition } from "../config";
import { CloudBrokerClient } from "../cloud/brokerClient";
import { DiscoveryService } from "../discoveryService";
import { MemoryLogCollector, StructuredLogger } from "../logger";
import { SceneRunner } from "../sceneRunner";
import { createTransport } from "../transports";
import type { SceneDefinition, SceneRunResult, ScenesPlatformConfig, TopologySnapshot, ValidationResult } from "../types";

export function createDefaultUiConfig(): ScenesPlatformConfig {
  return normalizePlatformConfig(undefined);
}

async function buildServices(configInput: Partial<ScenesPlatformConfig> | undefined) {
  const config = normalizePlatformConfig(configInput);
  const collector = new MemoryLogCollector();
  const logger = new StructuredLogger("ui", config.logLevel, undefined, collector);
  const transport = createTransport(config);
  const discoveryService = new DiscoveryService(transport);
  const sceneRunner = new SceneRunner(discoveryService, transport, logger);

  return {
    config,
    transport,
    discoveryService,
    sceneRunner,
    collector,
  };
}

export async function discoverForUi(
  configInput: Partial<ScenesPlatformConfig> | undefined,
): Promise<{ snapshot: TopologySnapshot }> {
  const services = await buildServices(configInput);
  return {
    snapshot: await services.discoveryService.refresh(),
  };
}

export async function validateSceneForUi(
  configInput: Partial<ScenesPlatformConfig> | undefined,
  sceneInput: Partial<SceneDefinition>,
): Promise<{ validation: ValidationResult; normalizedScene: SceneDefinition; snapshot: TopologySnapshot }> {
  const services = await buildServices(configInput);
  const snapshot = await services.discoveryService.refresh();
  const normalizedScene = normalizeScene(sceneInput);
  const validation = validateSceneDefinition(normalizedScene, snapshot, services.transport);

  return {
    validation,
    normalizedScene,
    snapshot,
  };
}

export async function runTestForUi(
  configInput: Partial<ScenesPlatformConfig> | undefined,
  sceneInput: Partial<SceneDefinition>,
): Promise<SceneRunResult> {
  const services = await buildServices(configInput);
  const scene = normalizeScene(sceneInput);
  return services.sceneRunner.runTest(scene);
}

export async function checkBrokerForUi(
  configInput: Partial<ScenesPlatformConfig> | undefined,
): Promise<{ configured: boolean; url?: string; status?: Awaited<ReturnType<CloudBrokerClient["getStatus"]>>; error?: string }> {
  const config = normalizePlatformConfig(configInput);
  const client = new CloudBrokerClient(config.cloud.broker);

  if (!client.configured) {
    return {
      configured: false,
    };
  }

  try {
    const status = await client.getStatus();
    return {
      configured: true,
      url: client.baseUrl,
      status,
    };
  } catch (error) {
    return {
      configured: true,
      url: client.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
