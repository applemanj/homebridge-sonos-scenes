<p align="center">
  <img src="docs/assets/icon-512.png" alt="homebridge-sonos-scenes icon" width="164">
</p>

<h1 align="center">homebridge-sonos-scenes</h1>

<p align="center">Homebridge plugin for Sonos workflow scenes and orchestration.</p>

`homebridge-sonos-scenes` is a Homebridge plugin scaffold for Sonos workflow scenes.

> [!IMPORTANT]
> This project is in an active early-testing phase. The local-first scene workflow is usable and published to npm, but cloud-backed Sonos playback is still planned work and some edge cases are still being hardened. If you try the plugin, please share bugs, UI feedback, and Sonos compatibility notes in [GitHub Issues](https://github.com/applemanj/homebridge-sonos-scenes/issues). Real-world feedback is especially helpful right now.

The goal is not general Sonos control. The goal is a clean way to trigger multi-step Sonos workflows from Apple Home, such as:

- grouping rooms around a coordinator,
- selecting `line_in`, `favorite`, or transport-gated `tv` sources,
- setting coordinator and per-room volume,
- optionally ungrouping when the switch turns off.

## What Is Implemented

- A singular Homebridge dynamic platform plugin with switch accessories for each configured scene plus companion volume controls for quick level adjustments in Apple Home.
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
docs/
  cloud-broker.md
broker/
  README.md
  src/server.mjs
test/
```

## Running It

```bash
npm install
npm run build
npm test
```

For Homebridge development, point the plugin at a config shaped like [examples/config.example.json](examples/config.example.json).

## Official Homebridge Test Path

If you want to test it the normal Homebridge way, publish it to npm and install it from Homebridge by package name.

This repo is set up for that flow now:

- `prepare` builds `dist/` for Git-based installs.
- `prepack` rebuilds `dist/` before `npm publish` so the published tarball contains runnable plugin files.
- the published package includes `dist/`, `homebridge-ui/`, `config.schema.json`, and the example/docs assets listed in `package.json`.

Typical release flow:

```bash
npm login
npm test
npm publish
```

After that, install `homebridge-sonos-scenes` from the Homebridge UI or via npm in the normal Homebridge plugin workflow.

The Homebridge project’s verified-plugin guidance also expects the plugin to be published to npm with source available on GitHub:

- Homebridge Verified Plugins: <https://github.com/homebridge/homebridge/wiki/verified-Plugins>

## Transport Notes

- The default transport is `local`.
- Live discovery uses the community `sonos` package for local network discovery and control.
- If live discovery fails, the plugin falls back to the configured fixture file or the built-in sample topology so the custom UI remains usable during development.
- `tv` source loading is disabled by default and remains transport-gated.
- Favorites rely on URIs exposed through the local transport; some complex favorite types may need more transport-specific handling later.

## Local Only Vs Local + Cloud

The intended product shape is now:

- `local_only`: today’s supported mode. It keeps discovery, grouping, line-in, TV, and directly playable favorites on the local Sonos path.
- `local_plus_cloud`: a future mode for users who choose to run their own Sonos cloud broker for favorites and playlists that are not reliable over the local path.

This project does not host that broker for users. The goal is an optional self-hosted companion service, not a shared multi-tenant cloud run by the plugin maintainer.

The config model already reserves a `cloud` section so advanced users and future versions do not need a breaking config redesign later. The broker contract is documented in [docs/cloud-broker.md](docs/cloud-broker.md).

There is also an early self-hosted broker scaffold in [broker/README.md](broker/README.md). It is not wired into scene execution yet, but it gives self-hosters a concrete service shape and a live `/v1/status` endpoint to target.

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
- The `local_plus_cloud` mode is a planned architecture boundary only; the self-hosted broker contract is documented, but broker-backed playback is not wired into the runtime yet.
- Subscription-driven refresh is still represented by the transport abstraction, but not yet fully wired for live event propagation.
- `npm audit` currently reports a high-severity advisory in the transitive `ip` dependency pulled in by `sonos`.
