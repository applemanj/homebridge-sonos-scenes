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

  // Test 1: Token Store
  console.log("Test 1: Token Store (Encryption)");
  try {
    await mkdir(dataDir, { recursive: true });

    const tokenStore = await import("./src/tokenStore.mjs");

    const testTokens = {
      accessToken: "test-access-token-12345",
      refreshToken: "test-refresh-token-67890",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    await tokenStore.saveTokens(testTokens);
    console.log("  ✓ Tokens saved and encrypted");

    const retrieved = await tokenStore.getTokens();
    if (
      retrieved.accessToken !== testTokens.accessToken ||
      retrieved.refreshToken !== testTokens.refreshToken
    ) {
      throw new Error("Retrieved tokens do not match");
    }
    console.log("  ✓ Tokens decrypted correctly");

    const isExpired = await tokenStore.isExpired();
    if (isExpired) {
      throw new Error("Tokens should not be expired");
    }
    console.log("  ✓ Token expiry check works");

    const authenticated = await tokenStore.isAuthenticated();
    if (!authenticated) {
      throw new Error("Should be authenticated");
    }
    console.log("  ✓ Authentication check works");

    await tokenStore.clearTokens();
    const afterClear = await tokenStore.getTokens();
    if (afterClear !== null) {
      throw new Error("Tokens should be cleared");
    }
    console.log("  ✓ Token clearing works\n");
  } catch (error) {
    console.error(`  ✗ Failed: ${error.message}\n`);
    process.exit(1);
  }

  // Test 2: OAuth State Management
  console.log("Test 2: OAuth State Management");
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
    console.log("  ✓ State is single-use (consumed after validation)");

    if (validateState("invalid-state")) {
      throw new Error("Invalid state should not validate");
    }
    console.log("  ✓ Invalid state is rejected\n");
  } catch (error) {
    console.error(`  ✗ Failed: ${error.message}\n`);
    process.exit(1);
  }

  // Test 3: OAuth Configuration
  console.log("Test 3: OAuth Configuration");
  try {
    const { isConfigured, generateState, getLoginUrl } = await import(
      "./src/oauth.mjs"
    );

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

  // Test 4: Sonos API Module Structure
  console.log("Test 4: Sonos API Module Structure");
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
