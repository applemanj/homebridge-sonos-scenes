# sonos-scenes-broker

This is the self-hosted cloud broker for `homebridge-sonos-scenes`, designed to run as a Docker container alongside Homebridge.

## What It Does

The broker bridges Sonos's official cloud APIs so the plugin can use cloud-backed favorites and playlists (Spotify, Apple Music, etc.). It handles:

- **Sonos OAuth flow** — Users log in once via the container's web UI (`/auth/login`). State parameters prevent CSRF attacks.
- **Secure token storage** — Tokens are encrypted at rest using AES-256-GCM. The encryption key is auto-generated and stored in the data volume.
- **Automatic token refresh** — When access tokens expire, the broker refreshes them via the Sonos OAuth endpoint.
- **Cloud API proxying** — The plugin calls the broker's HTTP endpoints (with an API key), and the broker translates them to Sonos API calls with the stored access token.

The plugin talks to the broker over plain HTTP with a shared API key — no Sonos credentials ever touch the plugin or your Homebridge config.

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
- `GET /v1/status` — Broker status JSON (OAuth configured, authenticated)
- `GET /auth/login` — OAuth login page (HTML UI)
- `GET /auth/callback` — OAuth callback handler (Sonos redirects here)
- `GET /auth/status` — Auth status JSON
- `POST /auth/disconnect` — Clear stored tokens (API key auth required)

### Authenticated (API key required)

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

# Shared API key for plugin authentication (generate a random string)
BROKER_API_KEY=

# Secret for encrypting tokens at rest (auto-generated and stored if not set)
BROKER_TOKEN_SECRET=

# Optional: docs URL shown on login page
BROKER_DOCS_URL=https://github.com/applemanj/homebridge-sonos-scenes/blob/main/docs/cloud-broker.md
```

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

### 4. Complete OAuth

1. Visit `http://localhost:8787/auth/login` (or your public HTTPS URL)
2. Click "Sign in with Sonos"
3. Authorize the app
4. You're authenticated! The token is encrypted and persisted in the volume.

### 5. Point the Plugin

In your Homebridge config, set:

```json
{
  "platforms": [
    {
      "platform": "Sonos Scenes",
      "brokerUrl": "http://localhost:8787",
      "brokerApiKey": "your-shared-api-key"
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
- `src/tokenStore.mjs` — Encrypted token storage (AES-256-GCM)
- `src/sonosApi.mjs` — Sonos Cloud API client
- `Dockerfile` — Alpine-based Docker image
- `docker-compose.yml` — Example Docker Compose stack
- `.dockerignore` — Build optimization

## Security Notes

- **Zero external dependencies** — Uses only Node.js built-ins. No npm supply-chain risk.
- **Encrypted tokens** — Stored in AES-256-GCM with keys derived from `BROKER_TOKEN_SECRET` or auto-generated.
- **HTTPS required** — The Sonos OAuth flow requires HTTPS. Use a reverse proxy.
- **API key auth** — All Sonos endpoints require the configured `BROKER_API_KEY` bearer token.
- **State parameter validation** — OAuth state tokens are validated and have a 10-minute TTL to prevent CSRF.
- **Token expiry** — Access tokens are refreshed automatically before they expire.
- **No secrets in logs** — Token values are never logged.

