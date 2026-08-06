#!/usr/bin/env node

import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

// Set env vars FIRST before importing any modules that read them
const dataDir = "./test-data";
const testTokenSecret = "test-secret-key-for-encryption";

process.env.BROKER_DATA_DIR = dataDir;
process.env.BROKER_TOKEN_SECRET = testTokenSecret;
process.env.SONOS_CLIENT_ID = "test-client-id";
process.env.SONOS_CLIENT_SECRET = "test-client-secret";
process.env.SONOS_REDIRECT_URI = "https://example.com/callback";

async function cleanup() {
  try {
    await rm(dataDir, { recursive: true, force: true });
    console.log("✓ Cleaned up test data directory");
  } catch (error) {
    console.error("Error cleaning up:", error.message);
  }
}

async function runTests() {
  console.log("🧪 Running broker tests...\n");

  // Test 1: Per-user Token Store
  console.log("Test 1: Token Store (per-user, encrypted)");
  try {
    await mkdir(dataDir, { recursive: true });

    const tokenStore = await import("./src/tokenStore.mjs");

    const userA = "user-a-123";
    const userB = "user-b-456";

    const tokensA = {
      accessToken: "access-A",
      refreshToken: "refresh-A",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    const tokensB = {
      accessToken: "access-B",
      refreshToken: "refresh-B",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    await tokenStore.saveTokens(userA, tokensA);
    await tokenStore.saveTokens(userB, tokensB);
    console.log("  ✓ Tokens saved for two users");

    const gotA = await tokenStore.getTokens(userA);
    const gotB = await tokenStore.getTokens(userB);
    if (gotA.accessToken !== "access-A" || gotB.accessToken !== "access-B") {
      throw new Error("Tokens not isolated per user");
    }
    console.log("  ✓ Tokens are isolated per user");

    if (await tokenStore.isExpired(userA)) {
      throw new Error("Tokens should not be expired");
    }
    if (!(await tokenStore.isAuthenticated(userA))) {
      throw new Error("User A should be authenticated");
    }
    console.log("  ✓ Expiry + authentication checks work");

    await tokenStore.clearTokens(userA);
    if ((await tokenStore.getTokens(userA)) !== null) {
      throw new Error("User A tokens should be cleared");
    }
    if ((await tokenStore.getTokens(userB)) === null) {
      throw new Error("User B tokens should be unaffected");
    }
    console.log("  ✓ Clearing one user does not affect another\n");
  } catch (error) {
    console.error(`  ✗ Failed: ${error.message}\n`);
    process.exit(1);
  }

  // Test 2: Key Store
  console.log("Test 2: Key Store (mint, resolve, revoke)");
  try {
    const keyStore = await import("./src/keyStore.mjs");

    const { userId, apiKey } = await keyStore.createUserKey("test");
    if (!userId || !apiKey) {
      throw new Error("createUserKey should return userId and apiKey");
    }
    if (!apiKey.startsWith("ssk_")) {
      throw new Error("API key should have ssk_ prefix");
    }
    console.log("  ✓ User + API key minted");

    const resolved = await keyStore.resolveKey(apiKey);
    if (resolved !== userId) {
      throw new Error("resolveKey should return the userId");
    }
    console.log("  ✓ API key resolves to userId");

    const wrong = await keyStore.resolveKey("ssk_wrong-key");
    if (wrong !== null) {
      throw new Error("Unknown key should not resolve");
    }
    console.log("  ✓ Unknown key rejected");

    if (!(await keyStore.userExists(userId))) {
      throw new Error("userExists should be true");
    }

    await keyStore.revokeUser(userId);
    if (await keyStore.userExists(userId)) {
      throw new Error("User should be revoked");
    }
    if ((await keyStore.resolveKey(apiKey)) !== null) {
      throw new Error("Revoked key should no longer resolve");
    }
    console.log("  ✓ Revocation works\n");
  } catch (error) {
    console.error(`  ✗ Failed: ${error.message}\n`);
    process.exit(1);
  }

  // Test 3: OAuth State Management
  console.log("Test 3: OAuth State Management");
  try {
    const { generateState, validateState } = await import("./src/oauth.mjs");

    const state1 = generateState();
    if (!state1 || state1.length < 32) {
      throw new Error("State should be a long random string");
    }
    console.log("  ✓ State generation works");

    if (!validateState(state1)) {
      throw new Error("Generated state should validate");
    }
    console.log("  ✓ State validation works");

    if (validateState(state1)) {
      throw new Error("State should be single-use");
    }
    console.log("  ✓ State is single-use");

    if (validateState("invalid-state")) {
      throw new Error("Invalid state should not validate");
    }
    console.log("  ✓ Invalid state is rejected\n");
  } catch (error) {
    console.error(`  ✗ Failed: ${error.message}\n`);
    process.exit(1);
  }

  // Test 4: OAuth Configuration
  console.log("Test 4: OAuth Configuration");
  try {
    const { isConfigured, generateState, getLoginUrl } = await import("./src/oauth.mjs");

    if (!isConfigured()) {
      throw new Error("Should be configured with env vars set");
    }
    console.log("  ✓ OAuth configuration detected correctly");

    const state = generateState();
    const loginUrl = getLoginUrl(state);
    if (!loginUrl.includes("client_id=test-client-id")) {
      throw new Error("Login URL should include client_id");
    }
    console.log("  ✓ Login URL generation works\n");
  } catch (error) {
    console.error(`  ✗ Failed: ${error.message}\n`);
    process.exit(1);
  }

  // Test 5: Sonos API Module Structure
  console.log("Test 5: Sonos API Module Structure");
  try {
    const sonosApi = await import("./src/sonosApi.mjs");

    const methods = [
      "getHouseholds",
      "getGroups",
      "getFavorites",
      "getPlaylists",
      "loadFavorite",
      "loadPlaylist",
    ];

    for (const method of methods) {
      if (typeof sonosApi[method] !== "function") {
        throw new Error(`Missing method: ${method}`);
      }
    }
    console.log(`  ✓ All ${methods.length} API methods present\n`);
  } catch (error) {
    console.error(`  ✗ Failed: ${error.message}\n`);
    process.exit(1);
  }

  console.log("✅ All tests passed!");
  process.exit(0);
}

await cleanup();
await runTests();
