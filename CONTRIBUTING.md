<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- Copyright (C) 2026 AlbiDR -->

# Contributing

Playlist Tidy accepts focused, reviewable changes that preserve its narrow Spotify mutation boundary and the invariants in the authoritative architecture document.

## Development contract

1. Read the [CleanStack Architecture](.github/authoritative-design-references/CleanStack%20Architecture.md) before changing dependencies or behavior.
2. Create one branch and one coherent pull request per concern.
3. Never commit credentials, OAuth artifacts, playlist identifiers, private playlist contents, build output, or local environment files.
4. Add or update tests before changing a sorting, identity, reconciliation, or adapter invariant.
5. Run `npm ci` followed by `npm run verify`.
6. Use conventional commit subjects such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, and `chore:`.

## Licensing

All contributions are licensed under GPL-3.0-only. Run `npm run license:fix` after adding files, then review the result. `npm run verify:licenses` rejects missing, incorrect, or stale copyright years. Strict JSON uses structured `license` and `copyright` properties because JSON does not permit comments; the generated lockfile carries the same metadata in its root package record.

## Architecture and safety review

Changes require explicit discussion when they add a Spotify scope, introduce a new write type, relax ownership checks, weaken snapshot reconciliation, change occurrence identity, or cross a CleanStack dependency boundary. Never silently recover from an ambiguous write.

Security reports belong in a private GitHub security advisory, not a public issue.
