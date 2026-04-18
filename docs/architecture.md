# Architecture and Developer Notes

This page keeps the more technical project details out of the main README.

## Current Architecture

- Homebridge dynamic platform plugin
- One switch accessory per scene
- One companion volume control accessory per scene
- Local-first transport built on the community `sonos` package
- Custom Homebridge UI for discovery, validation, testing, and scene editing

## Scene Model

Scenes store stable Sonos IDs instead of room-name strings:

- `householdId`
- `coordinatorPlayerId`
- `memberPlayerIds`
- source details
- lead-room and per-room volume settings
- retry and off-behavior settings

## Transport Model

The default path is `local`.

Today that covers:

- discovery
- grouping
- ungrouping
- line in
- supported local favorites
- per-player and group volume

The project also reserves a future `local_plus_cloud` mode for self-hosters who want to run their own Sonos cloud broker. That contract is documented in [cloud-broker.md](cloud-broker.md).

## Repository Layout

```text
src/
  accessories/
  cloud/
  transports/
  ui/
homebridge-ui/
broker/
docs/
examples/
test/
```

## Development

```bash
npm install
npm run build
npm test
```

The published package includes:

- `dist/`
- `homebridge-ui/`
- `config.schema.json`
- docs and example assets listed in `package.json`

## Release Flow

Typical release flow:

```bash
npm version <version>
git push origin main
gh release create v<version> --target main
```

This repo uses GitHub Actions trusted publishing to publish to npm from a GitHub release.

## Known Technical Gaps

- Some complex favorites are still unreliable over the local-only path
- `TV` support is still transport-gated and conservative
- `local_plus_cloud` is not yet wired into runtime playback
- subscription-driven live refresh is not fully implemented yet
- `npm audit` currently reports a high-severity advisory in the transitive `ip` dependency pulled in by `sonos`

## References

These docs helped shape the project boundaries:

- [Sonos Connected Home](https://docs.sonos.com/docs/connected-home-get-started)
- [Sonos Authorize](https://docs.sonos.com/docs/authorize)
- [Sonos Discover](https://docs.sonos.com/docs/discover)
- [Sonos Control](https://docs.sonos.com/docs/control)
- [Sonos Subscribe](https://docs.sonos.com/docs/subscribe)
- [Sonos Features](https://docs.sonos.com/docs/connected-home-features)
- [Homebridge plugin-ui-utils](https://github.com/homebridge/plugin-ui-utils)
