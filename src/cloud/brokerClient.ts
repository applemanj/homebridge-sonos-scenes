import type { CloudBrokerConfig } from "../types";

export type CloudBrokerFeature = "favorites" | "playlists";

export interface CloudBrokerStatus {
  ok: boolean;
  name?: string;
  version?: string;
  features: CloudBrokerFeature[];
  docsUrl?: string;
  mode?: "scaffold" | "live";
  oauthConfigured?: boolean;
  authenticated?: boolean;
  message?: string;
}

export interface CloudBrokerHousehold {
  id: string;
  displayName?: string;
}

export interface CloudBrokerGroup {
  id: string;
  name?: string;
  coordinatorId?: string;
  playerIds?: string[];
}

export interface CloudBrokerFavorite {
  id: string;
  name?: string;
  description?: string;
  imageUrl?: string;
}

export interface CloudBrokerPlaylist {
  id: string;
  name?: string;
  description?: string;
  imageUrl?: string;
}

// Default central broker URL (will be deployed to Azure)
const CENTRAL_BROKER_URL = "https://sonos-scenes-broker.azurewebsites.net";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

export class CloudBrokerClient {
  constructor(private readonly config: CloudBrokerConfig) {}

  get configured(): boolean {
    if (this.config.kind === "central") {
      return true; // Central broker is always available
    }
    // For self-hosted, URL must be configured
    return typeof this.config.url === "string" && this.config.url.trim().length > 0;
  }

  get baseUrl(): string | undefined {
    if (!this.configured) {
      return undefined;
    }

    // Use central broker by default, or self-hosted URL if specified
    const url = this.config.kind === "central" ? CENTRAL_BROKER_URL : this.config.url;
    if (!url) {
      return undefined;
    }

    return trimTrailingSlash(url.trim());
  }

  async getStatus(): Promise<CloudBrokerStatus> {
    return this.request<CloudBrokerStatus>("/v1/status", {
      method: "GET",
    });
  }

  async getHouseholds(): Promise<CloudBrokerHousehold[]> {
    const response = await this.request<{ households?: CloudBrokerHousehold[] } | CloudBrokerHousehold[]>(
      "/v1/households",
      { method: "GET" },
    );
    return Array.isArray(response) ? response : (response.households ?? []);
  }

  async getGroups(householdId: string): Promise<CloudBrokerGroup[]> {
    const response = await this.request<{ groups?: CloudBrokerGroup[] } | CloudBrokerGroup[]>(
      "/v1/households/" + encodeURIComponent(householdId) + "/groups",
      { method: "GET" },
    );
    return Array.isArray(response) ? response : (response.groups ?? []);
  }

  async getFavorites(householdId: string): Promise<CloudBrokerFavorite[]> {
    const response = await this.request<{ favorites?: CloudBrokerFavorite[] } | CloudBrokerFavorite[]>(
      "/v1/households/" + encodeURIComponent(householdId) + "/favorites",
      { method: "GET" },
    );
    return Array.isArray(response) ? response : (response.favorites ?? []);
  }

  async getPlaylists(householdId: string): Promise<CloudBrokerPlaylist[]> {
    const response = await this.request<{ playlists?: CloudBrokerPlaylist[] } | CloudBrokerPlaylist[]>(
      "/v1/households/" + encodeURIComponent(householdId) + "/playlists",
      { method: "GET" },
    );
    return Array.isArray(response) ? response : (response.playlists ?? []);
  }

  async loadFavorite(groupId: string, favoriteId: string, action?: string): Promise<void> {
    await this.request("/v1/groups/" + encodeURIComponent(groupId) + "/favorites/load", {
      method: "POST",
      body: JSON.stringify({
        favoriteId,
        action: action || "PLAY_NOW",
      }),
    });
  }

  async loadPlaylist(groupId: string, playlistId: string, action?: string): Promise<void> {
    await this.request("/v1/groups/" + encodeURIComponent(groupId) + "/playlists/load", {
      method: "POST",
      body: JSON.stringify({
        playlistId,
        action: action || "PLAY_NOW",
      }),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.baseUrl) {
      throw new Error("No cloud broker URL is configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      let authHeader: string | undefined;
      if (this.config.apiKey) {
        authHeader = "Bearer " + this.config.apiKey;
      }

      const response = await fetch(this.baseUrl + path, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        let message: string;
        try {
          const parsed = JSON.parse(errorBody);
          message = parsed.message || parsed.error || response.status + " " + response.statusText;
        } catch {
          message = response.status + " " + response.statusText;
        }
        throw new Error("Cloud broker request failed: " + message);
      }

      if (response.status === 204 || response.headers.get("content-length") === "0") {
        return undefined as T;
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
