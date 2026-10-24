// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { SpotifyPkceAuth } from "../../adapters/oauth/SpotifyPkceAuth.js";
import { SpotifyWebApiClient } from "../../adapters/spotify/SpotifyWebApiClient.js";
import type { SpotifyPlaylistSummary } from "../../applications/ports/SpotifyPlaylistPort.js";
import { previewPlaylistSort } from "../../applications/preview/previewPlaylistSort.js";
import { sortPlaylist } from "../../applications/sort/sortPlaylist.js";
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
      <a class="wordmark" href="./" aria-label="Playlist Tidy home">
        <svg class="wordmark__symbol" viewBox="0 0 32 32" aria-hidden="true">
          <path class="wordmark__symbol-p" d="M4 28V4h8.5C18 4 21.5 7.2 21.5 12s-3.5 8-9 8H9"/>
          <path class="wordmark__symbol-t" d="M18 4h11M23.5 4v24"/>
        </svg>
        <span>Playlist Tidy <small>for Spotify</small></span>
      </a>
    </header>
    <main>
      <section class="hero" aria-labelledby="connection-title">
        <div class="hero__copy">
          <p class="eyebrow">Order for your listening life</p>
          <h1 id="connection-title">Newest tracks.<br><em>Right where they belong.</em></h1>
          <p class="summary">
            Reorder playlists you own by date added—without replacing, removing,
            or duplicating a single item.
          </p>
          <div class="connection-row">
            <button id="connection-action" class="connect-button" type="button"></button>
            <p id="connection-status" class="connection-status" role="status" aria-live="polite"></p>
          </div>
          <p id="connection-error" class="error-message" role="alert"></p>
          <p class="trust-note">PKCE login / memory-only token / reorder-only writes</p>
        </div>
        <div class="sort-visual" aria-hidden="true">
          <div class="sort-visual__orbit sort-visual__orbit--outer"></div>
          <div class="sort-visual__orbit sort-visual__orbit--inner"></div>
          <div class="sort-visual__label">added_at ↓</div>
          <div class="track-stack">
            <div class="track-strip track-strip--one"><span>01</span><i></i><time>24 OCT</time></div>
            <div class="track-strip track-strip--two"><span>02</span><i></i><time>18 OCT</time></div>
            <div class="track-strip track-strip--three"><span>03</span><i></i><time>02 OCT</time></div>
          </div>
          <div class="sort-visual__stamp">stable sort<br>verified</div>
        </div>
      </section>
      <section class="route" aria-labelledby="route-heading">
        <div class="route__intro">
          <p class="eyebrow">The route</p>
          <h2 id="route-heading">Three deliberate steps.<br>No hidden magic.</h2>
        </div>
        <ol class="route__steps">
          <li class="route__step${state.kind === "connected" ? "" : " route__step--current"}">
            <span class="route__number">1</span>
            <div><h3>Connect</h3><p>Spotify authorization through PKCE. No client secret in the browser.</p></div>
          </li>
          <li class="route__step${state.kind === "connected" ? " route__step--current" : ""}">
            <span class="route__number">2</span>
            <div><h3>Preview</h3><p>See the exact move count before anything changes.</p></div>
          </li>
          <li class="route__step">
            <span class="route__number">3</span>
            <div><h3>Sort + verify</h3><p>Apply range moves, then prove membership and order are intact.</p></div>
          </li>
        </ol>
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
      <span>Built with a deliberately narrow permission boundary.</span>
      <span>Independent project · Not affiliated with or endorsed by Spotify.</span>
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
    const result = document.createElement("div");
    result.className = "preview-result";
    result.hidden = true;
    const resultMessage = document.createElement("p");
    const resultActions = document.createElement("div");
    resultActions.className = "preview-result__actions";
    result.append(resultMessage, resultActions);
    previewButton.addEventListener("click", () =>
      void previewPlaylist(playlist.id, previewButton, result, resultMessage, resultActions),
    );
    row.append(details, previewButton, result);
    list.append(row);
  }
}

async function previewPlaylist(
  playlistId: string,
  previewButton: HTMLButtonElement,
  result: HTMLElement,
  resultMessage: HTMLElement,
  resultActions: HTMLElement,
): Promise<void> {
  previewButton.disabled = true;
  previewButton.textContent = "Checking…";
  result.hidden = false;
  result.className = "preview-result";
  result.setAttribute("role", "status");
  resultMessage.textContent = "Reading the complete playlist and calculating a write-free plan…";
  resultActions.replaceChildren();
  try {
    const preview = await previewPlaylistSort(new SpotifyWebApiClient(auth), playlistId);
    if (preview.moves.length === 0) {
      resultMessage.textContent = `Already newest-first. ${String(preview.occurrenceCount)} items checked; no writes needed.`;
    } else {
      resultMessage.textContent = `${String(preview.moves.length)} range ${preview.moves.length === 1 ? "move" : "moves"} planned for ${String(preview.occurrenceCount)} items. Nothing has changed yet.`;
      const sortButton = document.createElement("button");
      sortButton.type = "button";
      sortButton.className = "sort-button";
      sortButton.textContent = "Sort now";
      sortButton.setAttribute("aria-label", `Apply ${String(preview.moves.length)} planned sorting moves`);
      sortButton.addEventListener("click", () =>
        void applyPlaylistSort(playlistId, previewButton, sortButton, result, resultMessage, resultActions),
      );
      resultActions.append(sortButton);
    }
  } catch (error) {
    result.className = "preview-result preview-result--error";
    result.setAttribute("role", "alert");
    resultMessage.textContent = getSafeErrorMessage(error);
  } finally {
    previewButton.disabled = false;
    previewButton.textContent = "Preview again";
  }
}

async function applyPlaylistSort(
  playlistId: string,
  previewButton: HTMLButtonElement,
  sortButton: HTMLButtonElement,
  result: HTMLElement,
  resultMessage: HTMLElement,
  resultActions: HTMLElement,
): Promise<void> {
  previewButton.disabled = true;
  sortButton.disabled = true;
  sortButton.textContent = "Sorting…";
  result.className = "preview-result preview-result--working";
  result.setAttribute("role", "status");
  resultMessage.textContent = "Sorting and reconciling each move. Keep this page open until verification finishes.";
  try {
    const outcome = await sortPlaylist(new SpotifyWebApiClient(auth), playlistId);
    result.className = "preview-result preview-result--success";
    resultMessage.textContent =
      outcome.status === "already-sorted"
        ? `No changes needed. ${String(outcome.occurrenceCount)} items were already newest-first.`
        : `Sorted and verified ${String(outcome.occurrenceCount)} items with ${String(outcome.writeCalls)} ${outcome.writeCalls === 1 ? "write" : "writes"}. Membership is unchanged.`;
    resultActions.replaceChildren();
  } catch (error) {
    result.className = "preview-result preview-result--error";
    result.setAttribute("role", "alert");
    resultMessage.textContent = getSafeErrorMessage(error);
    sortButton.disabled = false;
    sortButton.textContent = "Try sort again";
  } finally {
    previewButton.disabled = false;
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
        status: `Connected as ${state.userId}. ${String(state.playlists.length)} owned ${state.playlists.length === 1 ? "playlist" : "playlists"} loaded.`,
      };
    case "error":
      return { buttonLabel: "Try again", disabled: false, status: "" };
    case "disconnected":
      return { buttonLabel: "Connect Spotify", disabled: false, status: "" };
  }
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof PlaylistTidyError) return error.message;
  return "An unexpected error occurred while connecting to Spotify.";
}

void initialize();

