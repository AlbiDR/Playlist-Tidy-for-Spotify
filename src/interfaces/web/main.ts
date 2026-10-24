// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { SpotifyPkceAuth } from "../../adapters/oauth/SpotifyPkceAuth.js";
import { SpotifyWebApiClient } from "../../adapters/spotify/SpotifyWebApiClient.js";
import { PlaylistTidyError } from "../../core/errors.js";
import "./styles.css";

type ViewState =
  | { readonly kind: "config-missing" }
  | { readonly kind: "connecting" }
  | { readonly kind: "disconnected" }
  | { readonly kind: "connected"; readonly userId: string }
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
        <article class="workflow__step workflow__step--current">
          <p class="number">01</p>
          <h2>Connect</h2>
          <p>Authorize access through Spotify using PKCE.</p>
        </article>
        <article class="workflow__step">
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
        render({ kind: "connected", userId: user.id });
        return;
      }
    } catch (error) {
      render({ kind: "error", message: getSafeErrorMessage(error) });
      return;
    }
  }
  render({ kind: "disconnected" });
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

