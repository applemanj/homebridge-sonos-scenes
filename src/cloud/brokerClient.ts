import type { CloudBrokerConfig } from "../types";

export type CloudBrokerFeature = "favorites" | "playlists";

export interface CloudBrokerStatus {
  ok: boolean;
  name?: string;
  version?: string;
  features: CloudBrokerFeature[];
  docsUrl?: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

export class CloudBrokerClient {
  constructor(private readonly config: CloudBrokerConfig) {}

  get configured(): boolean {
    return typeof this.config.url === "string" && this.config.url.trim().length > 0;
  }

  get baseUrl(): string | undefined {
    if (!this.configured) {
      return undefined;
    }

    return trimTrailingSlash(this.config.url!.trim());
  }

  async getStatus(): Promise<CloudBrokerStatus> {
    return this.request<CloudBrokerStatus>("/v1/status", {
      method: "GET",
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.baseUrl) {
      throw new Error("No cloud broker URL is configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(this.config.apiKey
            ? {
                Authorization: `Bearer ${this.config.apiKey}`,
              }
            : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Cloud broker request failed: ${response.status} ${response.statusText}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
