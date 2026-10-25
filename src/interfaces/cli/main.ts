// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { spawn, spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import process from "node:process";
import { SpotifyPkceAuth, SpotifyRefreshTokenAuth } from "../../adapters/oauth/index.js";
import type { SessionStoragePort } from "../../adapters/oauth/index.js";
import { SpotifyWebApiClient } from "../../adapters/spotify/index.js";
import { sortPlaylist } from "../../applications/sort/sortPlaylist.js";
import { PlaylistTidyError } from "../../core/errors.js";

const LOOPBACK_REDIRECT_URI = "http://127.0.0.1:8888/callback";
const DEFAULT_REPOSITORY = "AlbiDR/PlaylistTidy";
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9]{22}$/u;

const command = process.argv[2];
try {
  if (command === "run") await runScheduledSorting();
  else if (command === "enroll") await enrollAutomation();
  else throw new PlaylistTidyError("VALIDATION_FAILED", "Usage: playlist-tidy <run|enroll> [options]");
} catch (error) {
  process.stderr.write(`${getSafeErrorMessage(error)}\n`);
  process.exitCode = 1;
}

async function runScheduledSorting(): Promise<void> {
  const clientId = requireEnvironment("SPOTIFY_CLIENT_ID");
  const refreshToken = requireEnvironment("SPOTIFY_REFRESH_TOKEN");
  const playlistIds = parsePlaylistIds(requireEnvironment("PLAYLIST_IDS"));
  const rotatedTokenPath = process.env.ROTATED_REFRESH_TOKEN_FILE?.trim();
  const auth = new SpotifyRefreshTokenAuth(clientId, refreshToken);
  const spotify = new SpotifyWebApiClient(auth);
  let completed = 0;
  let failed = 0;

  await runWithConcurrency(playlistIds, 2, async (playlistId) => {
    try {
      const result = await sortPlaylist(spotify, playlistId);
      completed += 1;
      process.stdout.write(
        `Playlist ${String(completed + failed)} of ${String(playlistIds.length)}: ${result.status}; ${String(result.writeCalls)} writes.\n`,
      );
    } catch (error) {
      failed += 1;
      process.stderr.write(
        `Playlist ${String(completed + failed)} of ${String(playlistIds.length)} failed: ${getSafeErrorMessage(error)}\n`,
      );
    }
  });

  const rotatedToken = auth.takeRotatedRefreshToken();
  if (rotatedToken !== undefined) {
    if (rotatedTokenPath === undefined || rotatedTokenPath.length === 0) {
      throw new PlaylistTidyError(
        "AUTHENTICATION_FAILED",
        "Spotify rotated the automation credential, but no secure persistence path was configured.",
      );
    }
    await writeFile(rotatedTokenPath, rotatedToken, { encoding: "utf8", mode: 0o600 });
  }
  if (failed > 0) process.exitCode = 1;
  process.stdout.write(`${String(completed)} playlists sorted successfully; ${String(failed)} failed.\n`);
}

async function enrollAutomation(): Promise<void> {
  const clientId = requireEnvironment("SPOTIFY_CLIENT_ID");
  const repository = readOption("--repo") ?? DEFAULT_REPOSITORY;
  const configuredPlaylists = readOption("--playlists");
  if (configuredPlaylists !== undefined) parsePlaylistIds(configuredPlaylists);

  const storage = new MemoryStorage();
  let refreshToken: string | undefined;
  const auth = new SpotifyPkceAuth(storage, {
    onRefreshToken: (token) => {
      refreshToken = token;
    },
  });
  const authorizationUrl = await auth.createAuthorizationUrl(clientId, LOOPBACK_REDIRECT_URI);
  const callback = waitForLoopbackCallback();
  openBrowser(authorizationUrl);
  process.stdout.write("Complete Spotify authorization in the opened browser. Waiting up to five minutes…\n");
  await auth.completeAuthorizationCallback(await callback, clientId, LOOPBACK_REDIRECT_URI);
  if (refreshToken === undefined) {
    throw new PlaylistTidyError(
      "AUTHENTICATION_FAILED",
      "Spotify did not issue a refresh token. Revoke the app grant and enroll again.",
    );
  }

  setGitHubSecret(repository, "SPOTIFY_REFRESH_TOKEN", refreshToken);
  setGitHubVariable(repository, "SPOTIFY_CLIENT_ID", clientId);
  if (configuredPlaylists !== undefined) {
    setGitHubVariable(repository, "PLAYLIST_IDS", configuredPlaylists);
  }
  process.stdout.write("Scheduled sorting credentials and configuration were saved to GitHub.\n");
}

function waitForLoopbackCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new PlaylistTidyError("DEADLINE_EXCEEDED", "Spotify enrollment timed out."));
    }, 5 * 60 * 1000);
    const server = createServer((request, response) => {
      const callbackUrl = new URL(request.url ?? "/", LOOPBACK_REDIRECT_URI);
      if (callbackUrl.pathname !== "/callback") {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end("<!doctype html><title>Playlist Tidy</title><p>Authorization received. Return to the terminal.</p>");
      clearTimeout(timeout);
      server.close();
      resolve(callbackUrl.toString());
    });
    server.on("error", reject);
    server.listen(8888, "127.0.0.1");
  });
}

function openBrowser(url: string): void {
  const [executable, arguments_] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const child = spawn(executable, arguments_, { detached: true, stdio: "ignore" });
  child.unref();
}

function setGitHubSecret(repository: string, name: string, value: string): void {
  const result = spawnSync("gh", ["secret", "set", name, "--repo", repository], {
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new PlaylistTidyError("AUTHENTICATION_FAILED", "GitHub rejected the automation secret.");
  }
}

function setGitHubVariable(repository: string, name: string, value: string): void {
  const result = spawnSync("gh", ["variable", "set", name, "--repo", repository, "--body", value], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new PlaylistTidyError("VALIDATION_FAILED", `GitHub rejected the ${name} repository variable.`);
  }
}

function parsePlaylistIds(value: string): readonly string[] {
  const ids = [...new Set(value.split(/[\s,]+/u).map((entry) => entry.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.some((id) => !PLAYLIST_ID_PATTERN.test(id))) {
    throw new PlaylistTidyError(
      "VALIDATION_FAILED",
      "PLAYLIST_IDS must contain one or more comma- or whitespace-separated Spotify playlist IDs.",
    );
  }
  return ids;
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new PlaylistTidyError("VALIDATION_FAILED", `${name} is required.`);
  }
  return value;
}

function readOption(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function runWithConcurrency<T>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  const queue = [...values];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (;;) {
        const value = queue.shift();
        if (value === undefined) return;
        await worker(value);
      }
    }),
  );
}

function getSafeErrorMessage(error: unknown): string {
  return error instanceof PlaylistTidyError ? error.message : "An unexpected automation error occurred.";
}

class MemoryStorage implements SessionStoragePort {
  private readonly values = new Map<string, string>();

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
