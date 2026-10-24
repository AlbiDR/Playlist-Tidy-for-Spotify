// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import * as v from "valibot";
import { PlaylistTidyError } from "../../core/errors.js";
import type { PlaylistOccurrence, PlaylistView, RangeMove } from "../../core/playlist/types.js";
import type {
  PlaylistMetadata,
  SpotifyPlaylistReadPort,
  SpotifyPlaylistReorderPort,
  SpotifyUser,
} from "../../applications/ports/SpotifyPlaylistPort.js";
import {
  SpotifyPlaylistItemsPageSchema,
  SpotifyPlaylistMetadataSchema,
  SpotifyReorderResponseSchema,
  SpotifyUserSchema,
  type SpotifyPlaylistItemDto,
} from "./SpotifySchemas.js";

const API_BASE_URL = "https://api.spotify.com/v1";
const PAGE_SIZE = 50;
const DEFAULT_READ_ATTEMPTS = 3;
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
  implements SpotifyPlaylistReadPort, SpotifyPlaylistReorderPort
{
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly readAttempts: number;
  private readonly coherentReadAttempts: number;

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
      `Playlist ${playlistId} changed during every coherent read attempt.`,
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
    return this.parse(SpotifyReorderResponseSchema, payload, "reorder response").snapshot_id;
  }

  private async readAllPlaylistItems(playlistId: string): Promise<readonly PlaylistOccurrence[]> {
    const occurrences: PlaylistOccurrence[] = [];
    let offset = 0;
    let hasNextPage = true;
    while (hasNextPage) {
      const fields = encodeURIComponent("items(added_at,added_by(id),item(uri,type,is_local)),next,total");
      const path = `/playlists/${encodeURIComponent(playlistId)}/items?limit=${String(PAGE_SIZE)}&offset=${String(offset)}&fields=${fields}`;
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
    }
    return occurrences;
  }

  private async readJson(path: string): Promise<unknown> {
    let refreshed = false;
    for (let attempt = 1; attempt <= this.readAttempts; attempt += 1) {
      try {
        const response = await this.authorizedFetch(path, { method: "GET" });
        if (response.status === 401 && !refreshed) {
          await this.tokens.refreshAccessToken();
          refreshed = true;
          continue;
        }
        if (response.status === 429) {
          await this.sleep(getRetryDelay(response));
          continue;
        }
        if (response.status >= 500) {
          await this.sleep(2 ** (attempt - 1) * 100);
          continue;
        }
        if (!response.ok) throw createHttpError(response.status, "Spotify read request failed");
        return await response.json();
      } catch (error) {
        if (error instanceof PlaylistTidyError) throw error;
        if (attempt === this.readAttempts) {
          throw new PlaylistTidyError("TRANSIENT_READ_FAILED", "Spotify read failed after bounded retries.", { cause: error });
        }
        await this.sleep(2 ** (attempt - 1) * 100);
      }
    }
    throw new PlaylistTidyError("RETRY_EXHAUSTED", "Spotify read retry budget was exhausted.");
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
        await this.sleep(getRetryDelay(response));
        continue;
      }
      if (response.status >= 500) {
        throw new PlaylistTidyError("AMBIGUOUS_WRITE", `Spotify reorder outcome is unknown after HTTP ${String(response.status)}.`);
      }
      if (!response.ok) throw createHttpError(response.status, "Spotify reorder request failed");
      return await response.json();
    }
    throw new PlaylistTidyError("RETRY_EXHAUSTED", "Spotify reorder retry budget was exhausted before a write was accepted.");
  }

  private async authorizedFetch(path: string, init: RequestInit): Promise<Response> {
    const token = await this.tokens.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return this.fetchImplementation(`${API_BASE_URL}${path}`, { ...init, headers });
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
    addedAt: item.added_at,
    addedById: item.added_by?.id ?? null,
  };
}

function getRetryDelay(response: Response): number {
  const seconds = Number(response.headers.get("Retry-After") ?? "1");
  const milliseconds = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000;
  return Math.min(milliseconds, MAX_RATE_LIMIT_DELAY_MS);
}

function createHttpError(status: number, context: string): PlaylistTidyError {
  if (status === 401) return new PlaylistTidyError("AUTHENTICATION_FAILED", `${context}: authentication failed.`);
  if (status === 429) return new PlaylistTidyError("RATE_LIMITED", `${context}: rate limited.`);
  return new PlaylistTidyError("TRANSIENT_READ_FAILED", `${context}: HTTP ${String(status)}.`);
}

