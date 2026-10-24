// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
  },
});
