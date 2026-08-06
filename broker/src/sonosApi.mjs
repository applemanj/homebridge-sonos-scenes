import { getTokens, isExpired } from "./tokenStore.mjs";
import { refreshAccessToken } from "./oauth.mjs";

const BASE_URL = "https://api.ws.sonos.com/control/api/v1";

async function getAuthToken(userId) {
  const tokens = await getTokens(userId);
  if (!tokens) {
    throw new Error("Not authenticated");
  }

  if (await isExpired(userId)) {
    try {
      await refreshAccessToken(userId);
    } catch (error) {
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  const refreshedTokens = await getTokens(userId);
  return refreshedTokens.accessToken;
}

async function sonosRequest(userId, method, path, body = null, retryCount = 0) {
  try {
    const token = await getAuthToken(userId);
    const url = `${BASE_URL}${path}`;
    const options = {
      method,
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        accept: "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (response.status === 401 && retryCount === 0) {
      await refreshAccessToken(userId);
      return sonosRequest(userId, method, path, body, 1);
    }

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`Sonos API error: ${response.status}`);
      error.statusCode = response.status;
      error.responseBody = text;
      throw error;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    return await response.text();
  } catch (error) {
    if (error.statusCode === 401) {
      throw new Error("Unauthorized: Invalid or expired access token");
    }
    if (error.statusCode === 403) {
      throw new Error("Forbidden: Access denied by Sonos API");
    }
    if (error.statusCode === 404) {
      throw new Error("Not found");
    }
    if (error.statusCode === 429) {
      throw new Error("Rate limited by Sonos API");
    }
    if (error.statusCode >= 500) {
      throw new Error("Sonos API is temporarily unavailable");
    }
    throw error;
  }
}

export async function getHouseholds(userId) {
  return sonosRequest(userId, "GET", "/households");
}

export async function getGroups(userId, householdId) {
  return sonosRequest(userId, "GET", `/households/${householdId}/groups`);
}

export async function getFavorites(userId, householdId) {
  return sonosRequest(userId, "GET", `/households/${householdId}/favorites`);
}

export async function getPlaylists(userId, householdId) {
  return sonosRequest(userId, "GET", `/households/${householdId}/playlists`);
}

export async function loadFavorite(userId, groupId, favoriteId, action = "PLAY_NOW") {
  return sonosRequest(userId, "POST", `/groups/${groupId}/favorites`, {
    favoriteId,
    action,
    playOnCompletion: true,
  });
}

export async function loadPlaylist(userId, groupId, playlistId, action = "PLAY_NOW") {
  return sonosRequest(userId, "POST", `/groups/${groupId}/playlists`, {
    playlistId,
    action,
    playOnCompletion: true,
  });
}
