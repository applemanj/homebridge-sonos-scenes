import { normalizePlatformConfig } from "../config";
import type { StructuredLogger } from "../logger";
import type { ScenesPlatformConfig, SonosTransport } from "../types";
import { HybridSonosTransport } from "./hybridTransport";
import { LocalSonosTransport } from "./localTransport";

export function createTransport(
  configInput: Partial<ScenesPlatformConfig> | undefined,
  logger?: StructuredLogger,
): SonosTransport {
  const config = normalizePlatformConfig(configInput);

  if (config.transport.kind === "local") {
    const localTransport = new LocalSonosTransport(config.transport, logger?.child("transport"));

    if (config.cloud.mode === "local_plus_cloud") {
      return new HybridSonosTransport(localTransport, config.cloud.broker, logger?.child("transport"));
    }

    return localTransport;
  }

  throw new Error(`Unsupported transport kind: ${(config.transport as { kind?: string }).kind ?? "unknown"}`);
}
