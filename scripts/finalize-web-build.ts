// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const outputRoot = new URL("../dist/web/", import.meta.url);
const notFoundPath = fileURLToPath(new URL("../dist/web/404.html", import.meta.url));
const original = await readFile(notFoundPath, "utf8");
const assetReference = /(?<attribute>href|src)="\.\/(?<path>assets\/[^"?#]+|apple-touch-icon\.png)"/gu;
let replacementCount = 0;
const finalized = original.replace(assetReference, (...args: unknown[]) => {
  const groups = args.at(-1) as { readonly attribute?: string; readonly path?: string } | undefined;
  if (groups?.attribute === undefined || groups.path === undefined) return String(args[0]);
  replacementCount += 1;
  return `${groups.attribute}="/PlaylistTidy/${groups.path}"`;
});

if (replacementCount < 3) {
  throw new Error(`Expected at least three 404 asset references to finalize, received ${String(replacementCount)}.`);
}
if (finalized.includes('href="./assets/') || finalized.includes('src="./assets/')) {
  throw new Error("The custom 404 document retained a route-relative build asset.");
}

await writeFile(notFoundPath, finalized);
process.stdout.write(`Finalized ${String(replacementCount)} custom 404 asset references.\n`);

const releaseRevision = process.env.PLAYLIST_TIDY_RELEASE_SHA?.trim();
if (releaseRevision !== undefined) {
  if (!/^[0-9a-f]{40}$/u.test(releaseRevision)) {
    throw new Error("PLAYLIST_TIDY_RELEASE_SHA must be a complete lowercase Git commit SHA.");
  }
  await writeFile(
    fileURLToPath(new URL("release.json", outputRoot)),
    `${JSON.stringify({ revision: releaseRevision }, null, 2)}\n`,
  );
  process.stdout.write(`Attested web release ${releaseRevision}.\n`);
}
