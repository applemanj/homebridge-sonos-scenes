import { createServer } from "node:http";

const port = Number(process.env.BROKER_PORT || 8787);
const host = process.env.BROKER_HOST || "127.0.0.1";
const brokerName = process.env.BROKER_NAME || "sonos-scenes-broker";
const apiKey = (process.env.BROKER_API_KEY || "").trim();
const docsUrl = process.env.BROKER_DOCS_URL || "https://github.com/applemanj/homebridge-sonos-scenes/blob/main/docs/cloud-broker.md";

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
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
  if (!apiKey) {
    return true;
  }

  return bearerToken(request) === apiKey;
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

function notImplemented(response, route, extra = {}) {
  writeJson(response, 501, {
    ok: false,
    route,
    mode: "scaffold",
    message: "This broker scaffold reserves the route, but Sonos OAuth and cloud playback are not implemented yet.",
    ...extra,
  });
}

function pathSegments(pathname) {
  return pathname.split("/").filter(Boolean);
}

function matchesRoute(segments, expected) {
  return segments.length === expected.length && expected.every((part, index) =>
    part === "*" ? segments[index].length > 0 : segments[index] === part
  );
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  const pathname = url.pathname;
  const segments = pathSegments(pathname);
  const method = request.method || "GET";

  if (method === "GET" && pathname === "/healthz") {
    writeJson(response, 200, {
      ok: true,
      name: brokerName,
      mode: "scaffold",
    });
    return;
  }

  if (method === "GET" && pathname === "/v1/status") {
    writeJson(response, 200, {
      ok: true,
      name: brokerName,
      version: "0.0.1",
      mode: "scaffold",
      oauthConfigured: false,
      features: ["favorites", "playlists"],
      docsUrl,
      message: "Broker scaffold is running. Sonos OAuth is not configured yet.",
    });
    return;
  }

  if (!isAuthorized(request)) {
    writeJson(response, 401, {
      ok: false,
      message: "Unauthorized. Supply the configured broker bearer token.",
    });
    return;
  }

  try {
    if (method === "GET" && pathname === "/v1/households") {
      notImplemented(response, pathname, {
        households: [],
      });
      return;
    }

    if (method === "GET" && matchesRoute(segments, ["v1", "households", "*", "groups"])) {
      notImplemented(response, pathname, {
        groups: [],
        players: [],
      });
      return;
    }

    if (method === "GET" && matchesRoute(segments, ["v1", "households", "*", "favorites"])) {
      notImplemented(response, pathname, {
        favorites: [],
      });
      return;
    }

    if (method === "GET" && matchesRoute(segments, ["v1", "households", "*", "playlists"])) {
      notImplemented(response, pathname, {
        playlists: [],
      });
      return;
    }

    if (method === "POST" && matchesRoute(segments, ["v1", "groups", "*", "favorites", "load"])) {
      const body = await readJsonBody(request);
      notImplemented(response, pathname, {
        received: body,
      });
      return;
    }

    if (method === "POST" && matchesRoute(segments, ["v1", "groups", "*", "playlists", "load"])) {
      const body = await readJsonBody(request);
      notImplemented(response, pathname, {
        received: body,
      });
      return;
    }

    writeJson(response, 404, {
      ok: false,
      message: `No route matched ${method} ${pathname}.`,
    });
  } catch (error) {
    console.error(`[${brokerName}] request failed for ${method} ${pathname}:`, error);
    writeJson(response, 500, {
      ok: false,
      message: "Internal broker error.",
    });
  }
});

server.listen(port, host, () => {
  console.log(`${brokerName} listening on http://${host}:${port}`);
});
