import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.BROKER_DATA_DIR || "./data";
const TOKENS_DIR = join(DATA_DIR, "tokens");
const KEY_FILE = join(DATA_DIR, ".tokenkey");
const TOKEN_SECRET = process.env.BROKER_TOKEN_SECRET?.trim() || null;

let cachedKey = null;

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

async function getOrCreateKey() {
  if (cachedKey) return cachedKey;

  if (TOKEN_SECRET) {
    cachedKey = scryptSync(TOKEN_SECRET, "sonos-broker-key", 32);
    return cachedKey;
  }

  try {
    const keyData = await fs.readFile(KEY_FILE, "utf8");
    cachedKey = Buffer.from(keyData, "hex");
    return cachedKey;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const newKey = randomBytes(32);
  await ensureDir(DATA_DIR);
  await fs.writeFile(KEY_FILE, newKey.toString("hex"), { mode: 0o600 });
  console.log(`[tokenStore] Generated and persisted new encryption key to ${KEY_FILE}`);
  return newKey;
}

function sanitizeUserId(userId) {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("userId is required");
  }
  // Prevent path traversal; userIds are hex from keyStore, but be defensive.
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (safe.length === 0) {
    throw new Error("userId has no usable characters");
  }
  return safe;
}

function tokenFileFor(userId) {
  return join(TOKENS_DIR, `${sanitizeUserId(userId)}.json`);
}

export async function saveTokens(userId, tokens) {
  await ensureDir(TOKENS_DIR);
  const key = await getOrCreateKey();

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const tokenStr = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    timestamp: Date.now(),
  });

  let encrypted = cipher.update(tokenStr, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  const data = {
    iv: iv.toString("hex"),
    encrypted,
    authTag: authTag.toString("hex"),
  };

  await fs.writeFile(tokenFileFor(userId), JSON.stringify(data), { mode: 0o600 });
}

export async function getTokens(userId) {
  try {
    const data = JSON.parse(await fs.readFile(tokenFileFor(userId), "utf8"));
    const key = await getOrCreateKey();

    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(data.iv, "hex"));
    decipher.setAuthTag(Buffer.from(data.authTag, "hex"));
    let decrypted = decipher.update(data.encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    const parsed = JSON.parse(decrypted);
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    console.error(`[tokenStore] failed to decrypt tokens for user:`, error.message);
    return null;
  }
}

export async function clearTokens(userId) {
  try {
    await fs.unlink(tokenFileFor(userId));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function isExpired(userId) {
  const tokens = await getTokens(userId);
  if (!tokens) return true;
  return Date.now() >= new Date(tokens.expiresAt).getTime();
}

export async function isAuthenticated(userId) {
  const tokens = await getTokens(userId);
  if (!tokens) return false;
  return !(await isExpired(userId));
}
