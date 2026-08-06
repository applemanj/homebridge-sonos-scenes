import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.BROKER_DATA_DIR || "./data";
const KEYS_FILE = join(DATA_DIR, "keys.json");

// Shape: { [userId]: { keyHash, label, createdAt, lastUsedAt } }
let cache = null;

async function ensureDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(KEYS_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("[keyStore] failed to read keys.json:", error.message);
    }
    cache = {};
  }
  return cache;
}

async function persist() {
  await ensureDir();
  await fs.writeFile(KEYS_FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

function hashKey(apiKey) {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

/**
 * Create a new user with a freshly minted broker API key.
 * Returns { userId, apiKey } — apiKey is only available here, at creation time.
 */
export async function createUserKey(label = "default") {
  const store = await load();
  const userId = randomBytes(12).toString("hex"); // 24 hex chars
  const apiKey = "ssk_" + randomBytes(24).toString("hex"); // 52 chars

  store[userId] = {
    keyHash: hashKey(apiKey),
    label,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  await persist();
  return { userId, apiKey };
}

/**
 * Resolve a presented API key to its userId, or null if unknown.
 */
export async function resolveKey(apiKey) {
  if (typeof apiKey !== "string" || apiKey.length === 0) return null;
  const store = await load();
  const presented = hashKey(apiKey);
  for (const [userId, record] of Object.entries(store)) {
    if (record.keyHash === presented) {
      record.lastUsedAt = new Date().toISOString();
      // Persist lazily; don't block the request on it.
      persist().catch(() => {});
      return userId;
    }
  }
  return null;
}

export async function revokeUser(userId) {
  const store = await load();
  if (userId in store) {
    delete store[userId];
    await persist();
    return true;
  }
  return false;
}

export async function userExists(userId) {
  const store = await load();
  return userId in store;
}

export async function countUsers() {
  const store = await load();
  return Object.keys(store).length;
}
