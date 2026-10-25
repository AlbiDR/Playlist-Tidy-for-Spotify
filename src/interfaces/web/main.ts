// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { SpotifyPkceAuth } from "../../adapters/oauth/SpotifyPkceAuth.js";
import type { SessionStoragePort } from "../../adapters/oauth/SpotifyPkceAuth.js";
import { SpotifyWebApiClient } from "../../adapters/spotify/SpotifyWebApiClient.js";
import type { SpotifyPlaylistSummary } from "../../applications/ports/SpotifyPlaylistPort.js";
import { previewPlaylistSort } from "../../applications/preview/previewPlaylistSort.js";
import type { PlaylistSortPreview } from "../../applications/preview/previewPlaylistSort.js";
import { sortPlaylist } from "../../applications/sort/sortPlaylist.js";
import { PlaylistTidyError } from "../../core/errors.js";
import { applyMovePlan, getTargetOrder, haveEqualMembership, isNewestFirst, planPlaylistSort } from "../../core/playlist/index.js";
import type { PlaylistOccurrence, PlaylistView } from "../../core/playlist/types.js";
import markUrl from "./favicon.svg";
import "./styles.css";

type ViewState =
  | { readonly kind: "config-missing" }
  | { readonly kind: "connecting" }
  | { readonly kind: "disconnected" }
  | {
      readonly kind: "connected";
      readonly userId: string;
      readonly playlists: readonly SpotifyPlaylistSummary[];
      readonly libraryStatus: "loading" | "ready";
    }
  | { readonly kind: "error"; readonly message: string };

const CLIENT_ID_STORAGE_KEY = "playlist-tidy.spotify-client-id";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const DEMO_TRACKS = [
  { title: "Northbound", artist: "Paper Satellites", addedAt: "2026-09-29T18:10:00.000Z" },
  { title: "Afterimage", artist: "Glass Hours", addedAt: "2026-10-24T21:45:00.000Z" },
  { title: "Open Water", artist: "Mira Vale", addedAt: "2026-10-02T07:30:00.000Z" },
  { title: "Soft Signal", artist: "Low Season", addedAt: "2026-10-21T16:05:00.000Z" },
  { title: "Night Bus", artist: "Neon Static", addedAt: "2026-10-18T23:20:00.000Z" },
] as const;
const DEMO_OCCURRENCES: readonly PlaylistOccurrence[] = DEMO_TRACKS.map((track, originalPosition) => ({
  originalPosition,
  uri: `sample:track:${String(originalPosition)}`,
  itemType: "track",
  addedAt: track.addedAt,
  addedById: "sample-listener",
}));

const appRoot = document.querySelector<HTMLElement>("#app");
if (appRoot === null) throw new Error("The application root is missing.");
const app: HTMLElement = appRoot;

const redirectUri = `${window.location.origin}${window.location.pathname}`;
const sessionStorage = getSessionStorage();
let customClientId = readCustomClientId(sessionStorage);
let clientId = customClientId ?? "";
const auth = new SpotifyPkceAuth(sessionStorage);
let connectionEpoch = 0;
let revealObserver: IntersectionObserver | undefined;
let hasIntroducedPage = false;
let progressListenersInitialized = false;
let progressAnimation: Animation | undefined;
let pointerLightInitialized = false;
let pointerFrame: number | undefined;
let pointerX = 0;
let pointerY = 0;
let pointerRenderedX = 0;
let pointerRenderedY = 0;
let pointerHasPosition = false;
let pointerInside = false;
let pointerVelocityX = 0;
let pointerVelocityY = 0;
let interactionEnergy = 0;
let scrollEnergy = 0;
let scrollDirection = 0;
let previousScrollY = window.scrollY;
let runtimeFailureShown = false;
let writeOperationActive = false;

function render(state: ViewState): void {
  const connection = getConnectionPresentation(state);
  const quotaExhausted = state.kind === "error" && state.message.includes("Development Mode quota");
  const showCustomApp = customClientId !== undefined || quotaExhausted;
  const showConnection = customClientId !== undefined || state.kind === "connecting" || state.kind === "connected" || state.kind === "error";
  app.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <div class="reading-progress" aria-hidden="true"></div>
    <header class="app-header">
      <a class="wordmark" href="./" aria-label="Playlist Tidy for Spotify home">
        <img class="wordmark__symbol" src="${markUrl}" alt="" width="32" height="32" />
        <span>Playlist Tidy <small>for Spotify</small></span>
      </a>
      <a class="repository-link" href="https://github.com/AlbiDR/PlaylistTidy" target="_blank" rel="noopener noreferrer">Source &amp; automation ↗</a>
    </header>
    <main id="main-content" tabindex="-1">
      <section class="hero" aria-labelledby="connection-title">
        <div class="hero__copy reveal">
          <p class="eyebrow">Order for your listening life</p>
          <h1 id="connection-title">Newest tracks.<br><em>Right where they belong.</em></h1>
          <p class="summary">
            Playlist Tidy sorts the tracks inside playlists you own by the date each track
            was added, with the newest at the top. It does not delete tracks, edit music,
            or rearrange the playlists in your library.
          </p>
          <div class="hero-actions">
            <button id="demo-action" class="connect-button" type="button">Try the interactive demo</button>
            <button id="spotify-setup-action" class="secondary-button" type="button">Use with my Spotify app</button>
          </div>
          <p class="demo-intro"><strong>No account needed.</strong> The demo uses clearly labelled sample tracks and the real Playlist Tidy planning engine. It never contacts Spotify.</p>
          <div class="connection-row"${showConnection ? "" : " hidden"}>
            <button id="connection-action" class="connect-button connect-button--compact" type="button" aria-describedby="connection-status connection-error personal-access-note"></button>
            <p id="connection-status" class="connection-status" role="status" aria-live="polite"></p>
          </div>
          <p id="connection-error" class="error-message" role="alert" tabindex="-1"></p>
          <p id="personal-access-note" class="session-note"${showConnection ? "" : " hidden"}><strong>Personal connection.</strong> Reloading or closing this page ends the Spotify access-token session.</p>
          <details id="custom-app-setup" class="custom-app-setup"${showCustomApp ? " open" : ""}>
            <summary>Advanced: connect your Spotify app</summary>
            <div class="custom-app-setup__body">
              <p>Real Spotify access is for personal and self-hosted use. Create an app in the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">Spotify Developer Dashboard ↗</a>, register the exact redirect URI below, and paste its public Client ID. Spotify requires the app owner to have Premium. Never paste a Client Secret.</p>
              ${customClientId === undefined ? "" : '<p class="custom-app-setup__active"><strong>Active for this tab:</strong> Using your own Spotify Client ID.</p>'}
              <p class="custom-app-setup__redirect"><strong>Redirect URI</strong><code id="custom-redirect-uri"></code></p>
              <form id="custom-client-form" novalidate>
                <label for="custom-client-id">Spotify Client ID</label>
                <div class="custom-app-setup__controls">
                  <input id="custom-client-id" name="spotify-client-id" type="text" inputmode="text" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="custom-client-help custom-client-status" />
                  <button class="custom-client-submit" type="submit">Connect with my Client ID</button>
                </div>
                <p id="custom-client-help" class="custom-app-setup__help">Stored only in this tab’s session storage so it survives Spotify’s redirect. A Client ID is public configuration, not a password.</p>
                <p id="custom-client-status" class="custom-app-setup__status" role="alert"></p>
              </form>
              ${customClientId === undefined ? "" : '<button id="forget-custom-client" class="custom-client-forget" type="button">Forget my Client ID</button>'}
            </div>
          </details>
          <p class="trust-note">Synthetic demo / optional PKCE login / reorder-only Spotify writes</p>
        </div>
        <div class="sort-visual-wrap reveal reveal--delay-1">
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
        </div>
      </section>
      <section id="interactive-demo" class="interactive-demo reveal" aria-labelledby="demo-heading">
        <div class="interactive-demo__intro">
          <p class="eyebrow">Interactive product demo</p>
          <div class="demo-badge">Synthetic sample data</div>
          <h2 id="demo-heading">See the safety flow.<br>No Spotify account needed.</h2>
          <p>This walkthrough runs the production ordering and planning code entirely in your browser. The fictional tracks below are not Spotify content, and the demo performs no network request or persistent storage.</p>
          <div class="interactive-demo__controls">
            <button id="demo-primary-action" class="preview-button" type="button">Preview the sort</button>
            <button id="demo-reset" class="custom-client-forget" type="button" hidden>Reset demo</button>
          </div>
          <p id="demo-status" class="demo-status" role="status" aria-live="polite">The sample playlist is intentionally out of order. Previewing calculates a plan without changing it.</p>
        </div>
        <div class="demo-playlist" aria-label="Synthetic sample playlist">
          <div class="demo-playlist__header">
            <div>
              <span>Sample playlist</span>
              <strong>Late-night discoveries</strong>
            </div>
            <span id="demo-phase" class="demo-phase">Unsorted</span>
          </div>
          <ol id="demo-track-list" class="demo-track-list"></ol>
          <p class="demo-proof"><strong>Boundary:</strong> the order may change; titles, artists, dates, and membership never do.</p>
        </div>
      </section>
      <section class="purpose" aria-labelledby="purpose-heading">
        <header class="purpose__heading reveal">
          <p class="eyebrow">What Playlist Tidy does</p>
          <h2 id="purpose-heading">One useful job.<br>Handled carefully.</h2>
          <p>Spotify records when every track joined a playlist. Playlist Tidy uses that date to restore a clear newest-first order.</p>
        </header>
        <ol class="purpose__steps">
          <li class="purpose__step reveal">
            <span>01</span>
            <div><h3>Reads the full playlist</h3><p>It loads every track and its Spotify <code>added_at</code> value. Nothing changes during this step.</p></div>
          </li>
          <li class="purpose__step reveal reveal--delay-1">
            <span>02</span>
            <div><h3>Shows the required moves</h3><p>You see how many reorder operations are needed before deciding whether to continue.</p></div>
          </li>
          <li class="purpose__step reveal reveal--delay-2">
            <span>03</span>
            <div><h3>Reorders and verifies</h3><p>After approval, it moves tracks into newest-first order and confirms that every original track remains.</p></div>
          </li>
        </ol>
        <p class="purpose__boundary reveal"><strong>The boundary:</strong> track order changes; playlist membership and track metadata do not.</p>
      </section>
      <section class="journeys" aria-labelledby="journeys-heading">
        <header class="journeys__heading reveal">
          <p class="eyebrow">Two honest ways to use it</p>
          <h2 id="journeys-heading">Try it here.<br>Use Spotify from your own app.</h2>
        </header>
        <div class="journey reveal">
          <p class="journey__index" aria-hidden="true">01</p>
          <div>
            <h3>Trying the public demo</h3>
            <p>Anyone can preview, confirm, and verify a newest-first sort with synthetic data. It runs locally, contacts no service, stores nothing, and is always available.</p>
          </div>
          <p class="journey__outcome">Interactive · no account</p>
        </div>
        <div class="journey reveal reveal--delay-1">
          <p class="journey__index" aria-hidden="true">02</p>
          <div>
            <h3>Using your Spotify playlists</h3>
            <p>Bring the public Client ID from your own Spotify Development Mode app for a manual browser session, or clone the repository and enroll scheduled maintenance at 00:00 and 12:00 UTC.</p>
            <a href="https://github.com/AlbiDR/PlaylistTidy#scheduled-sorting">Read the self-hosting setup →</a>
          </div>
          <p class="journey__outcome">Personal · developer configured</p>
        </div>
      </section>
      <section class="route reveal" aria-labelledby="route-heading">
        <div class="route__intro">
          <p class="eyebrow">Inside this browser session</p>
          <h2 id="route-heading">You stay in control<br>of every write.</h2>
        </div>
        <ol class="route__steps">
          <li class="route__step${state.kind === "connected" ? " route__step--complete" : " route__step--current"}" data-route-step="1">
            <span class="route__number">1</span>
            <div><h3>Connect for now</h3><p>Authorize through Spotify. The website keeps no reusable login for later.</p></div>
          </li>
          <li class="route__step${state.kind === "connected" ? " route__step--current" : ""}" data-route-step="2">
            <span class="route__number">2</span>
            <div><h3>Preview</h3><p>See the exact move count before anything changes.</p></div>
          </li>
          <li class="route__step" data-route-step="3">
            <span class="route__number">3</span>
            <div><h3>Confirm, sort, verify</h3><p>You approve the write. Playlist Tidy applies range moves, then proves membership and order are intact.</p></div>
          </li>
        </ol>
      </section>
      <section id="playlist-catalog" class="playlist-catalog reveal" aria-labelledby="playlist-heading" hidden>
        <div class="section-heading">
          <div>
            <p class="step-label">Step 2 of 3</p>
            <h2 id="playlist-heading">Choose a playlist</h2>
          </div>
          <p id="playlist-count" class="playlist-count"></p>
        </div>
        <div id="batch-toolbar" class="batch-toolbar" hidden>
          <p><strong id="batch-count">0 selected</strong><span>Choose playlists, preview them together, then confirm one bounded sorting queue.</span></p>
          <div class="batch-toolbar__actions">
            <button id="batch-preview" class="preview-button" type="button" disabled>Preview selected</button>
            <button id="batch-sort" class="sort-button" type="button" disabled>Sort selected</button>
          </div>
          <p id="batch-status" class="batch-status" role="status" aria-live="polite"></p>
        </div>
        <div id="playlist-list" class="playlist-list"></div>
      </section>
    </main>
    <footer class="reveal">
      <div class="footer-credit">
        <strong>Open source</strong>
        <p>Built by <a href="https://github.com/AlbiDR" target="_blank" rel="noopener noreferrer">AlbiDR</a>. Read, audit, or fork the <a href="https://github.com/AlbiDR/PlaylistTidy" target="_blank" rel="noopener noreferrer">Playlist Tidy repository</a>.</p>
      </div>
      <div class="footer-credit">
        <strong>Where automatic sorting lives</strong>
        <p>Recurring sorting is powered by this repository’s <a href="https://github.com/AlbiDR/PlaylistTidy/actions/workflows/scheduled-sort.yml" target="_blank" rel="noopener noreferrer">Scheduled Playlist Sort workflow</a>, running inside each self-hosted copy, not this browser tab.</p>
      </div>
      <p class="footer-legal"><a href="./privacy.html">Privacy &amp; safe use</a> · Independent project · Not affiliated with or endorsed by Spotify.</p>
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
  app.setAttribute("aria-busy", state.kind === "connecting" ? "true" : "false");
  initializeCustomClientControls();
  initializeDemo();

  document.querySelector<HTMLButtonElement>("#demo-action")?.addEventListener("click", () => {
    const demo = document.querySelector<HTMLElement>("#interactive-demo");
    demo?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    document.querySelector<HTMLButtonElement>("#demo-primary-action")?.focus({ preventScroll: true });
  });
  document.querySelector<HTMLButtonElement>("#spotify-setup-action")?.addEventListener("click", () => {
    const setup = document.querySelector<HTMLDetailsElement>("#custom-app-setup");
    setup?.setAttribute("open", "");
    setup?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    document.querySelector<HTMLInputElement>("#custom-client-id")?.focus({ preventScroll: true });
  });

  if (state.kind === "connected") {
    button.addEventListener("click", () => {
      connectionEpoch += 1;
      auth.disconnect();
      render({ kind: "disconnected" });
    });
    renderPlaylistCatalog(state);
  } else if (state.kind === "disconnected" || state.kind === "error") {
    button.addEventListener("click", () => void beginLogin());
  }
  initializeMotion();
  initializeInteractions();
}

function initializeDemo(): void {
  const list = document.querySelector<HTMLOListElement>("#demo-track-list");
  const primary = document.querySelector<HTMLButtonElement>("#demo-primary-action");
  const reset = document.querySelector<HTMLButtonElement>("#demo-reset");
  const status = document.querySelector<HTMLElement>("#demo-status");
  const phase = document.querySelector<HTMLElement>("#demo-phase");
  if (list === null || primary === null || reset === null || status === null || phase === null) {
    throw new Error("Interactive demo controls are missing.");
  }

  const plan = planPlaylistSort(DEMO_OCCURRENCES);
  let order: readonly PlaylistOccurrence[] = DEMO_OCCURRENCES;
  let step: "initial" | "previewed" | "verified" = "initial";

  const renderTracks = (): void => {
    list.replaceChildren(...order.map((occurrence, index) => {
      const track = DEMO_TRACKS[occurrence.originalPosition];
      if (track === undefined) throw new Error("Interactive demo track identity is invalid.");
      const item = document.createElement("li");
      item.className = "demo-track";
      const position = document.createElement("span");
      position.className = "demo-track__position";
      position.textContent = String(index + 1).padStart(2, "0");
      const identity = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = track.title;
      const artist = document.createElement("span");
      artist.textContent = track.artist;
      identity.append(title, artist);
      const date = document.createElement("time");
      date.dateTime = track.addedAt;
      date.textContent = new Intl.DateTimeFormat("en", { day: "2-digit", month: "short" }).format(new Date(track.addedAt));
      item.append(position, identity, date);
      return item;
    }));
  };

  const resetDemo = (): void => {
    order = DEMO_OCCURRENCES;
    step = "initial";
    primary.textContent = "Preview the sort";
    primary.disabled = false;
    reset.hidden = true;
    phase.textContent = "Unsorted";
    phase.className = "demo-phase";
    status.textContent = "The sample playlist is intentionally out of order. Previewing calculates a plan without changing it.";
    renderTracks();
  };

  primary.addEventListener("click", () => {
    if (step === "initial") {
      step = "previewed";
      primary.textContent = "Apply sample sort";
      reset.hidden = false;
      phase.textContent = "Preview ready";
      phase.className = "demo-phase demo-phase--preview";
      status.textContent = `${String(plan.length)} range ${plan.length === 1 ? "move" : "moves"} planned for ${String(order.length)} sample tracks. The displayed order has not changed.`;
      return;
    }
    if (step !== "previewed") return;
    const sorted = applyMovePlan(order, plan);
    if (!haveEqualMembership(order, sorted) || !isNewestFirst(sorted)) {
      throw new Error("Interactive demo verification failed.");
    }
    const target = getTargetOrder(order);
    if (!target.every((occurrence, index) => occurrence.originalPosition === sorted[index]?.originalPosition)) {
      throw new Error("Interactive demo did not reach its target order.");
    }
    order = sorted;
    step = "verified";
    primary.textContent = "Sort verified";
    primary.disabled = true;
    phase.textContent = "Verified newest-first";
    phase.className = "demo-phase demo-phase--verified";
    status.textContent = `Sorted and verified ${String(order.length)} sample tracks with ${String(plan.length)} ${plan.length === 1 ? "move" : "moves"}. Membership and track details are unchanged.`;
    renderTracks();
  });
  reset.addEventListener("click", resetDemo);
  resetDemo();
}

function initializeCustomClientControls(): void {
  const form = document.querySelector<HTMLFormElement>("#custom-client-form");
  const input = document.querySelector<HTMLInputElement>("#custom-client-id");
  const status = document.querySelector<HTMLElement>("#custom-client-status");
  const redirect = document.querySelector<HTMLElement>("#custom-redirect-uri");
  if (form === null || input === null || status === null || redirect === null) {
    throw new Error("Custom Spotify application controls are missing.");
  }
  redirect.textContent = redirectUri;
  input.value = customClientId ?? "";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const candidate = input.value.trim();
    if (!CLIENT_ID_PATTERN.test(candidate)) {
      status.textContent = "Enter the public Client ID only. It should contain 16 to 128 letters, numbers, underscores, or hyphens.";
      input.focus();
      return;
    }
    try {
      sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, candidate);
    } catch {
      status.textContent = "This browser blocked the temporary session storage needed to carry your Client ID through Spotify login.";
      return;
    }
    auth.disconnect();
    customClientId = candidate;
    clientId = candidate;
    void beginLogin();
  });

  document.querySelector<HTMLButtonElement>("#forget-custom-client")?.addEventListener("click", () => {
    connectionEpoch += 1;
    auth.disconnect();
    sessionStorage.removeItem(CLIENT_ID_STORAGE_KEY);
    customClientId = undefined;
    clientId = "";
    render({ kind: "config-missing" });
  });
}

function renderEmbeddedRefusal(): void {
  app.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <main id="main-content" class="fatal-error frame-refusal" tabindex="-1">
      <p class="eyebrow">Direct access required</p>
      <h1>Open Playlist Tidy directly.</h1>
      <p>For your protection, Playlist Tidy will not connect to Spotify or access playlist data while it is embedded inside another website.</p>
      <a class="safe-open-link" href="./" target="_blank" rel="noopener noreferrer">Open Playlist Tidy in a new tab</a>
      <p class="frame-refusal__note">No authorization request or playlist operation was started.</p>
    </main>
  `;
}

async function beginLogin(): Promise<void> {
  connectionEpoch += 1;
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
    const callbackEpoch = ++connectionEpoch;
    window.history.replaceState({}, "", redirectUri);
    render({ kind: "connecting" });
    try {
      const result = await auth.completeAuthorizationCallback(callbackUrl, clientId, redirectUri);
      if (result.status === "connected") {
        const spotify = new SpotifyWebApiClient(auth);
        const user = await spotify.getCurrentUser();
        if (callbackEpoch !== connectionEpoch) return;
        render({ kind: "connected", userId: user.id, playlists: [], libraryStatus: "loading" });
        const playlists = await spotify.getOwnedPlaylists(user.id);
        if (callbackEpoch !== connectionEpoch) return;
        render({ kind: "connected", userId: user.id, playlists, libraryStatus: "ready" });
        return;
      }
    } catch (error) {
      if (callbackEpoch !== connectionEpoch) return;
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
  catalog.setAttribute("aria-busy", state.libraryStatus === "loading" ? "true" : "false");
  if (state.libraryStatus === "loading") {
    count.textContent = "Loading…";
    const loading = document.createElement("p");
    loading.className = "empty-message";
    loading.textContent = "Loading your owned playlists from Spotify…";
    list.append(loading);
    return;
  }
  count.textContent = `${String(state.playlists.length)} owned ${state.playlists.length === 1 ? "playlist" : "playlists"}`;

  if (state.playlists.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = "No owned playlists were returned by Spotify.";
    list.append(empty);
    return;
  }

  const toolbar = document.querySelector<HTMLElement>("#batch-toolbar");
  const batchCount = document.querySelector<HTMLElement>("#batch-count");
  const batchStatus = document.querySelector<HTMLElement>("#batch-status");
  const batchPreview = document.querySelector<HTMLButtonElement>("#batch-preview");
  const batchSort = document.querySelector<HTMLButtonElement>("#batch-sort");
  if (
    toolbar === null ||
    batchCount === null ||
    batchStatus === null ||
    batchPreview === null ||
    batchSort === null
  ) {
    throw new Error("Batch playlist controls are missing.");
  }
  const batchStatusElement = batchStatus;
  toolbar.hidden = false;
  const spotify = new SpotifyWebApiClient(auth);
  const selected = new Set<string>();
  const previews = new Map<string, PlaylistSortPreview>();
  const rows = new Map<string, PlaylistRowControls>();
  let catalogBusy = false;

  const updateBatchControls = (): void => {
    const selectedIds = [...selected];
    const previewed = selectedIds.filter((id) => previews.has(id));
    const sortable = previewed.filter((id) => (previews.get(id)?.moves.length ?? 0) > 0);
    batchCount.textContent = `${String(selectedIds.length)} selected`;
    batchPreview.disabled = catalogBusy || selectedIds.length === 0;
    batchSort.disabled =
      catalogBusy || selectedIds.length === 0 || previewed.length !== selectedIds.length || sortable.length === 0;
    for (const controls of rows.values()) {
      controls.selection.disabled = catalogBusy;
      controls.previewButton.disabled = catalogBusy;
      for (const action of controls.resultActions.querySelectorAll<HTMLButtonElement>("button")) {
        action.disabled = catalogBusy;
      }
    }
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "#custom-app-setup input, #custom-app-setup button",
    )) {
      control.disabled = catalogBusy;
    }
    const connectionButton = document.querySelector<HTMLButtonElement>("#connection-action");
    if (connectionButton !== null) connectionButton.disabled = catalogBusy;
    catalog.setAttribute("aria-busy", catalogBusy ? "true" : "false");
  };

  const runCatalogOperation: CatalogOperationRunner = async (operation, protectsNavigation = false) => {
    if (catalogBusy) return undefined;
    catalogBusy = true;
    writeOperationActive = protectsNavigation;
    updateBatchControls();
    try {
      return await operation();
    } finally {
      writeOperationActive = false;
      catalogBusy = false;
      updateBatchControls();
    }
  };

  for (const playlist of state.playlists) {
    const row = document.createElement("article");
    row.className = "playlist-row";
    const selector = document.createElement("label");
    selector.className = "playlist-selector";
    const selection = document.createElement("input");
    selection.type = "checkbox";
    selection.setAttribute("aria-label", `Select ${playlist.name}`);
    const selectionMark = document.createElement("span");
    selectionMark.setAttribute("aria-hidden", "true");
    selector.append(selection, selectionMark);
    const details = document.createElement("div");
    details.className = "playlist-details";
    const name = document.createElement("h3");
    name.textContent = playlist.name;
    const metadata = document.createElement("p");
    metadata.textContent = `${String(playlist.itemCount)} ${playlist.itemCount === 1 ? "item" : "items"} · ${formatPlaylistVisibility(playlist.isPublic)}`;
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
    const controls: PlaylistRowControls = {
      selection,
      previewButton,
      result,
      resultMessage,
      resultActions,
      playlistName: playlist.name,
    };
    rows.set(playlist.id, controls);
    selection.addEventListener("change", () => {
      if (selection.checked) selected.add(playlist.id);
      else selected.delete(playlist.id);
      row.classList.toggle("playlist-row--selected", selection.checked);
      batchStatus.textContent = "";
      updateBatchControls();
    });
    previewButton.addEventListener("click", () => {
      void runCatalogOperation(async () => {
        const preview = await previewPlaylist(spotify, playlist.id, controls, () => {
          previews.delete(playlist.id);
          updateBatchControls();
        }, runCatalogOperation);
        if (preview !== undefined) previews.set(playlist.id, preview);
        updateBatchControls();
      });
    });
    row.append(selector, details, previewButton, result);
    list.append(row);
  }

  batchPreview.addEventListener("click", () => {
    void runCatalogOperation(runBatchPreview);
  });
  batchSort.addEventListener("click", () => {
    void runCatalogOperation(runBatchSort, true);
  });
  updateBatchControls();

  async function runBatchPreview(): Promise<void> {
    setRoutePhase("preview");
    const ids = [...selected];
    let completed = 0;
    let failed = 0;
    await runWithConcurrency(ids, 2, async (id) => {
      const controls = rows.get(id);
      if (controls === undefined) return;
      const preview = await previewPlaylist(spotify, id, controls, () => {
        previews.delete(id);
        updateBatchControls();
      }, runCatalogOperation);
      if (preview === undefined) failed += 1;
      else previews.set(id, preview);
      completed += 1;
      batchStatusElement.textContent = `Previewed ${String(completed)} of ${String(ids.length)} selected playlists.`;
    });
    batchStatusElement.textContent = failed === 0
      ? `${String(ids.length)} playlists previewed. Review the plans, then confirm the batch.`
      : `${String(ids.length - failed)} playlists previewed; ${String(failed)} need attention below.`;
    if (failed === 0) {
      setRoutePhase(ids.some((id) => (previews.get(id)?.moves.length ?? 0) > 0) ? "confirm" : "verified");
    }
    updateBatchControls();
  }

  async function runBatchSort(): Promise<void> {
    const ids = [...selected].filter((id) => (previews.get(id)?.moves.length ?? 0) > 0);
    setRoutePhase("sorting");
    let completed = 0;
    let failed = 0;
    await runWithConcurrency(ids, 2, async (id) => {
      const controls = rows.get(id);
      const preview = previews.get(id);
      const sortButton = controls?.resultActions.querySelector<HTMLButtonElement>(".sort-button");
      if (controls === undefined || preview === undefined || sortButton === null || sortButton === undefined) return;
      const succeeded = await applyPlaylistSort(spotify, preview.view, controls, sortButton, false);
      if (!succeeded) failed += 1;
      else previews.delete(id);
      completed += 1;
      batchStatusElement.textContent = `Sorted ${String(completed)} of ${String(ids.length)} queued playlists.`;
    });
    batchStatusElement.textContent = failed === 0
      ? `${String(ids.length)} playlists sorted and verified.`
      : `${String(ids.length - failed)} playlists sorted; ${String(failed)} need attention below.`;
    setRoutePhase(failed === 0 ? "verified" : "confirm");
    updateBatchControls();
  }
}

function initializeMotion(): void {
  revealObserver?.disconnect();
  const elements = [...document.querySelectorAll<HTMLElement>(".reveal")];
  if (
    hasIntroducedPage ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !("IntersectionObserver" in window)
  ) {
    for (const element of elements) element.classList.add("reveal--visible");
    hasIntroducedPage = true;
    return;
  }
  document.documentElement.classList.add("motion-ready");
  revealObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).classList.add("reveal--visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8%", threshold: 0.12 },
  );
  for (const element of elements) revealObserver.observe(element);
  hasIntroducedPage = true;
}

function initializeInteractions(): void {
  initializeScrollProgress();
  initializePointerLight();
}

function initializePointerLight(): void {
  if (
    pointerLightInitialized ||
    !window.matchMedia("(any-pointer: fine)").matches ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) return;

  pointerLightInitialized = true;
  const light = document.createElement("div");
  light.className = "pointer-light";
  light.setAttribute("aria-hidden", "true");
  for (const name of ["green", "coral", "mist"]) {
    const bloom = document.createElement("span");
    bloom.className = `pointer-light__bloom pointer-light__bloom--${name}`;
    light.append(bloom);
  }
  document.body.append(light);

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    if (pointerHasPosition) {
      pointerVelocityX += event.clientX - pointerX;
      pointerVelocityY += event.clientY - pointerY;
    }
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerInside = true;
    if (!pointerHasPosition) {
      pointerRenderedX = pointerX;
      pointerRenderedY = pointerY;
      pointerHasPosition = true;
    }
    const target = event.target instanceof Element ? event.target : undefined;
    light.classList.toggle(
      "pointer-light--engaged",
      target?.closest("a, button, label, input") !== null && target !== undefined,
    );
    interactionEnergy = Math.max(
      interactionEnergy,
      Math.min(0.82, 0.18 + Math.hypot(pointerVelocityX, pointerVelocityY) / 90),
    );
    light.classList.add("pointer-light--visible");
    schedulePointerLight(light);
  }, { passive: true });

  window.addEventListener("scroll", () => {
    const delta = window.scrollY - previousScrollY;
    previousScrollY = window.scrollY;
    if (Math.abs(delta) < 0.5) return;
    ensurePointerLightPosition();
    scrollDirection = Math.sign(delta);
    scrollEnergy = Math.max(scrollEnergy, Math.min(1, Math.abs(delta) / 90));
    interactionEnergy = Math.max(interactionEnergy, 0.42 + scrollEnergy * 0.32);
    light.classList.add("pointer-light--visible");
    schedulePointerLight(light);
  }, { passive: true });

  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") return;
    interactionEnergy = 1;
    light.classList.add("pointer-light--visible", "pointer-light--pressed");
    window.setTimeout(() => light.classList.remove("pointer-light--pressed"), 420);
    schedulePointerLight(light);
  }, { passive: true });

  document.addEventListener("focusin", (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest("a, button, label, input") === null) return;
    const bounds = event.target.getBoundingClientRect();
    pointerX = bounds.left + bounds.width / 2;
    pointerY = bounds.top + bounds.height / 2;
    if (!pointerHasPosition) {
      pointerRenderedX = pointerX;
      pointerRenderedY = pointerY;
      pointerHasPosition = true;
    }
    interactionEnergy = Math.max(interactionEnergy, 0.68);
    light.classList.add("pointer-light--visible", "pointer-light--engaged");
    schedulePointerLight(light);
  });

  document.addEventListener("focusout", () => {
    light.classList.remove("pointer-light--engaged");
  });

  document.addEventListener("keydown", () => {
    ensurePointerLightPosition();
    interactionEnergy = Math.max(interactionEnergy, 0.5);
    light.classList.add("pointer-light--visible");
    schedulePointerLight(light);
  });

  document.documentElement.addEventListener("pointerleave", () => {
    pointerInside = false;
    light.classList.remove("pointer-light--engaged");
    schedulePointerLight(light);
  });
  window.addEventListener("blur", () => {
    light.classList.remove("pointer-light--visible", "pointer-light--engaged");
    pointerInside = false;
    pointerHasPosition = false;
  });
}

function ensurePointerLightPosition(): void {
  if (pointerHasPosition) return;
  pointerX = window.innerWidth * 0.62;
  pointerY = window.innerHeight * 0.42;
  pointerRenderedX = pointerX;
  pointerRenderedY = pointerY;
  pointerHasPosition = true;
}

function schedulePointerLight(light: HTMLElement): void {
  if (pointerFrame !== undefined) return;
  pointerFrame = window.requestAnimationFrame(() => renderPointerLight(light));
}

function renderPointerLight(light: HTMLElement): void {
  pointerRenderedX += (pointerX - pointerRenderedX) * 0.12;
  pointerRenderedY += (pointerY - pointerRenderedY) * 0.12;
  light.style.setProperty("--pointer-x", `${pointerRenderedX.toFixed(2)}px`);
  light.style.setProperty("--pointer-y", `${pointerRenderedY.toFixed(2)}px`);
  light.style.setProperty("--pointer-activity", interactionEnergy.toFixed(3));
  const engagement = light.classList.contains("pointer-light--engaged") ? 0.035 : 0;
  light.style.setProperty(
    "--pointer-opacity",
    Math.min(0.3, 0.1 + interactionEnergy * 0.13 + engagement).toFixed(3),
  );

  const velocity = Math.min(1, Math.hypot(pointerVelocityX, pointerVelocityY) / 42);
  const rotation = Math.max(-8, Math.min(8, pointerVelocityX * 0.08 + scrollDirection * scrollEnergy * 5));
  light.style.setProperty("--pointer-rotation", `${rotation.toFixed(2)}deg`);
  light.style.setProperty("--pointer-scale-x", (1 + velocity * 0.1 - scrollEnergy * 0.025).toFixed(3));
  light.style.setProperty("--pointer-scale-y", (1 - velocity * 0.025 + scrollEnergy * 0.18).toFixed(3));

  pointerVelocityX *= 0.82;
  pointerVelocityY *= 0.82;
  interactionEnergy *= 0.955;
  scrollEnergy *= 0.88;

  const stillMoving =
    Math.abs(pointerX - pointerRenderedX) > 0.2 ||
    Math.abs(pointerY - pointerRenderedY) > 0.2 ||
    Math.abs(pointerVelocityX) > 0.1 ||
    Math.abs(pointerVelocityY) > 0.1 ||
    interactionEnergy > 0.01 ||
    scrollEnergy > 0.01;
  if (!stillMoving && !pointerInside && !light.classList.contains("pointer-light--engaged")) {
    light.classList.remove("pointer-light--visible");
    pointerHasPosition = false;
  }
  pointerFrame = stillMoving
    ? window.requestAnimationFrame(() => renderPointerLight(light))
    : undefined;
}

function initializeScrollProgress(): void {
  const progress = document.querySelector<HTMLElement>(".reading-progress");
  progressAnimation?.cancel();
  progressAnimation = progress?.animate(
    [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
    { duration: 1_000, fill: "both" },
  );
  progressAnimation?.pause();
  if (!progressListenersInitialized) {
    window.addEventListener("scroll", updateScrollProgress, { passive: true });
    window.addEventListener("resize", updateScrollProgress, { passive: true });
    progressListenersInitialized = true;
  }
  updateScrollProgress();
}

function updateScrollProgress(): void {
  if (progressAnimation === undefined) return;
  const available = document.documentElement.scrollHeight - window.innerHeight;
  const ratio = available <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / available));
  progressAnimation.currentTime = ratio * 1_000;
}

async function previewPlaylist(
  spotify: SpotifyWebApiClient,
  playlistId: string,
  controls: PlaylistRowControls,
  onSorted?: () => void,
  runOperation?: CatalogOperationRunner,
): Promise<PlaylistSortPreview | undefined> {
  const { previewButton, result, resultMessage, resultActions } = controls;
  setRoutePhase("preview");
  previewButton.disabled = true;
  previewButton.textContent = "Checking…";
  previewButton.setAttribute("aria-label", `Checking ${controls.playlistName}`);
  result.hidden = false;
  result.className = "preview-result";
  result.setAttribute("role", "status");
  resultMessage.textContent = "Reading the complete playlist and calculating a write-free plan…";
  resultActions.replaceChildren();
  try {
    const preview = await previewPlaylistSort(spotify, playlistId);
    if (preview.moves.length === 0) {
      resultMessage.textContent = `Already newest-first. ${String(preview.occurrenceCount)} items checked; no writes needed.`;
      setRoutePhase("verified");
    } else {
      resultMessage.textContent = `${String(preview.moves.length)} range ${preview.moves.length === 1 ? "move" : "moves"} planned for ${String(preview.occurrenceCount)} items. Nothing has changed yet.`;
      const sortButton = document.createElement("button");
      sortButton.type = "button";
      sortButton.className = "sort-button";
      sortButton.textContent = "Sort now";
      sortButton.setAttribute("aria-label", `Sort now: apply ${String(preview.moves.length)} planned sorting moves`);
      sortButton.addEventListener("click", () => {
        const sort = async (): Promise<void> => {
          const succeeded = await applyPlaylistSort(spotify, preview.view, controls, sortButton);
          if (succeeded) onSorted?.();
        };
        if (runOperation === undefined) void sort();
        else void runOperation(sort, true);
      });
      resultActions.append(sortButton);
      setRoutePhase("confirm");
    }
    return preview;
  } catch (error) {
    result.className = "preview-result preview-result--error";
    result.setAttribute("role", "alert");
    resultMessage.textContent = getSafeErrorMessage(
      error,
      "An unexpected error occurred while previewing this playlist. No playlist write was attempted.",
    );
    setRoutePhase("preview");
    return undefined;
  } finally {
    previewButton.disabled = false;
    previewButton.textContent = "Preview again";
    previewButton.setAttribute("aria-label", `Preview again ${controls.playlistName}`);
  }
}

async function applyPlaylistSort(
  spotify: SpotifyWebApiClient,
  previewView: PlaylistView,
  controls: PlaylistRowControls,
  sortButton: HTMLButtonElement,
  trackRoute = true,
): Promise<boolean> {
  const { previewButton, result, resultMessage, resultActions } = controls;
  previewButton.disabled = true;
  sortButton.disabled = true;
  sortButton.textContent = "Sorting…";
  sortButton.setAttribute("aria-label", `Sorting ${controls.playlistName}`);
  if (trackRoute) setRoutePhase("sorting");
  result.className = "preview-result preview-result--working";
  result.setAttribute("role", "status");
  resultMessage.textContent = "Applying snapshot-guarded moves, then verifying the final order. Keep this page open until verification finishes.";
  try {
    const outcome = await sortPlaylist(spotify, previewView.playlistId, {
      initialView: previewView,
    });
    result.className = "preview-result preview-result--success";
    resultMessage.textContent =
      outcome.status === "already-sorted"
        ? `No changes needed. ${String(outcome.occurrenceCount)} items were already newest-first.`
        : `Sorted and verified ${String(outcome.occurrenceCount)} items with ${String(outcome.writeCalls)} ${outcome.writeCalls === 1 ? "write" : "writes"}. Membership is unchanged.`;
    resultActions.replaceChildren();
    if (trackRoute) setRoutePhase("verified");
    return true;
  } catch (error) {
    result.className = "preview-result preview-result--error";
    result.setAttribute("role", "alert");
    resultMessage.textContent = getSafeErrorMessage(
      error,
      "Playlist Tidy could not determine the sorting result. Check the playlist in Spotify before trying again.",
    );
    sortButton.disabled = false;
    sortButton.textContent = "Try sort again";
    sortButton.setAttribute("aria-label", `Try sort again for ${controls.playlistName}`);
    if (trackRoute) setRoutePhase("confirm");
    return false;
  } finally {
    previewButton.disabled = false;
  }
}

type RoutePhase = "preview" | "confirm" | "sorting" | "verified";

function setRoutePhase(phase: RoutePhase): void {
  const activeStep = phase === "preview" ? 2 : 3;
  const completed = phase === "verified";
  for (const element of document.querySelectorAll<HTMLElement>("[data-route-step]")) {
    const step = Number(element.dataset.routeStep);
    const isCurrent = step === activeStep && !completed;
    const isComplete = step < activeStep || (step === activeStep && completed);
    element.classList.toggle("route__step--current", isCurrent);
    element.classList.toggle("route__step--complete", isComplete);
    if (isCurrent) element.setAttribute("aria-current", "step");
    else element.removeAttribute("aria-current");
  }
  const stepLabel = document.querySelector<HTMLElement>(".step-label");
  if (stepLabel !== null) {
    stepLabel.textContent = phase === "preview"
      ? "Step 2 of 3 · Preview"
      : phase === "confirm"
        ? "Step 3 of 3 · Confirm the sort"
        : phase === "sorting"
          ? "Step 3 of 3 · Sorting and verification"
          : "Step 3 of 3 · Verified";
  }
}

interface PlaylistRowControls {
  readonly selection: HTMLInputElement;
  readonly previewButton: HTMLButtonElement;
  readonly result: HTMLElement;
  readonly resultMessage: HTMLElement;
  readonly resultActions: HTMLElement;
  readonly playlistName: string;
}

type CatalogOperationRunner = <T>(
  operation: () => Promise<T>,
  protectsNavigation?: boolean,
) => Promise<T | undefined>;

function formatPlaylistVisibility(isPublic: boolean | null): string {
  if (isPublic === true) return "Public";
  if (isPublic === false) return "Private";
  return "Visibility unavailable";
}

async function runWithConcurrency<T>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  const queue = [...values];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const value = queue.shift();
      if (value === undefined) return;
      await worker(value);
    }
  });
  await Promise.all(workers);
}

function getConnectionPresentation(state: ViewState): {
  readonly buttonLabel: string;
  readonly disabled: boolean;
  readonly status: string;
} {
  switch (state.kind) {
    case "config-missing":
      return {
        buttonLabel: "Connect my Spotify app",
        disabled: true,
        status: "Add your public Spotify Client ID in the advanced setup to enable login.",
      };
    case "connecting":
      return { buttonLabel: "Connecting…", disabled: true, status: "Completing Spotify login." };
    case "connected":
      return {
        buttonLabel: "Disconnect",
        disabled: false,
        status: state.libraryStatus === "loading"
          ? `Connected as ${state.userId}. Loading your playlists…`
          : `Connected as ${state.userId}. ${String(state.playlists.length)} owned ${state.playlists.length === 1 ? "playlist" : "playlists"} loaded.`,
      };
    case "error":
      return { buttonLabel: "Try again", disabled: false, status: "" };
    case "disconnected":
      return {
        buttonLabel: "Connect my Spotify app",
        disabled: false,
        status: "Using your own Spotify Client ID for this tab.",
      };
  }
}

function readCustomClientId(storage: SessionStoragePort): string | undefined {
  const stored = storage.getItem(CLIENT_ID_STORAGE_KEY)?.trim();
  if (stored === undefined || !CLIENT_ID_PATTERN.test(stored)) {
    if (stored !== undefined) storage.removeItem(CLIENT_ID_STORAGE_KEY);
    return undefined;
  }
  return stored;
}

function getSafeErrorMessage(
  error: unknown,
  fallback = "An unexpected error occurred while connecting to Spotify.",
): string {
  if (error instanceof PlaylistTidyError) return error.message;
  return fallback;
}

function getSessionStorage(): SessionStoragePort {
  try {
    return window.sessionStorage;
  } catch {
    return {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new PlaylistTidyError(
          "AUTHENTICATION_FAILED",
          "This browser is blocking the temporary session storage required for secure Spotify login.",
        );
      },
    };
  }
}

function showRuntimeFailure(): void {
  if (runtimeFailureShown) return;
  runtimeFailureShown = true;
  const existingError = document.querySelector<HTMLElement>("#connection-error");
  if (existingError !== null) {
    existingError.textContent = "Playlist Tidy stopped unexpectedly. Reload the page to start a fresh browser session.";
    existingError.focus({ preventScroll: false });
    return;
  }
  app.innerHTML = `
    <main class="fatal-error" tabindex="-1">
      <p class="eyebrow">The session stopped safely</p>
      <h1>Playlist Tidy could not continue.</h1>
      <p>No further playlist work was attempted. Reload the page to start a fresh browser session.</p>
      <button class="connect-button" type="button" data-reload>Reload Playlist Tidy</button>
    </main>
  `;
  const fatalError = document.querySelector<HTMLElement>(".fatal-error");
  fatalError?.focus();
  document.querySelector<HTMLButtonElement>("[data-reload]")?.addEventListener("click", () => {
    window.location.reload();
  });
}

window.addEventListener("error", (event) => {
  if (event instanceof ErrorEvent && event.error !== undefined) showRuntimeFailure();
});
window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  showRuntimeFailure();
});
window.addEventListener("beforeunload", (event) => {
  if (!writeOperationActive) return;
  event.preventDefault();
});

if (window.self !== window.top) renderEmbeddedRefusal();
else void initialize().catch(() => showRuntimeFailure());

