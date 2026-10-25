// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it, vi } from "vitest";
import type { PlaylistTidyError } from "../../core/errors.js";
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

  it("classifies a non-JSON rejected refresh without parsing its body", async () => {
    const auth = new SpotifyRefreshTokenAuth(
      "client-id",
      "refresh-token",
      vi.fn(async () => new Response("temporarily unavailable", { status: 503 })),
    );

    await expect(auth.getAccessToken()).rejects.toMatchObject<Partial<PlaylistTidyError>>({
      code: "AUTHENTICATION_FAILED",
      message: "Spotify token refresh failed with HTTP 503.",
    });
  });

  it("classifies a malformed successful refresh response", async () => {
    const auth = new SpotifyRefreshTokenAuth(
      "client-id",
      "refresh-token",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );

    await expect(auth.getAccessToken()).rejects.toMatchObject<Partial<PlaylistTidyError>>({
      code: "VALIDATION_FAILED",
    });
  });
});
