// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it } from "vitest";
import { occurrence } from "../../testing/occurrence.js";
import { getTargetOrder } from "./order.js";
import { applyMovePlan, planPlaylistSort } from "./planner.js";

describe("planPlaylistSort", () => {
  it("emits no writes for an already sorted playlist", () => {
    const values = [occurrence(0, "2026-01-03"), occurrence(1, "2026-01-02")];
    expect(planPlaylistSort(values)).toEqual([]);
  });

  it("sorts a reversed playlist and is idempotent", () => {
    const values = [
      occurrence(0, "2026-01-01"),
      occurrence(1, "2026-01-02"),
      occurrence(2, "2026-01-03"),
      occurrence(3, "2026-01-04"),
    ];
    const moves = planPlaylistSort(values);
    const sorted = applyMovePlan(values, moves);
    expect(sorted).toEqual(getTargetOrder(values));
    expect(planPlaylistSort(sorted)).toEqual([]);
  });

  it("moves a contiguous newest block in one call", () => {
    const values = [
      occurrence(0, "2026-01-01"),
      occurrence(1, "2026-01-03"),
      occurrence(2, "2026-01-03"),
      occurrence(3, "2026-01-02"),
    ];
    expect(planPlaylistSort(values)).toHaveLength(1);
  });

  it("sorts deterministic randomized playlists while preserving occurrences", () => {
    let seed = 0x5eed;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let run = 0; run < 200; run += 1) {
      const length = Math.floor(random() * 12);
      const values = Array.from({ length }, (_, index) =>
        occurrence(index, random() < 0.15 ? null : `2026-01-${String(1 + Math.floor(random() * 8)).padStart(2, "0")}`),
      );
      const sorted = applyMovePlan(values, planPlaylistSort(values));
      expect(sorted).toEqual(getTargetOrder(values));
      expect(sorted.map(({ originalPosition }) => originalPosition).sort((a, b) => a - b)).toEqual(
        values.map(({ originalPosition }) => originalPosition),
      );
    }
  });

  it("matches an independent optimal range-move oracle through six occurrences", () => {
    for (let length = 0; length <= 6; length += 1) {
      const identity = Array.from({ length }, (_, index) => index);
      const optimalDistances = getOptimalDistances(identity);
      for (const target of getPermutations(identity)) {
        const rank = new Map(target.map((value, index) => [value, index]));
        const values = identity.map((originalPosition) =>
          occurrence(
            originalPosition,
            new Date(Date.UTC(2026, 0, length - (rank.get(originalPosition) ?? 0))).toISOString(),
          ),
        );
        const optimalDistance = optimalDistances.get(target.join(","));
        if (optimalDistance === undefined) throw new Error("Oracle did not reach a permutation.");
        expect(planPlaylistSort(values)).toHaveLength(optimalDistance);
      }
    }
  });
});

function getOptimalDistances(initial: readonly number[]): ReadonlyMap<string, number> {
  const initialKey = initial.join(",");
  const distances = new Map<string, number>([[initialKey, 0]]);
  const queue: number[][] = [[...initial]];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor] as readonly number[];
    const distance = distances.get(state.join(",")) as number;
    for (const next of getIndependentTransitions(state)) {
      const key = next.join(",");
      if (distances.has(key)) continue;
      distances.set(key, distance + 1);
      queue.push(next);
    }
  }
  return distances;
}

function getIndependentTransitions(values: readonly number[]): readonly number[][] {
  const transitions: number[][] = [];
  for (let start = 0; start < values.length; start += 1) {
    for (let length = 1; start + length <= values.length; length += 1) {
      for (let destination = 0; destination <= values.length; destination += 1) {
        if (destination >= start && destination <= start + length) continue;
        const remainder = [...values];
        const block = remainder.splice(start, length);
        const insertion = destination < start ? destination : destination - length;
        remainder.splice(insertion, 0, ...block);
        transitions.push(remainder);
      }
    }
  }
  return transitions;
}

function getPermutations(values: readonly number[]): readonly number[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    getPermutations([...values.slice(0, index), ...values.slice(index + 1)]).map((tail) => [value, ...tail]),
  );
}

