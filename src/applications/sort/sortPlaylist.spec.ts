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
  public staleReadsAfterWrite = 0;
  private snapshotVersion = 1;
  private remainingStaleReads = 0;
  private staleView?: Pick<PlaylistView, "snapshotId" | "occurrences">;

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
    if (this.remainingStaleReads > 0 && this.staleView !== undefined) {
      this.remainingStaleReads -= 1;
      return {
        playlistId,
        ownerId: this.ownerId,
        snapshotId: this.staleView.snapshotId,
        occurrences: this.staleView.occurrences.map((occurrence, originalPosition) => ({
          ...occurrence,
          originalPosition,
        })),
      };
    }
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
    const staleView = {
      snapshotId: this.snapshotId,
      occurrences: this.occurrences,
    };
    this.occurrences = applyRangeMove(this.occurrences, move);
    this.snapshotVersion += 1;
    this.staleView = staleView;
    this.remainingStaleReads = this.staleReadsAfterWrite;
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
    expect(spotify.coherentReads).toBe(2);
  });

  it("chains acknowledged snapshots and reads the full playlist only once after all moves", async () => {
    const spotify = new MemorySpotifyPort([
      createOccurrence(0, "2026-01-01T00:00:00.000Z", "one"),
      createOccurrence(1, "2026-01-04T00:00:00.000Z", "four"),
      createOccurrence(2, "2026-01-02T00:00:00.000Z", "two"),
      createOccurrence(3, "2026-01-03T00:00:00.000Z", "three"),
    ]);
    const result = await sortPlaylist(spotify, "playlist");
    expect(result.writeCalls).toBeGreaterThan(1);
    expect(spotify.coherentReads).toBe(2);
    expect(spotify.occurrences.map(({ uri }) => uri)).toEqual(["four", "three", "two", "one"]);
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

  it("waits for an acknowledged reorder to become visible without replaying it", async () => {
    const spotify = createUnsortedPort();
    spotify.staleReadsAfterWrite = 2;
    const delays: number[] = [];
    const result = await sortPlaylist(spotify, "playlist", {
      reconciliationDelayMs: 1,
      sleep: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });
    expect(result).toMatchObject({ status: "sorted", writeCalls: 1, replans: 0 });
    expect(spotify.reorderCalls).toBe(1);
    expect(delays).toEqual([1, 2]);
  });

  it("does not replay an acknowledged reorder while reads remain stale", async () => {
    const spotify = createUnsortedPort();
    spotify.staleReadsAfterWrite = 100;
    await expect(
      sortPlaylist(spotify, "playlist", {
        reconciliationAttempts: 3,
        reconciliationDelayMs: 0,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject<Partial<PlaylistTidyError>>({ code: "AMBIGUOUS_WRITE" });
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

