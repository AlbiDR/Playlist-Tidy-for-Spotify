// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { SpotifyPkceAuth } from "../../adapters/oauth/SpotifyPkceAuth.js";
import { SpotifyWebApiClient } from "../../adapters/spotify/SpotifyWebApiClient.js";
import type { SpotifyPlaylistSummary } from "../../applications/ports/SpotifyPlaylistPort.js";
import { previewPlaylistSort } from "../../applications/preview/previewPlaylistSort.js";
import { PlaylistTidyError } from "../../core/errors.js";
import "./styles.css";

type ViewState =
  | { readonly kind: "config-missing" }
  | { readonly kind: "connecting" }
  | { readonly kind: "disconnected" }
  | {
      readonly kind: "connected";
      readonly userId: string;
      readonly playlists: readonly SpotifyPlaylistSummary[];
      readonly preview?: { readonly playlistId: string; readonly message: string; readonly isError: boolean };
    }
  | { readonly kind: "error"; readonly message: string };

const appRoot = document.querySelector<HTMLElement>("#app");
if (appRoot === null) throw new Error("The application root is missing.");
const app: HTMLElement = appRoot;

const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim() ?? "";
const redirectUri = `${window.location.origin}${window.location.pathname}`;
const auth = new SpotifyPkceAuth(window.sessionStorage);

function render(state: ViewState): void {
  const connection = getConnectionPresentation(state);
  app.innerHTML = `
    <header class="app-header">
      <p class="wordmark">Playlist Tidy <span>for Spotify</span></p>
      <p class="build-label">Development preview</p>
    </header>
    <main>
      <section class="connection-panel" aria-labelledby="connection-title">
        <p class="step-label">Step 1 of 3</p>
        <h1 id="connection-title">Connect your Spotify account</h1>
        <p class="summary">
          Playlist Tidy needs permission to read and reorder playlists you own.
          It cannot add, remove, replace, create, or delete playlist items.
        </p>
        <div class="connection-row">
          <button id="connection-action" class="connect-button" type="button"></button>
          <p id="connection-status" class="connection-status" role="status" aria-live="polite"></p>
        </div>
        <p id="connection-error" class="error-message" role="alert"></p>
      </section>
      <section class="workflow" aria-label="Playlist sorting workflow">
        <article class="workflow__step${state.kind === "connected" ? "" : " workflow__step--current"}">
          <p class="number">01</p>
          <h2>Connect</h2>
          <p>Authorize access through Spotify using PKCE.</p>
        </article>
        <article class="workflow__step${state.kind === "connected" ? " workflow__step--current" : ""}">
          <p class="number">02</p>
          <h2>Choose and preview</h2>
          <p>Playlist discovery is the next implementation milestone.</p>
        </article>
        <article class="workflow__step">
          <p class="number">03</p>
          <h2>Sort and verify</h2>
          <p>Reorder newest-first and independently verify the result.</p>
        </article>
      </section>
      <section id="playlist-catalog" class="playlist-catalog" aria-labelledby="playlist-heading" hidden>
        <div class="section-heading">
          <div>
            <p class="step-label">Step 2 of 3</p>
            <h2 id="playlist-heading">Choose a playlist</h2>
          </div>
          <p id="playlist-count" class="playlist-count"></p>
        </div>
        <div id="playlist-list" class="playlist-list"></div>
      </section>
    </main>
    <footer>
      Access tokens stay in memory and disappear when this page reloads.
      Independently developed; not affiliated with or endorsed by Spotify.
    </footer>
  `;

  const button = document.querySelector<HTMLButtonElement>("#connection-action");
  const status = document.querySelector<HTMLElement>("#connection-status");
  const error = document.querySelector<HTMLElement>("#connection-error");
  if (button === null || status === null || error === null) {
    throw new Error("Connection controls are missing.");
  }
  button.textContent = connection.buttonLabel;
  button.disabled = connection.disabled;
  status.textContent = connection.status;
  error.textContent = state.kind === "error" ? state.message : "";

  if (state.kind === "connected") {
    button.addEventListener("click", () => {
      auth.disconnect();
      render({ kind: "disconnected" });
    });
    renderPlaylistCatalog(state);
  } else if (state.kind === "disconnected" || state.kind === "error") {
    button.addEventListener("click", () => void beginLogin());
  }
}

async function beginLogin(): Promise<void> {
  render({ kind: "connecting" });
  try {
    const authorizationUrl = await auth.createAuthorizationUrl(clientId, redirectUri);
    window.location.assign(authorizationUrl);
  } catch (error) {
    render({ kind: "error", message: getSafeErrorMessage(error) });
  }
}

async function initialize(): Promise<void> {
  if (clientId.length === 0) {
    render({ kind: "config-missing" });
    return;
  }

  const callbackUrl = window.location.href;
  const callbackParameters = new URL(callbackUrl).searchParams;
  if (callbackParameters.has("code") || callbackParameters.has("error")) {
    window.history.replaceState({}, "", redirectUri);
    render({ kind: "connecting" });
    try {
      const result = await auth.completeAuthorizationCallback(callbackUrl, clientId, redirectUri);
      if (result.status === "connected") {
        const spotify = new SpotifyWebApiClient(auth);
        const user = await spotify.getCurrentUser();
        const playlists = await spotify.getOwnedPlaylists(user.id);
        render({ kind: "connected", userId: user.id, playlists });
        return;
      }
    } catch (error) {
      render({ kind: "error", message: getSafeErrorMessage(error) });
      return;
    }
  }
  render({ kind: "disconnected" });
}

function renderPlaylistCatalog(state: Extract<ViewState, { readonly kind: "connected" }>): void {
  const catalog = document.querySelector<HTMLElement>("#playlist-catalog");
  const list = document.querySelector<HTMLElement>("#playlist-list");
  const count = document.querySelector<HTMLElement>("#playlist-count");
  if (catalog === null || list === null || count === null) {
    throw new Error("Playlist catalog controls are missing.");
  }
  catalog.hidden = false;
  count.textContent = `${String(state.playlists.length)} owned ${state.playlists.length === 1 ? "playlist" : "playlists"}`;

  if (state.playlists.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = "No owned playlists were returned by Spotify.";
    list.append(empty);
    return;
  }

  for (const playlist of state.playlists) {
    const row = document.createElement("article");
    row.className = "playlist-row";
    const details = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = playlist.name;
    const metadata = document.createElement("p");
    metadata.textContent = `${String(playlist.itemCount)} ${playlist.itemCount === 1 ? "item" : "items"} · ${playlist.isPublic === true ? "Public" : "Private"}`;
    details.append(name, metadata);

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "preview-button";
    previewButton.textContent = "Preview";
    previewButton.setAttribute("aria-label", `Preview sorting ${playlist.name}`);
    previewButton.addEventListener("click", () => void previewPlaylist(state, playlist.id));
    row.append(details, previewButton);

    if (state.preview?.playlistId === playlist.id) {
      const result = document.createElement("p");
      result.className = state.preview.isError ? "preview-result preview-result--error" : "preview-result";
      result.textContent = state.preview.message;
      result.setAttribute("role", state.preview.isError ? "alert" : "status");
      row.append(result);
    }
    list.append(row);
  }
}

async function previewPlaylist(
  state: Extract<ViewState, { readonly kind: "connected" }>,
  playlistId: string,
): Promise<void> {
  render({
    ...state,
    preview: { playlistId, message: "Calculating a write-free preview…", isError: false },
  });
  try {
    const preview = await previewPlaylistSort(new SpotifyWebApiClient(auth), playlistId);
    const message =
      preview.moves.length === 0
        ? `Already newest-first. ${String(preview.occurrenceCount)} items checked; no writes needed.`
        : `${String(preview.moves.length)} range ${preview.moves.length === 1 ? "move" : "moves"} planned for ${String(preview.occurrenceCount)} items. No changes were made.`;
    render({ ...state, preview: { playlistId, message, isError: false } });
  } catch (error) {
    render({
      ...state,
      preview: { playlistId, message: getSafeErrorMessage(error), isError: true },
    });
  }
}

function getConnectionPresentation(state: ViewState): {
  readonly buttonLabel: string;
  readonly disabled: boolean;
  readonly status: string;
} {
  switch (state.kind) {
    case "config-missing":
      return {
        buttonLabel: "Connect Spotify",
        disabled: true,
        status: "A Spotify Client ID must be configured before login can be enabled.",
      };
    case "connecting":
      return { buttonLabel: "Connecting…", disabled: true, status: "Completing Spotify login." };
    case "connected":
      return {
        buttonLabel: "Disconnect",
        disabled: false,
        status: `Connected as ${state.userId}. Playlist browsing is not implemented yet.`,
      };
    case "error":
      return { buttonLabel: "Try again", disabled: false, status: "Spotify is not connected." };
    case "disconnected":
      return { buttonLabel: "Connect Spotify", disabled: false, status: "Spotify is not connected." };
  }
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof PlaylistTidyError) return error.message;
  return "An unexpected error occurred while connecting to Spotify.";
}

void initialize();

