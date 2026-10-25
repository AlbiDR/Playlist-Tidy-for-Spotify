// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import * as v from "valibot";
import { PlaylistTidyError } from "../../core/errors.js";
import { fetchWithDeadline } from "../http/fetchWithDeadline.js";
import type { SpotifyTokenProvider } from "../spotify/SpotifyWebApiClient.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const EXPIRY_SAFETY_MS = 30_000;

const RefreshResponseSchema = v.object({
  access_token: v.string(),
  token_type: v.literal("Bearer"),
  expires_in: v.pipe(v.number(), v.integer(), v.minValue(1)),
  refresh_token: v.optional(v.string()),
});

export class SpotifyRefreshTokenAuth implements SpotifyTokenProvider {
  private accessToken: string | undefined;
  private expiresAt = 0;
  private refreshRequest: Promise<string> | undefined;
  private rotatedRefreshToken: string | undefined;

  public constructor(
    private readonly clientId: string,
    private refreshToken: string,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly now: () => number = Date.now,
  ) {
    if (clientId.trim().length === 0 || refreshToken.trim().length === 0) {
      throw new PlaylistTidyError(
        "VALIDATION_FAILED",
        "Scheduled sorting requires a Spotify Client ID and refresh token.",
      );
    }
  }

  public getAccessToken(): Promise<string> {
    if (this.accessToken !== undefined && this.now() + EXPIRY_SAFETY_MS < this.expiresAt) {
      return Promise.resolve(this.accessToken);
    }
    return this.refreshAccessToken();
  }

  public refreshAccessToken(): Promise<string> {
    this.refreshRequest ??= this.exchangeRefreshToken().finally(() => {
      this.refreshRequest = undefined;
    });
    return this.refreshRequest;
  }

  public takeRotatedRefreshToken(): string | undefined {
    const token = this.rotatedRefreshToken;
    this.rotatedRefreshToken = undefined;
    return token;
  }

  private async exchangeRefreshToken(): Promise<string> {
    let response: Response;
    try {
      response = await fetchWithDeadline(this.fetchImplementation, TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          grant_type: "refresh_token",
          refresh_token: this.refreshToken,
        }),
      });
    } catch (error) {
      throw new PlaylistTidyError(
        "AUTHENTICATION_FAILED",
        "Spotify token refresh did not respond in time.",
        { cause: error },
      );
    }
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new PlaylistTidyError(
        "AUTHENTICATION_FAILED",
        `Spotify token refresh failed with HTTP ${String(response.status)}.`,
      );
    }
    const parsed = v.safeParse(RefreshResponseSchema, payload);
    if (!parsed.success) {
      throw new PlaylistTidyError(
        "VALIDATION_FAILED",
        "Spotify returned an invalid refresh response.",
        { cause: parsed.issues },
      );
    }
    const replacement = parsed.output.refresh_token;
    if (replacement !== undefined && replacement !== this.refreshToken) {
      this.refreshToken = replacement;
      this.rotatedRefreshToken = replacement;
    }
    this.accessToken = parsed.output.access_token;
    this.expiresAt = this.now() + parsed.output.expires_in * 1000;
    return this.accessToken;
  }
}
