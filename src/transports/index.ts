import { normalizePlatformConfig } from "../config";
import type { StructuredLogger } from "../logger";
import type { ScenesPlatformConfig, SonosTransport } from "../types";
import { LocalSonosTransport } from "./localTransport";

export function createTransport(
  configInput: Partial<ScenesPlatformConfig> | undefined,
  logger?: StructuredLogger,
): SonosTransport {
  const config = normalizePlatformConfig(configInput);

  if (config.transport.kind === "local") {
    return new LocalSonosTransport(config.transport, logger?.child("transport"));
  }

  throw new Error(`Unsupported transport kind: ${(config.transport as { kind?: string }).kind ?? "unknown"}`);
}
