// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import * as v from "valibot";

export const SpotifyUserSchema = v.object({
  id: v.string(),
});

export const SpotifyPlaylistMetadataSchema = v.object({
  id: v.string(),
  owner: v.object({ id: v.string() }),
  snapshot_id: v.string(),
});

const SpotifyContentItemSchema = v.object({
  uri: v.nullable(v.string()),
  type: v.string(),
  is_local: v.optional(v.boolean(), false),
});

export const SpotifyPlaylistItemSchema = v.object({
  added_at: v.nullable(v.string()),
  added_by: v.nullable(v.object({ id: v.string() })),
  item: v.nullable(SpotifyContentItemSchema),
});

export const SpotifyPlaylistItemsPageSchema = v.object({
  items: v.array(SpotifyPlaylistItemSchema),
  next: v.nullable(v.string()),
  total: v.number(),
});

export const SpotifyReorderResponseSchema = v.object({
  snapshot_id: v.string(),
});

export type SpotifyPlaylistItemDto = v.InferOutput<typeof SpotifyPlaylistItemSchema>;
export type SpotifyPlaylistItemsPageDto = v.InferOutput<typeof SpotifyPlaylistItemsPageSchema>;

