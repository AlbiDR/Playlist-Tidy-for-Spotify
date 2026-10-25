// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { describe, expect, it, vi } from "vitest";
import { PlaylistTidyError } from "../../core/errors.js";
import { SpotifyWebApiClient, type SpotifyTokenProvider } from "./SpotifyWebApiClient.js";

const tokens: SpotifyTokenProvider = {
  getAccessToken: vi.fn(async () => "access-token"),
  refreshAccessToken: vi.fn(async () => "refreshed-token"),
};

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
}

function metadata(snapshotId: string): unknown {
  return { id: "playlist", owner: { id: "owner" }, snapshot_id: snapshotId };
}

function item(uri: string | null, addedAt: string | null): unknown {
  return {
    added_at: addedAt,
    added_by: { id: "owner" },
    item: uri === null ? null : { uri, type: "track", is_local: false },
  };
}

describe("SpotifyWebApiClient", () => {
  it("reuses the authenticated profile across a batch", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "owner" }));
    const client = new SpotifyWebApiClient(tokens, { fetch: fetchMock });
    await expect(Promise.all([client.getCurrentUser(), client.getCurrentUser()])).resolves.toEqual([
      { id: "owner" },
      { id: "owner" },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reads all pages between matching playlist snapshots", async () => {
    const responses = [
      jsonResponse(metadata("snapshot-a")),
      jsonResponse({ items: [item("spotify:track:a", "2026-01-01T00:00:00Z")], next: "next", total: 2 }),
      jsonResponse({ items: [item(null, null)], next: null, total: 2 }),
      jsonResponse(metadata("snapshot-a")),
    ];
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return responses.shift() as Response;
    });
    const client = new SpotifyWebApiClient(tokens, { fetch: fetchMock });

    const view = await client.getCoherentPlaylist("playlist");

    expect(view.snapshotId).toBe("snapshot-a");
    expect(view.occurrences).toEqual([
      {
        originalPosition: 0,
        uri: "spotify:track:a",
        itemType: "track",
        addedAt: "2026-01-01T00:00:00.000Z",
        addedById: "owner",
      },
      {
        originalPosition: 1,
        uri: null,
        itemType: "unknown",
        addedAt: null,
        addedById: "owner",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestedUrls[2]).toContain("offset=1");
  });

  it("discards a mixed-snapshot read and starts again", async () => {
    const responses = [
      jsonResponse(metadata("snapshot-a")),
      jsonResponse({ items: [item("spotify:track:a", "2026-01-01T00:00:00Z")], next: null, total: 1 }),
      jsonResponse(metadata("snapshot-b")),
      jsonResponse(metadata("snapshot-b")),
      jsonResponse({ items: [item("spotify:track:b", "2026-01-02T00:00:00Z")], next: null, total: 1 }),
      jsonResponse(metadata("snapshot-b")),
    ];
    const client = new SpotifyWebApiClient(tokens, {
      fetch: vi.fn(async () => responses.shift() as Response),
    });

    const view = await client.getCoherentPlaylist("playlist");
    expect(view.snapshotId).toBe("snapshot-b");
    expect(view.occurrences[0]?.uri).toBe("spotify:track:b");
  });

  it("refreshes once after an unauthorized read", async () => {
    const localTokens: SpotifyTokenProvider = {
      getAccessToken: vi.fn(async () => "token"),
      refreshAccessToken: vi.fn(async () => "new-token"),
    };
    const responses = [jsonResponse({}, 401), jsonResponse({ id: "owner" })];
    const client = new SpotifyWebApiClient(localTokens, {
      fetch: vi.fn(async () => responses.shift() as Response),
    });
    await expect(client.getCurrentUser()).resolves.toEqual({ id: "owner" });
    expect(localTokens.refreshAccessToken).toHaveBeenCalledOnce();
  });

  it("does not charge token renewal against the transient retry allowance", async () => {
    const localTokens: SpotifyTokenProvider = {
      getAccessToken: vi.fn(async () => "token"),
      refreshAccessToken: vi.fn(async () => "new-token"),
    };
    const responses = [jsonResponse({}, 401), jsonResponse({ id: "owner" })];
    const client = new SpotifyWebApiClient(localTokens, {
      fetch: vi.fn(async () => responses.shift() as Response),
      readAttempts: 1,
    });

    await expect(client.getCurrentUser()).resolves.toEqual({ id: "owner" });
  });

  it("reports persistent read rate limiting instead of a generic exhausted budget", async () => {
    const sleep = vi.fn(async () => undefined);
    const client = new SpotifyWebApiClient(tokens, {
      fetch: vi.fn(async () => jsonResponse({}, 429, { "Retry-After": "120" })),
      readAttempts: 2,
      sleep,
    });

    await expect(client.getCurrentUser()).rejects.toThrow(
      "Spotify kept rate limiting playlist reads. Its latest Retry-After window was 2 minutes.",
    );
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it("fails immediately when Spotify's development quota is exhausted", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } }, 429),
    );
    const client = new SpotifyWebApiClient(tokens, { fetch: fetchMock, sleep });

    const failure: unknown = await client.getCurrentUser().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PlaylistTidyError);
    if (!(failure instanceof PlaylistTidyError)) throw new Error("Expected a PlaylistTidyError.");
    expect(failure.code).toBe("RATE_LIMITED");
    expect(failure.message).toContain("development-mode API quota is exhausted");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reports the final Spotify server status after exhausting read recovery", async () => {
    const client = new SpotifyWebApiClient(tokens, {
      fetch: vi.fn(async () => jsonResponse({}, 503)),
      readAttempts: 2,
      sleep: vi.fn(async () => undefined),
    });

    await expect(client.getCurrentUser()).rejects.toThrow(
      "Spotify playlist reads remained unavailable after 2 attempts (HTTP 503).",
    );
  });

  it("honors a bounded Retry-After before retrying a rejected write", async () => {
    const sleep = vi.fn(async () => undefined);
    const responses = [
      jsonResponse({}, 429, { "Retry-After": "90" }),
      jsonResponse({ snapshot_id: "snapshot-b" }),
    ];
    const client = new SpotifyWebApiClient(tokens, {
      fetch: vi.fn(async () => responses.shift() as Response),
      sleep,
    });
    await expect(
      client.reorderPlaylistRange("playlist", "snapshot-a", {
        rangeStart: 2,
        rangeLength: 1,
        insertBefore: 0,
      }),
    ).resolves.toBe("snapshot-b");
    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it("does not retry a write rejected by Spotify's development quota", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } }, 429),
    );
    const client = new SpotifyWebApiClient(tokens, { fetch: fetchMock, sleep });

    const failure: unknown = await client.reorderPlaylistRange("playlist", "snapshot-a", {
      rangeStart: 1,
      rangeLength: 1,
      insertBefore: 0,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PlaylistTidyError);
    if (!(failure instanceof PlaylistTidyError)) throw new Error("Expected a PlaylistTidyError.");
    expect(failure.code).toBe("RATE_LIMITED");
    expect(failure.message).toContain("No playlist write was attempted");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("never blindly retries a reorder after a server error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    const client = new SpotifyWebApiClient(tokens, { fetch: fetchMock });
    await expect(
      client.reorderPlaylistRange("playlist", "snapshot-a", {
        rangeStart: 1,
        rangeLength: 1,
        insertBefore: 0,
      }),
    ).rejects.toMatchObject<Partial<PlaylistTidyError>>({ code: "AMBIGUOUS_WRITE" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("treats an unreadable successful reorder acknowledgment as an ambiguous write", async () => {
    const fetchMock = vi.fn(async () => new Response("not-json", { status: 200 }));
    const client = new SpotifyWebApiClient(tokens, { fetch: fetchMock });
    await expect(
      client.reorderPlaylistRange("playlist", "snapshot-a", {
        rangeStart: 1,
        rangeLength: 1,
        insertBefore: 0,
      }),
    ).rejects.toMatchObject<Partial<PlaylistTidyError>>({ code: "AMBIGUOUS_WRITE" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("treats a malformed successful reorder acknowledgment as an ambiguous write", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ snapshot_id: "" }));
    const client = new SpotifyWebApiClient(tokens, { fetch: fetchMock });
    await expect(
      client.reorderPlaylistRange("playlist", "snapshot-a", {
        rangeStart: 1,
        rangeLength: 1,
        insertBefore: 0,
      }),
    ).rejects.toMatchObject<Partial<PlaylistTidyError>>({ code: "AMBIGUOUS_WRITE" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("classifies a stale snapshot rejection as a concurrent edit", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { status: 400, message: "Snapshot ID is stale" } }, 400),
    );
    const client = new SpotifyWebApiClient(tokens, { fetch: fetchMock });
    await expect(
      client.reorderPlaylistRange("playlist", "stale-snapshot", {
        rangeStart: 1,
        rangeLength: 1,
        insertBefore: 0,
      }),
    ).rejects.toMatchObject<Partial<PlaylistTidyError>>({ code: "CONCURRENT_EDIT" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects malformed Spotify data at the adapter boundary", async () => {
    const client = new SpotifyWebApiClient(tokens, {
      fetch: vi.fn(async () => jsonResponse({ owner: {} })),
    });
    await expect(client.getPlaylistMetadata("playlist")).rejects.toMatchObject<Partial<PlaylistTidyError>>({
      code: "VALIDATION_FAILED",
    });
  });

  it("rejects unreadable and impossible Spotify read responses without retrying", async () => {
    const unreadableFetch = vi.fn(async () => new Response("not-json", { status: 200 }));
    const unreadableClient = new SpotifyWebApiClient(tokens, { fetch: unreadableFetch });
    await expect(unreadableClient.getCurrentUser()).rejects.toMatchObject<Partial<PlaylistTidyError>>({
      code: "VALIDATION_FAILED",
    });
    expect(unreadableFetch).toHaveBeenCalledOnce();

    const impossibleClient = new SpotifyWebApiClient(tokens, {
      fetch: vi.fn(async () => jsonResponse({ items: [], next: null, total: -1 })),
    });
    await expect(impossibleClient.getOwnedPlaylists("owner")).rejects.toMatchObject<
      Partial<PlaylistTidyError>
    >({ code: "VALIDATION_FAILED" });
  });

  it("rejects an incomplete final page instead of planning from partial membership", async () => {
    const responses = [
      jsonResponse(metadata("snapshot-a")),
      jsonResponse({ items: [item("spotify:track:a", "2026-01-01T00:00:00Z")], next: null, total: 2 }),
    ];
    const client = new SpotifyWebApiClient(tokens, {
      fetch: vi.fn(async () => responses.shift() as Response),
    });
    await expect(client.getCoherentPlaylist("playlist")).rejects.toMatchObject<Partial<PlaylistTidyError>>({
      code: "VALIDATION_FAILED",
    });
  });

  it("classifies forbidden reads as authorization failures without retrying", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 403));
    const client = new SpotifyWebApiClient(tokens, { fetch: fetchMock });
    await expect(client.getCurrentUser()).rejects.toMatchObject<Partial<PlaylistTidyError>>({
      code: "AUTHORIZATION_FAILED",
      message: "Spotify read request failed: Spotify denied access. Check the granted permissions; in Development Mode, the account must be on the app's user allowlist and the app owner's Premium subscription must be active.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("pages the playlist catalog and returns only playlists owned by the current user", async () => {
    const playlist = (id: string, ownerId: string, name: string): unknown => ({
      id,
      name,
      owner: { id: ownerId },
      snapshot_id: `snapshot-${id}`,
      public: true,
      items: { total: 4 },
    });
    const responses = [
      jsonResponse({
        items: [playlist("owned-a", "owner", "Owned A"), playlist("followed", "other", "Followed")],
        next: "next",
        total: 3,
      }),
      jsonResponse({
        items: [playlist("owned-b", "owner", "Owned B")],
        next: null,
        total: 3,
      }),
    ];
    const client = new SpotifyWebApiClient(tokens, {
      fetch: vi.fn(async () => responses.shift() as Response),
    });

    await expect(client.getOwnedPlaylists("owner")).resolves.toEqual([
      {
        id: "owned-a",
        name: "Owned A",
        ownerId: "owner",
        snapshotId: "snapshot-owned-a",
        itemCount: 4,
        isPublic: true,
      },
      {
        id: "owned-b",
        name: "Owned B",
        ownerId: "owner",
        snapshotId: "snapshot-owned-b",
        itemCount: 4,
        isPublic: true,
      },
    ]);
  });
});

