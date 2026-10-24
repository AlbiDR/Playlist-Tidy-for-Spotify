// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

