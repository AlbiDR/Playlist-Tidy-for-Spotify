// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import type { SpotifyPlaylistCatalogPort, SpotifyPlaylistReadPort } from "../../applications/ports/SpotifyPlaylistPort.js";
import { PlaylistTidyError } from "../../core/errors.js";

const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9]{22}$/u;

type PlaylistDiscoveryPort = Pick<SpotifyPlaylistReadPort, "getCurrentUser"> & SpotifyPlaylistCatalogPort;

export async function resolvePlaylistIds(
  spotify: PlaylistDiscoveryPort,
  configuration: string,
): Promise<readonly string[]> {
  if (configuration.trim().toLowerCase() !== "all") return parsePlaylistIds(configuration);
  const user = await spotify.getCurrentUser();
  const playlists = await spotify.getOwnedPlaylists(user.id);
  return playlists.map(({ id }) => id);
}

export function parsePlaylistIds(value: string): readonly string[] {
  const ids = [...new Set(value.split(/[\s,]+/u).map((entry) => entry.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.some((id) => !PLAYLIST_ID_PATTERN.test(id))) {
    throw new PlaylistTidyError(
      "VALIDATION_FAILED",
      "PLAYLIST_IDS must be `all` or contain comma- or whitespace-separated Spotify playlist IDs.",
    );
  }
  return ids;
}
