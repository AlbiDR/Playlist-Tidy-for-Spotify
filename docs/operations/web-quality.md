<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- Copyright (C) 2026 AlbiDR -->

# Web quality contract

This document records the production qualities that sit outside Playlist Tidy's sorting algorithm. These controls are release requirements, not optional polish.

## Accessibility

- The rendered document has one `main` landmark and one level-one heading.
- A keyboard-visible skip link is the first focus target and moves focus to the main landmark.
- Native controls retain visible focus treatment and accessible names.
- Touch layouts must not overflow horizontally.
- Decorative motion is removed when `prefers-reduced-motion` is active.
- Pointer-only decoration is never initialized for coarse pointers.
- Forced-colors mode removes nonessential glow effects and preserves control borders.

The Playwright browser audit enforces structural, heading, keyboard, focus, image, storage, network, no-JavaScript, reduced-motion, forced-colors, and responsive invariants across the application and privacy page. It runs Chromium, Firefox, and WebKit at narrow mobile, standard mobile, and desktop widths. Manual review remains required for copy clarity, screen-reader phrasing, zoom behavior, and color perception because automated checks cannot prove usability.

## Performance

The production build enforces compressed budgets:

- Any JavaScript asset: 30 KiB gzip maximum.
- Any CSS asset: 15 KiB gzip maximum.
- Any HTML document: 8 KiB gzip maximum.
- Combined HTML, CSS, and JavaScript: 55 KiB gzip maximum.

Assets are minified and content fingerprinted. Source maps are not published. The site uses system fonts and has no marketing analytics, advertising scripts, tag managers, or third-party interface dependencies.

## Security and privacy

The document applies a restrictive Content Security Policy, a no-referrer policy, and a minimal connection allowlist for Spotify. Production is served over HTTPS by GitHub Pages. OAuth uses Authorization Code with PKCE and a verified state value. Access tokens stay in memory; transient verifier state uses session storage and is cleared after the callback.

GitHub Pages does not provide repository-controlled response headers. Consequently, protections that require HTTP headers, including `frame-ancestors`, HSTS, cross-origin isolation, and a server-level Permissions Policy, cannot be represented honestly by this deployment. Local Vite serving applies the headers it can. Moving to a configurable host is required before claiming those response-header protections in production.

No service worker is registered. Playlist sorting cannot work offline, and caching an OAuth application shell would add stale-release and callback complexity without an offline user benefit.

The public privacy page is intentionally static and script-free. It documents the exact Spotify data path, ephemeral browser storage, GitHub Pages infrastructure boundary, lack of first-party tracking, and the separate ownership model for self-hosted automation.

## Discoverability

Production includes canonical, description, author, robot, Open Graph, and large-image social-card metadata together with a sitemap, robots policy, and scoped web manifest. Deterministically generated PNG icons cover Apple touch, 192-pixel, 512-pixel, and maskable install surfaces. A dedicated 1200 by 630 image covers link previews. Dimensions, public files, and both indexable documents are checked in the build artifact and again against the live deployment.

## Release gates

`npm run verify` covers repository policy, strict TypeScript, linting, unit tests, deterministic image generation, production builds, asset sanitization, metadata, image dimensions, and performance budgets. `npm run audit:web` starts the built site in three browser engines and enforces the browser invariants above.

Pull requests run both gates plus a high-severity dependency audit. GitHub Pages repeats the product and browser gates before uploading an artifact. The deployment-health workflow then checks the public document, fingerprinted assets, metadata, manifest, robots policy, sitemap, and application icon from the live origin.
