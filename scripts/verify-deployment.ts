// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

const deploymentUrl = new URL("https://albidr.github.io/PlaylistTidy/");
const requiredAssets = ["assets/app.js", "assets/index.css", "assets/favicon.svg"] as const;
const failures: string[] = [];

const documentResponse = await request(new URL(`?health=${String(Date.now())}`, deploymentUrl));
const documentSource = documentResponse === undefined ? "" : await documentResponse.text();
for (const asset of requiredAssets) {
  if (!documentSource.includes(`./${asset}`)) {
    failures.push(`index.html does not reference ${asset}.`);
    continue;
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
  process.stdout.write("Live deployment and stable assets are reachable.\n");
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
