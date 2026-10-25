// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const webRoot = fileURLToPath(new URL("../src/interfaces/web", import.meta.url));

export default defineConfig({
  base: "./",
  envDir: repositoryRoot,
  root: webRoot,
  build: {
    target: "baseline-widely-available",
    outDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    emptyOutDir: true,
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        "404": resolve(webRoot, "404.html"),
        index: resolve(webRoot, "index.html"),
        privacy: resolve(webRoot, "privacy.html"),
      },
    },
  },
  preview: {
    headers: getLocalSecurityHeaders(),
  },
  server: {
    headers: getLocalSecurityHeaders(),
  },
  test: {
    exclude: [...configDefaults.exclude, "dist/**", "dist-cli/**"],
    root: repositoryRoot,
  },
});

function getLocalSecurityHeaders(): Record<string, string> {
  return {
    "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}
