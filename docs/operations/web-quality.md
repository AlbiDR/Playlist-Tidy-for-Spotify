<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- Copyright (C) 2026 AlbiDR -->

# Web quality contract

This document records the production qualities that sit outside Playlist Tidy's sorting algorithm. These controls are release requirements, not optional polish.

## Accessibility

- The rendered document has one `main` landmark and one level-one heading.
- A keyboard-visible skip link is the first focus target and moves focus to the main landmark.
- Every native control is reachable in keyboard order and retains visible focus treatment and an accessible name.
- Narrow layouts and 200% text resizing must not overflow horizontally or clip interactive text.
- Decorative motion is removed when `prefers-reduced-motion` is active.
- Pointer-only decoration is never initialized for coarse pointers.
- Forced-colors mode removes nonessential glow effects and preserves control borders.

The Playwright browser audit enforces structural, heading, complete keyboard traversal, visible focus, 200% text resizing, image, storage, network, no-JavaScript, reduced-motion, forced-colors, and responsive invariants across the application and privacy page. It runs Chromium, Firefox, and WebKit at narrow mobile, standard mobile, and desktop widths. Axe scans enforce automatically detectable WCAG A and AA rules on both public documents and on connected, confirmation, and verified application states. A credential-free Spotify simulation drives the production interface through PKCE authorization, owned-playlist filtering, preview, explicit confirmation, reorder, verification, denial, cleanup, and disconnect in all three engines. Manual review remains required for copy clarity, screen-reader phrasing, higher zoom combinations, and color perception because automated checks cannot prove usability.

## Performance

The production build enforces compressed budgets:

- Any JavaScript asset: 30 KiB gzip maximum.
- Any CSS asset: 15 KiB gzip maximum.
- Any HTML document: 8 KiB gzip maximum.
- Combined HTML, CSS, and JavaScript: 55 KiB gzip maximum.

Assets are minified and content fingerprinted. Source maps are not published. The site uses system fonts and has no marketing analytics, advertising scripts, tag managers, or third-party interface dependencies.

## Security and privacy

The document applies a restrictive Content Security Policy, a no-referrer policy, and a minimal connection allowlist for Spotify. Production is served over HTTPS by GitHub Pages. OAuth uses Authorization Code with PKCE and a verified state value. Access tokens stay in memory; transient verifier state uses session storage and is cleared after the callback.

The hosted Development Mode Client ID is optional. A visitor can supply the public Client ID from a Spotify app they control, which moves API usage to that developer account's quota without exposing or requiring a Client Secret. The identifier is retained only in tab-scoped session storage across the OAuth redirect and can be explicitly forgotten. Browser journey tests prove that the chosen Client ID is used for both authorization and token exchange, survives only as documented, and is removed on request.

GitHub Pages does not provide repository-controlled response headers. Consequently, protections that require HTTP headers, including `frame-ancestors`, HSTS, cross-origin isolation, and a server-level Permissions Policy, cannot be represented honestly by this deployment. Local Vite serving applies the headers it can. Moving to a configurable host is required before claiming those response-header protections in production.

As defense in depth for the sensitive browser interface, the application also refuses to initialize whenever it detects that it is running inside a frame. The framed view performs no Spotify authorization or playlist operation and offers only a protected link that opens the application directly. The three-engine browser audit embeds the production application in an untrusted parent and verifies that this fail-closed behavior occurs without network or browser-storage side effects. This runtime control reduces the practical clickjacking surface but is not described as equivalent to an HTTP `frame-ancestors` policy.

No service worker is registered. Playlist sorting cannot work offline, and caching an OAuth application shell would add stale-release and callback complexity without an offline user benefit.

The public privacy page is intentionally static and script-free. It documents the exact Spotify data path, ephemeral browser storage, GitHub Pages infrastructure boundary, lack of first-party tracking, and the separate ownership model for self-hosted automation.

## Discoverability

Production includes canonical, description, author, robot, Open Graph, and large-image social-card metadata together with a sitemap, robots policy, and scoped web manifest. Deterministically generated PNG icons cover Apple touch, 192-pixel, 512-pixel, and maskable install surfaces. A dedicated 1200 by 630 image covers link previews. Dimensions, public files, and both indexable documents are checked in the build artifact and again against the live deployment.

Unknown routes return a branded, keyboard-accessible custom 404 document with recovery links, an explicit `noindex` directive, no JavaScript, and a restrictive Content Security Policy. Deployment health verifies both the HTTP 404 status and the recovery document served by GitHub Pages.

## Release gates

`npm run verify` covers repository policy, strict TypeScript, linting, unit tests, deterministic image generation, production builds, asset sanitization, metadata, image dimensions, and performance budgets. `npm run audit:web` starts the built site in three browser engines and enforces the browser invariants above.

Pull requests run both gates plus a high-severity dependency audit. GitHub CodeQL default setup independently scans TypeScript, JavaScript, and Actions workflows with the extended security query suite. Repository secret scanning, push protection, vulnerability alerts, private vulnerability reporting, read-only default workflow permissions, and immutable action pin enforcement are enabled. Browser runtimes use a lockfile-keyed cache and bounded installation retries so one stalled download cannot consume an entire release job. After a successful Verify run on `main`, GitHub Pages checks out that exact verified SHA, rebuilds it in a separately privileged workflow, installs only the Chromium runtime needed for current screenshots, and uploads the artifact. This preserves the trust boundary without downloading all three browser engines twice. The deployment-health workflow then checks both public documents, fingerprinted assets, metadata, manifest, robots policy, sitemap, icons, and social artwork from the live origin.
