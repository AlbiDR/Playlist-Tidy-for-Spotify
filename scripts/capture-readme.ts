// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";

const outputDirectory = fileURLToPath(new URL("../dist/web/readme", import.meta.url));
const host = "127.0.0.1";
const port = 4173;

await mkdir(outputDirectory, { recursive: true });

const server = await preview({
  configFile: fileURLToPath(new URL("../config/vite.config.ts", import.meta.url)),
  preview: { host, port, strictPort: true },
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    colorScheme: "light",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1024 },
  });
  await page.goto(`http://${host}:${String(port)}/`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: `${outputDirectory}/desktop.png`,
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://${host}:${String(port)}/`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: `${outputDirectory}/mobile.png`,
    fullPage: true,
  });
} finally {
  await browser.close();
  await server.close();
}
