// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it } from "vitest";
import { PlaylistTidyError } from "../../core/errors.js";
import { applyRangeMove } from "../../core/playlist/transition.js";
import type { PlaylistOccurrence, PlaylistView, RangeMove } from "../../core/playlist/types.js";
import type { PlaylistSortPort } from "./sortPlaylist.js";
import { sortPlaylist } from "./sortPlaylist.js";

class MemorySpotifyPort implements PlaylistSortPort {
  public readonly userId = "owner";
  public ownerId = "owner";
  public reorderCalls = 0;
  public coherentReads = 0;
  public ambiguousMode: "none" | "before-apply" | "after-apply" = "none";
  public mutateAfterWrite = false;
  private snapshotVersion = 1;

  public constructor(public occurrences: readonly PlaylistOccurrence[]) {}

  public async getCurrentUser(): Promise<{ readonly id: string }> {
    return { id: this.userId };
  }

  public async getPlaylistMetadata(playlistId: string): Promise<{
    readonly id: string;
    readonly ownerId: string;
    readonly snapshotId: string;
  }> {
    return { id: playlistId, ownerId: this.ownerId, snapshotId: this.snapshotId };
  }

  public async getCoherentPlaylist(playlistId: string): Promise<PlaylistView> {
    this.coherentReads += 1;
    if (this.mutateAfterWrite && this.reorderCalls > 0) {
      this.mutateAfterWrite = false;
      this.occurrences = [
        ...this.occurrences,
        createOccurrence(this.occurrences.length, "2025-01-01T00:00:00.000Z", "injected"),
      ];
      this.snapshotVersion += 1;
    }
    return {
      playlistId,
      ownerId: this.ownerId,
      snapshotId: this.snapshotId,
      occurrences: this.occurrences.map((occurrence, originalPosition) => ({
        ...occurrence,
        originalPosition,
      })),
    };
  }

  public async reorderPlaylistRange(
    _playlistId: string,
    snapshotId: string,
    move: RangeMove,
  ): Promise<string> {
    this.reorderCalls += 1;
    if (snapshotId !== this.snapshotId) {
      throw new Error("stale snapshot");
    }
    if (this.ambiguousMode === "before-apply") {
      this.ambiguousMode = "none";
      throw createAmbiguousWriteError();
    }
    this.occurrences = applyRangeMove(this.occurrences, move);
    this.snapshotVersion += 1;
    if (this.ambiguousMode === "after-apply") {
      this.ambiguousMode = "none";
      throw createAmbiguousWriteError();
    }
    return this.snapshotId;
  }

  private get snapshotId(): string {
    return `snapshot-${String(this.snapshotVersion)}`;
  }
}

function createOccurrence(
  originalPosition: number,
  addedAt: string | null,
  uri = `spotify:track:${String(originalPosition)}`,
): PlaylistOccurrence {
  return {
    originalPosition,
    uri,
    itemType: "track",
    addedAt,
    addedById: "owner",
  };
}

function createUnsortedPort(): MemorySpotifyPort {
  return new MemorySpotifyPort([
    createOccurrence(0, "2026-01-01T00:00:00.000Z", "old"),
    createOccurrence(1, "2026-01-02T00:00:00.000Z", "new"),
  ]);
}

function createAmbiguousWriteError(): PlaylistTidyError {
  return new PlaylistTidyError("AMBIGUOUS_WRITE", "ambiguous");
}

describe("sortPlaylist", () => {
  it("sorts an owned playlist and reconciles the acknowledged write", async () => {
    const spotify = createUnsortedPort();
    const result = await sortPlaylist(spotify, "playlist");
    expect(result).toMatchObject({ status: "sorted", writeCalls: 1, replans: 0 });
    expect(spotify.occurrences.map(({ uri }) => uri)).toEqual(["new", "old"]);
    expect(spotify.coherentReads).toBeGreaterThanOrEqual(2);
  });

  it("previews without issuing a reorder", async () => {
    const spotify = createUnsortedPort();
    const result = await sortPlaylist(spotify, "playlist", { dryRun: true });
    expect(result).toMatchObject({ status: "previewed", writeCalls: 0 });
    expect(result.plannedMoves).toHaveLength(1);
    expect(spotify.reorderCalls).toBe(0);
  });

  it("recognizes an ambiguous write that was already applied without replaying it", async () => {
    const spotify = createUnsortedPort();
    spotify.ambiguousMode = "after-apply";
    const result = await sortPlaylist(spotify, "playlist");
    expect(result.status).toBe("sorted");
    expect(spotify.reorderCalls).toBe(1);
  });

  it("replans before reissuing a write that failed before application", async () => {
    const spotify = createUnsortedPort();
    spotify.ambiguousMode = "before-apply";
    const result = await sortPlaylist(spotify, "playlist");
    expect(result).toMatchObject({ status: "sorted", writeCalls: 2, replans: 1 });
    expect(spotify.reorderCalls).toBe(2);
  });

  it("stops when concurrent membership changes exceed the replan policy", async () => {
    const spotify = createUnsortedPort();
    spotify.mutateAfterWrite = true;
    await expect(sortPlaylist(spotify, "playlist", { replanLimit: 0 })).rejects.toMatchObject<
      Partial<PlaylistTidyError>
    >({ code: "CONCURRENT_EDIT" });
  });

  it("rejects a playlist owned by someone else without writing", async () => {
    const spotify = createUnsortedPort();
    spotify.ownerId = "someone-else";
    await expect(sortPlaylist(spotify, "playlist")).rejects.toMatchObject<
      Partial<PlaylistTidyError>
    >({ code: "OWNER_MISMATCH" });
    expect(spotify.reorderCalls).toBe(0);
  });

  it("enforces the per-playlist deadline before a write", async () => {
    const spotify = createUnsortedPort();
    let currentTime = 0;
    const now = (): number => {
      currentTime += 10;
      return currentTime;
    };
    await expect(
      sortPlaylist(spotify, "playlist", { deadlineMs: 5, now }),
    ).rejects.toMatchObject<Partial<PlaylistTidyError>>({ code: "DEADLINE_EXCEEDED" });
    expect(spotify.reorderCalls).toBe(0);
  });
});

