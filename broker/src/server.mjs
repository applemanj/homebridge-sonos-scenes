import { createServer } from "node:http";
import { URL } from "node:url";
import {
  isConfigured,
  generateState,
  getLoginUrl,
  validateState,
  exchangeCodeForTokens,
  getAuthStatus,
  disconnect,
} from "./oauth.mjs";
import { isAuthenticated } from "./tokenStore.mjs";
import * as sonosApi from "./sonosApi.mjs";

const BROKER_PORT = Number(process.env.BROKER_PORT || 8787);
const BROKER_HOST = process.env.BROKER_HOST || "127.0.0.1";
const BROKER_NAME = process.env.BROKER_NAME || "sonos-scenes-broker";
const BROKER_API_KEY = (process.env.BROKER_API_KEY || "").trim();
const BROKER_DOCS_URL =
  process.env.BROKER_DOCS_URL ||
  "https://github.com/applemanj/homebridge-sonos-scenes/blob/main/docs/cloud-broker.md";

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function writeHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

function bearerToken(request) {
  const header = request.headers.authorization || "";
  const [scheme = "", ...tokenParts] = header.trim().split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") {
    return "";
  }
  return tokenParts.join(" ").trim();
}

function isAuthorized(request) {
  if (!BROKER_API_KEY) {
    return true;
  }
  return bearerToken(request) === BROKER_API_KEY;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim().length > 0 ? JSON.parse(raw) : {};
}

function pathSegments(pathname) {
  return pathname.split("/").filter(Boolean);
}

function matchesRoute(segments, expected) {
  return (
    segments.length === expected.length &&
    expected.every((part, index) =>
      part === "*" ? segments[index].length > 0 : segments[index] === part
    )
  );
}

async function renderLoginPage(req) {
  const authenticated = await isAuthenticated();
  const oauthConfigured = isConfigured();
  let householdCount = 0;

  if (authenticated && oauthConfigured) {
    try {
      const households = await sonosApi.getHouseholds();
      householdCount = households?.households?.length || 0;
    } catch (error) {
      console.error("[oauth] failed to fetch households:", error.message);
    }
  }

  const baseUrl =
    `${req.headers["x-forwarded-proto"] || "http"}://` +
    (req.headers["x-forwarded-host"] || req.headers.host);

  let oauthButton = "";
  let statusHtml = "";

  if (!oauthConfigured) {
    statusHtml = `
      <div class="status-box error">
        <strong>⚠️ Not Configured</strong>
        <p>OAuth is not configured. Set SONOS_CLIENT_ID and SONOS_CLIENT_SECRET.</p>
      </div>
    `;
  } else if (!authenticated) {
    const state = generateState();
    const loginUrl = getLoginUrl(state);
    oauthButton = `
      <a href="${loginUrl}" class="button button-primary">
        Sign in with Sonos
      </a>
    `;
    statusHtml = `
      <div class="status-box">
        <strong>⚫ Not Authenticated</strong>
        <p>Click the button below to sign in with your Sonos account.</p>
      </div>
    `;
  } else {
    statusHtml = `
      <div class="status-box success">
        <strong>🟢 Authenticated</strong>
        <p>Connected to ${householdCount} household${householdCount !== 1 ? "s" : ""}.</p>
      </div>
    `;
    oauthButton = `
      <form method="POST" action="/auth/disconnect" style="margin-top: 20px;">
        <button type="submit" class="button button-danger">
          Disconnect
        </button>
      </form>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${BROKER_NAME}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #e0e0e0;
    }
    .container {
      background: #2d2d44;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 40px;
      max-width: 500px;
      width: 100%;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 10px;
      color: #fff;
    }
    .subtitle {
      font-size: 14px;
      color: #a0a0b0;
      margin-bottom: 30px;
    }
    .status-box {
      background: rgba(100, 100, 120, 0.3);
      border-left: 4px solid #808090;
      padding: 15px;
      border-radius: 6px;
      margin-bottom: 25px;
    }
    .status-box strong {
      display: block;
      margin-bottom: 8px;
      font-size: 15px;
    }
    .status-box p {
      font-size: 14px;
      color: #b0b0c0;
    }
    .status-box.success {
      border-left-color: #4ade80;
      background: rgba(74, 222, 128, 0.1);
    }
    .status-box.error {
      border-left-color: #ef4444;
      background: rgba(239, 68, 68, 0.1);
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      border: none;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
      transition: all 0.2s;
      width: 100%;
    }
    .button-primary {
      background: #3b82f6;
      color: white;
    }
    .button-primary:hover {
      background: #2563eb;
      transform: translateY(-2px);
      box-shadow: 0 8px 16px rgba(59, 130, 246, 0.3);
    }
    .button-danger {
      background: #ef4444;
      color: white;
    }
    .button-danger:hover {
      background: #dc2626;
      transform: translateY(-2px);
      box-shadow: 0 8px 16px rgba(239, 68, 68, 0.3);
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid rgba(160, 160, 176, 0.3);
      font-size: 12px;
      color: #808090;
      text-align: center;
    }
    .footer a {
      color: #3b82f6;
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔊 ${BROKER_NAME}</h1>
    <p class="subtitle">Sonos Cloud Broker</p>
    
    ${statusHtml}
    
    ${oauthButton}
    
    <div class="footer">
      <p>Self-hosted Sonos cloud broker for homebridge-sonos-scenes</p>
      <p><a href="${BROKER_DOCS_URL}" target="_blank">Documentation</a></p>
    </div>
  </div>
</body>
</html>
  `;
}

const server = createServer(async (request, response) => {
  const url = new URL(
    request.url || "/",
    `http://${request.headers.host || `${BROKER_HOST}:${BROKER_PORT}`}`
  );
  const pathname = url.pathname;
  const searchParams = url.searchParams;
  const segments = pathSegments(pathname);
  const method = request.method || "GET";

  try {
    // Health check (unauthenticated)
    if (method === "GET" && pathname === "/healthz") {
      writeJson(response, 200, {
        ok: true,
        name: BROKER_NAME,
      });
      return;
    }

    // Status endpoint (unauthenticated but shows config status)
    if (method === "GET" && pathname === "/v1/status") {
      const oauthConfigured = isConfigured();
      const authenticated = oauthConfigured
        ? await isAuthenticated()
        : false;

      writeJson(response, 200, {
        ok: true,
        name: BROKER_NAME,
        version: "0.0.1",
        oauthConfigured,
        authenticated,
        features: ["favorites", "playlists"],
        docsUrl: BROKER_DOCS_URL,
        message: oauthConfigured
          ? authenticated
            ? "Broker is running and authenticated."
            : "Broker is running. User not authenticated."
          : "Broker is running. OAuth is not configured.",
      });
      return;
    }

    // OAuth endpoints (unauthenticated)
    if (method === "GET" && pathname === "/auth/login") {
      const html = await renderLoginPage(request);
      writeHtml(response, 200, html);
      return;
    }

    if (method === "GET" && pathname === "/auth/callback") {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const error = searchParams.get("error");

      if (error) {
        writeJson(response, 400, {
          ok: false,
          error,
          message: `OAuth callback error: ${error}`,
        });
        return;
      }

      if (!code || !state) {
        writeJson(response, 400, {
          ok: false,
          message: "Missing code or state parameter.",
        });
        return;
      }

      if (!validateState(state)) {
        writeJson(response, 400, {
          ok: false,
          message: "Invalid or expired state parameter.",
        });
        return;
      }

      try {
        const result = await exchangeCodeForTokens(code);
        response.writeHead(302, {
          location: "/auth/login?authenticated=true",
        });
        response.end();
        console.log("[server] OAuth login successful");
      } catch (error) {
        console.error("[server] OAuth token exchange failed:", error.message);
        writeJson(response, 400, {
          ok: false,
          message: `OAuth token exchange failed: ${error.message}`,
        });
      }
      return;
    }

    if (method === "GET" && pathname === "/auth/status") {
      const status = await getAuthStatus();
      writeJson(response, 200, {
        ok: true,
        ...status,
      });
      return;
    }

    if (method === "POST" && pathname === "/auth/disconnect") {
      if (!isAuthorized(request)) {
        writeJson(response, 401, {
          ok: false,
          message: "Unauthorized.",
        });
        return;
      }

      await disconnect();
      response.writeHead(302, { location: "/auth/login" });
      response.end();
      console.log("[server] User disconnected");
      return;
    }

    // All other routes require API key authentication
    if (!isAuthorized(request)) {
      writeJson(response, 401, {
        ok: false,
        message: "Unauthorized. Supply the configured broker bearer token.",
      });
      return;
    }

    // Check if OAuth is configured and user is authenticated for API routes
    if (!isConfigured()) {
      writeJson(response, 503, {
        ok: false,
        message: "OAuth is not configured. Set SONOS_CLIENT_ID and SONOS_CLIENT_SECRET.",
      });
      return;
    }

    if (!(await isAuthenticated())) {
      writeJson(response, 503, {
        ok: false,
        message: "Not authenticated. Visit /auth/login to authenticate.",
      });
      return;
    }

    // Sonos API proxy routes
    try {
      if (method === "GET" && pathname === "/v1/households") {
        const result = await sonosApi.getHouseholds();
        writeJson(response, 200, result);
        return;
      }

      if (
        method === "GET" &&
        matchesRoute(segments, ["v1", "households", "*", "groups"])
      ) {
        const householdId = segments[2];
        const result = await sonosApi.getGroups(householdId);
        writeJson(response, 200, result);
        return;
      }

      if (
        method === "GET" &&
        matchesRoute(segments, ["v1", "households", "*", "favorites"])
      ) {
        const householdId = segments[2];
        const result = await sonosApi.getFavorites(householdId);
        writeJson(response, 200, result);
        return;
      }

      if (
        method === "GET" &&
        matchesRoute(segments, ["v1", "households", "*", "playlists"])
      ) {
        const householdId = segments[2];
        const result = await sonosApi.getPlaylists(householdId);
        writeJson(response, 200, result);
        return;
      }

      if (
        method === "POST" &&
        matchesRoute(segments, ["v1", "groups", "*", "favorites", "load"])
      ) {
        const groupId = segments[2];
        const body = await readJsonBody(request);
        const result = await sonosApi.loadFavorite(
          groupId,
          body.favoriteId,
          body.action
        );
        writeJson(response, 200, result);
        return;
      }

      if (
        method === "POST" &&
        matchesRoute(segments, ["v1", "groups", "*", "playlists", "load"])
      ) {
        const groupId = segments[2];
        const body = await readJsonBody(request);
        const result = await sonosApi.loadPlaylist(
          groupId,
          body.playlistId,
          body.action
        );
        writeJson(response, 200, result);
        return;
      }

      writeJson(response, 404, {
        ok: false,
        message: `No route matched ${method} ${pathname}.`,
      });
    } catch (error) {
      console.error(
        `[server] ${method} ${pathname} failed:`,
        error.message
      );

      if (error.statusCode === 401) {
        writeJson(response, 401, {
          ok: false,
          message: error.message,
        });
      } else if (error.statusCode >= 500) {
        writeJson(response, 502, {
          ok: false,
          message: "Sonos API is temporarily unavailable.",
        });
      } else {
        writeJson(response, 400, {
          ok: false,
          message: error.message,
        });
      }
    }
  } catch (error) {
    console.error(`[server] unhandled error for ${method} ${pathname}:`, error);
    writeJson(response, 500, {
      ok: false,
      message: "Internal broker error.",
    });
  }
});

server.listen(BROKER_PORT, BROKER_HOST, () => {
  console.log(
    `[${BROKER_NAME}] listening on http://${BROKER_HOST}:${BROKER_PORT}`
  );
  console.log(`[${BROKER_NAME}] OAuth configured: ${isConfigured()}`);
  console.log(
    `[${BROKER_NAME}] API key required: ${BROKER_API_KEY ? "yes" : "no"}`
  );
});

process.on("SIGTERM", () => {
  console.log(`[${BROKER_NAME}] SIGTERM received, closing server`);
  server.close(() => {
    process.exit(0);
  });
});
