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
const DEFAULT_RECONCILIATION_ATTEMPTS = 6;
const DEFAULT_RECONCILIATION_DELAY_MS = 150;

export interface PlaylistSortPort
  extends SpotifyPlaylistReadPort,
    SpotifyPlaylistReorderPort {}

export interface SortPlaylistOptions {
  readonly dryRun?: boolean;
  readonly deadlineMs?: number;
  readonly replanLimit?: number;
  readonly reconciliationAttempts?: number;
  readonly reconciliationDelayMs?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
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
  const reconciliationAttempts =
    options.reconciliationAttempts ?? DEFAULT_RECONCILIATION_ATTEMPTS;
  const reconciliationDelayMs =
    options.reconciliationDelayMs ?? DEFAULT_RECONCILIATION_DELAY_MS;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new PlaylistTidyError("VALIDATION_FAILED", "Deadline must be a positive number of milliseconds.");
  }
  if (!Number.isInteger(replanLimit) || replanLimit < 0) {
    throw new PlaylistTidyError("VALIDATION_FAILED", "Replan limit must be a non-negative integer.");
  }
  if (!Number.isInteger(reconciliationAttempts) || reconciliationAttempts < 1) {
    throw new PlaylistTidyError("VALIDATION_FAILED", "Reconciliation attempts must be a positive integer.");
  }
  if (!Number.isFinite(reconciliationDelayMs) || reconciliationDelayMs < 0) {
    throw new PlaylistTidyError("VALIDATION_FAILED", "Reconciliation delay must be a non-negative number of milliseconds.");
  }
  const deadline = now() + deadlineMs;

  const user = await spotify.getCurrentUser();
  let writeCalls = 0;
  let replans = 0;
  let firstSnapshot: string | undefined;
  let latestPlan: readonly RangeMove[] = [];

  planning: for (;;) {
    assertWithinDeadline(now, deadline);
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
        "The selected playlist is not owned by the authenticated Spotify user.",
      );
    }
    if (preWriteMetadata.snapshotId !== view.snapshotId) {
      replans = registerReplan(replans, replanLimit);
      continue;
    }

    let expectedState = view.occurrences;
    let currentSnapshot = view.snapshotId;

    for (const move of plan) {
      assertWithinDeadline(now, deadline);
      const expectedIntermediate = applyRangeMove(expectedState, move);
      try {
        currentSnapshot = await spotify.reorderPlaylistRange(playlistId, currentSnapshot, move);
        writeCalls += 1;
        expectedState = expectedIntermediate;
      } catch (error) {
        if (error instanceof PlaylistTidyError && error.code === "CONCURRENT_EDIT") {
          replans = registerReplan(replans, replanLimit);
          continue planning;
        }
        if (!(error instanceof PlaylistTidyError) || error.code !== "AMBIGUOUS_WRITE") throw error;
        writeCalls += 1;
        const live = await spotify.getCoherentPlaylist(playlistId);
        assertOwnership(live, user.id);
        if (!haveEqualMembership(view.occurrences, live.occurrences)) {
          replans = registerReplan(replans, replanLimit);
          continue planning;
        }
        if (haveEqualOrderedState(live.occurrences, expectedIntermediate)) {
          expectedState = expectedIntermediate;
          currentSnapshot = live.snapshotId;
          continue;
        }
        replans = registerReplan(replans, replanLimit);
        continue planning;
      }
    }

    const finalView = await reconcileAcknowledgedPlan({
      spotify,
      playlistId,
      ownerId: user.id,
      membershipBaseline: view.occurrences,
      expectedState,
      expectedSnapshot: currentSnapshot,
      attempts: reconciliationAttempts,
      delayMs: reconciliationDelayMs,
      sleep,
      now,
      deadline,
    });
    if (finalView === null) {
      replans = registerReplan(replans, replanLimit);
      continue;
    }
    if (
      !haveEqualMembership(view.occurrences, finalView.occurrences) ||
      !haveEqualOrderedState(finalView.occurrences, target) ||
      !isNewestFirst(finalView.occurrences)
    ) {
      throw new PlaylistTidyError(
        "INTEGRITY_FAILED",
        "The playlist failed final order or membership verification.",
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

interface ReconciliationContext {
  readonly spotify: PlaylistSortPort;
  readonly playlistId: string;
  readonly ownerId: string;
  readonly membershipBaseline: readonly PlaylistView["occurrences"][number][];
  readonly expectedState: readonly PlaylistView["occurrences"][number][];
  readonly expectedSnapshot: string;
  readonly attempts: number;
  readonly delayMs: number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => number;
  readonly deadline: number;
}

async function reconcileAcknowledgedPlan(
  context: ReconciliationContext,
): Promise<PlaylistView | null> {
  for (let attempt = 1; attempt <= context.attempts; attempt += 1) {
    assertWithinDeadline(context.now, context.deadline);
    const live = await context.spotify.getCoherentPlaylist(context.playlistId);
    assertOwnership(live, context.ownerId);
    if (!haveEqualMembership(context.membershipBaseline, live.occurrences)) return null;
    if (haveEqualOrderedState(live.occurrences, context.expectedState)) return live;
    if (live.snapshotId === context.expectedSnapshot) return null;
    if (attempt < context.attempts) {
      const delay = Math.min(context.delayMs * 2 ** (attempt - 1), 1_000);
      await context.sleep(delay);
    }
  }
  throw new PlaylistTidyError(
    "AMBIGUOUS_WRITE",
    "Spotify accepted the reorder plan, but the final playlist did not become readable in time. No further writes were attempted.",
  );
}

function assertOwnership(view: PlaylistView, userId: string): void {
  if (view.ownerId !== userId) {
    throw new PlaylistTidyError(
      "OWNER_MISMATCH",
      "The selected playlist is not owned by the authenticated Spotify user.",
    );
  }
}

function assertWithinDeadline(now: () => number, deadline: number): void {
  if (now() > deadline) {
    throw new PlaylistTidyError(
      "DEADLINE_EXCEEDED",
      "The playlist exceeded its sorting deadline.",
    );
  }
}

function registerReplan(current: number, limit: number): number {
  const next = current + 1;
  if (next > limit) {
    throw new PlaylistTidyError(
      "CONCURRENT_EDIT",
      `The playlist continued changing after ${String(limit)} replans.`,
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

