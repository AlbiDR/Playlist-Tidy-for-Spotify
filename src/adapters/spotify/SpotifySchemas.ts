// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import * as v from "valibot";

const NonEmptyStringSchema = v.pipe(v.string(), v.minLength(1));
const NonNegativeIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(0));

export const SpotifyUserSchema = v.object({
  id: NonEmptyStringSchema,
});

export const SpotifyPlaylistMetadataSchema = v.object({
  id: NonEmptyStringSchema,
  owner: v.object({ id: NonEmptyStringSchema }),
  snapshot_id: NonEmptyStringSchema,
});

const SpotifyContentItemSchema = v.object({
  uri: v.nullable(NonEmptyStringSchema),
  type: NonEmptyStringSchema,
  is_local: v.optional(v.boolean(), false),
});

export const SpotifyPlaylistItemSchema = v.object({
  added_at: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  added_by: v.nullable(v.object({ id: NonEmptyStringSchema })),
  item: v.nullable(SpotifyContentItemSchema),
});

export const SpotifyPlaylistItemsPageSchema = v.object({
  items: v.array(SpotifyPlaylistItemSchema),
  next: v.nullable(NonEmptyStringSchema),
  total: NonNegativeIntegerSchema,
});

export const SpotifyReorderResponseSchema = v.object({
  snapshot_id: NonEmptyStringSchema,
});

export const SpotifyErrorResponseSchema = v.object({
  error: v.object({
    reason: v.optional(v.string()),
  }),
});

const SpotifyPlaylistSummarySchema = v.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  owner: v.object({ id: NonEmptyStringSchema }),
  snapshot_id: NonEmptyStringSchema,
  public: v.nullable(v.boolean()),
  items: v.object({ total: NonNegativeIntegerSchema }),
});

export const SpotifyPlaylistCatalogPageSchema = v.object({
  items: v.array(SpotifyPlaylistSummarySchema),
  next: v.nullable(NonEmptyStringSchema),
  total: NonNegativeIntegerSchema,
});

export type SpotifyPlaylistItemDto = v.InferOutput<typeof SpotifyPlaylistItemSchema>;
export type SpotifyPlaylistItemsPageDto = v.InferOutput<typeof SpotifyPlaylistItemsPageSchema>;

