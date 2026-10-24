// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it } from "vitest";
import { occurrence } from "../../../../tests/helpers/occurrence.js";
import { getTargetOrder, isNewestFirst } from "../order.js";

describe("playlist ordering", () => {
  it("sorts newest first, preserves ties, and puts null dates last", () => {
    const values = [
      occurrence(0, null),
      occurrence(1, "2026-10-23T12:00:00Z"),
      occurrence(2, "2026-10-24T12:00:00Z"),
      occurrence(3, "2026-10-24T12:00:00Z"),
      occurrence(4, null),
    ];
    const sorted = getTargetOrder(values);
    expect(sorted.map(({ originalPosition }) => originalPosition)).toEqual([2, 3, 1, 0, 4]);
    expect(isNewestFirst(sorted)).toBe(true);
  });

  it("recognizes a null followed by a dated item as unsorted", () => {
    expect(isNewestFirst([occurrence(0, null), occurrence(1, "2026-01-01T00:00:00Z")])).toBe(false);
  });
});

