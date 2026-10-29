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
import afterimageArtworkUrl from "./sample-artwork/afterimage.svg";
import nightBusArtworkUrl from "./sample-artwork/night-bus.svg";
import northboundArtworkUrl from "./sample-artwork/northbound.svg";
import openWaterArtworkUrl from "./sample-artwork/open-water.svg";
import softSignalArtworkUrl from "./sample-artwork/soft-signal.svg";
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
  { title: "Northbound", artist: "Paper Satellites", addedAt: "2026-09-29T18:10:00.000Z", artworkUrl: northboundArtworkUrl },
  { title: "Afterimage", artist: "Glass Hours", addedAt: "2026-10-24T21:45:00.000Z", artworkUrl: afterimageArtworkUrl },
  { title: "Open Water", artist: "Mira Vale", addedAt: "2026-10-02T07:30:00.000Z", artworkUrl: openWaterArtworkUrl },
  { title: "Soft Signal", artist: "Low Season", addedAt: "2026-10-21T16:05:00.000Z", artworkUrl: softSignalArtworkUrl },
  { title: "Night Bus", artist: "Neon Static", addedAt: "2026-10-18T23:20:00.000Z", artworkUrl: nightBusArtworkUrl },
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
      <div class="header-actions">
        <nav class="site-nav" aria-label="Primary navigation">
          <a href="#interactive-demo">Demo</a>
          <a href="#how-it-works">How it works</a>
          <a href="#personal-spotify">Use it</a>
        </nav>
        <a class="repository-link" href="https://github.com/AlbiDR/PlaylistTidy" target="_blank" rel="noopener noreferrer"><span>View source</span><span aria-hidden="true">↗</span></a>
      </div>
    </header>
    <main id="main-content" tabindex="-1">
      <section class="hero" aria-labelledby="connection-title">
        <div class="hero__copy reveal">
          <div class="hero__kicker">
            <p class="eyebrow">A focused Spotify playlist tool</p>
            <span class="hero__availability">Open source</span>
          </div>
          <h1 id="connection-title">Sort a Spotify playlist you own <em>by date added.</em></h1>
          <p class="summary">
            Playlist Tidy puts the newest-added tracks first. It previews the move, changes
            only the order, and checks that every song is still there when it is done.
          </p>
          <div class="hero-actions">
            <button id="demo-action" class="connect-button" type="button">Try the interactive demo</button>
            <button id="spotify-setup-action" class="secondary-button" type="button">Set up personal Spotify</button>
          </div>
          <p class="demo-intro"><strong>Not ready to connect Spotify?</strong> The demo uses the real sorting engine with fictional tracks. No login and no network request.</p>
          <ul class="hero-proof" aria-label="Playlist Tidy guarantees">
            <li><strong>One playlist</strong><span>you choose</span></li>
            <li><strong>Preview first</strong><span>before anything moves</span></li>
            <li><strong>Same tracks</strong><span>only the order changes</span></li>
          </ul>
        </div>
        <div class="playlist-example reveal reveal--delay-1" aria-label="Example playlist sorted with newest additions first">
          <div class="playlist-example__header">
            <span class="playlist-example__cover" aria-hidden="true"><i></i></span>
            <div>
              <span>Example playlist</span>
              <strong>Late-night discoveries</strong>
              <small>Sorted by Playlist Tidy</small>
            </div>
          </div>
          <ol class="playlist-example__tracks">
            <li><img class="track-art" src="${afterimageArtworkUrl}" alt="" width="38" height="38" /><span><strong>Afterimage</strong><small>Glass Hours</small></span><time datetime="2026-10-24">24 Oct</time></li>
            <li><img class="track-art" src="${softSignalArtworkUrl}" alt="" width="38" height="38" /><span><strong>Soft Signal</strong><small>Low Season</small></span><time datetime="2026-10-21">21 Oct</time></li>
            <li><img class="track-art" src="${nightBusArtworkUrl}" alt="" width="38" height="38" /><span><strong>Night Bus</strong><small>Neon Static</small></span><time datetime="2026-10-18">18 Oct</time></li>
            <li><img class="track-art" src="${openWaterArtworkUrl}" alt="" width="38" height="38" /><span><strong>Open Water</strong><small>Mira Vale</small></span><time datetime="2026-10-02">02 Oct</time></li>
          </ol>
          <p class="playlist-example__note"><span aria-hidden="true">✓</span> Same tracks, newest additions first</p>
        </div>
      </section>
      <section class="proof-rail reveal" aria-label="Product safeguards">
        <article><span>01</span><div><strong>It sorts tracks, not playlists</strong><small>Your library layout stays exactly as it is.</small></div></article>
        <article><span>02</span><div><strong>It works on playlists you own</strong><small>You choose one and approve the change.</small></div></article>
        <article><span>03</span><div><strong>It never adds or removes songs</strong><small>After sorting, it reads the playlist back and checks.</small></div></article>
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
          <div class="demo-telemetry" aria-hidden="true">
            <span><i></i> engine.ready</span>
            <span>network <strong>off</strong></span>
            <span>storage <strong>off</strong></span>
          </div>
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
      <section class="scope reveal" aria-labelledby="scope-heading">
        <header class="scope__intro">
          <p class="eyebrow">The scope is deliberately small</p>
          <h2 id="scope-heading">It changes one thing:<br><em>track order.</em></h2>
          <p>Playlist Tidy is not a recommendation engine, a library manager, or a playlist generator. It takes an existing playlist and puts its newest additions at the top.</p>
        </header>
        <div class="scope__facts">
          <article>
            <span class="scope__mark scope__mark--yes" aria-hidden="true">✓</span>
            <div><h3>What changes</h3><p>The position of tracks inside the playlist you selected.</p></div>
          </article>
          <article>
            <span class="scope__mark" aria-hidden="true">·</span>
            <div><h3>What stays put</h3><p>The songs, their metadata, playlist membership, and every other playlist in your library.</p></div>
          </article>
        </div>
      </section>
      <section id="how-it-works" class="purpose" aria-labelledby="purpose-heading">
        <header class="purpose__heading reveal">
          <p class="eyebrow">How it works</p>
          <h2 id="purpose-heading">Read, preview,<br>then reorder.</h2>
          <p>Spotify stores the date each track was added to a playlist. Playlist Tidy uses that existing date, with nothing invented, to work out the newest-first order.</p>
        </header>
        <ol class="purpose__steps">
          <li class="purpose__step reveal" data-step="01">
            <span>01</span>
            <div><h3>Reads the full playlist</h3><p>It loads every track and its Spotify <code>added_at</code> value. Nothing changes during this step.</p></div>
          </li>
          <li class="purpose__step reveal reveal--delay-1" data-step="02">
            <span>02</span>
            <div><h3>Shows the required moves</h3><p>You see how many reorder operations are needed before deciding whether to continue.</p></div>
          </li>
          <li class="purpose__step reveal reveal--delay-2" data-step="03">
            <span>03</span>
            <div><h3>Reorders and verifies</h3><p>After approval, it moves tracks into newest-first order and confirms that every original track remains.</p></div>
          </li>
        </ol>
        <p class="purpose__boundary reveal"><strong>The boundary:</strong> track order changes; playlist membership and track metadata do not.</p>
      </section>
      <section id="engineering" class="engineering reveal" aria-labelledby="engineering-heading">
        <div class="engineering__intro">
          <p class="eyebrow">Careful by design</p>
          <h2 id="engineering-heading">You see the plan before it touches your playlist.</h2>
          <p>The job is simple. The write still deserves care. Playlist Tidy calculates the required moves without changing anything, waits for approval, and then checks the result against the original tracks.</p>
          <div class="engineering__links">
            <a href="https://github.com/AlbiDR/PlaylistTidy/blob/main/docs/architecture/cleanstack.md" target="_blank" rel="noopener noreferrer">How it is built ↗</a>
            <a href="https://github.com/AlbiDR/PlaylistTidy/tree/main/src" target="_blank" rel="noopener noreferrer">Read the source ↗</a>
          </div>
        </div>
        <div class="engineering__principles">
          <article>
            <span>Before</span>
            <h3>Preview without writing.</h3>
            <p>See how many moves are needed before you approve anything.</p>
          </article>
          <article>
            <span>During</span>
            <h3>Stop if the playlist changed.</h3>
            <p>Stale or uncertain state ends the operation instead of guessing.</p>
          </article>
          <article>
            <span>After</span>
            <h3>Read it back and check.</h3>
            <p>Every original track must still be present and in the expected order.</p>
          </article>
        </div>
      </section>
      <section id="personal-spotify" class="route reveal" aria-labelledby="route-heading">
        <div class="route__intro">
          <p class="eyebrow">Use it with your Spotify account</p>
          <h2 id="route-heading">To sort a real playlist, connect your own Spotify app.</h2>
          <p class="route__summary">This public website does not ship with a shared Spotify login. Spotify limits Development Mode apps to their owners and allowlisted users, so you need the public Client ID from an app you control. Never enter a Client Secret.</p>
          <details id="custom-app-setup" class="custom-app-setup"${showCustomApp ? " open" : ""}>
            <summary>${customClientId === undefined ? "Set up my Spotify app" : "My Spotify connection"}</summary>
            <div class="custom-app-setup__body">
              <p>Create an app in the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">Spotify Developer Dashboard ↗</a>, then register this exact redirect URI. Spotify requires the app owner to have Premium.</p>
              <p class="custom-app-setup__redirect"><strong>Redirect URI</strong><code id="custom-redirect-uri"></code></p>
              ${customClientId === undefined ? `
                <form id="custom-client-form" novalidate>
                  <label for="custom-client-id">Public Spotify Client ID</label>
                  <div class="custom-app-setup__controls">
                    <input id="custom-client-id" name="spotify-client-id" type="text" inputmode="text" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="custom-client-help custom-client-status" />
                    <button class="custom-client-submit" type="submit">Connect</button>
                  </div>
                  <p id="custom-client-help" class="custom-app-setup__help">Kept only in this tab’s session storage so it survives Spotify’s redirect. A Client ID is public configuration, not a password.</p>
                  <p id="custom-client-status" class="custom-app-setup__status" role="alert"></p>
                </form>
              ` : `
                <p class="custom-app-setup__active"><strong>Ready for this tab:</strong> Your public Client ID is configured.</p>
                <div class="connection-row"${showConnection ? "" : " hidden"}>
                  <button id="connection-action" class="connect-button connect-button--compact" type="button" aria-describedby="connection-status connection-error personal-access-note"></button>
                  <p id="connection-status" class="connection-status" role="status" aria-live="polite"></p>
                </div>
                <p id="connection-error" class="error-message" role="alert" tabindex="-1"></p>
                <p id="personal-access-note" class="session-note"><strong>Temporary session.</strong> Reloading or closing this page ends Spotify access.</p>
                <button id="forget-custom-client" class="custom-client-forget" type="button">Forget my Client ID</button>
              `}
            </div>
          </details>
          <a class="route__self-host" href="https://github.com/AlbiDR/PlaylistTidy#scheduled-sorting">Need automatic sorting? Read the self-hosting setup →</a>
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
      <section class="closing-note reveal" aria-labelledby="closing-heading">
        <div>
          <p class="eyebrow">Built in public</p>
          <h2 id="closing-heading">Small, open,<br><em>and useful.</em></h2>
        </div>
        <div class="closing-note__copy">
          <p>Try the sort with sample data, inspect the source, or self-host the scheduled automation. Playlist Tidy does one modest job and makes the safety checks visible.</p>
          <a href="https://github.com/AlbiDR/PlaylistTidy" target="_blank" rel="noopener noreferrer">View Playlist Tidy on GitHub <span aria-hidden="true">↗</span></a>
        </div>
      </section>
    </main>
    <footer class="reveal">
      <div class="footer-credit">
        <div class="footer-mark"><img src="${markUrl}" alt="" width="30" height="30" /><strong>Playlist Tidy</strong></div>
        <p>Built by <a href="https://github.com/AlbiDR" target="_blank" rel="noopener noreferrer">AlbiDR</a>. Read, audit, or fork the <a href="https://github.com/AlbiDR/PlaylistTidy" target="_blank" rel="noopener noreferrer">Playlist Tidy repository</a>.</p>
      </div>
      <p class="footer-legal"><a href="./privacy.html">Privacy &amp; safe use</a> · Independent project · Not affiliated with or endorsed by Spotify.</p>
    </footer>
  `;

  const button = document.querySelector<HTMLButtonElement>("#connection-action");
  const status = document.querySelector<HTMLElement>("#connection-status");
  const error = document.querySelector<HTMLElement>("#connection-error");
  if (customClientId !== undefined && (button === null || status === null || error === null)) {
    throw new Error("Connection controls are missing.");
  }
  if (button !== null && status !== null && error !== null) {
    button.textContent = connection.buttonLabel;
    button.disabled = connection.disabled;
    status.textContent = connection.status;
    error.textContent = state.kind === "error" ? state.message : "";
  }
  app.setAttribute("aria-busy", state.kind === "connecting" ? "true" : "false");
  initializeCustomClientControls();
  initializeDemo();

  document.querySelector<HTMLButtonElement>("#demo-action")?.addEventListener("click", () => {
    const demo = document.querySelector<HTMLElement>("#interactive-demo");
    demo?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    document.querySelector<HTMLButtonElement>("#demo-primary-action")?.focus({ preventScroll: true });
  });
  document.querySelector<HTMLButtonElement>("#spotify-setup-action")?.addEventListener("click", () => {
    const section = document.querySelector<HTMLElement>("#personal-spotify");
    const setup = document.querySelector<HTMLDetailsElement>("#custom-app-setup");
    setup?.setAttribute("open", "");
    section?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    (document.querySelector<HTMLInputElement>("#custom-client-id") ?? setup)?.focus({ preventScroll: true });
  });

  if (state.kind === "connected") {
    button?.addEventListener("click", () => {
      connectionEpoch += 1;
      auth.disconnect();
      render({ kind: "disconnected" });
    });
    renderPlaylistCatalog(state);
  } else if (state.kind === "disconnected" || state.kind === "error") {
    button?.addEventListener("click", () => void beginLogin());
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
  const targetOrder = getTargetOrder(DEMO_OCCURRENCES);
  let order: readonly PlaylistOccurrence[] = DEMO_OCCURRENCES;
  let step: "initial" | "previewed" | "verified" = "initial";

  const renderTracks = (): void => {
    list.replaceChildren(...order.map((occurrence, index) => {
      const track = DEMO_TRACKS[occurrence.originalPosition];
      if (track === undefined) throw new Error("Interactive demo track identity is invalid.");
      const item = document.createElement("li");
      item.className = "demo-track";
      const targetPosition = targetOrder.findIndex(
        (candidate) => candidate.originalPosition === occurrence.originalPosition,
      );
      if (step === "previewed" && targetPosition !== index) item.classList.add("demo-track--moving");
      if (step === "verified") item.classList.add("demo-track--verified");
      const position = document.createElement("span");
      position.className = "demo-track__position";
      position.textContent = String(index + 1).padStart(2, "0");
      const artwork = document.createElement("img");
      artwork.className = "demo-track__art";
      artwork.src = track.artworkUrl;
      artwork.alt = "";
      artwork.width = 38;
      artwork.height = 38;
      const identity = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = track.title;
      const artist = document.createElement("span");
      artist.textContent = track.artist;
      identity.append(title, artist);
      const trackMeta = document.createElement("div");
      trackMeta.className = "demo-track__meta";
      const date = document.createElement("time");
      date.dateTime = track.addedAt;
      date.textContent = new Intl.DateTimeFormat("en", { day: "2-digit", month: "short" }).format(new Date(track.addedAt));
      trackMeta.append(date);
      if (step === "previewed" && targetPosition !== index) {
        const move = document.createElement("span");
        move.className = "demo-track__move";
        move.textContent = `→ ${String(targetPosition + 1).padStart(2, "0")}`;
        move.setAttribute("aria-label", `planned position ${String(targetPosition + 1)}`);
        trackMeta.append(move);
      }
      item.append(position, artwork, identity, trackMeta);
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
      renderTracks();
      return;
    }
    if (step !== "previewed") return;
    const sorted = applyMovePlan(order, plan);
    if (!haveEqualMembership(order, sorted) || !isNewestFirst(sorted)) {
      throw new Error("Interactive demo verification failed.");
    }
    if (!targetOrder.every((occurrence, index) => occurrence.originalPosition === sorted[index]?.originalPosition)) {
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
  if (redirect === null || (customClientId === undefined && (form === null || input === null || status === null))) {
    throw new Error("Custom Spotify application controls are missing.");
  }
  redirect.textContent = redirectUri;
  document.querySelector<HTMLButtonElement>("#forget-custom-client")?.addEventListener("click", () => {
    connectionEpoch += 1;
    auth.disconnect();
    sessionStorage.removeItem(CLIENT_ID_STORAGE_KEY);
    customClientId = undefined;
    clientId = "";
    render({ kind: "config-missing" });
  });
  if (form === null || input === null || status === null) return;
  input.value = "";
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

