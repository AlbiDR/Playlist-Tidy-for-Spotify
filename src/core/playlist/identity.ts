// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import type { PlaylistOccurrence } from "./types.js";

const FIELD_SEPARATOR = "\u001f";

export function getMembershipKey(occurrence: PlaylistOccurrence): string {
  return occurrence.uri ?? `null|${occurrence.itemType}`;
}

export function getOrderedStateSignature(occurrence: PlaylistOccurrence): string {
  return [
    occurrence.uri ?? "null",
    occurrence.addedAt ?? "null",
    occurrence.itemType,
    occurrence.addedById ?? "null",
  ].join(FIELD_SEPARATOR);
}

export function getOrderedStateSignatures(
  occurrences: readonly PlaylistOccurrence[],
): readonly string[] {
  return occurrences.map(getOrderedStateSignature);
}

export function haveEqualOrderedState(
  left: readonly PlaylistOccurrence[],
  right: readonly PlaylistOccurrence[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (occurrence, index) =>
      getOrderedStateSignature(occurrence) ===
      getOrderedStateSignature(right[index] as PlaylistOccurrence),
  );
}

export function haveEqualMembership(
  left: readonly PlaylistOccurrence[],
  right: readonly PlaylistOccurrence[],
): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const occurrence of left) {
    const key = getMembershipKey(occurrence);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const occurrence of right) {
    const key = getMembershipKey(occurrence);
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) counts.delete(key);
    else counts.set(key, count - 1);
  }
  return counts.size === 0;
}

