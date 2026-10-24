// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");

if (app === null) {
  throw new Error("The application root is missing.");
}

app.innerHTML = `
  <section class="hero" aria-labelledby="page-title">
    <p class="eyebrow">A precise playlist utility</p>
    <h1 id="page-title">Playlist Tidy <span>for Spotify</span></h1>
    <p class="summary">
      Put every occurrence in newest-added-first order without replacing,
      removing, or duplicating your tracks.
    </p>
    <div class="status" role="status" aria-live="polite">
      <span class="status__mark" aria-hidden="true"></span>
      The sorting kernel is ready. Spotify connection comes next.
    </div>
  </section>
  <section class="principles" aria-label="Product guarantees">
    <article>
      <p class="number">01</p>
      <h2>Preview first</h2>
      <p>See the exact range moves before the playlist changes.</p>
    </article>
    <article>
      <p class="number">02</p>
      <h2>Membership intact</h2>
      <p>Reordering is the only Spotify write capability in the application.</p>
    </article>
    <article>
      <p class="number">03</p>
      <h2>Verified result</h2>
      <p>Every real run refetches and validates the final playlist state.</p>
    </article>
  </section>
  <footer>
    Independently developed. Not affiliated with or endorsed by Spotify.
  </footer>
`;

