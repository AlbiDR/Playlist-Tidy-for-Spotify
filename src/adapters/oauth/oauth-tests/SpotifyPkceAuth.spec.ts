// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PlaylistTidyError } from "../../../core/errors.js";
import {
  SPOTIFY_SCOPES,
  SpotifyPkceAuth,
  type SessionStoragePort,
} from "../SpotifyPkceAuth.js";

const CLIENT_ID = "spotify-client-id";
const REDIRECT_URI = "https://albidr.github.io/Playlist-Tidy-for-Spotify/";

class MemoryStorage implements SessionStoragePort {
  public readonly values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }
}

function createAuth(
  storage: MemoryStorage,
  fetchImplementation: typeof fetch = vi.fn(),
  now: () => number = () => 1_000,
): SpotifyPkceAuth {
  return new SpotifyPkceAuth(storage, {
    fetch: fetchImplementation,
    crypto: webcrypto as Crypto,
    now,
  });
}

describe("SpotifyPkceAuth", () => {
  it("creates a high-entropy S256 authorization request with least-privilege scopes", async () => {
    const storage = new MemoryStorage();
    const auth = createAuth(storage);
    const url = new URL(await auth.createAuthorizationUrl(CLIENT_ID, REDIRECT_URI));

    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe(SPOTIFY_SCOPES.join(" "));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43,128}$/u);
    expect(storage.values.size).toBe(2);
    for (const value of storage.values.values()) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{43,128}$/u);
    }
  });

  it("exchanges a verified callback and keeps only the access token in memory", async () => {
    const storage = new MemoryStorage();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("grant_type=authorization_code");
      expect(String(init?.body)).toContain("code_verifier=");
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "must-be-discarded",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const auth = createAuth(storage, fetchMock);
    const authorizationUrl = new URL(await auth.createAuthorizationUrl(CLIENT_ID, REDIRECT_URI));
    const state = authorizationUrl.searchParams.get("state") as string;

    await expect(
      auth.completeAuthorizationCallback(
        `${REDIRECT_URI}?code=authorization-code&state=${encodeURIComponent(state)}`,
        CLIENT_ID,
        REDIRECT_URI,
      ),
    ).resolves.toEqual({ status: "connected" });

    expect(storage.values.size).toBe(0);
    await expect(auth.getAccessToken()).resolves.toBe("access-token");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a mismatched state and deletes transient values before returning", async () => {
    const storage = new MemoryStorage();
    const fetchMock = vi.fn();
    const auth = createAuth(storage, fetchMock);
    await auth.createAuthorizationUrl(CLIENT_ID, REDIRECT_URI);

    await expect(
      auth.completeAuthorizationCallback(
        `${REDIRECT_URI}?code=authorization-code&state=wrong-state`,
        CLIENT_ID,
        REDIRECT_URI,
      ),
    ).rejects.toMatchObject<Partial<PlaylistTidyError>>({ code: "AUTHENTICATION_FAILED" });
    expect(storage.values.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects insecure non-loopback redirect addresses", async () => {
    const auth = createAuth(new MemoryStorage());
    await expect(
      auth.createAuthorizationUrl(CLIENT_ID, "http://example.com/callback"),
    ).rejects.toMatchObject<Partial<PlaylistTidyError>>({ code: "VALIDATION_FAILED" });
  });

  it("drops the in-memory session when the access token expires", async () => {
    const storage = new MemoryStorage();
    let now = 0;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: "access-token", token_type: "Bearer", expires_in: 60 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const auth = createAuth(storage, fetchMock, () => now);
    const authorizationUrl = new URL(await auth.createAuthorizationUrl(CLIENT_ID, REDIRECT_URI));
    const state = authorizationUrl.searchParams.get("state") as string;
    await auth.completeAuthorizationCallback(
      `${REDIRECT_URI}?code=authorization-code&state=${encodeURIComponent(state)}`,
      CLIENT_ID,
      REDIRECT_URI,
    );

    now = 31_000;
    await expect(auth.getAccessToken()).rejects.toMatchObject<Partial<PlaylistTidyError>>({
      code: "AUTHENTICATION_FAILED",
    });
  });
});

