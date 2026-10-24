// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { PlaylistTidyError } from "../../core/errors.js";
import { getTargetOrder, planPlaylistSort } from "../../core/playlist/index.js";
import type { PlaylistOccurrence, PlaylistView, RangeMove } from "../../core/playlist/types.js";
import type { SpotifyPlaylistReadPort } from "../ports/SpotifyPlaylistPort.js";

export interface PlaylistSortPreview {
  readonly playlistId: string;
  readonly snapshotId: string;
  readonly occurrenceCount: number;
  readonly moves: readonly RangeMove[];
  readonly target: readonly PlaylistOccurrence[];
  readonly view: PlaylistView;
}

export async function previewPlaylistSort(
  spotify: SpotifyPlaylistReadPort,
  playlistId: string,
): Promise<PlaylistSortPreview> {
  const [user, metadata] = await Promise.all([
    spotify.getCurrentUser(),
    spotify.getPlaylistMetadata(playlistId),
  ]);
  if (metadata.ownerId !== user.id) {
    throw new PlaylistTidyError(
      "OWNER_MISMATCH",
      "The selected playlist is not owned by the authenticated Spotify user.",
    );
  }
  const view = await spotify.getCoherentPlaylist(playlistId);
  if (view.ownerId !== user.id) {
    throw new PlaylistTidyError(
      "OWNER_MISMATCH",
      "The selected playlist changed ownership or returned inconsistent ownership metadata.",
    );
  }
  return {
    playlistId,
    snapshotId: view.snapshotId,
    occurrenceCount: view.occurrences.length,
    moves: planPlaylistSort(view.occurrences),
    target: getTargetOrder(view.occurrences),
    view,
  };
}

