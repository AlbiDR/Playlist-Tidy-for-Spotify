// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import sharp from "sharp";

const outputRoot = fileURLToPath(new URL("../dist/web/", import.meta.url));
const indexSource = readFileSync(join(outputRoot, "index.html"), "utf8");
const privacySource = readFileSync(join(outputRoot, "privacy.html"), "utf8");
const notFoundSource = readFileSync(join(outputRoot, "404.html"), "utf8");
const failures: string[] = [];

const requiredMarkup = [
  '<html lang="en">',
  'name="description"',
  'name="referrer" content="no-referrer"',
  'name="theme-color"',
  'rel="canonical" href="https://albidr.github.io/PlaylistTidy/"',
  'rel="manifest" href="./site.webmanifest"',
  'property="og:title"',
  'property="og:description"',
  'property="og:image" content="https://albidr.github.io/PlaylistTidy/social-card.png"',
  'name="twitter:card" content="summary_large_image"',
  'http-equiv="Content-Security-Policy"',
  '<div id="app">',
];
for (const markup of requiredMarkup) {
  if (!indexSource.includes(markup)) failures.push(`index.html is missing ${markup}.`);
}

for (const name of [
  "app-icon.svg",
  "app-icon-192.png",
  "app-icon-512.png",
  "apple-touch-icon.png",
  "robots.txt",
  "site.webmanifest",
  "sitemap.xml",
  "social-card.png",
]) {
  if (!existsInOutput(name)) failures.push(`${name} is missing from the production output.`);
}

for (const markup of [
  '<html lang="en">',
  '<title>Privacy &amp; safe use | Playlist Tidy</title>',
  'rel="canonical" href="https://albidr.github.io/PlaylistTidy/privacy.html"',
  'name="referrer" content="no-referrer"',
  'http-equiv="Content-Security-Policy"',
  '<main id="main-content"',
]) {
  if (!privacySource.includes(markup)) failures.push(`privacy.html is missing ${markup}.`);
}

for (const markup of [
  '<html lang="en">',
  '<title>Page not found | Playlist Tidy</title>',
  'name="robots" content="noindex, follow"',
  'name="referrer" content="no-referrer"',
  'http-equiv="Content-Security-Policy"',
  '<main id="main-content"',
  'href="/PlaylistTidy/assets/404-',
  'href="/PlaylistTidy/"',
  'href="/PlaylistTidy/privacy.html"',
]) {
  if (!notFoundSource.includes(markup)) failures.push(`404.html is missing ${markup}.`);
}

const manifest = JSON.parse(readFileSync(join(outputRoot, "site.webmanifest"), "utf8")) as Record<string, unknown>;
if (manifest.start_url !== "/PlaylistTidy/" || manifest.scope !== "/PlaylistTidy/") {
  failures.push("The web manifest must stay scoped to the GitHub Pages project path.");
}

await verifyImageDimensions("app-icon-192.png", 192, 192);
await verifyImageDimensions("app-icon-512.png", 512, 512);
await verifyImageDimensions("apple-touch-icon.png", 180, 180);
await verifyImageDimensions("social-card.png", 1200, 630);

const budgets = new Map([
  [".js", 30 * 1024],
  [".css", 15 * 1024],
  [".html", 8 * 1024],
]);
let totalGzipBytes = 0;
for (const path of collectFiles(outputRoot)) {
  const extension = extname(path);
  const budget = budgets.get(extension);
  if (budget === undefined) continue;
  const gzipBytes = gzipSync(readFileSync(path)).byteLength;
  totalGzipBytes += gzipBytes;
  if (gzipBytes > budget) {
    failures.push(`${relative(outputRoot, path)} is ${String(gzipBytes)} gzip bytes; budget is ${String(budget)}.`);
  }
}
if (totalGzipBytes > 55 * 1024) {
  failures.push(`HTML, CSS, and JavaScript total ${String(totalGzipBytes)} gzip bytes; budget is 56320.`);
}

if (failures.length > 0) {
  process.stderr.write(`Web quality policy failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Web quality policy passed at ${String(totalGzipBytes)} total gzip bytes.\n`);
}

function existsInOutput(name: string): boolean {
  try {
    return statSync(join(outputRoot, name)).isFile();
  } catch {
    return false;
  }
}

function collectFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : entry.isFile() ? [path] : [];
  });
}

async function verifyImageDimensions(name: string, width: number, height: number): Promise<void> {
  try {
    const metadata = await sharp(join(outputRoot, name)).metadata();
    if (metadata.width !== width || metadata.height !== height) {
      failures.push(`${name} must be ${String(width)}x${String(height)} pixels.`);
    }
  } catch {
    failures.push(`${name} could not be inspected as an image.`);
  }
}
