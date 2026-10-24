// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it } from "vitest";
import type { PlaylistTidyError } from "../../../core/errors.js";
import type { PlaylistView } from "../../../core/playlist/types.js";
import type { SpotifyPlaylistReadPort } from "../../ports/SpotifyPlaylistPort.js";
import { previewPlaylistSort } from "../previewPlaylistSort.js";

const view: PlaylistView = {
  playlistId: "playlist",
  ownerId: "owner",
  snapshotId: "snapshot-a",
  occurrences: [
    { originalPosition: 0, uri: "old", itemType: "track", addedAt: "2026-01-01", addedById: "owner" },
    { originalPosition: 1, uri: "new", itemType: "track", addedAt: "2026-01-02", addedById: "owner" },
  ],
};

function port(ownerId = "owner"): SpotifyPlaylistReadPort {
  return {
    getCurrentUser: async () => ({ id: "owner" }),
    getPlaylistMetadata: async () => ({ id: "playlist", ownerId, snapshotId: "snapshot-a" }),
    getCoherentPlaylist: async () => ({ ...view, ownerId }),
  };
}

describe("previewPlaylistSort", () => {
  it("returns a deterministic write-free plan for an owned playlist", async () => {
    const preview = await previewPlaylistSort(port(), "playlist");
    expect(preview.moves).toHaveLength(1);
    expect(preview.target.map(({ uri }) => uri)).toEqual(["new", "old"]);
  });

  it("fails before reading contents when ownership does not match", async () => {
    await expect(previewPlaylistSort(port("someone-else"), "playlist")).rejects.toMatchObject<
      Partial<PlaylistTidyError>
    >({ code: "OWNER_MISMATCH" });
  });
});

