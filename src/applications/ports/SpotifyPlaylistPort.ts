// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import type { PlaylistView, RangeMove } from "../../core/playlist/types.js";

export interface SpotifyUser {
  readonly id: string;
}

export interface SpotifyPlaylistSummary {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly snapshotId: string;
  readonly itemCount: number;
  readonly isPublic: boolean | null;
}

export interface PlaylistMetadata {
  readonly id: string;
  readonly ownerId: string;
  readonly snapshotId: string;
}

export interface SpotifyPlaylistReadPort {
  getCurrentUser(): Promise<SpotifyUser>;
  getPlaylistMetadata(playlistId: string): Promise<PlaylistMetadata>;
  getCoherentPlaylist(playlistId: string): Promise<PlaylistView>;
}

export interface SpotifyPlaylistReorderPort {
  reorderPlaylistRange(
    playlistId: string,
    snapshotId: string,
    move: RangeMove,
  ): Promise<string>;
}

export interface SpotifyPlaylistCatalogPort {
  getOwnedPlaylists(ownerId: string): Promise<readonly SpotifyPlaylistSummary[]>;
}

