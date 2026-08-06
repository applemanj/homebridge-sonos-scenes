# sonos-scenes-broker

This is the self-hosted cloud broker for `homebridge-sonos-scenes`, designed to run as a Docker container alongside Homebridge.

## What It Does

The broker bridges Sonos's official cloud APIs so the plugin can use cloud-backed favorites and playlists (Spotify, Apple Music, etc.). It handles:

- **Sonos OAuth flow** — Each user logs in once via the broker's web UI (`/auth/login`). State parameters prevent CSRF attacks.
- **Per-user broker API keys** — After OAuth, the broker mints a personal API key (`ssk_...`) shown once to the user. The plugin uses this key; the broker resolves it to that user's stored tokens.
- **Secure per-user token storage** — Each user's tokens are encrypted at rest using AES-256-GCM, keyed by their userId. The encryption key is auto-generated and stored in the data volume.
- **Automatic token refresh** — When a user's access token expires, the broker refreshes it via the Sonos OAuth endpoint.
- **Cloud API proxying** — The plugin calls the broker's HTTP endpoints with its personal API key, and the broker translates them to Sonos API calls with that user's access token.

The plugin talks to the broker over HTTPS with a per-user API key — no Sonos credentials ever touch the plugin or your Homebridge config.

## Architecture

```
┌─────────────────────┐
│   Homebridge        │
│   + Plugin          │
│   (API key auth)    │
└──────────┬──────────┘
           │ HTTP /v1/*
           ▼
┌─────────────────────┐
│   sonos-broker      │
│  (this container)   │
│                     │
│  • OAuth tokens     │
│  • Encrypted store  │
│  • State mgmt       │
└──────────┬──────────┘
           │ HTTPS /control/api/v1/*
           ▼
┌─────────────────────┐
│   Sonos Cloud API   │
│  (api.ws.sonos.com) │
└─────────────────────┘
```

## Endpoints

### Unauthenticated

- `GET /healthz` — Health check (always responds `200 OK`)
- `GET /v1/status` — Broker status JSON (OAuth configured)
- `GET /auth/login` — OAuth login page (HTML UI)
- `GET /auth/callback` — OAuth callback handler (Sonos redirects here; mints + shows a personal API key)

### Authenticated (personal broker API key required)

- `GET /auth/status` — Auth status JSON for your user
- `POST /auth/disconnect` — Clear your tokens and revoke your API key
- `GET /v1/households` — List households
- `GET /v1/households/:householdId/groups` — List groups in household
- `GET /v1/households/:householdId/favorites` — List favorites
- `GET /v1/households/:householdId/playlists` — List playlists
- `POST /v1/groups/:groupId/favorites/load` — Load a favorite
- `POST /v1/groups/:groupId/playlists/load` — Load a playlist

## Environment Variables

```bash
# Sonos OAuth credentials (register at https://integration.sonos.com/integrations)
SONOS_CLIENT_ID=
SONOS_CLIENT_SECRET=

# Must be a publicly routable HTTPS URL pointing to /auth/callback
# (The broker itself listens on HTTP; use a reverse proxy for HTTPS)
SONOS_REDIRECT_URI=https://your-broker.example.com/auth/callback

# Broker HTTP server
BROKER_PORT=8787
BROKER_HOST=0.0.0.0

# Secret for encrypting tokens at rest (auto-generated and stored if not set)
BROKER_TOKEN_SECRET=

# Optional: docs URL shown on login page
BROKER_DOCS_URL=https://github.com/applemanj/homebridge-sonos-scenes/blob/main/docs/cloud-broker.md
```

> **Note:** There is no `BROKER_API_KEY` anymore. Each user gets a personal broker API key (`ssk_...`) after signing in with Sonos at `/auth/login`. The broker stores these keys (hashed) and resolves them to per-user tokens.

## Quick Start (Docker)

### 1. Register OAuth App

1. Go to https://integration.sonos.com/integrations
2. Create a new OAuth app
3. Set **Redirect URI** to `https://your-broker.example.com/auth/callback` (must be HTTPS and publicly routable)
4. Note your Client ID and Client Secret

### 2. Create `.env`

```bash
cp .env.example .env
# Edit .env with your OAuth credentials
```

### 3. Run with Docker Compose

```bash
docker-compose up -d
```

The broker will listen on `http://localhost:8787`.

### 4. Complete OAuth & Get Your API Key

1. Visit `http://localhost:8787/auth/login` (or your public HTTPS URL)
2. Click "Sign in with Sonos"
3. Authorize the app
4. The broker shows a **personal broker API key** (`ssk_...`) — copy it now; it's only shown once.

### 5. Point the Plugin

In your Homebridge config, set:

```json
{
  "platforms": [
    {
      "platform": "SonosScenes",
      "cloud": {
        "mode": "local_plus_cloud",
        "broker": {
          "kind": "self-hosted",
          "url": "http://localhost:8787",
          "apiKey": "ssk_your-personal-key"
        }
      }
    }
  ]
}
```

## HTTPS / Reverse Proxy

The broker listens on plain HTTP. For production, use a reverse proxy (nginx, Caddy, Traefik, etc.) in front to handle HTTPS. For example:

```nginx
server {
  listen 443 ssl http2;
  server_name your-broker.example.com;
  ssl_certificate ...;
  ssl_certificate_key ...;

  location / {
    proxy_pass http://broker:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

## Development

```bash
cd broker
npm install  # (no dependencies, just .gitignore setup)
npm run dev  # Runs with --watch
```

Or directly:

```bash
BROKER_PORT=8787 BROKER_HOST=127.0.0.1 node src/server.mjs
```

## Files

- `src/server.mjs` — Main HTTP server
- `src/oauth.mjs` — OAuth flow (login, callback, token refresh)
- `src/keyStore.mjs` — Per-user broker API keys (mint, resolve, revoke; sha256-hashed at rest)
- `src/tokenStore.mjs` — Per-user encrypted token storage (AES-256-GCM)
- `src/sonosApi.mjs` — Sonos Cloud API client
- `Dockerfile` — Alpine-based Docker image
- `docker-compose.yml` — Example Docker Compose stack
- `.dockerignore` — Build optimization

## Security Notes

- **Zero external dependencies** — Uses only Node.js built-ins. No npm supply-chain risk.
- **Per-user API keys** — Each user gets a unique `ssk_...` key after OAuth. Keys are stored sha256-hashed; only the user ever sees the plaintext (once, at creation).
- **Per-user encrypted tokens** — Each user's Sonos tokens are stored separately in AES-256-GCM, keyed by userId.
- **HTTPS required** — The Sonos OAuth flow requires HTTPS. Use a reverse proxy (or a host like Azure App Service that provides TLS).
- **Revocable access** — `POST /auth/disconnect` clears a user's tokens and revokes their key.
- **State parameter validation** — OAuth state tokens are validated and have a 10-minute TTL to prevent CSRF.
- **Token expiry** — Access tokens are refreshed automatically before they expire.
- **No secrets in logs** — Token and key values are never logged.

