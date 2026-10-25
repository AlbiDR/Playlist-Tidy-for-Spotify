// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it, vi } from "vitest";
import { SpotifyRefreshTokenAuth } from "./SpotifyRefreshTokenAuth.js";

describe("SpotifyRefreshTokenAuth", () => {
  it("coalesces refreshes and retains a rotated refresh token for secure persistence", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "replacement-token",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const auth = new SpotifyRefreshTokenAuth("client-id", "refresh-token", fetchMock, () => 0);
    await expect(Promise.all([auth.getAccessToken(), auth.getAccessToken()])).resolves.toEqual([
      "access-token",
      "access-token",
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(auth.takeRotatedRefreshToken()).toBe("replacement-token");
    expect(auth.takeRotatedRefreshToken()).toBeUndefined();
  });

  it("reuses an unexpired access token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: "access-token", token_type: "Bearer", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const auth = new SpotifyRefreshTokenAuth("client-id", "refresh-token", fetchMock, () => 0);
    await auth.getAccessToken();
    await auth.getAccessToken();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
