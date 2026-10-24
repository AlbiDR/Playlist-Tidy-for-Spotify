# Playlist Tidy for Spotify

Playlist Tidy for Spotify is an independent utility for keeping playlists owned by the authenticated user ordered newest-added first. It is not affiliated with or endorsed by Spotify.

## Project status

The project is under active development. The pure playlist kernel, canonical range-move transition, exact small-playlist planner, larger-playlist block planner, identity rules, tests, and initial static shell are implemented. Spotify authentication and API integration are the next milestone.

Do not use the current build with a real Spotify playlist yet.

## Guarantees under development

- Stable newest-added-first ordering
- Null dates at the bottom
- Duplicate, local, unavailable, and unidentified occurrences preserved
- Preview with zero writes
- Reorder-only Spotify capability
- Snapshot-aware reconciliation
- Post-run membership and order verification
- Shared behavior between the website and CLI

The authoritative architecture is documented in [CleanStack Architecture](.github/authoritative-design-references/CleanStack%20Architecture.md).

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Run the local static site with:

```sh
npm run dev
```

## Security

Do not commit Spotify tokens, playlist identifiers, OAuth authorization codes, PKCE verifiers, or local environment files. Report security-sensitive issues privately rather than opening a public issue.

## License

GPL-3.0-only. A complete license file will be added before the first release.
