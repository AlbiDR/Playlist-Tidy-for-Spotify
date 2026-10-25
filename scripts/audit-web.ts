// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import { preview } from "vite";

const host = "127.0.0.1";
const port = 4174;
const origin = `http://${host}:${String(port)}`;
const failures: string[] = [];
const routes = [
  { path: "/", title: "Playlist Tidy for Spotify", reciprocalLink: "./privacy.html" },
  { path: "/privacy.html", title: "Privacy & safe use | Playlist Tidy", reciprocalLink: "./" },
] as const;
const viewports = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 1440, height: 1024 },
] as const;
const server = await preview({
  configFile: fileURLToPath(new URL("../config/vite.config.ts", import.meta.url)),
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
      for (const viewport of viewports) {
        for (const route of routes) {
          const context = await browser.newContext({ colorScheme: "dark", reducedMotion: "reduce", viewport });
          const page = await context.newPage();
          const thirdPartyRequests: string[] = [];
          page.on("request", (request) => {
            const requestOrigin = new URL(request.url()).origin;
            if (requestOrigin !== origin) thirdPartyRequests.push(requestOrigin);
          });
          page.on("console", (message) => {
            if (message.type() === "error") failures.push(`${browserName} console error: ${message.text()}`);
          });
          page.on("pageerror", (error) => failures.push(`${browserName} page error: ${error.message}`));
          await page.goto(`${origin}${route.path}`, { waitUntil: "networkidle" });

          const facts = await page.evaluate(() => {
            const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map(({ id }) => id);
            const headings = [...document.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6")]
              .map((heading) => Number(heading.tagName.slice(1)));
            const unnamedControls = [...document.querySelectorAll<HTMLElement>("button, input, select, textarea")]
              .filter((element) => {
                const label = element instanceof HTMLInputElement && element.id.length > 0
                  ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
                  : null;
                return (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().length === 0
                  && element.getAttribute("aria-labelledby") === null
                  && label === null;
              })
              .length;
            return {
              cookies: document.cookie,
              documentLanguage: document.documentElement.lang,
              duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
              externalResourceHints: [...document.querySelectorAll<HTMLLinkElement>('link[rel="preconnect"], link[rel="dns-prefetch"]')]
                .filter((link) => {
                  try {
                    return new URL(link.href).origin !== window.location.origin;
                  } catch {
                    return true;
                  }
                }).length,
              externalLinksWithoutProtection: [...document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')]
                .filter(({ relList }) => !relList.contains("noopener") || !relList.contains("noreferrer"))
                .length,
              headingOneCount: document.querySelectorAll("h1").length,
              horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              imagesWithoutAlternatives: [...document.querySelectorAll<HTMLImageElement>("img")]
                .filter((image) => !image.hasAttribute("alt")).length,
              imagesWithoutDimensions: [...document.querySelectorAll<HTMLImageElement>("img")]
                .filter((image) => !image.hasAttribute("width") || !image.hasAttribute("height")).length,
              localStorageCount: window.localStorage.length,
              mainCount: document.querySelectorAll("main").length,
              pointerLightCount: document.querySelectorAll(".pointer-light").length,
              sessionStorageCount: window.sessionStorage.length,
              skippedHeadingLevel: headings.some(
                (level, index) => index > 0 && level > (headings[index - 1] ?? level) + 1,
              ),
              title: document.title,
              unnamedControls,
              viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
            };
          });

          const contextName = `${browserName} ${route.path} at ${String(viewport.width)}px`;
          if (facts.mainCount !== 1) failures.push(`${contextName} has ${String(facts.mainCount)} main landmarks.`);
          if (facts.headingOneCount !== 1) failures.push(`${contextName} has ${String(facts.headingOneCount)} h1 elements.`);
          if (facts.documentLanguage !== "en") failures.push(`${contextName} does not declare English as its language.`);
          if (facts.title !== route.title) failures.push(`${contextName} has an unexpected document title.`);
          if (!facts.viewportMeta.includes("width=device-width")) failures.push(`${contextName} is missing a device-width viewport.`);
          if (facts.skippedHeadingLevel) failures.push(`${contextName} skips a heading level.`);
          if (facts.duplicateIds.length > 0) failures.push(`${contextName} has duplicate IDs: ${facts.duplicateIds.join(", ")}.`);
          if (facts.externalLinksWithoutProtection > 0) failures.push(`${contextName} has an unprotected external new-tab link.`);
          if (facts.externalResourceHints > 0) failures.push(`${contextName} primes a third-party connection before user action.`);
          if (facts.unnamedControls > 0) failures.push(`${contextName} has ${String(facts.unnamedControls)} controls without accessible names.`);
          if (facts.imagesWithoutAlternatives > 0) failures.push(`${contextName} has an image without an alt attribute.`);
          if (facts.imagesWithoutDimensions > 0) failures.push(`${contextName} has an image without explicit dimensions.`);
          if (facts.horizontalOverflow > 1) failures.push(`${contextName} overflows by ${String(facts.horizontalOverflow)}px.`);
          if (facts.pointerLightCount !== 0) failures.push(`${contextName} initialized motion despite reduced motion.`);
          if (facts.cookies.length > 0 || facts.localStorageCount > 0 || facts.sessionStorageCount > 0) {
            failures.push(`${contextName} persisted browser data before authorization.`);
          }
          if (thirdPartyRequests.length > 0) {
            failures.push(`${contextName} contacted third parties before user action: ${[...new Set(thirdPartyRequests)].join(", ")}.`);
          }

          const skipLink = page.locator(".skip-link");
          if (await skipLink.count() === 0) {
            failures.push(`${contextName} did not render the skip link.`);
            await context.close();
            continue;
          }
          const skipLinkIsFirst = await page.evaluate(() =>
            document.querySelector("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")?.classList.contains("skip-link") === true,
          );
          if (!skipLinkIsFirst) failures.push(`${contextName} does not place the skip link first in focus order.`);
          if (browserName === "WebKit") await skipLink.focus();
          else await page.keyboard.press("Tab");
          if (!(await skipLink.evaluate((element) => element === document.activeElement))) {
            failures.push(`${contextName} does not expose the skip link as the first focus target.`);
          }
          const focusAppearance = await skipLink.evaluate((element) => {
            const style = getComputedStyle(element);
            return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
          });
          if (focusAppearance.style === "none" || focusAppearance.width < 2) {
            failures.push(`${contextName} does not visibly outline keyboard focus.`);
          }
          await page.keyboard.press("Enter");
          if ((await page.evaluate(() => document.activeElement?.id ?? "")) !== "main-content") {
            failures.push(`${contextName} did not move skip-link focus to main.`);
          }
          if (await page.locator(`a[href="${route.reciprocalLink}"]`).count() === 0) {
            failures.push(`${contextName} is missing reciprocal home/privacy navigation.`);
          }
          await context.close();
        }
      }

      if (browserName === "Chromium") {
        await auditNoScriptFallback(browser);
        await auditForcedColors(browser);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

if (failures.length > 0) {
  process.stderr.write(`Browser audit failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Chromium, Firefox, and WebKit accessibility, privacy, and responsive audits passed.\n");
}

async function auditNoScriptFallback(browser: import("playwright").Browser): Promise<void> {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    const facts = await page.evaluate(() => ({
      heading: document.querySelector("h1")?.textContent?.trim() ?? "",
      message: document.querySelector("noscript")?.textContent?.trim() ?? "",
      mainCount: document.querySelectorAll("main").length,
    }));
    if (facts.mainCount !== 1 || facts.heading.length === 0 || !facts.message.includes("JavaScript is required")) {
      failures.push("Chromium without JavaScript does not provide a meaningful fallback.");
    }
  } finally {
    await context.close();
  }
}

async function auditForcedColors(browser: import("playwright").Browser): Promise<void> {
  const context = await browser.newContext({
    forcedColors: "active",
    reducedMotion: "reduce",
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    const facts = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      progressDisplay: getComputedStyle(document.querySelector(".reading-progress") as HTMLElement).display,
    }));
    if (facts.horizontalOverflow > 1) failures.push("Chromium forced-colors mode overflows horizontally.");
    if (facts.progressDisplay !== "none") failures.push("Chromium forced-colors mode retains decorative progress effects.");
  } finally {
    await context.close();
  }
}
