// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

const deploymentUrl = new URL("https://albidr.github.io/PlaylistTidy/");
const failures: string[] = [];

const documentResponse = await request(new URL(`?health=${String(Date.now())}`, deploymentUrl));
const documentSource = documentResponse === undefined ? "" : await documentResponse.text();
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
if (!documentSource.includes("Loading the application…")) {
  failures.push("index.html is missing its pre-JavaScript loading fallback.");
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown network error";
}

export {};
