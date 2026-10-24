# Playlist Tidy for Spotify

Playlist Tidy for Spotify is an independent utility for keeping playlists owned by the authenticated user ordered newest-added first. It is not affiliated with or endorsed by Spotify.

## Project status

The project is under active development. The pure playlist kernel, canonical range-move transition, exact small-playlist planner, larger-playlist block planner, identity rules, validated Spotify Web API adapter, coherent paginated reads, write-safe retry boundary, preview use case, tests, and initial static shell are implemented. OAuth and full execution reconciliation are the next milestone.

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

## Contributor attribution

Repository history attributes work only to the humans responsible for its commits. AI systems, coding agents, bots, and automation must never be named as authors or co-authors. The Contributor Attribution Policy action scans the complete Git history and rejects every identity that is not explicitly listed in `.github/allowed-contributors.json`.

The policy governs Git metadata, which is the information GitHub uses for contributor attribution. It cannot determine which private tools a human used while preparing a change.

## License

GPL-3.0-only. A complete license file will be added before the first release.
