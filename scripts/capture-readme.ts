// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
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
  await captureRoundedScreenshot(page, `${outputDirectory}/desktop.png`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://${host}:${String(port)}/`, { waitUntil: "networkidle" });
  await captureRoundedScreenshot(page, `${outputDirectory}/mobile.png`);
} finally {
  await browser.close();
  await server.close();
}

async function captureRoundedScreenshot(
  page: import("playwright").Page,
  outputPath: string,
): Promise<void> {
  const source = await page.screenshot({ fullPage: true, type: "png" });
  const metadata = await sharp(source).metadata();
  if (metadata.width === undefined || metadata.height === undefined) {
    throw new Error("Screenshot dimensions are unavailable.");
  }
  const mask = Buffer.from(
    `<svg width="${String(metadata.width)}" height="${String(metadata.height)}"><rect width="100%" height="100%" rx="24" fill="white"/></svg>`,
  );
  await sharp(source)
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}
