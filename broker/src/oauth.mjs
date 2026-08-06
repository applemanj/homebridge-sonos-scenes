import { randomBytes } from "node:crypto";
import { saveTokens, getTokens, clearTokens, isAuthenticated } from "./tokenStore.mjs";

const CLIENT_ID = (process.env.SONOS_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.SONOS_CLIENT_SECRET || "").trim();
const REDIRECT_URI = (process.env.SONOS_REDIRECT_URI || "").trim();

const OAUTH_AUTH_URL = "https://api.sonos.com/login/v3/oauth";
const OAUTH_TOKEN_URL = "https://api.sonos.com/login/v3/oauth/access";

const stateStore = new Map();
const STATE_TTL = 10 * 60 * 1000;

function cleanExpiredStates() {
  const now = Date.now();
  for (const [key, { expiresAt }] of stateStore.entries()) {
    if (now > expiresAt) {
      stateStore.delete(key);
    }
  }
}

export function generateState() {
  cleanExpiredStates();
  const state = randomBytes(32).toString("hex");
  stateStore.set(state, { expiresAt: Date.now() + STATE_TTL });
  return state;
}

export function validateState(state) {
  cleanExpiredStates();
  if (!state || !stateStore.has(state)) {
    return false;
  }
  stateStore.delete(state);
  return true;
}

export function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

export function getLoginUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    state,
    scope: "playback-control-all",
    redirect_uri: REDIRECT_URI,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens. Does NOT persist them —
 * the caller (server) saves them against a specific userId.
 */
export async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OAuth token exchange failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  };
}

export async function refreshAccessToken(userId) {
  const tokens = await getTokens(userId);
  if (!tokens) {
    throw new Error("No tokens to refresh");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OAuth token refresh failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

  await saveTokens(userId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt,
  });

  return { accessToken: data.access_token, expiresAt };
}

export async function getAuthStatus(userId) {
  const authenticated = await isAuthenticated(userId);
  const tokens = authenticated ? await getTokens(userId) : null;
  return {
    authenticated,
    expiresAt: tokens?.expiresAt || null,
  };
}

export async function disconnect(userId) {
  await clearTokens(userId);
  return { ok: true };
}
