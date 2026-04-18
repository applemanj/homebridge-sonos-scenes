import type { TopologySnapshot } from "./types";

export const sampleTopology: TopologySnapshot = {
  capturedAt: "2026-04-18T00:00:00.000Z",
  origin: "fixture",
  households: [
    {
      id: "local-household",
      displayName: "Local Sonos",
      players: [
        {
          id: "RINCON_UPPER_LEVEL",
          name: "Upper Level",
          model: "Sonos Amp",
          capabilities: ["PLAYBACK", "LINE_IN", "AIRPLAY"],
          deviceIds: ["RINCON_UPPER_LEVEL"],
          groupId: "GROUP_UPPER_LEVEL",
          isCoordinator: true,
          fixedVolume: false,
          sourceOptions: ["line_in", "favorite"],
        },
        {
          id: "RINCON_PRIMARY_BEDROOM",
          name: "Primary Bedroom",
          model: "Sonos Beam",
          capabilities: ["PLAYBACK", "AIRPLAY"],
          deviceIds: ["RINCON_PRIMARY_BEDROOM"],
          groupId: "GROUP_PRIMARY_BEDROOM",
          isCoordinator: true,
          fixedVolume: false,
          sourceOptions: ["favorite"],
        },
      ],
      groups: [
        {
          id: "GROUP_UPPER_LEVEL",
          name: "Upper Level",
          coordinatorId: "RINCON_UPPER_LEVEL",
          playerIds: ["RINCON_UPPER_LEVEL"],
          playbackState: "PLAYBACK_STATE_IDLE",
        },
        {
          id: "GROUP_PRIMARY_BEDROOM",
          name: "Primary Bedroom",
          coordinatorId: "RINCON_PRIMARY_BEDROOM",
          playerIds: ["RINCON_PRIMARY_BEDROOM"],
          playbackState: "PLAYBACK_STATE_IDLE",
        },
      ],
      favorites: [
        {
          id: "favorite-line-in-demo",
          name: "Line-In Demo",
          uri: "x-sonosapi-stream:s123?sid=254&flags=8224&sn=0",
        },
        {
          id: "favorite-kexp",
          name: "KEXP",
          uri: "x-sonosapi-stream:s21606?sid=254&flags=8224&sn=0",
        },
      ],
    },
  ],
};
