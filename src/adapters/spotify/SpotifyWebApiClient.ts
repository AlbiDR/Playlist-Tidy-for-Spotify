// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import * as v from "valibot";
import { PlaylistTidyError } from "../../core/errors.js";
import { fetchWithDeadline } from "../http/fetchWithDeadline.js";
import type { PlaylistOccurrence, PlaylistView, RangeMove } from "../../core/playlist/types.js";
import type {
  PlaylistMetadata,
  SpotifyPlaylistCatalogPort,
  SpotifyPlaylistReadPort,
  SpotifyPlaylistReorderPort,
  SpotifyPlaylistSummary,
  SpotifyUser,
} from "../../applications/ports/SpotifyPlaylistPort.js";
import {
  SpotifyPlaylistCatalogPageSchema,
  SpotifyErrorResponseSchema,
  SpotifyPlaylistItemsPageSchema,
  SpotifyPlaylistMetadataSchema,
  SpotifyReorderResponseSchema,
  SpotifyUserSchema,
  type SpotifyPlaylistItemDto,
} from "./SpotifySchemas.js";

const API_BASE_URL = "https://api.spotify.com/v1";
const PAGE_SIZE = 50;
const DEFAULT_READ_ATTEMPTS = 5;
const DEFAULT_COHERENT_READ_ATTEMPTS = 3;
const MAX_RATE_LIMIT_DELAY_MS = 60_000;

export interface SpotifyTokenProvider {
  getAccessToken(): Promise<string>;
  refreshAccessToken(): Promise<string>;
}

export interface SpotifyClientOptions {
  readonly fetch?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly readAttempts?: number;
  readonly coherentReadAttempts?: number;
}

export class SpotifyWebApiClient
  implements SpotifyPlaylistReadPort, SpotifyPlaylistReorderPort, SpotifyPlaylistCatalogPort
{
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly readAttempts: number;
  private readonly coherentReadAttempts: number;
  private currentUserRequest: Promise<SpotifyUser> | undefined;
  private rateLimitPause: Promise<void> | undefined;

  public constructor(
    private readonly tokens: SpotifyTokenProvider,
    options: SpotifyClientOptions = {},
  ) {
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.readAttempts = options.readAttempts ?? DEFAULT_READ_ATTEMPTS;
    this.coherentReadAttempts = options.coherentReadAttempts ?? DEFAULT_COHERENT_READ_ATTEMPTS;
  }

  public async getCurrentUser(): Promise<SpotifyUser> {
    this.currentUserRequest ??= this.readCurrentUser();
    try {
      return await this.currentUserRequest;
    } catch (error) {
      this.currentUserRequest = undefined;
      throw error;
    }
  }

  private async readCurrentUser(): Promise<SpotifyUser> {
    const payload = await this.readJson("/me");
    const parsed = this.parse(SpotifyUserSchema, payload, "current user");
    return { id: parsed.id };
  }

  public async getPlaylistMetadata(playlistId: string): Promise<PlaylistMetadata> {
    const fields = encodeURIComponent("id,owner(id),snapshot_id");
    const payload = await this.readJson(`/playlists/${encodeURIComponent(playlistId)}?fields=${fields}`);
    const parsed = this.parse(SpotifyPlaylistMetadataSchema, payload, "playlist metadata");
    return { id: parsed.id, ownerId: parsed.owner.id, snapshotId: parsed.snapshot_id };
  }

  public async getOwnedPlaylists(ownerId: string): Promise<readonly SpotifyPlaylistSummary[]> {
    const playlists: SpotifyPlaylistSummary[] = [];
    let offset = 0;
    let hasNextPage = true;
    while (hasNextPage) {
      const page = this.parse(
        SpotifyPlaylistCatalogPageSchema,
        await this.readJson(`/me/playlists?limit=${String(PAGE_SIZE)}&offset=${String(offset)}`),
        "playlist catalog page",
      );
      for (const playlist of page.items) {
        if (playlist.owner.id !== ownerId) continue;
        playlists.push({
          id: playlist.id,
          name: playlist.name,
          ownerId: playlist.owner.id,
          snapshotId: playlist.snapshot_id,
          itemCount: playlist.items.total,
          isPublic: playlist.public,
        });
      }
      hasNextPage = page.next !== null;
      offset += page.items.length;
      if (hasNextPage && page.items.length === 0) {
        throw new PlaylistTidyError(
          "VALIDATION_FAILED",
          "Spotify returned an empty playlist catalog page with a next link.",
        );
      }
      if (!hasNextPage && offset !== page.total) {
        throw new PlaylistTidyError(
          "VALIDATION_FAILED",
          `Spotify declared ${String(page.total)} playlists but returned ${String(offset)}.`,
        );
      }
    }
    return playlists;
  }

  public async getCoherentPlaylist(playlistId: string): Promise<PlaylistView> {
    for (let attempt = 1; attempt <= this.coherentReadAttempts; attempt += 1) {
      const before = await this.getPlaylistMetadata(playlistId);
      const occurrences = await this.readAllPlaylistItems(playlistId);
      const after = await this.getPlaylistMetadata(playlistId);
      if (before.snapshotId === after.snapshotId) {
        return {
          playlistId,
          ownerId: after.ownerId,
          snapshotId: after.snapshotId,
          occurrences,
        };
      }
    }
    throw new PlaylistTidyError(
      "CONCURRENT_EDIT",
      "The playlist changed during every coherent read attempt.",
    );
  }

  public async reorderPlaylistRange(
    playlistId: string,
    snapshotId: string,
    move: RangeMove,
  ): Promise<string> {
    const payload = await this.writeJson(`/playlists/${encodeURIComponent(playlistId)}/items`, {
      range_start: move.rangeStart,
      insert_before: move.insertBefore,
      range_length: move.rangeLength,
      snapshot_id: snapshotId,
    });
    const parsed = v.safeParse(SpotifyReorderResponseSchema, payload);
    if (!parsed.success) {
      throw new PlaylistTidyError(
        "AMBIGUOUS_WRITE",
        "Spotify accepted the reorder, but returned an invalid acknowledgment. The live playlist must be reconciled before any further write.",
        { cause: parsed.issues },
      );
    }
    return parsed.output.snapshot_id;
  }

  private async readAllPlaylistItems(playlistId: string): Promise<readonly PlaylistOccurrence[]> {
    const occurrences: PlaylistOccurrence[] = [];
    let offset = 0;
    let hasNextPage = true;
    while (hasNextPage) {
      const path = `/playlists/${encodeURIComponent(playlistId)}/items?limit=${String(PAGE_SIZE)}&offset=${String(offset)}`;
      const page = this.parse(
        SpotifyPlaylistItemsPageSchema,
        await this.readJson(path),
        "playlist items page",
      );
      for (const item of page.items) {
        occurrences.push(mapOccurrence(item, occurrences.length));
      }
      hasNextPage = page.next !== null;
      offset += page.items.length;
      if (hasNextPage && page.items.length === 0) {
        throw new PlaylistTidyError("VALIDATION_FAILED", "Spotify returned an empty page with a next link.");
      }
      if (!hasNextPage && occurrences.length !== page.total) {
        throw new PlaylistTidyError(
          "VALIDATION_FAILED",
          `Spotify declared ${String(page.total)} playlist items but returned ${String(occurrences.length)}.`,
        );
      }
    }
    return occurrences;
  }

  private async readJson(path: string): Promise<unknown> {
    let refreshed = false;
    let transientFailures = 0;
    for (;;) {
      try {
        const response = await this.authorizedFetch(path, { method: "GET" });
        if (response.status === 401 && !refreshed) {
          await this.tokens.refreshAccessToken();
          refreshed = true;
          continue;
        }
        if (response.status === 429) {
          if (await isQuotaExceeded(response)) {
            throw new PlaylistTidyError(
              "RATE_LIMITED",
              "Spotify's development-mode API quota is exhausted. Try again after Spotify resets the quota window.",
            );
          }
          const retry = getRetryDelay(response);
          transientFailures += 1;
          if (transientFailures >= this.readAttempts) {
            throw new PlaylistTidyError(
              "RATE_LIMITED",
              `Spotify kept rate limiting playlist reads. Its latest Retry-After window was ${formatDuration(retry.requestedMilliseconds)}.`,
            );
          }
          await this.pauseForRateLimit(retry.boundedMilliseconds);
          continue;
        }
        if (response.status >= 500) {
          transientFailures += 1;
          if (transientFailures >= this.readAttempts) {
            throw new PlaylistTidyError(
              "TRANSIENT_READ_FAILED",
              `Spotify playlist reads remained unavailable after ${String(this.readAttempts)} attempts (HTTP ${String(response.status)}).`,
            );
          }
          await this.sleep(2 ** (transientFailures - 1) * 250);
          continue;
        }
        if (!response.ok) throw createHttpError(response.status, "Spotify read request failed");
        try {
          return await response.json();
        } catch (error) {
          throw new PlaylistTidyError(
            "VALIDATION_FAILED",
            "Spotify returned an unreadable read response.",
            { cause: error },
          );
        }
      } catch (error) {
        if (error instanceof PlaylistTidyError) throw error;
        transientFailures += 1;
        if (transientFailures >= this.readAttempts) {
          throw new PlaylistTidyError(
            "TRANSIENT_READ_FAILED",
            `Spotify playlist reads failed after ${String(this.readAttempts)} network attempts.`,
            { cause: error },
          );
        }
        await this.sleep(2 ** (transientFailures - 1) * 250);
      }
    }
  }

  private async pauseForRateLimit(milliseconds: number): Promise<void> {
    if (this.rateLimitPause === undefined) {
      this.rateLimitPause = this.sleep(milliseconds);
    }
    const pause = this.rateLimitPause;
    try {
      await pause;
    } finally {
      if (this.rateLimitPause === pause) this.rateLimitPause = undefined;
    }
  }

  private async writeJson(path: string, body: Readonly<Record<string, unknown>>): Promise<unknown> {
    let refreshed = false;
    for (let attempt = 1; attempt <= this.readAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.authorizedFetch(path, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new PlaylistTidyError("AMBIGUOUS_WRITE", "Spotify reorder outcome is unknown after a network failure.", { cause: error });
      }
      if (response.status === 401 && !refreshed) {
        await this.tokens.refreshAccessToken();
        refreshed = true;
        continue;
      }
      if (response.status === 429) {
        if (await isQuotaExceeded(response)) {
          throw new PlaylistTidyError(
            "RATE_LIMITED",
            "Spotify's development-mode API quota is exhausted. No playlist write was attempted; try again after Spotify resets the quota window.",
          );
        }
        await this.sleep(getRetryDelay(response).boundedMilliseconds);
        continue;
      }
      if (response.status >= 500) {
        throw new PlaylistTidyError("AMBIGUOUS_WRITE", `Spotify reorder outcome is unknown after HTTP ${String(response.status)}.`);
      }
      if (!response.ok) {
        throw createHttpError(
          response.status,
          "Spotify reorder request failed",
          await readSafeResponseText(response),
        );
      }
      try {
        return await response.json();
      } catch (error) {
        throw new PlaylistTidyError(
          "AMBIGUOUS_WRITE",
          "Spotify accepted the reorder, but its acknowledgment was unreadable. The live playlist must be reconciled before any further write.",
          { cause: error },
        );
      }
    }
    throw new PlaylistTidyError("RETRY_EXHAUSTED", "Spotify reorder retry budget was exhausted before a write was accepted.");
  }

  private async authorizedFetch(path: string, init: RequestInit): Promise<Response> {
    const token = await this.tokens.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetchWithDeadline(this.fetchImplementation, `${API_BASE_URL}${path}`, {
      ...init,
      headers,
    });
  }

  private parse<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    schema: TSchema,
    payload: unknown,
    label: string,
  ): v.InferOutput<TSchema> {
    const result = v.safeParse(schema, payload);
    if (!result.success) {
      throw new PlaylistTidyError("VALIDATION_FAILED", `Spotify returned an invalid ${label}.`, { cause: result.issues });
    }
    return result.output;
  }
}

function mapOccurrence(item: SpotifyPlaylistItemDto, originalPosition: number): PlaylistOccurrence {
  const type = item.item?.is_local === true
    ? "local"
    : item.item?.type === "track" || item.item?.type === "episode"
      ? item.item.type
      : "unknown";
  return {
    originalPosition,
    uri: item.item?.uri ?? null,
    itemType: type,
    addedAt: item.added_at === null ? null : new Date(item.added_at).toISOString(),
    addedById: item.added_by?.id ?? null,
  };
}

interface RetryDelay {
  readonly requestedMilliseconds: number;
  readonly boundedMilliseconds: number;
}

function getRetryDelay(response: Response): RetryDelay {
  const seconds = Number(response.headers.get("Retry-After") ?? "1");
  const requestedMilliseconds = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000;
  return {
    requestedMilliseconds,
    boundedMilliseconds: Math.min(requestedMilliseconds, MAX_RATE_LIMIT_DELAY_MS),
  };
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) return `${String(seconds)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${String(minutes)} ${minutes === 1 ? "minute" : "minutes"}`;
}

function createHttpError(status: number, context: string, detail = ""): PlaylistTidyError {
  if (/snapshot/iu.test(detail)) {
    return new PlaylistTidyError(
      "CONCURRENT_EDIT",
      `${context}: Spotify rejected a stale playlist snapshot.`,
    );
  }
  if (status === 401) return new PlaylistTidyError("AUTHENTICATION_FAILED", `${context}: authentication failed.`);
  if (status === 429) return new PlaylistTidyError("RATE_LIMITED", `${context}: rate limited.`);
  if (status === 403) {
    return new PlaylistTidyError(
      "AUTHORIZATION_FAILED",
      `${context}: Spotify denied access. Check the granted permissions; in Development Mode, the account must be on the app's user allowlist and the app owner's Premium subscription must be active.`,
    );
  }
  if (status === 404) return new PlaylistTidyError("RESOURCE_NOT_FOUND", `${context}: resource was not found.`);
  if (status >= 400 && status < 500) {
    return new PlaylistTidyError("REQUEST_REJECTED", `${context}: Spotify rejected the request with HTTP ${String(status)}.`);
  }
  return new PlaylistTidyError("TRANSIENT_READ_FAILED", `${context}: HTTP ${String(status)}.`);
}

async function readSafeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 2_000);
  } catch {
    return "";
  }
}

async function isQuotaExceeded(response: Response): Promise<boolean> {
  try {
    const parsed = v.safeParse(SpotifyErrorResponseSchema, await response.clone().json());
    return parsed.success && parsed.output.error.reason === "QUOTA_EXCEEDED";
  } catch {
    return false;
  }
}

