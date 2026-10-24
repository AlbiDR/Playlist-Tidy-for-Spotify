<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- Copyright (C) 2026 AlbiDR -->

# Playlist Tidy for Spotify

Playlist Tidy for Spotify is an independent utility for keeping playlists owned by the authenticated user ordered newest-added first. It is not affiliated with or endorsed by Spotify.

## Project status

The project is under active development. The pure playlist kernel, canonical range-move transition, exact small-playlist planner, larger-playlist block planner, identity rules, validated Spotify Web API adapter, coherent paginated reads, write-safe retry boundary, preview use case, sort orchestrator, per-step reconciliation, ambiguous-write recovery, browser PKCE login, owned-playlist discovery, write-free previews, explicit sort confirmation, verified result reporting, and tests are implemented.

This is an early build. Preview first, and test sorting on a playlist you can restore before trusting it with an important library.

## Guarantees under development

- Stable newest-added-first ordering
- Null dates at the bottom
- Duplicate, local, unavailable, and unidentified occurrences preserved
- Preview with zero writes
- Reorder-only Spotify capability
- Snapshot-aware reconciliation
- Post-run membership and order verification
- Shared behavior between the website and CLI

The authoritative architecture is documented in [CleanStack Architecture](docs/architecture/cleanstack.md).

## Repository map

```text
.
├── .github/   GitHub governance, ownership, issue forms, and workflows
├── config/    TypeScript, ESLint, and Vite configuration
├── docs/      Authoritative architecture and project documentation
├── scripts/   Executable repository-policy checks
└── src/       Product code, interfaces, colocated tests, and test support
```

The root is reserved for repository identity (`README.md`, `LICENSE`), the npm manifest and lockfile, and conventional dotfiles consumed directly by development tools.

## Development

Requires Node.js 22.18 or newer so repository TypeScript tooling runs natively.

```sh
npm ci
npm run verify
```

Run the local static site with:

```sh
npm run dev
```

### Spotify application configuration

Create a Spotify Development Mode application and register these redirect URIs exactly:

- Production: `https://albidr.github.io/Playlist-Tidy-for-Spotify/`
- Local website: `http://127.0.0.1:5173/`
- Future CLI enrollment: `http://127.0.0.1:8888/callback`

Set the repository variable `SPOTIFY_CLIENT_ID` to the application's Client ID. For local development, copy `.env.example` to `.env` and set `VITE_SPOTIFY_CLIENT_ID`. A Client ID is public application configuration, not a secret; never place the Client Secret in this project.

The website stores its access token in memory only. Reloading the page disconnects the session. The one-time PKCE verifier and OAuth state are stored in `sessionStorage` only for the authorization redirect and are deleted while processing the callback. Any refresh token returned to the website is discarded.

## Security

Do not commit Spotify tokens, playlist identifiers, OAuth authorization codes, PKCE verifiers, or local environment files. Report security-sensitive issues privately rather than opening a public issue.

## Contributor attribution

Repository history attributes work only to the humans responsible for its commits. AI systems, coding agents, bots, and automation must never be named as authors or co-authors. The Contributor Attribution Policy action scans the complete Git history and rejects every identity that is not explicitly listed in `.github/allowed-contributors.json`.

The policy governs Git metadata, which is the information GitHub uses for contributor attribution. It cannot determine which private tools a human used while preparing a change.

## Repository governance

`npm run verify` is the single local and CI quality gate. It enforces current-year GPL-3.0-only notices, approved human attribution, architectural lint boundaries, strict type checking, tests, and reproducible production builds. `npm run license:fix` applies the canonical header for the current UTC year to supported files; strict JSON receives equivalent structured metadata.

Pull requests use structured safety checks, issues use privacy-aware forms, sensitive reports use private security advisories, and CODEOWNERS makes review responsibility explicit. GitHub Actions use least-privilege permissions, immutable action revisions, bounded runtimes, non-persistent checkout credentials, and lifecycle concurrency controls.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
