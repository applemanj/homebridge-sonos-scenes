<p align="center">
  <img src="docs/assets/icon-512.png" alt="homebridge-sonos-scenes icon" width="164">
</p>

<h1 align="center">homebridge-sonos-scenes</h1>

<p align="center">Build Sonos scenes in Homebridge and trigger them from Apple Home.</p>

> [!IMPORTANT]
> This plugin is in active early testing. The local-first scene workflow is usable today, but some Sonos edge cases are still being hardened and cloud-backed playback is still future work. If you try it, please share bugs, setup notes, and UI feedback in [GitHub Issues](https://github.com/applemanj/homebridge-sonos-scenes/issues).

`homebridge-sonos-scenes` lets you create repeatable Sonos scenes such as:

- group specific rooms together
- start a favorite or line-in source
- set lead-room and per-room volume
- optionally ungroup the rooms when the scene turns off

This plugin is meant for scene-style Sonos workflows, not full everyday Sonos control.

## What You Get

Each saved scene creates:

- a HomeKit switch to run the scene
- a companion HomeKit volume control accessory for that scene

Typical examples:

- "Office Bedtime" groups a few rooms, starts white noise, and sets quiet volumes
- "Whole House Line In" groups several rooms around a line-in source
- "Morning Music" starts a favorite and sets different room volumes

## What Works Today

- Live Sonos discovery from the Homebridge UI
- Friendly scene editor for picking rooms and sources
- Favorites that are playable over the local Sonos path
- Line-in scenes
- Grouping and ungrouping
- Scene test runs before saving
- Per-room volume overrides

## Current Limits

- This is still beta software
- Some complex Sonos favorites do not work reliably over the local-only path
- `TV` remains a transport-gated advanced option
- `Local + Cloud` is reserved for future self-hosted broker support and is not wired into playback yet

For most people, `Local Only` is the right mode today.

## Install

Install from the Homebridge UI by searching for `homebridge-sonos-scenes`, or from npm:

```bash
npm i homebridge-sonos-scenes
```

Then restart Homebridge.

## First-Time Setup

1. Open the plugin settings in Homebridge.
2. Click `Discover` to load your Sonos households, rooms, favorites, and inputs.
3. Click `New Scene`.
4. Name the scene.
5. Pick the rooms you want in `Scene Rooms`.
6. Choose a source such as `favorite` or `line in`.
7. Optionally set room volume values.
8. Click `Validate` to check the scene without changing playback.
9. Click `Run Test` to try it on your Sonos system.
10. Click `Save Scene Changes`.
11. Use Homebridge's footer `Save` button to write the full plugin config to disk.

After Homebridge reloads the config, the scene accessories should appear in Apple Home.

## Recommended Starting Point

If you are new to the plugin, start with:

- `Execution Mode`: `Local Only`
- a small scene with one or two rooms
- a known-good `favorite` or `line in` source

That gives you the smoothest first test.

## Troubleshooting

If a scene does not work the first time:

- run `Discover` again so the editor has a fresh Sonos snapshot
- use `Validate` before `Run Test`
- try a simpler local favorite or a line-in scene first
- check the Homebridge log for the scene run details
- restart Homebridge after updating the plugin

If Apple Home still shows stale or unsupported accessories after an update, close and reopen the Home app first.

## Feedback

Real-world feedback is especially helpful right now. Useful bug reports include:

- your Sonos speaker models
- whether the scene uses `favorite`, `line in`, or `tv`
- what happened when you clicked `Run Test`
- the relevant Homebridge log output

Open issues here:

- [GitHub Issues](https://github.com/applemanj/homebridge-sonos-scenes/issues)

## Advanced Docs

If you want the more technical details, use these docs:

- [Architecture and Developer Notes](docs/architecture.md)
- [Virtual Rooms Draft](docs/virtual-rooms.md)
- [Cloud Broker Contract](docs/cloud-broker.md)
- [Self-Hosted Broker Scaffold](broker/README.md)
- [Example Config](examples/config.example.json)
