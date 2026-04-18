# Self-Hosted Cloud Broker Contract

This project is intentionally local-first. For some Sonos favorites and playlists, the local UPnP path is not reliable enough, so the long-term plan is an optional self-hosted broker that uses Sonos's official cloud APIs on the user's behalf.

This document defines the shape of that future broker so the Homebridge plugin can support a `local_plus_cloud` mode without forcing the maintainer to host user tokens.

An initial self-hosted scaffold now lives under [broker/](../broker/README.md). It exposes the status endpoint and reserves the future route surface, but it does not implement Sonos OAuth or cloud playback yet.

## Design Goals

- Keep the Homebridge plugin installable and useful with no cloud dependency.
- Let advanced users self-host their own broker.
- Keep Sonos client secrets and refresh tokens out of the npm-distributed plugin.
- Use the Sonos Connected Home cloud APIs for cloud-backed favorites and playlists.

## Non-Goals

- Proxying audio streams.
- Acting as a generic Sonos controller for all playback.
- Replacing local grouping, line-in, TV, or local volume control.

## Expected Plugin Modes

- `local_only`
  - All scene execution stays on the local transport.
  - The plugin should only expose sources that are reliable on the local path.

- `local_plus_cloud`
  - Local transport still handles grouping, line-in, TV, and volume.
  - The broker handles Sonos OAuth plus cloud-backed favorites and playlists.

## Broker Responsibilities

- Host a public HTTPS OAuth callback for Sonos authorization.
- Exchange Sonos authorization codes for access and refresh tokens.
- Refresh access tokens as needed.
- Query Sonos cloud households, groups, favorites, and playlists.
- Load favorites or playlists through Sonos's official cloud endpoints.

## Proposed Endpoints

### `GET /v1/status`

Returns a minimal capability document so the plugin can validate the broker URL before enabling cloud-backed scene options.

Example response:

```json
{
  "ok": true,
  "name": "sonos-scenes-broker",
  "version": "0.1.0",
  "features": ["favorites", "playlists"],
  "docsUrl": "https://example.com/docs"
}
```

### `GET /v1/households`

Returns Sonos households available to the authenticated installation.

### `GET /v1/households/:householdId/groups`

Returns groups and players for a household, shaped closely enough to Sonos's Connected Home response that the plugin can merge or map it into its existing topology model.

### `GET /v1/households/:householdId/favorites`

Returns Sonos favorites that can be launched through the broker.

### `GET /v1/households/:householdId/playlists`

Returns Sonos playlists that can be launched through the broker.

### `POST /v1/groups/:groupId/favorites/load`

Loads a Sonos favorite onto the target group.

Example request:

```json
{
  "favoriteId": "2/13",
  "action": "PLAY_NOW"
}
```

### `POST /v1/groups/:groupId/playlists/load`

Loads a Sonos playlist onto the target group.

Example request:

```json
{
  "playlistId": "playlist-123",
  "action": "PLAY_NOW"
}
```

## Authentication Between Plugin And Broker

The plugin should not assume anonymous access.

Recommended first cut:

- user deploys the broker
- broker exposes a static bearer token or API key for the Homebridge plugin
- plugin stores that token in `config.json` under `cloud.broker.apiKey`

This is simple enough for self-hosting and avoids prematurely designing a more complex plugin-to-broker auth scheme.

## Suggested Plugin Config Shape

```json
{
  "cloud": {
    "mode": "local_plus_cloud",
    "broker": {
      "url": "https://sonos-broker.example.com",
      "apiKey": "replace-me",
      "timeoutMs": 8000,
      "routeFavorites": true,
      "routePlaylists": true
    }
  }
}
```

## Operational Guidance

- The broker should store Sonos refresh tokens encrypted at rest.
- The broker should avoid logging access tokens, refresh tokens, or raw authorization codes.
- The broker should support account disconnect and token revocation cleanup.
- The broker should return explicit errors when a Sonos household or favorite is unavailable.

## Sonos Docs

- Connected Home: <https://docs.sonos.com/docs/connected-home-get-started>
- Authorize: <https://docs.sonos.com/docs/authorize>
- Discover: <https://docs.sonos.com/docs/discover>
- Control: <https://docs.sonos.com/docs/control>
- getFavorites: <https://docs.sonos.com/reference/favorites-getfavorites-householdid>
- loadFavorite: <https://docs.sonos.com/reference/favorites-loadfavorite-groupid>
