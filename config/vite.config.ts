// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const webRoot = fileURLToPath(new URL("../src/interfaces/web", import.meta.url));

export default defineConfig({
  base: "./",
  envDir: repositoryRoot,
  root: webRoot,
  build: {
    outDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    emptyOutDir: true,
  },
  test: {
    exclude: [...configDefaults.exclude, "dist/**", "dist-cli/**"],
    root: repositoryRoot,
  },
});
