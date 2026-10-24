// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");

if (app === null) {
  throw new Error("The application root is missing.");
}

app.innerHTML = `
  <section class="hero" aria-labelledby="page-title">
    <p class="eyebrow">Development preview</p>
    <h1 id="page-title">Playlist Tidy <span>for Spotify</span></h1>
    <p class="summary">
      This interface is under construction. Spotify connection and playlist
      sorting are not available on the website yet.
    </p>
    <button class="connect-button" type="button" disabled aria-describedby="connection-note">
      Connect Spotify
    </button>
    <p id="connection-note" class="connection-note">
      Disabled until OAuth integration is complete.
    </p>
  </section>
  <section class="principles" aria-label="Planned workflow">
    <article>
      <p class="number">01</p>
      <h2>Connect</h2>
      <p>Authorize access to playlists you own.</p>
    </article>
    <article>
      <p class="number">02</p>
      <h2>Preview</h2>
      <p>Review the required range moves with zero writes.</p>
    </article>
    <article>
      <p class="number">03</p>
      <h2>Sort and verify</h2>
      <p>Reorder newest-first, then verify membership and final order.</p>
    </article>
  </section>
  <footer>
    Independently developed. Not affiliated with or endorsed by Spotify.
  </footer>
`;

