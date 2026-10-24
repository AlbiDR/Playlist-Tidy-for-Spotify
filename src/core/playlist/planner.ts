// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { getTargetOrder } from "./order.js";
import { applyRangeMove, isNoOpMove } from "./transition.js";
import type { PlaylistOccurrence, RangeMove } from "./types.js";

const EXACT_PLANNER_LIMIT = 6;

export function planPlaylistSort(
  occurrences: readonly PlaylistOccurrence[],
): readonly RangeMove[] {
  const current = occurrences.map(({ originalPosition }) => originalPosition);
  const target = getTargetOrder(occurrences).map(
    ({ originalPosition }) => originalPosition,
  );
  if (arraysEqual(current, target)) return [];
  return current.length <= EXACT_PLANNER_LIMIT
    ? findExactPlan(current, target)
    : findGreedyBlockPlan(current, target);
}

export function applyMovePlan<T>(
  values: readonly T[],
  moves: readonly RangeMove[],
): readonly T[] {
  return moves.reduce<readonly T[]>(
    (state, move) => applyRangeMove(state, move),
    values,
  );
}

function findGreedyBlockPlan(
  initial: readonly number[],
  target: readonly number[],
): readonly RangeMove[] {
  let state = [...initial];
  const moves: RangeMove[] = [];
  for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
    if (state[targetIndex] === target[targetIndex]) continue;
    const source = state.indexOf(target[targetIndex] as number, targetIndex + 1);
    if (source < 0) throw new Error("Target occurrence is absent from planner state.");
    let length = 1;
    while (
      source + length < state.length &&
      targetIndex + length < target.length &&
      state[source + length] === target[targetIndex + length]
    ) {
      length += 1;
    }
    const move: RangeMove = {
      rangeStart: source,
      insertBefore: targetIndex,
      rangeLength: length,
    };
    state = [...applyRangeMove(state, move)];
    moves.push(move);
  }
  return moves;
}

function findExactPlan(
  initial: readonly number[],
  target: readonly number[],
): readonly RangeMove[] {
  const targetKey = serialize(target);
  const initialKey = serialize(initial);
  const queue: string[] = [initialKey];
  const states = new Map<string, readonly number[]>([[initialKey, initial]]);
  const parents = new Map<string, { readonly key: string; readonly move: RangeMove }>();

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor] as string;
    const state = states.get(key) as readonly number[];
    for (const move of getLegalMoves(state.length)) {
      const next = applyRangeMove(state, move);
      const nextKey = serialize(next);
      if (states.has(nextKey)) continue;
      states.set(nextKey, next);
      parents.set(nextKey, { key, move });
      if (nextKey === targetKey) return reconstructPlan(parents, initialKey, nextKey);
      queue.push(nextKey);
    }
  }
  throw new Error("No legal range-move plan reaches the target order.");
}

function getLegalMoves(length: number): readonly RangeMove[] {
  const moves: RangeMove[] = [];
  for (let rangeStart = 0; rangeStart < length; rangeStart += 1) {
    for (let rangeLength = 1; rangeStart + rangeLength <= length; rangeLength += 1) {
      for (let insertBefore = 0; insertBefore <= length; insertBefore += 1) {
        const move = { rangeStart, insertBefore, rangeLength };
        if (!isNoOpMove(move)) moves.push(move);
      }
    }
  }
  return moves;
}

function reconstructPlan(
  parents: ReadonlyMap<string, { readonly key: string; readonly move: RangeMove }>,
  initialKey: string,
  targetKey: string,
): readonly RangeMove[] {
  const reversed: RangeMove[] = [];
  let key = targetKey;
  while (key !== initialKey) {
    const parent = parents.get(key);
    if (parent === undefined) throw new Error("Exact planner parent chain is incomplete.");
    reversed.push(parent.move);
    key = parent.key;
  }
  return reversed.reverse();
}

function serialize(values: readonly number[]): string {
  return values.join(",");
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

