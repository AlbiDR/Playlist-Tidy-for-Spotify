// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

export type PlaylistItemType = "track" | "episode" | "local" | "unknown";

export interface PlaylistOccurrence {
  readonly originalPosition: number;
  readonly uri: string | null;
  readonly itemType: PlaylistItemType;
  readonly addedAt: string | null;
  readonly addedById: string | null;
}

export interface PlaylistView {
  readonly playlistId: string;
  readonly ownerId: string;
  readonly snapshotId: string;
  readonly occurrences: readonly PlaylistOccurrence[];
}

export interface RangeMove {
  readonly rangeStart: number;
  readonly insertBefore: number;
  readonly rangeLength: number;
}

