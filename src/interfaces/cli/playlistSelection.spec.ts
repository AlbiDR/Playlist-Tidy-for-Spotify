// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it, vi } from "vitest";
import { parsePlaylistIds, resolvePlaylistIds } from "./playlistSelection.js";

const firstId = "A123456789012345678901";
const secondId = "B123456789012345678901";

describe("scheduled playlist selection", () => {
  it("discovers every currently owned playlist when configured for all", async () => {
    const spotify = {
      getCurrentUser: vi.fn(async () => ({ id: "owner" })),
      getOwnedPlaylists: vi.fn(async () => [
        { id: firstId, name: "One", ownerId: "owner", snapshotId: "a", itemCount: 1, isPublic: true },
        { id: secondId, name: "Two", ownerId: "owner", snapshotId: "b", itemCount: 2, isPublic: false },
      ]),
    };
    await expect(resolvePlaylistIds(spotify, "ALL")).resolves.toEqual([firstId, secondId]);
    expect(spotify.getOwnedPlaylists).toHaveBeenCalledWith("owner");
  });

  it("accepts a deduplicated fixed subset without catalog discovery", async () => {
    expect(parsePlaylistIds(`${firstId}, ${secondId} ${firstId}`)).toEqual([firstId, secondId]);
  });

  it("rejects malformed fixed playlist identifiers", () => {
    expect(() => parsePlaylistIds("not-a-playlist")).toThrow("PLAYLIST_IDS");
  });
});
