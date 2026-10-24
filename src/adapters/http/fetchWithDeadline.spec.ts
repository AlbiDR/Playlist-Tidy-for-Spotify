// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithDeadline } from "./fetchWithDeadline.js";

afterEach(() => vi.useRealTimers());

describe("fetchWithDeadline", () => {
  it("aborts a request that exceeds its deadline", async () => {
    vi.useFakeTimers();
    const stalledFetch = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );
    const request = fetchWithDeadline(stalledFetch, "https://example.test", {}, 25);
    const rejection = expect(request).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("clears its deadline after a successful response", async () => {
    vi.useFakeTimers();
    const response = new Response(null, { status: 204 });
    const completedFetch = vi.fn<typeof fetch>(() => Promise.resolve(response));
    await expect(
      fetchWithDeadline(completedFetch, "https://example.test", {}, 25),
    ).resolves.toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });
});
