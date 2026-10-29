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
const humansSource = readFileSync(join(outputRoot, "humans.txt"), "utf8");
const llmsSource = readFileSync(join(outputRoot, "llms.txt"), "utf8");
const robotsSource = readFileSync(join(outputRoot, "robots.txt"), "utf8");
const sitemapSource = readFileSync(join(outputRoot, "sitemap.xml"), "utf8");
const failures: string[] = [];
const expectedReleaseRevision = process.env.PLAYLIST_TIDY_RELEASE_SHA?.trim();

const requiredMarkup = [
  '<html lang="en">',
  'name="description"',
  'name="referrer" content="no-referrer"',
  'name="theme-color"',
  'rel="canonical" href="https://albidr.github.io/PlaylistTidy/"',
  'rel="describedby" href="./llms.txt"',
  'rel="author" href="./humans.txt"',
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
  "humans.txt",
  "llms.txt",
  "robots.txt",
  "site.webmanifest",
  "sitemap.xml",
  "social-card.png",
]) {
  if (!existsInOutput(name)) failures.push(`${name} is missing from the production output.`);
}

if (expectedReleaseRevision !== undefined) {
  const releasePath = join(outputRoot, "release.json");
  if (!existsInOutput("release.json")) {
    failures.push("release.json is missing from the attested production output.");
  } else {
    try {
      const release = JSON.parse(readFileSync(releasePath, "utf8")) as { readonly revision?: unknown };
      if (release.revision !== expectedReleaseRevision) {
        failures.push("release.json does not identify the requested deployment revision.");
      }
    } catch {
      failures.push("release.json is not valid JSON.");
    }
  }
}

for (const markup of [
  '<html lang="en">',
  '<title>Privacy &amp; safe use | Playlist Tidy</title>',
  'rel="canonical" href="https://albidr.github.io/PlaylistTidy/privacy.html"',
  'rel="describedby" href="./llms.txt"',
  'rel="author" href="./humans.txt"',
  'name="referrer" content="no-referrer"',
  'http-equiv="Content-Security-Policy"',
  '<main id="main-content"',
]) {
  if (!privacySource.includes(markup)) failures.push(`privacy.html is missing ${markup}.`);
}

if (!llmsSource.startsWith("# Playlist Tidy for Spotify\n")) {
  failures.push("llms.txt must begin with the project H1 required by the llms.txt proposal.");
}
for (const requiredLlmsText of [
  "> Playlist Tidy is an open-source Spotify utility",
  "## Product",
  "## Documentation",
  "## Project governance",
  "https://raw.githubusercontent.com/AlbiDR/PlaylistTidy/main/README.md",
]) {
  if (!llmsSource.includes(requiredLlmsText)) failures.push(`llms.txt is missing ${requiredLlmsText}.`);
}
if (!humansSource.includes("Creator and maintainer: AlbiDR") || !humansSource.includes("License: GPL-3.0-only")) {
  failures.push("humans.txt is missing project authorship or licensing metadata.");
}
if (!robotsSource.includes("Sitemap: https://albidr.github.io/PlaylistTidy/sitemap.xml")) {
  failures.push("robots.txt does not advertise the canonical sitemap.");
}
for (const canonicalUrl of [
  "https://albidr.github.io/PlaylistTidy/",
  "https://albidr.github.io/PlaylistTidy/privacy.html",
]) {
  if (!sitemapSource.includes(`<loc>${canonicalUrl}</loc>`)) {
    failures.push(`sitemap.xml is missing ${canonicalUrl}.`);
  }
}
if (sitemapSource.includes("<priority>") || sitemapSource.includes("<changefreq>")) {
  failures.push("sitemap.xml includes priority or changefreq values ignored by major search engines.");
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
