# homebridge-sonos-scenes

`homebridge-sonos-scenes` is a Homebridge plugin scaffold for Sonos workflow scenes.

The goal is not general Sonos control. The goal is a clean way to trigger multi-step Sonos workflows from Apple Home, such as:

- grouping rooms around a coordinator,
- selecting `line_in`, `favorite`, or transport-gated `tv` sources,
- setting coordinator and per-room volume,
- optionally ungrouping when the switch turns off.

This plugin is intentionally positioned as a complement to `homebridge-zp`, not a replacement for it.

## What Is Implemented

- A singular Homebridge dynamic platform plugin with switch accessories for each configured scene.
- A normalized scene model that stores stable Sonos IDs instead of room-name strings.
- A local-first `SonosTransport` abstraction with live discovery through the `sonos` package and fixture fallback for UI/testing.
- A `SceneRunner` that validates scenes, serializes execution per coordinator, retries transient failures, and emits structured logs.
- A Homebridge custom UI under `homebridge-ui/` with discovery, validation, test execution, and scene editing.
- Sample fixture data and config examples for development without a live Sonos system.
- Unit tests covering config normalization, validation, retry behavior, and off-action execution.

## Project Layout

```text
src/
  accessories/sceneSwitch.ts
  config.ts
  discoveryService.ts
  index.ts
  logger.ts
  platform.ts
  sampleTopology.ts
  sceneRunner.ts
  transports/
  ui/serverApi.ts
homebridge-ui/
  public/index.html
  server.js
examples/
  config.example.json
  sample-topology.json
test/
```

## Running It

```bash
npm install
npm run build
npm test
```

For Homebridge development, point the plugin at a config shaped like [examples/config.example.json](examples/config.example.json).

## Transport Notes

- The default transport is `local`.
- Live discovery uses the community `sonos` package for local network discovery and control.
- If live discovery fails, the plugin falls back to the configured fixture file or the built-in sample topology so the custom UI remains usable during development.
- `tv` source loading is disabled by default and remains transport-gated.
- Favorites rely on URIs exposed through the local transport; some complex favorite types may need more transport-specific handling later.

## Official Sonos References

These docs informed the product boundaries and future cloud-adapter shape:

- Sonos Connected Home: <https://docs.sonos.com/docs/connected-home-get-started>
- Sonos Authorize: <https://docs.sonos.com/docs/authorize>
- Sonos Discover: <https://docs.sonos.com/docs/discover>
- Sonos Control: <https://docs.sonos.com/docs/control>
- Sonos Subscribe: <https://docs.sonos.com/docs/subscribe>
- Sonos Features: <https://docs.sonos.com/docs/connected-home-features>
- Homebridge plugin-ui-utils: <https://github.com/homebridge/plugin-ui-utils>

## Current Gaps

- The local transport is MVP-level and best-effort for advanced favorites and TV input handling.
- Subscription-driven refresh is still represented by the transport abstraction, but not yet fully wired for live event propagation.
- `npm audit` currently reports a high-severity advisory in the transitive `ip` dependency pulled in by `sonos`.
