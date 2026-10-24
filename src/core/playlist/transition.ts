// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import type { RangeMove } from "./types.js";

export class InvalidRangeMoveError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRangeMoveError";
  }
}

export function isNoOpMove(move: RangeMove): boolean {
  return (
    move.insertBefore >= move.rangeStart &&
    move.insertBefore <= move.rangeStart + move.rangeLength
  );
}

export function applyRangeMove<T>(
  values: readonly T[],
  move: RangeMove,
): readonly T[] {
  validateMove(values.length, move);
  if (isNoOpMove(move)) return [...values];

  const result = [...values];
  const block = result.splice(move.rangeStart, move.rangeLength);
  const insertionIndex =
    move.insertBefore < move.rangeStart
      ? move.insertBefore
      : move.insertBefore - move.rangeLength;
  result.splice(insertionIndex, 0, ...block);
  return result;
}

function validateMove(length: number, move: RangeMove): void {
  const integers = [move.rangeStart, move.insertBefore, move.rangeLength];
  if (!integers.every(Number.isInteger)) {
    throw new InvalidRangeMoveError("Range move values must be integers.");
  }
  if (move.rangeLength < 1) {
    throw new InvalidRangeMoveError("Range length must be positive.");
  }
  if (move.rangeStart < 0 || move.rangeStart + move.rangeLength > length) {
    throw new InvalidRangeMoveError("Source range is outside the playlist.");
  }
  if (move.insertBefore < 0 || move.insertBefore > length) {
    throw new InvalidRangeMoveError("Insertion point is outside the playlist.");
  }
}

