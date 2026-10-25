// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

const deploymentUrl = new URL("https://albidr.github.io/PlaylistTidy/");
const failures: string[] = [];

const documentResponse = await request(new URL(`?health=${String(Date.now())}`, deploymentUrl));
const documentSource = documentResponse === undefined ? "" : await documentResponse.text();
const privacyResponse = await request(new URL(`privacy.html?health=${String(Date.now())}`, deploymentUrl));
const privacySource = privacyResponse === undefined ? "" : await privacyResponse.text();
const notFoundDocument = await requestExpectedNotFound(
  new URL(`missing/deep/health-check-${String(Date.now())}`, deploymentUrl),
);
const notFoundAssetReferences = [...notFoundDocument.matchAll(/(?:href|src)="\/PlaylistTidy\/(assets\/[^"?#]+)"/gu)]
  .map((match) => match[1])
  .filter((asset): asset is string => asset !== undefined);
const assetReferences = [...documentSource.matchAll(/(?:href|src)="\.\/(assets\/[^"?#]+)"/gu)]
  .map((match) => match[1])
  .filter((asset): asset is string => asset !== undefined);
for (const extension of [".js", ".css", ".svg"] as const) {
  if (!assetReferences.some((asset) => asset.endsWith(extension))) {
    failures.push(`index.html does not reference a production ${extension} asset.`);
  }
}
for (const asset of new Set(assetReferences)) {
  if (!/-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u.test(asset)) {
    failures.push(`${asset} is not content fingerprinted.`);
  }
  await request(new URL(asset, deploymentUrl));
}
if (!notFoundAssetReferences.some((asset) => asset.endsWith(".css"))) {
  failures.push("The custom 404 response does not reference its production CSS asset.");
}
for (const asset of new Set(notFoundAssetReferences)) {
  if (!/-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u.test(asset)) {
    failures.push(`${asset} is not a content-fingerprinted 404 asset.`);
  }
  await request(new URL(asset, deploymentUrl));
}
if (!documentSource.includes("Loading the application…")) {
  failures.push("index.html is missing its pre-JavaScript loading fallback.");
}
for (const requiredMarkup of [
  'rel="canonical" href="https://albidr.github.io/PlaylistTidy/"',
  'rel="manifest" href="./site.webmanifest"',
  'http-equiv="Content-Security-Policy"',
  'name="referrer" content="no-referrer"',
]) {
  if (!documentSource.includes(requiredMarkup)) failures.push(`index.html is missing ${requiredMarkup}.`);
}
for (const requiredMarkup of [
  '<title>Privacy &amp; safe use | Playlist Tidy</title>',
  'rel="canonical" href="https://albidr.github.io/PlaylistTidy/privacy.html"',
  'name="referrer" content="no-referrer"',
  'http-equiv="Content-Security-Policy"',
]) {
  if (!privacySource.includes(requiredMarkup)) failures.push(`privacy.html is missing ${requiredMarkup}.`);
}
for (const requiredMarkup of [
  '<title>Page not found | Playlist Tidy</title>',
  'name="robots" content="noindex, follow"',
  'http-equiv="Content-Security-Policy"',
  'That page does not exist',
  'href="/PlaylistTidy/assets/404-',
  'href="/PlaylistTidy/"',
  'href="/PlaylistTidy/privacy.html"',
]) {
  if (!notFoundDocument.includes(requiredMarkup)) failures.push(`The custom 404 response is missing ${requiredMarkup}.`);
}
for (const publicAsset of [
  "app-icon.svg",
  "app-icon-192.png",
  "app-icon-512.png",
  "apple-touch-icon.png",
  "robots.txt",
  "site.webmanifest",
  "sitemap.xml",
  "social-card.png",
]) {
  await request(new URL(publicAsset, deploymentUrl));
}

if (failures.length > 0) {
  process.stderr.write(`Deployment health failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Live deployment and fingerprinted assets are reachable.\n");
}

async function request(url: URL): Promise<Response | undefined> {
  try {
    const response = await fetch(url, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) failures.push(`${url.pathname} returned HTTP ${String(response.status)}.`);
    return response.ok ? response : undefined;
  } catch (error) {
    failures.push(`${url.pathname} could not be reached: ${getErrorMessage(error)}.`);
    return undefined;
  }
}

async function requestExpectedNotFound(url: URL): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 404) {
      failures.push(`${url.pathname} returned HTTP ${String(response.status)} instead of HTTP 404.`);
    }
    return await response.text();
  } catch (error) {
    failures.push(`${url.pathname} could not be reached: ${getErrorMessage(error)}.`);
    return "";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown network error";
}

export {};
