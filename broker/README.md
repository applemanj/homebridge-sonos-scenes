# sonos-scenes-broker

This is the first self-hosted broker scaffold for `homebridge-sonos-scenes`.

It is intentionally small:

- it starts a local HTTP server
- it exposes `GET /healthz`
- it exposes `GET /v1/status`
- it reserves the future Sonos broker routes with `501 Not Implemented` responses

It does **not** implement Sonos OAuth or Sonos cloud playback yet. The point of this scaffold is to give self-hosters a concrete package and endpoint shape to build from.

## Run It

```bash
cd broker
node src/server.mjs
```

With environment variables:

```bash
BROKER_PORT=8787
BROKER_HOST=127.0.0.1
BROKER_API_KEY=replace-me
node src/server.mjs
```

## Current Endpoints

- `GET /healthz`
- `GET /v1/status`
- `GET /v1/households`
- `GET /v1/households/:householdId/groups`
- `GET /v1/households/:householdId/favorites`
- `GET /v1/households/:householdId/playlists`
- `POST /v1/groups/:groupId/favorites/load`
- `POST /v1/groups/:groupId/playlists/load`

The `status` endpoint is meant to be usable by the Homebridge plugin right away for configuration checks. The other endpoints are placeholders for the future Sonos OAuth and cloud-control work.
