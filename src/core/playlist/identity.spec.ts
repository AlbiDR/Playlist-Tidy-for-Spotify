// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it } from "vitest";
import { occurrence } from "../../../tests/helpers/occurrence.js";
import { haveEqualMembership, haveEqualOrderedState } from "./identity.js";

describe("cross-snapshot identity", () => {
  it("compares membership as a multiset", () => {
    const left = [occurrence(0, "2026-01-01", { uri: "same" }), occurrence(1, null, { uri: "same" })];
    const right = [...left].reverse();
    expect(haveEqualMembership(left, right)).toBe(true);
  });

  it("distinguishes duplicate URIs with different ordered metadata", () => {
    const left = [occurrence(0, "2026-01-02", { uri: "same" }), occurrence(1, "2026-01-01", { uri: "same" })];
    expect(haveEqualOrderedState(left, [...left].reverse())).toBe(false);
  });

  it("detects a changed unidentified-item count", () => {
    const unidentified = occurrence(0, null, { uri: null, itemType: "unknown" });
    expect(haveEqualMembership([unidentified], [unidentified, unidentified])).toBe(false);
  });
});

