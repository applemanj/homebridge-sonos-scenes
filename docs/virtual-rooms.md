# Virtual Rooms Draft

This document sketches a possible config shape for exposing the left and right outputs of a single Sonos Amp as separate HomeKit accessories.

The user-facing concept is a `virtual room`. Internally, the runtime would likely model these as channel-aware virtual accessories backed by one physical Amp.

## Goal

Support setups where one Sonos Amp feeds speakers in two physical rooms, for example:

- left channel: bedroom
- right channel: bathroom

Both sides still share the same Sonos playback source. The feature is only about per-side `on/off` and per-side volume-style control.

## Recommended v1 Shape

Recommended top-level key:

```json
"virtualRooms": []
```

Recommended item shape:

```json
{
  "id": "bedroom-ceiling",
  "name": "Bedroom Ceiling",
  "householdId": "local-household",
  "ampPlayerId": "RINCON_UPSTAIRS_AMP",
  "channel": "left",
  "defaultVolume": 28,
  "maxVolume": 55,
  "onBehavior": {
    "kind": "restore_last"
  },
  "offBehavior": {
    "kind": "mute"
  },
  "lastActiveBehavior": {
    "kind": "pause"
  }
}
```

Example with both sides of one Amp:

```json
{
  "platform": "SonosScenes",
  "name": "Sonos Scenes",
  "virtualRooms": [
    {
      "id": "primary-bedroom-ceiling",
      "name": "Primary Bedroom Ceiling",
      "householdId": "local-household",
      "ampPlayerId": "RINCON_AMP_UPSTAIRS",
      "channel": "left",
      "defaultVolume": 30,
      "maxVolume": 55,
      "onBehavior": {
        "kind": "restore_last"
      },
      "offBehavior": {
        "kind": "mute"
      },
      "lastActiveBehavior": {
        "kind": "pause"
      }
    },
    {
      "id": "primary-bathroom-ceiling",
      "name": "Primary Bathroom Ceiling",
      "householdId": "local-household",
      "ampPlayerId": "RINCON_AMP_UPSTAIRS",
      "channel": "right",
      "defaultVolume": 22,
      "maxVolume": 40,
      "onBehavior": {
        "kind": "restore_last"
      },
      "offBehavior": {
        "kind": "mute"
      },
      "lastActiveBehavior": {
        "kind": "pause"
      }
    }
  ]
}
```

## Field Notes

- `id`
  Stable identifier for the Homebridge accessory pair and internal bookkeeping.
- `name`
  User-facing name shown in Homebridge and Apple Home.
- `householdId`
  Same pattern as scenes. Keeps the config anchored to a discovered Sonos household.
- `ampPlayerId`
  The Sonos player id of the Amp that owns both channels.
- `channel`
  One of `left` or `right`.
- `defaultVolume`
  Starting channel volume to use when turning the virtual room on and no previous active value is known.
- `maxVolume`
  Safety clamp for the virtual room so a bathroom or bedroom side cannot be driven past a chosen level from HomeKit.
- `onBehavior.kind`
  Suggested starter values:
  - `restore_last`
  - `default_volume`
- `offBehavior.kind`
  Suggested starter values:
  - `mute`
  - `volume_zero`
- `lastActiveBehavior.kind`
  Behavior to apply when this room is turned off and it was the last unmuted virtual room on that Amp.
  Suggested starter values:
  - `none`
  - `pause`
  - `stop`
  - `mute_master`

## Why Flat Instead Of Nested

For a first release, a flat `virtualRooms` array is probably easier than nesting room definitions under an Amp object.

Benefits:

- matches the existing `scenes` config style
- makes each HomeKit accessory definition explicit
- keeps the custom UI simpler
- avoids forcing a separate Amp-management screen before the feature is proven

If the feature grows beyond simple left/right virtual rooms, we can still refactor later to a more Amp-centric config shape.

## Validation Rules

The validator should enforce at least:

- `id` must be unique
- `name` must be non-empty
- `householdId` must resolve to a discovered household
- `ampPlayerId` must resolve to a discovered player
- the discovered player should be a Sonos Amp, or at minimum a device that supports left/right channel control
- only one `left` and one `right` room may exist for the same `ampPlayerId`
- all rooms sharing the same `ampPlayerId` must belong to the same `householdId`
- all rooms sharing the same `ampPlayerId` should agree on `lastActiveBehavior`
- `defaultVolume` and `maxVolume` must stay within `0-100`
- if both `defaultVolume` and `maxVolume` are set, `defaultVolume` must not exceed `maxVolume`

## Runtime Notes

The runtime would likely map these controls as follows:

- room `on`: unmute the room's channel and restore a volume
- room `off`: mute the room's channel
- room volume: set the room's channel volume, not the Amp master volume

Important constraints:

- both virtual rooms still share one playback source
- HomeKit state may need to be partly optimistic if Sonos events do not report left/right channel state with the same fidelity as master volume/mute
- master volume changes from outside the plugin can still affect the perceived loudness of both virtual rooms

## Open Questions

- Should `off` always mean `mute`, or should we ever drive channel volume to `0` instead?
- Should the feature expose a companion volume accessory, like scenes do today, or a single combined accessory with `On` and `Brightness`?
- Do we want a per-Amp shared config object later for policies like `lastActiveBehavior`?
- Should v1 support creating only one side of an Amp, or require both `left` and `right` to be configured together?
