// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, firefox, webkit } from "playwright";
import type { Browser, Page, Route } from "playwright";
import { build, preview } from "vite";

const host = "127.0.0.1";
const port = 4175;
const origin = `http://${host}:${String(port)}`;
const clientId = "playlist-tidy-browser-audit";
const failures: string[] = [];
const configFile = fileURLToPath(new URL("../config/vite.config.ts", import.meta.url));
const buildDirectory = await mkdtemp(join(tmpdir(), "playlist-tidy-browser-audit-"));
const viteOverrides = {
  configFile,
  define: {
    "import.meta.env.VITE_SPOTIFY_CLIENT_ID": JSON.stringify(clientId),
  },
  build: { outDir: buildDirectory, emptyOutDir: true },
  logLevel: "error" as const,
};
await build(viteOverrides);
const server = await preview({
  ...viteOverrides,
  preview: { host, port, strictPort: true },
});
const browserTypes = [
  ["Chromium", chromium],
  ["Firefox", firefox],
  ["WebKit", webkit],
] as const;

try {
  for (const [browserName, browserType] of browserTypes) {
    const browser = await browserType.launch({ headless: true });
    try {
      await auditSuccessfulJourney(browser, browserName);
      if (browserName === "Chromium") await auditDeniedAuthorization(browser);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
  await rm(buildDirectory, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`Authenticated browser journey audit failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Chromium, Firefox, and WebKit authenticated Spotify journey audits passed.\n");
}

async function auditSuccessfulJourney(browser: Browser, browserName: string): Promise<void> {
  const context = await browser.newContext({
    colorScheme: "dark",
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const mock = createSpotifyMock();
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => runtimeErrors.push(`page: ${error.message}`));
  await installSpotifyRoutes(page, mock);

  try {
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    const connect = page.getByRole("button", { name: "Connect Spotify" });
    if (!(await connect.isEnabled())) {
      failures.push(`${browserName} did not enable Spotify connection in the journey harness.`);
      return;
    }

    await connect.click();
    await page.waitForURL("https://accounts.spotify.com/authorize**");
    const authorizationUrl = new URL(page.url());
    const state = authorizationUrl.searchParams.get("state");
    const requestedScopes = new Set((authorizationUrl.searchParams.get("scope") ?? "").split(" "));
    const requiredScopes = [
      "playlist-read-private",
      "playlist-read-collaborative",
      "playlist-modify-public",
      "playlist-modify-private",
    ];
    if (
      authorizationUrl.searchParams.get("client_id") !== clientId ||
      authorizationUrl.searchParams.get("response_type") !== "code" ||
      authorizationUrl.searchParams.get("code_challenge_method") !== "S256" ||
      authorizationUrl.searchParams.get("code_challenge")?.length !== 43 ||
      state === null ||
      !requiredScopes.every((scope) => requestedScopes.has(scope))
    ) {
      failures.push(`${browserName} generated an incomplete Spotify PKCE authorization request.`);
      return;
    }
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    if ((await page.evaluate(() => window.sessionStorage.length)) !== 2) {
      failures.push(`${browserName} did not retain exactly the two transient OAuth values before callback.`);
    }

    await page.goto(`${origin}/?code=audit-code&state=${encodeURIComponent(state)}`, { waitUntil: "networkidle" });
    await page.getByText("2 owned playlists loaded.").waitFor();
    if (new URL(page.url()).search.length > 0) {
      failures.push(`${browserName} left OAuth callback parameters in the address bar.`);
    }
    if ((await page.evaluate(() => window.sessionStorage.length)) !== 0) {
      failures.push(`${browserName} did not clear transient OAuth storage after callback.`);
    }
    if (await page.getByText("Followed playlist").count() > 0) {
      failures.push(`${browserName} exposed a playlist not owned by the authenticated account.`);
    }
    if (await page.getByText("1 item · Visibility unavailable").count() !== 1) {
      failures.push(`${browserName} mislabeled Spotify's nullable playlist visibility.`);
    }
    await auditAxe(page, `${browserName} connected catalog`);

    await page.getByRole("button", { name: "Preview sorting Needs sorting" }).click();
    await page.getByText("1 range move planned for 2 items. Nothing has changed yet.").waitFor();
    if (mock.writeCount !== 0) {
      failures.push(`${browserName} wrote to Spotify during preview.`);
    }
    await auditAxe(page, `${browserName} preview confirmation`);

    const writeRequest = page.waitForRequest((request) =>
      request.method() === "PUT" && new URL(request.url()).pathname === "/v1/playlists/owned-a/items",
    );
    await page.getByRole("button", { name: "Sort now: apply 1 planned sorting moves" }).click();
    await writeRequest;
    if (await page.getByRole("button", { name: "Disconnect" }).isEnabled()) {
      failures.push(`${browserName} allowed disconnect while a playlist write was in progress.`);
    }
    if (await page.getByRole("button", { name: "Preview sorting Already tidy" }).isEnabled()) {
      failures.push(`${browserName} allowed a competing playlist action while a write was in progress.`);
    }
    const leaveWasPrevented = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      return !window.dispatchEvent(event);
    });
    if (!leaveWasPrevented) {
      failures.push(`${browserName} did not protect an in-progress playlist write from accidental navigation.`);
    }
    await page.getByText("Sorted and verified 2 items with 1 write. Membership is unchanged.").waitFor();
    const idleLeaveWasPrevented = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      return !window.dispatchEvent(event);
    });
    if (idleLeaveWasPrevented) {
      failures.push(`${browserName} retained its navigation warning after the playlist write completed.`);
    }
    if (mock.writeCount !== 1 || mock.items[0]?.item?.uri !== "spotify:track:new") {
      failures.push(`${browserName} did not perform exactly one correct reorder in the simulated journey.`);
    }
    await auditAxe(page, `${browserName} verified result`);

    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("button", { name: "Connect Spotify" }).waitFor();
    const retained = await page.evaluate(() => ({
      cookies: document.cookie,
      local: window.localStorage.length,
      session: window.sessionStorage.length,
    }));
    if (retained.cookies.length > 0 || retained.local > 0 || retained.session > 0) {
      failures.push(`${browserName} retained browser data after disconnect.`);
    }
    if (runtimeErrors.length > 0) {
      failures.push(`${browserName} emitted runtime errors during the authenticated journey: ${runtimeErrors.join("; ")}.`);
    }
  } finally {
    await context.close();
  }
}

async function auditDeniedAuthorization(browser: Browser): Promise<void> {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.route("https://accounts.spotify.com/authorize**", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Mock Spotify authorization</title>",
  }));
  try {
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Connect Spotify" }).click();
    await page.waitForURL("https://accounts.spotify.com/authorize**");
    const state = new URL(page.url()).searchParams.get("state");
    if (state === null) {
      failures.push("Chromium denial journey did not generate OAuth state.");
      return;
    }
    await page.goto(`${origin}/?error=access_denied&state=${encodeURIComponent(state)}`, { waitUntil: "networkidle" });
    await page.getByText("Spotify access was not granted.").waitFor();
    if ((await page.evaluate(() => window.sessionStorage.length)) !== 0 || new URL(page.url()).search.length > 0) {
      failures.push("Chromium did not clean up after denied Spotify authorization.");
    }
    if (!(await page.getByRole("button", { name: "Try again" }).isEnabled())) {
      failures.push("Chromium did not offer a retry after denied Spotify authorization.");
    }
  } finally {
    await context.close();
  }
}

interface MockPlaylistItem {
  readonly added_at: string;
  readonly added_by: { readonly id: string };
  readonly item: { readonly uri: string; readonly type: "track"; readonly is_local: false };
}

interface SpotifyMock {
  readonly items: MockPlaylistItem[];
  snapshot: number;
  writeCount: number;
}

function createSpotifyMock(): SpotifyMock {
  return {
    items: [
      createItem("spotify:track:old", "2026-01-01T00:00:00Z"),
      createItem("spotify:track:new", "2026-01-02T00:00:00Z"),
    ],
    snapshot: 1,
    writeCount: 0,
  };
}

function createItem(uri: string, addedAt: string): MockPlaylistItem {
  return {
    added_at: addedAt,
    added_by: { id: "owner" },
    item: { uri, type: "track", is_local: false },
  };
}

async function installSpotifyRoutes(page: Page, mock: SpotifyMock): Promise<void> {
  await page.route("https://accounts.spotify.com/authorize**", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Mock Spotify authorization</title>",
  }));
  await page.route("https://accounts.spotify.com/api/token", async (route) => {
    const request = route.request();
    const body = new URLSearchParams(request.postData() ?? "");
    if (
      request.method() !== "POST" ||
      body.get("client_id") !== clientId ||
      body.get("grant_type") !== "authorization_code" ||
      body.get("code") !== "audit-code" ||
      body.get("code_verifier") === null
    ) {
      failures.push("The token exchange did not contain the complete PKCE grant.");
    }
    await fulfillJson(route, {
      access_token: "audit-access-token",
      token_type: "Bearer",
      expires_in: 3_600,
      refresh_token: "discarded-by-browser-client",
      scope: "playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private",
    });
  });
  await page.route("https://api.spotify.com/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.headers().authorization !== "Bearer audit-access-token") {
      failures.push(`Spotify API request omitted the bearer token for ${url.pathname}.`);
    }
    if (request.method() === "GET" && url.pathname === "/v1/me") {
      await fulfillJson(route, { id: "owner" });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/me/playlists") {
      await fulfillJson(route, {
        items: [
          playlistSummary("owned-a", "owner", "Needs sorting", 2, false),
          playlistSummary("owned-b", "owner", "Already tidy", 1, null),
          playlistSummary("followed", "another-owner", "Followed playlist", 8, true),
        ],
        next: null,
        total: 3,
      });
      return;
    }
    if (url.pathname === "/v1/playlists/owned-a" && request.method() === "GET") {
      await fulfillJson(route, playlistMetadata(mock));
      return;
    }
    if (url.pathname === "/v1/playlists/owned-a/items" && request.method() === "GET") {
      await fulfillJson(route, { items: mock.items, next: null, total: mock.items.length });
      return;
    }
    if (url.pathname === "/v1/playlists/owned-a/items" && request.method() === "PUT") {
      const body = request.postDataJSON() as {
        readonly range_start?: number;
        readonly insert_before?: number;
        readonly range_length?: number;
        readonly snapshot_id?: string;
      };
      const rangeStart = body.range_start ?? -1;
      const insertBefore = body.insert_before ?? -1;
      const rangeLength = body.range_length ?? -1;
      if (body.snapshot_id !== `snapshot-${String(mock.snapshot)}`) {
        await fulfillJson(route, { error: { status: 400, message: "Snapshot ID is stale" } }, 400);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      const moved = mock.items.splice(rangeStart, rangeLength);
      const insertionIndex = insertBefore > rangeStart + rangeLength
        ? insertBefore - rangeLength
        : insertBefore;
      mock.items.splice(insertionIndex, 0, ...moved);
      mock.snapshot += 1;
      mock.writeCount += 1;
      await fulfillJson(route, { snapshot_id: `snapshot-${String(mock.snapshot)}` });
      return;
    }
    await fulfillJson(route, { error: { status: 404, message: "Unmocked audit request" } }, 404);
  });
}

function playlistSummary(
  id: string,
  ownerId: string,
  name: string,
  total: number,
  isPublic: boolean | null,
): unknown {
  return {
    id,
    name,
    owner: { id: ownerId },
    snapshot_id: `snapshot-${id}`,
    public: isPublic,
    items: { total },
  };
}

function playlistMetadata(mock: SpotifyMock): unknown {
  return { id: "owned-a", owner: { id: "owner" }, snapshot_id: `snapshot-${String(mock.snapshot)}` };
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function auditAxe(page: Page, contextName: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  for (const violation of results.violations) {
    const targets = violation.nodes
      .slice(0, 12)
      .map((node) => node.target.join(" > "))
      .join(", ");
    failures.push(
      `${contextName} fails axe rule ${violation.id}: ${violation.help} (${String(violation.nodes.length)} ${violation.nodes.length === 1 ? "node" : "nodes"}: ${targets}).`,
    );
  }
}
