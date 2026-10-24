// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import type { PlaylistOccurrence } from "./types.js";

function compareOccurrences(
  left: PlaylistOccurrence,
  right: PlaylistOccurrence,
): number {
  if (left.addedAt === null && right.addedAt === null) {
    return left.originalPosition - right.originalPosition;
  }
  if (left.addedAt === null) return 1;
  if (right.addedAt === null) return -1;
  const byDate = right.addedAt.localeCompare(left.addedAt);
  return byDate || left.originalPosition - right.originalPosition;
}

export function getTargetOrder(
  occurrences: readonly PlaylistOccurrence[],
): readonly PlaylistOccurrence[] {
  return [...occurrences].sort(compareOccurrences);
}

export function isNewestFirst(
  occurrences: readonly PlaylistOccurrence[],
): boolean {
  for (let index = 1; index < occurrences.length; index += 1) {
    const previous = occurrences[index - 1];
    const current = occurrences[index];
    if (previous === undefined || current === undefined) return false;
    if (previous.addedAt === null && current.addedAt !== null) return false;
    if (
      previous.addedAt !== null &&
      current.addedAt !== null &&
      previous.addedAt < current.addedAt
    ) {
      return false;
    }
  }
  return true;
}

