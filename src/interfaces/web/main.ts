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
import type { PlaylistView } from "../../core/playlist/types.js";
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

const appRoot = document.querySelector<HTMLElement>("#app");
if (appRoot === null) throw new Error("The application root is missing.");
const app: HTMLElement = appRoot;

const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim() ?? "";
const redirectUri = `${window.location.origin}${window.location.pathname}`;
const auth = new SpotifyPkceAuth(getSessionStorage());
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

function render(state: ViewState): void {
  const connection = getConnectionPresentation(state);
  app.innerHTML = `
    <div class="reading-progress" aria-hidden="true"></div>
    <header class="app-header">
      <a class="wordmark" href="./" aria-label="Playlist Tidy home">
        <img class="wordmark__symbol" src="${markUrl}" alt="" width="32" height="32" />
        <span>Playlist Tidy <small>for Spotify</small></span>
      </a>
      <a class="repository-link" href="https://github.com/AlbiDR/PlaylistTidy" target="_blank" rel="noreferrer">Source &amp; automation ↗</a>
    </header>
    <main>
      <section class="hero" aria-labelledby="connection-title">
        <div class="hero__copy reveal">
          <p class="eyebrow">Order for your listening life</p>
          <h1 id="connection-title">Newest tracks.<br><em>Right where they belong.</em></h1>
          <p class="summary">
            Playlist Tidy sorts the tracks inside playlists you own by the date each track
            was added, with the newest at the top. It does not delete tracks, edit music,
            or rearrange the playlists in your library.
          </p>
          <div class="connection-row">
            <button id="connection-action" class="connect-button" type="button"></button>
            <p id="connection-status" class="connection-status" role="status" aria-live="polite"></p>
          </div>
          <p id="connection-error" class="error-message" role="alert"></p>
          <p class="session-note"><strong>Manual by design.</strong> Reloading or closing this page ends the session.</p>
          <p class="trust-note">PKCE login / memory-only token / reorder-only writes</p>
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
          <p class="eyebrow">Two ways to use it</p>
          <h2 id="journeys-heading">Sort once here.<br>Keep sorting from your own copy.</h2>
        </header>
        <div class="journey reveal">
          <p class="journey__index" aria-hidden="true">01</p>
          <div>
            <h3>Visiting the public website</h3>
            <p>Anyone can connect Spotify, choose owned playlists, preview the work, and approve a sort. Each visit is manual. Your access token disappears when the page reloads.</p>
          </div>
          <p class="journey__outcome">Manual · works immediately</p>
        </div>
        <div class="journey reveal reveal--delay-1">
          <p class="journey__index" aria-hidden="true">02</p>
          <div>
            <h3>Running scheduled maintenance</h3>
            <p>The public website cannot keep sorting after you leave. For recurring sorting, clone the repository and complete one local enrollment. GitHub Actions can then maintain your chosen playlists every six hours.</p>
            <a href="https://github.com/AlbiDR/PlaylistTidy#scheduled-sorting">Read the self-hosting setup →</a>
          </div>
          <p class="journey__outcome">Automatic · self-hosted</p>
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
        <p>Built by <a href="https://github.com/AlbiDR" target="_blank" rel="noreferrer">AlbiDR</a>. Read, audit, or fork the <a href="https://github.com/AlbiDR/PlaylistTidy" target="_blank" rel="noreferrer">Playlist Tidy repository</a>.</p>
      </div>
      <div class="footer-credit">
        <strong>Where automatic sorting lives</strong>
        <p>Recurring sorting is powered by this repository’s <a href="https://github.com/AlbiDR/PlaylistTidy/actions/workflows/scheduled-sort.yml" target="_blank" rel="noreferrer">Scheduled Playlist Sort workflow</a>, running inside each self-hosted copy, not this browser tab.</p>
      </div>
      <p class="footer-legal">Independent project · Not affiliated with or endorsed by Spotify.</p>
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
  let batchBusy = false;

  const updateBatchControls = (): void => {
    const selectedIds = [...selected];
    const previewed = selectedIds.filter((id) => previews.has(id));
    const sortable = previewed.filter((id) => (previews.get(id)?.moves.length ?? 0) > 0);
    batchCount.textContent = `${String(selectedIds.length)} selected`;
    batchPreview.disabled = batchBusy || selectedIds.length === 0;
    batchSort.disabled =
      batchBusy || selectedIds.length === 0 || previewed.length !== selectedIds.length || sortable.length === 0;
    for (const controls of rows.values()) controls.selection.disabled = batchBusy;
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
    const controls = { selection, previewButton, result, resultMessage, resultActions };
    rows.set(playlist.id, controls);
    selection.addEventListener("change", () => {
      if (selection.checked) selected.add(playlist.id);
      else selected.delete(playlist.id);
      row.classList.toggle("playlist-row--selected", selection.checked);
      batchStatus.textContent = "";
      updateBatchControls();
    });
    previewButton.addEventListener("click", () => {
      void previewPlaylist(spotify, playlist.id, controls, () => {
        previews.delete(playlist.id);
        updateBatchControls();
      }).then((preview) => {
        if (preview !== undefined) previews.set(playlist.id, preview);
        updateBatchControls();
      });
    });
    row.append(selector, details, previewButton, result);
    list.append(row);
  }

  batchPreview.addEventListener("click", () => {
    void runBatchPreview();
  });
  batchSort.addEventListener("click", () => {
    void runBatchSort();
  });
  updateBatchControls();

  async function runBatchPreview(): Promise<void> {
    setRoutePhase("preview");
    const ids = [...selected];
    batchBusy = true;
    updateBatchControls();
    let completed = 0;
    let failed = 0;
    await runWithConcurrency(ids, 2, async (id) => {
      const controls = rows.get(id);
      if (controls === undefined) return;
      const preview = await previewPlaylist(spotify, id, controls, () => {
        previews.delete(id);
        updateBatchControls();
      });
      if (preview === undefined) failed += 1;
      else previews.set(id, preview);
      completed += 1;
      batchStatusElement.textContent = `Previewed ${String(completed)} of ${String(ids.length)} selected playlists.`;
    });
    batchBusy = false;
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
    batchBusy = true;
    setRoutePhase("sorting");
    updateBatchControls();
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
    batchBusy = false;
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
  document.body.append(light);

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    pointerX = event.clientX;
    pointerY = event.clientY;
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
    light.classList.add("pointer-light--visible");
    if (pointerFrame !== undefined) return;
    pointerFrame = window.requestAnimationFrame(() => renderPointerLight(light));
  }, { passive: true });

  document.documentElement.addEventListener("pointerleave", () => {
    light.classList.remove("pointer-light--visible", "pointer-light--engaged");
    pointerHasPosition = false;
  });
  window.addEventListener("blur", () => {
    light.classList.remove("pointer-light--visible", "pointer-light--engaged");
    pointerHasPosition = false;
  });
}

function renderPointerLight(light: HTMLElement): void {
  pointerRenderedX += (pointerX - pointerRenderedX) * 0.16;
  pointerRenderedY += (pointerY - pointerRenderedY) * 0.16;
  light.style.setProperty("--pointer-x", `${pointerRenderedX.toFixed(2)}px`);
  light.style.setProperty("--pointer-y", `${pointerRenderedY.toFixed(2)}px`);

  const stillMoving =
    Math.abs(pointerX - pointerRenderedX) > 0.2 || Math.abs(pointerY - pointerRenderedY) > 0.2;
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
): Promise<PlaylistSortPreview | undefined> {
  const { previewButton, result, resultMessage, resultActions } = controls;
  setRoutePhase("preview");
  previewButton.disabled = true;
  previewButton.textContent = "Checking…";
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
      sortButton.setAttribute("aria-label", `Apply ${String(preview.moves.length)} planned sorting moves`);
      sortButton.addEventListener("click", () => {
        void applyPlaylistSort(spotify, preview.view, controls, sortButton).then((succeeded) => {
          if (succeeded) onSorted?.();
        });
      });
      resultActions.append(sortButton);
      setRoutePhase("confirm");
    }
    return preview;
  } catch (error) {
    result.className = "preview-result preview-result--error";
    result.setAttribute("role", "alert");
    resultMessage.textContent = getSafeErrorMessage(error);
    setRoutePhase("preview");
    return undefined;
  } finally {
    previewButton.disabled = false;
    previewButton.textContent = "Preview again";
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
    resultMessage.textContent = getSafeErrorMessage(error);
    sortButton.disabled = false;
    sortButton.textContent = "Try sort again";
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
        status: state.libraryStatus === "loading"
          ? `Connected as ${state.userId}. Loading your playlists…`
          : `Connected as ${state.userId}. ${String(state.playlists.length)} owned ${state.playlists.length === 1 ? "playlist" : "playlists"} loaded.`,
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

void initialize();

