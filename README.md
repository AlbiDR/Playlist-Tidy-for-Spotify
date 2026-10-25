<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- Copyright (C) 2026 AlbiDR -->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/mark-dark.svg">
    <img src="docs/assets/readme/mark.svg" width="128" alt="Playlist Tidy mark">
  </picture>
</p>

<h1 align="center">Playlist Tidy for Spotify</h1>

<p align="center">
  <strong>Put every playlist back in order.</strong><br>
  Sort on demand in the browser, or automate your own installation.
</p>

<p align="center">
  <a href="https://albidr.github.io/PlaylistTidy/">Open app</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#safety-by-design">Safety</a> ·
  <a href="https://albidr.github.io/PlaylistTidy/privacy.html">Privacy</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#development">Develop</a>
</p>

<p align="center">
  <a href="https://github.com/AlbiDR/PlaylistTidy/actions/workflows/ci.yml"><img src="https://github.com/AlbiDR/PlaylistTidy/actions/workflows/ci.yml/badge.svg?branch=main&amp;event=push" alt="Verify workflow status"></a>
  <a href="https://github.com/AlbiDR/PlaylistTidy/actions/workflows/repository-policy.yml"><img src="https://github.com/AlbiDR/PlaylistTidy/actions/workflows/repository-policy.yml/badge.svg?branch=main&amp;event=push" alt="Repository Policy workflow status"></a>
  <a href="https://github.com/AlbiDR/PlaylistTidy/actions/workflows/pages.yml"><img src="https://github.com/AlbiDR/PlaylistTidy/actions/workflows/pages.yml/badge.svg?branch=main&amp;event=push" alt="Pages deployment status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--only-386b49" alt="GPL-3.0-only license"></a>
</p>

<p align="center">
  <img src="https://albidr.github.io/PlaylistTidy/readme/desktop.png" width="960" alt="Playlist Tidy showing the connect action, newest-first promise, and three-step sorting route">
</p>

Playlist Tidy is a focused Spotify utility for playlists owned by the authenticated user. It restores a stable, newest-added-first order without replacing, removing, or duplicating playlist contents.

> Playlist Tidy is an independent project and is not affiliated with or endorsed by Spotify. It is currently an early build: preview first and begin with a playlist you can restore.

## Choose your path

| | Public website | Self-hosted automation |
| --- | --- | --- |
| Best for | Sorting playlists now with an allowlisted test account | Keeping playlists sorted without returning to the website |
| Starts with | Join the app allowlist, then connect Spotify in the browser | Clone the repository and enroll once locally |
| Control | You preview and confirm each sorting operation | GitHub Actions discovers and maintains owned playlists every six hours |
| Credential lifetime | Access token lives in memory and disappears on reload | Refresh token lives in your repository's encrypted Actions secrets |
| Background activity | None | Runs only in your own repository |

Opening the public website does **not** enroll an account in recurring sorting. The hosted Spotify application is in Development Mode: Spotify permits at most five explicitly allowlisted users, and the app owner's Premium subscription must remain active. An allowlisted visitor connects only for the current browser session and manually chooses what to preview and sort. A visitor who is not on the allowlist can still inspect or self-host the project, but Spotify will reject the hosted app's API requests. The repository owner's scheduled workflow is private to that repository and cannot access another visitor's account.

## How it works

### Public website

1. **Connect.** Authorize directly with Spotify through Authorization Code with PKCE.
2. **Choose.** Select a playlist owned by the authenticated account.
3. **Preview.** Read the complete playlist and calculate the exact reorder plan with zero writes.
4. **Confirm.** Start sorting only after an explicit user action.
5. **Verify.** Reconcile every write, then prove that membership and final ordering are correct.

The tab must remain open until verification finishes. Reloading or closing it discards the in-memory Spotify access token and ends the session.

Spotify controls this availability boundary. Development Mode is intended for personal projects and small-scale testing; it is not unrestricted public access. A fork or clone must use its maintainer's own Spotify application and allowlist. See Spotify's [current quota-mode documentation](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

## Behavioral contract

| Concern | Guarantee |
| --- | --- |
| Ordering | Stable newest-added-first; equal timestamps retain their relative order. |
| Missing dates | Occurrences without an addition date move below dated occurrences. |
| Membership | Duplicate, local, unavailable, and unidentified occurrences are preserved. |
| Preview | Reads and plans only; it performs zero Spotify writes. |
| Mutation | Uses Spotify's reorder operation only; never add, remove, replace, create, or delete. |
| Ownership | Refuses to sort a playlist not owned by the authenticated user. |
| Concurrency | Detects snapshot changes, replans within a fixed budget, and never hides ambiguous writes. |
| Completion | Verifies both membership and final ordering before reporting success. |

These are executable invariants, not interface promises. Their authoritative definitions live in the [CleanStack Architecture](docs/architecture/cleanstack.md).

## Safety by design

- The browser receives no Spotify client secret.
- Access tokens exist in memory only and disappear on reload.
- The one-time PKCE verifier and OAuth state use `sessionStorage` only during the redirect round trip and are deleted afterward.
- Refresh tokens returned to the website are discarded.
- The public website has no analytics, advertising, cookies, session replay, application server, or user database.
- Spotify access is limited to the scopes needed to read private playlists and reorder owned playlists.
- Playlist identifiers, OAuth artifacts, tokens, and private playlist contents must never enter Git history or public issues.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/AlbiDR/PlaylistTidy/security/advisories/new).
Use [GitHub Discussions](https://github.com/AlbiDR/PlaylistTidy/discussions) for questions, setup help, and ideas that are not yet actionable issues.
The public [privacy and safe-use notice](https://albidr.github.io/PlaylistTidy/privacy.html) documents the browser data path, infrastructure boundary, user controls, and known limitations in plain language.

## Architecture

Dependency direction is inward:

```text
interfaces  →  applications  →  core
     │               ↑
     └── adapters ───┘
```

- `core/` owns occurrence identity, ordering, range transitions, and planning.
- `applications/` owns preview and sort orchestration through explicit ports.
- `adapters/` validates Spotify data and isolates OAuth and Web API behavior.
- `interfaces/` composes the browser experience without leaking UI concerns inward.
- Tests sit beside the modules whose contracts they specify.

Read the [authoritative architecture reference](docs/architecture/cleanstack.md) before changing a dependency boundary, playlist invariant, Spotify scope, or mutation type.

## Development

Requirements:

- Node.js 22.18 or newer
- npm with lockfile support
- A Spotify Development Mode application for authentication testing

```sh
npm ci --ignore-scripts
npm run verify
```

Run the local website:

```sh
cp .env.example .env
npm run dev
```

Set `VITE_SPOTIFY_CLIENT_ID` in `.env`. A Spotify Client ID is public application configuration; never add the Client Secret.

Register these Spotify redirect URIs exactly:

- Production: `https://albidr.github.io/PlaylistTidy/`
- Local website: `http://127.0.0.1:5173/`
- Reserved CLI enrollment: `http://127.0.0.1:8888/callback`

### Scheduled sorting

The browser can preview and sort multiple selected playlists in one bounded queue. It never schedules future work for a visitor.

Scheduled sorting is a **self-hosted repository feature**, not a service silently enabled by the public website. To maintain your own Spotify account without returning to the browser, fork or clone the repository and enroll that repository once from a trusted local machine with GitHub CLI already authenticated:

```sh
SPOTIFY_CLIENT_ID=cc92650c2f3a452ca396fb3fc6e372cb \
  npm run cli -- enroll
```

Enrollment opens Spotify in the browser, receives the callback only on `127.0.0.1`, and sends the refresh token directly to the `SPOTIFY_REFRESH_TOKEN` Actions secret through `gh`. It never prints or writes the credential to the repository. By default, `PLAYLIST_IDS` is set to `all`: every scheduled run discovers every playlist currently owned by the authenticated account, so newly created playlists join automatically. Followed and collaborative playlists owned by someone else are excluded.

To maintain only a fixed subset instead, enroll with `--playlists=PLAYLIST_ID_ONE,PLAYLIST_ID_TWO` or change the `PLAYLIST_IDS` repository variable later.

For fully autonomous refresh-token rotation, add a fine-grained token with repository Secrets write access as the `PLAYLIST_TIDY_SECRET_ADMIN_TOKEN` Actions secret. The scheduled workflow writes a replacement only when Spotify actually rotates the credential, then deletes its temporary mode-`0600` file. Without that secret, ordinary scheduled runs work, but a future rotation deliberately fails rather than losing the new credential.

`Scheduled Playlist Sort` runs every six hours and can also be dispatched manually with `all` or a temporary playlist list. Each playlist retains its own ownership, snapshot, membership, and final-order verification. The scheduled queue is deliberately sequential and pauses between playlists to reduce Spotify API pressure. If Spotify closes its quota window, the circuit breaker defers unfinished work to the next scheduled run rather than repeatedly failing every playlist.

Spotify Development Mode may invalidate an automation credential after a later website login. The workflow fails closed if that happens; rerun the enrollment command to replace the secret. No playlist write is attempted with an unauthenticated session.

## Quality gate

`npm run verify` is the single local and CI acceptance command:

1. Verify current-year GPL-3.0-only notices and required repository metadata.
2. Verify approved human-only Git attribution.
3. Type-check product and repository tooling under strict TypeScript rules.
4. Enforce architectural and code-quality lint rules.
5. Run the complete automated test suite.
6. Produce clean web and CLI-library builds.
7. Generate and validate install icons and 1200 by 630 social preview artwork.
8. Verify production metadata, public discovery files, and compressed asset budgets.
9. Sanitize the deployment artifact against prohibited typography.

`npm run audit:web` adds real Chromium, Firefox, and WebKit passes across the application, privacy page, and 404 recovery page for landmarks, heading order, complete keyboard traversal, visible focus, 200% text resizing, accessible control names, image alternatives and dimensions, protected external links, pre-authorization storage and network activity, reduced-motion behavior, forced-colors behavior, responsive overflow, duplicate IDs, no-JavaScript fallback, and browser console failures. Axe enforces automatically detectable WCAG A and AA rules. A credential-free Spotify simulation drives the real interface through authorization, owned-playlist filtering, preview, explicit confirmation, reorder, verification, denial, cleanup, and disconnect. Read the [web quality contract](docs/operations/web-quality.md) for the enforced budgets, manual review boundary, privacy posture, and GitHub Pages header limitations.

GitHub Pages also serves a branded, script-free recovery page for unknown routes. The deployment-health workflow proves that missing URLs retain the correct HTTP 404 status instead of becoming misleading successful responses.

GitHub enforces those controls through independent Verify, Repository Policy, and Contributor Attribution Policy workflows. A successful Verify run on `main` hands its exact commit SHA to the privileged Pages workflow, which rebuilds and deploys that verified revision. Actions use least-privilege permissions, immutable revisions, bounded runtimes, non-persistent checkout credentials, and concurrency cancellation.

Scheduled Verify runs rebuild, recheck, recapture, and redeploy the site every Wednesday. A separate deployment-health workflow checks the live HTML and content-fingerprinted production assets after every Pages deployment and again every Tuesday. Scheduled playlist sorting runs every six hours once enrolled. These jobs never author commits, preserving the human-only contributor history.

## Repository map

```text
.
├── .github/   Governance, ownership, issue forms, and workflows
├── config/    TypeScript, ESLint, Vitest, and Vite configuration
├── docs/      Architecture, operational contracts, README assets, and project documentation
├── scripts/   Typed cleanup and repository-policy checks
└── src/       Product code, interfaces, colocated tests, and test support
```

The root is reserved for project identity, the npm manifest and lockfile, and conventional dotfiles consumed directly by development tools.

## Contributing

Read [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) before changing behavior or architecture. Pull requests must be focused, preserve the Spotify mutation boundary, and pass `npm run verify`.

Repository history attributes work only to the humans responsible for its commits. Automated systems, bots, and AI tools must never be named as authors or co-authors; the complete Git history is checked on every push and pull request.

## License

[GPL-3.0-only](LICENSE), copyright 2026 AlbiDR.
