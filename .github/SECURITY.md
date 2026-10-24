<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- Copyright (C) 2026 AlbiDR -->

# Security policy

## Supported versions

The project is pre-release. Only the current `main` branch receives security fixes.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/AlbiDR/Playlist-Tidy-for-Spotify/security/advisories/new). Do not open a public issue or disclose live Spotify tokens, authorization codes, PKCE verifiers, playlist identifiers, or private playlist data.

Include a concise impact statement, safe reproduction steps, the affected commit, and any suggested mitigation. Receipt will be acknowledged as soon as practical; remediation timing depends on severity and the safety of the fix.

## Security boundary

The website uses Authorization Code with PKCE, keeps access tokens in memory, discards refresh tokens, and performs only playlist reorder writes. Reports involving additional token persistence, broader Spotify scopes, missing ownership checks, or membership-changing writes are treated as boundary violations.
