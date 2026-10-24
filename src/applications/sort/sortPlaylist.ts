// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { PlaylistTidyError } from "../../core/errors.js";
import {
  applyRangeMove,
  getTargetOrder,
  haveEqualMembership,
  haveEqualOrderedState,
  isNewestFirst,
  planPlaylistSort,
} from "../../core/playlist/index.js";
import type { PlaylistView, RangeMove } from "../../core/playlist/types.js";
import type {
  SpotifyPlaylistReadPort,
  SpotifyPlaylistReorderPort,
} from "../ports/SpotifyPlaylistPort.js";

const DEFAULT_DEADLINE_MS = 5 * 60 * 1000;
const DEFAULT_REPLAN_LIMIT = 3;

export interface PlaylistSortPort
  extends SpotifyPlaylistReadPort,
    SpotifyPlaylistReorderPort {}

export interface SortPlaylistOptions {
  readonly dryRun?: boolean;
  readonly deadlineMs?: number;
  readonly replanLimit?: number;
  readonly now?: () => number;
}

export interface SortPlaylistResult {
  readonly playlistId: string;
  readonly status: "already-sorted" | "previewed" | "sorted";
  readonly snapshotBefore: string;
  readonly snapshotAfter: string;
  readonly plannedMoves: readonly RangeMove[];
  readonly writeCalls: number;
  readonly replans: number;
  readonly occurrenceCount: number;
}

export async function sortPlaylist(
  spotify: PlaylistSortPort,
  playlistId: string,
  options: SortPlaylistOptions = {},
): Promise<SortPlaylistResult> {
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const replanLimit = options.replanLimit ?? DEFAULT_REPLAN_LIMIT;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new PlaylistTidyError("VALIDATION_FAILED", "Deadline must be a positive number of milliseconds.");
  }
  if (!Number.isInteger(replanLimit) || replanLimit < 0) {
    throw new PlaylistTidyError("VALIDATION_FAILED", "Replan limit must be a non-negative integer.");
  }
  const deadline = now() + deadlineMs;

  const user = await spotify.getCurrentUser();
  let writeCalls = 0;
  let replans = 0;
  let firstSnapshot: string | undefined;
  let latestPlan: readonly RangeMove[] = [];

  planning: for (;;) {
    assertWithinDeadline(now, deadline, playlistId);
    const view = await spotify.getCoherentPlaylist(playlistId);
    assertOwnership(view, user.id);
    firstSnapshot ??= view.snapshotId;

    const target = getTargetOrder(view.occurrences);
    const plan = planPlaylistSort(view.occurrences);
    latestPlan = plan;

    if (options.dryRun === true) {
      return createResult(
        playlistId,
        "previewed",
        firstSnapshot,
        view.snapshotId,
        latestPlan,
        writeCalls,
        replans,
        view.occurrences.length,
      );
    }
    if (plan.length === 0) {
      return createResult(
        playlistId,
        writeCalls === 0 ? "already-sorted" : "sorted",
        firstSnapshot,
        view.snapshotId,
        latestPlan,
        writeCalls,
        replans,
        view.occurrences.length,
      );
    }

    const preWriteMetadata = await spotify.getPlaylistMetadata(playlistId);
    if (preWriteMetadata.ownerId !== user.id) {
      throw new PlaylistTidyError(
        "OWNER_MISMATCH",
        `Playlist ${playlistId} is not owned by the authenticated Spotify user.`,
      );
    }
    if (preWriteMetadata.snapshotId !== view.snapshotId) {
      replans = registerReplan(replans, replanLimit, playlistId);
      continue;
    }

    let expectedState = view.occurrences;
    let currentSnapshot = view.snapshotId;

    for (const move of plan) {
      assertWithinDeadline(now, deadline, playlistId);
      const expectedIntermediate = applyRangeMove(expectedState, move);
      let returnedSnapshot: string;
      try {
        returnedSnapshot = await spotify.reorderPlaylistRange(playlistId, currentSnapshot, move);
        writeCalls += 1;
      } catch (error) {
        if (error instanceof PlaylistTidyError && error.code === "CONCURRENT_EDIT") {
          replans = registerReplan(replans, replanLimit, playlistId);
          continue planning;
        }
        if (!(error instanceof PlaylistTidyError) || error.code !== "AMBIGUOUS_WRITE") throw error;
        writeCalls += 1;
        const live = await spotify.getCoherentPlaylist(playlistId);
        assertOwnership(live, user.id);
        if (!haveEqualMembership(view.occurrences, live.occurrences)) {
          replans = registerReplan(replans, replanLimit, playlistId);
          continue planning;
        }
        if (haveEqualOrderedState(live.occurrences, expectedIntermediate)) {
          expectedState = expectedIntermediate;
          currentSnapshot = live.snapshotId;
          continue;
        }
        replans = registerReplan(replans, replanLimit, playlistId);
        continue planning;
      }

      const live = await spotify.getCoherentPlaylist(playlistId);
      assertOwnership(live, user.id);
      if (
        live.snapshotId !== returnedSnapshot ||
        !haveEqualMembership(view.occurrences, live.occurrences) ||
        !haveEqualOrderedState(live.occurrences, expectedIntermediate)
      ) {
        replans = registerReplan(replans, replanLimit, playlistId);
        continue planning;
      }
      expectedState = expectedIntermediate;
      currentSnapshot = live.snapshotId;
    }

    const finalView: PlaylistView = {
      playlistId,
      ownerId: view.ownerId,
      snapshotId: currentSnapshot,
      occurrences: expectedState,
    };
    if (
      !haveEqualMembership(view.occurrences, finalView.occurrences) ||
      !haveEqualOrderedState(finalView.occurrences, target) ||
      !isNewestFirst(finalView.occurrences)
    ) {
      throw new PlaylistTidyError(
        "INTEGRITY_FAILED",
        `Playlist ${playlistId} failed final order or membership verification.`,
      );
    }
    return createResult(
      playlistId,
      "sorted",
      firstSnapshot,
      currentSnapshot,
      latestPlan,
      writeCalls,
      replans,
      finalView.occurrences.length,
    );
  }
}

function assertOwnership(view: PlaylistView, userId: string): void {
  if (view.ownerId !== userId) {
    throw new PlaylistTidyError(
      "OWNER_MISMATCH",
      `Playlist ${view.playlistId} is not owned by the authenticated Spotify user.`,
    );
  }
}

function assertWithinDeadline(now: () => number, deadline: number, playlistId: string): void {
  if (now() > deadline) {
    throw new PlaylistTidyError(
      "DEADLINE_EXCEEDED",
      `Playlist ${playlistId} exceeded its sorting deadline.`,
    );
  }
}

function registerReplan(current: number, limit: number, playlistId: string): number {
  const next = current + 1;
  if (next > limit) {
    throw new PlaylistTidyError(
      "CONCURRENT_EDIT",
      `Playlist ${playlistId} continued changing after ${String(limit)} replans.`,
    );
  }
  return next;
}

function createResult(
  playlistId: string,
  status: SortPlaylistResult["status"],
  snapshotBefore: string,
  snapshotAfter: string,
  plannedMoves: readonly RangeMove[],
  writeCalls: number,
  replans: number,
  occurrenceCount: number,
): SortPlaylistResult {
  return {
    playlistId,
    status,
    snapshotBefore,
    snapshotAfter,
    plannedMoves,
    writeCalls,
    replans,
    occurrenceCount,
  };
}

