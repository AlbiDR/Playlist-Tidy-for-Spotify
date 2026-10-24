// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it } from "vitest";
import { applyRangeMove, InvalidRangeMoveError } from "./transition.js";

describe("applyRangeMove", () => {
  it("moves a multi-item block forward using pre-removal coordinates", () => {
    expect(
      applyRangeMove(["A", "B", "C", "D", "E", "F"], {
        rangeStart: 1,
        rangeLength: 2,
        insertBefore: 5,
      }),
    ).toEqual(["A", "D", "E", "B", "C", "F"]);
  });

  it("moves a block backward", () => {
    expect(
      applyRangeMove(["A", "B", "C", "D", "E"], {
        rangeStart: 3,
        rangeLength: 2,
        insertBefore: 1,
      }),
    ).toEqual(["A", "D", "E", "B", "C"]);
  });

  it("treats overlapping destinations as no-ops", () => {
    expect(
      applyRangeMove(["A", "B", "C", "D"], {
        rangeStart: 1,
        rangeLength: 2,
        insertBefore: 2,
      }),
    ).toEqual(["A", "B", "C", "D"]);
  });

  it("rejects invalid ranges", () => {
    expect(() =>
      applyRangeMove(["A"], { rangeStart: 1, rangeLength: 1, insertBefore: 0 }),
    ).toThrow(InvalidRangeMoveError);
  });
});

