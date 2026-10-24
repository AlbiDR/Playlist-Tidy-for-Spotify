// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import type { PlaylistOccurrence } from "../core/playlist/types.js";

export function occurrence(
  originalPosition: number,
  addedAt: string | null,
  overrides: Partial<PlaylistOccurrence> = {},
): PlaylistOccurrence {
  return {
    originalPosition,
    uri: `spotify:track:${String(originalPosition)}`,
    itemType: "track",
    addedAt,
    addedById: "owner",
    ...overrides,
  };
}

