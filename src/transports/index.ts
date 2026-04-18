import { normalizePlatformConfig } from "../config";
import type { ScenesPlatformConfig, SonosTransport } from "../types";
import { LocalSonosTransport } from "./localTransport";

export function createTransport(configInput: Partial<ScenesPlatformConfig> | undefined): SonosTransport {
  const config = normalizePlatformConfig(configInput);

  if (config.transport.kind === "local") {
    return new LocalSonosTransport(config.transport);
  }

  throw new Error(`Unsupported transport kind: ${(config.transport as { kind?: string }).kind ?? "unknown"}`);
}
