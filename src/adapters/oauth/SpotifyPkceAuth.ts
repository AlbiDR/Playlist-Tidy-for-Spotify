// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import * as v from "valibot";
import { PlaylistTidyError } from "../../core/errors.js";
import { fetchWithDeadline } from "../http/fetchWithDeadline.js";
import type { SpotifyTokenProvider } from "../spotify/SpotifyWebApiClient.js";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const VERIFIER_STORAGE_KEY = "playlist-tidy.pkce-verifier";
const STATE_STORAGE_KEY = "playlist-tidy.oauth-state";
const RANDOM_BYTE_COUNT = 64;
const EXPIRY_SAFETY_MS = 30_000;

export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
] as const;

const TokenResponseSchema = v.object({
  access_token: v.pipe(v.string(), v.minLength(1)),
  token_type: v.literal("Bearer"),
  expires_in: v.pipe(v.number(), v.integer(), v.minValue(1)),
  refresh_token: v.optional(v.pipe(v.string(), v.minLength(1))),
  scope: v.string(),
});

export interface SessionStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SpotifyPkceAuthOptions {
  readonly fetch?: typeof fetch;
  readonly crypto?: Crypto;
  readonly now?: () => number;
  readonly onRefreshToken?: (refreshToken: string) => Promise<void> | void;
}

export type OAuthCallbackResult =
  | { readonly status: "none" }
  | { readonly status: "connected" };

export class SpotifyPkceAuth implements SpotifyTokenProvider {
  private readonly fetchImplementation: typeof fetch;
  private readonly cryptoImplementation: Crypto;
  private readonly now: () => number;
  private readonly onRefreshToken: ((refreshToken: string) => Promise<void> | void) | undefined;
  private accessToken: string | undefined;
  private expiresAt = 0;

  public constructor(
    private readonly storage: SessionStoragePort,
    options: SpotifyPkceAuthOptions = {},
  ) {
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.cryptoImplementation = options.crypto ?? globalThis.crypto;
    this.now = options.now ?? Date.now;
    this.onRefreshToken = options.onRefreshToken;
  }

  public async createAuthorizationUrl(clientId: string, redirectUri: string): Promise<string> {
    assertOAuthConfiguration(clientId, redirectUri);
    const verifier = createRandomBase64Url(this.cryptoImplementation);
    const state = createRandomBase64Url(this.cryptoImplementation);
    const challenge = await createCodeChallenge(this.cryptoImplementation, verifier);
    this.storage.setItem(VERIFIER_STORAGE_KEY, verifier);
    this.storage.setItem(STATE_STORAGE_KEY, state);

    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES.join(" "),
      state,
      code_challenge_method: "S256",
      code_challenge: challenge,
    }).toString();
    return url.toString();
  }

  public async completeAuthorizationCallback(
    callbackUrl: string,
    clientId: string,
    redirectUri: string,
  ): Promise<OAuthCallbackResult> {
    const url = new URL(callbackUrl);
    const code = url.searchParams.get("code");
    const callbackError = url.searchParams.get("error");
    if (code === null && callbackError === null) return { status: "none" };

    const expectedState = this.storage.getItem(STATE_STORAGE_KEY);
    const verifier = this.storage.getItem(VERIFIER_STORAGE_KEY);
    this.clearTransientState();

    const receivedState = url.searchParams.get("state");
    if (
      expectedState === null ||
      receivedState === null ||
      !constantTimeEqual(expectedState, receivedState)
    ) {
      throw new PlaylistTidyError(
        "AUTHENTICATION_FAILED",
        "Spotify login callback state was missing or did not match.",
      );
    }
    if (callbackError !== null) {
      throw new PlaylistTidyError(
        "AUTHENTICATION_FAILED",
        callbackError === "access_denied"
          ? "Spotify access was not granted."
          : `Spotify authorization failed: ${callbackError}.`,
      );
    }
    if (code === null || verifier === null) {
      throw new PlaylistTidyError(
        "AUTHENTICATION_FAILED",
        "Spotify login callback was missing its authorization code or PKCE verifier.",
      );
    }

    assertOAuthConfiguration(clientId, redirectUri);
    let response: Response;
    try {
      response = await fetchWithDeadline(this.fetchImplementation, TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
      });
    } catch (error) {
      throw new PlaylistTidyError(
        "AUTHENTICATION_FAILED",
        "Spotify login did not respond in time. Please connect again.",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new PlaylistTidyError(
        "AUTHENTICATION_FAILED",
        `Spotify token exchange failed with HTTP ${String(response.status)}.`,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new PlaylistTidyError(
        "VALIDATION_FAILED",
        "Spotify returned an unreadable token response.",
        { cause: error },
      );
    }
    const parsed = v.safeParse(TokenResponseSchema, payload);
    if (!parsed.success) {
      throw new PlaylistTidyError(
        "VALIDATION_FAILED",
        "Spotify returned an invalid token response.",
        { cause: parsed.issues },
      );
    }
    const grantedScopes = new Set(parsed.output.scope.split(/\s+/u).filter((scope) => scope.length > 0));
    const missingScopes = SPOTIFY_SCOPES.filter((scope) => !grantedScopes.has(scope));
    if (missingScopes.length > 0) {
      throw new PlaylistTidyError(
        "AUTHORIZATION_FAILED",
        `Spotify did not grant the required permissions: ${missingScopes.join(", ")}.`,
      );
    }

    this.accessToken = parsed.output.access_token;
    this.expiresAt = this.now() + parsed.output.expires_in * 1000;
    if (parsed.output.refresh_token !== undefined && this.onRefreshToken !== undefined) {
      await this.onRefreshToken(parsed.output.refresh_token);
    }
    return { status: "connected" };
  }

  public getAccessToken(): Promise<string> {
    if (this.accessToken === undefined || this.now() + EXPIRY_SAFETY_MS >= this.expiresAt) {
      this.disconnect();
      return Promise.reject(
        new PlaylistTidyError(
          "AUTHENTICATION_FAILED",
          "The browser Spotify session has expired. Connect Spotify again.",
        ),
      );
    }
    return Promise.resolve(this.accessToken);
  }

  public refreshAccessToken(): Promise<string> {
    this.disconnect();
    return Promise.reject(
      new PlaylistTidyError(
        "AUTHENTICATION_FAILED",
        "The website does not retain refresh tokens. Connect Spotify again.",
      ),
    );
  }

  public disconnect(): void {
    this.accessToken = undefined;
    this.expiresAt = 0;
    this.clearTransientState();
  }

  private clearTransientState(): void {
    this.storage.removeItem(VERIFIER_STORAGE_KEY);
    this.storage.removeItem(STATE_STORAGE_KEY);
  }
}

function assertOAuthConfiguration(clientId: string, redirectUri: string): void {
  if (clientId.trim().length === 0) {
    throw new PlaylistTidyError("VALIDATION_FAILED", "Spotify Client ID is not configured.");
  }
  const url = new URL(redirectUri);
  const isSecure = url.protocol === "https:";
  const isLoopback = url.protocol === "http:" && url.hostname === "127.0.0.1";
  if (!isSecure && !isLoopback) {
    throw new PlaylistTidyError(
      "VALIDATION_FAILED",
      "Spotify redirect URI must use HTTPS or an explicit 127.0.0.1 loopback address.",
    );
  }
}

function createRandomBase64Url(cryptoImplementation: Crypto): string {
  const bytes = cryptoImplementation.getRandomValues(new Uint8Array(RANDOM_BYTE_COUNT));
  return toBase64Url(bytes);
}

async function createCodeChallenge(
  cryptoImplementation: Crypto,
  verifier: string,
): Promise<string> {
  const digest = await cryptoImplementation.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return toBase64Url(new Uint8Array(digest));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  const maximumLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

