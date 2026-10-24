// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it } from "vitest";
import { occurrence } from "../../../../tests/helpers/occurrence.js";
import { getTargetOrder } from "../order.js";
import { applyMovePlan, planPlaylistSort } from "../planner.js";

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
});

